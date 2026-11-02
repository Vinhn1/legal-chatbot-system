"""Kiểm thử hồi quy T05: một căn cứ lỗi phải chặn toàn bộ lập luận của mô hình."""

import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from legal.citations import parse_answer
from legal.prompts import REFUSAL
from legal.retrieval import RetrievedChunk
from rag_pipeline import LegalRAG


class CitationIntegrityTest(unittest.TestCase):
    """Dùng nguồn và mô hình giả lập, không truy cập dữ liệu hay dịch vụ thật."""

    def setUp(self):
        """Tạo đúng một nguồn được phép và một citation hợp lệ để phối hợp ca lỗi."""
        self.citation = {
            "chunk_id": "public-1", "doc_number": "01/2026/TEST", "article": "Điều 1",
            "clause": "Khoản 1", "snippet": "Nội dung giả lập được phép.",
            "source_url": "https://example.org/law",
        }
        self.rag = LegalRAG.__new__(LegalRAG)
        self.rag.collection = SimpleNamespace(count=lambda: 1)
        self.rag.retriever = Mock()
        self.rag.retriever.search.return_value = [RetrievedChunk(
            "public-1", self.citation["snippet"], {
                "doc_number": self.citation["doc_number"], "article_number": "1",
                "clause_number": "1", "source_url": self.citation["source_url"],
            }, 1.0, "active",
        )]

    def answer(self, citations):
        """Giả lập phản hồi mô hình chứa lập luận cố định để phát hiện nội dung lọt ra."""
        response = json.dumps({"answer": "Lập luận dựa trên toàn bộ căn cứ.", "citations": citations})
        client = SimpleNamespace(models=SimpleNamespace(
            generate_content=Mock(return_value=SimpleNamespace(text=response)),
        ))
        with patch.dict("os.environ", {"GEMINI_API_KEY": "gia-lap"}), \
             patch("rag_pipeline.genai", SimpleNamespace(Client=lambda **kwargs: client)), \
             patch("rag_pipeline.genai_types", SimpleNamespace(GenerateContentConfig=lambda **kwargs: kwargs)):
            self.rag._genai_client = None
            return self.rag.answer_question("Điều 1 quy định gì?")

    def test_all_valid_citations_keep_answer(self):
        """Căn cứ hợp lệ vẫn phát hành câu trả lời và nguồn để đối chiếu."""
        result = self.answer([self.citation])
        self.assertEqual(result[0], "Lập luận dựa trên toàn bộ căn cứ.")
        self.assertEqual(result.citations, [self.citation])
        self.assertEqual(len(result[1]), 1)

    def test_mixed_schema_errors_refuse_before_deduplication(self):
        """Citation sai schema không được biến mất trong bước chuẩn hóa hoặc khử trùng."""
        malformed = [None, "sai schema", {}, {**self.citation, "article": 1},
                     {**self.citation, "snippet": ""}, {**self.citation, "snippet": None}]
        for invalid in malformed:
            for citations in ([self.citation, invalid], [invalid, self.citation]):
                with self.subTest(invalid=invalid, valid_first=citations[0] == self.citation):
                    raw = json.dumps({"answer": "Lập luận không được phát hành.", "citations": citations})
                    self.assertEqual(parse_answer(raw), (REFUSAL, []))
                    result = self.answer(citations)
                    self.assertEqual((result[0], result.citations, result[1]), (REFUSAL, [], []))

    def test_mixed_unverified_citations_refuse_in_both_orders(self):
        """Sai ID, snippet hoặc metadata phải chặn cả answer dù có căn cứ đúng đi kèm."""
        changes = [
            {"chunk_id": "internal-not-allowed"}, {"chunk_id": "fabricated"},
            {"snippet": "Nội dung bịa đặt."}, {"doc_number": "99/2099/FAKE"},
            {"article": "Điều 99"}, {"clause": "Khoản 99"},
            {"source_url": "https://example.org/wrong"},
        ]
        for changed in changes:
            invalid = {**self.citation, **changed}
            for citations in ([self.citation, invalid], [invalid, self.citation]):
                with self.subTest(changed=changed, valid_first=citations[0] == self.citation):
                    result = self.answer(citations)
                    self.assertEqual((result[0], result.citations, result[1]), (REFUSAL, [], []))

    def test_missing_clause_metadata_does_not_erase_unverified_claim(self):
        """Không xóa nhãn Khoản rồi giữ lại lập luận dựa trên nhãn chưa xác minh."""
        self.rag.retriever.search.return_value[0].metadata.pop("clause_number")
        result = self.answer([self.citation])
        self.assertEqual((result[0], result.citations, result[1]), (REFUSAL, [], []))

    def test_article_without_clause_is_valid_when_model_agrees(self):
        """Chunk cấp Điều vẫn hợp lệ khi mô hình không tự gán thêm Khoản."""
        self.rag.retriever.search.return_value[0].metadata.pop("clause_number")
        citation = {**self.citation, "clause": ""}
        result = self.answer([citation])
        self.assertEqual(result[0], "Lập luận dựa trên toàn bộ căn cứ.")
        self.assertEqual(result.citations, [citation])

    def test_identical_duplicates_are_safe_after_verification(self):
        """Citation trùng hoàn toàn chỉ được gộp sau khi từng bản ghi đã xác minh."""
        result = self.answer([self.citation, self.citation.copy()])
        self.assertEqual(result[0], "Lập luận dựa trên toàn bộ căn cứ.")
        self.assertEqual(result.citations, [self.citation])


if __name__ == "__main__":
    unittest.main()
