"""Kịch bản tái lập chỉ mục (Re-index) tại chỗ cho các văn bản hiện có từ dữ liệu text trong DB.

Không gọi lại Gemini OCR. Tự động tái tạo collection ChromaDB với vector đồng nhất
768 chiều (gemini-embedding-001) và chạy lại bộ phân tích phân cấp Phase 1.
"""

from datetime import date
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from uuid import UUID

import chromadb
from chromadb.config import Settings as ChromaSettings
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parents[1]
ROOT_DIR = BASE_DIR.parent
sys.path.insert(0, str(BASE_DIR))

load_dotenv(BASE_DIR / ".env")
load_dotenv(ROOT_DIR / ".env")
load_dotenv(ROOT_DIR / "backend" / ".env")

from legal.corpus_revision import bump_revision
from legal.ingest import IngestDocumentMetadata, ingest_file
from legal.schema import AccessScope, EffectiveStatus
from rag_pipeline import GeminiLegalEmbeddingFunction, build_legal_embedding_function


def _fetch_pg_documents_with_units() -> list[dict]:
    """Đọc danh sách văn bản đã có nội dung điều khoản từ PostgreSQL thông qua driver pg của backend."""
    node_script = """
const path = require('path');
const backendDir = '/mnt/d/Workplace/legal-chatbot-system/backend';
require(path.join(backendDir, 'node_modules/dotenv')).config({ path: path.join(backendDir, '.env'), override: true });
const { Client } = require(path.join(backendDir, 'node_modules/pg'));
(async () => {
  const rawHost = process.env.DB_HOST || 'localhost';
  const client = new Client({
    host: rawHost === 'db' ? 'localhost' : rawHost,
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_DATABASE || 'legal_chatbot_db',
  });
  await client.connect();
  const res = await client.query(`
    SELECT
      d.id,
      d.document_number,
      d.title,
      d.document_type,
      d.issuing_authority,
      d.issued_date::text AS issued_date,
      d.effective_date::text AS effective_date,
      d.effective_status,
      d.source_url,
      d.scope,
      d.content_hash,
      json_agg(
        json_build_object(
          'unit_type', a.unit_type,
          'number', a.number,
          'title', a.title,
          'original_text', a.original_text,
          'sort_order', a.sort_order
        ) ORDER BY a.sort_order ASC
      ) AS units
    FROM legal_documents d
    JOIN legal_articles a ON a.document_id = d.id
    GROUP BY d.id
    ORDER BY d.created_at ASC
  `);
  console.log('JSON_START:' + JSON.stringify(res.rows));
  await client.end();
})();
"""
    raw = subprocess.check_output(["node", "-e", node_script], text=True)
    for line in raw.splitlines():
        if line.startswith("JSON_START:"):
            return json.loads(line[len("JSON_START:") :])
    raise RuntimeError("Không đọc được dữ liệu văn bản từ PostgreSQL.")


def main() -> None:
    """Thực thi quy trình Re-index tại chỗ và in bảng đối chiếu trước/sau."""
    chroma_path = str(os.getenv("LEGAL_CHROMA_PATH") or BASE_DIR / "chroma_db")
    client = chromadb.PersistentClient(
        path=chroma_path,
        settings=ChromaSettings(anonymized_telemetry=False),
    )

    # 1. Ghi nhận thống kê cũ từ ChromaDB trước khi Re-index
    old_col = client.get_or_create_collection("legal_documents")
    old_data = old_col.get(include=["metadatas"])
    old_stats: dict[str, dict] = {}
    for meta in old_data.get("metadatas") or []:
        if not isinstance(meta, dict):
            continue
        title_key = meta.get("doc_title") or meta.get("doc_number") or "unknown"
        entry = old_stats.setdefault(
            title_key,
            {
                "doc_id": meta.get("doc_id"),
                "doc_number": meta.get("doc_number"),
                "chunks": 0,
                "structure_status": meta.get("structure_status"),
                "source_type": meta.get("source_type") or "pdf",
                "scope": meta.get("scope") or "public",
            },
        )
        entry["chunks"] += 1

    # 2. Đọc toàn bộ văn bản gốc đã bóc tách sẵn trong PostgreSQL (không gọi lại OCR)
    pg_docs = _fetch_pg_documents_with_units()
    if not pg_docs:
        raise RuntimeError("Không tìm thấy văn bản nào có nội dung trong PostgreSQL để Re-index.")

    # 3. Khởi tạo Gemini Embedding (768 chiều) và tạo lại collection đồng nhất số chiều
    os.environ["LEGAL_EMBEDDING_PROVIDER"] = "gemini"
    os.environ["LEGAL_EMBEDDING_DIM"] = "768"
    embedding_fn = build_legal_embedding_function(default_dim=768)
    provider_label = (
        f"Gemini ({embedding_fn.model_name}, {embedding_fn.output_dimensionality} dims)"
        if isinstance(embedding_fn, GeminiLegalEmbeddingFunction)
        else "ONNX DefaultEmbeddingFunction (384 dims)"
    )
    print(f"=== BẮT ĐẦU RE-INDEX TẠI CHỖ (Embedding: {provider_label}) ===")

    client.delete_collection("legal_documents")
    new_col = client.get_or_create_collection(
        name="legal_documents",
        embedding_function=embedding_fn,
    )

    summary_rows: list[dict] = []
    for doc in pg_docs:
        title = doc["title"]
        old_info = old_stats.get(title, {})
        # Giữ nguyên doc_id và scope đang lưu trên ChromaDB/PostgreSQL để đồng bộ citation
        doc_id_str = old_info.get("doc_id") or doc["id"]
        doc_number = doc["document_number"]
        # Chuẩn hóa số hiệu hiển thị gọn gàng nếu số hiệu cũ là mã tự sinh
        if doc_number == "TL-NGH-NH-312-2026-N-CP":
            doc_number = "312/2026/NĐ-CP"
        source_type = old_info.get("source_type") or "pdf"
        scope_val = old_info.get("scope") or doc.get("scope") or "public"

        units = doc.get("units") or []
        raw_text = "\n".join(u["original_text"] for u in units if u.get("original_text"))
        raw_bytes = raw_text.encode("utf-8")

        meta_model = IngestDocumentMetadata(
            doc_id=UUID(doc_id_str),
            doc_number=doc_number,
            doc_title=title,
            document_type=doc.get("document_type") or "law",
            issuing_authority=doc.get("issuing_authority") or "Cơ quan ban hành",
            issued_date=date.fromisoformat(doc["issued_date"][:10]) if doc.get("issued_date") else date.today(),
            effective_date=date.fromisoformat(doc["effective_date"][:10]) if doc.get("effective_date") else None,
            effective_status=EffectiveStatus(doc.get("effective_status") or "unknown"),
            source_url=doc.get("source_url") or f"local://{doc_number}",
            scope=AccessScope(scope_val),
        )

        result = ingest_file(
            data=raw_bytes,
            filename=f"{doc_number}.{source_type}",
            metadata=meta_model,
            collection=new_col,
            force_paragraph=False,
            source_type=source_type,
            override_text=raw_text,
        )

        # Kiểm tra phân bố unit_type và tham chiếu chéo trong các chunk vừa nạp
        stored = new_col.get(where={"doc_id": str(meta_model.doc_id)}, include=["metadatas"])
        metas = stored.get("metadatas") or []
        unit_breakdown: dict[str, int] = {}
        chunks_with_mentions = 0
        chunks_with_cross_refs = 0
        chunks_with_ref_docs = 0
        sample_mentions: list[str] = []
        sample_refs: list[str] = []
        for m in metas:
            ut = m.get("unit_type") or "unknown"
            unit_breakdown[ut] = unit_breakdown.get(ut, 0) + 1
            if m.get("mentioned_articles"):
                chunks_with_mentions += 1
                if len(sample_mentions) < 3:
                    sample_mentions.append(m["mentioned_articles"])
            if m.get("referenced_articles"):
                chunks_with_cross_refs += 1
                if len(sample_refs) < 3:
                    sample_refs.append(m["referenced_articles"])
            if m.get("referenced_docs"):
                chunks_with_ref_docs += 1

        summary_rows.append(
            {
                "doc_id": str(meta_model.doc_id),
                "doc_number": doc_number,
                "doc_title": title,
                "old_chunks": old_info.get("chunks", 0),
                "new_chunks": result.chunk_count,
                "old_status": old_info.get("structure_status", "N/A"),
                "new_status": result.structure_status,
                "article_count": result.article_count,
                "needs_review": result.needs_review,
                "coverage": round(result.coverage, 4),
                "unit_breakdown": unit_breakdown,
                "chunks_with_mentions": chunks_with_mentions,
                "chunks_with_cross_refs": chunks_with_cross_refs,
                "chunks_with_ref_docs": chunks_with_ref_docs,
                "sample_mentions": sample_mentions,
                "sample_refs": sample_refs,
            }
        )

    bump_revision(Path(chroma_path) / ".corpus-revision")

    # Kiểm tra chiều vector thực tế đã lưu trong ChromaDB
    peek = new_col.peek(limit=1)
    embs = peek.get("embeddings")
    actual_dim = len(embs[0]) if (embs is not None and len(embs) > 0) else 0

    print(f"=== HOÀN TẤT RE-INDEX: TỔNG CHUNKS = {new_col.count()} | VECTOR DIM = {actual_dim} ===")
    print(json.dumps(summary_rows, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
