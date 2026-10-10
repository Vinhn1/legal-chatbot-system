"""Module tự động trích xuất Metadata văn bản quy phạm pháp luật Việt Nam.

Kết hợp 2 tầng (Two-Tier Architecture):
- Tầng 1: Heuristic & Regex Parser theo chuẩn thể thức văn bản (Nghị định 30/2020/NĐ-CP).
  Tốc độ xử lý mili-giây, không tiêu tốn tài nguyên mô hình AI.
- Tầng 2: Gemini LLM Fallback với định dạng JSON Structured Output khi văn bản bị mờ,
  lỗi OCR, bố cục lệch hoặc thiếu các trường thông tin pháp lý cốt lõi.
"""

import json
import logging
import os
import re
import unicodedata
from datetime import date, datetime
from typing import Any

from legal.ingest import extract_text

logger = logging.getLogger(__name__)

# Danh mục ánh xạ cơ quan ban hành phổ biến theo thẩm quyền ban hành VBQPPL
KNOWN_ISSUING_AUTHORITIES = [
    ("QUỐC HỘI", "Quốc hội"),
    ("ỦY BAN THƯỜNG VỤ QUỐC HỘI", "Ủy ban Thường vụ Quốc hội"),
    ("CHÍNH PHỦ", "Chính phủ"),
    ("THỦ TƯỚNG CHÍNH PHỦ", "Thủ tướng Chính phủ"),
    ("TÒA ÁN NHÂN DÂN TỐI CAO", "Tòa án nhân dân tối cao"),
    ("VIỆN KIỂM SÁT NHÂN DÂN TỐI CAO", "Viện kiểm sát nhân dân tối cao"),
    ("KIỂM TOÁN NHÀ NƯỚC", "Kiểm toán Nhà nước"),
    ("NGÂN HÀNG NHÀ NƯỚC VIỆT NAM", "Ngân hàng Nhà nước Việt Nam"),
    ("BỘ QUỐC PHÒNG", "Bộ Quốc phòng"),
    ("BỘ CÔNG AN", "Bộ Công an"),
    ("BỘ NGOẠI GIAO", "Bộ Ngoại giao"),
    ("BỘ TƯ PHÁP", "Bộ Tư pháp"),
    ("BỘ TÀI CHÍNH", "Bộ Tài chính"),
    ("BỘ CÔNG THƯƠNG", "Bộ Công Thương"),
    ("BỘ KẾ HOẠCH VÀ ĐẦU TƯ", "Bộ Kế hoạch và Đầu tư"),
    ("BỘ NÔNG NGHIỆP VÀ PHÁT TRIỂN NÔNG THÔN", "Bộ Nông nghiệp và Phát triển nông thôn"),
    ("BỘ GIAO THÔNG VẬN TẢI", "Bộ Giao thông vận tải"),
    ("BỘ XÂY DỰNG", "Bộ Xây dựng"),
    ("BỘ TÀI NGUYÊN VÀ MÔI TRƯỜNG", "Bộ Tài nguyên và Môi trường"),
    ("BỘ THÔNG TIN VÀ TRUYỀN THÔNG", "Bộ Thông tin và Truyền thông"),
    ("BỘ LAO ĐỘNG - THƯƠNG BINH VÀ XÃ HỘI", "Bộ Lao động - Thương binh và Xã hội"),
    ("BỘ VĂN HÓA, THỂ THAO VÀ DU LỊCH", "Bộ Văn hóa, Thể thao và Du lịch"),
    ("BỘ KHOA HỌC VÀ CÔNG NGHỆ", "Bộ Khoa học và Công nghệ"),
    ("BỘ GIÁO DỤC VÀ ĐÀO TẠO", "Bộ Giáo dục và Đào tạo"),
    ("BỘ Y TẾ", "Bộ Y tế"),
    ("BỘ NỘI VỤ", "Bộ Nội vụ"),
    ("THANH TRA CHÍNH PHỦ", "Thanh tra Chính phủ"),
    ("ỦY BAN DÂN TỘC", "Ủy ban Dân tộc"),
]

# Regex nhận diện Số ký hiệu văn bản quy phạm pháp luật (hỗ trợ ký tự Đ/đ như NĐ-CP, ĐBQH)
REGEX_DOC_NUMBER = re.compile(
    r"(?:Số|Số ký hiệu|Số:)\s*[:.]?\s*([0-9]+(?:/[0-9]+)?/[A-ZĐ0-9_-]+|[0-9]+/[A-ZĐ0-9_-]+)",
    re.IGNORECASE,
)

# Regex nhận diện Ngày tháng năm ban hành
REGEX_DATE = re.compile(
    r"(?:Hà Nội|TP\s*Hồ Chí Minh|Đà Nẵng|[A-ZĐÀÁÂÃÈÉÊÌÍÒÓÔÕÙÚĂĨŨƠƯ][a-zđàáâãèéêìíòóôõùúăĩũơư]+)?,?\s*ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(\d{4})",
    re.IGNORECASE,
)

# Regex nhận diện Ngày có hiệu lực ở các điều khoản thi hành cuối văn bản
REGEX_EFFECTIVE_DATE = re.compile(
    r"có hiệu lực(?:\s+thi hành)?(?:\s+kể)?\s+từ\s+ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(\d{4})",
    re.IGNORECASE,
)


def _has_vietnamese_marks(value: str) -> bool:
    """Nhận diện dấu tiếng Việt để giữ tên gốc khi LLM trả bản dịch không dấu."""
    return "đ" in value.lower() or any(
        unicodedata.combining(char) for char in unicodedata.normalize("NFD", value)
    )


def _format_date(day_str: str, month_str: str, year_str: str) -> str | None:
    """Chuyển đổi ngày tháng năm tách rời về chuẩn ISO YYYY-MM-DD."""
    try:
        d = int(day_str)
        m = int(month_str)
        y = int(year_str)
        return date(y, m, d).isoformat()
    except (ValueError, TypeError):
        return None


def extract_metadata_heuristic(text: str, filename: str = "") -> dict[str, Any]:
    """Bóc tách thông tin phân loại văn bản theo quy tắc heuristic & biểu thức chính quy.
    
    Phù hợp với thể thức trình bày văn bản theo Nghị định 30/2020/NĐ-CP.
    """
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    header_lines = lines[:100]  # Quét 100 dòng đầu trang cho phần tiêu đề & số hiệu
    footer_lines = lines[-80:] if len(lines) > 80 else lines  # Quét phần điều khoản thi hành

    header_text = "\n".join(header_lines)
    footer_text = "\n".join(footer_lines)

    metadata: dict[str, Any] = {
        "doc_number": "",
        "doc_title": "",
        "document_type": "law",
        "issuing_authority": "",
        "issued_date": None,
        "effective_date": None,
        "effective_status": "active",
        "scope": "public",
        "source_url": "https://congbao.chinhphu.vn",
        "confidence": "low",
        "extracted_by": "heuristic",
    }

    # 1. Trích xuất Cơ quan ban hành
    upper_header = header_text.upper()
    for raw_name, display_name in KNOWN_ISSUING_AUTHORITIES:
        if raw_name in upper_header:
            metadata["issuing_authority"] = display_name
            break

    # Nếu chưa tìm thấy trong danh mục có sẵn, thử regex tìm dòng cơ quan
    if not metadata["issuing_authority"]:
        for line in header_lines[:25]:
            match_agency = re.match(
                r"^(BỘ\s+[^\n,]+|ỦY BAN\s+NHÂN DÂN[^\n,]+|TÒA ÁN[^\n,]+|VIỆN KIỂM SÁT[^\n,]+)",
                line,
                re.IGNORECASE,
            )
            if match_agency:
                metadata["issuing_authority"] = line.title()
                break

    # 2. Trích xuất Số ký hiệu văn bản
    match_num = REGEX_DOC_NUMBER.search(header_text)
    if match_num:
        metadata["doc_number"] = match_num.group(1).strip()
    else:
        # Dự đoán từ tên tệp nếu có dạng số/năm/ký-hiệu
        match_fn_num = re.search(r"(\d+(?:/\d+)?/[A-Z0-9_-]+)", filename, re.IGNORECASE)
        if match_fn_num:
            metadata["doc_number"] = match_fn_num.group(1)

    # 3. Trích xuất Ngày ban hành
    match_date = REGEX_DATE.search(header_text)
    if match_date:
        metadata["issued_date"] = _format_date(
            match_date.group(1), match_date.group(2), match_date.group(3)
        )

    # 4. Trích xuất Ngày có hiệu lực từ điều khoản cuối
    match_eff_date = REGEX_EFFECTIVE_DATE.search(footer_text)
    if match_eff_date:
        metadata["effective_date"] = _format_date(
            match_eff_date.group(1), match_eff_date.group(2), match_eff_date.group(3)
        )

    # 5. Trích xuất Loại văn bản và Tên văn bản (Trích yếu)
    doc_type_found = False
    for i, line in enumerate(header_lines[:50]):
        upper_line = line.upper()

        # Nhận diện Luật / Bộ luật
        if upper_line in ("LUẬT", "BỘ LUẬT") or upper_line.startswith("LUẬT ") or upper_line.startswith("BỘ LUẬT "):
            metadata["document_type"] = "law"
            doc_type_found = True
            # Tên luật có thể cùng dòng hoặc ở dòng kế tiếp
            if len(line.split()) > 1 and not line.endswith(":"):
                metadata["doc_title"] = line.strip().title()
            elif i + 1 < len(header_lines):
                next_line = header_lines[i + 1]
                metadata["doc_title"] = f"Luật {next_line.strip().title()}"
            break

        # Nhận diện Nghị định
        if upper_line.startswith("NGHỊ ĐỊNH"):
            metadata["document_type"] = "decree"
            doc_type_found = True
            # Tìm dòng trích yếu sau dòng Nghị định
            title_candidates = []
            for j in range(i + 1, min(i + 6, len(header_lines))):
                candidate = header_lines[j]
                if candidate.startswith("---") or "Căn cứ" in candidate:
                    break
                title_candidates.append(candidate)
            if title_candidates:
                metadata["doc_title"] = " ".join(title_candidates).strip()
            else:
                metadata["doc_title"] = line.strip()
            break

        # Nhận diện Thông tư
        if upper_line.startswith("THÔNG TƯ"):
            metadata["document_type"] = "circular"
            doc_type_found = True
            title_candidates = []
            for j in range(i + 1, min(i + 6, len(header_lines))):
                candidate = header_lines[j]
                if candidate.startswith("---") or "Căn cứ" in candidate:
                    break
                title_candidates.append(candidate)
            if title_candidates:
                metadata["doc_title"] = " ".join(title_candidates).strip()
            else:
                metadata["doc_title"] = line.strip()
            break

        # Nhận diện Nghị quyết
        if upper_line.startswith("NGHỊ QUYẾT"):
            metadata["document_type"] = "resolution"
            doc_type_found = True
            title_candidates = []
            for j in range(i + 1, min(i + 6, len(header_lines))):
                candidate = header_lines[j]
                if candidate.startswith("---") or "Căn cứ" in candidate:
                    break
                title_candidates.append(candidate)
            if title_candidates:
                metadata["doc_title"] = " ".join(title_candidates).strip()
            else:
                metadata["doc_title"] = line.strip()
            break

    # Nếu cơ quan là Quốc hội nhưng chưa xác định loại, mặc định là law
    if not doc_type_found and metadata["issuing_authority"] == "Quốc hội":
        metadata["document_type"] = "law"

    # Đánh giá độ tin cậy của tầng heuristic
    has_number = bool(metadata["doc_number"])
    has_title = bool(metadata["doc_title"])
    has_issuer = bool(metadata["issuing_authority"])

    if has_number and has_title and has_issuer:
        metadata["confidence"] = "high"
    elif (has_number and has_title) or (has_title and has_issuer):
        metadata["confidence"] = "medium"
    else:
        metadata["confidence"] = "low"

    return metadata


def extract_metadata_llm(text: str, filename: str = "") -> dict[str, Any]:
    """Sử dụng mô hình ngôn ngữ lớn (Gemini) để trích xuất metadata khi heuristic không đủ tin cậy."""
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        logger.warning("Chưa cấu hình GEMINI_API_KEY, bỏ qua tầng LLM trích xuất metadata.")
        return {}

    try:
        from google import genai
        from google.genai import types as genai_types
    except ImportError:
        logger.warning("Thư viện google-genai chưa được cài đặt, bỏ qua tầng LLM.")
        return {}

    # Lấy 3.500 ký tự đầu (tiêu đề, số hiệu, trích yếu) và 1.500 ký tự cuối (điều khoản thi hành)
    sample_text = text[:3500]
    if len(text) > 4000:
        sample_text += "\n\n... [PHẦN ĐIỀU KHOẢN CUỐI VĂN BẢN] ...\n\n" + text[-1500:]

    prompt = f"""Bạn là chuyên gia thẩm định văn bản quy phạm pháp luật Việt Nam.
Hãy phân tích nội dung văn bản dưới đây (tên tệp: "{filename}") và trích xuất các trường metadata chính xác tuyệt đối.
Giữ nguyên tiếng Việt của nguồn. Trường doc_title và issuing_authority phải là tên tiếng Việt nguyên bản,
không dịch sang tiếng Anh hay tự tạo bản dịch. Ví dụ: "Bộ luật Lao động 2019" và "Quốc hội",
không dùng "Labor Code" hoặc "National Assembly". Nếu nguồn không xác minh được tên tiếng Việt,
hãy để trường đó là chuỗi rỗng thay vì suy đoán từ bản dịch.

YÊU CẦU ĐẦU RA:
Trả về CHÍNH XÁC một đối tượng JSON hợp lệ (không kèm markdown ```json hay văn bản giải thích thừa) có các trường sau:
{{
  "doc_number": "Số ký hiệu văn bản, ví dụ: 31/2024/QH15 hoặc 102/2024/NĐ-CP (chuỗi, nếu không có để rỗng)",
  "doc_title": "Tên văn bản hoặc trích yếu đầy đủ, ví dụ: Luật Đất đai hoặc Nghị định quy định chi tiết thi hành Luật Đất đai (chuỗi bắt buộc)",
  "document_type": "Một trong 4 giá trị: 'law', 'decree', 'circular', 'resolution'",
  "issuing_authority": "Tên cơ quan ban hành, ví dụ: Quốc hội, Chính phủ, Bộ Tài chính, Bộ Xây dựng...",
  "issued_date": "Ngày ban hành định dạng YYYY-MM-DD (nếu không rõ để null)",
  "effective_date": "Ngày có hiệu lực thi hành định dạng YYYY-MM-DD (nếu không rõ để null)",
  "effective_status": "'active' hoặc 'expired' (mặc định 'active')",
  "scope": "'public' hoặc 'internal' (mặc định 'public')"
}}

NỘI DUNG VĂN BẢN:
{sample_text}
"""

    try:
        client = genai.Client(api_key=api_key)
        model_name = os.getenv("GEMINI_MODEL") or "gemini-2.5-flash-lite"
        response = client.models.generate_content(
            model=model_name,
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                temperature=0.0,
                response_mime_type="application/json",
            ),
        )
        if not response.text:
            return {}

        parsed_json = json.loads(response.text.strip())
        parsed_json["confidence"] = "high"
        parsed_json["extracted_by"] = "llm"
        return parsed_json
    except Exception as exc:
        logger.warning("Lỗi trong quá trình gọi LLM trích xuất metadata: %s", exc)
        return {}


def auto_extract_metadata(data: bytes, filename: str) -> dict[str, Any]:
    """Hàm điều phối trích xuất thông tin tự động toàn diện cho tệp tải lên (PDF, DOCX, TXT)."""
    text = extract_text(data, filename)
    if not text.strip():
        fallback_title = filename.rsplit(".", 1)[0]
        return {
            "doc_number": "",
            "doc_title": fallback_title,
            "document_type": "law",
            "issuing_authority": "",
            "issued_date": date.today().isoformat(),
            "effective_date": None,
            "effective_status": "active",
            "scope": "public",
            "source_url": "https://congbao.chinhphu.vn",
            "confidence": "low",
            "extracted_by": "fallback",
        }

    # Bước 1: Thử nghiệm Heuristic / Regex
    heuristic_res = extract_metadata_heuristic(text, filename)

    # Nếu Heuristic đã đạt độ tin cậy cao, trả về ngay lập tức để tiết kiệm chi phí & độ trễ
    if heuristic_res.get("confidence") == "high":
        if not heuristic_res.get("issued_date"):
            heuristic_res["issued_date"] = date.today().isoformat()
        return heuristic_res

    # Bước 2: Kích hoạt LLM Fallback nếu Heuristic thiếu trường quan trọng
    llm_res = extract_metadata_llm(text, filename)
    if llm_res:
        # Kết hợp dữ liệu: Ưu tiên giá trị có nghĩa từ LLM bổ sung cho Heuristic
        combined = {**heuristic_res, **{k: v for k, v in llm_res.items() if v}}
        for key in ("doc_title", "issuing_authority"):
            original = heuristic_res.get(key) or ""
            proposed = llm_res.get(key) or ""
            # Không để bản dịch không dấu ghi đè tên tiếng Việt đã nhận diện.
            if original and proposed and _has_vietnamese_marks(original) and not _has_vietnamese_marks(proposed):
                combined[key] = original
        combined["extracted_by"] = "hybrid" if heuristic_res.get("confidence") == "medium" else "llm"
        combined["confidence"] = "high"
        if not combined.get("issued_date"):
            combined["issued_date"] = date.today().isoformat()
        return combined

    # Bước 3: Dự phòng cuối cùng nếu LLM không khả dụng hoặc lỗi
    fallback_title = heuristic_res.get("doc_title") or filename.rsplit(".", 1)[0]
    heuristic_res["doc_title"] = fallback_title
    if not heuristic_res.get("issued_date"):
        heuristic_res["issued_date"] = date.today().isoformat()
    return heuristic_res
