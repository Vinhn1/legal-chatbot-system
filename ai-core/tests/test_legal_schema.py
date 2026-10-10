import unittest
from uuid import uuid4

from pydantic import ValidationError

from legal.schema import LegalChunkMetadata


class LegalSchemaTest(unittest.TestCase):
    def setUp(self):
        self.metadata = {
            "doc_id": str(uuid4()),
            "doc_number": "01/2026/QH",
            "doc_title": "Luật mẫu",
            "article_number": "1",
            "clause_number": "2",
            "source_url": "https://example.org/law",
        }

    def test_chroma_metadata_contains_only_supported_values(self):
        metadata = LegalChunkMetadata(**self.metadata)
        values = metadata.to_chroma_metadata()
        self.assertEqual(values["effective_status"], "unknown")
        self.assertEqual(values["scope"], "internal")
        self.assertEqual(values["article_number"], "1")
        self.assertNotIn("chapter", values)
        self.assertTrue(all(type(value) in (str, int, float, bool) for value in values.values()))

    def test_rejects_unverified_status_and_invalid_dates(self):
        for overrides in (
            {"effective_status": "valid"},
            {"scope": "restricted"},
            {"doc_number": " "},
            {"doc_id": "not-a-uuid"},
            {"effective_date": "2026-03-01", "expiry_date": "2026-02-01"},
        ):
            with self.subTest(overrides=overrides), self.assertRaises(ValidationError):
                LegalChunkMetadata(**{**self.metadata, **overrides})


if __name__ == "__main__":
    unittest.main()
