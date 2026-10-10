"""API tra cứu và nạp văn bản pháp luật có kiểm soát quyền truy cập."""

from dataclasses import asdict
from datetime import date
from hmac import compare_digest
import json
import logging
import os
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from pydantic import BaseModel, ValidationError

from dotenv import load_dotenv

from legal.ingest import IngestDocumentMetadata, MAX_FILE_BYTES, ingest_file
from legal.security import detect_prompt_injection, validate_public_url, validate_upload
from legal.url_ingest import build_document_metadata, ingest_from_url
from rag_pipeline import AIServiceError, LegalRAG


BASE_DIR = Path(__file__).resolve().parent
# Nạp biến môi trường từ thư mục hiện hành và thư mục gốc của dự án
load_dotenv(BASE_DIR / ".env")
load_dotenv(BASE_DIR.parent / ".env")

CONFIG_PATH = BASE_DIR / "rag_config.json"
app = FastAPI(title="Legal Document AI Service")
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


class ConfigModel(BaseModel):
    system_prompt: str
    temperature: float = 0
    top_p: float = 0.9
    max_tokens: int = 1024


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


@app.post("/chat", response_model=ChatResponse)
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


@app.get("/config")
def get_config():
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


@app.post("/config")
def update_config(config: ConfigModel):
    CONFIG_PATH.write_text(
        config.model_dump_json(indent=2),
        encoding="utf-8",
    )
    return config.model_dump()


@app.get("/documents")
def get_documents():
    data = bot.collection.get(include=["metadatas"])
    metas = data.get("metadatas") or []
    by_doc = {}
    doc_type_map = {
        "law": "Luật",
        "decree": "Nghị định",
        "circular": "Thông tư",
        "resolution": "Nghị quyết",
    }
    for meta in metas:
        if not isinstance(meta, dict):
            continue
        doc_key = meta.get("doc_id") or meta.get("doc_number") or meta.get("doc_title")
        if not doc_key:
            continue
        if doc_key not in by_doc:
            raw_type = meta.get("document_type") or "Luật"
            by_doc[doc_key] = {
                "id": str(meta.get("doc_id") or doc_key),
                "docNumber": meta.get("doc_number") or "",
                "title": meta.get("doc_title") or meta.get("source_title") or "Văn bản pháp luật",
                "docType": doc_type_map.get(raw_type, raw_type),
                "issuer": meta.get("issuing_authority") or "Cơ quan ban hành",
                "issuedDate": meta.get("issued_date") or "",
                "effectiveDate": meta.get("effective_date") or "",
                "effectiveStatus": meta.get("effective_status") or "active",
                "pipelineStatus": "indexed",
                "scope": meta.get("scope") or "public",
                "sourceUrl": meta.get("source_url") or "",
                "source_type": meta.get("source_type") or "",
                "chunkCount": 0,
                "_articles": set(),
                "_chapters": {},
            }
        doc_entry = by_doc[doc_key]
        doc_entry["chunkCount"] += 1
        art_num = meta.get("article_number")
        art_title = meta.get("article_title") or ""
        chapter = meta.get("chapter") or "Quy định chung"
        if art_num:
            doc_entry["_articles"].add(str(art_num))
            if chapter not in doc_entry["_chapters"]:
                doc_entry["_chapters"][chapter] = []
            art_label = f"Điều {art_num}" + (f": {art_title}" if art_title else "")
            if art_label not in doc_entry["_chapters"][chapter]:
                doc_entry["_chapters"][chapter].append(art_label)

    result = []
    for doc in by_doc.values():
        chapters_list = []
        for ch_title, arts in doc["_chapters"].items():
            chapters_list.append({
                "title": ch_title,
                "articles": sorted(arts),
            })
        result.append({
            "id": doc["id"],
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
            "scope": doc["scope"],
            "sourceUrl": doc["sourceUrl"],
            "source_type": doc["source_type"],
            "chapters": chapters_list,
        })
    return result


@app.delete("/documents")
def delete_document(name: str = Query(...)):
    if not name.strip():
        raise HTTPException(status_code=400, detail="Thiếu tên tài liệu.")
    target = name.strip()
    deleted = False
    for field in ["doc_title", "source_title", "doc_id", "doc_number"]:
        try:
            bot.collection.delete(where={field: target})
            deleted = True
        except Exception:
            pass
    return {"success": True, "deleted": deleted}


async def require_internal_token(x_internal_token: str | None = Header(default=None)) -> None:
    expected = os.getenv("AI_CORE_INTERNAL_TOKEN")
    if not expected:
        raise HTTPException(status_code=503, detail="Chưa cấu hình xác thực nội bộ AI Core.")
    if not x_internal_token or not compare_digest(x_internal_token, expected):
        raise HTTPException(status_code=401, detail="Token nội bộ không hợp lệ.")


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


@app.post("/legal/ingest", dependencies=[Depends(require_internal_token)])
async def ingest_legal_document(file: UploadFile = File(...), metadata: str = Form(default=""),
                                source_url: str = Form(default=""), force_paragraph: bool = Form(default=False)):
    """Nạp tệp; chỉ dùng phân đoạn văn khi quản trị viên đã xác nhận cờ cưỡng bức."""
    data = file.file.read(MAX_FILE_BYTES + 1)
    file.file.close()
    try:
        safe_name = validate_upload(data, file.filename or "")
    except (ValueError, UnicodeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # Nếu metadata rỗng, tự động nhận diện và chuẩn hóa trường thiếu từ nội dung.
    if not metadata or metadata.strip() in ("", "{}", "null"):
        try:
            document = build_document_metadata(data, safe_name, validate_public_url(source_url) if source_url else "")
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail=exc.errors(include_input=False)) from exc
    else:
        try:
            document = IngestDocumentMetadata.model_validate_json(metadata)
        except ValidationError as exc:
            raise HTTPException(status_code=422, detail=exc.errors(include_input=False)) from exc

    try:
        result = ingest_file(data, safe_name, document, bot.collection, force_paragraph=force_paragraph is True)
    except (ValueError, UnicodeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
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


@app.post("/ingest-html")
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


@app.get("/web-document-chunks")
def get_web_document_chunks():
    ingestion_not_ready()
