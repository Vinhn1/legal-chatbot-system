"""Kiểm thử truy xuất chính xác, hợp nhất BM25/vector và bảo vệ phạm vi dữ liệu."""

import tempfile
import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import Mock, patch
from pathlib import Path

import chromadb
from chromadb.api.types import Documents, EmbeddingFunction

from hybrid_retriever import BM25Index
from legal.ingest import IngestDocumentMetadata, ingest_file
from legal.retrieval import LegalRetriever, LocalCrossEncoderReranker, RetrievedChunk, parse_article_set
from query_reformulator import decompose_legal_query, expand_legal_query, extract_legal_references
from rag_pipeline import LegalRAG


class TestEmbedding(EmbeddingFunction[Documents]):
    """Tạo vector xác định tại máy thử nghiệm mà không tải mô hình từ mạng."""

    def __init__(self):
        """Khởi tạo bộ vector hóa đơn giản cho ChromaDB trong test."""
        pass

    def __call__(self, input: Documents):
        """Biểu diễn văn bản bằng ba đặc trưng số ổn định."""
        return [
            [float(len(text) % 97), float(sum(map(ord, text)) % 101), 1.0]
            for text in input
        ]

    @staticmethod
    def name() -> str:
        """Đặt tên riêng cho hàm embedding của bộ test."""
        return "test_legal_retrieval_embedding"

    def get_config(self):
        """Trả cấu hình rỗng vì bộ vector hóa không có tham số."""
        return {}

    @staticmethod
    def build_from_config(config):
        """Tạo lại bộ vector hóa từ cấu hình lưu trong ChromaDB."""
        return TestEmbedding()


class LegalRetrievalTest(unittest.TestCase):
    """Xác nhận exact match luôn đứng đầu và bộ lọc quyền không rò rỉ dữ liệu."""

    def setUp(self):
        """Lập collection tạm gồm văn bản công khai, nội bộ và đã hết hiệu lực."""
        self.temp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        client = chromadb.PersistentClient(path=self.temp.name)
        self.collection = client.get_or_create_collection(
            "legal_documents", embedding_function=TestEmbedding()
        )
        common = dict(issuing_authority="Quốc hội", issued_date="2026-01-01", source_url="https://example.org/law")
        public = IngestDocumentMetadata(
            doc_number="01/2026/QH", doc_title="Luật dữ liệu", document_type="law",
            effective_date="2026-02-01", effective_status="active", scope="public", **common,
        )
        internal = IngestDocumentMetadata(
            doc_number="02/2026/QH", doc_title="Luật nội bộ", document_type="law",
            effective_date="2026-02-01", effective_status="active", scope="internal", **common,
        )
        expired = IngestDocumentMetadata(
            doc_number="12/2020/NĐ-CP", doc_title="Nghị định cũ", document_type="decree",
            issuing_authority="Chính phủ", issued_date="2020-01-01",
            effective_date="2020-02-01", expiry_date="2025-01-01",
            effective_status="expired", scope="public", source_url="https://example.org/decree",
        )
        ingest_file(
            "Điều 1. Nghĩa vụ quản lý\n1. Đăng ký thông tin hợp lệ.\n2. Công bố dữ liệu pháp luật chính xác.\nĐiều 2. Bảo vệ dữ liệu\nNgười dùng có quyền xem văn bản công khai.".encode(),
            "public.txt", public, self.collection,
        )
        ingest_file(
            "Điều 1. Quy trình nội bộ\n1. Thông tin chỉ dành cho cán bộ nội bộ.".encode(),
            "internal.txt", internal, self.collection,
        )
        ingest_file(
            "Điều 1. Quy định trước đây\n2. Nghĩa vụ công bố đã hết hiệu lực.".encode(),
            "expired.txt", expired, self.collection,
        )
        self.retriever = LegalRetriever(self.collection)
        self.as_of = date(2026, 9, 29)

    def tearDown(self):
        """Dọn collection thử nghiệm mà không tác động dữ liệu runtime."""
        self.temp.cleanup()

    def test_extracts_explicit_legal_references(self):
        """Nhận diện đồng thời loại văn bản, số hiệu, Khoản và Điều trong câu hỏi."""
        references = extract_legal_references("Khoản 2 Điều 1 Nghị định số 12/2020/NĐ-CP quy định gì?")
        self.assertEqual(references.doc_number, "12/2020/NĐ-CP")
        self.assertEqual(references.article_number, "1")
        self.assertEqual(references.clause_number, "2")
        self.assertEqual(references.document_type, "decree")

    def test_exact_article_and_clause_are_top_one(self):
        """Ưu tiên đúng Khoản 2 Điều 1 dù các chunk khác cũng chứa từ khóa gần giống."""
        results = self.retriever.search(
            "Khoản 2 Điều 1 của Luật số 01/2026/QH nói gì về dữ liệu?", as_of=self.as_of
        )
        self.assertTrue(results)
        self.assertEqual(results[0].metadata["doc_number"], "01/2026/QH")
        self.assertEqual(results[0].metadata["article_number"], "1")
        self.assertEqual(results[0].metadata["clause_number"], "2")
        self.assertEqual(results[0].effective_status, "active")

    def test_public_scope_is_enforced_before_search_and_exact_match(self):
        """Người dùng công khai không thể lấy tài liệu nội bộ ngay cả khi biết số hiệu."""
        general = self.retriever.search("Điều 1 quy định gì?", as_of=self.as_of)
        self.assertTrue(general)
        self.assertTrue(all(item.metadata["scope"] == "public" for item in general))
        self.assertEqual(general[0].metadata["article_number"], "1")
        hidden = self.retriever.search("Điều 1 Luật số 02/2026/QH", as_of=self.as_of)
        self.assertEqual(hidden, [])
        permitted = self.retriever.search("Điều 1 Luật số 02/2026/QH", allow_internal=True, as_of=self.as_of)
        self.assertEqual(permitted[0].metadata["scope"], "internal")

    def test_temporal_status_never_upgrades_unknown_and_warns_partial_expiry(self):
        """Tính trạng thái theo ngày và giữ nguyên nhãn chưa xác minh."""
        unknown = {"effective_status": "unknown", "effective_date": "2020-01-01"}
        self.assertEqual(self.retriever._status_at(unknown, self.as_of), "unknown")
        partial = {
            "effective_status": "partially_expired", "effective_date": "2020-01-01",
            "status_since_date": "2025-01-01",
        }
        self.assertEqual(self.retriever._status_at(partial, date(2024, 12, 31)), "active")
        self.assertEqual(self.retriever._status_at(partial, self.as_of), "partially_expired")
        self.assertIn("một phần", self.retriever._warning("partially_expired"))

    def test_local_cross_encoder_reorders_candidates_by_model_score(self):
        """Xếp hạng lại theo điểm mô hình cục bộ mà không cần tải mô hình từ mạng."""
        reranker = LocalCrossEncoderReranker("/khong-can-mo-hinh-trong-test")
        reranker._model = SimpleNamespace(predict=lambda pairs: [0.1, 0.9])
        candidates = [
            RetrievedChunk("a", "Nội dung A", {}, 0.8, "active"),
            RetrievedChunk("b", "Nội dung B", {}, 0.7, "active"),
        ]
        self.assertEqual(reranker("Câu hỏi", candidates)[0].chunk_id, "b")

    def test_expired_document_requires_explicit_reference_and_has_warning(self):
        """Loại văn bản hết hiệu lực khỏi tìm kiếm chung, nhưng cảnh báo khi hỏi đúng số hiệu."""
        general = self.retriever.search("Nghĩa vụ công bố dữ liệu", as_of=self.as_of)
        self.assertTrue(all(item.metadata["doc_number"] != "12/2020/NĐ-CP" for item in general))
        exact = self.retriever.search("Khoản 2 Điều 1 Nghị định số 12/2020/NĐ-CP", as_of=self.as_of)
        self.assertEqual(exact[0].effective_status, "expired")
        self.assertIn("hết hiệu lực", exact[0].warning)

    def test_bm25_keeps_legal_units_and_vector_search_is_used(self):
        """BM25 giữ số Khoản một chữ số và truy xuất lai thực sự gọi vector search."""
        self.assertIn("2", BM25Index.tokenize("Khoản 2 Điều 1"))
        with patch.object(self.collection, "query", wraps=self.collection.query) as query:
            results = self.retriever.search("quyền xem văn bản", as_of=self.as_of)
        self.assertTrue(results)
        self.assertTrue(query.called)
        self.assertEqual(results[0].metadata["scope"], "public")

    def test_cache_invalidation_never_returns_deleted_or_wrong_scope(self):
        """Cùng corpus tái sử dụng BM25; sửa/xóa cùng số chunk vẫn phải vô hiệu cache."""
        with patch.object(self.collection, 'get', wraps=self.collection.get) as get:
            self.retriever.search('quyền xem văn bản', as_of=self.as_of)
            count = get.call_count
            self.retriever.search('quyền xem văn bản', as_of=self.as_of)
            self.assertEqual(get.call_count, count)
        results = self.retriever.search('quyền xem văn bản', as_of=self.as_of)
        removed = results[0].chunk_id
        self.collection.delete(ids=[removed])
        self.collection.add(ids=['replacement-fixture'], documents=['Dữ liệu nội bộ thay thế.'], metadatas=[{
            'scope': 'internal', 'effective_status': 'unknown', 'doc_number': 'FIXTURE', 'article_number': '1'}])
        self.retriever.invalidate()
        fresh = self.retriever.search('quyền xem văn bản', as_of=self.as_of)
        self.assertNotIn(removed, [item.chunk_id for item in fresh])
        self.assertNotIn('replacement-fixture', [item.chunk_id for item in fresh])
        self.assertTrue(all(item.metadata['scope'] == 'public' for item in fresh))

    def test_revision_marker_invalidates_other_worker_with_same_chunk_count(self):
        """Worker thứ hai nhận thay đổi quyền qua marker ngay cả khi số chunk không đổi."""
        marker = Path(self.temp.name) / '.fixture-revision'
        first = LegalRetriever(self.collection, revision_path=marker)
        second = LegalRetriever(self.collection, revision_path=marker)
        original = second.search('quyền xem văn bản', as_of=self.as_of)
        target = original[0].chunk_id
        metadata = dict(original[0].metadata, scope='internal')
        self.collection.update(ids=[target], metadatas=[metadata])
        first.invalidate()
        fresh = second.search('quyền xem văn bản', as_of=self.as_of)
        self.assertNotIn(target, [item.chunk_id for item in fresh])

    def test_long_source_phrase_beats_repeated_document_title(self):
        """Câu hỏi về ngưỡng tuổi phải lấy Điều chứa cụm quy định thay vì tên luật lặp lại."""
        question = "Theo Bộ luật Lao động 2019, độ tuổi lao động tối thiểu của người lao động là bao nhiêu?"
        source = "[Bộ luật Lao động 2019] [Điều 3]\nĐộ tuổi lao động tối thiểu của người lao động là đủ 15 tuổi."
        distractor = "[Bộ luật Lao động 2019] [Điều 148]\nNgười lao động làm việc theo quy định về thời giờ."
        metadata = {"doc_number": "45/2019/QH14", "scope": "public", "effective_status": "unknown"}
        collection = Mock()
        collection.get.return_value = {
            "ids": ["distractor", "source"],
            "documents": [distractor, source],
            "metadatas": [{**metadata, "article_number": "148"}, {**metadata, "article_number": "3"}],
        }
        retriever = LegalRetriever(collection)
        with patch.object(retriever, "_vector_ranked", return_value=[("distractor", 1.0, distractor), ("source", 0.5, source)]):
            results = retriever.search(question, limit=2, as_of=self.as_of)
        self.assertEqual(results[0].chunk_id, "source")
        self.assertIn("15 tuổi", results[0].document)

    def test_rag_pipeline_uses_retriever_and_exposes_effective_warning(self):
        """Đảm bảo luồng hỏi đáp dùng retriever mới và trả cảnh báo cùng nguồn."""
        rag = LegalRAG.__new__(LegalRAG)
        rag.collection = SimpleNamespace(count=lambda: 1)
        rag.retriever = Mock()
        rag.retriever.search.return_value = [RetrievedChunk(
            "old-1", "[Nghị định cũ] Khoản 2", {
                "doc_title": "Nghị định cũ", "doc_number": "12/2020/NĐ-CP",
                "source_url": "https://example.org/decree", "scope": "public", "article_number": "1", "clause_number": "2",
            }, 1.0, "expired", "Văn bản đã hết hiệu lực tại thời điểm tra cứu.",
        )]
        # Phản hồi mô hình cần đúng JSON và trích dẫn chunk đã truy xuất.
        fake_response = '{"answer":"Nội dung tham khảo.","citations":[{"chunk_id":"old-1","doc_number":"12/2020/NĐ-CP","article":"Điều 1","clause":"Khoản 2","snippet":"Khoản 2","source_url":"https://example.org/decree"}]}'
        fake_client = SimpleNamespace(models=SimpleNamespace(generate_content=lambda **kwargs: SimpleNamespace(text=fake_response)))
        with patch.dict("os.environ", {"GEMINI_API_KEY": "test-key"}), \
             patch("rag_pipeline.genai", SimpleNamespace(Client=lambda **kwargs: fake_client)), \
             patch("rag_pipeline.genai_types", SimpleNamespace(GenerateContentConfig=lambda **kwargs: kwargs)):
            answer, sources, _, _ = rag.answer_question("Nghị định cũ quy định gì?")
        rag.retriever.search.assert_called_once_with("Nghị định cũ quy định gì?", limit=5, allow_internal=False)
        self.assertIn("hết hiệu lực", answer)
        self.assertEqual(sources[0]["effective_status"], "expired")
        self.assertEqual(sources[0]["chunk_id"], "old-1")
        self.assertEqual(sources[0]["content"], "[Nghị định cũ] Khoản 2")

    def test_parse_article_set_avoids_substring_false_positive(self):
        """Đảm bảo tách đúng theo dấu phẩy, không khớp nhầm '2' vào '220,11'."""
        article_set = parse_article_set("220, 11, 07a")
        self.assertNotIn("2", article_set)
        self.assertNotIn("22", article_set)
        self.assertIn("220", article_set)
        self.assertIn("11", article_set)
        self.assertIn("7a", article_set)

    def test_multi_articles_point_id_and_synonym_expansion(self):
        """Trích xuất đúng Điểm, nhiều Điều liên tiếp và mở rộng từ đồng nghĩa pháp lý."""
        refs = extract_legal_references("Theo Điểm a Khoản 2 Điều 6 và Điều 7 về tách sổ đỏ tại Tây Ninh?")
        self.assertEqual(refs.point_id, "a")
        self.assertEqual(refs.clause_number, "2")
        self.assertEqual(refs.article_number, "6")
        self.assertEqual(refs.article_numbers, ("6", "7"))
        self.assertIn("dat_dai_tay_ninh", refs.subject_hints)
        expanded = expand_legal_query("Thủ tục tách sổ đỏ")
        self.assertIn("tách thửa đất", expanded)
        self.assertIn("Giấy chứng nhận quyền sử dụng đất", expanded)

    def test_tier2_mentioned_articles_and_sibling_context_enrichment(self):
        """Ưu tiên tài liệu chuyên đề có mentioned_articles khớp đúng chủ đề và gom ngữ cảnh cùng Điều."""
        topic_meta = IngestDocumentMetadata(
            doc_number="CD-01",
            doc_title="Chuyên đề 1: Pháp luật về kinh tế và Luật Doanh nghiệp",
            document_type="law",
            issuing_authority="Quốc hội",
            issued_date="2026-01-01",
            effective_date="2026-02-01",
            effective_status="unknown",
            scope="public",
            source_url="https://example.org/cd01",
        )
        ingest_file(
            (
                "Phần I. Pháp luật về doanh nghiệp\n"
                "Theo quy định tại Điều 7 và Điều 8 Luật Doanh nghiệp năm 2020, doanh nghiệp có quyền tự do kinh doanh "
                "ngành nghề mà luật không cấm và có nghĩa vụ đáp ứng đủ điều kiện đầu tư kinh doanh."
            ).encode("utf-8"),
            "cd01.txt",
            topic_meta,
            self.collection,
        )
        self.retriever.invalidate()
        res = self.retriever.search("Theo Điều 7 Luật Doanh nghiệp, quyền và nghĩa vụ của doanh nghiệp là gì?", as_of=self.as_of)
        self.assertTrue(res)
        self.assertEqual(res[0].metadata["doc_number"], "CD-01")
        self.assertIn("7", parse_article_set(res[0].metadata.get("mentioned_articles")))

        # Kiểm tra gom ngữ cảnh Khoản anh em trong cùng Điều 1 của Luật 01/2026/QH
        art1_res = self.retriever.search("Khoản 2 Điều 1 của Luật số 01/2026/QH nói gì về dữ liệu?", as_of=self.as_of)
        self.assertIn("[Ngữ cảnh bổ sung cùng Điều 1]:", art1_res[0].document)
        self.assertIn("Khoản 1. Đăng ký thông tin hợp lệ.", art1_res[0].document)

    def test_expand_cross_references_fetches_hop2_articles(self):
        """Tự động truy xuất bổ sung các Điều được dẫn chiếu (Hop-2) trong cùng văn bản khi chưa có ở primary_chunks."""
        ref_doc = IngestDocumentMetadata(
            doc_number="312/2026/NĐ-CP",
            doc_title="Nghị định kết hợp an ninh với kinh tế - xã hội",
            document_type="decree",
            issuing_authority="Chính phủ",
            issued_date="2026-01-01",
            effective_date="2026-02-01",
            effective_status="active",
            scope="public",
            source_url="https://example.org/312",
        )
        ingest_file(
            (
                "Điều 1. Quy hoạch phát triển kinh tế\n"
                "1. Quy hoạch phải gắn với bảo đảm an ninh quốc gia.\n"
                "Điều 2. Chương trình đầu tư công\n"
                "1. Dự án trọng điểm phải lấy ý kiến thẩm định về an ninh.\n"
                "Điều 3. Trách nhiệm thẩm định\n"
                "1. Bộ Công an chủ trì thẩm định các đề án thuộc trường hợp quy định tại Điều 1 và Điều 2 của Nghị định này."
            ).encode("utf-8"),
            "nd312.txt",
            ref_doc,
            self.collection,
        )
        self.retriever.invalidate()
        results = self.retriever.search(
            "Theo Điều 3 Nghị định 312/2026/NĐ-CP, trách nhiệm thẩm định được quy định thế nào?",
            limit=1,
            as_of=self.as_of,
        )
        # limit=1 lấy primary_chunk là Điều 3, sau đó expand_cross_references tự bổ sung Hop-2 cho Điều 1 và Điều 2
        articles_returned = [item.metadata.get("article_number") for item in results]
        self.assertEqual(articles_returned[0], "3")
        self.assertIn("1", articles_returned)
        self.assertIn("2", articles_returned)

    def test_decompose_legal_query_maps_quantitative_facts_and_llm_json(self):
        """Phân rã câu hỏi tình huống nhiều ý thành 4 khía cạnh và quy đổi dữ kiện thực tế sang ngưỡng pháp lý."""
        question = (
            "Tôi lái xe ô tô 5 chỗ chở con trai 8 tuổi (cao 1m25) đi học. Vì cháu thích nhìn đường "
            "nên tôi cho cháu ngồi ở ghế phụ ngay cạnh ghế lái và chỉ thắt dây an toàn có sẵn của xe "
            "chứ không lắp ghế riêng cho trẻ em. Xin hỏi việc tôi cho cháu ngồi như vậy có vi phạm quy tắc "
            "an toàn nào không, thế nào mới là thiết bị an toàn chuẩn cho trẻ em, và nếu bị cảnh sát giao thông "
            "kiểm tra thì tôi bị phạt bao nhiêu tiền, quy định phạt này áp dụng từ thời điểm nào?"
        )
        decomposed = decompose_legal_query(question, use_llm=False)
        norms_joined = " ".join(decomposed.normalized_norms)
        self.assertIn("dưới 10 tuổi và chiều cao dưới 1,35 mét", norms_joined)
        self.assertIn("ngồi cùng hàng ghế với người lái xe", norms_joined)
        self.assertIn("thiết bị an toàn cho trẻ em", norms_joined)
        self.assertGreaterEqual(len(decomposed.sub_queries), 4)
        self.assertLessEqual(len(decomposed.sub_queries), 5)
        facets = {sq.facet for sq in decomposed.sub_queries}
        self.assertEqual(facets, {"rule", "definition", "penalty", "effective_date"})

        mock_json = (
            '{"normalized_norms": ["trẻ em dưới 10 tuổi và chiều cao dưới 1,35 mét"], '
            '"sub_queries": ['
            '{"facet": "rule", "query": "chở trẻ em dưới 10 tuổi ngồi cùng hàng ghế với người lái xe ô tô", "target_doc_type": "law"},'
            '{"facet": "penalty", "query": "mức phạt tiền người điều khiển xe ô tô chở trẻ em dưới 10 tuổi", "target_doc_type": "decree"}'
            ']}'
        )
        fake_client = SimpleNamespace(
            models=SimpleNamespace(generate_content=lambda **_kw: SimpleNamespace(text=mock_json))
        )
        with_llm = decompose_legal_query(question, use_llm=True, gemini_client=fake_client)
        self.assertLessEqual(len(with_llm.sub_queries), 5)
        self.assertIn("trẻ em dưới 10 tuổi và chiều cao dưới 1,35 mét", with_llm.expanded_question)

    def test_traffic_benchmark_multi_query_diversity_and_bidirectional_cross_refs(self):
        """Truy xuất đủ cả 4 căn cứ pháp lý (Khoản 3 Điều 10, Khoản 13 Điều 2 Luật 36; Điểm m Khoản 3 Điều 6, Khoản 2 Điều 53 NĐ 168)."""
        law_36_meta = IngestDocumentMetadata(
            doc_number="36/2024/QH15",
            doc_title="Luật Trật tự, an toàn giao thông đường bộ",
            document_type="law",
            issuing_authority="Quốc hội",
            issued_date="2024-06-27",
            effective_date="2025-01-01",
            effective_status="active",
            scope="public",
            source_url="https://congbao.chinhphu.vn/36-2024-qh15",
        )
        law_36_text = """Chương I
NHỮNG QUY ĐỊNH CHUNG
Điều 1. Phạm vi điều chỉnh
Luật này quy định về quy tắc, phương tiện, người tham gia giao thông đường bộ.
Điều 2. Giải thích từ ngữ
Trong Luật này, các từ ngữ dưới đây được hiểu như sau:
1. Đường bộ gồm đường, cầu đường bộ, hầm đường bộ, bến phà đường bộ.
2. Công trình đường bộ gồm đường bộ, nơi dừng xe, đỗ xe trên đường bộ, đèn tín hiệu.
13. Thiết bị an toàn cho trẻ em là thiết bị có đủ khả năng bảo đảm an toàn cho trẻ em ở tư thế ngồi hoặc nằm trên xe ô tô, được thiết kế để giảm nguy cơ chấn thương cho người dùng, trong trường hợp xảy ra va chạm hoặc xe ô tô giảm tốc độ đột ngột, bằng cách hạn chế sự di chuyển của cơ thể trẻ em.
Điều 3. Nguyên tắc bảo đảm trật tự, an toàn giao thông đường bộ
1. Tuân thủ Hiến pháp, pháp luật Việt Nam và điều ước quốc tế.
Chương II
QUY TẮC GIAO THÔNG ĐƯỜNG BỘ
Điều 9. Quy tắc chung
1. Người tham gia giao thông đường bộ phải đi bên phải theo chiều đi của mình, đi đúng làn đường.
Điều 10. Quy tắc chung đối với người lái xe và người được chở trên xe ô tô
1. Người lái xe và người được chở trên xe ô tô phải thắt dây đai an toàn tại những chỗ có trang bị dây đai an toàn khi tham gia giao thông đường bộ.
2. Người lái xe ô tô phải kiểm tra điều kiện bảo đảm an toàn của xe trước khi khởi hành.
3. Khi ch ở trẻ em d ưới 10 tu ổi và chi ều cao d ưới 1,35 mét trên xe ô tô không được cho tr ẻ em ng ồi cùng hàng gh ế với ng ười lái xe, tr ừ loại xe ô tô ch ỉ có một hàng gh ế; ng ười lái xe ph ải sử dụng, h ướng dẫn sử dụng thi ết bị an toàn phù h ợp cho tr ẻ em.
Điều 11. Chấp hành báo hiệu đường bộ
1. Người tham gia giao thông đường bộ phải chấp hành hiệu lệnh của người điều khiển giao thông và đèn tín hiệu.
"""
        nd_168_meta = IngestDocumentMetadata(
            doc_number="168/2024/NĐ-CP",
            doc_title="Nghị định quy định xử phạt vi phạm hành chính về trật tự, an toàn giao thông trong lĩnh vực giao thông đường bộ; trừ điểm, phục hồi điểm giấy phép lái xe",
            document_type="decree",
            issuing_authority="Chính phủ",
            issued_date="2024-12-26",
            effective_date="2025-01-01",
            effective_status="active",
            scope="public",
            source_url="https://congbao.chinhphu.vn/168-2024-nd-cp",
        )
        nd_168_text = """Chương I
NHỮNG QUY ĐỊNH CHUNG
Điều 1. Phạm vi điều chỉnh
1. Nghị định này quy định xử phạt vi phạm hành chính về trật tự, an toàn giao thông trong lĩnh vực giao thông đường bộ.
Điều 2. Đối tượng áp dụng
1. Cá nhân, tổ chức có hành vi vi phạm hành chính về trật tự, an toàn giao thông trong lĩnh vực giao thông đường bộ.
Điều 3. Hình thức xử phạt vi phạm hành chính và biện pháp khắc phục hậu quả
1. Các hình thức xử phạt chính gồm cảnh cáo và phạt tiền.
Điều 4. Mức phạt tiền tối đa và nguyên tắc trừ điểm giấy phép lái xe
1. Giấy phép lái xe gồm 12 điểm dùng để quản lý việc chấp hành pháp luật về trật tự, an toàn giao thông đường bộ.
Chương II
HÀNH VI VI PHẠM, HÌNH THỨC, MỨC XỬ PHẠT, MỨC TRỪ ĐIỂM GIẤY PHÉP LÁI XE
Điều 5. Xử phạt người đi bộ vi phạm quy tắc giao thông đường bộ
1. Phạt tiền từ 150.000 đồng đến 250.000 đồng đối với người đi bộ không đi đúng phần đường quy định.
Điều 6. Xử phạt, trừ điểm giấy phép lái xe của người điều khiển xe ô tô, xe chở người bốn bánh có gắn động cơ, xe chở hàng bốn bánh có gắn động cơ và các loại xe tương tự xe ô tô vi phạm quy tắc giao thông đường bộ
1. Phạt tiền từ 400.000 đồng đến 600.000 đồng đối với người điều khiển xe không chấp hành hiệu lệnh, chỉ dẫn của biển báo hiệu, vạch kẻ đường.
2. Phạt tiền từ 600.000 đồng đến 800.000 đồng đối với người điều khiển xe chuyển làn đường không đúng nơi cho phép hoặc không có tín hiệu báo trước.
3. Phạt tiền từ 800.000 đồng đến 1.000.000 đồng đối với người điều khiển xe thực hiện một trong các hành vi vi phạm sau đây:
a) Điều khiển xe chạy quá tốc độ quy định từ 05 km/h đến dưới 10 km/h;
b) Bấm còi, rú ga liên tục; bấm còi hơi, sử dụng đèn chiếu xa khi gặp xe đi ngược chiều;
h) Không thắt dây đai an toàn khi điều khiển xe chạy trên đường;
i) Chở người trên xe ô tô không thắt dây đai an toàn (tại vị trí có trang bị dây đai an toàn) khi xe đang chạy;
m) Chở trẻ em dưới 10 tuổi và chiều cao dưới 1,35 mét trên xe ô tô ngồi cùng hàng ghế với người lái xe (trừ loại xe ô tô chỉ có một hàng ghế) hoặc không sử dụng thiết bị an toàn phù hợp cho trẻ em theo quy định;
16. Trừ điểm giấy phép lái xe đối với người điều khiển xe ô tô vi phạm quy định sau:
a) Thực hiện hành vi quy định tại điểm a, điểm b khoản 3 Điều này không bị trừ điểm giấy phép lái xe;
b) Thực hiện hành vi quy định tại khoản 5, khoản 6 Điều này bị trừ 04 điểm giấy phép lái xe.
Điều 7. Xử phạt, trừ điểm giấy phép lái xe của người điều khiển xe mô tô, xe gắn máy, các loại xe tương tự xe mô tô và các loại xe tương tự xe gắn máy vi phạm quy tắc giao thông đường bộ
1. Phạt tiền từ 200.000 đồng đến 400.000 đồng đối với người điều khiển xe mô tô không đội mũ bảo hiểm hoặc chở trẻ em trên xe mô tô không cài quai đúng quy cách.
Điều 8. Xử phạt người điều khiển xe máy chuyên dùng vi phạm quy tắc giao thông đường bộ
1. Phạt tiền từ 400.000 đồng đến 600.000 đồng đối với người điều khiển xe máy chuyên dùng đi không đúng phần đường.
Điều 28. Xử phạt các hành vi vi phạm quy định về vận tải đường bộ
1. Phạt tiền từ 1.000.000 đồng đến 2.000.000 đồng đối với hành vi chở quá số người quy định trên xe ô tô kinh doanh vận tải hành khách.
Điều 29. Xử phạt hành vi vi phạm quy định về dịch vụ hỗ trợ vận tải đường bộ
1. Phạt tiền từ 2.000.000 đồng đến 3.000.000 đồng đối với đơn vị kinh doanh bến xe khách không thực hiện đúng quy trình an toàn.
Chương IV
ĐIỀU KHOẢN THI HÀNH
Điều 53. Hiệu lực thi hành
1. Nghị định này có hiệu lực thi hành từ ngày 01 tháng 01 năm 2025, trừ quy định tại khoản 2 Điều này.
2. Quy định tại điểm m khoản 3 Điều 6, điểm e khoản 4 Điều 26, điểm b khoản 1 Điều 27 của Nghị định này có hiệu lực thi hành từ ngày 01 tháng 01 năm 2026.
"""
        r36 = ingest_file(law_36_text.encode("utf-8"), "law36.txt", law_36_meta, self.collection)
        r168 = ingest_file(nd_168_text.encode("utf-8"), "nd168.txt", nd_168_meta, self.collection)
        self.assertEqual(r36.structure_status, "structured")
        self.assertEqual(r168.structure_status, "structured")
        self.retriever.invalidate()

        benchmark_question = (
            "Tôi lái xe ô tô 5 chỗ chở con trai 8 tuổi (cao 1m25) đi học. Vì cháu thích nhìn đường "
            "nên tôi cho cháu ngồi ở ghế phụ ngay cạnh ghế lái và chỉ thắt dây an toàn có sẵn của xe "
            "chứ không lắp ghế riêng cho trẻ em. Xin hỏi việc tôi cho cháu ngồi như vậy có vi phạm quy tắc "
            "an toàn nào không, thế nào mới là thiết bị an toàn chuẩn cho trẻ em, và nếu bị cảnh sát giao thông "
            "kiểm tra thì tôi bị phạt bao nhiêu tiền, quy định phạt này áp dụng từ thời điểm nào?"
        )
        results = self.retriever.search(benchmark_question, limit=5, as_of=date(2026, 10, 31))
        unit_codes = {item.metadata.get("unit_code") for item in results}
        doc_numbers = {item.metadata.get("doc_number") for item in results}

        # Đảm bảo cân bằng đa văn bản (có cả Luật 36/2024/QH15 lẫn Nghị định 168/2024/NĐ-CP)
        self.assertIn("36/2024/QH15", doc_numbers)
        self.assertIn("168/2024/NĐ-CP", doc_numbers)

        # Đảm bảo lấy đủ toàn bộ 4 căn cứ pháp lý chuẩn xác
        self.assertIn("36/2024/QH15:10:3", unit_codes)
        self.assertIn("36/2024/QH15:2:13", unit_codes)
        self.assertIn("168/2024/NĐ-CP:6:3:m", unit_codes)
        self.assertIn("168/2024/NĐ-CP:53:2", unit_codes)

        point_m_chunk = next(item for item in results if item.metadata.get("unit_code") == "168/2024/NĐ-CP:6:3:m")
        self.assertIn("[Khoản 3: Phạt tiền từ 800.000 đồng đến 1.000.000 đồng", point_m_chunk.document)
        self.assertIn("[Điều 6:", point_m_chunk.document)

        eff_chunk = next(item for item in results if item.metadata.get("unit_code") == "168/2024/NĐ-CP:53:2")
        self.assertIn("01 tháng 01 năm 2026", eff_chunk.document)


if __name__ == "__main__":
    unittest.main()
