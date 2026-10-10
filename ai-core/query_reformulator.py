"""Trích xuất số hiệu và đơn vị quy phạm được nêu rõ trong câu hỏi."""

import re
from dataclasses import dataclass


_DOC_NUMBER = re.compile(
    r"(?<!\d)(\d{1,4}\s*/\s*\d{4}\s*/\s*[A-ZÀ-ỸĐ0-9]+(?:[-–][A-ZÀ-ỸĐ0-9]+)*)(?![\w/])",
    re.IGNORECASE,
)
_ARTICLE = re.compile(r"\bđiều\s+(\d+[a-z]?)\b", re.IGNORECASE)
_CLAUSE = re.compile(r"\bkhoản\s+(\d+)\b", re.IGNORECASE)
_DOCUMENT_TYPES = {
    "nghị định": "decree",
    "nghị quyết": "resolution",
    "thông tư": "circular",
    "luật": "law",
}


@dataclass(frozen=True)
class LegalReferences:
    """Các định danh pháp lý mà người hỏi đã chỉ định tường minh."""

    doc_number: str | None = None
    article_number: str | None = None
    clause_number: str | None = None
    document_type: str | None = None

    @property
    def has_exact_target(self) -> bool:
        """Cho biết câu hỏi có đủ dấu hiệu để ưu tiên khớp metadata chính xác."""
        return any((self.doc_number, self.article_number, self.clause_number))


def normalize_doc_number(value: str) -> str:
    """Chuẩn hóa khoảng trắng, dấu gạch nối và chữ hoa trong số hiệu văn bản."""
    return re.sub(r"\s+", "", value).replace("–", "-").upper()


def normalize_unit_number(value: str) -> str:
    """Quy về cùng biểu diễn số Điều/Khoản kể cả khi người hỏi thêm số không ở đầu."""
    match = re.fullmatch(r"(\d+)([a-z]?)", value, re.IGNORECASE)
    if not match:
        return value.casefold()
    return f"{int(match.group(1))}{match.group(2).casefold()}"


def extract_legal_references(question: str) -> LegalReferences:
    """Tách số hiệu, Điều, Khoản và loại văn bản mà không suy diễn định danh còn thiếu."""
    number = _DOC_NUMBER.search(question)
    article = _ARTICLE.search(question)
    clause = _CLAUSE.search(question)
    lowered = question.casefold()
    document_type = next((kind for label, kind in _DOCUMENT_TYPES.items() if label in lowered), None)
    return LegalReferences(
        doc_number=normalize_doc_number(number.group(1)) if number else None,
        article_number=normalize_unit_number(article.group(1)) if article else None,
        clause_number=normalize_unit_number(clause.group(1)) if clause else None,
        document_type=document_type,
    )


def reformulate_query(question, chat_history=None, gemini_client=None, gemini_model=None):
    """Giữ nguyên câu hỏi gốc để hệ truy xuất tự xử lý định danh pháp lý."""
    return question, False
