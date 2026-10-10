"""Bộ phân tích văn bản quy phạm pháp luật Việt Nam theo từng dòng.

Nhận diện cấu trúc phân cấp: Chương -> Mục -> Điều -> Khoản -> Điểm.
Hỗ trợ cả Điều đơn (không có Khoản) và Điều đa Khoản. Tự động phát hiện
các tài liệu scan hoặc lỗi OCR để yêu cầu rà soát thủ công.
"""

import re
from dataclasses import dataclass, field


# Các biểu thức chính quy (Regex) nhận diện đơn vị quy phạm pháp luật chuẩn Việt Nam
CHAPTER = re.compile(r"^Chương\s+([IVXLCDM]+)(?:\s*[.:-]\s*|\s+)?(.*)$", re.IGNORECASE)
SECTION = re.compile(r"^Mục\s+(\d+)(?:\s*[.:-]\s*|\s+)?(.*)$", re.IGNORECASE)
ARTICLE = re.compile(r"^Điều\s+(\d+[a-zA-Z]?)(?:\s*[.:-]\s*|\s+)?(.*)$", re.IGNORECASE)
CLAUSE = re.compile(r"^(\d+)\s*[.]\s+(.+)$")
POINT = re.compile(r"^([a-zđ])\s*[)]\s+(.+)$", re.IGNORECASE)


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
    text: str = ""
    clauses: list[LegalClause] = field(default_factory=list)


@dataclass
class ParseResult:
    """Kết quả phân tích cấu trúc văn bản pháp luật cùng cảnh báo rà soát."""
    articles: list[LegalArticle]
    structure_status: str
    needs_review: bool
    warnings: list[str]


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
    chapter: str | None = None
    section: str | None = None
    current_article: LegalArticle | None = None
    current_clause: LegalClause | None = None
    current_point: LegalPoint | None = None
    warnings: list[str] = []

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue

        match = CHAPTER.match(line)
        if match:
            chapter = f"Chương {match.group(1).upper()}" + (f". {match.group(2).strip()}" if match.group(2).strip() else "")
            section = None
            current_article = None
            current_clause = None
            current_point = None
            continue

        match = SECTION.match(line)
        if match:
            section = f"Mục {match.group(1)}" + (f". {match.group(2).strip()}" if match.group(2).strip() else "")
            current_article = None
            current_clause = None
            current_point = None
            continue

        match = ARTICLE.match(line)
        if match:
            current_article = LegalArticle(match.group(1), match.group(2).strip(), chapter, section)
            articles.append(current_article)
            current_clause = None
            current_point = None
            continue

        if current_article is None:
            continue  # Bỏ qua phần căn cứ, lời nói đầu hoặc chữ ký (không thuộc đơn vị Điều luật).

        match = CLAUSE.match(line)
        if match:
            current_clause = LegalClause(match.group(1), match.group(2).strip())
            current_article.clauses.append(current_clause)
            current_point = None
            continue

        match = POINT.match(line)
        if match and current_clause is not None:
            current_point = LegalPoint(match.group(1).lower(), match.group(2).strip())
            current_clause.points.append(current_point)
            continue

        _append_text(current_point or current_clause or current_article, line)

    if not articles:
        warnings.append("Không nhận diện được tiêu đề Điều; tài liệu cần rà soát thủ công (scan/OCR hoặc cấu trúc không chuẩn).")
    elif not any(article.text or any(clause.text or clause.points for clause in article.clauses) for article in articles):
        warnings.append("Có tiêu đề Điều nhưng không trích xuất được nội dung; cần rà soát bản scan/OCR.")
    if text.count("\ufffd") >= 3 or (text.strip() and sum(char.isalnum() for char in text) / len(text) < 0.25):
        warnings.append("Văn bản có nhiều ký tự lỗi hoặc chất lượng OCR thấp; cần rà soát thủ công.")

    needs_review = bool(warnings)
    return ParseResult(articles, "unstructured" if needs_review else "structured", needs_review, warnings)
