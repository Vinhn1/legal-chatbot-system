"""Kịch bản kiểm tra thực tế Phase 2 Retrieval trên 346 chunks trong ChromaDB."""

import json
import os
from pathlib import Path
import sys

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parents[1]
ROOT_DIR = BASE_DIR.parent
sys.path.insert(0, str(BASE_DIR))

load_dotenv(BASE_DIR / ".env")
load_dotenv(ROOT_DIR / ".env")
load_dotenv(ROOT_DIR / "backend" / ".env")

from query_reformulator import expand_legal_query, extract_legal_references
from rag_pipeline import LegalRAG


def main() -> None:
    """Thực thi 4 câu hỏi đại diện trên tập dữ liệu 346 chunks thực tế và in Top-3 kết quả."""
    os.environ["LEGAL_EMBEDDING_PROVIDER"] = "gemini"
    os.environ["LEGAL_EMBEDDING_DIM"] = "768"
    rag = LegalRAG()
    print(f"TOTAL CHUNKS IN CHROMADB: {rag.collection.count()}")

    queries = [
        (
            "Q1 (Exact Điểm/Khoản/Điều - Tách thửa đất Tây Ninh)",
            "Điểm a Khoản 2 Điều 11 quy định về điều kiện tách thửa đất tại tỉnh Tây Ninh như thế nào?",
        ),
        (
            "Q2 (Nghị định 312/2026/NĐ-CP - Kết hợp an ninh với kinh tế - xã hội)",
            "Theo Điều 6 và Điều 7 Nghị định 312/2026/NĐ-CP, việc kết hợp an ninh với kinh tế - xã hội trong chiến lược, quy hoạch được quy định ra sao?",
        ),
        (
            "Q3 (Mentioned Articles trong Chuyên đề CD-01 - Không bị Zero-Result)",
            "Theo Điều 7 và Điều 8 Luật Doanh nghiệp, quyền và nghĩa vụ của doanh nghiệp được quy định như thế nào?",
        ),
        (
            "Q4 (Ngôn ngữ đời thường - Synonym Expansion + Hybrid Search)",
            "Muốn tách sổ đỏ cho đất ở tại Tây Ninh thì diện tích tối thiểu và mặt tiền phải đạt bao nhiêu?",
        ),
    ]

    for label, q in queries:
        refs = extract_legal_references(q)
        expanded = expand_legal_query(q)
        results = rag.retriever.search(q, limit=3, allow_internal=True)
        print("=" * 90)
        print(f"{label}")
        print(f"  Query gốc      : {q}")
        print(f"  Query mở rộng  : {expanded}")
        print(
            f"  Refs bóc tách  : doc={refs.doc_number}, articles={refs.article_numbers}, "
            f"clause={refs.clause_number}, point={refs.point_id}, hints={refs.subject_hints}"
        )
        print(f"  Số kết quả     : {len(results)}")
        for rank, item in enumerate(results, start=1):
            m = item.metadata
            preview = item.document.replace("\n", " | ")[:260]
            has_sibling = "[Ngữ cảnh bổ sung cùng Điều" in item.document
            print(
                f"  [Top {rank}] chunk_id={item.chunk_id} | doc={m.get('doc_number')} | "
                f"unit={m.get('unit_type')} | Điều={m.get('article_number')} | "
                f"Khoản={m.get('clause_number')} | Điểm={m.get('point_id')} | "
                f"mentioned={m.get('mentioned_articles')} | sibling_grouped={has_sibling}"
            )
            print(f"          Preview: {preview}...")


if __name__ == "__main__":
    main()
