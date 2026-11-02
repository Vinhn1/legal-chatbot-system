"""Kiểm tra phân tích tài liệu chuyên đề và văn bản quy phạm."""

import unittest
from unittest.mock import patch

from legal.parser import (
    extract_text_references,
    parse_fine_grained_unit_refs,
    parse_legal_text,
    repair_vietnamese_pdf_spacing,
)
from legal.metadata_extractor import auto_extract_metadata, extract_metadata_heuristic, readable_document_number


class ParserCoverageTest(unittest.TestCase):
    def test_part_subsection_and_intro_are_preserved(self):
        text = """CHUYÊN ĐỀ PHÁP LUẬT KINH TẾ
Phần I. Tổng quan
I. Khái niệm
Nội dung dẫn nhập quan trọng.
Theo Điều 14 của Luật Doanh nghiệp, chủ thể có quyền kinh doanh.
Điều 14: Luật Doanh nghiệp quy định quyền của chủ thể.
Chương V. của Luật doanh nghiệp năm 2020.
Phần III. Tình huống
Điều 14. Điều khoản được trích dẫn
Nội dung trích dẫn thứ nhất.
Điều 29. Điều khoản khác
Nội dung trích dẫn thứ hai.
"""
        result = parse_legal_text(text)
        self.assertEqual([item.number for item in result.articles], ["14", "29"])
        self.assertEqual(result.structure_status, "mixed_reference_document")
        self.assertTrue(result.needs_review)
        self.assertIn("Nội dung dẫn nhập quan trọng.", result.general_lines)
        self.assertIn("Điều 14: Luật Doanh nghiệp quy định quyền của chủ thể.", result.general_lines)
        self.assertIn("Chương V. của Luật doanh nghiệp năm 2020.", result.general_lines)
        self.assertIsNone(result.articles[0].chapter)
        self.assertEqual(set(line.strip() for line in text.splitlines() if line.strip()),
                         set(result.general_lines + result.article_lines))
        self.assertIn("part", [unit["unit_type"] for unit in result.units])
        self.assertIn("subsection", [unit["unit_type"] for unit in result.units])

    def test_cited_document_number_is_not_document_identity(self):
        text = """CHUYÊN ĐỀ VỀ KINH TẾ
Nghiên cứu này trích dẫn số 03/2022/QH15 trong phần tổng quan.
Phần I. Nội dung nghiên cứu
"""
        self.assertEqual(extract_metadata_heuristic(text)["doc_number"], "")
        official = "Số: 03/2022/QH15\nLUẬT DOANH NGHIỆP\n"
        self.assertEqual(extract_metadata_heuristic(official)["doc_number"], "03/2022/QH15")
        with patch("legal.metadata_extractor.extract_metadata_llm", return_value={"doc_number": "03/2022/QH15"}):
            self.assertEqual(auto_extract_metadata(text.encode(), "topic.txt")["doc_number"], "CD-TOPIC")
        numbered = "Chuyên đề 1: Pháp luật về kinh tế\nNội dung tham khảo."
        with patch("legal.metadata_extractor.extract_metadata_llm", return_value={}):
            self.assertEqual(auto_extract_metadata(numbered.encode(), "topic.txt")["doc_number"], "CD-01")
        self.assertEqual(readable_document_number("Nội dung dẫn nhập", "document.pdf", "Chuyên đề 1: Kinh tế"), "CD-01")

    def test_roman_numbered_section_is_preserved(self):
        result = parse_legal_text("Phần I. Tổng quan\nMục II. Nội dung\nĐoạn giải thích chung.")
        self.assertIn("section", [unit["unit_type"] for unit in result.units])
        self.assertIn("Đoạn giải thích chung.", result.general_lines)

    def test_decision_with_attached_regulation_and_two_line_chapter_is_structured(self):
        text = """QUYẾT ĐỊNH
Quy định về điều kiện tách thửa đất
Điều 1. Ban hành kèm theo Quyết định này Quy định về điều kiện tách thửa đất.
Điều 2. Điều khoản thi hành
1. Quyết định này có hiệu lực thi hành từ ngày ký.
Chương I
QUY ĐỊNH CHUNG
Điều 1. Phạm vi điều chỉnh
1. Quy định này áp dụng trên địa bàn tỉnh.
Điều 2. Đối tượng áp dụng
Cơ quan, tổ chức, hộ gia đình, cá nhân có liên quan.
"""
        result = parse_legal_text(text)
        self.assertEqual(result.structure_status, "structured")
        self.assertFalse(result.needs_review)
        self.assertEqual([a.number for a in result.articles], ["1", "2", "1", "2"])
        self.assertEqual(result.articles[0].part, "Phần Quyết định ban hành")
        self.assertEqual(result.articles[2].chapter, "Chương I. QUY ĐỊNH CHUNG")

    def test_extract_text_references_detects_mentions_cross_refs_and_docs(self):
        sample = (
            "Theo quy định tại khoản 2 Điều 17 và Điều 4 của Luật Doanh nghiệp năm 2020, "
            "quyết định này thay thế Quyết định số 49/2024/QĐ-UBND và dẫn chiếu Điều 1."
        )
        refs = extract_text_references(sample, self_article="1", self_doc_number="72/2025/QH15")
        self.assertEqual(refs.get("mentioned_articles"), "17,4,1")
        self.assertEqual(refs.get("referenced_articles"), "17,4")
        self.assertIn("49/2024/QĐ-UBND", refs.get("referenced_docs", ""))
        self.assertIn("Luật Doanh nghiệp năm 2020", refs.get("referenced_docs", ""))

    def test_markdown_ocr_headings_and_clauses_parse_as_structured(self):
        """Văn bản OCR có ký hiệu Markdown đậm hoặc tiêu đề vẫn nhận diện chuẩn Chương, Điều, Khoản, Điểm."""
        text = """**CHÍNH PHỦ**
Số: 168/2024/NĐ-CP
**NGHỊ ĐỊNH**
**Quy định xử phạt vi phạm hành chính về trật tự, an toàn giao thông**
**Chương I**
**NHỮNG QUY ĐỊNH CHUNG**
**Điều 1. Phạm vi điều chỉnh**
1. Nghị định này quy định về xử phạt vi phạm hành chính trong lĩnh vực giao thông đường bộ.
a) Hành vi vi phạm hành chính, hình thức và mức xử phạt;
2. Các hành vi vi phạm khác áp dụng theo nghị định chuyên ngành.
**Điều 2. Đối tượng áp dụng**
1. Cá nhân, tổ chức Việt Nam và nước ngoài có hành vi vi phạm trên lãnh thổ Việt Nam.
"""
        result = parse_legal_text(text)
        self.assertEqual(result.structure_status, "structured")
        self.assertFalse(result.needs_review)
        self.assertEqual([a.number for a in result.articles], ["1", "2"])
        self.assertEqual(result.articles[0].chapter, "Chương I. NHỮNG QUY ĐỊNH CHUNG")
        self.assertEqual([c.number for c in result.articles[0].clauses], ["1", "2"])
        self.assertEqual([p.number for p in result.articles[0].clauses[0].points], ["a"])
        self.assertEqual(
            set(line.strip() for line in text.splitlines() if line.strip()),
            set(result.general_lines + result.article_lines),
        )

    def test_metadata_extraction_handles_markdown_ocr_and_scan_filename_hint(self):
        """Suy luận đúng loại văn bản từ tên tệp PDF scan và bóc tách chuẩn metadata từ bản OCR Markdown."""
        import io
        from pypdf import PdfWriter

        blank_pdf = PdfWriter()
        blank_pdf.add_blank_page(width=595, height=842)
        pdf_buf = io.BytesIO()
        blank_pdf.write(pdf_buf)
        empty_meta = auto_extract_metadata(pdf_buf.getvalue(), "168-nd-cp.signed.pdf")
        self.assertEqual(empty_meta["document_type"], "decree")
        self.assertTrue(empty_meta.get("issued_date_fallback"))

        ocr_sample = """CHÍNH PHỦ
Số: 168/2024/NĐ-CP
CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM
Độc lập - Tự do - Hạnh phúc
Hà Nội, ngày 26 tháng 12 năm 2024
**NGHỊ ĐỊNH**
**Quy định xử phạt vi phạm hành chính về trật tự, an toàn giao thông trong lĩnh vực giao thông đường bộ**
**Điều 1. Phạm vi điều chỉnh**
"""
        heur = extract_metadata_heuristic(ocr_sample)
        self.assertEqual(heur["doc_number"], "168/2024/NĐ-CP")
        self.assertEqual(heur["document_type"], "decree")
        self.assertEqual(heur["issuing_authority"], "Chính phủ")
        self.assertEqual(heur["issued_date"], "2024-12-26")
        self.assertIn("Quy định xử phạt vi phạm hành chính", heur["doc_title"])
        self.assertNotIn("Điều 1", heur["doc_title"])

        inline_ocr = ocr_sample.replace(
            "**NGHỊ ĐỊNH**\n**Quy định",
            "**NGHỊ ĐỊNH** **Quy định",
        )
        inline_heur = extract_metadata_heuristic(inline_ocr)
        self.assertEqual(inline_heur["document_type"], "decree")
        self.assertTrue(inline_heur["doc_title"].startswith("Nghị định Quy định xử phạt"))

    def test_repair_vietnamese_pdf_spacing_restores_cong_bao_syllables(self):
        """Khôi phục chuẩn các âm tiết tiếng Việt bị tách khoảng trắng từ font PDF Công báo mà không ghép nhầm nhãn Điểm/Chương."""
        broken_clause = (
            "3. Khi ch ở trẻ em d ưới 10 tu ổi và chi ều cao d ưới 1,35 mét trên xe ô tô "
            "không được cho tr ẻ em ng ồi cùng hàng gh ế với ng ười lái xe, tr ừ loại xe ô tô "
            "ch ỉ có một hàng gh ế; ng ười lái xe ph ải sử dụng, h ướng dẫn sử dụng thi ết bị "
            "an toàn phù h ợp cho tr ẻ em."
        )
        expected_clause = (
            "3. Khi chở trẻ em dưới 10 tuổi và chiều cao dưới 1,35 mét trên xe ô tô "
            "không được cho trẻ em ngồi cùng hàng ghế với người lái xe, trừ loại xe ô tô "
            "chỉ có một hàng ghế; người lái xe phải sử dụng, hướng dẫn sử dụng thiết bị "
            "an toàn phù hợp cho trẻ em."
        )
        self.assertEqual(repair_vietnamese_pdf_spacing(broken_clause), expected_clause)

        broken_heading = "Chương I\nNH ỮNG QUY ĐỊNH CHUNG\nLu ật Trật t ự, an toàn giao thông đ ường b ộ đối với xe c ơ giới"
        expected_heading = "Chương I\nNHỮNG QUY ĐỊNH CHUNG\nLuật Trật tự, an toàn giao thông đường bộ đối với xe cơ giới"
        self.assertEqual(repair_vietnamese_pdf_spacing(broken_heading), expected_heading)

        safe_labels = "Theo quy định tại điểm c ở khoản 2 và Chương V ở phần đầu."
        self.assertEqual(repair_vietnamese_pdf_spacing(safe_labels), safe_labels)

    def test_continuation_articles_and_minor_ocr_gap_remain_structured(self):
        """Văn bản Công báo nối tiếp từ Điều 24 hoặc Nghị định dài thiếu nhẹ 1-2 Điều vẫn giữ cấu trúc phân cấp."""
        continuation = "\n".join(
            f"Điều {num}. Quy định chi tiết thứ {num}\n1. Nội dung quy phạm tại điều {num}."
            for num in range(24, 30)
        )
        cont_parsed = parse_legal_text(continuation)
        self.assertEqual(cont_parsed.structure_status, "structured")
        self.assertFalse(cont_parsed.needs_review)
        self.assertEqual(len(cont_parsed.articles), 6)

        minor_gap_decree = "\n".join(
            f"Điều {num}. Quy định xử phạt nhóm {num}\n1. Phạt tiền đối với hành vi vi phạm."
            for num in (1, 2, 3, 4, 7, 8)
        )
        gap_parsed = parse_legal_text(minor_gap_decree)
        self.assertEqual(gap_parsed.structure_status, "structured")
        self.assertFalse(gap_parsed.needs_review)

        scattered_citations = "\n".join(
            f"Điều {num}. Trích dẫn minh họa\nNội dung bình luận."
            for num in (5, 19, 3, 42, 8, 50)
        )
        self.assertEqual(parse_legal_text(scattered_citations).structure_status, "mixed_reference_document")

    def test_fine_grained_unit_references_handle_semicolon_chains_and_self_article(self):
        """Trích xuất chính xác mã tham chiếu chi tiết 'article:clause:point' kể cả chuỗi dấu chấm phẩy và 'Điều này'."""
        art53_clause2 = (
            "2. Quy định tại điểm m khoản 3 Điều 6, điểm e khoản 4 Điều 26, điểm b khoản 1 Điều 27 "
            "của Nghị định này có hiệu lực thi hành từ ngày 01 tháng 01 năm 2026."
        )
        refs_53 = extract_text_references(
            art53_clause2,
            self_article="53",
            self_doc_number="168/2024/NĐ-CP",
            self_clause="2",
        )
        self.assertEqual(refs_53.get("referenced_units"), "6:3:m,26:4:e,27:1:b")
        self.assertEqual(refs_53.get("referenced_articles"), "6,26,27")

        art6_clause16 = (
            "a) Thực hiện hành vi quy định tại điểm h, điểm i khoản 3; điểm a, điểm b khoản 4; "
            "khoản 5 Điều này bị trừ 02 điểm giấy phép lái xe;"
        )
        units_16 = parse_fine_grained_unit_refs(
            art6_clause16,
            self_article="6",
            self_clause="16",
            self_point="a",
        )
        self.assertEqual(units_16, ["6:3:h", "6:3:i", "6:4:a", "6:4:b", "6:5"])


if __name__ == "__main__":
    unittest.main()
