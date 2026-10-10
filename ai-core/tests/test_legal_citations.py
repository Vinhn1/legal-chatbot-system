"""Kiểm thử bóc tách câu trả lời và căn cứ pháp lý có cấu trúc."""

import json
import asyncio
import importlib
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from fastapi import HTTPException

from legal.citations import extract_json, normalize_citations, parse_answer
from legal.prompts import REFUSAL
from legal.retrieval import RetrievedChunk
from rag_pipeline import LegalRAG


class LegalCitationsTest(unittest.TestCase):
    """Xác nhận JSON và citation lỗi luôn dẫn đến từ chối an toàn."""

    def setUp(self):
        """Tạo trích dẫn mẫu không chứa dữ liệu người dùng."""
        self.citation = {
            "chunk_id": "doc-1:0", "doc_number": "45/2019/QH14", "article": "Điều 35",
            "clause": "Khoản 1", "snippet": "Nội dung gốc", "source_url": "https://example.org/law",
        }

    def test_extract_json_from_fence_and_surrounding_text(self):
        """Bỏ markdown fence và ký tự ngoài JSON mà không thực thi nội dung."""
        raw = "Lời dẫn\n```json\n" + json.dumps({"answer": "Theo luật", "citations": [self.citation]}, ensure_ascii=False) + "\n```\nKết thúc"
        self.assertEqual(extract_json(raw)["answer"], "Theo luật")
        self.assertEqual(parse_answer(raw)[1], [self.citation])

    def test_invalid_citations_are_removed(self):
        """Bỏ bản ghi thiếu định danh, sai kiểu và ID lặp."""
        invalid = [{**self.citation, "chunk_id": ""}, {**self.citation, "article": 35}, self.citation, self.citation]
        self.assertEqual(normalize_citations(invalid), [self.citation])
        self.assertEqual(parse_answer('{"answer":"Tự suy diễn","citations":[{}]}'), (REFUSAL, []))
        self.assertEqual(parse_answer("không phải JSON"), (REFUSAL, []))

    def test_empty_context_refuses_without_model(self):
        """Kho rỗng và truy xuất rỗng đều không gọi mô hình."""
        rag = LegalRAG.__new__(LegalRAG)
        rag.collection = SimpleNamespace(count=lambda: 0)
        rag.retriever = Mock()
        result = rag.answer_question("Quy định gì?")
        self.assertEqual(result[0], REFUSAL)
        self.assertEqual(result.citations, [])
        rag.collection = SimpleNamespace(count=lambda: 1)
        rag.retriever.search.return_value = []
        self.assertEqual(rag.answer_question("Quy định gì?").citations, [])

    def test_pipeline_exposes_only_retrieved_ids(self):
        """Không nhận ID trích dẫn nằm ngoài tập chunk đã truy xuất."""
        rag = LegalRAG.__new__(LegalRAG)
        rag.collection = SimpleNamespace(count=lambda: 1)
        rag.retriever = Mock()
        rag.retriever.search.return_value = [RetrievedChunk(
            "doc-1:0", "Nội dung gốc", {"doc_number": "45/2019/QH14", "doc_title": "Luật mẫu",
            "article_number": "35", "clause_number": "1", "source_url": "https://example.org/law"}, 1.0, "active")]
        response = json.dumps({"answer": "Theo luật mẫu", "citations": [self.citation, {**self.citation, "chunk_id": "fake"}]}, ensure_ascii=False)
        fake_client = SimpleNamespace(models=SimpleNamespace(generate_content=lambda **kwargs: SimpleNamespace(text=response)))
        client_factory = Mock(return_value=fake_client)
        with patch.dict("os.environ", {"GEMINI_API_KEY": "gia-lap"}), \
             patch("rag_pipeline.genai", SimpleNamespace(Client=client_factory)), \
             patch("rag_pipeline.genai_types", SimpleNamespace(GenerateContentConfig=lambda **kwargs: kwargs)):
            result = rag.answer_question("Điều 35 quy định gì?")
            # Lượt hỏi kế tiếp phải dùng cùng client còn mở.
            repeated = rag.answer_question("Điều 35 quy định gì?")
        self.assertEqual(result.citations, [self.citation])
        self.assertEqual(result[0], "Theo luật mẫu")
        self.assertEqual(repeated.citations, [self.citation])
        client_factory.assert_called_once_with(api_key="gia-lap")
        self.assertIs(rag._genai_client, fake_client)

    def test_pipeline_removes_unstored_clause_from_citation(self):
        """Khoản do mô hình tự thêm không được vượt qua metadata của chunk đã lưu."""
        rag = LegalRAG.__new__(LegalRAG)
        rag.collection = SimpleNamespace(count=lambda: 1)
        rag.retriever = Mock()
        rag.retriever.search.return_value = [RetrievedChunk(
            "doc-1:0", "Độ tuổi lao động tối thiểu là đủ 15 tuổi.",
            {"doc_number": "45/2019/QH14", "article_number": "3", "source_url": "https://example.org/law"},
            1.0, "active")]
        citation = {"chunk_id": "doc-1:0", "doc_number": "45/2019/QH14", "article": "Điều 3",
                    "clause": "Khoản 1", "snippet": "Độ tuổi lao động tối thiểu là đủ 15 tuổi.",
                    "source_url": "https://example.org/law"}
        response = json.dumps({"answer": "Độ tuổi tối thiểu là 15 tuổi.", "citations": [citation]}, ensure_ascii=False)
        fake_client = SimpleNamespace(models=SimpleNamespace(generate_content=lambda **kwargs: SimpleNamespace(text=response)))
        with patch.dict("os.environ", {"GEMINI_API_KEY": "gia-lap"}), \
             patch("rag_pipeline.genai", SimpleNamespace(Client=lambda **kwargs: fake_client)), \
             patch("rag_pipeline.genai_types", SimpleNamespace(GenerateContentConfig=lambda **kwargs: kwargs)):
            result = rag.answer_question("Độ tuổi lao động tối thiểu là bao nhiêu?")
            # Sai số hiệu, Điều hoặc URL vẫn phải bị từ chối dù chunk_id có thật.
            for changed in ({"doc_number": "sai"}, {"article": "Điều 99"}, {"source_url": "https://example.org/sai"}):
                response = json.dumps({"answer": "Độ tuổi tối thiểu là 15 tuổi.",
                                       "citations": [{**citation, **changed}]}, ensure_ascii=False)
                self.assertEqual(rag.answer_question("Độ tuổi lao động tối thiểu là bao nhiêu?")[0], REFUSAL)
        self.assertEqual(result.citations[0]["clause"], "")
        self.assertEqual(result.citations[0]["article"], "Điều 3")

    def test_verify_endpoint_requires_token_and_reads_public_chunk(self):
        """Endpoint xác thực đọc lại Chroma và không lộ tài liệu nội bộ."""
        with patch("rag_pipeline.LegalRAG"):
            api = importlib.import_module("api_server")
        api.bot.collection = Mock()
        api.bot.collection.get.return_value = {
            "ids": ["doc-1:0", "secret:0"], "documents": ["Nội dung gốc", "Nội bộ"],
            "metadatas": [
                {"scope": "public", "doc_number": "45/2019/QH14", "article_number": "35"},
                {"scope": "internal", "doc_number": "Bí mật"},
            ],
        }
        request = api.VerifyCitationsRequest(chunk_ids=["doc-1:0", "secret:0"])
        with patch.dict("os.environ", {"AI_CORE_INTERNAL_TOKEN": "gia-lap-noi-bo"}):
            with self.assertRaises(HTTPException) as error:
                asyncio.run(api.verify_citations(request, "sai-token"))
            self.assertEqual(error.exception.status_code, 401)
            result = asyncio.run(api.verify_citations(request, "gia-lap-noi-bo"))
        self.assertEqual([item["chunk_id"] for item in result["sources"]], ["doc-1:0"])
        api.bot.collection.get.assert_called_once_with(ids=["doc-1:0", "secret:0"], include=["documents", "metadatas"])


if __name__ == "__main__":
    unittest.main()
