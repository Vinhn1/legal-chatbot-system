"""API tra cứu và nạp văn bản pháp luật có kiểm soát quyền truy cập."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from datetime import date
from hmac import compare_digest
import io
import json
import logging
import os
import re
import threading
import time
from pathlib import Path
from typing import Optional
from uuid import uuid4

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from pydantic import BaseModel, ValidationError

from dotenv import load_dotenv

from legal.ingest import IngestDocumentMetadata, MAX_FILE_BYTES, TOPIC_HEADING, ingest_file, ocr_pdf_bytes
from legal.metadata_extractor import readable_document_number
from legal.parser import CHAPTER, PART, SECTION, SUBSECTION, clean_legal_line
from legal.security import detect_prompt_injection, validate_public_url, validate_upload
from legal.url_ingest import build_document_metadata, ingest_from_url
from rag_pipeline import AIServiceError, LegalRAG, GeminiLegalEmbeddingFunction
from legal.runtime_config import RuntimeConfig, load_config, save_config
from legal.corpus_revision import corpus_mutation


BASE_DIR = Path(__file__).resolve().parent
# Nạp biến môi trường từ thư mục hiện hành và thư mục gốc của dự án
load_dotenv(BASE_DIR / ".env")
load_dotenv(BASE_DIR.parent / ".env")

CONFIG_PATH = BASE_DIR / "rag_config.json"
_enable_docs = os.getenv("FASTAPI_DOCS", "false").lower() in ("true", "1")
app = FastAPI(
    title="Legal Document AI Service",
    docs_url="/docs" if _enable_docs else None,
    redoc_url="/redoc" if _enable_docs else None,
    openapi_url="/openapi.json" if _enable_docs else None,
)
logger = logging.getLogger(__name__)
bot = LegalRAG()


class MessageModel(BaseModel):
    role: str
    message: str


class ChatRequest(BaseModel):
    message: str
    history: Optional[list[MessageModel]] = None
    model_provider: Optional[str] = None
    model_api_key: Optional[str] = None


class ChatResponse(BaseModel):
    answer: str
    sources: list
    citations: list = []
    suggested_questions: list[str] = []
    images: list[str] = []
    is_fallback: bool = False
    config_version: str | None = None
    model_version: str | None = None


# Hợp đồng cấu hình dùng chung với pipeline, tránh validate khác nhau.
ConfigModel = RuntimeConfig


class EmbeddingConfigModel(BaseModel):
    api_key: Optional[str] = None
    api_keys: Optional[list[str]] = None


async def require_internal_token(x_internal_token: str | None = Header(default=None)) -> None:
    expected = os.getenv("AI_CORE_INTERNAL_TOKEN")
    if not expected:
        raise HTTPException(status_code=503, detail="Chưa cấu hình xác thực nội bộ AI Core.")
    if not x_internal_token or not compare_digest(x_internal_token, expected):
        raise HTTPException(status_code=401, detail="Token nội bộ không hợp lệ.")


@app.get("/health")
def health_check():
    return {"status": "ok", "knowledge_count": bot.collection.count()}


def summarize_public_collection(collection):
    """Thống kê văn bản public theo định danh, không tiết lộ metadata nội bộ."""
    rows = collection.get(where={"scope": "public"}, include=["metadatas"])
    documents = {}
    articles = set()
    indexed_dates = []
    for metadata in rows.get("metadatas") or []:
        if not isinstance(metadata, dict) or metadata.get("scope") != "public":
            continue
        doc_id = metadata.get("doc_id") or metadata.get("doc_number")
        if not doc_id:
            continue
        documents[doc_id] = {
            "title": metadata.get("doc_title") or "Văn bản pháp luật",
            "doc_number": metadata.get("doc_number") or "",
        }
        if metadata.get("article_number"):
            articles.add((doc_id, str(metadata["article_number"])))
        indexed_at = metadata.get("indexed_at")
        if isinstance(indexed_at, str):
            try:
                indexed_dates.append(date.fromisoformat(indexed_at))
            except ValueError:
                pass
    samples = sorted(documents.values(), key=lambda item: (item["title"], item["doc_number"]))[:4]
    return {
        "document_count": len(documents),
        "article_count": len(articles),
        "last_updated": max(indexed_dates).isoformat() if indexed_dates else None,
        "documents": samples,
    }


@app.get("/legal/public-summary")
def public_summary():
    """Xuất thống kê an toàn cho cổng tra cứu không yêu cầu đăng nhập."""
    return summarize_public_collection(bot.collection)


@app.post("/chat", response_model=ChatResponse, dependencies=[Depends(require_internal_token)])
def chat(request: ChatRequest, x_internal_token: str | None = Header(default=None)):
    # Chỉ backend đã xác thực nội bộ mới được chỉ định khóa mô hình cho yêu cầu.
    if request.model_provider or request.model_api_key:
        expected = os.getenv("AI_CORE_INTERNAL_TOKEN")
        if not expected or not isinstance(x_internal_token, str) or not compare_digest(x_internal_token, expected):
            raise HTTPException(status_code=401, detail="Không được phép chọn mô hình AI.")
    # Chặn yêu cầu thao túng vai trò trước khi truy xuất hoặc gọi mô hình.
    warning = detect_prompt_injection(request.message)
    if warning:
        raise HTTPException(status_code=400, detail=warning)
    try:
        result = bot.answer_question(
            request.message,
            history=request.history,
            **({"model_provider": request.model_provider or "gemini", "model_api_key": request.model_api_key}
               if request.model_provider or request.model_api_key else {}),
        )
        answer, sources, suggestions, images = result
        return ChatResponse(
            answer=answer,
            sources=sources,
            citations=getattr(result, "citations", []),
            suggested_questions=suggestions,
            images=images,
            config_version=getattr(result, "config_version", None),
            model_version=getattr(result, "model_version", None),
        )
    except AIServiceError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


class VerifyCitationsRequest(BaseModel):
    """Danh sách ID cần đọc lại trực tiếp từ kho vector."""

    chunk_ids: list[str]


@app.post("/legal/citations/verify")
async def verify_citations(request: VerifyCitationsRequest, x_internal_token: str | None = Header(default=None)):
    """Trả metadata và nguyên văn từ ChromaDB cho Backend xác thực độc lập."""
    await require_internal_token(x_internal_token)
    ids = list(dict.fromkeys(item for item in request.chunk_ids if isinstance(item, str) and item.strip()))[:20]
    if not ids:
        return {"sources": []}
    data = bot.collection.get(ids=ids, include=["documents", "metadatas"])
    sources = []
    for chunk_id, content, metadata in zip(data.get("ids") or [], data.get("documents") or [], data.get("metadatas") or []):
        if not isinstance(metadata, dict) or metadata.get("scope") != "public" or not isinstance(content, str):
            continue
        sources.append({"chunk_id": chunk_id, "content": content, "doc_number": metadata.get("doc_number", ""),
                        "title": metadata.get("doc_title", ""), "article_number": metadata.get("article_number", ""),
                        "clause_number": metadata.get("clause_number", ""), "point_id": metadata.get("point_id", ""),
                        "url": metadata.get("source_url", ""), "chapter": metadata.get("chapter", ""),
                        "issued_date": metadata.get("issued_date", ""), "effective_status": metadata.get("effective_status", "unknown")})
    return {"sources": sources}


@app.get("/suggestions")
def get_suggestions():
    return []


@app.post('/legal/retrieval/invalidate', dependencies=[Depends(require_internal_token)])
def invalidate_retrieval():
    """Dùng sau khi đối soát hoặc sửa corpus bằng công cụ vận hành ngoài API nạp/xóa."""
    bot.retriever.invalidate()
    return {'success': True}


@app.get("/config", dependencies=[Depends(require_internal_token)])
def get_config():
    try:
        return load_config().model_dump()
    except (ValueError, OSError):
        raise HTTPException(status_code=503, detail="Không thể đọc cấu hình RAG hợp lệ.")


@app.post("/config", dependencies=[Depends(require_internal_token)])
def update_config(config: ConfigModel):
    try:
        save_config(config)
    except ValueError:
        raise HTTPException(status_code=422, detail="Chỉ dẫn nghiệp vụ không hợp lệ.")
    except OSError:
        raise HTTPException(status_code=503, detail="Không thể ghi cấu hình RAG.")
    return config.model_dump()


@app.post("/legal/embedding-config", dependencies=[Depends(require_internal_token)])
def update_embedding_config(config: EmbeddingConfigModel):
    """Cập nhật danh sách khóa API Embedding trực tiếp vào bộ nhớ runtime của AI Core."""
    keys: list[str] = []
    if config.api_keys:
        keys.extend([k.strip() for k in config.api_keys if isinstance(k, str) and k.strip()])
    if config.api_key:
        keys.extend([k.strip() for k in config.api_key.split(",") if k.strip()])
    if not keys:
        raise HTTPException(status_code=400, detail="Thiếu khóa API Embedding.")
    success = bot.update_embedding_keys(keys)
    active_count = len(getattr(bot.embedding_function, "api_keys", []))
    return {"success": success, "active_key_count": active_count}


@app.post("/legal/embedding-test", dependencies=[Depends(require_internal_token)])
def test_embedding_config(payload: EmbeddingConfigModel):
    """Kiểm tra khả năng tạo vector embedding với khóa API được cung cấp hoặc khóa hiện hành."""
    key = (payload.api_key or "").strip()
    if not key and payload.api_keys:
        key = payload.api_keys[0].strip()
    if not key and hasattr(bot.embedding_function, "api_key"):
        key = bot.embedding_function.api_key
    if not key:
        raise HTTPException(status_code=400, detail="Chưa có khóa API để kiểm tra.")
    started = time.time()
    try:
        dim = getattr(bot.embedding_function, "output_dimensionality", 768)
        model_name = (os.getenv("LEGAL_EMBEDDING_MODEL") or "gemini-embedding-001").strip()
        test_fn = GeminiLegalEmbeddingFunction(api_key=[key], model_name=model_name, output_dimensionality=dim)
        vecs = test_fn(["Kiểm tra kết nối embedding pháp lý."])
        if not vecs or len(vecs) == 0:
            raise ValueError("Không tạo được vector từ khóa API này.")
        return {"ok": True, "latency_ms": int((time.time() - started) * 1000)}
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:200], "latency_ms": int((time.time() - started) * 1000)}


@app.get("/documents", dependencies=[Depends(require_internal_token)])
def get_documents():
    data = bot.collection.get(include=["metadatas"])
    metas = data.get("metadatas") or []
    ids = data.get("ids") or []
    legacy_ids = [chunk_id for chunk_id, meta in zip(ids, metas)
                  if isinstance(meta, dict) and not meta.get("chapter") and not meta.get("section")]
    contents_by_id = {}
    for offset in range(0, len(legacy_ids), 500):
        legacy_data = bot.collection.get(ids=legacy_ids[offset:offset + 500], include=["documents"])
        contents_by_id.update(zip(legacy_data.get("ids") or [], legacy_data.get("documents") or []))
    legacy_outline: dict[str, tuple[str | None, str | None]] = {}
    current_outline: dict[str, tuple[str | None, str | None]] = {}

    def chunk_order(item):
        """Sắp chunk theo tài liệu và thứ tự đoạn đã lập chỉ mục."""
        chunk_id, meta = item[:2]
        suffix = str(chunk_id).rsplit(":", 1)[-1]
        safe_meta = meta if isinstance(meta, dict) else {}
        return str(safe_meta.get("doc_id") or ""), int(suffix) if suffix.isdigit() else 0

    # Chỉ suy ra nhãn từ nội dung đối với chunk cũ chưa có metadata phân cấp.
    records = sorted(((chunk_id, meta, contents_by_id.get(chunk_id, "")) for chunk_id, meta in zip(ids, metas)), key=chunk_order)
    for chunk_id, meta, content in records:
        if not isinstance(meta, dict) or meta.get("chapter") or meta.get("section"):
            continue
        doc_key = str(meta.get("doc_id") or meta.get("doc_number") or meta.get("doc_title") or "")
        chapter, section = current_outline.get(doc_key, (None, None))
        for line in str(content or "").splitlines()[1:]:
            heading = clean_legal_line(line)
            if not heading:
                continue
            part_match = PART.match(heading)
            chapter_match = CHAPTER.match(heading)
            section_match = SECTION.match(heading) or TOPIC_HEADING.match(heading)
            subsection_match = SUBSECTION.match(heading)
            if part_match:
                numeral = (part_match.group(1) or part_match.group(2)).upper()
                chapter, section = f"Phần {numeral}", None
            elif chapter_match:
                ch_title = (chapter_match.group(3) if len(chapter_match.groups()) >= 3 else chapter_match.group(2) or "").strip().lower()
                if not ch_title.startswith(("của ", "trong ", "theo ")):
                    numeral = (chapter_match.group(1) or chapter_match.group(2)).upper()
                    chapter, section = f"Chương {numeral}", None
            elif section_match:
                section = heading[:80] if len(heading.split()) <= 12 else heading
            elif subsection_match:
                section = f"{subsection_match.group(1)}."
        current_outline[doc_key] = (chapter, section)
        legacy_outline[str(chunk_id)] = (chapter, section)
    by_doc = {}
    doc_type_map = {
        "law": "Luật",
        "decree": "Nghị định",
        "circular": "Thông tư",
        "resolution": "Nghị quyết",
    }
    for chunk_id, meta in sorted(zip(ids, metas), key=chunk_order):
        if not isinstance(meta, dict):
            continue
        doc_key = meta.get("doc_id") or meta.get("doc_number") or meta.get("doc_title")
        if not doc_key:
            continue
        if doc_key not in by_doc:
            raw_type = meta.get("document_type") or "Luật"
            title = meta.get("doc_title") or meta.get("source_title") or "Văn bản pháp luật"
            raw_number = str(meta.get("doc_number") or "")
            display_number = (readable_document_number(title, "document", title)
                              if raw_number.startswith("CHUA-XAC-DINH-") else raw_number)
            is_topic = bool(re.match(r"^(?:Chuyên đề|Sổ tay|Giáo trình)\b", title, re.IGNORECASE))
            by_doc[doc_key] = {
                "id": str(meta.get("doc_id") or doc_key),
                "contentHash": str(meta.get("content_hash") or ""),
                "docNumber": display_number,
                "title": title,
                "docType": "Chuyên đề" if is_topic else doc_type_map.get(raw_type, raw_type),
                "issuer": meta.get("issuing_authority") or "Cơ quan ban hành",
                "issuedDate": meta.get("issued_date") or "",
                "effectiveDate": meta.get("effective_date") or "",
                "effectiveStatus": meta.get("effective_status") or "active",
                "pipelineStatus": "indexed",
                "scope": meta.get("scope") or "public",
                "sourceUrl": meta.get("source_url") or "",
                "source_type": meta.get("source_type") or "",
                "chunkCount": 0,
                "structureStatus": meta.get("structure_status") or "",
                "coverage": float(meta.get("coverage") or 0),
                "_articles": set(),
                "_chapters": {},
            }
        doc_entry = by_doc[doc_key]
        doc_entry["chunkCount"] += 1
        doc_entry["coverage"] = max(doc_entry["coverage"], float(meta.get("coverage") or 0))
        if meta.get("structure_status") == "mixed_reference_document":
            doc_entry["structureStatus"] = "mixed_reference_document"
        art_num = meta.get("article_number")
        art_title = meta.get("article_title") or ""
        inferred_chapter, inferred_section = legacy_outline.get(str(chunk_id), (None, None))
        raw_chapter = meta.get("chapter") or inferred_chapter
        if raw_chapter and not (PART.match(raw_chapter) or CHAPTER.match(raw_chapter) or " / " in raw_chapter or raw_chapter in ("Nội dung chung", "Quy định chung")):
            raw_chapter = None
        chapter = raw_chapter
        section = meta.get("section") or inferred_section
        if (chapter or section or art_num) and not chapter:
            chapter = "Nội dung chung" if section else "Quy định chung"
        if chapter:
            chapter_entry = doc_entry["_chapters"].setdefault(chapter, {"articles": set(), "sections": set(), "chunkCount": 0})
            chapter_entry["chunkCount"] += 1
            if section:
                chapter_entry["sections"].add(section)
        if art_num:
            doc_entry["_articles"].add(str(art_num))
            art_label = f"Điều {art_num}" + (f": {art_title}" if art_title else "")
            chapter_entry["articles"].add(art_label)

    result = []
    for doc in by_doc.values():
        chapters_list = []
        for ch_title, details in doc["_chapters"].items():
            chapters_list.append({
                "title": ch_title,
                "articles": sorted(details["articles"]),
                "sections": sorted(details["sections"]),
                "chunkCount": details["chunkCount"],
            })
        result.append({
            "id": doc["id"],
            "contentHash": doc["contentHash"],
            "name": doc["title"],
            "docNumber": doc["docNumber"],
            "title": doc["title"],
            "docType": doc["docType"],
            "issuer": doc["issuer"],
            "issuedDate": doc["issuedDate"],
            "effectiveDate": doc["effectiveDate"],
            "effectiveStatus": doc["effectiveStatus"],
            "pipelineStatus": doc["pipelineStatus"],
            "articleCount": len(doc["_articles"]),
            "chunkCount": doc["chunkCount"],
            "structureStatus": doc["structureStatus"],
            "coverage": doc["coverage"],
            "scope": doc["scope"],
            "sourceUrl": doc["sourceUrl"],
            "source_type": doc["source_type"],
            "chapters": chapters_list,
        })
    return result


@app.get("/documents/{doc_id}/chunks", dependencies=[Depends(require_internal_token)])
def get_document_chunks(doc_id: str, limit: int = Query(default=300, ge=1, le=1000)):
    """Trả danh sách các đoạn văn bản đã lập chỉ mục của một tài liệu theo đúng thứ tự lưu trữ."""
    safe_id = doc_id.strip()
    if not safe_id or len(safe_id) > 120:
        raise HTTPException(status_code=400, detail="Mã tài liệu không hợp lệ.")
    data = bot.collection.get(where={"doc_id": safe_id}, include=["documents", "metadatas"])
    ids = data.get("ids") or []
    docs = data.get("documents") or []
    metas = data.get("metadatas") or []

    def sort_key(row):
        cid = str(row[0])
        suffix = cid.rsplit(":", 1)[-1]
        return int(suffix) if suffix.isdigit() else 0

    ordered = sorted(zip(ids, docs, metas), key=sort_key)
    items = []
    for idx, (cid, raw_doc, raw_meta) in enumerate(ordered):
        meta = raw_meta if isinstance(raw_meta, dict) else {}
        text_val = str(raw_doc or "").strip()
        raw_lines = text_val.splitlines()
        body_idx = 0
        while body_idx < len(raw_lines):
            candidate_line = raw_lines[body_idx].strip()
            if candidate_line.startswith("[") and candidate_line.endswith("]"):
                body_idx += 1
            else:
                break
        if 0 < body_idx < len(raw_lines):
            stripped_body = "\n".join(raw_lines[body_idx:]).strip()
            if stripped_body.startswith("Nội dung chi tiết:"):
                stripped_body = stripped_body[len("Nội dung chi tiết:") :].strip()
            if stripped_body:
                text_val = stripped_body
        items.append({
            "chunkId": str(cid),
            "index": idx + 1,
            "unitType": str(meta.get("unit_type") or "paragraph"),
            "chapter": str(meta.get("chapter") or ""),
            "section": str(meta.get("section") or ""),
            "articleNumber": str(meta.get("article_number") or ""),
            "articleTitle": str(meta.get("article_title") or ""),
            "clauseNumber": str(meta.get("clause_number") or ""),
            "pointId": str(meta.get("point_id") or ""),
            "content": text_val,
        })
    return {
        "docId": safe_id,
        "total": len(items),
        "chunks": items[:limit],
    }


@app.delete("/documents", dependencies=[Depends(require_internal_token)])
def delete_document(name: str = Query(...)):
    """Xóa theo ID ổn định; không nuốt lỗi hoặc xóa hàng loạt theo tên trùng."""
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", name):
        raise HTTPException(status_code=400, detail="Chỉ xóa bằng ID tài liệu.")
    try:
        rows = bot.collection.get(where={"doc_id": name}, include=["metadatas"])
        hashes = {meta.get("content_hash", "") for meta in rows.get("metadatas") or [] if isinstance(meta, dict)}
        with corpus_mutation(bot.retriever):
            bot.collection.delete(where={"doc_id": name})
    except Exception:
        raise HTTPException(status_code=503, detail="Chưa xác nhận xóa tài liệu khỏi kho vector.")
    return {"success": True, "deleted": bool(rows.get("ids")), "document_id": name,
            "content_hash": next(iter(hashes)) if len(hashes) == 1 else None}





from legal.metadata_extractor import auto_extract_metadata


@app.post("/legal/extract-metadata", dependencies=[Depends(require_internal_token)])
async def extract_legal_metadata(file: UploadFile = File(...)):
    """Tự động bóc tách thông tin phân loại & metadata của văn bản bằng AI và Heuristic."""
    data = file.file.read(MAX_FILE_BYTES + 1)
    file.file.close()
    try:
        safe_name = validate_upload(data, file.filename or "")
        extracted = auto_extract_metadata(data, safe_name)
    except (ValueError, UnicodeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return extracted


@app.post("/legal/ocr", dependencies=[Depends(require_internal_token)])
async def ocr_legal_document(file: UploadFile = File(...)):
    """Nhận diện văn bản tiếng Việt và metadata từ tệp PDF scan bằng AI đa phương thức."""
    data = file.file.read(MAX_FILE_BYTES + 1)
    file.file.close()
    try:
        safe_name = validate_upload(data, file.filename or "")
        text = ocr_pdf_bytes(data, safe_name)
        stem = safe_name.rsplit(".", 1)[0] if "." in safe_name else safe_name
        extracted = auto_extract_metadata(text.encode("utf-8"), f"{stem}.txt")
    except (ValueError, UnicodeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"text": text, "metadata": extracted}


# Bộ điều phối tác vụ AI OCR chạy ngầm độc lập với luồng hội thoại chatbot
_OCR_JOB_EXECUTOR = ThreadPoolExecutor(max_workers=2)
_OCR_JOBS_LOCK = threading.Lock()
_OCR_JOBS: dict[str, dict] = {}
_OCR_JOB_TTL_SECONDS = 7200
_OCR_JOB_MAX_ITEMS = 60


def _prune_old_ocr_jobs_locked() -> None:
    """Giải phóng các tác vụ chạy ngầm đã hoàn tất quá hạn để tránh rò rỉ bộ nhớ."""
    now = time.time()
    expired = [
        jid
        for jid, row in _OCR_JOBS.items()
        if row.get("status") in ("completed", "needs_review", "failed")
        and now - float(row.get("updated_at") or now) > _OCR_JOB_TTL_SECONDS
    ]
    for jid in expired:
        _OCR_JOBS.pop(jid, None)
    if len(_OCR_JOBS) > _OCR_JOB_MAX_ITEMS:
        finished = sorted(
            (
                (float(row.get("updated_at") or 0), jid)
                for jid, row in _OCR_JOBS.items()
                if row.get("status") in ("completed", "needs_review", "failed")
            )
        )
        for _, jid in finished[: max(0, len(_OCR_JOBS) - _OCR_JOB_MAX_ITEMS)]:
            _OCR_JOBS.pop(jid, None)


def _count_pdf_pages_fast(data: bytes, filename: str) -> int:
    """Đếm nhanh số trang tệp PDF trước khi đưa vào hàng đợi OCR chạy ngầm."""
    if not filename.lower().endswith(".pdf"):
        return 1
    try:
        from pypdf import PdfReader

        return max(1, len(PdfReader(io.BytesIO(data)).pages))
    except Exception:
        return 1


def _compose_ocr_ingest_metadata(
    extracted: dict,
    ocr_text: str,
    safe_name: str,
    source_url: str,
    scope: str,
    raw_metadata_json: str,
) -> IngestDocumentMetadata:
    """Hợp nhất metadata nhận diện từ OCR với trường do quản trị viên cung cấp (nếu có)."""
    fields = IngestDocumentMetadata.model_fields
    normalized: dict = {k: v for k, v in extracted.items() if k in fields and v is not None}
    fallback_title = safe_name.rsplit(".", 1)[0] if "." in safe_name else safe_name
    normalized["doc_title"] = normalized.get("doc_title") or fallback_title
    normalized["doc_number"] = normalized.get("doc_number") or readable_document_number(
        ocr_text, safe_name, normalized["doc_title"]
    )
    normalized["issuing_authority"] = normalized.get("issuing_authority") or "Chưa xác định"
    resolved_url = validate_public_url(source_url) if source_url else ""
    normalized["source_url"] = resolved_url or normalized.get("source_url") or "https://congbao.chinhphu.vn"
    if not normalized.get("effective_date"):
        normalized["effective_status"] = normalized.get("effective_status") or "unknown"
    normalized["scope"] = "internal" if scope == "internal" else "public"

    if raw_metadata_json and raw_metadata_json.strip() not in ("", "{}", "null"):
        try:
            user_meta = json.loads(raw_metadata_json)
            if isinstance(user_meta, dict):
                if user_meta.get("doc_id"):
                    normalized["doc_id"] = user_meta["doc_id"]
                u_title = str(user_meta.get("doc_title") or "").strip()
                if u_title and u_title != fallback_title:
                    normalized["doc_title"] = u_title
                u_num = str(user_meta.get("doc_number") or "").strip()
                if u_num and not u_num.startswith(("CHUA-XAC-DINH-", "TL-")):
                    normalized["doc_number"] = u_num
                u_auth = str(user_meta.get("issuing_authority") or "").strip()
                if u_auth and u_auth != "Chưa xác định":
                    normalized["issuing_authority"] = u_auth
                u_type = str(user_meta.get("document_type") or "").strip()
                if u_type in ("law", "decree", "circular", "resolution"):
                    normalized["document_type"] = u_type
                u_date = str(user_meta.get("issued_date") or "").strip()
                if u_date and extracted.get("issued_date_fallback"):
                    normalized["issued_date"] = u_date
                if user_meta.get("scope") in ("public", "internal"):
                    normalized["scope"] = user_meta["scope"]
                if user_meta.get("effective_status") in ("active", "expired", "partially_expired", "unknown"):
                    normalized["effective_status"] = user_meta["effective_status"]
        except Exception:
            pass
    return IngestDocumentMetadata(**normalized)


def _serialize_ocr_job(row: dict, include_text: bool = True) -> dict:
    """Chuẩn hóa thông tin tiến trình OCR trả về cho Backend và giao diện quản trị."""
    payload = {
        "job_id": row["job_id"],
        "filename": row["filename"],
        "status": row["status"],
        "stage": row["stage"],
        "auto_ingest": row["auto_ingest"],
        "processed_pages": row["processed_pages"],
        "total_pages": row["total_pages"],
        "percent": row["percent"],
        "metadata": row.get("metadata"),
        "ingest_result": row.get("ingest_result"),
        "error": row.get("error"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }
    if include_text:
        payload["text"] = row.get("text")
    return payload


def _execute_ocr_job(
    job_id: str,
    data: bytes,
    safe_name: str,
    auto_ingest: bool,
    raw_metadata_json: str,
    source_url: str,
    scope: str,
) -> None:
    """Thực thi quét AI OCR theo lô trang trong luồng nền và tự động lập chỉ mục khi được bật."""
    def _update(**fields) -> None:
        with _OCR_JOBS_LOCK:
            target = _OCR_JOBS.get(job_id)
            if not target:
                return
            target.update(fields)
            target["updated_at"] = time.time()

    def _on_page_progress(done_pages: int, total_pages: int) -> None:
        safe_total = max(1, total_pages)
        ratio = min(1.0, max(0.0, done_pages / safe_total))
        max_ocr_pct = 80 if auto_ingest else 90
        pct = max(4, min(max_ocr_pct, int(round(ratio * max_ocr_pct))))
        _update(
            status="running",
            stage="ocr",
            processed_pages=done_pages,
            total_pages=safe_total,
            percent=pct,
        )

    try:
        _update(status="running", stage="ocr", percent=3)
        ocr_text = ocr_pdf_bytes(data, safe_name, on_progress=_on_page_progress)

        _update(stage="metadata", percent=86 if auto_ingest else 95)
        stem = safe_name.rsplit(".", 1)[0] if "." in safe_name else safe_name
        extracted = auto_extract_metadata(ocr_text.encode("utf-8"), f"{stem}.txt")

        if not auto_ingest:
            _update(
                status="completed",
                stage="done",
                percent=100,
                text=ocr_text,
                metadata=extracted,
            )
            return

        _update(stage="indexing", percent=93)
        document = _compose_ocr_ingest_metadata(
            extracted=extracted,
            ocr_text=ocr_text,
            safe_name=safe_name,
            source_url=source_url,
            scope=scope,
            raw_metadata_json=raw_metadata_json,
        )
        with corpus_mutation(bot.retriever):
            result = ingest_file(
                data,
                safe_name,
                document,
                bot.collection,
                force_paragraph=True,
                override_text=ocr_text,
            )
        result_dict = asdict(result)
        final_status = "completed" if result_dict.get("status") in ("indexed", "duplicate") else "needs_review"
        _update(
            status=final_status,
            stage="done",
            percent=100,
            text=ocr_text,
            metadata=extracted,
            ingest_result=result_dict,
        )
    except (ValueError, UnicodeError) as exc:
        _update(status="failed", stage="error", error=str(exc))
    except ValidationError:
        _update(
            status="failed",
            stage="error",
            error="Không thể chuẩn hóa metadata tự động từ văn bản OCR. Vui lòng rà soát thủ công.",
        )
    except Exception as exc:
        logger.exception("Lỗi không mong đợi trong tác vụ OCR chạy ngầm %s: %s", job_id, type(exc).__name__)
        _update(
            status="failed",
            stage="error",
            error="AI Core gặp sự cố tạm thời khi xử lý chạy ngầm tệp PDF scan.",
        )


@app.post("/legal/ocr-jobs", dependencies=[Depends(require_internal_token)])
async def create_ocr_background_job(
    file: UploadFile = File(...),
    auto_ingest: bool = Form(default=True),
    metadata: str = Form(default=""),
    source_url: str = Form(default=""),
    scope: str = Form(default="public"),
):
    """Khởi tạo tác vụ nhận diện AI OCR chạy ngầm và trả về mã theo dõi tiến độ ngay lập tức."""
    data = file.file.read(MAX_FILE_BYTES + 1)
    file.file.close()
    try:
        safe_name = validate_upload(data, file.filename or "")
        if source_url and isinstance(source_url, str) and source_url.strip():
            validate_public_url(source_url.strip())
    except (ValueError, UnicodeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    total_pages = _count_pdf_pages_fast(data, safe_name)
    job_id = str(uuid4())
    now = time.time()
    job_record = {
        "job_id": job_id,
        "filename": safe_name,
        "status": "queued",
        "stage": "queued",
        "auto_ingest": bool(auto_ingest),
        "processed_pages": 0,
        "total_pages": total_pages,
        "percent": 1,
        "text": None,
        "metadata": None,
        "ingest_result": None,
        "error": None,
        "created_at": now,
        "updated_at": now,
    }
    with _OCR_JOBS_LOCK:
        _prune_old_ocr_jobs_locked()
        _OCR_JOBS[job_id] = job_record

    _OCR_JOB_EXECUTOR.submit(
        _execute_ocr_job,
        job_id,
        data,
        safe_name,
        bool(auto_ingest),
        metadata if isinstance(metadata, str) else "",
        source_url.strip() if isinstance(source_url, str) else "",
        scope if scope in ("public", "internal") else "public",
    )
    return _serialize_ocr_job(job_record, include_text=False)


@app.get("/legal/ocr-jobs/{job_id}", dependencies=[Depends(require_internal_token)])
def get_ocr_background_job(job_id: str, include_text: bool = Query(default=True)):
    """Truy vấn tiến độ theo trang và kết quả lập chỉ mục của một tác vụ AI OCR chạy ngầm."""
    if not re.fullmatch(r"[0-9a-fA-F-]{36}", job_id.strip()):
        raise HTTPException(status_code=400, detail="Mã tiến trình OCR không hợp lệ.")
    with _OCR_JOBS_LOCK:
        row = _OCR_JOBS.get(job_id.strip())
        if not row:
            raise HTTPException(status_code=404, detail="Không tìm thấy tiến trình OCR hoặc tiến trình đã hết hạn.")
        snapshot = dict(row)
    return _serialize_ocr_job(snapshot, include_text=include_text)


@app.post("/legal/ingest", dependencies=[Depends(require_internal_token)])
async def ingest_legal_document(file: UploadFile = File(...), metadata: str = Form(default=""),
                                source_url: str = Form(default=""), force_paragraph: bool = Form(default=False),
                                override_text: str = Form(default="")):
    """Nạp tệp và tự bổ sung phân đoạn văn ngoài các Điều được nhận diện."""
    data = file.file.read(MAX_FILE_BYTES + 1)
    file.file.close()
    try:
        safe_name = validate_upload(data, file.filename or "")
    except (ValueError, UnicodeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    resolved_override = override_text.strip() if isinstance(override_text, str) else ""
    resolved_source_url = source_url if isinstance(source_url, str) else ""
    resolved_metadata = metadata if isinstance(metadata, str) else ""

    # Nếu metadata rỗng, tự động nhận diện và chuẩn hóa trường thiếu từ nội dung.
    if not resolved_metadata or resolved_metadata.strip() in ("", "{}", "null"):
        try:
            source_bytes = resolved_override.encode("utf-8") if resolved_override else data
            source_name = (f"{safe_name.rsplit('.', 1)[0]}.txt" if resolved_override else safe_name)
            document = build_document_metadata(
                source_bytes,
                source_name,
                validate_public_url(resolved_source_url) if resolved_source_url else "",
            )
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail=exc.errors(include_input=False)) from exc
        except Exception as exc:
            logger.exception("Lỗi khi tự động trích xuất metadata: %s", exc)
            raise HTTPException(status_code=500, detail=f"Lỗi trích xuất metadata: {type(exc).__name__} - {str(exc)}") from exc
    else:
        try:
            document = IngestDocumentMetadata.model_validate_json(resolved_metadata)
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail=exc.errors(include_input=False)) from exc
        except Exception as exc:
            logger.exception("Lỗi khi phân tích cấu trúc metadata: %s", exc)
            raise HTTPException(status_code=400, detail=f"Metadata không hợp lệ: {str(exc)}") from exc

    try:
        with corpus_mutation(bot.retriever):
            result = ingest_file(
                data,
                safe_name,
                document,
                bot.collection,
                force_paragraph=force_paragraph is True,
                override_text=resolved_override or None,
            )
    except (ValueError, UnicodeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        err_msg = str(exc)
        if "429" in err_msg or "RESOURCE_EXHAUSTED" in err_msg or "Hạn mức" in err_msg:
            raise HTTPException(status_code=429, detail=err_msg) from exc
        logger.exception("Lỗi nghiêm trọng khi nạp văn bản vào AI Core: %s", exc)
        raise HTTPException(status_code=500, detail=f"Lỗi lập chỉ mục văn bản: {type(exc).__name__} - {str(exc)}") from exc
    return asdict(result)


def ingestion_not_ready():
    raise HTTPException(
        status_code=501,
        detail="Nạp văn bản pháp luật sẽ được triển khai ở T04.",
    )


class IngestUrlRequest(BaseModel):
    """URL công khai cần kiểm tra trước khi nạp văn bản."""

    url: str


@app.post("/ingest-url", dependencies=[Depends(require_internal_token)])
def ingest_url(request: IngestUrlRequest):
    """Nạp URL công khai và trả metadata thực tế của tài liệu đã lập chỉ mục."""
    try:
        with corpus_mutation(bot.retriever):
            result = ingest_from_url(request.url, bot.collection)
    except (ValueError, UnicodeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        # Giữ vị trí lỗi trong traceback nhưng không ghi URL hoặc dữ liệu nguồn vào log.
        safe_error = RuntimeError(type(exc).__name__)
        logger.exception("Lỗi không mong muốn khi nạp tài liệu từ URL.",
                         exc_info=(type(safe_error), safe_error, exc.__traceback__))
        raise HTTPException(status_code=502, detail="Không tải được trang nguồn công khai.") from exc
    return asdict(result)


@app.post("/ingest-html", dependencies=[Depends(require_internal_token)])
def ingest_html():
    ingestion_not_ready()


@app.post("/upload", dependencies=[Depends(require_internal_token)])
async def upload_document(file: UploadFile = File(...)):
    """Chặn tệp không an toàn trước khi đi vào luồng nạp cũ."""
    data = file.file.read(MAX_FILE_BYTES + 1)
    file.file.close()
    try:
        validate_upload(data, file.filename or "")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    ingestion_not_ready()


@app.get("/web-document-chunks", dependencies=[Depends(require_internal_token)])
def get_web_document_chunks():
    ingestion_not_ready()
