"""Khôi phục toàn văn, sửa lỗi tách âm tiết PDF Công báo và lập chỉ mục lại Luật 36/2024/QH15.

Gộp hai bản ghi bị chia tách của Luật Trật tự, an toàn giao thông đường bộ (36/2024/QH15)
trong ChromaDB thành một văn bản thống nhất đủ 89 Điều (Chương -> Mục -> Điều -> Khoản -> Điểm),
đồng bộ bảng legal_documents / legal_articles trong PostgreSQL và làm mới bộ nhớ đệm truy xuất.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from datetime import date
from pathlib import Path
from uuid import UUID, uuid4

import requests
from dotenv import dotenv_values, load_dotenv

AI_CORE_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = AI_CORE_DIR.parent
if str(AI_CORE_DIR) not in sys.path:
    sys.path.insert(0, str(AI_CORE_DIR))

load_dotenv(AI_CORE_DIR / ".env")
load_dotenv(PROJECT_ROOT / ".env")
load_dotenv(PROJECT_ROOT / "backend" / ".env")

from legal.ingest import IngestDocumentMetadata, ingest_file  # noqa: E402
from legal.parser import parse_legal_text, repair_vietnamese_pdf_spacing  # noqa: E402
from rag_pipeline import LegalRAG  # noqa: E402

CANONICAL_DOC_ID = "43884784-2d61-4f61-b734-92446582df97"
DUPLICATE_PART2_DOC_ID = "88e93b0b-01d9-4eab-9a8c-ba031913a1cb"
SNAPSHOT_TEXT_PATH = AI_CORE_DIR / "data" / "reconstructed" / "luat_36_2024_qh15.txt"


def _reconstruct_part1_from_chroma(collection) -> str:
    """Khôi phục văn bản Điều 1..23 từ các chunk phân cấp của phần Công báo thứ nhất."""
    data = collection.get(where={"doc_id": CANONICAL_DOC_ID}, include=["documents", "metadatas"])
    rows: list[tuple[int, str, str, dict]] = []
    for cid, doc, meta in zip(data.get("ids") or [], data.get("documents") or [], data.get("metadatas") or []):
        suffix = cid.rsplit(":", 1)[-1]
        idx = int(suffix) if suffix.isdigit() else 0
        rows.append((idx, cid, doc, meta))
    rows.sort(key=lambda item: item[0])

    lines_out: list[str] = [
        "QUỐC HỘI",
        "Luật số: 36/2024/QH15",
        "LUẬT TRẬT TỰ, AN TOÀN GIAO THÔNG ĐƯỜNG BỘ",
    ]
    current_chapter: str | None = None
    current_section: str | None = None
    current_article: str | None = None
    emitted_article_intro: set[str] = set()
    emitted_clauses: set[tuple[str, str]] = set()
    header_art_re = re.compile(r"\[Điều\s+(\d+[a-zA-Z]?)(?:[.:]\s*([^\]]*))?\]")

    for _idx, _cid, doc, meta in rows:
        utype = meta.get("unit_type")
        if utype == "paragraph":
            continue
        art_no = str(meta.get("article_number") or "").strip()
        if not art_no:
            continue

        chap = str(meta.get("chapter") or "").strip() or None
        sec = str(meta.get("section") or "").strip() or None
        if chap and chap != current_chapter:
            current_chapter = chap
            current_section = None
            lines_out.append(chap)
        if sec and sec != current_section:
            current_section = sec
            lines_out.append(sec)

        raw_lines = doc.splitlines()
        in_header = True
        header_lines: list[str] = []
        body_lines: list[str] = []
        for raw_ln in raw_lines:
            stripped = raw_ln.strip()
            if in_header and stripped.startswith("[") and stripped.endswith("]"):
                header_lines.append(stripped)
                continue
            in_header = False
            if stripped.startswith("Nội dung chi tiết:"):
                stripped = stripped[len("Nội dung chi tiết:") :].strip()
            body_lines.append(stripped)

        if art_no != current_article:
            current_article = art_no
            art_title = str(meta.get("article_title") or "").strip()
            if not art_title:
                joined_headers = " ".join(header_lines)
                m_h = header_art_re.search(joined_headers)
                if m_h and m_h.group(2):
                    art_title = m_h.group(2).strip()
            lines_out.append(f"Điều {art_no}." + (f" {art_title}" if art_title else ""))

        body_text = "\n".join(ln for ln in body_lines if ln).strip()
        if utype == "article":
            if body_text:
                lines_out.append(body_text)
            emitted_article_intro.add(art_no)
        elif utype == "clause":
            c_no = str(meta.get("clause_number") or "").strip()
            m_k = re.search(rf"(?:^|\n)Khoản\s+{re.escape(c_no)}\.\s*", body_text)
            if m_k:
                intro_part = body_text[: m_k.start()].strip()
                clause_part = body_text[m_k.end() :].strip()
                if intro_part and art_no not in emitted_article_intro:
                    lines_out.append(intro_part)
                    emitted_article_intro.add(art_no)
                lines_out.append(f"{c_no}. {clause_part}")
            else:
                lines_out.append(f"{c_no}. {body_text}")
            emitted_clauses.add((art_no, c_no))
        elif utype == "point":
            c_no = str(meta.get("clause_number") or "").strip()
            p_id = str(meta.get("point_id") or "").strip()
            m_p = re.search(rf"(?:^|\n)Điểm\s+{re.escape(p_id)}\)\s*", body_text, re.IGNORECASE)
            if (art_no, c_no) not in emitted_clauses:
                before_point = body_text[: m_p.start()].strip() if m_p else ""
                m_k = re.search(rf"(?:^|\n)Khoản\s+{re.escape(c_no)}(?:\.\s*|\s*$)", before_point)
                if m_k:
                    intro_part = before_point[: m_k.start()].strip()
                    clause_part = before_point[m_k.end() :].strip()
                    if intro_part and art_no not in emitted_article_intro:
                        lines_out.append(intro_part)
                        emitted_article_intro.add(art_no)
                    lines_out.append(f"{c_no}. {clause_part}".strip())
                emitted_clauses.add((art_no, c_no))
            if m_p:
                lines_out.append(f"{p_id}) {body_text[m_p.end():].strip()}")
            else:
                lines_out.append(f"{p_id}) {body_text}")

    return repair_vietnamese_pdf_spacing("\n".join(lines_out))


def _reconstruct_part2_from_chroma(collection) -> str:
    """Khử trùng lặp cửa sổ trượt 80 từ và khôi phục cây phân cấp Điều 24..89 từ phần Công báo thứ hai."""
    data = collection.get(where={"doc_id": DUPLICATE_PART2_DOC_ID}, include=["documents", "metadatas"])
    rows: list[tuple[int, str, str, dict]] = []
    for cid, doc, meta in zip(data.get("ids") or [], data.get("documents") or [], data.get("metadatas") or []):
        suffix = cid.rsplit(":", 1)[-1]
        idx = int(suffix) if suffix.isdigit() else 0
        rows.append((idx, cid, doc, meta))
    rows.sort(key=lambda item: item[0])
    if not rows:
        return ""

    # Bước 1: Khử chính xác phần gối đầu 80 từ trên luồng từ thô trước khi ghép âm tiết tiếng Việt
    merged_words: list[str] = []
    for _idx, _cid, doc, _meta in rows:
        raw_lines = doc.splitlines()
        body = "\n".join(raw_lines[1:]) if (raw_lines and raw_lines[0].startswith("[")) else doc
        words = body.split()
        if not words:
            continue
        if not merged_words:
            merged_words.extend(words)
            continue
        max_k = min(100, len(merged_words), len(words))
        overlap_k = 0
        for k in range(max_k, 15, -1):
            if merged_words[-k:] == words[:k]:
                overlap_k = k
                break
        merged_words.extend(words[overlap_k:])

    joined = " ".join(merged_words)
    # Bước 2: Loại bỏ tiêu đề/chân trang Công báo xen giữa các trang PDF
    joined = re.sub(r"\b\d{1,3}\s+CÔNG\s+BÁO/Số\s+\d+\s*\+\s*\d+/Ngày\s+\d{1,2}-\d{1,2}-\d{4}\b", " ", joined)
    joined = re.sub(r"\bCÔNG\s+BÁO/Số\s+\d+\s*\+\s*\d+/Ngày\s+\d{1,2}-\d{1,2}-\d{4}\s+\d{1,3}\b", " ", joined)
    joined = re.sub(r"\(Tiếp\s+theo\s+Công\s+báo\s+số[^)]+\)", " ", joined, flags=re.IGNORECASE)
    joined = re.sub(
        r"^\s*VĂN\s+BẢN\s+QUY\s+PHẠM\s+PHÁP\s+LUẬT\s+CHỦ\s+TỊCH\s+NƯỚC\s*-\s*QUỐC\s+HỘI\s+LUẬT\s+Trật[^Đ]+?(?=Chương\s+II|Điều\s+24\.)",
        "",
        joined,
    )

    # Bước 3: Sửa toàn bộ âm tiết tiếng Việt bị tách khoảng trắng
    repaired = repair_vietnamese_pdf_spacing(joined)
    repaired = re.sub(r"[ \t]{2,}", " ", repaired).strip()

    # Bước 4: Tách dòng cấu trúc Chương -> Mục -> Điều -> Khoản -> Điểm
    upper_vn = "A-ZÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ"
    repaired = re.sub(
        rf"(?:^|\s+)(Chương\s+[IVXLCDM]+)\s+([{upper_vn}][{upper_vn}0-9,\-\s]+?)(?=\s+(?:Mục\s+\d+|Điều\s+\d+\.))",
        r"\n\1\n\2\n",
        repaired,
    )
    repaired = re.sub(
        rf"(?:^|\s+)(Mục\s+\d+)\s+([{upper_vn}][{upper_vn}0-9,\-\s]+?)(?=\s+Điều\s+\d+\.)",
        r"\n\1\n\2\n",
        repaired,
    )
    repaired = re.sub(r"(?<!\n)\s+(Điều\s+\d+[a-zA-Z]?\.\s+)", r"\n\1", repaired)

    intro_lead_re = re.compile(
        r"^(Điều\s+\d+[a-zA-Z]?\.\s+[^\n:]{8,120}?)\s+"
        r"((?:Người\s+điều\s+khiển|Cảnh\s+sát\s+giao\s+thông|Cơ\s+quan|Tổ\s+chức|Bộ\s+|Chính\s+phủ)[^\n]+:.*)$"
    )

    def _split_article_heading(line: str) -> str:
        if not line.startswith("Điều "):
            return line
        m_c1 = re.match(r"^(Điều\s+\d+[a-zA-Z]?\.\s+[^\n]+?)\s+(1\.\s+.+)$", line)
        resolved = f"{m_c1.group(1)}\n{m_c1.group(2)}" if m_c1 else line
        first_ln, sep, rest = resolved.partition("\n")
        m_intro = intro_lead_re.match(first_ln)
        if m_intro:
            first_ln = f"{m_intro.group(1)}\n{m_intro.group(2)}"
        return f"{first_ln}{sep}{rest}" if sep else first_ln

    repaired = "\n".join(_split_article_heading(ln.strip()) for ln in repaired.splitlines() if ln.strip())
    repaired = re.sub(rf"([.;:])\s+(\d{{1,2}}\.\s+[{upper_vn}])", r"\1\n\2", repaired)
    repaired = re.sub(r"([:;])\s+([a-zđ]\)\s+\S)", r"\1\n\2", repaired)
    repaired = re.sub(r"^\s*Chương\s+II\s*\nQUY\s+TẮC\s+GIAO\s+THÔNG\s+ĐƯỜNG\s+BỘ\s*\n", "", repaired)
    return repaired


def build_or_load_law_36_text(collection) -> str:
    """Tái tạo văn bản Luật 36/2024/QH15 đủ 89 Điều từ ChromaDB hoặc đọc từ bản lưu an toàn."""
    part2_check = collection.get(where={"doc_id": DUPLICATE_PART2_DOC_ID}, include=[])
    has_part2 = bool(part2_check.get("ids"))

    if not has_part2 and SNAPSHOT_TEXT_PATH.is_file():
        return SNAPSHOT_TEXT_PATH.read_text(encoding="utf-8")

    part1_text = _reconstruct_part1_from_chroma(collection)
    part2_text = _reconstruct_part2_from_chroma(collection)
    if not part2_text and SNAPSHOT_TEXT_PATH.is_file():
        return SNAPSHOT_TEXT_PATH.read_text(encoding="utf-8")

    full_text = f"{part1_text.strip()}\n{part2_text.strip()}\n"
    SNAPSHOT_TEXT_PATH.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_TEXT_PATH.write_text(full_text, encoding="utf-8")
    return full_text


def _sql_literal(val: str | None) -> str:
    """Mã hóa chuỗi an toàn cho câu lệnh SQL chạy nội bộ trong PostgreSQL container."""
    if val is None:
        return "NULL"
    escaped = str(val).replace("'", "''")
    return f"'{escaped}'"


def sync_postgresql_law_36(content_hash: str, units: list[dict]) -> None:
    """Đồng bộ bản ghi Luật 36/2024/QH15 trong PostgreSQL và xóa bản ghi phần 2 bị trùng lặp."""
    env_cfg = {
        **dotenv_values(PROJECT_ROOT / ".env"),
        **dotenv_values(PROJECT_ROOT / "backend" / ".env"),
    }
    db_user = str(env_cfg.get("DB_USERNAME") or os.getenv("DB_USERNAME") or "legal_user")
    db_name = str(env_cfg.get("DB_DATABASE") or os.getenv("DB_DATABASE") or "legal_db")

    sql_lines: list[str] = [
        "BEGIN;",
        f"DELETE FROM legal_documents WHERE id = {_sql_literal(DUPLICATE_PART2_DOC_ID)};",
        f"DELETE FROM legal_articles WHERE document_id = {_sql_literal(CANONICAL_DOC_ID)};",
        (
            "UPDATE legal_documents SET "
            "document_number = '36/2024/QH15', "
            "document_type = 'law', "
            "title = 'Luật Trật tự, an toàn giao thông đường bộ', "
            "issuing_authority = 'Quốc hội', "
            "issued_date = '2024-06-27', "
            "effective_date = '2025-01-01', "
            "effective_status = 'active', "
            "scope = 'public', "
            "source_url = 'https://congbao.chinhphu.vn', "
            f"content_hash = {_sql_literal(content_hash)}, "
            "updated_at = NOW() "
            f"WHERE id = {_sql_literal(CANONICAL_DOC_ID)};"
        ),
    ]

    key_to_uuid: dict[str, str] = {}
    seen_tuples: set[tuple[str | None, str, str]] = set()
    for unit in units:
        u_key = str(unit["key"])
        parent_key = unit.get("parent_key")
        parent_uuid = key_to_uuid.get(str(parent_key)) if parent_key is not None else None
        u_type = str(unit["unit_type"])
        u_num = str(unit["number"])[:30]
        dedup_tuple = (parent_uuid, u_type, u_num)
        if dedup_tuple in seen_tuples:
            u_num = f"{u_num}-{u_key}"[:30]
            dedup_tuple = (parent_uuid, u_type, u_num)
        seen_tuples.add(dedup_tuple)
        row_uuid = str(uuid4())
        key_to_uuid[u_key] = row_uuid
        sql_lines.append(
            "INSERT INTO legal_articles (id, document_id, parent_id, unit_type, number, title, original_text, sort_order) "
            f"VALUES ({_sql_literal(row_uuid)}, {_sql_literal(CANONICAL_DOC_ID)}, {_sql_literal(parent_uuid)}, "
            f"{_sql_literal(u_type)}, {_sql_literal(u_num)}, {_sql_literal(unit.get('title') or None)}, "
            f"{_sql_literal(unit.get('original_text') or None)}, {int(unit.get('sort_order', 0))});"
        )

    sql_lines.append("COMMIT;")
    sql_payload = "\n".join(sql_lines)

    proc = subprocess.run(
        [
            "docker",
            "exec",
            "-i",
            "legal_db",
            "psql",
            "-v",
            "ON_ERROR_STOP=1",
            "-U",
            db_user,
            "-d",
            db_name,
        ],
        input=sql_payload,
        text=True,
        capture_output=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"Đồng bộ PostgreSQL thất bại (exit={proc.returncode}): {proc.stderr.strip()}")


def notify_running_ai_core() -> bool:
    """Gửi tín hiệu làm mới bộ nhớ đệm truy xuất tới tiến trình AI Core đang chạy trên cổng 8001."""
    token = (os.getenv("AI_CORE_INTERNAL_TOKEN") or "").strip()
    if not token:
        return False
    try:
        resp = requests.post(
            "http://127.0.0.1:8001/legal/retrieval/invalidate",
            headers={"X-Internal-Token": token},
            timeout=5,
        )
        return resp.status_code == 200
    except Exception:
        return False


def main() -> int:
    print("1. Khởi tạo kết nối LegalRAG và đọc dữ liệu Luật 36/2024/QH15...")
    bot = LegalRAG()
    full_text = build_or_load_law_36_text(bot.collection)

    print("2. Kiểm chứng cấu trúc phân cấp trước khi ghi...")
    parsed = parse_legal_text(full_text)
    art_numbers = [int(re.match(r"\d+", a.number).group()) for a in parsed.articles]
    missing = sorted(set(range(1, 90)) - set(art_numbers))
    if parsed.structure_status != "structured" or len(parsed.articles) != 89 or missing:
        raise RuntimeError(
            f"Văn bản khôi phục chưa đạt chuẩn 89 Điều: status={parsed.structure_status}, "
            f"articles={len(parsed.articles)}, missing={missing}"
        )

    art2 = next(a for a in parsed.articles if a.number == "2")
    art10 = next(a for a in parsed.articles if a.number == "10")
    if not any(c.number == "13" and "Thiết bị an toàn cho trẻ em" in c.text for c in art2.clauses):
        raise RuntimeError("Không tìm thấy Khoản 13 Điều 2 trong văn bản khôi phục.")
    if not any(c.number == "3" and "dưới 10 tuổi và chiều cao dưới 1,35 mét" in c.text for c in art10.clauses):
        raise RuntimeError("Không tìm thấy Khoản 3 Điều 10 trong văn bản khôi phục.")

    print(f"   Đã xác nhận đủ {len(parsed.articles)} Điều (Điều 1..89), structure_status='structured'.")

    metadata = IngestDocumentMetadata(
        doc_id=UUID(CANONICAL_DOC_ID),
        doc_number="36/2024/QH15",
        doc_title="Luật Trật tự, an toàn giao thông đường bộ",
        document_type="law",
        issuing_authority="Quốc hội",
        issued_date=date(2024, 6, 27),
        effective_date=date(2025, 1, 1),
        effective_status="active",
        source_url="https://congbao.chinhphu.vn",
        scope="public",
    )

    print("3. Xóa các chunk cũ bị tách đôi của Luật 36/2024/QH15 và lập chỉ mục lại bằng vector 768 chiều...")
    bot.collection.delete(where={"doc_id": {"$in": [CANONICAL_DOC_ID, DUPLICATE_PART2_DOC_ID]}})
    encoded = full_text.encode("utf-8")
    result = ingest_file(
        encoded,
        "luat-36-2024-qh15.txt",
        metadata,
        bot.collection,
        source_type="pdf",
    )
    bot.retriever.invalidate()
    print(
        f"   Lập chỉ mục ChromaDB hoàn tất: status={result.status}, structure_status={result.structure_status}, "
        f"article_count={result.article_count}, chunk_count={result.chunk_count}"
    )

    print("4. Đồng bộ bảng legal_documents và legal_articles trong PostgreSQL...")
    sync_postgresql_law_36(result.content_hash, result.units or [])
    invalidated_remote = notify_running_ai_core()
    print(f"   Đồng bộ PostgreSQL thành công. Tín hiệu làm mới AI Core (:8001): {invalidated_remote}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
