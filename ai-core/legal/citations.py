"""Bóc tách JSON, chuẩn hóa và tự hiệu chỉnh trích dẫn do mô hình sinh ra."""

import json
import re
from typing import Any

from legal.prompts import REFUSAL
from legal.retrieval import RetrievedChunk, parse_article_set
from query_reformulator import extract_legal_references, normalize_doc_number, normalize_unit_number


def resolve_snippet(snippet: str, document: str) -> str | None:
    """Đối chiếu đoạn trích dẫn và chuẩn hóa về đúng chuỗi con nguyên văn trong chunk gốc ChromaDB."""
    if not snippet or not document:
        return None
    cleaned = snippet.strip()
    if not cleaned:
        return None
    if cleaned in document:
        return cleaned
    trimmed = cleaned.strip(' "\'“”‘’…').removeprefix("...").removesuffix("...").strip()
    # Bỏ thẻ trích dẫn nội dòng ở cuối câu nếu mô hình chép kèm vào snippet
    trimmed = re.sub(r"\s*\[(?:Điều|Khoản|Điểm|CD-|[^\]]+)\]\.?$", "", trimmed, flags=re.IGNORECASE).strip()
    if trimmed and trimmed in document:
        return trimmed
    target = trimmed or cleaned
    pattern = r"\s+".join(re.escape(part) for part in target.split() if part)
    if not pattern:
        return None
    match = re.search(pattern, document)
    if match:
        return match.group(0)

    # Nếu mô hình nối hai mệnh đề bằng dấu '...' hoặc ';', thử khớp mệnh đề nguyên văn đủ dài (>= 4 từ và >= 16 ký tự)
    segments = [seg.strip(' "\'“”‘’….,;:-') for seg in re.split(r"(?:\.\.\.|…|;|\n)", target) if seg.strip()]
    for seg in sorted(segments, key=len, reverse=True):
        words = [w for w in seg.split() if w]
        if len(words) < 4 or len(seg) < 16:
            continue
        seg_pattern = r"\s+".join(re.escape(w) for w in words)
        seg_match = re.search(seg_pattern, document)
        if seg_match:
            return seg_match.group(0)
    return None


def _base_document(chunk: RetrievedChunk) -> str:
    """Lấy nội dung gốc trong ChromaDB của chunk (loại bỏ phần ngữ cảnh bổ sung nối thêm trên RAM)."""
    if getattr(chunk, "raw_document", ""):
        return chunk.raw_document
    return chunk.document.split("\n[Ngữ cảnh bổ sung cùng Điều ", 1)[0]


def verify_and_repair_citation(
    item: dict[str, str],
    allowed: dict[str, RetrievedChunk],
    sibling_lookup: dict[str, RetrievedChunk] | None = None,
) -> tuple[dict[str, str], RetrievedChunk] | None:
    """Xác minh và tự ánh xạ citation về đúng chunk gốc trong ChromaDB để chống lỗi False Refusal."""
    sibling_lookup = sibling_lookup or {}
    cid = item.get("chunk_id", "").strip()
    chunk = allowed.get(cid) or sibling_lookup.get(cid)
    if not chunk:
        return None

    base_doc = _base_document(chunk)
    siblings = getattr(chunk, "siblings", ()) or ()

    # Nếu mô hình ghi rõ Khoản của một chunk anh em trong cùng Điều, ưu tiên kiểm tra chunk anh em đó trước
    cited_clause_raw = item.get("clause", "").strip()
    cited_clause_num = (
        normalize_unit_number(re.sub(r"^\s*khoản\s+", "", cited_clause_raw, flags=re.IGNORECASE))
        if cited_clause_raw
        else ""
    )
    stored_clause_num = (
        normalize_unit_number(str(chunk.metadata.get("clause_number") or ""))
        if chunk.metadata.get("clause_number")
        else ""
    )

    matched_snippet: str | None = None
    remapped_from_sibling = False

    if siblings and cited_clause_num and cited_clause_num != stored_clause_num:
        for sib_id, sib_raw_doc, sib_meta in siblings:
            sib_clause = (
                normalize_unit_number(str(sib_meta.get("clause_number") or ""))
                if sib_meta.get("clause_number")
                else ""
            )
            if sib_clause == cited_clause_num:
                sib_match = resolve_snippet(item.get("snippet", ""), sib_raw_doc)
                if sib_match:
                    chunk = sibling_lookup.get(sib_id) or RetrievedChunk(
                        chunk_id=sib_id,
                        document=sib_raw_doc,
                        metadata=sib_meta,
                        score=chunk.score,
                        effective_status=chunk.effective_status,
                        warning=chunk.warning,
                        raw_document=sib_raw_doc,
                    )
                    matched_snippet = sib_match
                    remapped_from_sibling = True
                    break

    if not matched_snippet:
        matched_snippet = resolve_snippet(item.get("snippet", ""), base_doc)

    # Nếu snippet nằm ở phần [Ngữ cảnh bổ sung cùng Điều X], tự động ánh xạ sang chunk anh em chứa câu đó
    if not matched_snippet and siblings:
        for sib_id, sib_raw_doc, sib_meta in siblings:
            sib_match = resolve_snippet(item.get("snippet", ""), sib_raw_doc)
            if sib_match:
                chunk = sibling_lookup.get(sib_id) or RetrievedChunk(
                    chunk_id=sib_id,
                    document=sib_raw_doc,
                    metadata=sib_meta,
                    score=chunk.score,
                    effective_status=chunk.effective_status,
                    warning=chunk.warning,
                    raw_document=sib_raw_doc,
                )
                matched_snippet = sib_match
                remapped_from_sibling = True
                break

    if not matched_snippet:
        return None

    metadata = chunk.metadata
    doc_number = str(metadata.get("doc_number") or "").strip()
    source_url = str(metadata.get("source_url") or "").strip()

    if not doc_number or normalize_doc_number(item.get("doc_number", "")) != normalize_doc_number(doc_number):
        return None
    if item.get("source_url", "").strip() and item["source_url"].strip() != source_url:
        return None

    repaired = dict(item)
    repaired["chunk_id"] = chunk.chunk_id
    repaired["doc_number"] = doc_number
    repaired["source_url"] = source_url
    repaired["snippet"] = matched_snippet

    stored_art = str(metadata.get("article_number") or "").strip()
    stored_clause = str(metadata.get("clause_number") or "").strip()
    expected_article = f"Điều {stored_art}" if stored_art else ""
    expected_clause = f"Khoản {stored_clause}" if stored_clause else ""

    if stored_art:
        raw_art = item.get("article", "").strip()
        if raw_art:
            cleaned_art = re.sub(r"^\s*điều\s+", "", raw_art, flags=re.IGNORECASE).strip()
            if normalize_unit_number(cleaned_art) != normalize_unit_number(stored_art):
                return None
        elif not (siblings or remapped_from_sibling):
            return None
        repaired["article"] = expected_article

        raw_clause = item.get("clause", "").strip()
        if stored_clause:
            if not raw_clause or remapped_from_sibling:
                repaired["clause"] = expected_clause
            else:
                cleaned_clause = re.sub(r"^\s*khoản\s+", "", raw_clause, flags=re.IGNORECASE).strip()
                if normalize_unit_number(cleaned_clause) == normalize_unit_number(stored_clause):
                    repaired["clause"] = expected_clause
                elif siblings and any(
                    normalize_unit_number(str(s_meta.get("clause_number") or "")) == normalize_unit_number(cleaned_clause)
                    for _, _, s_meta in siblings
                ):
                    repaired["clause"] = expected_clause
                else:
                    return None
        else:
            if raw_clause and not remapped_from_sibling:
                return None
            repaired["clause"] = ""
    else:
        # Xử lý tài liệu chuyên đề (như CD-01) có article_number == "" nhưng có mentioned_articles / referenced_articles
        raw_art = item.get("article", "").strip()
        if raw_art:
            extracted_refs = extract_legal_references(raw_art).article_numbers
            if not extracted_refs:
                cleaned_art = re.sub(r"^\s*điều\s+", "", raw_art, flags=re.IGNORECASE).strip()
                extracted_refs = (normalize_unit_number(cleaned_art),) if cleaned_art else ()
            allowed_mentions = (
                parse_article_set(metadata.get("mentioned_articles"))
                | parse_article_set(metadata.get("referenced_articles"))
            )
            in_mentions = bool(extracted_refs) and set(extracted_refs).issubset(allowed_mentions)
            in_body = raw_art.casefold() in base_doc.casefold()
            if not (in_mentions or in_body):
                return None
        # Chuẩn hóa về chuỗi rỗng để khớp 100% với metadata trong ChromaDB khi POST /legal/citations/verify kiểm tra
        repaired["article"] = ""
        repaired["clause"] = ""

    return repaired, chunk



def extract_json(raw: str) -> dict | None:
    """Đọc đối tượng JSON đầu tiên, kể cả khi có markdown fence hoặc ký tự thừa."""
    if not isinstance(raw, str):
        return None
    cleaned = re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", raw.strip(), flags=re.I)
    decoder = json.JSONDecoder(strict=False)
    for index, char in enumerate(cleaned):
        if char != "{":
            continue
        try:
            value, _ = decoder.raw_decode(cleaned[index:])
        except (ValueError, TypeError):
            continue
        if isinstance(value, dict):
            return value
    return None


def normalize_citations(value: object) -> list[dict[str, str]]:
    """Chỉ nhận citation đủ định danh và giữ đúng các trường trong hợp đồng API."""
    if not isinstance(value, list):
        return []
    normalized = []
    seen = set()
    for item in value:
        if not isinstance(item, dict):
            continue
        fields = ("chunk_id", "doc_number", "article", "clause", "snippet", "source_url")
        if any(not isinstance(item.get(field, ""), str) for field in fields):
            continue
        citation = {field: item.get(field, "").strip() for field in fields}
        if not citation["chunk_id"] or not citation["doc_number"]:
            continue
        if citation["chunk_id"] in seen:
            continue
        seen.add(citation["chunk_id"])
        normalized.append(citation)
    return normalized


def parse_answer(raw: str) -> tuple[str, list[dict[str, str]]]:
    """Từ chối phản hồi sai schema hoặc không có trích dẫn làm căn cứ."""
    payload = extract_json(raw)
    if not payload or not isinstance(payload.get("answer"), str) or not isinstance(payload.get("citations"), list):
        return REFUSAL, []
    # Giữ từng citation gốc đến hết xác minh; khử trùng sớm có thể che căn cứ sai.
    citations = []
    for item in payload["citations"]:
        normalized = normalize_citations([item])
        if not normalized or not normalized[0]["snippet"]:
            return REFUSAL, []
        citations.append(normalized[0])
    answer = payload["answer"].strip()
    if not answer or not citations:
        return REFUSAL, []
    return answer, citations
