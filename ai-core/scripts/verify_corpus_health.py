"""Công cụ kiểm định sức khỏe kho tri thức pháp luật (ChromaDB) và chạy benchmark truy xuất.

Dùng để kiểm tra nhanh số lượng Điều, cấu trúc phân cấp (Chương -> Điều -> Khoản -> Điểm),
các điều khoản trọng yếu của Luật 36/2024/QH15 và Nghị định 168/2024/NĐ-CP ngay sau khi nạp tệp.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from datetime import date
from pathlib import Path

from dotenv import load_dotenv

AI_CORE_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = AI_CORE_DIR.parent
if str(AI_CORE_DIR) not in sys.path:
    sys.path.insert(0, str(AI_CORE_DIR))

load_dotenv(AI_CORE_DIR / ".env")
load_dotenv(PROJECT_ROOT / ".env")

from rag_pipeline import LegalRAG  # noqa: E402

BENCHMARK_QUESTION = (
    "Tôi lái xe ô tô 5 chỗ chở con trai 8 tuổi (cao 1m25) đi học. Vì cháu thích nhìn đường "
    "nên tôi cho cháu ngồi ở ghế phụ ngay cạnh ghế lái và chỉ thắt dây an toàn có sẵn của xe "
    "chứ không lắp ghế riêng cho trẻ em. Xin hỏi việc tôi cho cháu ngồi như vậy có vi phạm quy tắc "
    "an toàn nào không, thế nào mới là thiết bị an toàn chuẩn cho trẻ em, và nếu bị cảnh sát giao thông "
    "kiểm tra thì tôi bị phạt bao nhiêu tiền, quy định phạt này áp dụng từ thời điểm nào?"
)

SPLIT_SYLLABLE_RE = re.compile(
    r"\b(?:ngh|ng|nh|gh|gi|kh|ph|qu|th|tr|ch)\s+"
    r"[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]\w*",
    re.IGNORECASE,
)


def inspect_document(collection, doc_number: str, expected_max_article: int | None = None) -> dict:
    """Thống kê chi tiết tình trạng phân đoạn và độ phủ Điều/Khoản/Điểm của một số hiệu văn bản."""
    raw = collection.get(where={"doc_number": doc_number}, include=["documents", "metadatas"])
    ids = raw.get("ids") or []
    docs = raw.get("documents") or []
    metas = raw.get("metadatas") or []

    print(f"\n======================================================================")
    print(f"KIỂM ĐỊNH VĂN BẢN: {doc_number}")
    print(f"======================================================================")
    if not ids:
        print("  Trạng thái: CHƯA CÓ TRONG KHO VECTOR (0 chunks)")
        return {"found": False, "chunk_count": 0}

    doc_ids = sorted({str(m.get("doc_id") or "") for m in metas if isinstance(m, dict)})
    statuses = Counter(str(m.get("structure_status") or "") for m in metas if isinstance(m, dict))
    unit_types = Counter(str(m.get("unit_type") or "") for m in metas if isinstance(m, dict))
    art_nums = sorted(
        {
            int(re.match(r"\d+", str(m.get("article_number"))).group())
            for m in metas
            if isinstance(m, dict) and m.get("article_number") and re.match(r"\d+", str(m.get("article_number")))
        }
    )
    unit_codes = {str(m.get("unit_code") or "") for m in metas if isinstance(m, dict) and m.get("unit_code")}
    split_matches = SPLIT_SYLLABLE_RE.findall("\n".join(d for d in docs if isinstance(d, str)))

    print(f"  Số bản ghi doc_id      : {len(doc_ids)} ({', '.join(doc_ids)})")
    print(f"  Tổng số vector chunks  : {len(ids)}")
    print(f"  Trạng thái cấu trúc    : {dict(statuses)}")
    print(f"  Phân bổ cấp đơn vị     : {dict(unit_types)}")
    print(f"  Số lượng Điều nhận diện: {len(art_nums)}" + (f" (từ Điều {min(art_nums)} đến Điều {max(art_nums)})" if art_nums else ""))
    print(f"  Âm tiết bị tách rời    : {len(split_matches)}")

    target_max = expected_max_article or (max(art_nums) if art_nums else 0)
    if target_max > 0:
        missing = sorted(set(range(1, target_max + 1)) - set(art_nums))
        if missing:
            preview = ", ".join(str(n) for n in missing[:25]) + ("..." if len(missing) > 25 else "")
            print(f"  CẢNH BÁO thiếu {len(missing)}/{target_max} Điều: [{preview}]")
        else:
            print(f"  Độ phủ Điều 1..{target_max}     : ĐẦY ĐỦ 100% (không thiếu Điều nào)")

    if doc_number == "36/2024/QH15":
        has_2_13 = "36/2024/QH15:2:13" in unit_codes or any(
            m.get("article_number") == "2" and m.get("clause_number") == "13" for m in metas if isinstance(m, dict)
        )
        has_10_3 = "36/2024/QH15:10:3" in unit_codes or any(
            m.get("article_number") == "10" and m.get("clause_number") == "3" for m in metas if isinstance(m, dict)
        )
        print(f"  Kiểm tra Khoản 13 Điều 2 (Thiết bị an toàn trẻ em) : {'ĐẠT' if has_2_13 else 'THIẾU'}")
        print(f"  Kiểm tra Khoản 3 Điều 10 (Quy tắc chở trẻ em ô tô) : {'ĐẠT' if has_10_3 else 'THIẾU'}")

    if doc_number == "168/2024/NĐ-CP":
        has_art5 = 5 in art_nums
        has_art6 = 6 in art_nums
        has_6_3_m = "168/2024/NĐ-CP:6:3:m" in unit_codes or any(
            m.get("article_number") == "6" and m.get("clause_number") == "3" and m.get("point_id") == "m"
            for m in metas
            if isinstance(m, dict)
        )
        has_53_2 = "168/2024/NĐ-CP:53:2" in unit_codes or any(
            m.get("article_number") == "53" and m.get("clause_number") == "2"
            for m in metas
            if isinstance(m, dict)
        )
        print(f"  Kiểm tra Điều 5 (Xử phạt người đi bộ)              : {'ĐẠT' if has_art5 else 'THIẾU'}")
        print(f"  Kiểm tra Điều 6 (Xử phạt xe ô tô)                  : {'ĐẠT' if has_art6 else 'THIẾU'}")
        print(f"  Kiểm tra Điểm m Khoản 3 Điều 6 (Chở trẻ em ô tô)   : {'ĐẠT' if has_6_3_m else 'THIẾU'}")
        print(f"  Kiểm tra Khoản 2 Điều 53 (Hiệu lực 01/01/2026)     : {'ĐẠT' if has_53_2 else 'THIẾU'}")
        if not (has_art6 and has_6_3_m and has_53_2):
            print(
                "  HƯỚNG DẪN: Bản Nghị định 168/2024/NĐ-CP hiện tại trong ChromaDB bị thiếu trang từ lần nạp cũ. "
                "Vui lòng xóa bản ghi 168/2024/NĐ-CP cũ trên trang Quản trị và tải lại tệp PDF gốc qua luồng AI OCR mới (batch_size=2, chống sót trang)."
            )

    return {"found": True, "chunk_count": len(ids), "articles": art_nums}


def main() -> int:
    parser = argparse.ArgumentParser(description="Kiểm định kho vector pháp luật và kiểm thử truy xuất đa truy vấn.")
    parser.add_argument("--doc", help="Chỉ kiểm tra một số hiệu văn bản cụ thể (ví dụ: 168/2024/NĐ-CP)")
    parser.add_argument("--skip-search", action="store_true", help="Bỏ qua bước chạy thử câu hỏi benchmark")
    args = parser.parse_args()

    bot = LegalRAG()
    all_rows = bot.collection.get(include=["metadatas"])
    by_doc = Counter(
        (str(m.get("doc_number") or ""), str(m.get("doc_id") or ""))
        for m in (all_rows.get("metadatas") or [])
        if isinstance(m, dict)
    )
    print(f"TỔNG QUAN KHO VECTOR (legal_documents): {bot.collection.count()} chunks")
    for (dnum, did), cnt in sorted(by_doc.items()):
        print(f"  - {dnum or '(không số hiệu)'} | doc_id={did} | {cnt} chunks")

    if args.doc:
        inspect_document(bot.collection, args.doc)
    else:
        inspect_document(bot.collection, "36/2024/QH15", expected_max_article=89)
        inspect_document(bot.collection, "168/2024/NĐ-CP", expected_max_article=53)

    if not args.skip_search:
        print(f"\n======================================================================")
        print("KIỂM THỬ TRUY XUẤT CÂU HỎI TÌNH HUỐNG GIAO THÔNG (BENCHMARK)")
        print(f"======================================================================")
        results = bot.retriever.search(BENCHMARK_QUESTION, limit=5, as_of=date(2026, 10, 31))
        print(f"Số lượng chunks truy xuất được (sau Multi-Query RRF + 2-Way Cross-Ref): {len(results)}")
        for rank, item in enumerate(results, start=1):
            meta = item.metadata
            u_code = meta.get("unit_code") or f"{meta.get('doc_number')}:{meta.get('article_number')}:{meta.get('clause_number')}:{meta.get('point_id')}"
            first_line = item.document.splitlines()[0] if item.document else ""
            print(
                f"  #{rank:02d} | {meta.get('doc_number')} | unit_code={u_code} | "
                f"Điều={meta.get('article_number')} Khoản={meta.get('clause_number')} Điểm={meta.get('point_id')} | {first_line[:75]}"
            )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
