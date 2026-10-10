"""Pipeline trích xuất, phân tích cấu trúc và lập chỉ mục văn bản pháp luật.

Bao gồm cơ chế làm giàu ngữ cảnh cha-con (Parent Context Enrichment),
băm SHA-256 chống trùng lặp, kiểm soát dung lượng tải lên và đánh dấu
cảnh báo các tài liệu dạng scan/OCR kém chất lượng cần rà soát thủ công.
"""

import hashlib
import io
import logging
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from legal.parser import LegalArticle, ParseResult, parse_legal_text
from legal.schema import AccessScope, EffectiveStatus, LegalChunkMetadata


logger = logging.getLogger(__name__)
# Giới hạn kích thước tệp tải lên tối đa là 15 MB
MAX_FILE_BYTES = 15 * 1024 * 1024


class IngestDocumentMetadata(BaseModel):
    """Mô hình dữ liệu metadata bắt buộc khi nạp văn bản quy phạm pháp luật."""
    model_config = ConfigDict(extra="forbid")

    doc_id: UUID = Field(default_factory=uuid4)
    doc_number: str
    doc_title: str
    document_type: Literal["law", "resolution", "decree", "circular"]
    issuing_authority: str
    issued_date: date
    effective_date: date | None = None
    expiry_date: date | None = None
    status_since_date: date | None = None
    effective_status: EffectiveStatus = EffectiveStatus.UNKNOWN
    source_url: str
    scope: AccessScope = AccessScope.INTERNAL

    @field_validator("doc_number", "doc_title", "issuing_authority", "source_url")
    @classmethod
    def nonempty(cls, value: str) -> str:
        """Đảm bảo các trường chuỗi bắt buộc không được để trống hoặc chỉ chứa khoảng trắng."""
        if not value.strip():
            raise ValueError("required legal metadata must not be blank")
        return value.strip()

    @model_validator(mode="after")
    def dates_in_order(self) -> "IngestDocumentMetadata":
        """Kiểm tra tính nhất quán logic thời gian: ngày hết hiệu lực phải sau ngày có hiệu lực."""
        if self.effective_date and self.expiry_date and self.expiry_date < self.effective_date:
            raise ValueError("expiry_date must not precede effective_date")
        if self.effective_date and self.status_since_date and self.status_since_date < self.effective_date:
            raise ValueError("status_since_date must not precede effective_date")
        return self


@dataclass
class IngestResult:
    """Kết quả trả về sau quá trình xử lý nạp và lập chỉ mục văn bản."""
    doc_id: str
    content_hash: str
    status: str
    structure_status: str
    needs_review: bool
    chunk_count: int
    article_count: int
    warnings: list[str]
    # Trả metadata đã dùng để Backend đồng bộ danh mục và giao diện hiển thị kết quả.
    doc_number: str = ""
    doc_title: str = ""
    document_type: str = ""
    issuing_authority: str = ""
    issued_date: str = ""
    effective_date: str | None = None
    effective_status: str = "unknown"
    source_url: str = ""
    scope: str = "internal"
    source_type: str = ""
    raw_text_preview: str = ""


def extract_text(data: bytes, filename: str) -> str:
    """Trích xuất chuỗi văn bản thô từ tệp nhị phân dựa trên phần mở rộng (.txt, .docx, .pdf)."""
    suffix = Path(filename).suffix.lower()
    if suffix == ".txt":
        return data.decode("utf-8-sig")
    if suffix == ".docx":
        from docx import Document

        try:
            document = Document(io.BytesIO(data))
        except Exception as exc:
            raise ValueError("Không đọc được tệp DOCX.") from exc
        lines: list[str] = []
        for block in document.iter_inner_content():
            if hasattr(block, "text") and block.text.strip():
                lines.append(block.text.strip())
            elif hasattr(block, "rows"):
                for row in block.rows:
                    lines.append("\t".join(cell.text for cell in row.cells))
        return "\n".join(lines)
    if suffix == ".pdf":
        try:
            import pdfplumber
        except ImportError:
            from pypdf import PdfReader

            try:
                return "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(data)).pages)
            except Exception as exc:
                raise ValueError("Không đọc được tệp PDF.") from exc
        try:
            with pdfplumber.open(io.BytesIO(data)) as pdf:
                return "\n".join(page.extract_text() or "" for page in pdf.pages)
        except Exception as exc:
            raise ValueError("Không đọc được tệp PDF.") from exc
    raise ValueError("Chỉ hỗ trợ tệp PDF, DOCX hoặc TXT.")


def _prefix(metadata: IngestDocumentMetadata, article: LegalArticle) -> str:
    """Tạo tiền tố ngữ cảnh cha-con (Parent Context Enrichment) cho chunk văn bản.
    
    Định dạng: [{Tên văn bản} {Số hiệu}] [{Chương}] [{Mục}] [Điều {Số}. {Tiêu đề}]
    giúp vector embedding và BM25 giữ trọn vẹn ngữ cảnh của điều khoản con.
    """
    parts = [f"[{metadata.doc_title} {metadata.doc_number}]"]
    if article.chapter:
        parts.append(f"[{article.chapter}]")
    if article.section:
        parts.append(f"[{article.section}]")
    heading = f"Điều {article.number}" + (f". {article.title}" if article.title else "")
    parts.append(f"[{heading}]")
    return " ".join(parts)


def _chunks(parsed: ParseResult, metadata: IngestDocumentMetadata, digest: str, source_type: str):
    """Tách nhỏ văn bản thành các chunk con cấp Điều, Khoản hoặc Điểm kèm metadata chuẩn."""
    for article in parsed.articles:
        prefix = _prefix(metadata, article)
        base = dict(
            doc_id=str(metadata.doc_id),
            doc_number=metadata.doc_number,
            doc_title=metadata.doc_title,
            document_type=metadata.document_type,
            issuing_authority=metadata.issuing_authority,
            issued_date=metadata.issued_date,
            # Ghi ngày lập chỉ mục để thống kê công khai không suy đoán từ ngày ban hành.
            indexed_at=date.today(),
            content_hash=digest,
            chapter=article.chapter,
            article_number=article.number,
            article_title=article.title or None,
            effective_status=metadata.effective_status,
            effective_date=metadata.effective_date,
            expiry_date=metadata.expiry_date,
            status_since_date=metadata.status_since_date,
            source_url=metadata.source_url,
            source_type=source_type,
            scope=metadata.scope,
        )
        if article.text.strip():
            yield f"{prefix}\n{article.text.strip()}", LegalChunkMetadata(**base).to_chroma_metadata()
        for clause in article.clauses:
            clause_base = {**base, "clause_number": clause.number}
            if clause.text.strip():
                yield f"{prefix}\nKhoản {clause.number}. {clause.text.strip()}", LegalChunkMetadata(**clause_base).to_chroma_metadata()
            for point in clause.points:
                point_base = {**clause_base, "point_id": point.number}
                parent_clause = f"Khoản {clause.number}. {clause.text.strip()}" if clause.text.strip() else f"Khoản {clause.number}"
                yield f"{prefix}\n{parent_clause}\nĐiểm {point.number}) {point.text.strip()}", LegalChunkMetadata(**point_base).to_chroma_metadata()


def _semantic_paragraph_chunks(text: str, metadata: IngestDocumentMetadata, digest: str, source_type: str):
    """Gom đoạn văn theo ngữ nghĩa, tối đa 800 từ và lặp lại 80 từ ngữ cảnh."""
    paragraphs: list[str] = []
    lines: list[str] = []
    for raw_line in text.replace("\r\n", "\n").splitlines():
        line = raw_line.strip()
        if not line or re.match(r"^(?:Chương|Phần|Mục|Nghị quyết|Quyết định)\b", line, re.IGNORECASE):
            if lines:
                paragraphs.append(" ".join(lines))
                lines = []
        if line:
            lines.append(line)
    if lines:
        paragraphs.append(" ".join(lines))

    words: list[str] = []
    boundaries: list[int] = []
    for paragraph in paragraphs:
        words.extend(paragraph.split())
        boundaries.append(len(words))

    start = 0
    index = 0

    def emit(parts: list[str], chunk_index: int):
        """Gắn nguồn và định danh ổn định cho từng đoạn dự phòng."""
        chunk_id = f"{metadata.doc_id}:{chunk_index}"
        base = LegalChunkMetadata(
            doc_id=str(metadata.doc_id), doc_number=metadata.doc_number,
            doc_title=metadata.doc_title, document_type=metadata.document_type,
            issuing_authority=metadata.issuing_authority, issued_date=metadata.issued_date,
            indexed_at=date.today(), content_hash=digest,
            effective_status=metadata.effective_status, effective_date=metadata.effective_date,
            expiry_date=metadata.expiry_date, status_since_date=metadata.status_since_date,
            source_url=metadata.source_url, source_type=source_type, scope=metadata.scope,
        ).to_chroma_metadata()
        base.update(chunk_id=chunk_id, structure_status="unstructured_fallback")
        prefix = f"[{metadata.doc_title} {metadata.doc_number}]"
        return f"{prefix}\n" + "\n\n".join(parts), base

    while start < len(words):
        remaining = len(words) - start
        if remaining <= 800:
            end = len(words)
        else:
            # Giữ ít nhất 400 từ cho chunk cuối và ưu tiên ranh giới đoạn gần 600 từ.
            latest = min(start + 800, len(words) - 320)
            target = min(start + 600, latest)
            candidates = [boundary for boundary in boundaries if start + 400 <= boundary <= latest]
            end = min(candidates, key=lambda boundary: abs(boundary - target)) if candidates else target
        pieces = []
        cursor = start
        for boundary in boundaries:
            if boundary <= cursor:
                continue
            section_end = min(boundary, end)
            pieces.append(" ".join(words[cursor:section_end]))
            cursor = section_end
            if cursor == end:
                break
        yield emit(pieces, index)
        if end == len(words):
            break
        start = end - 80
        index += 1


def ingest_file(data: bytes, filename: str, metadata: IngestDocumentMetadata, collection,
                force_paragraph: bool = False, source_type: str | None = None) -> IngestResult:
    """Nạp và lập chỉ mục văn bản pháp luật vào ChromaDB.
    
    Thực hiện kiểm tra tính hợp lệ: kích thước tệp, tính băm SHA256 chống trùng lặp,
    phân tích cấu trúc phân cấp, ngăn chặn tài liệu scan/OCR lỗi và lưu trữ vector.
    """
    if not data:
        raise ValueError("Tệp tải lên rỗng.")
    if len(data) > MAX_FILE_BYTES:
        raise ValueError("Tệp vượt quá giới hạn 15 MB.")
    resolved_source_type = source_type or Path(filename).suffix.lower().lstrip(".")
    if resolved_source_type not in ("pdf", "docx", "txt", "web"):
        raise ValueError("Loại nguồn tài liệu không hợp lệ.")
    digest = hashlib.sha256(data).hexdigest()
    existing = collection.get(where={"content_hash": digest}, limit=1, include=["metadatas"])
    if existing.get("ids"):
        existing_meta = (existing.get("metadatas") or [{}])[0] or {}
        # Đếm các bản ghi đã lưu để lần nạp lại không báo sai số chunk bằng 0.
        stored = collection.get(where={"content_hash": digest}, include=["metadatas"])
        stored_metadata = stored.get("metadatas") or []
        article_count = len({str(item["article_number"]) for item in stored_metadata
                             if item and item.get("article_number")})
        structure_status = existing_meta.get("structure_status") or "structured"
        return IngestResult(existing_meta.get("doc_id", str(metadata.doc_id)), digest, "duplicate", structure_status,
                            structure_status == "unstructured_fallback", len(stored.get("ids") or []), article_count, [],
                            **{key: existing_meta.get(key) or "" for key in ("doc_number", "doc_title", "document_type", "issuing_authority", "issued_date", "source_url", "scope")},
                            effective_date=existing_meta.get("effective_date") or None,
                            effective_status=existing_meta.get("effective_status") or "unknown",
                            source_type=existing_meta.get("source_type") or resolved_source_type)

    text = extract_text(data, filename)
    parsed = parse_legal_text(text)
    # Gắn thông tin nhận diện vào mọi trạng thái để không cần đọc lại tài liệu gốc.
    result_metadata = dict(doc_number=metadata.doc_number, doc_title=metadata.doc_title,
                           document_type=metadata.document_type, issuing_authority=metadata.issuing_authority,
                           issued_date=metadata.issued_date.isoformat(),
                           effective_date=metadata.effective_date.isoformat() if metadata.effective_date else None,
                           effective_status=metadata.effective_status.value, source_url=metadata.source_url,
                           scope=metadata.scope.value, source_type=resolved_source_type)
    # Chỉ quản trị viên xác nhận mới được đưa văn bản thiếu cấu trúc vào kho vector.
    chunks = list(_chunks(parsed, metadata, digest, resolved_source_type)) if not parsed.needs_review and not force_paragraph else []
    fallback = force_paragraph or not chunks
    if fallback:
        clean_text = text.strip()
        usable = (len(clean_text.split()) >= 5 and clean_text.count("\ufffd") < 3
                  and sum(char.isalnum() for char in clean_text) / len(clean_text) >= 0.25) if clean_text else False
        if not usable:
            logger.warning("Văn bản cần rà soát chất lượng trước khi lập chỉ mục.")
            warnings = [*parsed.warnings, "Nội dung trích xuất quá ít hoặc bị lỗi OCR; cần cung cấp bản đọc được."]
            return IngestResult(str(metadata.doc_id), digest, "needs_review", "unstructured", True, 0,
                                len(parsed.articles), warnings, raw_text_preview=clean_text[:4000], **result_metadata)
        if not force_paragraph:
            return IngestResult(str(metadata.doc_id), digest, "needs_review", "unstructured", True, 0,
                                len(parsed.articles), parsed.warnings, raw_text_preview=clean_text[:4000], **result_metadata)
        chunks = list(_semantic_paragraph_chunks(clean_text, metadata, digest, resolved_source_type))
        if not chunks:
            raise ValueError("Không tạo được đoạn văn bản để lập chỉ mục.")

    collection.add(
        ids=[f"{metadata.doc_id}:{index}" for index in range(len(chunks))],
        documents=[content for content, _ in chunks],
        metadatas=[meta for _, meta in chunks],
    )
    if fallback:
        logger.warning("Văn bản đã được lập chỉ mục theo đoạn văn và cần rà soát cấu trúc.")
        warnings = [*parsed.warnings, "Đã phân đoạn theo đoạn văn; cần rà soát cấu trúc văn bản."]
        return IngestResult(str(metadata.doc_id), digest, "indexed", "unstructured_fallback", True,
                            len(chunks), len(parsed.articles), warnings, **result_metadata)
    return IngestResult(str(metadata.doc_id), digest, "indexed", "structured", False,
                        len(chunks), len(parsed.articles), [], **result_metadata)
