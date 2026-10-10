import importlib
import asyncio
import io
import unittest
from unittest.mock import Mock, patch
from types import SimpleNamespace

from fastapi import HTTPException, UploadFile


class ApiBaselineTest(unittest.TestCase):
    def test_public_summary_excludes_internal_rows(self):
        """Không tiết lộ số lượng hoặc tên văn bản internal qua endpoint công khai."""
        with patch("rag_pipeline.LegalRAG"):
            api = importlib.import_module("api_server")
        rows = [
            {"doc_id": "public-1", "doc_number": "01/QH", "doc_title": "Luật công khai", "article_number": "1", "scope": "public", "indexed_at": "2026-09-29"},
            {"doc_id": "public-1", "doc_number": "01/QH", "doc_title": "Luật công khai", "article_number": "2", "scope": "public", "indexed_at": "2026-09-29"},
            {"doc_id": "secret-1", "doc_title": "Tài liệu nội bộ", "article_number": "1", "scope": "internal"},
        ]
        get = Mock(return_value={"metadatas": rows})
        collection = SimpleNamespace(get=get)
        summary = api.summarize_public_collection(collection)
        get.assert_called_once_with(where={"scope": "public"}, include=["metadatas"])
        self.assertEqual(summary["document_count"], 1)
        self.assertEqual(summary["article_count"], 2)
        self.assertEqual(summary["last_updated"], "2026-09-29")
        self.assertEqual(summary["documents"], [{"title": "Luật công khai", "doc_number": "01/QH"}])

    def test_empty_kb_and_legacy_routes(self):
        with patch("rag_pipeline.LegalRAG") as rag_class:
            rag_class.return_value.collection.count.return_value = 0
            rag_class.return_value.answer_question.return_value = (
                "Chưa có văn bản pháp luật nào trong kho dữ liệu hiện tại.", [], [], [],
            )
            api = importlib.import_module("api_server")
        # Module API có thể đã được import bởi test khác; cô lập bot cho từng kiểm thử.
        with patch.object(api, "bot", rag_class.return_value):
            self.assertEqual(api.health_check(), {"status": "ok", "knowledge_count": 0})
            result = api.chat(api.ChatRequest(message="Điều 1 quy định gì?"))
            self.assertEqual(result.sources, [])
            # Route cũ vẫn từ chối nạp sau khi kiểm tra tệp hợp lệ.
            with self.assertRaises(HTTPException) as error:
                asyncio.run(api.upload_document(UploadFile(filename="law.txt", file=io.BytesIO(b"Dieu 1. Noi dung"))))
            self.assertEqual(error.exception.status_code, 501)
            paths = {route.path for route in api.app.routes}
            self.assertNotIn("/chat-mining/parse-text", paths)


if __name__ == "__main__":
    unittest.main()
