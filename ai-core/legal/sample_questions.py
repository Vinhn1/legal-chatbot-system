# Chú thích: Module sinh và lưu bộ nhớ đệm câu hỏi mẫu tra cứu pháp lý dựa trên các tài liệu mới nhất được nạp vào hệ thống
import json
import logging
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

CACHE_FILE = Path(__file__).resolve().parent.parent / "dynamic_suggestions.json"

DEFAULT_FALLBACK_QUESTIONS = [
    "Tóm tắt các quy định và nội dung chính của tài liệu này?",
    "Điều kiện, quy trình và thời hạn áp dụng được quy định như thế nào?",
    "Trách nhiệm, quyền hạn và nghĩa vụ của các bên liên quan?",
    "Các trường hợp ngoại lệ hoặc chế tài xử lý vi phạm quy định?",
]

GENERIC_ARTICLE_TITLES = {
    "phạm vi điều chỉnh",
    "đối tượng áp dụng",
    "hiệu lực thi hành",
    "điều khoản thi hành",
    "giải thích từ ngữ",
    "áp dụng pháp luật",
    "trách nhiệm thi hành",
}


def extract_latest_documents(collection, limit: int = 4) -> List[Dict[str, Any]]:
    """Trích xuất danh sách các tài liệu mới nhất được nạp vào ChromaDB theo thời gian nạp hoặc ngày ban hành."""
    try:
        data = collection.get(include=["metadatas"])
    except Exception as exc:
        logger.warning("Không thể đọc metadata từ ChromaDB để lấy văn bản mới nhất: %s", exc)
        return []

    metas = data.get("metadatas") or []
    docs: Dict[str, Dict[str, Any]] = {}

    for meta in metas:
        if not isinstance(meta, dict):
            continue
        doc_key = str(meta.get("doc_id") or meta.get("doc_number") or meta.get("doc_title") or "")
        if not doc_key:
            continue

        if doc_key not in docs:
            raw_type = meta.get("document_type") or "Luật"
            title = meta.get("doc_title") or meta.get("source_title") or "Văn bản pháp luật"
            raw_number = str(meta.get("doc_number") or "")
            indexed_at = str(meta.get("indexed_at") or meta.get("issued_date") or "")
            docs[doc_key] = {
                "doc_id": str(meta.get("doc_id") or doc_key),
                "doc_number": raw_number,
                "title": title,
                "document_type": raw_type,
                "indexed_at": indexed_at,
                "scope": meta.get("scope") or "public",
                "articles": {},
                "chunks_count": 0,
            }

        docs[doc_key]["chunks_count"] += 1
        art_num = meta.get("article_number")
        art_title = meta.get("article_title")
        if art_num:
            str_num = str(art_num)
            clean_title = str(art_title or "").strip()
            if str_num not in docs[doc_key]["articles"] and clean_title:
                docs[doc_key]["articles"][str_num] = clean_title

    if not docs:
        return []

    def sort_key(item: Dict[str, Any]) -> str:
        return str(item.get("indexed_at") or "")

    sorted_docs = sorted(docs.values(), key=sort_key, reverse=True)
    return sorted_docs[:limit]


def is_meaningful_article(title: str) -> bool:
    """Loại bỏ các điều khoản dẫn nhập hình thức như phạm vi điều chỉnh, hiệu lực thi hành."""
    lower = title.strip().lower()
    return not any(generic in lower for generic in GENERIC_ARTICLE_TITLES)


def synthesize_rule_based_questions(documents: List[Dict[str, Any]]) -> List[str]:
    """Sinh câu hỏi mẫu dựa trên quy tắc phân tích tiêu đề và điều khoản của các văn bản mới nhất."""
    questions: List[str] = []

    for doc in documents:
        title = doc.get("title") or ""
        doc_number = doc.get("doc_number") or ""
        articles = doc.get("articles") or {}
        ref_label = doc_number if doc_number and not doc_number.startswith("CHUA-XAC-DINH") else title

        # Lọc các điều khoản có nội dung thực chất, bỏ qua các điều dẫn nhập hình thức
        meaningful_articles = [
            (num, art_title) for num, art_title in articles.items()
            if art_title and len(art_title) > 4 and is_meaningful_article(art_title)
        ]

        if meaningful_articles:
            art_num, art_title = meaningful_articles[0]
            clean_title = re.sub(r"^(?:quy định về|các quy định về)\s+", "", art_title, flags=re.IGNORECASE)
            question = f"Quy định về {clean_title.lower()} theo Điều {art_num} {ref_label}?"
            if question not in questions:
                questions.append(question)
        else:
            lower_title = title.lower()
            if "xử phạt" in lower_title or "vi phạm" in lower_title:
                q = f"Mức xử phạt và quy định chế tài vi phạm theo {ref_label}?"
            elif "an toàn giao thông" in lower_title:
                q = f"Các quy tắc bảo đảm trật tự an toàn giao thông theo {ref_label}?"
            elif "tách thửa" in lower_title or "đất" in lower_title:
                q = f"Điều kiện và diện tích tối thiểu khi tách thửa đất theo {ref_label}?"
            elif "lao động" in lower_title or "thử việc" in lower_title:
                q = f"Quy định về hợp đồng lao động và thời gian thử việc theo {ref_label}?"
            elif "doanh nghiệp" in lower_title:
                q = f"Điều kiện và thủ tục thành lập, quản lý theo {ref_label}?"
            else:
                q = f"Nội dung trọng tâm và phạm vi điều chỉnh của {ref_label} là gì?"

            if q not in questions:
                questions.append(q)

        if len(questions) >= 4:
            break

    # Bổ sung câu hỏi mặc định nếu danh sách còn thiếu để luôn đảm bảo ít nhất 3 câu hỏi
    for default_q in DEFAULT_FALLBACK_QUESTIONS:
        if len(questions) >= 3:
            break
        if default_q not in questions:
            questions.append(default_q)

    return questions[:4]


def generate_ai_sample_questions(
    documents: List[Dict[str, Any]],
    genai_client: Any,
    model_name: str = "gemini-2.5-flash",
) -> Optional[List[str]]:
    """Sử dụng mô hình AI để sinh câu hỏi tra cứu thực tế từ các tài liệu mới nhất."""
    if not genai_client or not documents:
        return None

    try:
        from google.genai import types as genai_types
    except ImportError:
        genai_types = None

    doc_summaries = []
    for i, doc in enumerate(documents, start=1):
        title = doc.get("title") or ""
        doc_num = doc.get("doc_number") or ""
        articles = doc.get("articles") or {}
        meaningful = [
            f"Điều {k}: {v}" for k, v in articles.items()
            if v and is_meaningful_article(v)
        ][:4]
        sample_articles_str = ", ".join(meaningful) if meaningful else "Nội dung quy định"
        doc_summaries.append(f"{i}. {title} (Số hiệu: {doc_num})\n   Điều khoản tiêu biểu: {sample_articles_str}")

    doc_text = "\n".join(doc_summaries)
    prompt = f"""Dưới đây là danh sách các văn bản quy phạm pháp luật mới nhất vừa được nạp vào cơ sở dữ liệu hệ thống:
{doc_text}

Hãy đóng vai trò một chuyên gia pháp lý, tạo đúng 3 đến 4 câu hỏi tra cứu pháp lý mẫu thực tế, tự nhiên và chuyên nghiệp bằng tiếng Việt mà người dân, doanh nghiệp hoặc luật sư thường hỏi khi tra cứu các văn bản mới nhất này.

Yêu cầu bắt buộc:
1. Mỗi câu hỏi tập trung vào một vấn đề pháp lý cụ thể, quyền lợi, nghĩa vụ hoặc chế tài xử phạt thực tế trong văn bản.
2. Tuyệt đối không hỏi các câu chung chung như "phạm vi điều chỉnh là gì" hoặc "đối tượng áp dụng là ai".
3. Câu hỏi ngắn gọn (12 - 25 từ), kết thúc bằng dấu chấm hỏi (?).
4. Phân bổ câu hỏi đại diện cho các văn bản mới nhất nêu trên.
5. Trả về DUY NHẤT một mảng JSON thuần túy gồm các chuỗi câu hỏi, không kèm markdown hoặc giải thích thêm.
Ví dụ: ["Câu hỏi 1?", "Câu hỏi 2?", "Câu hỏi 3?"]"""

    candidate_models = [model_name, "gemini-2.5-flash-lite", "gemini-1.5-flash"]
    for candidate in candidate_models:
        try:
            gen_kwargs: Dict[str, Any] = {
                "temperature": 0.3,
                "top_p": 0.9,
                "max_output_tokens": 1024,
                "response_mime_type": "application/json",
            }
            if genai_types and hasattr(genai_types, "ThinkingConfig"):
                gen_kwargs["thinking_config"] = genai_types.ThinkingConfig(thinking_budget=0)

            config_obj = (
                genai_types.GenerateContentConfig(**gen_kwargs)
                if genai_types and hasattr(genai_types, "GenerateContentConfig")
                else gen_kwargs
            )
            response = genai_client.models.generate_content(
                model=candidate,
                contents=prompt,
                config=config_obj,
            )
            raw_text = (response.text or "").strip()
            cleaned = re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", raw_text, flags=re.I).strip()
            parsed = json.loads(cleaned)
            if isinstance(parsed, list) and len(parsed) >= 2:
                valid_questions = [
                    str(item).strip() for item in parsed
                    if isinstance(item, str) and len(str(item).strip()) > 10 and str(item).strip().endswith("?")
                ]
                if len(valid_questions) >= 2:
                    return valid_questions[:4]
        except Exception as exc:
            logger.warning("Không thể sinh câu hỏi mẫu bằng AI với model %s: %s", candidate, exc)
            continue

    return None


def get_or_generate_sample_questions(
    collection: Any,
    genai_client: Any = None,
    force_refresh: bool = False,
) -> List[str]:
    """Lấy danh sách câu hỏi mẫu từ bộ nhớ đệm, tự động làm mới khi có văn bản mới hoặc khi có yêu cầu ép buộc."""
    latest_docs = extract_latest_documents(collection, limit=4)
    if not latest_docs:
        return DEFAULT_FALLBACK_QUESTIONS

    # Tạo chữ ký nhận diện trạng thái các văn bản mới nhất
    current_fingerprint = "|".join([
        f"{d.get('doc_id')}:{d.get('doc_number')}:{d.get('indexed_at')}"
        for d in latest_docs
    ])

    # Kiểm tra bộ nhớ đệm nếu không ép buộc làm mới
    if not force_refresh and CACHE_FILE.exists():
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                cached_data = json.load(f)
                if isinstance(cached_data, dict):
                    cached_fp = cached_data.get("fingerprint")
                    cached_questions = cached_data.get("questions")
                    if cached_fp == current_fingerprint and isinstance(cached_questions, list) and len(cached_questions) >= 2:
                        return cached_questions
        except Exception as exc:
            logger.warning("Không thể đọc bộ nhớ đệm câu hỏi mẫu: %s", exc)

    # Sinh câu hỏi mới qua AI trước, nếu thất bại chuyển sang bộ quy tắc dự phòng
    questions: Optional[List[str]] = None
    if genai_client:
        questions = generate_ai_sample_questions(latest_docs, genai_client)

    if not questions or len(questions) < 2:
        questions = synthesize_rule_based_questions(latest_docs)

    # Lưu kết quả vào bộ nhớ đệm
    try:
        payload = {
            "fingerprint": current_fingerprint,
            "generated_at": datetime.now().isoformat(),
            "latest_documents": [
                {"doc_number": d.get("doc_number"), "title": d.get("title"), "indexed_at": d.get("indexed_at")}
                for d in latest_docs
            ],
            "questions": questions,
        }
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
    except Exception as exc:
        logger.warning("Không thể lưu bộ nhớ đệm câu hỏi mẫu: %s", exc)

    return questions
