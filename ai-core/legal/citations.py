"""Bóc tách JSON và chuẩn hóa trích dẫn do mô hình sinh ra."""

import json
import re

from legal.prompts import REFUSAL


def extract_json(raw: str) -> dict | None:
    """Đọc đối tượng JSON đầu tiên, kể cả khi có markdown fence hoặc ký tự thừa."""
    if not isinstance(raw, str):
        return None
    cleaned = re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", raw.strip(), flags=re.I)
    decoder = json.JSONDecoder()
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
        if not citation["chunk_id"] or not citation["doc_number"] or not citation["article"]:
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
    citations = normalize_citations(payload["citations"])
    answer = payload["answer"].strip()
    if not answer or not citations:
        return REFUSAL, []
    return answer, citations
