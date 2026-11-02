"""Kiểm tra danh mục tài liệu không có Điều luật gốc."""

import importlib
import sys
import types
import unittest
from unittest.mock import patch


class SummaryCollection:
    """Kho giả lập chỉ trả metadata và nội dung cần cho danh mục."""

    def __init__(self, ids, metadatas, documents):
        self.data = {"ids": ids, "metadatas": metadatas, "documents": documents}

    def get(self, **_kwargs):
        return self.data


class DocumentsSummaryTest(unittest.TestCase):
    def test_outline_uses_semantic_metadata_without_article_number(self):
        fake_rag = types.ModuleType("rag_pipeline")
        fake_rag.AIServiceError = type("FakeAIServiceError", (Exception,), {})
        fake_rag.LegalRAG = lambda: types.SimpleNamespace(collection=None)
        with patch.dict(sys.modules, {"rag_pipeline": fake_rag}):
            api = importlib.import_module("api_server")
        collection = SummaryCollection(
            ["topic:0", "topic:1"],
            [
                {"doc_id": "topic", "doc_number": "CD-01", "doc_title": "Chuyên đề 1: Kinh tế",
                 "chapter": "Phần I. Tổng quan", "section": "Mục 1. Khái niệm",
                 "structure_status": "mixed_reference_document", "coverage": 1.0},
                {"doc_id": "topic", "doc_number": "CD-01", "doc_title": "Chuyên đề 1: Kinh tế",
                 "chapter": "Phần II. Tình huống", "section": "Mục 2. Bài tập",
                 "structure_status": "mixed_reference_document", "coverage": 1.0},
            ],
            ["[Chuyên đề CD-01]\nNội dung một", "[Chuyên đề CD-01]\nNội dung hai"],
        )
        with patch.object(api.bot, "collection", collection):
            document = api.get_documents()[0]
        self.assertEqual(document["articleCount"], 0)
        self.assertEqual(document["chunkCount"], 2)
        self.assertEqual([chapter["title"] for chapter in document["chapters"]],
                         ["Phần I. Tổng quan", "Phần II. Tình huống"])
        self.assertEqual(document["chapters"][0]["sections"], ["Mục 1. Khái niệm"])
        self.assertEqual(document["coverage"], 1.0)

    def test_legacy_topic_has_readable_number_and_inferred_parts(self):
        fake_rag = types.ModuleType("rag_pipeline")
        fake_rag.AIServiceError = type("FakeAIServiceError", (Exception,), {})
        fake_rag.LegalRAG = lambda: types.SimpleNamespace(collection=None)
        with patch.dict(sys.modules, {"rag_pipeline": fake_rag}):
            api = importlib.import_module("api_server")
        collection = SummaryCollection(
            ["topic:0", "topic:1"],
            [{"doc_id": "topic", "doc_number": "CHUA-XAC-DINH-137330ec57a1",
              "doc_title": "Chuyên đề 1: Pháp luật về kinh tế"}] * 2,
            ["[Chuyên đề]\nPhần I. Tổng quan\n\nMục 1. Khái niệm",
             "[Chuyên đề]\nPhần II. Doanh nghiệp\n\nMục 2. Tổ chức"],
        )
        with patch.object(api.bot, "collection", collection):
            document = api.get_documents()[0]
        self.assertEqual(document["docNumber"], "CD-01")
        self.assertEqual([chapter["title"] for chapter in document["chapters"]], ["Phần I", "Phần II"])

    def test_get_document_chunks_returns_ordered_clean_content(self):
        """API chi tiết phân đoạn trả đúng thứ tự chunk và lược bỏ dòng nhãn bao cảnh đầu đoạn."""
        fake_rag = types.ModuleType("rag_pipeline")
        fake_rag.AIServiceError = type("FakeAIServiceError", (Exception,), {})
        fake_rag.LegalRAG = lambda: types.SimpleNamespace(collection=None)
        with patch.dict(sys.modules, {"rag_pipeline": fake_rag}):
            api = importlib.import_module("api_server")
        collection = SummaryCollection(
            ["doc-168:2", "doc-168:0", "doc-168:1"],
            [
                {"doc_id": "doc-168", "unit_type": "article", "chapter": "Chương I", "article_number": "2", "article_title": "Đối tượng áp dụng"},
                {"doc_id": "doc-168", "unit_type": "clause", "chapter": "Chương I", "article_number": "1", "article_title": "Phạm vi điều chỉnh", "clause_number": "1"},
                {"doc_id": "doc-168", "unit_type": "clause", "chapter": "Chương I", "article_number": "1", "article_title": "Phạm vi điều chỉnh", "clause_number": "2"},
            ],
            [
                "[Nghị định 168/2024/NĐ-CP]\nĐiều 2. Đối tượng áp dụng\nÁp dụng cho tổ chức, cá nhân.",
                "[Nghị định 168/2024/NĐ-CP]\nKhoản 1 Điều 1. Nội dung khoản 1.",
                "[Nghị định 168/2024/NĐ-CP]\nKhoản 2 Điều 1. Nội dung khoản 2.",
            ],
        )
        with patch.object(api.bot, "collection", collection):
            payload = api.get_document_chunks("doc-168", limit=10)
        self.assertEqual(payload["docId"], "doc-168")
        self.assertEqual(payload["total"], 3)
        self.assertEqual([item["chunkId"] for item in payload["chunks"]], ["doc-168:0", "doc-168:1", "doc-168:2"])
        self.assertEqual(payload["chunks"][0]["content"], "Khoản 1 Điều 1. Nội dung khoản 1.")
        self.assertEqual(payload["chunks"][2]["articleNumber"], "2")


if __name__ == "__main__":
    unittest.main()
