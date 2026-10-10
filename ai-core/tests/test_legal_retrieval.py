"""Kiểm thử truy xuất chính xác, hợp nhất BM25/vector và bảo vệ phạm vi dữ liệu."""

import tempfile
import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import Mock, patch

import chromadb
from chromadb.api.types import Documents, EmbeddingFunction

from hybrid_retriever import BM25Index
from legal.ingest import IngestDocumentMetadata, ingest_file
from legal.retrieval import LegalRetriever, LocalCrossEncoderReranker, RetrievedChunk
from query_reformulator import extract_legal_references
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


if __name__ == "__main__":
    unittest.main()
