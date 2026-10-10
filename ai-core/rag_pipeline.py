"""Dịch vụ hỏi đáp trên collection pháp luật với truy xuất lai đã lọc quyền."""

import json
import os
import requests
from pathlib import Path

import chromadb
from chromadb.config import Settings as ChromaSettings
from chromadb.utils import embedding_functions

from legal.retrieval import LegalRetriever
from legal.citations import parse_answer
from legal.prompts import REFUSAL, SYSTEM_PROMPT
from legal.security import detect_prompt_injection, wrap_untrusted_context

try:
    from google import genai
    from google.genai import types as genai_types
except ImportError:
    genai = None
    genai_types = None


BASE_DIR = Path(__file__).resolve().parent


class RagAnswer(tuple):
    """Giữ hợp đồng bốn phần cũ và mang thêm trích dẫn có cấu trúc cho API."""

    def __new__(cls, answer, sources, suggestions, images, citations=None):
        """Gắn citation vào kết quả mà không thay đổi luồng giải nén hiện tại."""
        result = super().__new__(cls, (answer, sources, suggestions, images))
        result.citations = citations or []
        return result


class AIServiceError(Exception):
    """Lỗi nghiệp vụ AI Core có mã HTTP rõ ràng cho lớp API."""

    def __init__(self, status_code: int, detail: str):
        """Gắn mã trạng thái và thông điệp lỗi trước khi chuyển lên endpoint."""
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class LegalRAG:
    """Quản lý collection pháp luật và tạo câu trả lời từ các chunk được phép xem."""

    def __init__(self, db_path=None, collection_name="legal_documents"):
        """Mở collection pháp luật độc lập và khởi tạo bộ truy xuất lai."""
        path = str(db_path or os.getenv("LEGAL_CHROMA_PATH") or BASE_DIR / "chroma_db")
        self.chroma_client = chromadb.PersistentClient(
            path=path,
            settings=ChromaSettings(anonymized_telemetry=False),
        )
        self.collection = self.chroma_client.get_or_create_collection(
            name=collection_name,
            embedding_function=embedding_functions.DefaultEmbeddingFunction(),
        )
        self.retriever = LegalRetriever(self.collection)
        # Giữ client Gemini cùng vòng đời của bộ RAG để kết nối không bị đóng giữa yêu cầu.
        self._genai_client = None

    def answer_question(self, question: str, history=None, allow_internal: bool = False,
                        model_provider: str = "gemini", model_api_key: str | None = None):
        """Trả lời bằng các nguồn đã lọc quyền, kèm cảnh báo hiệu lực khi cần."""
        if not question or not question.strip():
            raise AIServiceError(400, "Câu hỏi không được để trống.")
        if detect_prompt_injection(question):
            raise AIServiceError(400, "Nội dung chứa chỉ dẫn không an toàn. Vui lòng đặt câu hỏi pháp luật trực tiếp.")
        if self.collection.count() == 0:
            return RagAnswer(REFUSAL, [], [], [])

        chunks = self.retriever.search(question, limit=5, allow_internal=allow_internal)
        # Loại nguồn chứa lệnh thao túng trước khi ghép vào lời nhắc của mô hình.
        chunks = [chunk for chunk in chunks if not detect_prompt_injection(chunk.document)]
        if not chunks:
            return RagAnswer(REFUSAL, [], [], [])

        key = model_api_key or os.getenv("GEMINI_API_KEY")
        if model_provider != "local" and not key:
            raise AIServiceError(503, "Dịch vụ trả lời chưa được cấu hình mô hình AI.")

        context = "\n\n".join(
            f"[Nguồn {index + 1}] metadata={json.dumps({'chunk_id': chunk.chunk_id, 'doc_title': chunk.metadata.get('doc_title', ''), 'doc_number': chunk.metadata.get('doc_number', ''), 'issued_date': chunk.metadata.get('issued_date', ''), 'effective_status': chunk.effective_status, 'article': 'Điều ' + str(chunk.metadata['article_number']) if chunk.metadata.get('article_number') else '', 'clause': 'Khoản ' + str(chunk.metadata['clause_number']) if chunk.metadata.get('clause_number') else '', 'point': chunk.metadata.get('point_id', ''), 'source_url': chunk.metadata.get('source_url', '')}, ensure_ascii=False)}\n{chunk.document}"
            + (f"\n[Cảnh báo hiệu lực: {chunk.warning}]" if chunk.warning else "")
            for index, chunk in enumerate(chunks)
        )
        prompt = (
            f"NGUỒN:\n{wrap_untrusted_context(context)}\n\nCÂU HỎI: {question}"
        )
        try:
            if model_provider == "gemini":
                if not genai or not genai_types:
                    raise AIServiceError(503, "Chưa cài đặt thư viện mô hình Gemini.")
                # Khóa riêng của quản trị viên không được lưu trong client dùng chung.
                if model_api_key:
                    client = genai.Client(api_key=key)
                else:
                    if getattr(self, "_genai_client", None) is None:
                        self._genai_client = genai.Client(api_key=key)
                    client = self._genai_client
                response = client.models.generate_content(
                    model=os.getenv("GEMINI_MODEL") or "gemini-2.5-flash-lite", contents=prompt,
                    config=genai_types.GenerateContentConfig(temperature=0, system_instruction=SYSTEM_PROMPT,
                                                            response_mime_type="application/json"),
                )
                response_text = response.text
            elif model_provider in {"openai", "local"}:
                from openai import OpenAI
                base_url = os.getenv("LOCAL_LLM_BASE_URL") if model_provider == "local" else None
                if model_provider == "local" and not base_url:
                    raise AIServiceError(503, "Chưa cấu hình địa chỉ mô hình nội bộ.")
                client = OpenAI(api_key=key or "local", base_url=base_url, timeout=30)
                model = os.getenv("LOCAL_LLM_MODEL", "local-model") if model_provider == "local" else os.getenv("OPENAI_MODEL", "gpt-4o-mini")
                result = client.chat.completions.create(model=model, temperature=0,
                    messages=[{"role": "system", "content": SYSTEM_PROMPT + " Trả kết quả JSON hợp lệ."},
                              {"role": "user", "content": prompt}])
                response_text = result.choices[0].message.content
            elif model_provider == "anthropic":
                result = requests.post("https://api.anthropic.com/v1/messages", timeout=30,
                    headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                    json={"model": os.getenv("ANTHROPIC_MODEL", "claude-3-5-haiku-latest"), "max_tokens": 2048,
                          "system": SYSTEM_PROMPT + " Trả kết quả JSON hợp lệ.",
                          "messages": [{"role": "user", "content": prompt}]})
                result.raise_for_status()
                response_text = "".join(part.get("text", "") for part in result.json().get("content", []))
            else:
                raise AIServiceError(400, "Nhà cung cấp mô hình không hợp lệ.")
        except AIServiceError:
            raise
        except Exception as exc:
            raise AIServiceError(503, "Mô hình AI chưa phản hồi.") from exc
        if not response_text:
            raise AIServiceError(502, "Mô hình AI không trả về nội dung.")

        sources = []
        for chunk in chunks:
            item = chunk.metadata
            # Gửi nguyên văn chunk đã truy xuất để giao diện đối chiếu đúng nguồn gốc.
            source = {
                "chunk_id": chunk.chunk_id,
                "content": chunk.document,
                "title": item.get("doc_title", "Văn bản pháp luật"),
                "url": item.get("source_url", ""),
                "doc_number": item.get("doc_number", ""),
                "chapter": item.get("chapter"),
                "article_number": item.get("article_number"),
                "clause_number": item.get("clause_number"),
                "issued_date": item.get("issued_date"),
                "effective_status": chunk.effective_status,
            }
            if chunk.warning:
                source["warning"] = chunk.warning
            if source not in sources:
                sources.append(source)
        answer, citations = parse_answer(response_text)
        # Chuẩn hóa nhãn Điều/Khoản theo metadata để Backend xác minh cùng một căn cứ.
        allowed = {chunk.chunk_id: chunk for chunk in chunks}
        trusted_citations = []
        for item in citations:
            chunk = allowed.get(item["chunk_id"])
            if not chunk or not item["snippet"] or item["snippet"] not in chunk.document:
                continue
            metadata = chunk.metadata
            doc_number = str(metadata.get("doc_number") or "")
            article = f"Điều {metadata['article_number']}" if metadata.get("article_number") else ""
            clause = f"Khoản {metadata['clause_number']}" if metadata.get("clause_number") else ""
            source_url = str(metadata.get("source_url") or "")
            if (not doc_number or not article or item["doc_number"] != doc_number
                    or item["article"] != article or item["source_url"] != source_url):
                continue
            if item["clause"] != clause and clause:
                continue
            # Chunk gộp cả Điều có thể thiếu metadata Khoản; chỉ giữ nhãn Điều đã xác minh.
            trusted_citations.append({**item, "clause": clause})
        citations = trusted_citations
        if not citations:
            answer = REFUSAL
        else:
            warnings = list(dict.fromkeys(allowed[item["chunk_id"]].warning for item in citations if allowed[item["chunk_id"]].warning))
            if warnings:
                # Gắn phiên bản nguồn đã dùng để người đọc không nhầm với văn bản hiện hành.
                versions = list(dict.fromkeys(
                    (allowed[item["chunk_id"]].metadata.get("doc_number", ""),
                     allowed[item["chunk_id"]].metadata.get("issued_date", ""),
                     allowed[item["chunk_id"]].effective_status)
                    for item in citations if allowed[item["chunk_id"]].warning
                ))
                version_notes = [
                    f"Phiên bản nguồn: {number}, ngày ban hành {issued or 'chưa rõ'}, trạng thái {status}."
                    for number, issued, status in versions
                ]
                # Gắn cảnh báo vào phần lưu ý để không tạo mục thứ tư ngoài cấu trúc trả lời.
                answer += "\n\n" + "\n".join(
                    [*(f"- **Hiệu lực nguồn:** {warning}" for warning in warnings),
                     *(f"- **Phiên bản nguồn:** {note}" for note in version_notes)]
                )
        return RagAnswer(answer, sources, [], [], citations)
