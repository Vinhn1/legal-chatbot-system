"""Kiểm tra lập chỉ mục đầy đủ tài liệu chuyên đề dài."""

import unittest

from legal.ingest import IngestDocumentMetadata, _semantic_paragraph_chunks, ingest_file


class MemoryCollection:
    """Kho thử nghiệm giữ nguyên nội dung chunk để kiểm tra độ bao phủ."""

    def __init__(self):
        self.documents = []
        self.metadatas = []

    def get(self, **_kwargs):
        return {"ids": [], "metadatas": []}

    def add(self, ids, documents, metadatas):
        self.documents.extend(documents)
        self.metadatas.extend(metadatas)


class IngestCoverageTest(unittest.TestCase):
    def test_semantic_chunks_keep_part_and_section_metadata(self):
        metadata = IngestDocumentMetadata(
            doc_number="CD-01", doc_title="Chuyên đề kinh tế", document_type="law",
            issuing_authority="Đơn vị đào tạo", issued_date="2026-01-01",
            source_url="https://example.org/topic",
        )
        text = """Lời dẫn nhập trước cấu trúc.
Phần I. Tổng quan
I. Khái niệm
Nội dung của phần một.
Đề mục số 2. Chủ thể
Nội dung đề mục hai.
Phần II. Tình huống
Mục 1. Phân tích
Nội dung phần hai."""
        chunks = list(_semantic_paragraph_chunks(text, metadata, "a" * 64, "txt"))
        self.assertEqual(chunks[0][1].get("chapter"), None)
        self.assertTrue(any(meta.get("chapter", "").startswith("Phần I") and meta.get("section", "").startswith("Đề mục số 2")
                            for _, meta in chunks))
        self.assertTrue(any(meta.get("chapter", "").startswith("Phần II") and meta.get("section", "").startswith("Mục 1")
                            for _, meta in chunks))
        self.assertFalse(any(meta.get("chapter") == "Phần I. Tổng quan" and "Nội dung phần hai" in content
                             for content, meta in chunks))

    def test_hundred_page_topic_keeps_opening_and_later_parts(self):
        metadata = IngestDocumentMetadata(
            doc_number="CHUYEN-DE-01", doc_title="Chuyên đề kinh tế", document_type="law",
            issuing_authority="Đơn vị đào tạo", issued_date="2026-01-01",
            source_url="https://example.org/topic",
        )
        pages = ["Phần I. Tổng quan", "I. Các khái niệm"]
        for index in range(1, 101):
            if index in (35, 71, 85):
                pages.append(f"Phần {['II', 'III', 'IV'][(35, 71, 85).index(index)]}. Nội dung mở rộng")
            pages.append(f"Trang {index}: Nội dung chuyên đề pháp luật kinh tế có giá trị tra cứu riêng biệt số {index}.")
        pages += ["Điều 14. Trích dẫn thứ nhất", "Nội dung pháp lý thứ nhất.",
                  "Điều 29. Trích dẫn thứ hai", "Nội dung pháp lý thứ hai."]
        collection = MemoryCollection()
        result = ingest_file("\n".join(pages).encode(), "topic.txt", metadata, collection)
        self.assertEqual(result.status, "indexed")
        self.assertEqual(result.structure_status, "mixed_reference_document")
        self.assertTrue(result.needs_review)
        self.assertGreaterEqual(result.coverage, 0.95)
        indexed = "\n".join(collection.documents)
        for index in range(1, 101):
            self.assertIn(f"Trang {index}:", indexed)
        self.assertIn("Nội dung pháp lý thứ nhất.", indexed)
        self.assertTrue(any(unit["unit_type"] == "general" for unit in result.units))


if __name__ == "__main__":
    unittest.main()
