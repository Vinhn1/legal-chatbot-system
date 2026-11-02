import asyncio
import hashlib
import importlib
import io
import sys
import tempfile
import types
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import chromadb
from docx import Document
from chromadb.api.types import Documents, EmbeddingFunction
from fastapi import HTTPException, UploadFile
from pypdf import PdfWriter

from legal.ingest import IngestDocumentMetadata, extract_text, ingest_file, ocr_pdf_bytes
from legal.parser import parse_legal_text


FIXTURES = Path(__file__).parent / "fixtures"


class LocalEmbedding(EmbeddingFunction[Documents]):
    def __init__(self):
        pass

    def __call__(self, input: Documents):
        return [[float(len(value) % 97), float(sum(map(ord, value)) % 101), 1.0] for value in input]

    @staticmethod
    def name() -> str:
        return "test_local_embedding"

    def get_config(self):
        return {}

    @staticmethod
    def build_from_config(config):
        return LocalEmbedding()


class LegalIngestTest(unittest.TestCase):
    def setUp(self):
        self.metadata = IngestDocumentMetadata(
            doc_number="01/2026/QH",
            doc_title="Luật mẫu về dữ liệu pháp luật",
            document_type="law",
            issuing_authority="Quốc hội",
            issued_date="2026-01-01",
            effective_date="2026-07-01",
            source_url="https://example.org/law/01-2026",
        )
        self.temp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        client = chromadb.PersistentClient(path=self.temp.name)
        self.collection = client.get_or_create_collection("legal_documents", embedding_function=LocalEmbedding())

    def tearDown(self):
        self.temp.cleanup()

    def test_parser_supports_multi_clause_and_single_article(self):
        text = (FIXTURES / "sample_law.txt").read_text(encoding="utf-8")
        parsed = parse_legal_text(text)
        self.assertFalse(parsed.needs_review)
        self.assertEqual(len(parsed.articles), 2)
        self.assertEqual([clause.number for clause in parsed.articles[0].clauses], ["1", "2"])
        self.assertEqual([point.number for point in parsed.articles[0].clauses[0].points], ["a", "b"])
        self.assertEqual(parsed.articles[1].clauses, [])
        self.assertIn("Người dùng chỉ được xem", parsed.articles[1].text)

    def test_real_chroma_index_has_enriched_children_and_no_fake_clause(self):
        data = (FIXTURES / "sample_law.txt").read_bytes()
        result = ingest_file(data, "sample_law.txt", self.metadata, self.collection)
        self.assertEqual(result.status, "indexed")
        self.assertEqual(result.chunk_count, 8)
        self.assertEqual(self.collection.count(), 8)
        stored = self.collection.get(include=["documents", "metadatas"])
        pairs = list(zip(stored["documents"], stored["metadatas"]))
        for content, metadata in pairs:
            self.assertIn("[Văn bản: Luật mẫu về dữ liệu pháp luật (01/2026/QH)]", content)
            if metadata.get("article_number"):
                self.assertIn("[Chương I. QUY ĐỊNH CHUNG]", content)
                self.assertIn("[Mục 1. Phạm vi và nguyên tắc]", content)
                self.assertIn("[Điều ", content)
                self.assertIn("Nội dung chi tiết:", content)
                self.assertTrue(metadata.get("unit_code", "").startswith("01/2026/QH:"))
            if metadata.get("unit_type") == "point":
                self.assertIn("[Khoản 1: Luật này quy định việc quản lý văn bản pháp luật.]", content)
                self.assertIn("[Khoản 1: Luật này quy định việc quản lý văn bản pháp luật.]", metadata["parent_context"])
            self.assertEqual(metadata["source_url"], "https://example.org/law/01-2026")
            self.assertEqual(metadata["source_type"], "txt")
            self.assertEqual(metadata["effective_status"], "unknown")
            self.assertEqual(metadata["indexed_at"], date.today().isoformat())
        child = [metadata for _, metadata in pairs if metadata.get("article_number") == "1"]
        self.assertTrue(all("clause_number" in metadata for metadata in child))
        single = [metadata for _, metadata in pairs if metadata.get("article_number") == "2"]
        self.assertEqual(len(single), 1)
        self.assertNotIn("clause_number", single[0])

        duplicate = ingest_file(data, "sample_law.txt", self.metadata, self.collection)
        self.assertEqual(duplicate.status, "duplicate")
        # Lần nạp lại phải trả số liệu của các bản ghi ChromaDB hiện có.
        self.assertEqual(duplicate.chunk_count, result.chunk_count)
        self.assertEqual(duplicate.article_count, result.article_count)
        self.assertEqual(self.collection.count(), 8)

    def test_unstructured_text_indexes_with_review_and_unreadable_scan_stays_blocked(self):
        """Văn bản đọc được được lập chỉ mục; nội dung OCR hỏng vẫn bị chặn."""
        unstructured = (FIXTURES / "unstructured_sample.txt").read_bytes()
        pending = ingest_file(unstructured, "unstructured_sample.txt", self.metadata, self.collection)
        self.assertEqual(pending.status, "indexed")
        self.assertGreater(pending.chunk_count, 0)
        self.assertTrue(pending.needs_review)
        self.assertEqual(self.collection.count(), pending.chunk_count)
        indexed = ingest_file(unstructured, "unstructured_sample.txt", self.metadata, self.collection, force_paragraph=True)
        self.assertEqual(indexed.status, "duplicate")
        self.assertEqual(indexed.structure_status, "unstructured_fallback")
        self.assertTrue(indexed.needs_review)
        self.assertGreater(indexed.chunk_count, 0)
        self.assertEqual(self.collection.count(), indexed.chunk_count)
        duplicate = ingest_file(unstructured, "unstructured_sample.txt", self.metadata, self.collection)
        self.assertEqual(duplicate.status, "duplicate")
        self.assertEqual(duplicate.chunk_count, indexed.chunk_count)
        self.assertEqual(duplicate.structure_status, "unstructured_fallback")
        for data, filename in (
            (b"\n  \n", "scan.txt"),
            ("Điều 1. Quy định\n???���!!!".encode("utf-8"), "poor_ocr.txt"),
        ):
            with self.subTest(filename=filename):
                result = ingest_file(data, filename, self.metadata, self.collection)
                self.assertEqual(result.status, "needs_review")
                self.assertEqual(result.structure_status, "unstructured")
                self.assertTrue(result.needs_review)
                self.assertGreater(len(result.warnings), 0)
                self.assertEqual(result.chunk_count, 0)
                forced = ingest_file(data, filename, self.metadata, self.collection, force_paragraph=True)
                self.assertEqual(forced.status, "needs_review")
        self.assertEqual(self.collection.count(), indexed.chunk_count)

    def test_long_unstructured_text_has_bounded_overlapping_chunks(self):
        """Các đoạn dài được lưu vào ChromaDB với ngữ cảnh lặp và nguồn rõ ràng."""
        paragraph = "Nghị quyết quy định trách nhiệm thực hiện chính sách lao động và bảo vệ quyền lợi hợp pháp. "
        text = "\n\n".join(paragraph * 42 for _ in range(3))
        result = ingest_file(text.encode("utf-8"), "resolution.txt", self.metadata, self.collection, force_paragraph=True)
        self.assertEqual(result.status, "indexed")
        self.assertEqual(result.article_count, 0)
        self.assertGreater(result.chunk_count, 1)
        self.assertEqual(self.collection.count(), result.chunk_count)
        records = self.collection.get(include=["documents", "metadatas"])
        pairs = sorted(zip(records["ids"], records["documents"], records["metadatas"]), key=lambda item: int(item[0].split(":")[-1]))
        for chunk_id, content, chunk_meta in pairs:
            with self.subTest(chunk_id=chunk_id):
                word_count = len(content.partition("\n")[2].split())
                self.assertGreaterEqual(word_count, 400)
                self.assertLessEqual(word_count, 800)
                self.assertEqual(chunk_meta["chunk_id"], chunk_id)
                self.assertEqual(chunk_meta["source_url"], self.metadata.source_url)
                self.assertEqual(chunk_meta["structure_status"], "unstructured_fallback")
        first_words = pairs[0][1].partition("\n")[2].split()
        second_words = pairs[1][1].partition("\n")[2].split()
        self.assertEqual(first_words[-80:], second_words[:80])

    def test_docx_extracts_text_and_scan_pdf_requires_review(self):
        document = Document()
        document.add_paragraph("Điều 3. Hiệu lực thi hành")
        document.add_paragraph("Văn bản này có hiệu lực từ ngày được xác minh.")
        docx_bytes = io.BytesIO()
        document.save(docx_bytes)
        self.assertIn("Điều 3", extract_text(docx_bytes.getvalue(), "law.docx"))
        indexed = ingest_file(docx_bytes.getvalue(), "law.docx", self.metadata, self.collection)
        self.assertEqual(indexed.chunk_count, 1)

        scanned_pdf = PdfWriter()
        scanned_pdf.add_blank_page(width=595, height=842)
        pdf_bytes = io.BytesIO()
        scanned_pdf.write(pdf_bytes)
        review = ingest_file(pdf_bytes.getvalue(), "scan.pdf", self.metadata, self.collection)
        self.assertTrue(review.needs_review)
        self.assertEqual(review.structure_status, "unstructured")
        self.assertEqual(self.collection.count(), 1)

    def test_reupload_repairs_legacy_index_without_coverage_marker(self):
        """Lần nạp lại thay thế chunk cũ sau khi chunk mới đã được ghi thành công."""
        data = (FIXTURES / "sample_law.txt").read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        old_id = f"{self.metadata.doc_id}:0"
        self.collection.add(ids=[old_id], documents=["Nội dung cũ chưa đầy đủ"],
                            metadatas=[{"content_hash": digest, "doc_id": str(self.metadata.doc_id),
                                        "article_number": "1"}])
        result = ingest_file(data, "sample_law.txt", self.metadata, self.collection)
        self.assertEqual(result.status, "indexed")
        self.assertEqual(result.coverage, 1.0)
        self.assertEqual(self.collection.get(ids=[old_id])["ids"], [])
        self.assertEqual(self.collection.count(), result.chunk_count)

    def test_api_requires_internal_token_and_accepts_admin_forwarded_upload(self):
        fake_rag = types.ModuleType("rag_pipeline")
        fake_rag.AIServiceError = type("FakeAIServiceError", (Exception,), {})
        fake_rag.LegalRAG = lambda: types.SimpleNamespace(collection=self.collection)
        with patch.dict(sys.modules, {"rag_pipeline": fake_rag}):
            api = importlib.import_module("api_server")
        with patch.object(api.bot, "collection", self.collection), patch.dict("os.environ", {"AI_CORE_INTERNAL_TOKEN": "test-internal-token"}):
            route = next(route for route in api.app.routes if route.path == "/legal/ingest")
            self.assertTrue(any(dependency.call is api.require_internal_token for dependency in route.dependant.dependencies))
            with self.assertRaises(HTTPException) as error:
                asyncio.run(api.require_internal_token(None))
            self.assertEqual(error.exception.status_code, 401)
            asyncio.run(api.require_internal_token("test-internal-token"))
            payload = self.metadata.model_dump_json()
            upload = UploadFile(
                filename="sample_law.txt",
                file=io.BytesIO((FIXTURES / "sample_law.txt").read_bytes()),
            )
            response = asyncio.run(api.ingest_legal_document(upload, payload))
            self.assertEqual(response["chunk_count"], 8)
            self.assertEqual(api.get_documents()[0]["source_type"], "txt")

            # Nội dung đọc được được lập chỉ mục ngay và vẫn được đánh dấu cần rà soát.
            unstructured = (FIXTURES / "unstructured_sample.txt").read_bytes()
            review_payload = self.metadata.model_copy(update={"doc_id": uuid4()}).model_dump_json()
            pending_upload = UploadFile(filename="unstructured_sample.txt", file=io.BytesIO(unstructured))
            pending = asyncio.run(api.ingest_legal_document(pending_upload, review_payload))
            self.assertEqual(pending["status"], "indexed")
            approved_upload = UploadFile(filename="unstructured_sample.txt", file=io.BytesIO(unstructured))
            approved = asyncio.run(api.ingest_legal_document(approved_upload, review_payload, force_paragraph=True))
            self.assertEqual(approved["status"], "duplicate")
            self.assertEqual(approved["structure_status"], "unstructured_fallback")

    def test_multipage_ocr_processes_all_batches_and_preserves_structured_articles(self):
        """AI OCR phải chuyển trang sang JPEG nén nhẹ, quét đủ toàn bộ các lô trang, báo tiến độ và không bịa đặt khi tệp rỗng."""
        from pypdf import PdfReader

        scanned_pdf = PdfWriter()
        for _ in range(7):
            scanned_pdf.add_blank_page(width=595, height=842)
        buf = io.BytesIO()
        scanned_pdf.write(buf)
        pdf_data = buf.getvalue()

        batch_page_counts: list[int] = []
        observed_mime_types: set[str] = set()
        progress_events: list[tuple[int, int]] = []

        class FakeModels:
            def generate_content(self, **_kwargs):
                contents = _kwargs.get("contents") or []
                media_parts = [p for p in contents if not isinstance(p, str)]
                prompt_parts = [p for p in contents if isinstance(p, str)]
                prompt_text = " ".join(prompt_parts)
                first_inline = getattr(media_parts[0], "inline_data", None)
                mime_val = getattr(first_inline, "mime_type", "") or ""
                observed_mime_types.add(mime_val)
                if mime_val == "image/jpeg":
                    page_count = len(media_parts)
                else:
                    inline_bytes = getattr(first_inline, "data", b"")
                    page_count = len(PdfReader(io.BytesIO(inline_bytes)).pages)
                batch_page_counts.append(page_count)
                # Ánh xạ xác định số Điều theo thứ tự lô trang thực tế để kiểm chứng việc ghép đúng thứ tự khi chạy đa luồng
                if "từ trang 1 đến trang 2" in prompt_text:
                    art_no = 1
                elif "từ trang 3 đến trang 4" in prompt_text:
                    art_no = 2
                elif "từ trang 5 đến trang 6" in prompt_text:
                    art_no = 3
                else:
                    art_no = 4
                filler = ("Nội dung quy phạm pháp luật chi tiết bảo đảm mật độ từ trên mỗi trang văn bản. " * 16).strip()
                if art_no == 1:
                    txt = (
                        "**Chương I**\n**NHỮNG QUY ĐỊNH CHUNG**\n"
                        "**Điều 1. Phạm vi điều chỉnh**\n"
                        f"1. Nghị định này quy định xử phạt vi phạm hành chính về trật tự, an toàn giao thông đường bộ. {filler}\n"
                        f"2. Quy định về trừ điểm và phục hồi điểm giấy phép lái xe trên phạm vi toàn quốc. {filler}"
                    )
                else:
                    txt = (
                        f"**Điều {art_no}. Đối tượng và nguyên tắc áp dụng thứ {art_no}**\n"
                        f"1. Cá nhân và tổ chức có hành vi vi phạm hành chính trong lĩnh vực giao thông đường bộ. {filler}\n"
                        f"2. Bảo đảm xử lý nghiêm minh, đúng thẩm quyền theo quy định pháp luật hiện hành. {filler}"
                    )
                return types.SimpleNamespace(text=txt, candidates=[])

        class FakeClient:
            def __init__(self, **_kwargs):
                self.models = FakeModels()

        with patch.dict(
            "os.environ",
            {
                "GEMINI_API_KEY": "fake-key-for-unit-test",
                "GEMINI_MODEL": "gemini-2.5-flash-lite",
                "OCR_RETRY_BASE_DELAY": "0.01",
            },
        ), patch("google.genai.Client", FakeClient):
            ocr_text = ocr_pdf_bytes(
                pdf_data,
                "168-nd-cp.signed.pdf",
                on_progress=lambda done, total: progress_events.append((done, total)),
            )

        self.assertIn("image/jpeg", observed_mime_types)
        self.assertEqual(sorted(batch_page_counts), [1, 2, 2, 2])
        self.assertEqual(progress_events[-1], (7, 7))
        self.assertNotIn("**", ocr_text)
        self.assertLess(ocr_text.index("Điều 1. Phạm vi điều chỉnh"), ocr_text.index("Điều 2. Đối tượng"))

        decree_meta = IngestDocumentMetadata(
            doc_id=uuid4(),
            doc_number="168/2024/NĐ-CP",
            doc_title="Nghị định xử phạt vi phạm hành chính về trật tự, an toàn giao thông",
            document_type="decree",
            issuing_authority="Chính phủ",
            issued_date="2024-12-26",
            source_url="https://congbao.chinhphu.vn",
        )
        ingested = ingest_file(
            pdf_data,
            "168-nd-cp.signed.pdf",
            decree_meta,
            self.collection,
            force_paragraph=True,
            override_text=ocr_text,
        )
        self.assertEqual(ingested.status, "indexed")
        self.assertEqual(ingested.structure_status, "structured")
        self.assertEqual(ingested.article_count, 4)
        self.assertGreaterEqual(ingested.chunk_count, 4)

        # Kiểm tra cơ chế chống sót trang: khi lô 2 trang trả về quá ít từ (LLM dừng sớm sau trang 1), tự tách xuống từng trang đơn
        two_page_pdf = PdfWriter()
        two_page_pdf.add_blank_page(width=595, height=842)
        two_page_pdf.add_blank_page(width=595, height=842)
        two_buf = io.BytesIO()
        two_page_pdf.write(two_buf)
        split_calls: list[int] = []

        class EarlyStopModels:
            def __init__(self):
                self.single_idx = 0

            def generate_content(self, **_kwargs):
                contents = _kwargs.get("contents") or []
                media_parts = [p for p in contents if not isinstance(p, str)]
                split_calls.append(len(media_parts))
                if len(media_parts) == 2:
                    # Giả lập lỗi LLM chỉ đọc nửa trang đầu rồi dừng sớm (không có MAX_TOKENS)
                    return types.SimpleNamespace(
                        text="Điều 5. Xử phạt người đi bộ\n1. Cảnh cáo hoặc phạt tiền từ 150.000 đồng đến 250.000 đồng.",
                        candidates=[],
                    )
                self.single_idx += 1
                if self.single_idx == 1:
                    return types.SimpleNamespace(
                        text="Điều 5. Xử phạt người đi bộ vi phạm quy tắc giao thông đường bộ\n1. Phạt tiền từ 150.000 đồng đến 250.000 đồng đối với người đi bộ không đi đúng phần đường quy định.",
                        candidates=[],
                    )
                return types.SimpleNamespace(
                    text="Điều 6. Xử phạt người điều khiển xe ô tô vi phạm quy tắc giao thông đường bộ\n3. Phạt tiền từ 800.000 đồng đến 1.000.000 đồng đối với người điều khiển xe thực hiện hành vi:\nm) Chở trẻ em dưới 10 tuổi và chiều cao dưới 1,35 mét trên xe ô tô ngồi cùng hàng ghế với người lái xe.",
                    candidates=[],
                )

        class EarlyStopClient:
            def __init__(self, **_kwargs):
                self.models = EarlyStopModels()

        with patch.dict(
            "os.environ",
            {"GEMINI_API_KEY": "fake-key-for-unit-test", "OCR_RETRY_BASE_DELAY": "0.01", "OCR_MIN_WORDS_PER_PAGE": "110"},
        ), patch("google.genai.Client", EarlyStopClient):
            recovered_ocr = ocr_pdf_bytes(two_buf.getvalue(), "168-pages-5-6.pdf")
        self.assertEqual(split_calls, [2, 1, 1])
        self.assertIn("Điều 5.", recovered_ocr)
        self.assertIn("Điều 6.", recovered_ocr)
        self.assertIn("m) Chở trẻ em dưới 10 tuổi", recovered_ocr)

        class EmptyModels:
            def generate_content(self, **_kwargs):
                return types.SimpleNamespace(text="Trang trắng không chứa nội dung văn bản", candidates=[])

        class EmptyClient:
            def __init__(self, **_kwargs):
                self.models = EmptyModels()

        with patch.dict("os.environ", {"GEMINI_API_KEY": "fake-key-for-unit-test", "OCR_RETRY_BASE_DELAY": "0.01"}), \
             patch("google.genai.Client", EmptyClient):
            with self.assertRaises(ValueError) as ctx:
                ocr_pdf_bytes(pdf_data, "168-nd-cp.signed.pdf")
        self.assertIn("Không nhận diện được chữ tiếng Việt rõ ràng", str(ctx.exception))

    def test_ocr_transient_server_error_backoff_and_background_job_auto_ingest(self):
        """AI OCR tự phục hồi sau lỗi ServerError tạm thời mà không xé lẻ lô và hỗ trợ chạy ngầm tự động lập chỉ mục."""
        import asyncio
        import time as time_mod
        from fastapi import UploadFile
        import api_server as api

        scanned_pdf = PdfWriter()
        for _ in range(2):
            scanned_pdf.add_blank_page(width=595, height=842)
        buf = io.BytesIO()
        scanned_pdf.write(buf)
        pdf_data = buf.getvalue()

        call_sizes: list[int] = []

        class TransientServerError(Exception):
            pass

        class FlakyModels:
            def __init__(self):
                self.calls = 0

            def generate_content(self, **_kwargs):
                self.calls += 1
                contents = _kwargs.get("contents") or []
                media_parts = [p for p in contents if not isinstance(p, str)]
                call_sizes.append(len(media_parts))
                if self.calls == 1:
                    raise TransientServerError("503 Model is overloaded")
                filler = ("Quy định chi tiết về trình tự xử phạt và thẩm quyền áp dụng trên toàn quốc. " * 20).strip()
                return types.SimpleNamespace(
                    text=(
                        "CHÍNH PHỦ\nSố: 168/2024/NĐ-CP\nHà Nội, ngày 26 tháng 12 năm 2024\n"
                        "NGHỊ ĐỊNH\nQuy định xử phạt vi phạm hành chính về trật tự, an toàn giao thông đường bộ\n"
                        "Chương I\nNHỮNG QUY ĐỊNH CHUNG\n"
                        "Điều 1. Phạm vi điều chỉnh\n"
                        f"1. Nghị định này quy định chi tiết xử phạt vi phạm hành chính trong lĩnh vực giao thông đường bộ. {filler}\n"
                        "Điều 2. Đối tượng áp dụng\n"
                        f"1. Tổ chức và cá nhân tham gia giao thông đường bộ trên lãnh thổ Việt Nam. {filler}"
                    ),
                    candidates=[],
                )

        class FlakyClient:
            def __init__(self, **_kwargs):
                self.models = FlakyModels()

        with patch.object(api.bot, "collection", self.collection), patch.dict(
            "os.environ",
            {
                "AI_CORE_INTERNAL_TOKEN": "test-internal-token",
                "GEMINI_API_KEY": "fake-key-for-unit-test",
                "GEMINI_MODEL": "gemini-2.5-flash-lite",
                "OCR_RETRY_BASE_DELAY": "0.01",
            },
        ), patch("google.genai.Client", FlakyClient):
            upload = UploadFile(filename="168-nd-cp.signed.pdf", file=io.BytesIO(pdf_data))
            created = asyncio.run(
                api.create_ocr_background_job(
                    file=upload,
                    auto_ingest=True,
                    metadata="",
                    source_url="",
                    scope="public",
                )
            )
            job_id = created["job_id"]
            self.assertEqual(created["total_pages"], 2)

            final_snapshot = None
            for _ in range(80):
                snap = api.get_ocr_background_job(job_id, include_text=True)
                if snap["status"] in ("completed", "needs_review", "failed"):
                    final_snapshot = snap
                    break
                time_mod.sleep(0.05)

            self.assertIsNotNone(final_snapshot)
            assert final_snapshot is not None
            self.assertEqual(final_snapshot["status"], "completed")
            self.assertEqual(final_snapshot["percent"], 100)
            # Lần 1 gặp lỗi 503 tạm thời, lần 2 retry thành công trên nguyên lô 2 trang mà không phải xé lẻ
            self.assertEqual(call_sizes, [2, 2])
            ingest_res = final_snapshot["ingest_result"]
            self.assertIsNotNone(ingest_res)
            self.assertEqual(ingest_res["status"], "indexed")
            self.assertEqual(ingest_res["article_count"], 2)
            self.assertEqual(ingest_res["document_type"], "decree")


if __name__ == "__main__":
    unittest.main()
