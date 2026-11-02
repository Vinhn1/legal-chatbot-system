"""Bộ phân tích văn bản quy phạm pháp luật Việt Nam theo từng dòng.

Nhận diện cấu trúc phân cấp: Chương -> Mục -> Điều -> Khoản -> Điểm.
Hỗ trợ cả Điều đơn (không có Khoản) và Điều đa Khoản. Tự động phát hiện
các tài liệu scan hoặc lỗi OCR để yêu cầu rà soát thủ công.
"""

import re
from dataclasses import dataclass, field


# Các biểu thức chính quy (Regex) nhận diện đơn vị quy phạm pháp luật chuẩn Việt Nam
# Sử dụng kiểm tra ranh giới từ và cấu trúc số La Mã/chữ số để không bắt nhầm các từ tiếng Việt thông thường
PART = re.compile(
    r"^(?:PHẦN|Phần)(?:\s+thứ\s+(nhất|nhì|hai|ba|tư|bốn|năm|sáu|bảy|tám|chín|mười)|(?:\s+thứ)?\s+([IVXLCDM]+|\d+))(?:\b\s*[.:-]\s*|\b\s+|\b$)(.*)$",
    re.IGNORECASE,
)
CHAPTER = re.compile(
    r"^(?:CHƯƠNG|Chương)(?:\s+thứ\s+(nhất|nhì|hai|ba|tư|bốn|năm|sáu|bảy|tám|chín|mười)|(?:\s+thứ)?\s+([IVXLCDM]+|\d+))(?:\b\s*[.:-]\s*|\b\s+|\b$)(.*)$",
    re.IGNORECASE,
)
SECTION = re.compile(
    r"^(?:MỤC|Mục)(?:\s+thứ\s+(nhất|nhì|hai|ba|tư|bốn|năm|sáu|bảy|tám|chín|mười)|(?:\s+(?:số|thứ))?\s+([IVXLCDM]+|\d+))(?:\b\s*[.:-]\s*|\b\s+|\b$)(.*)$",
    re.IGNORECASE,
)
SUBSECTION = re.compile(r"^([IVXLCDM]+|[A-Z])\.\s+(.+)$")
ARTICLE = re.compile(r"^Điều\s+(\d+[a-zA-Z]?)(?:\.\s*(.*))?$", re.IGNORECASE)
CLAUSE = re.compile(r"^(\d+)\s*[.]\s+(.+)$")
POINT = re.compile(r"^([a-zđ])\s*[)]\s+(.+)$", re.IGNORECASE)


def clean_legal_line(raw: str) -> str:
    """Loại bỏ ký hiệu định dạng Markdown từ kết quả AI OCR để nhận diện đúng tiêu đề pháp lý."""
    cleaned = raw.strip()
    if not cleaned:
        return ""
    cleaned = re.sub(r"^#{1,6}\s+", "", cleaned)
    cleaned = cleaned.replace("**", "").replace("__", "")
    cleaned = re.sub(r"^\*([^*]+)\*$", r"\1", cleaned)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned).strip()
    return cleaned


# Bảng quy tắc khôi phục âm tiết tiếng Việt bị tách khoảng trắng khi trích xuất PDF font Công báo
_VN_NON_ASCII_VOWELS = (
    "àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩị"
    "òóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ"
    "ÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊ"
    "ÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴ"
)
_VN_STANDALONE_VOWEL_WORDS = frozenset({
    "ở", "ô", "ố", "ồ", "ổ", "ỗ", "ý", "ỷ", "ỹ", "ỵ",
    "ăn", "ắt", "ẳn", "ẫm", "ấy", "ấng", "ẩn", "ẩm", "ấn", "ấp",
    "ống", "ổn", "ốm", "ốc", "ốp", "ước", "ứng", "ửng", "ưu",
    "ác", "áp", "ám", "án", "áng", "ảnh", "ảo", "ải", "ảm",
})
_ITEM_LABEL_PREFIX_RE = re.compile(
    r"(?:điểm|khoản|mục|chương|phần|hạng|loại|nhóm|bảng|mẫu|chữ|số|phụ\s+lục)\s+$",
    re.IGNORECASE,
)
_MULTI_CONSONANT_SPLIT_RE = re.compile(
    rf"\b(ngh|ng|nh|gh|gi|kh|ph|qu|th|tr|ch)[ \t]+([{_VN_NON_ASCII_VOWELS}][A-Za-zÀ-ỹđĐ]{{0,5}})\b",
    re.IGNORECASE,
)
_SINGLE_CONSONANT_SPLIT_RE = re.compile(
    rf"\b([bcdđghklmnprstvxBCDĐGHKLMNPRSTVX])[ \t]+([{_VN_NON_ASCII_VOWELS}][A-Za-zÀ-ỹđĐ]{{0,5}})\b"
)
_MEDIAL_I_SPLIT_RE = re.compile(
    r"\b((?:ngh|ng|nh|gh|kh|ph|th|tr|ch|[bcdđhklmnprstvx])i)[ \t]+([êềếểễệÊỀẾỂỄỆ][A-Za-zÀ-ỹđĐ]{1,4})\b",
    re.IGNORECASE,
)
_MEDIAL_U_SPLIT_RE = re.compile(
    r"\b((?:ngh|ng|nh|gh|kh|ph|qu|th|tr|ch|[bcdđghklmnprstvx])(?:uy|u|ư|Ư))[ \t]+"
    r"([ôồốổỗộâầấẩẫậêềếểễệơờớởỡợÔỒỐỔỖỘÂẦẤẨẪẬÊỀẾỂỄỆƠỜỚỞỠỢ][A-Za-zÀ-ỹđĐ]{1,4})\b",
    re.IGNORECASE,
)
_MEDIAL_O_SPLIT_RE = re.compile(
    r"\b((?:ngh|ng|nh|gh|kh|ph|th|tr|ch|[bcdđghklmnprstvx])o)[ \t]+"
    r"([àáảãạăằắẳẵặÀÁẢÃẠĂẰẮẲẴẶ][A-Za-zÀ-ỹđĐ]{1,4})\b",
    re.IGNORECASE,
)


def repair_vietnamese_pdf_spacing(text: str) -> str:
    """Khôi phục các âm tiết tiếng Việt bị chèn khoảng trắng giữa phụ âm đầu/âm đệm và nguyên âm có dấu từ PDF."""
    if not text:
        return text

    def _merge_single_consonant(match: re.Match[str]) -> str:
        onset, rime = match.group(1), match.group(2)
        prefix = match.string[max(0, match.start() - 18) : match.start()]
        if _ITEM_LABEL_PREFIX_RE.search(prefix):
            return match.group(0)
        rime_lower = rime.casefold()
        # Không ghép số La Mã viết hoa (I, V, X, L, C, D, M) với từ đơn lập đứng sau (ví dụ: "Chương V ở")
        if onset in "IVXLCDM" and rime_lower in _VN_STANDALONE_VOWEL_WORDS:
            return match.group(0)
        if onset.islower() and rime_lower == "ở" and prefix.rstrip().endswith((",", ";", "/")):
            return match.group(0)
        return f"{onset}{rime}"

    def _merge_medial_u(match: re.Match[str]) -> str:
        left, rime = match.group(1), match.group(2)
        rime_lower = rime.casefold()
        if rime_lower in {"ống", "ổn", "ốm", "ốc", "ốp", "ấng", "ẩn", "ẩm", "ấn", "ấp"} and left.casefold() in {
            "khu", "thu", "chu", "nhu", "ưu", "lưu", "mưu", "sưu", "cứu",
        }:
            # Tránh ghép nhầm hai từ độc lập hiếm gặp trừ các cặp chắc chắn như "chuẩn", "thuận", "tuổi", "luật"
            if f"{left.casefold()}{rime_lower}" not in {"chuẩn", "thuận", "huấn", "luận", "tuần", "xuất", "luật", "cuốn", "muốn", "buồng", "luồng", "nguồn"}:
                return match.group(0)
        if rime_lower == "ổi" and left.casefold() not in {"tu", "bu", "đu", "su", "chu", "mu", "nu", "ru"}:
            return match.group(0)
        return f"{left}{rime}"

    def _merge_medial_o(match: re.Match[str]) -> str:
        left, rime = match.group(1), match.group(2)
        if rime.casefold() in _VN_STANDALONE_VOWEL_WORDS:
            return match.group(0)
        return f"{left}{rime}"

    repaired = _MULTI_CONSONANT_SPLIT_RE.sub(r"\1\2", text)
    repaired = _SINGLE_CONSONANT_SPLIT_RE.sub(_merge_single_consonant, repaired)
    repaired = _MEDIAL_I_SPLIT_RE.sub(r"\1\2", repaired)
    repaired = _MEDIAL_U_SPLIT_RE.sub(_merge_medial_u, repaired)
    repaired = _MEDIAL_O_SPLIT_RE.sub(_merge_medial_o, repaired)
    return repaired


# Biểu thức chính quy phục vụ trích xuất điều khoản được nhắc tới và tham chiếu chéo chi tiết tới cấp Điểm/Khoản/Điều
MENTIONED_ARTICLE_RE = re.compile(r"\bĐiều\s+(\d+[a-zA-Z]?)\b", re.IGNORECASE)
CROSS_REF_SPAN_RE = re.compile(
    r"(?:theo\s+quy\s+định\s+tại|quy\s+định\s+tại|nêu\s+tại|hướng\s+dẫn\s+tại|dẫn\s+chiếu|theo|tại|căn\s+cứ)\s+"
    r"(?:(?:điểm\s+[a-zđ](?:\s*,\s*(?:điểm\s+)?[a-zđ])*\s*,?\s*)?(?:khoản\s+\d+(?:\s*,\s*(?:khoản\s+)?\d+)*\s+)?)?Điều\s+(?:\d+[a-zA-Z]?|này)"
    r"(?:\s*(?:,|;|và|hoặc)\s*(?:(?:điểm\s+[a-zđ](?:\s*,\s*(?:điểm\s+)?[a-zđ])*\s*,?\s*)?(?:khoản\s+\d+(?:\s*,\s*(?:khoản\s+)?\d+)*\s+)?)?Điều\s+(?:\d+[a-zA-Z]?|này))*",
    re.IGNORECASE,
)

# Nhận diện chuỗi tham chiếu chi tiết dạng "[điểm a, điểm b] khoản X [; điểm c khoản Y] Điều (Z|này)"
_CLAUSE_GROUP_PAT = (
    r"(?:điểm\s+[a-zđ](?:\s*(?:,|và|hoặc)\s*(?:điểm\s+)?[a-zđ])*\s+khoản\s+\d+"
    r"|khoản\s+\d+(?:\s*(?:,|và|hoặc)\s*(?:khoản\s+)?\d+)*)"
)
_FINE_REF_CHAIN_RE = re.compile(
    rf"({_CLAUSE_GROUP_PAT}(?:\s*(?:;|,|và|hoặc)\s*{_CLAUSE_GROUP_PAT})*)\s+Điều\s+(\d+[a-zA-Z]?|này)\b",
    re.IGNORECASE,
)
_INTRA_CLAUSE_POINTS_RE = re.compile(
    r"(điểm\s+[a-zđ](?:\s*(?:,|và|hoặc)\s*(?:điểm\s+)?[a-zđ])*)\s+khoản\s+này\b",
    re.IGNORECASE,
)
_SINGLE_GROUP_RE = re.compile(
    r"(?:(điểm\s+[a-zđ](?:\s*(?:,|và|hoặc)\s*(?:điểm\s+)?[a-zđ])*)\s+khoản\s+(\d+)"
    r"|khoản\s+(\d+(?:\s*(?:,|và|hoặc)\s*(?:khoản\s+)?\d+)*))",
    re.IGNORECASE,
)
_POINT_TOKEN_RE = re.compile(r"(?:điểm\s+)?([a-zđ])\b", re.IGNORECASE)
_CLAUSE_TOKEN_RE = re.compile(r"\d+")

REFERENCED_DOC_NUMBER_RE = re.compile(
    r"(?<!\d)(\d{1,4}\s*/\s*\d{4}\s*/\s*[A-ZÀ-ỸĐ0-9]+(?:[-–][A-ZÀ-ỸĐ0-9]+)*)(?![\w/])",
    re.IGNORECASE,
)
NAMED_LAW_RE = re.compile(
    r"\b((?:Bộ\s+luật|Luật)\s+[A-ZÀ-ỸĐ][A-Za-zÀ-ỹđ0-9\s,\-]{2,45}?(?:\s+năm\s+\d{4}|\s+\d{4}))\b"
)


def _normalize_article_token(raw: str) -> str:
    """Chuẩn hóa số hiệu Điều (bỏ số 0 ở đầu, giữ hậu tố chữ thường nếu có)."""
    match = re.fullmatch(r"(\d+)([a-zA-Z]?)", raw.strip())
    if not match:
        return raw.strip().lower()
    return f"{int(match.group(1))}{match.group(2).lower()}"


def parse_fine_grained_unit_refs(
    text: str,
    self_article: str | None = None,
    self_clause: str | None = None,
    self_point: str | None = None,
) -> list[str]:
    """Trích xuất danh sách mã đơn vị tham chiếu chi tiết dạng 'article[:clause[:point]]' (hỗ trợ cả 'Điều này', 'khoản này')."""
    if not text or not text.strip():
        return []
    norm_self_art = _normalize_article_token(self_article) if self_article else None
    norm_self_clause = str(int(self_clause)) if (self_clause and str(self_clause).isdigit()) else (str(self_clause).strip().lower() if self_clause else None)
    norm_self_point = str(self_point).strip().lower() if self_point else None
    self_exact = (
        f"{norm_self_art}:{norm_self_clause}:{norm_self_point}"
        if (norm_self_art and norm_self_clause and norm_self_point)
        else f"{norm_self_art}:{norm_self_clause}"
        if (norm_self_art and norm_self_clause)
        else norm_self_art
    )

    units: list[str] = []

    def _add_unit(token: str) -> None:
        if token and token != self_exact and token not in units:
            units.append(token)

    for chain_match in _FINE_REF_CHAIN_RE.finditer(text):
        groups_blob, raw_art = chain_match.group(1), chain_match.group(2)
        target_art = norm_self_art if raw_art.casefold() == "này" else _normalize_article_token(raw_art)
        if not target_art:
            continue
        for grp in _SINGLE_GROUP_RE.finditer(groups_blob):
            points_part, single_clause, multi_clauses = grp.group(1), grp.group(2), grp.group(3)
            if points_part and single_clause:
                c_no = str(int(single_clause))
                for p_match in re.finditer(r"(?:điểm\s+|,\s*|và\s+|hoặc\s+)([a-zđ])\b", points_part, re.IGNORECASE):
                    p_id = p_match.group(1).casefold()
                    _add_unit(f"{target_art}:{c_no}:{p_id}")
            elif multi_clauses:
                for c_tok in _CLAUSE_TOKEN_RE.findall(multi_clauses):
                    _add_unit(f"{target_art}:{int(c_tok)}")

    if norm_self_art and norm_self_clause:
        for intra_match in _INTRA_CLAUSE_POINTS_RE.finditer(text):
            points_part = intra_match.group(1)
            for p_match in re.finditer(r"(?:điểm\s+|,\s*|và\s+|hoặc\s+)([a-zđ])\b", points_part, re.IGNORECASE):
                p_id = p_match.group(1).casefold()
                _add_unit(f"{norm_self_art}:{norm_self_clause}:{p_id}")

    # Bổ sung các tham chiếu chỉ nêu cấp Điều (ví dụ: "quy định tại Điều 1 và Điều 2") nếu Điều đó chưa có tham chiếu chi tiết hơn
    covered_arts = {u.split(":", 1)[0] for u in units}
    for span_match in CROSS_REF_SPAN_RE.finditer(text):
        for art_match in MENTIONED_ARTICLE_RE.finditer(span_match.group(0)):
            token = _normalize_article_token(art_match.group(1))
            if token and token != norm_self_art and token not in covered_arts:
                _add_unit(token)

    return units


def extract_text_references(
    text: str,
    self_article: str | None = None,
    self_doc_number: str | None = None,
    self_clause: str | None = None,
    self_point: str | None = None,
) -> dict[str, str]:
    """Trích xuất danh sách Điều được đề cập, Điều tham chiếu chéo, đơn vị chi tiết (Điểm/Khoản/Điều) và văn bản viện dẫn."""
    if not text or not text.strip():
        return {}
    norm_self_art = _normalize_article_token(self_article) if self_article else None
    norm_self_doc = re.sub(r"\s+", "", self_doc_number or "").replace("–", "-").upper()

    mentioned: list[str] = []
    for match in MENTIONED_ARTICLE_RE.finditer(text):
        token = _normalize_article_token(match.group(1))
        if token and token not in mentioned:
            mentioned.append(token)

    fine_units = parse_fine_grained_unit_refs(
        text,
        self_article=self_article,
        self_clause=self_clause,
        self_point=self_point,
    )

    referenced: list[str] = []
    for span_match in CROSS_REF_SPAN_RE.finditer(text):
        for art_match in MENTIONED_ARTICLE_RE.finditer(span_match.group(0)):
            token = _normalize_article_token(art_match.group(1))
            if token and token != norm_self_art and token not in referenced:
                referenced.append(token)
    for unit_tok in fine_units:
        art_part = unit_tok.split(":", 1)[0]
        if art_part and art_part != norm_self_art and art_part not in referenced:
            referenced.append(art_part)
        if art_part and art_part not in mentioned:
            mentioned.append(art_part)

    ref_docs: list[str] = []
    for match in REFERENCED_DOC_NUMBER_RE.finditer(text):
        doc_no = re.sub(r"\s+", "", match.group(1)).replace("–", "-").upper()
        if doc_no and doc_no != norm_self_doc and doc_no not in ref_docs:
            ref_docs.append(doc_no)
    for match in NAMED_LAW_RE.finditer(text):
        law_name = re.sub(r"\s+", " ", match.group(1)).strip()
        if law_name and law_name not in ref_docs and len(ref_docs) < 10:
            ref_docs.append(law_name)

    result: dict[str, str] = {}
    if mentioned:
        result["mentioned_articles"] = ",".join(mentioned[:40])
    if referenced:
        result["referenced_articles"] = ",".join(referenced[:40])
    if fine_units:
        result["referenced_units"] = ",".join(fine_units[:60])
    if ref_docs:
        result["referenced_docs"] = ",".join(ref_docs[:15])
    return result


def _is_mixed_reference_articles(articles: list["LegalArticle"]) -> bool:
    """Kiểm tra danh sách Điều có phải là các trích dẫn rời rạc trong tài liệu chuyên đề hay không.

    Hỗ trợ:
    - Văn bản quy phạm chuẩn (Điều 1..N).
    - Quyết định/Nghị định ban hành kèm Quy định/Quy chế (reset về Điều 1 khi sang Chương I).
    - Tệp PDF Công báo nhiều kỳ nối tiếp (bắt đầu từ Điều k > 1 nhưng có >= 5 Điều tăng tuần tự).
    - Văn bản OCR lớn (>= 5 Điều) có 1-2 Điều bị nhảy số nhỏ hoặc Điều bổ sung (Điều 4a) mà không đánh mất cây phân cấp.
    """
    if len(articles) <= 1:
        return False
    numbers = [int(re.match(r"\d+", article.number).group()) for article in articles]

    # Với tập Điều rất ít (< 5 Điều), giữ kiểm tra tuần tự chặt từ Điều 1 để nhận diện đúng tài liệu Chuyên đề trích dẫn rời rạc
    if len(articles) < 5:
        if numbers[0] != 1:
            return True
        for prev_art, next_art, number, next_number in zip(articles, articles[1:], numbers, numbers[1:]):
            if next_number in (number, number + 1):
                continue
            if next_number == 1 and prev_art.chapter is None and next_art.chapter is not None:
                continue
            return True
        return False

    # Với văn bản có từ 5 Điều trở lên: đánh giá tỷ lệ bước chuyển tăng dần hợp lệ
    valid_transitions = 0
    reset_count = 0
    backward_jumps = 0
    total_transitions = len(numbers) - 1

    for prev_art, next_art, number, next_number in zip(articles, articles[1:], numbers, numbers[1:]):
        diff = next_number - number
        if 0 <= diff <= 5:
            valid_transitions += 1
        elif next_number == 1 and prev_art.chapter is None and next_art.chapter is not None and reset_count == 0:
            reset_count += 1
            valid_transitions += 1
        elif diff < 0:
            backward_jumps += 1

    # Nếu nhảy lùi số Điều bất thường hoặc dưới 80% cặp Điều liền kề tăng tuần tự -> tài liệu trích dẫn hỗn hợp
    if backward_jumps > 0 or (valid_transitions / total_transitions) < 0.80:
        return True
    return False


@dataclass
class LegalPoint:
    """Đơn vị Điểm (ví dụ: a, b, c, đ) trong một Khoản."""
    number: str
    text: str


@dataclass
class LegalClause:
    """Đơn vị Khoản (ví dụ: 1, 2, 3) trong một Điều, có thể chứa danh sách Điểm."""
    number: str
    text: str = ""
    points: list[LegalPoint] = field(default_factory=list)


@dataclass
class LegalArticle:
    """Đơn vị Điều trong văn bản pháp luật, có thể chứa văn bản trực tiếp (Điều đơn) hoặc danh sách Khoản."""
    number: str
    title: str
    chapter: str | None = None
    section: str | None = None
    part: str | None = None
    subsection: str | None = None
    text: str = ""
    clauses: list[LegalClause] = field(default_factory=list)


@dataclass
class ParseResult:
    """Kết quả phân tích cấu trúc văn bản pháp luật cùng cảnh báo rà soát."""
    articles: list[LegalArticle]
    structure_status: str
    needs_review: bool
    warnings: list[str]
    general_lines: list[str] = field(default_factory=list)
    article_lines: list[str] = field(default_factory=list)
    units: list[dict] = field(default_factory=list)


def _append_text(current: object, line: str) -> None:
    """Nối dòng văn bản tiếp theo vào đối tượng pháp lý hiện hành (Điểm, Khoản hoặc Điều)."""
    existing = getattr(current, "text")
    setattr(current, "text", f"{existing}\n{line}" if existing else line)


def parse_legal_text(text: str) -> ParseResult:
    """Phân tích văn bản pháp luật thành cây cấu trúc Chương -> Mục -> Điều -> Khoản -> Điểm.
    
    Không tự ý bịa đặt hoặc suy diễn các đơn vị pháp luật còn thiếu.
    Tự động kiểm tra chất lượng ký tự (lỗi mã hóa OCR, thiếu nội dung) để gắn cờ cần rà soát.
    """
    articles: list[LegalArticle] = []
    general_lines: list[str] = []
    article_lines: list[str] = []
    units: list[dict] = []
    part: str | None = None
    chapter: str | None = None
    section: str | None = None
    subsection: str | None = None
    part_key: str | None = None
    chapter_key: str | None = None
    section_key: str | None = None
    subsection_key: str | None = None
    article_key: str | None = None
    clause_key: str | None = None
    point_key: str | None = None
    current_article: LegalArticle | None = None
    current_clause: LegalClause | None = None
    current_point: LegalPoint | None = None
    warnings: list[str] = []
    pending_general: list[str] = []
    # Lưu trạng thái tiêu đề Phần/Chương/Mục chưa có tên trên cùng dòng (ví dụ: dòng 1 "Chương I", dòng 2 "QUY ĐỊNH CHUNG")
    pending_heading: tuple[str, str, int] | None = None

    def add_unit(kind: str, number: str, title: str, parent: str | None, original: str = "") -> str:
        """Ghi đơn vị theo thứ tự nguồn và khóa cha ổn định trong lần phân tích."""
        key = str(len(units))
        units.append(dict(key=key, parent_key=parent, unit_type=kind, number=number,
                          title=title, original_text=original, sort_order=len(units)))
        return key

    def flush_general() -> None:
        """Lưu đoạn ngoài Điều tại đúng vị trí và cấp cha trong tài liệu."""
        if pending_general:
            add_unit("general", f"general-{len(units)}", "Nội dung ngoài Điều",
                     subsection_key or section_key or chapter_key or part_key,
                     "\n".join(pending_general))
            pending_general.clear()

    for raw_line in text.splitlines():
        raw_stripped = raw_line.strip()
        if not raw_stripped:
            continue
        line = clean_legal_line(raw_stripped)
        if not line:
            if current_article is None:
                general_lines.append(raw_stripped)
            else:
                article_lines.append(raw_stripped)
            continue

        match = PART.match(line)
        if match:
            flush_general()
            numeral = (match.group(1) or match.group(2)).upper()
            title = (match.group(3) or "").strip()
            part = f"Phần {numeral}" + (f". {title}" if title else "")
            part_key = add_unit("part", numeral, title, None, line)
            pending_heading = ("part", numeral, int(part_key)) if not title else None
            chapter = section = subsection = None
            chapter_key = section_key = subsection_key = None
            current_article = current_clause = current_point = None
            general_lines.append(raw_stripped)
            continue

        match = CHAPTER.match(line)
        if match and (match.group(3) or "").strip().lower().startswith(("của ", "trong ", "theo ")):
            match = None
        if match:
            flush_general()
            numeral = (match.group(1) or match.group(2)).upper()
            title = (match.group(3) or "").strip()
            chapter = f"Chương {numeral}" + (f". {title}" if title else "")
            chapter_key = add_unit("chapter", numeral, title, part_key, line)
            pending_heading = ("chapter", numeral, int(chapter_key)) if not title else None
            section = subsection = None
            section_key = subsection_key = None
            current_article = None
            current_clause = None
            current_point = None
            general_lines.append(raw_stripped)
            continue

        match = SECTION.match(line)
        if match:
            flush_general()
            numeral = (match.group(1) or match.group(2)).upper()
            title = (match.group(3) or "").strip()
            section = f"Mục {numeral}" + (f". {title}" if title else "")
            section_key = add_unit("section", numeral, title, chapter_key or part_key, line)
            pending_heading = ("section", numeral, int(section_key)) if not title else None
            subsection = subsection_key = None
            current_article = None
            current_clause = None
            current_point = None
            general_lines.append(raw_stripped)
            continue

        match = SUBSECTION.match(line)
        if match:
            flush_general()
            pending_heading = None
            subsection = line
            subsection_key = add_unit("subsection", match.group(1), match.group(2).strip(), section_key or chapter_key or part_key, line)
            current_article = current_clause = current_point = None
            general_lines.append(raw_stripped)
            continue

        match = ARTICLE.match(line)
        if match:
            flush_general()
            pending_heading = None
            title = (match.group(2) or "").strip()
            current_article = LegalArticle(match.group(1), title, chapter, section, part, subsection)
            articles.append(current_article)
            article_key = add_unit("article", match.group(1), title,
                                   subsection_key or section_key or chapter_key or part_key, line)
            article_lines.append(raw_stripped)
            current_clause = None
            current_point = None
            continue

        if current_article is None:
            # Nếu dòng ngay trước là Phần/Chương/Mục chưa có tiêu đề và dòng hiện tại là tiêu đề in hoa ngắn gọn
            if pending_heading is not None and len(line) <= 140 and (line == line.upper() or not line.endswith(".")):
                h_kind, h_numeral, h_idx = pending_heading
                pending_heading = None
                units[h_idx]["title"] = line
                units[h_idx]["original_text"] += f"\n{line}"
                if h_kind == "part":
                    part = f"Phần {h_numeral}. {line}"
                elif h_kind == "chapter":
                    chapter = f"Chương {h_numeral}. {line}"
                elif h_kind == "section":
                    section = f"Mục {h_numeral}. {line}"
                general_lines.append(raw_stripped)
                continue
            pending_heading = None
            general_lines.append(raw_stripped)
            pending_general.append(line)
            continue

        article_lines.append(raw_stripped)

        match = CLAUSE.match(line)
        if match:
            current_clause = LegalClause(match.group(1), match.group(2).strip())
            current_article.clauses.append(current_clause)
            clause_key = add_unit("clause", match.group(1), "", article_key, line)
            current_point = None
            point_key = None
            continue

        match = POINT.match(line)
        if match and current_clause is not None:
            current_point = LegalPoint(match.group(1).lower(), match.group(2).strip())
            current_clause.points.append(current_point)
            point_key = add_unit("point", match.group(1).lower(), "", clause_key, line)
            continue

        _append_text(current_point or current_clause or current_article, line)
        active_key = point_key if current_point else clause_key if current_clause else article_key
        units[int(active_key)]["original_text"] += f"\n{line}"

    if not articles:
        warnings.append("Không nhận diện được tiêu đề Điều; tài liệu cần rà soát thủ công (scan/OCR hoặc cấu trúc không chuẩn).")
    elif not any(article.text or any(clause.text or clause.points for clause in article.clauses) for article in articles):
        warnings.append("Có tiêu đề Điều nhưng không trích xuất được nội dung; cần rà soát bản scan/OCR.")
    mixed = _is_mixed_reference_articles(articles)
    if not mixed and len(articles) >= 2:
        # Nếu là Quyết định/Nghị định ban hành kèm Quy định (bắt đầu bằng Điều 1..k không Chương, sau đó Chương I reset về Điều 1)
        has_reset = any(
            int(re.match(r"\d+", nxt.number).group()) == 1 and prv.chapter is None and nxt.chapter is not None
            for prv, nxt in zip(articles, articles[1:])
        )
        if has_reset:
            for art in articles:
                if art.chapter is None and art.part is None:
                    art.part = "Phần Quyết định ban hành"
    if mixed:
        warnings.append("Số Điều không tuần tự; tài liệu có thể chứa trích dẫn thay vì Điều luật gốc.")
    if text.count("\ufffd") >= 3 or (text.strip() and sum(char.isalnum() for char in text) / len(text) < 0.25):
        warnings.append("Văn bản có nhiều ký tự lỗi hoặc chất lượng OCR thấp; cần rà soát thủ công.")

    flush_general()

    needs_review = bool(warnings)
    status = "mixed_reference_document" if mixed else "unstructured" if needs_review else "structured"
    return ParseResult(articles, status, needs_review, warnings, general_lines, article_lines, units)
