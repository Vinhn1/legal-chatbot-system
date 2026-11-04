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
from pathlib import Path
from typing import Any

from legal.ingest import extract_text
from legal.parser import clean_legal_line

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
    r"^Số(?:\s+ký\s+hiệu)?\s*[:.]\s*([0-9]+(?:/[0-9]+)?/[A-ZĐ0-9_-]+)\s*$",
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


def normalize_fallback_title(filename: str) -> str:
    """Chuẩn hóa tên tệp thành tiêu đề dễ đọc, loại bỏ dấu gạch dưới xộc xệch và viết tắt thô."""
    raw = Path(filename).stem
    # Rút gọn các ký tự gạch dưới và gạch ngang thành khoảng trắng
    cleaned = re.sub(r"[_\-]+", " ", raw).strip()
    # Chuyển đổi các từ viết tắt tài liệu thông dụng ở đầu chuỗi
    cleaned = re.sub(r"^(?:BC|Bc)\s+", "Báo cáo ", cleaned)
    cleaned = re.sub(r"^(?:QC|Qc)\s+", "Quy chế ", cleaned)
    cleaned = re.sub(r"^(?:QD|Qd)\s+", "Quy định ", cleaned)
    cleaned = re.sub(r"^(?:HD|Hd)\s+", "Hướng dẫn ", cleaned)
    cleaned = re.sub(r"^(?:GT|Gt)\s+", "Giáo trình ", cleaned)
    cleaned = re.sub(r"^(?:ST|St)\s+", "Sổ tay ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned or raw


def extract_general_document_info(text: str, filename: str = "") -> tuple[str, str]:
    """Trích xuất tiêu đề thực tế và đơn vị/cơ quan ban hành cho tài liệu thông thường (báo cáo, quy chế, giáo trình...)."""
    lines = [clean_legal_line(l) for l in text.splitlines() if clean_legal_line(l)]
    header_lines = lines[:35]

    detected_authority = ""
    detected_title = ""

    authority_patterns = [
        r"^(TRƯỜNG\s+ĐẠI\s+HỌC\s+[^\n]+)",
        r"^(HỌC\s+VIỆN\s+[^\n]+)",
        r"^(VIỆN\s+[^\n]+)",
        r"^(TẬP\s+ĐOÀN\s+[^\n]+)",
        r"^(TỔNG\s+CÔNG\s+TY\s+[^\n]+)",
        r"^(CÔNG\s+TY\s+[^\n]+)",
        r"^(NGÂN\s+HÀNG\s+[^\n]+)",
        r"^(TRUNG\s+TÂM\s+[^\n]+)",
    ]
    for line in header_lines[:15]:
        for pat in authority_patterns:
            m = re.match(pat, line, re.IGNORECASE)
            if m:
                detected_authority = m.group(1).strip()
                break
        if detected_authority:
            break

    title_keywords = [
        "BÁO CÁO THỰC TẬP TỐT NGHIỆP",
        "BÁO CÁO THỰC TẬP",
        "BÁO CÁO TỔNG KẾT",
        "BÁO CÁO KẾT QUẢ",
        "BÁO CÁO",
        "QUY CHẾ HOẠT ĐỘNG",
        "QUY CHẾ",
        "QUY ĐỊNH",
        "HƯỚNG DẪN",
        "GIÁO TRÌNH",
        "SỔ TAY",
        "KẾ HOẠCH",
        "ĐỀ ÁN",
        "ĐỀ TÀI",
    ]
    for i, line in enumerate(header_lines[:25]):
        upper_line = line.upper().strip()
        if "CỘNG HÒA XÃ HỘI" in upper_line or "ĐỘC LẬP - TỰ DO" in upper_line or "LOGO" in upper_line:
            continue
        if detected_authority and upper_line == detected_authority.upper():
            continue

        for kw in title_keywords:
            if upper_line.startswith(kw) or upper_line == kw:
                main_title = line.strip()
                sub_title = ""
                if i + 1 < len(header_lines):
                    candidate_sub = header_lines[i + 1].strip()
                    upper_sub = candidate_sub.upper()
                    if not any(stop in upper_sub for stop in ["CÁN BỘ", "GIẢNG VIÊN", "SINH VIÊN", "NGƯỜI THỰC HIỆN", "ĐƠN VỊ", "NGÀY", "THÁNG", "NĂM", "LOGO"]):
                        if 5 < len(candidate_sub) < 160:
                            sub_title = candidate_sub
                if sub_title:
                    detected_title = f"{main_title}: {sub_title}"
                else:
                    detected_title = main_title
                break
        if detected_title:
            break

    return detected_title, detected_authority


def readable_document_number(text: str, filename: str, title: str = "") -> str:
    """Tạo mã dễ đọc cho tài liệu không có số hiệu quy phạm chính thức."""
    opening = "\n".join(text.splitlines()[:30])
    topic_pattern = r"(?im)^\s*(CHUYÊN ĐỀ|SỔ TAY|GIÁO TRÌNH|BÁO CÁO|QUY CHẾ|QUY ĐỊNH|HƯỚNG DẪN|KẾ HOẠCH|ĐỀ ÁN)\s*(\d+|[IVXLCDM]+)?\b"
    heading = (re.search(topic_pattern, opening) or re.search(topic_pattern, title)
               or re.search(topic_pattern, Path(filename).stem.replace("_", " ")))
    kind_map = {
        "CHUYÊN ĐỀ": "CD",
        "SỔ TAY": "ST",
        "GIÁO TRÌNH": "GT",
        "BÁO CÁO": "BC",
        "QUY CHẾ": "QC",
        "QUY ĐỊNH": "QD",
        "HƯỚNG DẪN": "HD",
        "KẾ HOẠCH": "KH",
        "ĐỀ ÁN": "DA",
    }
    stem_upper = Path(filename).stem.upper()
    default_kind = "TL"
    if stem_upper.startswith(("BC_", "BC-")):
        default_kind = "BC"
    elif stem_upper.startswith(("QC_", "QC-")):
        default_kind = "QC"
    elif stem_upper.startswith(("QD_", "QD-")):
        default_kind = "QD"
    elif stem_upper.startswith(("HD_", "HD-")):
        default_kind = "HD"

    kind = kind_map.get(heading.group(1).upper() if heading else "", default_kind)
    if heading and heading.group(2):
        number = heading.group(2)
        return f"{kind}-{int(number):02d}" if number.isdigit() else f"{kind}-{number.upper()}"

    label = title or Path(filename).stem
    if label.lower() in {"web_document", "pasted_text", "document", "upload"}:
        label = "TAI-LIEU"

    ascii_label = unicodedata.normalize("NFKD", label.replace("Đ", "D").replace("đ", "d"))
    slug = re.sub(r"[^A-Z0-9]+", "-", ascii_label.encode("ascii", "ignore").decode().upper()).strip("-")
    if slug.startswith(f"{kind}-"):
        return slug[:48].strip("-")
    return f"{kind}-{slug[:44].strip('-') or 'TAI-LIEU'}"


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


def _infer_document_type_from_hint(filename: str, doc_number: str = "") -> str:
    """Suy luận loại văn bản từ số ký hiệu hoặc tên tệp khi chưa đọc được tiêu đề."""
    upper_num = doc_number.upper().replace("–", "-")
    if "/NĐ-CP" in upper_num or "/ND-CP" in upper_num:
        return "decree"
    if "/TT-" in upper_num or "/TTLT-" in upper_num or upper_num.endswith("/TT"):
        return "circular"
    if "/NQ-" in upper_num or upper_num.endswith("/NQ"):
        return "resolution"
    if "/QH" in upper_num:
        return "law"

    stem = Path(filename).stem.lower().replace("đ", "d")
    ascii_stem = unicodedata.normalize("NFKD", stem).encode("ascii", "ignore").decode("ascii")
    norm_stem = re.sub(r"[^a-z0-9]+", "-", ascii_stem).strip("-")
    if re.search(r"(?:^|-)(?:nd-cp|nghi-dinh)(?:-|$)", norm_stem):
        return "decree"
    if re.search(r"(?:^|-)(?:ttlt|thong-tu|tt)(?:-|$)", norm_stem):
        return "circular"
    if re.search(r"(?:^|-)(?:nghi-quyet|nq)(?:-|$)", norm_stem):
        return "resolution"
    return "law"


def _extract_typed_title(prefix_label: str, line: str, header_lines: list[str], index: int) -> str:
    """Ghép tên loại văn bản và phần trích yếu dù nằm cùng một dòng hay tách nhiều dòng."""
    inline_rest = line.strip()[len(prefix_label):].strip(" .:-")
    if inline_rest:
        return f"{prefix_label.capitalize()} {inline_rest}"
    title_candidates: list[str] = []
    stop_pattern = re.compile(
        r"^(?:Phần|Chương|Mục|Điều|Căn cứ|Theo đề nghị|Xét đề nghị)\b",
        re.IGNORECASE,
    )
    for j in range(index + 1, min(index + 6, len(header_lines))):
        candidate = header_lines[j]
        if candidate.startswith("---") or "Căn cứ" in candidate or stop_pattern.match(candidate):
            break
        title_candidates.append(candidate)
    if title_candidates:
        return " ".join(title_candidates).strip()
    return line.strip()


def extract_metadata_heuristic(text: str, filename: str = "") -> dict[str, Any]:
    """Bóc tách thông tin phân loại văn bản theo quy tắc heuristic & biểu thức chính quy.
    
    Phù hợp với thể thức trình bày văn bản theo Nghị định 30/2020/NĐ-CP.
    """
    lines = [cleaned for line in text.splitlines() if (cleaned := clean_legal_line(line))]
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
    # Chỉ chấp nhận dòng số hiệu độc lập ở phần đầu để tránh lấy số văn bản được trích dẫn.
    compilation_heading = next((index for index, line in enumerate(header_lines[:10])
                                if re.match(r"^(?:CHUYÊN ĐỀ|SỔ TAY|GIÁO TRÌNH)\b", line, re.IGNORECASE)), None)
    number_header = header_lines[:compilation_heading] if compilation_heading is not None else header_lines[:25]
    match_num = next((match for line in number_header
                      if (match := REGEX_DOC_NUMBER.fullmatch(line))), None)
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
            metadata["doc_title"] = _extract_typed_title("NGHỊ ĐỊNH", line, header_lines, i)
            break

        # Nhận diện Thông tư
        if upper_line.startswith("THÔNG TƯ"):
            metadata["document_type"] = "circular"
            doc_type_found = True
            metadata["doc_title"] = _extract_typed_title("THÔNG TƯ", line, header_lines, i)
            break

        # Nhận diện Nghị quyết
        if upper_line.startswith("NGHỊ QUYẾT"):
            metadata["document_type"] = "resolution"
            doc_type_found = True
            metadata["doc_title"] = _extract_typed_title("NGHỊ QUYẾT", line, header_lines, i)
            break

    # Suy luận loại văn bản từ số hiệu hoặc tên tệp nếu chưa khớp tiêu đề loại văn bản
    if not doc_type_found:
        if metadata["issuing_authority"] == "Quốc hội":
            metadata["document_type"] = "law"
        else:
            metadata["document_type"] = _infer_document_type_from_hint(filename, metadata["doc_number"])
        # Nếu chưa tìm thấy tiêu đề theo chuẩn VBQPPL, trích xuất tiêu đề tài liệu thông thường từ nội dung
        if not metadata["doc_title"]:
            gen_title, gen_issuer = extract_general_document_info(text, filename)
            if gen_title:
                metadata["doc_title"] = gen_title
            if gen_issuer and not metadata["issuing_authority"]:
                metadata["issuing_authority"] = gen_issuer

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
        fallback_title = normalize_fallback_title(filename)
        return {
            "doc_number": readable_document_number("", filename, fallback_title),
            "doc_title": fallback_title,
            "document_type": _infer_document_type_from_hint(filename),
            "issuing_authority": "",
            "issued_date": date.today().isoformat(),
            "issued_date_fallback": True,
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
            heuristic_res["issued_date_fallback"] = True
        return heuristic_res

    # Bước 2: Kích hoạt LLM Fallback nếu Heuristic thiếu trường quan trọng
    llm_res = extract_metadata_llm(text, filename)
    if llm_res:
        # Kết hợp dữ liệu: Ưu tiên giá trị có nghĩa từ LLM bổ sung cho Heuristic
        combined = {**heuristic_res, **{k: v for k, v in llm_res.items() if v}}
        if (re.search(r"(?im)^\s*(?:CHUYÊN ĐỀ|SỔ TAY|GIÁO TRÌNH)\b",
                      "\n".join(text.splitlines()[:10])) and not heuristic_res["doc_number"]):
            # Tài liệu chuyên đề không được nhận số của văn bản chỉ được trích dẫn.
            combined["doc_number"] = readable_document_number(text, filename, combined.get("doc_title") or "")
        if not combined.get("doc_number"):
            combined["doc_number"] = readable_document_number(text, filename, combined.get("doc_title") or "")
        for key in ("doc_title", "issuing_authority"):
            original = heuristic_res.get(key) or ""
            proposed = llm_res.get(key) or ""
            # Không để bản dịch không dấu ghi đè tên tiếng Việt đã nhận diện.
            if original and proposed and _has_vietnamese_marks(original) and not _has_vietnamese_marks(proposed):
                combined[key] = original
        combined["extracted_by"] = "hybrid" if heuristic_res.get("confidence") == "medium" else "llm"
        combined["confidence"] = ("medium" if str(combined.get("doc_number") or "").startswith(("CD-", "ST-", "GT-", "TL-"))
                                  else "high" if combined.get("doc_number") else "medium")
        if not combined.get("issued_date"):
            combined["issued_date"] = date.today().isoformat()
            combined["issued_date_fallback"] = True
        return combined

    # Bước 3: Dự phòng cuối cùng nếu LLM không khả dụng hoặc lỗi
    raw_title = heuristic_res.get("doc_title") or normalize_fallback_title(filename)
    fallback_title = re.sub(r"[_\-]+", " ", raw_title).strip()
    fallback_title = re.sub(r"\s+", " ", fallback_title)
    heuristic_res["doc_title"] = fallback_title or raw_title
    if not heuristic_res.get("doc_number"):
        heuristic_res["doc_number"] = readable_document_number(text, filename, fallback_title)
    if not heuristic_res.get("issued_date"):
        heuristic_res["issued_date"] = date.today().isoformat()
        heuristic_res["issued_date_fallback"] = True
    return heuristic_res
