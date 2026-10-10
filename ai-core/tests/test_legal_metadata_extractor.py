"""Unit test kiểm thử module tự động bóc tách metadata văn bản pháp luật."""

import unittest
from datetime import date
from unittest.mock import patch

from legal.metadata_extractor import auto_extract_metadata, extract_metadata_heuristic, _format_date


class TestMetadataExtractor(unittest.TestCase):
    def test_format_date_valid(self):
        self.assertEqual(_format_date("18", "01", "2024"), "2024-01-18")
        self.assertEqual(_format_date("5", "9", "2023"), "2023-09-05")

    def test_format_date_invalid(self):
        self.assertIsNone(_format_date("32", "01", "2024"))
        self.assertIsNone(_format_date("abc", "01", "2024"))

    def test_extract_heuristic_law(self):
        sample_text = """
QUỐC HỘI
Số: 31/2024/QH15

CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
Độc lập - Tự do - Hạnh phúc
---------------
Hà Nội, ngày 18 tháng 01 năm 2024

LUẬT
ĐẤT ĐAI

Căn cứ Hiến pháp nước Cộng hòa xã hội chủ nghĩa Việt Nam;
Quốc hội ban hành Luật Đất đai.

Chương I
QUY ĐỊNH CHUNG

Điều 1. Phạm vi điều chỉnh
Luật này quy định về chế độ sở hữu đất đai...

Chương XVI
ĐIỀU KHOẢN THI HÀNH

Điều 260. Hiệu lực thi hành
1. Luật này có hiệu lực thi hành từ ngày 01 tháng 01 năm 2025.
"""
        res = extract_metadata_heuristic(sample_text, "31_2024_QH15.txt")
        self.assertEqual(res["issuing_authority"], "Quốc hội")
        self.assertEqual(res["doc_number"], "31/2024/QH15")
        self.assertEqual(res["document_type"], "law")
        self.assertIn("Đất Đai", res["doc_title"])
        self.assertEqual(res["issued_date"], "2024-01-18")
        self.assertEqual(res["effective_date"], "2025-01-01")
        self.assertEqual(res["confidence"], "high")

    def test_extract_heuristic_decree(self):
        sample_text = """
CHÍNH PHỦ
Số: 102/2024/NĐ-CP

CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
Độc lập - Tự do - Hạnh phúc
---------------
Hà Nội, ngày 30 tháng 07 năm 2024

NGHỊ ĐỊNH
Quy định chi tiết thi hành một số điều của Luật Đất đai

Căn cứ Luật Tổ chức Chính phủ ngày 19 tháng 6 năm 2015;
Theo đề nghị của Bộ trưởng Bộ Tài nguyên và Môi trường;
Chính phủ ban hành Nghị định quy định chi tiết thi hành một số điều của Luật Đất đai.

Chương I
QUY ĐỊNH CHUNG
"""
        res = extract_metadata_heuristic(sample_text, "102_2024_ND-CP.docx")
        self.assertEqual(res["issuing_authority"], "Chính phủ")
        self.assertEqual(res["doc_number"], "102/2024/NĐ-CP")
        self.assertEqual(res["document_type"], "decree")
        self.assertIn("Quy định chi tiết", res["doc_title"])
        self.assertEqual(res["issued_date"], "2024-07-30")
        self.assertEqual(res["confidence"], "high")

    def test_llm_translation_does_not_replace_vietnamese_names(self):
        """Bản dịch tiếng Anh không được ghi đè tên và cơ quan đã có tiếng Việt."""
        heuristic = {
            "doc_number": "", "doc_title": "Bộ luật Lao động", "document_type": "law",
            "issuing_authority": "Quốc hội", "issued_date": "2019-11-20",
            "effective_status": "unknown", "scope": "public", "confidence": "medium",
        }
        translated = {"doc_title": "Labor Code", "issuing_authority": "National Assembly"}
        with patch("legal.metadata_extractor.extract_metadata_heuristic", return_value=heuristic):
            with patch("legal.metadata_extractor.extract_metadata_llm", return_value=translated):
                result = auto_extract_metadata("QUỐC HỘI\nBỘ LUẬT LAO ĐỘNG".encode("utf-8"), "web_document.txt")
        self.assertEqual(result["doc_title"], "Bộ luật Lao động")
        self.assertEqual(result["issuing_authority"], "Quốc hội")


if __name__ == "__main__":
    unittest.main()
