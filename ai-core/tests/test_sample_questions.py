# Chú thích: Bộ kiểm thử đơn vị cho chức năng sinh câu hỏi mẫu từ tài liệu mới nhất
import unittest
from unittest.mock import MagicMock, patch
from legal.sample_questions import (
    DEFAULT_FALLBACK_QUESTIONS,
    extract_latest_documents,
    is_meaningful_article,
    synthesize_rule_based_questions,
    get_or_generate_sample_questions,
)


class TestSampleQuestions(unittest.TestCase):
    """Kiểm thử tính năng trích xuất tài liệu mới và sinh câu hỏi mẫu."""

    def test_is_meaningful_article(self):
        self.assertFalse(is_meaningful_article("Phạm vi điều chỉnh"))
        self.assertFalse(is_meaningful_article("Đối tượng áp dụng"))
        self.assertFalse(is_meaningful_article("Hiệu lực thi hành"))
        self.assertTrue(is_meaningful_article("Quy tắc chung"))
        self.assertTrue(is_meaningful_article("Bảo đảm trật tự an toàn giao thông"))
        self.assertTrue(is_meaningful_article("Điều kiện tách thửa đất"))

    def test_extract_latest_documents(self):
        mock_col = MagicMock()
        mock_col.get.return_value = {
            "metadatas": [
                {
                    "doc_id": "doc-1",
                    "doc_number": "01/2026/NĐ-CP",
                    "doc_title": "Nghị định mới",
                    "indexed_at": "2026-11-01",
                    "article_number": "1",
                    "article_title": "Phạm vi điều chỉnh",
                },
                {
                    "doc_id": "doc-1",
                    "doc_number": "01/2026/NĐ-CP",
                    "doc_title": "Nghị định mới",
                    "indexed_at": "2026-11-01",
                    "article_number": "2",
                    "article_title": "Xử phạt vi phạm",
                },
                {
                    "doc_id": "doc-2",
                    "doc_number": "02/2026/QH15",
                    "doc_title": "Luật mới nhất",
                    "indexed_at": "2026-11-02",
                    "article_number": "9",
                    "article_title": "Quy tắc an toàn",
                },
            ]
        }
        latest = extract_latest_documents(mock_col, limit=2)
        self.assertEqual(len(latest), 2)
        # Tài liệu có indexed_at mới nhất (2026-11-02) phải đứng đầu
        self.assertEqual(latest[0]["doc_number"], "02/2026/QH15")
        self.assertEqual(latest[1]["doc_number"], "01/2026/NĐ-CP")

    def test_synthesize_rule_based_questions(self):
        docs = [
            {
                "doc_number": "36/2024/QH15",
                "title": "Luật Trật tự an toàn giao thông đường bộ",
                "articles": {
                    "1": "Phạm vi điều chỉnh",
                    "9": "Quy tắc an toàn đường bộ",
                },
            },
            {
                "doc_number": "168/2024/NĐ-CP",
                "title": "Nghị định xử phạt vi phạm hành chính",
                "articles": {
                    "1": "Phạm vi điều chỉnh",
                    "5": "Xử phạt người điều khiển xe ô tô",
                },
            },
        ]
        questions = synthesize_rule_based_questions(docs)
        self.assertGreaterEqual(len(questions), 2)
        for q in questions:
            self.assertTrue(q.endswith("?"))
            # Không được chọn Điều 1 phạm vi điều chỉnh
            self.assertNotIn("phạm vi điều chỉnh", q.lower())

    def test_get_or_generate_sample_questions_empty_collection(self):
        mock_col = MagicMock()
        mock_col.get.return_value = {"metadatas": []}
        questions = get_or_generate_sample_questions(mock_col)
        self.assertEqual(questions, DEFAULT_FALLBACK_QUESTIONS)


if __name__ == "__main__":
    unittest.main()
