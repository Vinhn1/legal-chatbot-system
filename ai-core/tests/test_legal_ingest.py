import asyncio
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

from legal.ingest import IngestDocumentMetadata, extract_text, ingest_file
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
        self.assertEqual(result.chunk_count, 5)
        self.assertEqual(self.collection.count(), 5)
        stored = self.collection.get(include=["documents", "metadatas"])
        pairs = list(zip(stored["documents"], stored["metadatas"]))
        for content, metadata in pairs:
            self.assertIn("[Luật mẫu về dữ liệu pháp luật 01/2026/QH]", content)
            self.assertIn("[Chương I. QUY ĐỊNH CHUNG]", content)
            self.assertIn("[Mục 1. Phạm vi và nguyên tắc]", content)
            self.assertIn("[Điều ", content)
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
        self.assertEqual(self.collection.count(), 5)

    def test_unstructured_text_requires_approval_and_unreadable_scan_stays_blocked(self):
        """Văn bản thiếu Điều chờ xác nhận; nội dung OCR hỏng không được cưỡng bức nạp."""
        unstructured = (FIXTURES / "unstructured_sample.txt").read_bytes()
        pending = ingest_file(unstructured, "unstructured_sample.txt", self.metadata, self.collection)
        self.assertEqual(pending.status, "needs_review")
        self.assertEqual(pending.chunk_count, 0)
        self.assertTrue(pending.raw_text_preview)
        self.assertEqual(self.collection.count(), 0)
        indexed = ingest_file(unstructured, "unstructured_sample.txt", self.metadata, self.collection, force_paragraph=True)
        self.assertEqual(indexed.status, "indexed")
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
            self.assertEqual(response["chunk_count"], 5)
            self.assertEqual(api.get_documents()[0]["source_type"], "txt")

            # Endpoint chỉ ghi vector cho bản thiếu cấu trúc sau lần gửi xác nhận thứ hai.
            unstructured = (FIXTURES / "unstructured_sample.txt").read_bytes()
            review_payload = self.metadata.model_copy(update={"doc_id": uuid4()}).model_dump_json()
            pending_upload = UploadFile(filename="unstructured_sample.txt", file=io.BytesIO(unstructured))
            pending = asyncio.run(api.ingest_legal_document(pending_upload, review_payload))
            self.assertEqual(pending["status"], "needs_review")
            approved_upload = UploadFile(filename="unstructured_sample.txt", file=io.BytesIO(unstructured))
            approved = asyncio.run(api.ingest_legal_document(approved_upload, review_payload, force_paragraph=True))
            self.assertEqual(approved["status"], "indexed")
            self.assertEqual(approved["structure_status"], "unstructured_fallback")


if __name__ == "__main__":
    unittest.main()
