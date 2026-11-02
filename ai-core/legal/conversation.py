"""Làm rõ câu hỏi ngắn bằng lịch sử giới hạn, không thay đổi phạm vi truy cập."""

import re

from legal.security import detect_prompt_injection


def contextual_question(question, history):
    """Chỉ dùng câu hỏi người dùng gần nhất; không lấy câu trả lời cũ làm căn cứ."""
    if not history or len(question) > 300 or not re.match(r"^(?:vậy|còn|thế|trường hợp đó|khi đó|điều đó|quy định đó)\b", question.strip(), re.I):
        return question
    for entry in list(history)[-6:][::-1]:
        role = entry.get("role") if isinstance(entry, dict) else getattr(entry, "role", None)
        text = entry.get("message") if isinstance(entry, dict) else getattr(entry, "message", None)
        if role == "user" and isinstance(text, str) and 0 < len(text) <= 1000 and not detect_prompt_injection(text):
            # Hai câu đều là dữ liệu truy xuất; quyền nguồn vẫn do backend/pipeline quyết định.
            return f"Câu hỏi nối tiếp: {question}\nCâu hỏi trước: {text}"
    return question
