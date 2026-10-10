import tempfile
import unittest

from rag_pipeline import LegalRAG


class NeutralBaselineTest(unittest.TestCase):
    def test_empty_legal_collection_never_uses_legacy_collections(self):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
            rag = LegalRAG(db_path=directory)
            self.assertEqual([item.name for item in rag.chroma_client.list_collections()], ["legal_documents"])
            answer, sources, suggestions, images = rag.answer_question("Điều 1 quy định gì?")
            self.assertIn("Chưa tìm thấy căn cứ pháp lý", answer)
            self.assertEqual(sources, [])
            self.assertEqual(suggestions, [])
            self.assertEqual(images, [])


if __name__ == "__main__":
    unittest.main()
