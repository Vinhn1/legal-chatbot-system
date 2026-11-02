"""Pipeline trích xuất, phân tích cấu trúc và lập chỉ mục văn bản pháp luật.

Bao gồm cơ chế làm giàu ngữ cảnh cha-con (Parent Context Enrichment),
băm SHA-256 chống trùng lặp, kiểm soát dung lượng tải lên và đánh dấu
cảnh báo các tài liệu dạng scan/OCR kém chất lượng cần rà soát thủ công.
"""

from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import logging
import os
import random
import re
import threading
import time
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Callable, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from legal.parser import (
    CHAPTER,
    PART,
    SECTION,
    SUBSECTION,
    LegalArticle,
    ParseResult,
    clean_legal_line,
    extract_text_references,
    parse_legal_text,
    repair_vietnamese_pdf_spacing,
)
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
    coverage: float = 0.0
    units: list[dict] | None = None


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
        candidates: list[str] = []
        # Ưu tiên pypdfium2 vì bảo toàn dấu tiếng Việt tốt hơn trên font Công báo
        try:
            import pypdfium2 as pdfium

            pdf_doc = pdfium.PdfDocument(data)
            try:
                pdfium_pages: list[str] = []
                for idx in range(len(pdf_doc)):
                    page = pdf_doc[idx]
                    textpage = page.get_textpage()
                    pdfium_pages.append((textpage.get_text_range() or "").replace("\r\n", "\n").replace("\r", "\n"))
                joined_pdfium = "\n".join(pdfium_pages)
                if joined_pdfium.strip():
                    candidates.append(joined_pdfium)
            finally:
                pdf_doc.close()
        except Exception:
            pass

        try:
            import pdfplumber

            with pdfplumber.open(io.BytesIO(data)) as pdf:
                plumber_txt = "\n".join(page.extract_text() or "" for page in pdf.pages)
                if plumber_txt.strip() or not candidates:
                    candidates.append(plumber_txt)
        except ImportError:
            if not candidates:
                from pypdf import PdfReader

                try:
                    candidates.append("\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(data)).pages))
                except Exception as exc:
                    raise ValueError("Không đọc được tệp PDF.") from exc
        except Exception as exc:
            if not candidates:
                raise ValueError("Không đọc được tệp PDF.") from exc

        if not candidates:
            return ""
        # Chọn bản trích xuất có độ dài từ vựng tốt và ít bị tách rời âm tiết hơn, sau đó chuẩn hóa khoảng trắng âm tiết
        best_raw = max(candidates, key=lambda item: len(repair_vietnamese_pdf_spacing(item).strip()))
        return repair_vietnamese_pdf_spacing(best_raw)
    raise ValueError("Chỉ hỗ trợ tệp PDF, DOCX hoặc TXT.")


def _normalize_doc_code(doc_number: str) -> str:
    """Chuẩn hóa số hiệu văn bản dùng làm tiền tố mã định danh chunk (unit_code)."""
    return re.sub(r"\s+", "", doc_number or "").replace("–", "-").upper()


def _normalize_unit_part(raw: str) -> str:
    """Chuẩn hóa số hiệu Điều/Khoản trong unit_code."""
    match = re.fullmatch(r"(\d+)([a-zA-Z]?)", str(raw or "").strip())
    if not match:
        return str(raw or "").strip().lower()
    return f"{int(match.group(1))}{match.group(2).lower()}"


def _hierarchical_headers(metadata: IngestDocumentMetadata, article: LegalArticle) -> list[str]:
    """Xây dựng danh sách dòng tiêu đề ngữ cảnh cha từ cấp Văn bản -> Phần -> Chương -> Mục -> Điều."""
    headers = [f"[Văn bản: {metadata.doc_title} ({metadata.doc_number})]"]
    if article.part:
        headers.append(f"[{article.part}]")
    if article.chapter:
        headers.append(f"[{article.chapter}]")
    if article.section:
        headers.append(f"[{article.section}]")
    if article.subsection:
        headers.append(f"[{article.subsection}]")
    heading = f"Điều {article.number}" + (f": {article.title}" if article.title else "")
    headers.append(f"[{heading}]")
    return headers


def _prefix(metadata: IngestDocumentMetadata, article: LegalArticle) -> str:
    """Tạo khối tiền tố ngữ cảnh cha-con (Hierarchical Parent Context) cho chunk văn bản."""
    return "\n".join(_hierarchical_headers(metadata, article))


def _chunks(parsed: ParseResult, metadata: IngestDocumentMetadata, digest: str, source_type: str):
    """Tách văn bản theo cấu trúc phân cấp Chương -> Điều -> Khoản -> Điểm kèm ngữ cảnh cha đầy đủ."""
    doc_code = _normalize_doc_code(metadata.doc_number)
    for article in parsed.articles:
        prefix = _prefix(metadata, article)
        article_intro = article.text.strip()
        norm_art = _normalize_unit_part(article.number)
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
            part=article.part,
            chapter=f"{article.part} / {article.chapter}" if article.part and article.chapter else article.chapter or article.part,
            section=article.section or article.subsection,
            subsection=article.subsection,
            article_number=article.number,
            article_title=article.title or None,
            parent_context=prefix,
            effective_status=metadata.effective_status,
            effective_date=metadata.effective_date,
            expiry_date=metadata.expiry_date,
            status_since_date=metadata.status_since_date,
            source_url=metadata.source_url,
            source_type=source_type,
            scope=metadata.scope,
        )
        if not article.clauses:
            body_text = article_intro
            refs = extract_text_references(
                body_text,
                self_article=article.number,
                self_doc_number=metadata.doc_number,
            )
            art_meta = {
                **base,
                "unit_type": "article",
                "unit_code": f"{doc_code}:{norm_art}",
                **refs,
            }
            if body_text:
                yield f"{prefix}\nNội dung chi tiết: {body_text}", LegalChunkMetadata(**art_meta).to_chroma_metadata()
            else:
                yield prefix, LegalChunkMetadata(**art_meta).to_chroma_metadata()
            continue

        for clause in article.clauses:
            clause_body = clause.text.strip()
            norm_clause = _normalize_unit_part(clause.number)
            enriched_clause = (
                f"{article_intro}\nKhoản {clause.number}. {clause_body}"
                if (article_intro and clause_body)
                else f"Khoản {clause.number}. {clause_body}"
                if clause_body
                else f"{article_intro}\nKhoản {clause.number}"
                if article_intro
                else f"Khoản {clause.number}"
            )
            clause_parent_ctx = f"{prefix}\n[Khoản {clause.number}]"
            clause_refs = extract_text_references(
                enriched_clause,
                self_article=article.number,
                self_doc_number=metadata.doc_number,
                self_clause=clause.number,
            )
            clause_base = {
                **base,
                "clause_number": clause.number,
                "unit_type": "clause",
                "unit_code": f"{doc_code}:{norm_art}:{norm_clause}",
                "parent_context": clause_parent_ctx,
                **clause_refs,
            }
            if clause_body or not clause.points:
                yield (
                    f"{clause_parent_ctx}\nNội dung chi tiết: {enriched_clause}",
                    LegalChunkMetadata(**clause_base).to_chroma_metadata(),
                )

            # Ghép nguyên văn khung dẫn nhập / mức phạt tiền của Khoản cha vào tiền tố của từng Điểm con
            clause_frame_parts = [part_txt for part_txt in (article_intro, clause_body) if part_txt]
            clause_frame_inline = " ".join(" ".join(clause_frame_parts).split())
            clause_frame_header = (
                f"[Khoản {clause.number}: {clause_frame_inline}]"
                if clause_frame_inline
                else f"[Khoản {clause.number}]"
            )
            point_parent_ctx = f"{prefix}\n{clause_frame_header}"

            for point in clause.points:
                point_detail = f"Điểm {point.number}) {point.text.strip()}"
                point_refs = extract_text_references(
                    f"{clause_frame_inline}\n{point_detail}" if clause_frame_inline else point_detail,
                    self_article=article.number,
                    self_doc_number=metadata.doc_number,
                    self_clause=clause.number,
                    self_point=point.number,
                )
                point_base = {
                    **base,
                    "clause_number": clause.number,
                    "point_id": point.number,
                    "unit_type": "point",
                    "unit_code": f"{doc_code}:{norm_art}:{norm_clause}:{point.number}",
                    "parent_context": point_parent_ctx,
                    **point_refs,
                }
                yield (
                    f"{point_parent_ctx}\nNội dung chi tiết: {point_detail}",
                    LegalChunkMetadata(**point_base).to_chroma_metadata(),
                )


TOPIC_HEADING = re.compile(
    r"^(?:ĐỀ\s*MỤC|Đề\s*mục)(?:\s+thứ\s+(nhất|nhì|hai|ba|tư|bốn|năm|sáu|bảy|tám|chín|mười)|(?:\s+(?:số|thứ))?\s+([IVXLCDM]+|\d+))(?:\b\s*[.:-]\s*|\b\s+|\b$)(.*)$",
    re.IGNORECASE,
)


def _semantic_paragraph_chunks(text: str, metadata: IngestDocumentMetadata, digest: str, source_type: str):
    """Chia đoạn tại tiêu đề phân cấp và gắn ngữ cảnh Phần/Mục cùng tham chiếu chéo cho mỗi chunk."""
    segments: list[tuple[list[str], str | None, str | None]] = []
    lines: list[str] = []
    part: str | None = None
    chapter: str | None = None
    section: str | None = None

    def flush_segment() -> None:
        """Lưu đoạn trước khi chuyển sang tiêu đề phân cấp kế tiếp."""
        if any(line.strip() for line in lines):
            segments.append((lines.copy(), chapter, section))
        lines.clear()

    for raw_line in text.replace("\r\n", "\n").splitlines():
        raw_stripped = raw_line.strip()
        if not raw_stripped:
            lines.append("")
            continue
        line = clean_legal_line(raw_stripped) or raw_stripped
        part_match = PART.match(line)
        chapter_match = CHAPTER.match(line)
        if chapter_match:
            ch_title = (chapter_match.group(3) if len(chapter_match.groups()) >= 3 else chapter_match.group(2) or "").strip().lower()
            if ch_title.startswith(("của ", "trong ", "theo ")):
                chapter_match = None
        section_match = SECTION.match(line) or SUBSECTION.match(line) or TOPIC_HEADING.match(line)
        if part_match or chapter_match or section_match:
            flush_segment()
            if part_match:
                part = line
                chapter = part
                section = None
            elif chapter_match:
                chapter = f"{part} / {line}" if part else line
                section = None
            else:
                chapter = chapter or "Nội dung chung"
                section = line
        lines.append(line)
    flush_segment()

    index = 0
    for segment_lines, segment_chapter, segment_section in segments:
        paragraphs: list[str] = []
        paragraph_lines: list[str] = []
        for line in segment_lines:
            if not line and paragraph_lines:
                paragraphs.append(" ".join(paragraph_lines))
                paragraph_lines = []
            elif line:
                paragraph_lines.append(line)
        if paragraph_lines:
            paragraphs.append(" ".join(paragraph_lines))
        words: list[str] = []
        boundaries: list[int] = []
        for paragraph in paragraphs:
            words.extend(paragraph.split())
            boundaries.append(len(words))
        start = 0
        while start < len(words):
            remaining = len(words) - start
            if remaining <= 800:
                end = len(words)
            else:
                # Giữ ít nhất 400 từ ở đoạn cuối và ưu tiên ranh giới gần 600 từ.
                latest = min(start + 800, len(words) - 320)
                target = min(start + 600, latest)
                candidates = [boundary for boundary in boundaries if start + 400 <= boundary <= latest]
                end = min(candidates, key=lambda boundary: abs(boundary - target)) if candidates else target
            pieces: list[str] = []
            cursor = start
            for boundary in boundaries:
                if boundary <= cursor:
                    continue
                section_end = min(boundary, end)
                pieces.append(" ".join(words[cursor:section_end]))
                cursor = section_end
                if cursor == end:
                    break
            body_joined = "\n\n".join(pieces)
            prefix = f"[Văn bản: {metadata.doc_title} ({metadata.doc_number})]"
            if segment_chapter:
                prefix += f" [{segment_chapter}]"
            if segment_section:
                prefix += f" [{segment_section}]"
            refs = extract_text_references(body_joined, self_article=None, self_doc_number=metadata.doc_number)
            base = LegalChunkMetadata(
                doc_id=str(metadata.doc_id), doc_number=metadata.doc_number,
                doc_title=metadata.doc_title, document_type=metadata.document_type,
                issuing_authority=metadata.issuing_authority, issued_date=metadata.issued_date,
                indexed_at=date.today(), content_hash=digest,
                chapter=segment_chapter, section=segment_section,
                unit_type="paragraph", parent_context=prefix,
                effective_status=metadata.effective_status, effective_date=metadata.effective_date,
                expiry_date=metadata.expiry_date, status_since_date=metadata.status_since_date,
                source_url=metadata.source_url, source_type=source_type, scope=metadata.scope,
                **refs,
            ).to_chroma_metadata()
            base.update(chunk_id=f"{metadata.doc_id}:{index}", structure_status="unstructured_fallback")
            yield f"{prefix}\n{body_joined}", base
            index += 1
            if end == len(words):
                break
            start = end - 80


def _extract_genai_text(response) -> str:
    """Đọc văn bản an toàn từ phản hồi Gemini kể cả khi bị ngắt sớm hoặc thiếu thuộc tính text."""
    try:
        if getattr(response, "text", None):
            return str(response.text).strip()
    except Exception:
        pass
    parts_text: list[str] = []
    for candidate in getattr(response, "candidates", None) or []:
        content = getattr(candidate, "content", None)
        for part in getattr(content, "parts", None) or []:
            text_val = getattr(part, "text", None)
            if isinstance(text_val, str) and text_val.strip():
                parts_text.append(text_val.strip())
    return "\n".join(parts_text).strip()


def _is_usable_ocr_output(text: str) -> bool:
    """Kiểm tra văn bản OCR thực sự chứa nội dung pháp lý thay vì thông báo trang trắng."""
    cleaned = text.strip()
    if len(cleaned.split()) < 15:
        return False
    lowered = cleaned.lower()
    refusal_phrases = (
        "trang trắng",
        "không chứa nội dung văn bản",
        "không có nội dung để trích xuất",
        "tệp pdf rỗng",
    )
    if len(cleaned.split()) < 40 and any(phrase in lowered for phrase in refusal_phrases):
        return False
    return True


def _strip_ocr_markdown(text: str) -> str:
    """Làm sạch ký hiệu định dạng Markdown và nhãn phân tách trang trong văn bản OCR nhưng giữ nguyên ngắt dòng."""
    out_lines: list[str] = []
    for raw in text.replace("\r\n", "\n").splitlines():
        stripped = raw.strip()
        if not stripped:
            if out_lines and out_lines[-1] != "":
                out_lines.append("")
            continue
        if stripped.startswith("```"):
            continue
        if re.match(r"^-{2,}\s*TRANG\s+\d+.*$", stripped, re.IGNORECASE):
            continue
        cleaned = clean_legal_line(stripped)
        if cleaned:
            out_lines.append(cleaned)
    return "\n".join(out_lines).strip()


def _is_batch_output_complete(cleaned_ocr: str, page_count: int, min_words_per_page: int) -> bool:
    """Kiểm tra lô nhiều trang có trích xuất đủ mật độ chữ hay bị mô hình dừng sớm làm rơi trang sau."""
    if not _is_usable_ocr_output(cleaned_ocr):
        return False
    if page_count <= 1 or min_words_per_page <= 0:
        return True
    return len(cleaned_ocr.split()) >= page_count * min_words_per_page


def _response_hit_max_tokens(response) -> bool:
    """Kiểm tra phản hồi Gemini có bị ngắt sớm do chạm ngưỡng max_output_tokens hay không."""
    for candidate in getattr(response, "candidates", None) or []:
        reason = str(getattr(candidate, "finish_reason", "") or "").upper()
        if "MAX_TOKENS" in reason:
            return True
    return False


def _slice_pdf_pages_from_reader(reader, indices: list[int]) -> bytes:
    """Tạo tệp PDF con chứa danh sách trang chỉ định từ đối tượng PdfReader trên luồng chính."""
    from pypdf import PdfWriter

    writer = PdfWriter()
    for idx in indices:
        writer.add_page(reader.pages[idx])
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def _slice_pdf_pages_threadsafe(data: bytes, indices: list[int]) -> bytes:
    """Tạo tệp PDF con độc lập cho luồng con khi cần chia nhỏ lô OCR để thử lại."""
    from pypdf import PdfReader

    local_reader = PdfReader(io.BytesIO(data))
    return _slice_pdf_pages_from_reader(local_reader, indices)


def _render_pdf_pages_as_jpeg(data: bytes, indices: list[int], dpi: int = 150) -> dict[int, bytes]:
    """Chuyển các trang PDF scan sang ảnh xám JPEG nén nhẹ để tăng tốc OCR và tránh lỗi ServerError."""
    if not indices:
        return {}
    doc = None
    try:
        import pypdfium2 as pdfium

        doc = pdfium.PdfDocument(data)
        scale = max(1.2, dpi / 72.0)
        rendered: dict[int, bytes] = {}
        for idx in indices:
            page = doc[idx]
            bitmap = page.render(scale=scale)
            pil_image = bitmap.to_pil().convert("L")
            buf = io.BytesIO()
            pil_image.save(buf, format="JPEG", quality=82, optimize=True)
            rendered[idx] = buf.getvalue()
        return rendered
    except Exception as exc:
        logger.debug("Không thể render trang PDF sang JPEG, chuyển về chế độ cắt trang PDF: %s", type(exc).__name__)
        return {}
    finally:
        if doc is not None:
            try:
                doc.close()
            except Exception:
                pass


def ocr_pdf_bytes(
    data: bytes,
    filename: str = "",
    on_progress: Callable[[int, int], None] | None = None,
) -> str:
    """Nhận diện đầy đủ toàn bộ các trang tiếng Việt từ tệp PDF scan bằng AI OCR theo lô."""
    if not data:
        raise ValueError("Tệp tải lên rỗng.")
    if len(data) > MAX_FILE_BYTES:
        raise ValueError("Tệp vượt quá giới hạn 15 MB.")
    if Path(filename).suffix.lower() != ".pdf":
        extracted = extract_text(data, filename).strip()
        if len(extracted.split()) >= 10:
            if on_progress is not None:
                on_progress(1, 1)
            return extracted
        raise ValueError("Tệp tải lên phải là định dạng PDF hợp lệ.")

    try:
        from pypdf import PdfReader
    except ImportError as exc:
        raise ValueError("Chưa cài đặt thư viện hỗ trợ đọc tệp PDF.") from exc

    try:
        reader = PdfReader(io.BytesIO(data))
        total_pages = len(reader.pages)
    except Exception as exc:
        raise ValueError("Tệp tải lên phải là định dạng PDF hợp lệ.") from exc
    if total_pages == 0:
        raise ValueError("Tệp tải lên phải là định dạng PDF hợp lệ.")
    if total_pages > 100:
        raise ValueError("Tệp PDF vượt quá giới hạn 100 trang cho phép xử lý OCR.")

    # Tầng 0: Kiểm tra lớp văn bản số hóa trên từng trang để hỗ trợ cả PDF thuần chữ và PDF lai trang scan
    native_pages: dict[int, str] = {}
    raw_native: dict[int, str] = {}
    try:
        for idx in range(total_pages):
            page_txt = (reader.pages[idx].extract_text() or "").strip()
            raw_native[idx] = page_txt
            if (
                len(page_txt) > 0
                and len(page_txt.split()) >= 25
                and page_txt.count("\ufffd") < 3
                and sum(ch.isalnum() for ch in page_txt) / len(page_txt) >= 0.25
            ):
                native_pages[idx] = page_txt
        if native_pages and len(native_pages) >= max(1, int(total_pages * 0.8)):
            for idx in range(total_pages):
                if idx not in native_pages:
                    tail_txt = raw_native.get(idx, "")
                    if len(tail_txt.split()) >= 5 and tail_txt.count("\ufffd") == 0:
                        native_pages[idx] = tail_txt
        if len(native_pages) == total_pages:
            if on_progress is not None:
                on_progress(total_pages, total_pages)
            return repair_vietnamese_pdf_spacing("\n\n".join(native_pages[i] for i in range(total_pages)).strip())
    except Exception:
        native_pages.clear()

    if on_progress is not None:
        on_progress(len(native_pages), total_pages)

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key and not os.getenv("PYTHON_DOTENV_DISABLED"):
        try:
            from dotenv import load_dotenv
            base_dir = Path(__file__).resolve().parents[1]
            load_dotenv(base_dir / ".env")
            load_dotenv(base_dir.parent / ".env")
            load_dotenv(base_dir.parent / "backend" / ".env")
            api_key = os.getenv("GEMINI_API_KEY")
        except Exception:
            pass
    if not api_key:
        raise ValueError("Chưa cấu hình GEMINI_API_KEY để chạy AI OCR.")
    try:
        from google import genai
        from google.genai import types as genai_types
    except ImportError as exc:
        raise ValueError("Chưa cài đặt thư viện hỗ trợ AI OCR.") from exc

    model_name = os.getenv("GEMINI_MODEL") or "gemini-2.5-flash-lite"
    supports_large_output = any(tag in model_name for tag in ("2.5", "2.0", "3."))
    max_output_tokens = 16384 if supports_large_output else 8192
    # Giảm kích thước lô mặc định xuống 2 trang để ngăn mô hình dừng sớm bỏ sót trang ở các Nghị định dày chữ
    batch_size = max(1, int(os.getenv("OCR_BATCH_SIZE") or ("2" if supports_large_output else "1")))
    min_words_per_page = max(0, int(os.getenv("OCR_MIN_WORDS_PER_PAGE", "110")))
    retry_base_delay = max(0.01, float(os.getenv("OCR_RETRY_BASE_DELAY", "1.4")))

    safety = [
        genai_types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="BLOCK_NONE"),
        genai_types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="BLOCK_NONE"),
        genai_types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="BLOCK_NONE"),
        genai_types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="BLOCK_NONE"),
    ]
    prompt = (
        "Bạn là chuyên gia số hóa văn bản quy phạm pháp luật Việt Nam. "
        "Hãy đọc toàn bộ tất cả các trang văn bản đính kèm theo đúng thứ tự từ đầu đến cuối và trích xuất ĐẦY ĐỦ, NGUYÊN VĂN 100% "
        "nội dung tiếng Việt, không tóm tắt, không lược bỏ bất kỳ Điều, Khoản, Điểm nào. "
        "Trình bày văn bản thuần túy (plain text) theo đúng thể thức: Cơ quan ban hành, Số hiệu, Ngày tháng năm ban hành, "
        "Tên văn bản, mỗi tiêu đề Phần, Chương, Mục, Điều, Khoản, Điểm đặt trên dòng riêng "
        "(ví dụ: 'Chương I', 'NHỮNG QUY ĐỊNH CHUNG', 'Điều 1. Phạm vi điều chỉnh', '1. ...', 'a) ...'). "
        "TUYỆT ĐỐI KHÔNG dùng ký hiệu định dạng Markdown như **, __, #, ``` và không thêm lời bình luận."
    )

    # Tầng 1: Ưu tiên chuyển trang scan sang ảnh JPEG thang xám một lần trên RAM để tránh lỗi PDF rasterizer phía server
    scan_indices = [idx for idx in range(total_pages) if idx not in native_pages]
    page_jpegs = _render_pdf_pages_as_jpeg(data, scan_indices, dpi=150)

    batches: list[tuple[list[int], bytes | None]] = []
    contiguous: list[int] = []
    for idx in scan_indices:
        if contiguous and (idx != contiguous[-1] + 1 or len(contiguous) >= batch_size):
            fallback_pdf = None if len(page_jpegs) == len(scan_indices) else _slice_pdf_pages_from_reader(reader, contiguous)
            batches.append((contiguous, fallback_pdf))
            contiguous = []
        contiguous.append(idx)
    if contiguous:
        fallback_pdf = None if len(page_jpegs) == len(scan_indices) else _slice_pdf_pages_from_reader(reader, contiguous)
        batches.append((contiguous, fallback_pdf))

    refusal_phrases = (
        "trang trắng",
        "không chứa nội dung văn bản",
        "không có nội dung để trích xuất",
        "tệp pdf rỗng",
    )

    # Tái sử dụng một phiên kết nối Gemini duy nhất và tắt thinking_budget cho tác vụ OCR thuần túy
    shared_client = genai.Client(api_key=api_key)
    config_kwargs: dict = {
        "temperature": 0.0,
        "max_output_tokens": max_output_tokens,
        "safety_settings": safety,
    }
    if "2.5" in model_name and hasattr(genai_types, "ThinkingConfig"):
        try:
            config_kwargs["thinking_config"] = genai_types.ThinkingConfig(thinking_budget=0)
        except Exception:
            pass
    gen_config = genai_types.GenerateContentConfig(**config_kwargs)

    progress_lock = threading.Lock()
    completed_pages = len(native_pages)

    def _mark_pages_done(count: int) -> None:
        nonlocal completed_pages
        if on_progress is None or count <= 0:
            return
        with progress_lock:
            completed_pages = min(total_pages, completed_pages + count)
            current_done = completed_pages
        try:
            on_progress(current_done, total_pages)
        except Exception:
            pass

    def _build_contents(indices: list[int], subset_bytes: bytes | None) -> list:
        batch_prompt = prompt
        if len(indices) > 1:
            batch_prompt = (
                f"{prompt} Lưu ý bắt buộc: Lô này gồm ĐÚNG {len(indices)} trang liên tiếp "
                f"(từ trang {indices[0] + 1} đến trang {indices[-1] + 1}). "
                f"Phải đọc và trích xuất đầy đủ toàn bộ {len(indices)} trang cho tới dòng cuối cùng của trang {indices[-1] + 1}, "
                "tuyệt đối không dừng sớm sau trang đầu."
            )
        if all(idx in page_jpegs for idx in indices):
            parts = [
                genai_types.Part.from_bytes(data=page_jpegs[idx], mime_type="image/jpeg")
                for idx in indices
            ]
            parts.append(batch_prompt)
            return parts
        pdf_chunk = subset_bytes if subset_bytes is not None else _slice_pdf_pages_threadsafe(data, indices)
        return [
            genai_types.Part.from_bytes(data=pdf_chunk, mime_type="application/pdf"),
            batch_prompt,
        ]

    def _ocr_batch(indices: list[int], subset_bytes: bytes | None = None, initial_delay: float = 0.0) -> str:
        """Nhận diện một lô trang với kiểm tra mật độ chữ chống sót trang và chia nhỏ xuống 1 trang khi cần."""
        if initial_delay > 0:
            time.sleep(initial_delay)
        contents = _build_contents(indices, subset_bytes)
        last_err: Exception | None = None
        for attempt in range(3):
            if attempt > 0:
                jitter = random.uniform(0.05, min(0.45, retry_base_delay * 0.5))
                time.sleep((retry_base_delay * (2 ** (attempt - 1))) + jitter)
            try:
                response = shared_client.models.generate_content(
                    model=model_name,
                    contents=contents,
                    config=gen_config,
                )
                raw_ocr = _extract_genai_text(response)
                cleaned_ocr = _strip_ocr_markdown(raw_ocr)
                if len(indices) > 1 and (
                    _response_hit_max_tokens(response)
                    or not _is_batch_output_complete(cleaned_ocr, len(indices), min_words_per_page)
                ):
                    logger.info(
                        "Tách lô OCR %s xuống từng trang đơn để chống sót chữ (%d từ / %d trang).",
                        indices,
                        len(cleaned_ocr.split()),
                        len(indices),
                    )
                    mid = len(indices) // 2
                    left_text = _ocr_batch(indices[:mid])
                    right_text = _ocr_batch(indices[mid:])
                    return "\n\n".join(part for part in (left_text, right_text) if part).strip()
                if len(indices) == 1 and not _is_usable_ocr_output(cleaned_ocr):
                    _mark_pages_done(1)
                    lowered = cleaned_ocr.lower()
                    if any(phrase in lowered for phrase in refusal_phrases):
                        return ""
                    return cleaned_ocr
                _mark_pages_done(len(indices))
                return cleaned_ocr
            except Exception as exc:
                last_err = exc
        if len(indices) > 1:
            logger.warning("Chia nhỏ lô OCR (%s) sau lỗi tạm thời: %s", indices, type(last_err).__name__)
            mid = len(indices) // 2
            left_text = _ocr_batch(indices[:mid])
            right_text = _ocr_batch(indices[mid:])
            return "\n\n".join(part for part in (left_text, right_text) if part).strip()
        _mark_pages_done(1)
        logger.warning("Không OCR được trang đơn lẻ %s: %s", indices, type(last_err).__name__)
        return ""

    batch_texts_by_start: dict[int, str] = {}
    batch_lengths_by_start: dict[int, int] = {group[0]: len(group) for group, _ in batches}
    if len(batches) == 1:
        group, subset = batches[0]
        batch_texts_by_start[group[0]] = _ocr_batch(group, subset)
    elif batches:
        max_workers = min(3, len(batches))
        stagger_step = min(0.2, retry_base_delay * 0.15)
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [
                (
                    group[0],
                    executor.submit(
                        _ocr_batch,
                        group,
                        subset,
                        (batch_idx % max_workers) * stagger_step if batch_idx < max_workers else 0.0,
                    ),
                )
                for batch_idx, (group, subset) in enumerate(batches)
            ]
            for start_page, future in futures:
                batch_texts_by_start[start_page] = future.result()

    assembled_parts: list[str] = []
    cursor = 0
    while cursor < total_pages:
        if cursor in native_pages:
            if native_pages[cursor].strip():
                assembled_parts.append(native_pages[cursor].strip())
            cursor += 1
        elif cursor in batch_lengths_by_start:
            chunk_txt = batch_texts_by_start.get(cursor, "").strip()
            if chunk_txt:
                assembled_parts.append(chunk_txt)
            cursor += batch_lengths_by_start[cursor]
        else:
            cursor += 1

    combined_text = repair_vietnamese_pdf_spacing("\n\n".join(assembled_parts).strip())
    if _is_usable_ocr_output(combined_text):
        return combined_text

    raise ValueError(
        "Không nhận diện được chữ tiếng Việt rõ ràng từ tệp PDF scan này. Vui lòng dán nội dung văn bản trực tiếp vào ô bên dưới."
    )


def ingest_file(data: bytes, filename: str, metadata: IngestDocumentMetadata, collection,
                force_paragraph: bool = False, source_type: str | None = None,
                override_text: str | None = None) -> IngestResult:
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
    raw_text = override_text if (override_text and override_text.strip()) else extract_text(data, filename)
    text = repair_vietnamese_pdf_spacing(raw_text)
    parsed = parse_legal_text(text)
    source_length = sum(len(line.strip()) for line in text.splitlines() if line.strip())
    article_coverage = sum(map(len, parsed.article_lines)) / source_length if source_length else 0.0
    legacy_ids: list[str] = []
    existing = collection.get(where={"content_hash": digest}, limit=1, include=["metadatas"])
    if existing.get("ids"):
        existing_meta = (existing.get("metadatas") or [{}])[0] or {}
        # Đếm các bản ghi đã lưu để lần nạp lại không báo sai số chunk bằng 0.
        stored = collection.get(where={"content_hash": digest}, include=["metadatas"])
        stored_metadata = stored.get("metadatas") or []
        legacy_ids = [chunk_id for chunk_id, item in zip(stored.get("ids") or [], stored_metadata)
                      if not item or "coverage" not in item]
        if legacy_ids:
            # Giữ nguyên định danh tài liệu khi sửa chỉ mục cũ thiếu dấu kiểm tra bao phủ.
            metadata = metadata.model_copy(update={"doc_id": UUID(existing_meta["doc_id"])})
        else:
            article_count = len(parsed.articles)
            structure_status = existing_meta.get("structure_status") or "structured"
            return IngestResult(existing_meta.get("doc_id", str(metadata.doc_id)), digest, "duplicate", structure_status,
                                structure_status != "structured", len(stored.get("ids") or []), article_count, parsed.warnings,
                                **{key: existing_meta.get(key) or "" for key in ("doc_number", "doc_title", "document_type", "issuing_authority", "issued_date", "source_url", "scope")},
                                effective_date=existing_meta.get("effective_date") or None,
                                effective_status=existing_meta.get("effective_status") or "unknown",
                                source_type=existing_meta.get("source_type") or resolved_source_type,
                                coverage=float(existing_meta.get("coverage") or 0), units=parsed.units)

    # Gắn thông tin nhận diện vào mọi trạng thái để không cần đọc lại tài liệu gốc.
    result_metadata = dict(doc_number=metadata.doc_number, doc_title=metadata.doc_title,
                           document_type=metadata.document_type, issuing_authority=metadata.issuing_authority,
                           issued_date=metadata.issued_date.isoformat(),
                           effective_date=metadata.effective_date.isoformat() if metadata.effective_date else None,
                           effective_status=metadata.effective_status.value, source_url=metadata.source_url,
                           scope=metadata.scope.value, source_type=resolved_source_type)
    clean_text = text.strip()
    usable = (len(clean_text.split()) >= 5 and clean_text.count("\ufffd") < 3
              and sum(char.isalnum() for char in clean_text) / len(clean_text) >= 0.25) if clean_text else False
    if not usable:
        logger.warning("Văn bản cần rà soát chất lượng trước khi lập chỉ mục.")
        warnings = [*parsed.warnings, "Nội dung trích xuất quá ít hoặc bị lỗi OCR; cần cung cấp bản đọc được."]
        return IngestResult(str(metadata.doc_id), digest, "needs_review", "unstructured", True, 0,
                            len(parsed.articles), warnings, raw_text_preview=clean_text[:4000],
                            coverage=0.0, units=parsed.units, **result_metadata)

    # Dòng nguồn ngoài Điều luôn được phân đoạn riêng để không thất thoát phần dẫn nhập.
    mixed = parsed.structure_status == "mixed_reference_document"
    has_valid_articles = bool(parsed.articles) and not mixed and (
        parsed.structure_status == "structured" or article_coverage >= 0.50
    )
    use_articles = bool(parsed.articles) and not mixed and (not force_paragraph or has_valid_articles)
    chunks = list(_chunks(parsed, metadata, digest, resolved_source_type)) if use_articles else []
    general_text = "\n".join(parsed.general_lines) if use_articles else text
    if general_text.strip():
        chunks.extend(_semantic_paragraph_chunks(general_text, metadata, digest, resolved_source_type))
    if not chunks:
        raise ValueError("Không tạo được đoạn văn bản để lập chỉ mục.")
    coverage = (sum(map(len, parsed.article_lines)) + sum(map(len, parsed.general_lines))) / source_length if source_length else 0.0
    if coverage < 0.95:
        raise ValueError("Độ bao phủ văn bản thấp; dừng lập chỉ mục để tránh mất dữ liệu.")
    fallback = not use_articles
    hybrid = (use_articles and article_coverage < 0.50) or mixed
    structure_status = "mixed_reference_document" if mixed else "unstructured_fallback" if fallback else "hybrid" if hybrid else "structured"
    needs_review = parsed.needs_review or fallback or hybrid
    warnings = list(parsed.warnings)
    if hybrid and not mixed:
        warnings.append("Đã lập chỉ mục bổ sung nội dung ngoài Điều; cần rà soát cấu trúc.")
    ids = [f"{metadata.doc_id}:{'repair:' if legacy_ids else ''}{index}" for index in range(len(chunks))]
    for index, (_, chunk_meta) in enumerate(chunks):
        chunk_meta["chunk_id"] = ids[index]
        chunk_meta["structure_status"] = structure_status
        chunk_meta["coverage"] = coverage

    payload = dict(ids=ids, documents=[content for content, _ in chunks],
                   metadatas=[meta for _, meta in chunks])
    if legacy_ids:
        collection.upsert(**payload)
        collection.delete(ids=legacy_ids)
    else:
        collection.add(**payload)
    return IngestResult(str(metadata.doc_id), digest, "indexed", structure_status, needs_review,
                        len(chunks), len(parsed.articles), warnings, coverage=coverage,
                        units=parsed.units, **result_metadata)
