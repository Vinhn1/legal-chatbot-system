"""Kịch bản kiểm thử toàn trình Phase 3: Cross-Reference Hop-2 + Self-Correcting Citation + Backend Verify."""

import asyncio
import os
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from dotenv import load_dotenv

load_dotenv(BASE_DIR / ".env")
load_dotenv(BASE_DIR.parent / ".env")

import api_server
from legal.prompts import REFUSAL


def matches_unit(label: str, prefix: str, number: str | None) -> bool:
    """Mô phỏng chính xác hàm matchesUnit(label, prefix, number) trong backend/src/chat/chat.service.ts."""
    expected = f"{prefix} {number}" if number else ""
    return label == expected


def backend_verify_citations(proposed: list[dict], stored_sources: list[dict]) -> list[dict]:
    """Mô phỏng chính xác chốt chặn kiểm tra trích dẫn thứ 2 tại Backend NestJS (chat.service.ts)."""
    by_id = {source["chunk_id"]: source for source in stored_sources}
    verified = []
    for item in proposed:
        if not isinstance(item, dict):
            continue
        source = by_id.get(item.get("chunk_id"))
        if not source:
            continue
        if item.get("doc_number") != source.get("doc_number"):
            continue
        if not matches_unit(item.get("article", ""), "Điều", source.get("article_number")):
            continue
        if not matches_unit(item.get("clause", ""), "Khoản", source.get("clause_number")):
            continue
        if item.get("source_url") != (source.get("url") or ""):
            continue
        content = source.get("content") or ""
        snippet = (item.get("snippet") or "").strip()
        if not content or not snippet or snippet not in content:
            continue
        verified.append(
            {
                "chunkId": source["chunk_id"],
                "docNumber": source["doc_number"],
                "articleNumber": source.get("article_number") or "",
                "clauseNumber": source.get("clause_number") or "",
                "pointId": source.get("point_id") or "",
                "snippet": snippet,
                "url": source.get("url") or "",
                "verified": True,
            }
        )
    return verified


def main() -> None:
    """Chạy kiểm thử End-to-End 3 câu hỏi thực tế với Gemini LLM và cả 2 tầng xác thực Citation."""
    os.environ["LEGAL_EMBEDDING_PROVIDER"] = "gemini"
    internal_token = os.getenv("AI_CORE_INTERNAL_TOKEN") or "internal-test-token"
    os.environ["AI_CORE_INTERNAL_TOKEN"] = internal_token

    bot = api_server.bot
    print(f"Tổng số chunks trong ChromaDB: {bot.collection.count()}")
    print("=" * 95)

    queries = [
        (
            "KỊCH BẢN 1 (Cross-Reference Hop-2 - Viện dẫn điều khoản)",
            "Theo Điều 9 Nghị định 312/2026/NĐ-CP, trách nhiệm thẩm định đối với các đề án, dự án thuộc các lĩnh vực quy định tại các điều được viện dẫn được thực hiện như thế nào?",
        ),
        (
            "KỊCH BẢN 2 (Tài liệu Chuyên đề CD-01 - article_number rỗng, khớp mentioned_articles)",
            "Theo Điều 7 và Điều 8 Luật Doanh nghiệp, quyền và nghĩa vụ của doanh nghiệp được quy định như thế nào?",
        ),
        (
            "KỊCH BẢN 3 (Từ đồng nghĩa + Gom ngữ cảnh cùng Điều & Remap Sibling Chunk)",
            "Muốn tách sổ đỏ cho đất ở tại Tây Ninh thì diện tích tối thiểu và kích thước mặt tiền tại phường, thị trấn và tại xã phải đạt bao nhiêu?",
        ),
    ]

    all_passed = True
    for label, question in queries:
        print(f"\n[{label}]")
        print(f"Câu hỏi: {question}")

        retrieved = bot.retriever.search(question, limit=5)
        print(f"-> Số chunks truy xuất (gồm cả Hop-2 nếu có): {len(retrieved)}")
        from query_reformulator import extract_legal_references
        q_refs = extract_legal_references(question)
        q_arts = set(q_refs.article_numbers) or ({q_refs.article_number} if q_refs.article_number else set())
        for idx, ch in enumerate(retrieved, start=1):
            meta = ch.metadata
            art_no = str(meta.get("article_number") or "")
            is_hop2 = idx > 5 or (q_arts and art_no and art_no not in q_arts)
            hop_tag = "Hop-2 Cross-Ref" if is_hop2 else f"Primary #{idx}"
            print(
                f"   [{hop_tag}] chunk_id={ch.chunk_id} | doc={meta.get('doc_number')} "
                f"| Điều={meta.get('article_number') or '-'} | Khoản={meta.get('clause_number') or '-'} "
                f"| Điểm={meta.get('point_id') or '-'} | referenced={meta.get('referenced_articles') or '-'}"
            )

        result = bot.answer_question(question)
        answer = result[0]
        proposed_citations = getattr(result, "citations", [])

        chunk_ids = [c["chunk_id"] for c in proposed_citations if isinstance(c, dict) and c.get("chunk_id")]
        verify_resp = asyncio.run(
            api_server.verify_citations(
                api_server.VerifyCitationsRequest(chunk_ids=chunk_ids),
                x_internal_token=internal_token,
            )
        )
        stored_sources = verify_resp.get("sources", [])
        verified_citations = backend_verify_citations(proposed_citations, stored_sources)

        final_answer = (
            answer
            if (proposed_citations and len(verified_citations) == len(proposed_citations) and answer != REFUSAL)
            else REFUSAL
        )
        answer_status = "refused" if final_answer == REFUSAL else "cited"

        print(f"\n-> Trạng thái (answer_status): {answer_status.upper()}")
        print(
            f"-> Số trích dẫn AI Core đề xuất: {len(proposed_citations)} | "
            f"Số trích dẫn vượt qua Backend Verify: {len(verified_citations)}"
        )
        print("-> Danh sách Citations đã Verify:")
        for c_idx, cit in enumerate(verified_citations, start=1):
            print(
                f"   ({c_idx}) chunkId={cit['chunkId']} | docNumber={cit['docNumber']} "
                f"| article='{cit['articleNumber']}' | clause='{cit['clauseNumber']}' "
                f"| verified={cit['verified']}\n       snippet=\"{cit['snippet']}\""
            )
        print("\n-> Câu trả lời của LLM:")
        print("-" * 85)
        print(final_answer)
        print("-" * 85)

        if answer_status != "cited" or not verified_citations:
            all_passed = False

    if not all_passed:
        sys.exit(1)


if __name__ == "__main__":
    main()
