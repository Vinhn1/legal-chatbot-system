"""Dịch vụ hỏi đáp trên collection pháp luật với truy xuất lai đã lọc quyền."""

import json
import logging
import os
import re
import sys
import requests
from pathlib import Path

import chromadb
from chromadb.api.types import Documents, EmbeddingFunction
from chromadb.config import Settings as ChromaSettings
from chromadb.utils import embedding_functions

from legal.retrieval import LegalRetriever, RetrievedChunk
from legal.citations import parse_answer, resolve_snippet, verify_and_repair_citation
from legal.prompts import REFUSAL, SYSTEM_PROMPT
from legal.runtime_config import load_config
from legal.conversation import contextual_question
from legal.security import detect_prompt_injection, wrap_untrusted_context

try:
    from google import genai
    from google.genai import types as genai_types
except ImportError:
    genai = None
    genai_types = None


BASE_DIR = Path(__file__).resolve().parent


def _resolve_snippet(snippet: str, document: str) -> str | None:
    """Đối chiếu đoạn trích dẫn và chuẩn hóa về đúng chuỗi con nguyên văn trong chunk."""
    return resolve_snippet(snippet, document)


class RagAnswer(tuple):
    """Giữ hợp đồng bốn phần cũ và mang thêm trích dẫn có cấu trúc cho API."""

    def __new__(cls, answer, sources, suggestions, images, citations=None, config_version=None, model_version=None):
        """Gắn citation vào kết quả mà không thay đổi luồng giải nén hiện tại."""
        result = super().__new__(cls, (answer, sources, suggestions, images))
        result.citations = citations or []
        result.config_version = config_version
        result.model_version = model_version
        return result


class AIServiceError(Exception):
    """Lỗi nghiệp vụ AI Core có mã HTTP rõ ràng cho lớp API."""

    def __init__(self, status_code: int, detail: str):
        """Gắn mã trạng thái và thông điệp lỗi trước khi chuyển lên endpoint."""
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class GeminiLegalEmbeddingFunction(EmbeddingFunction[Documents]):
    """Hàm tạo vector ngữ nghĩa tiếng Việt qua Gemini Embedding API có kiểm soát số chiều và xoay vòng nhiều khóa API."""

    _exhausted_keys: dict[str, float] = {}
    _EXHAUSTED_COOLDOWN = 1800.0
    _exhausted_keys: dict[str, float] = {}

    def __init__(self, api_key: str | list[str], model_name: str = "gemini-embedding-001", output_dimensionality: int = 768):
        """Khởi tạo client Gemini và cố định số chiều vector để đồng nhất với ChromaDB."""
        if isinstance(api_key, str):
            self.api_keys = [k.strip() for k in api_key.split(",") if k.strip()]
        else:
            self.api_keys = [k.strip() for k in api_key if k.strip()]
        if not self.api_keys:
            self.api_keys = [""]
        self.key_index = 0
        self.model_name = model_name
        self.output_dimensionality = int(output_dimensionality)
        self._clients: dict[str, Any] = {}

    @property
    def api_key(self) -> str:
        """Lấy khóa API hiện hành trong danh sách."""
        return self.api_keys[self.key_index % len(self.api_keys)]

    def _get_client(self):
        """Khởi tạo lười (lazy-init) kết nối tới Gemini API theo khóa hiện tại, không retry nội bộ để chuyển khóa nhanh."""
        key = self.api_key
        if key not in self._clients:
            http_options = None
            if genai_types and hasattr(genai_types, "HttpOptions") and hasattr(genai_types, "HttpRetryOptions"):
                http_options = genai_types.HttpOptions(
                    timeout=5000,
                    retry_options=genai_types.HttpRetryOptions(attempts=1, http_status_codes=[]),
                )
            self._clients[key] = genai.Client(api_key=key, http_options=http_options)
        return self._clients[key]

    def _rotate_key(self) -> bool:
        """Chuyển sang khóa API tiếp theo nếu có nhiều khóa được cấu hình."""
        if len(self.api_keys) > 1:
            self.key_index = (self.key_index + 1) % len(self.api_keys)
            logging.getLogger(__name__).warning(
                "Đã tự động chuyển sang khóa Gemini API dự phòng (%d/%d) do đạt giới hạn hạn mức.",
                (self.key_index % len(self.api_keys)) + 1,
                len(self.api_keys),
            )
            return True
        return False

    def set_embedding_keys(self, keys: list[str]) -> None:
        """Cập nhật danh sách khóa API nhúng văn bản ngay trong bộ nhớ runtime."""
        valid_keys = [k.strip() for k in keys if isinstance(k, str) and k.strip()]
        if valid_keys:
            self.api_keys = valid_keys
            self.key_index = 0
            self._clients.clear()
            GeminiLegalEmbeddingFunction._exhausted_keys.clear()

    def _embed_openai_fallback(self, batch: list[str]) -> list[list[float]] | None:
        """Tự động chuyển đổi dự phòng sang OpenAI text-embedding-3-small khi Gemini 429."""
        openai_key = (os.getenv("OPENAI_API_KEY") or "").strip()
        if not openai_key:
            return None
        try:
            import openai
            client = openai.OpenAI(api_key=openai_key)
            resp = client.embeddings.create(
                model="text-embedding-3-small",
                input=batch,
                dimensions=self.output_dimensionality,
            )
            logging.getLogger(__name__).warning(
                "Đã tự động tạo %d vector embedding qua OpenAI text-embedding-3-small (dimensions=%d) do Gemini API đạt giới hạn hạn mức.",
                len(resp.data),
                self.output_dimensionality,
            )
            return [emb.embedding for emb in resp.data]
        except Exception as exc:
            logging.getLogger(__name__).error("Fallback OpenAI embedding thất bại: %s", exc)
            return None

    def __call__(self, input: Documents):
        """Tạo danh sách vector theo lô (batch) từ danh sách văn bản đầu vào, có xử lý giới hạn 30k TPM Free Tier và dự phòng OpenAI."""
        if not input:
            return []
        import time

        now = time.time()
        # Nếu tất cả các khóa Gemini đều đang trong trạng thái cạn hạn mức (cooldown), nhảy thẳng vào OpenAI fallback
        available_keys = [k for k in self.api_keys if (now - self.__class__._exhausted_keys.get(k, 0)) > self._EXHAUSTED_COOLDOWN]
        if not available_keys:
            fallback = self._embed_openai_fallback(input)
            if fallback and len(fallback) == len(input):
                return fallback

        results: list[list[float]] = []
        batch_size = 20
        # Tăng ngưỡng ký tự nhúng lên 2400 để bao phủ trọn vẹn cả khối tiền tố ngữ cảnh cha và nội dung Điểm/Khoản
        max_embed_chars = 2400
        total_keys = len(self.api_keys)

        for start in range(0, len(input), batch_size):
            batch = [
                (text[:max_embed_chars] if (isinstance(text, str) and text.strip()) else " ")
                for text in input[start : start + batch_size]
            ]
            batch_success = False
            max_attempts = max(total_keys * 2, 5)

            for attempt in range(max_attempts):
                try:
                    client = self._get_client()
                    response = client.models.embed_content(
                        model=self.model_name,
                        contents=batch,
                        config=genai_types.EmbedContentConfig(output_dimensionality=self.output_dimensionality),
                    )
                    for emb in response.embeddings:
                        results.append([float(val) for val in emb.values])
                    batch_success = True
                    break
                except Exception as exc:
                    err_str = str(exc)
                    if "429" in err_str or "RESOURCE_EXHAUSTED" in err_str or "Quota exceeded" in err_str:
                        self.__class__._exhausted_keys[self.api_key] = time.time()
                        # Thử luân phiên sang khóa Gemini tiếp theo nếu chưa xoay hết 1 vòng
                        if attempt < total_keys - 1:
                            if self._rotate_key():
                                continue

                        # Nếu tất cả các khóa Gemini đều cạn hạn mức (429), kích hoạt dự phòng OpenAI
                        fallback_embeddings = self._embed_openai_fallback(batch)
                        if fallback_embeddings and len(fallback_embeddings) == len(batch):
                            results.extend(fallback_embeddings)
                            batch_success = True
                            break

                        if attempt < 4:
                            time.sleep(min(10 * (attempt + 1), 30))
                            continue

                        raise RuntimeError(
                            "Hạn mức Gemini Embedding API (Free Tier 1.000 lượt/ngày) đã đạt giới hạn (429 Resource Exhausted) "
                            "và nhà cung cấp dự phòng không khả dụng. Vui lòng bổ sung thêm khóa dự phòng hoặc thử lại sau khi hạn mức làm mới."
                        ) from exc
                    raise

            if not batch_success:
                raise RuntimeError(
                    "Không thể tạo vector embeddings cho lô tài liệu (hết hạn mức hoặc lỗi kết nối)."
                )

        return results

    @staticmethod
    def name() -> str:
        """Giữ tên định danh tương thích với cấu hình ChromaDB."""
        return "default"

    def get_config(self):
        """Trả cấu hình mô hình embedding (không lưu khóa bí mật)."""
        return {"model_name": self.model_name, "output_dimensionality": self.output_dimensionality}

    @staticmethod
    def build_from_config(config):
        """Khởi tạo lại hàm embedding từ cấu hình lưu trữ."""
        return build_legal_embedding_function(
            default_dim=int((config or {}).get("output_dimensionality") or 768)
        )


def build_legal_embedding_function(default_dim: int = 768):
    """Chọn Gemini Embedding khi chạy thực tế có GEMINI_API_KEY và tự động lùi về ONNX khi chạy kiểm thử."""
    provider = (os.getenv("LEGAL_EMBEDDING_PROVIDER") or "auto").strip().lower()
    in_test = bool(os.getenv("PYTEST_CURRENT_TEST")) or ("unittest" in sys.modules and provider != "gemini")
    if provider in ("default", "onnx", "local") or in_test or genai is None or genai_types is None:
        return embedding_functions.DefaultEmbeddingFunction()
    raw_keys = (os.getenv("GEMINI_API_KEYS") or os.getenv("GEMINI_API_KEY") or "").strip()
    keys = [k.strip() for k in raw_keys.split(",") if k.strip() and len(k.strip()) >= 20 and not k.strip().startswith("test")]
    if not keys:
        return embedding_functions.DefaultEmbeddingFunction()
    model_name = (os.getenv("LEGAL_EMBEDDING_MODEL") or "gemini-embedding-001").strip()
    dim = int(os.getenv("LEGAL_EMBEDDING_DIM") or default_dim)
    return GeminiLegalEmbeddingFunction(api_key=keys, model_name=model_name, output_dimensionality=dim)


class LegalRAG:
    """Quản lý collection pháp luật và tạo câu trả lời từ các chunk được phép xem."""

    def __init__(self, db_path=None, collection_name="legal_documents", embedding_function=None):
        """Mở collection pháp luật độc lập và khởi tạo bộ truy xuất lai."""
        path = str(db_path or os.getenv("LEGAL_CHROMA_PATH") or BASE_DIR / "chroma_db")
        self.chroma_client = chromadb.PersistentClient(
            path=path,
            settings=ChromaSettings(anonymized_telemetry=False),
        )
        ef = embedding_function or build_legal_embedding_function()
        if isinstance(ef, GeminiLegalEmbeddingFunction):
            try:
                raw_col = self.chroma_client.get_or_create_collection(name=collection_name)
                if raw_col.count() > 0:
                    peeked = raw_col.peek(limit=1)
                    embs = peeked.get("embeddings")
                    if embs is not None and len(embs) > 0 and len(embs[0]) > 0:
                        existing_dim = len(embs[0])
                        if existing_dim != ef.output_dimensionality:
                            logging.getLogger(__name__).info(
                                "Đồng bộ số chiều Gemini Embedding (%s -> %s) khớp với collection hiện có.",
                                ef.output_dimensionality,
                                existing_dim,
                            )
                            ef.output_dimensionality = existing_dim
            except Exception:
                pass
        self.embedding_function = ef
        self.collection = self.chroma_client.get_or_create_collection(
            name=collection_name,
            embedding_function=ef,
        )
        self.retriever = LegalRetriever(self.collection, revision_path=Path(path) / '.corpus-revision')
        # Giữ client Gemini cùng vòng đời của bộ RAG để kết nối không bị đóng giữa yêu cầu.
        self._genai_client = None

    def get_genai_client(self):
        """Khởi tạo hoặc trả về client Gemini hiện hành với danh sách khóa API hợp lệ."""
        if getattr(self, "_genai_client", None) is not None:
            return self._genai_client
        if not genai or not genai_types:
            return None
        gemini_keys = self.gemini_api_keys if hasattr(self, "gemini_api_keys") and self.gemini_api_keys else []
        if not gemini_keys:
            raw_keys = os.getenv("GEMINI_API_KEYS") or os.getenv("GEMINI_API_KEY") or ""
            gemini_keys = [k.strip() for k in raw_keys.split(",") if k.strip()]
        if not gemini_keys:
            return None
        current_key = gemini_keys[0]
        client_kwargs = {"api_key": current_key}
        if hasattr(genai_types, "HttpOptions") and hasattr(genai_types, "HttpRetryOptions"):
            client_kwargs["http_options"] = genai_types.HttpOptions(
                timeout=30000,
                retry_options=genai_types.HttpRetryOptions(attempts=1, http_status_codes=[]),
            )
        self._genai_client = genai.Client(**client_kwargs)
        self._genai_key = current_key
        return self._genai_client

    def update_embedding_keys(self, keys: list[str]) -> bool:
        """Đồng bộ khóa API nhúng vào hàm embedding hiện hành của Chroma collection trong bộ nhớ runtime."""
        valid_keys = [k.strip() for k in keys if isinstance(k, str) and k.strip()]
        if not valid_keys:
            return False
        if isinstance(self.embedding_function, GeminiLegalEmbeddingFunction):
            self.embedding_function.set_embedding_keys(valid_keys)
            return True
        else:
            dim = getattr(self.embedding_function, "output_dimensionality", 768)
            model_name = (os.getenv("LEGAL_EMBEDDING_MODEL") or "gemini-embedding-001").strip()
            new_ef = GeminiLegalEmbeddingFunction(api_key=valid_keys, model_name=model_name, output_dimensionality=dim)
            self.embedding_function = new_ef
            self.collection._embedding_function = new_ef
            return True

    def answer_question(self, question: str, history=None, allow_internal: bool = False,
                        model_provider: str = "gemini", model_api_key: str | None = None):
        """Trả lời bằng các nguồn đã lọc quyền, kèm cảnh báo hiệu lực khi cần."""
        if not question or not question.strip():
            raise AIServiceError(400, "Câu hỏi không được để trống.")
        if detect_prompt_injection(question):
            raise AIServiceError(400, "Nội dung chứa chỉ dẫn không an toàn. Vui lòng đặt câu hỏi pháp luật trực tiếp.")
        if self.collection.count() == 0:
            return RagAnswer(REFUSAL, [], [], [])

        # Tham số được đọc cho mỗi yêu cầu để thay đổi đã lưu có hiệu lực ngay.
        try:
            config = load_config()
            system_prompt = config.prompt
        except (ValueError, OSError) as exc:
            raise AIServiceError(503, "Cấu hình RAG không hợp lệ.") from exc
        question = contextual_question(question, history)
        chunks = self.retriever.search(question, limit=5, allow_internal=allow_internal)
        # Loại nguồn chứa lệnh thao túng trước khi ghép vào lời nhắc của mô hình.
        chunks = [chunk for chunk in chunks if not detect_prompt_injection(chunk.document)]
        if not chunks:
            return RagAnswer(REFUSAL, [], [], [])

        # Chuẩn bị danh sách khóa API theo nhà cung cấp
        if model_provider == "gemini":
            if not genai or not genai_types:
                raise AIServiceError(503, "Chưa cài đặt thư viện mô hình Gemini.")
            if model_api_key:
                gemini_keys = [model_api_key.strip()]
            else:
                raw_keys = (os.getenv("GEMINI_API_KEYS") or os.getenv("GEMINI_API_KEY") or "").strip()
                gemini_keys = [k.strip() for k in raw_keys.split(",") if k.strip()]
            if not gemini_keys:
                raise AIServiceError(503, "Dịch vụ trả lời chưa được cấu hình khóa Gemini API.")
        else:
            key = model_api_key or os.getenv({"openai": "OPENAI_API_KEY", "anthropic": "ANTHROPIC_API_KEY"}.get(model_provider, ""))
            if model_provider != "local" and not key:
                raise AIServiceError(503, f"Dịch vụ trả lời chưa được cấu hình khóa API cho {model_provider}.")

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
                primary_model = os.getenv("GEMINI_MODEL") or "gemini-2.5-flash"
                fallback_models = [primary_model]
                for candidate_model in ("gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-1.5-flash", "gemini-2.0-flash"):
                    if candidate_model not in fallback_models:
                        fallback_models.append(candidate_model)
                response = None
                last_exc = None
                for k_idx, current_key in enumerate(gemini_keys):
                    client_kwargs = {"api_key": current_key}
                    if genai_types and hasattr(genai_types, "HttpOptions") and hasattr(genai_types, "HttpRetryOptions"):
                        client_kwargs["http_options"] = genai_types.HttpOptions(
                            timeout=30000,
                            retry_options=genai_types.HttpRetryOptions(attempts=1, http_status_codes=[]),
                        )
                    if model_api_key:
                        client = genai.Client(**client_kwargs)
                    else:
                        if getattr(self, "_genai_client", None) is None or getattr(self, "_genai_key", None) != current_key:
                            self._genai_client = genai.Client(**client_kwargs)
                            self._genai_key = current_key
                        client = self._genai_client
                    for model_idx, active_model in enumerate(fallback_models):
                        try:
                            gen_kwargs = {
                                "temperature": config.temperature,
                                "top_p": config.top_p,
                                "max_output_tokens": config.max_tokens,
                                "system_instruction": system_prompt,
                                "response_mime_type": "application/json",
                            }
                            # Tắt suy nghĩ ngầm trên Gemini 2.5 để toàn bộ định mức token dành cho câu trả lời và trích dẫn JSON
                            if hasattr(genai_types, "ThinkingConfig"):
                                gen_kwargs["thinking_config"] = genai_types.ThinkingConfig(thinking_budget=0)
                            response = client.models.generate_content(
                                model=active_model,
                                contents=prompt,
                                config=genai_types.GenerateContentConfig(**gen_kwargs),
                            )
                            break
                        except Exception as exc:
                            last_exc = exc
                            err_text = str(exc)
                            if "404" in err_text or "NOT_FOUND" in err_text:
                                continue
                            if any(code in err_text for code in ("503", "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED", "Quota exceeded", "504", "DEADLINE_EXCEEDED", "timed out", "Timeout")):
                                logging.getLogger(__name__).warning(
                                    "Khóa Gemini API (%d/%d) gặp sự cố với model %s: %s. Thử mô hình hoặc khóa tiếp theo...",
                                    k_idx + 1,
                                    len(gemini_keys),
                                    active_model,
                                    err_text[:120],
                                )
                                continue
                            raise
                    if response is not None:
                        break

                if response is None:
                    openai_key = (os.getenv("OPENAI_API_KEY") or "").strip()
                    if openai_key:
                        try:
                            from openai import OpenAI
                            logging.getLogger(__name__).warning(
                                "Tất cả khóa Gemini API không khả dụng. Đang tự động dự phòng sang OpenAI gpt-4o-mini..."
                            )
                            oai_client = OpenAI(api_key=openai_key, timeout=30)
                            model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
                            result = oai_client.chat.completions.create(
                                model=model,
                                temperature=config.temperature,
                                top_p=config.top_p,
                                max_tokens=config.max_tokens,
                                messages=[
                                    {"role": "system", "content": system_prompt + " Trả kết quả JSON hợp lệ."},
                                    {"role": "user", "content": prompt},
                                ],
                            )
                            response_text = result.choices[0].message.content
                        except Exception as oai_exc:
                            logging.getLogger(__name__).error("Dự phòng sang OpenAI thất bại: %s", oai_exc)
                            if last_exc:
                                raise last_exc
                            raise oai_exc
                    else:
                        if last_exc is not None:
                            raise last_exc
                        raise RuntimeError("Không có phản hồi từ các mô hình AI.")
                else:
                    response_text = response.text
            elif model_provider in {"openai", "local"}:
                from openai import OpenAI
                base_url = os.getenv("LOCAL_LLM_BASE_URL") if model_provider == "local" else None
                if model_provider == "local" and not base_url:
                    raise AIServiceError(503, "Chưa cấu hình địa chỉ mô hình nội bộ.")
                client = OpenAI(api_key=key or "local", base_url=base_url, timeout=30)
                model = os.getenv("LOCAL_LLM_MODEL", "local-model") if model_provider == "local" else os.getenv("OPENAI_MODEL", "gpt-4o-mini")
                result = client.chat.completions.create(model=model, temperature=config.temperature, top_p=config.top_p, max_tokens=config.max_tokens,
                    messages=[{"role": "system", "content": system_prompt + " Trả kết quả JSON hợp lệ."},
                              {"role": "user", "content": prompt}])
                response_text = result.choices[0].message.content
            elif model_provider == "anthropic":
                result = requests.post("https://api.anthropic.com/v1/messages", timeout=30,
                    headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                    json={"model": os.getenv("ANTHROPIC_MODEL", "claude-3-5-haiku-latest"), "max_tokens": config.max_tokens, "temperature": config.temperature, "top_p": config.top_p,
                          "system": system_prompt + " Trả kết quả JSON hợp lệ.",
                          "messages": [{"role": "user", "content": prompt}]})
                result.raise_for_status()
                response_text = "".join(part.get("text", "") for part in result.json().get("content", []))
            else:
                raise AIServiceError(400, "Nhà cung cấp mô hình không hợp lệ.")
        except AIServiceError:
            raise
        except Exception as exc:
            logging.getLogger(__name__).exception("Lỗi khi gọi mô hình AI sinh câu trả lời: %s", exc)
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
        # Nếu chưa bóc tách được citations từ JSON nhưng answer hợp lệ, thử phục hồi trích dẫn từ các retrieved chunks
        if not citations:
            from legal.citations import extract_json, synthesize_citations_from_context
            raw_payload = extract_json(response_text)
            raw_ans = raw_payload.get("answer", "").strip() if isinstance(raw_payload, dict) else ""
            if raw_ans and raw_ans != REFUSAL:
                synthesized = synthesize_citations_from_context(raw_ans, chunks)
                if synthesized:
                    citations = synthesized
                    answer = raw_ans

        # Không phát hành lập luận hoặc nguồn khi bất kỳ căn cứ gốc nào sai schema.
        if not citations:
            logging.getLogger(__name__).warning("Refusal: parse_answer khong bóc tách duoc citations. Response text: %s", response_text[:300])
            return RagAnswer(REFUSAL, [], [], [])
        # Xác minh mọi citation trước khi khử trùng, đồng thời tự ánh xạ chunk anh em cùng Điều để tránh False Refusal.
        allowed = {chunk.chunk_id: chunk for chunk in chunks}
        sibling_lookup: dict[str, RetrievedChunk] = {}
        for chunk in chunks:
            for sib_id, sib_raw_doc, sib_meta in getattr(chunk, "siblings", ()) or ():
                if sib_id not in allowed and sib_id not in sibling_lookup:
                    sibling_lookup[sib_id] = RetrievedChunk(
                        chunk_id=sib_id,
                        document=sib_raw_doc,
                        metadata=sib_meta,
                        score=chunk.score,
                        effective_status=chunk.effective_status,
                        warning=chunk.warning,
                        raw_document=sib_raw_doc,
                    )

        trusted_citations = []
        for item in citations:
            verified = verify_and_repair_citation(item, allowed, sibling_lookup)
            if not verified:
                logging.getLogger(__name__).warning("Refusal: verify_and_repair_citation that bai cho citation: %s", item)
                return RagAnswer(REFUSAL, [], [], [])
            repaired_item, matched_chunk = verified
            if matched_chunk.chunk_id not in allowed:
                allowed[matched_chunk.chunk_id] = matched_chunk
                meta = matched_chunk.metadata
                sib_source = {
                    "chunk_id": matched_chunk.chunk_id,
                    "content": matched_chunk.document,
                    "title": meta.get("doc_title", "Văn bản pháp luật"),
                    "url": meta.get("source_url", ""),
                    "doc_number": meta.get("doc_number", ""),
                    "chapter": meta.get("chapter"),
                    "article_number": meta.get("article_number"),
                    "clause_number": meta.get("clause_number"),
                    "issued_date": meta.get("issued_date"),
                    "effective_status": matched_chunk.effective_status,
                }
                if matched_chunk.warning:
                    sib_source["warning"] = matched_chunk.warning
                if sib_source not in sources:
                    sources.append(sib_source)
            # Chỉ gộp bản ghi trùng hoàn toàn sau khi nội dung và metadata đã khớp.
            if repaired_item not in trusted_citations:
                trusted_citations.append(repaired_item)
        citations = trusted_citations
        if not citations:
            answer = REFUSAL
        else:
            status_labels = {
                "expired": "đã hết hiệu lực",
                "partially_expired": "hết hiệu lực một phần",
                "not_yet_effective": "chưa có hiệu lực",
            }
            # Chỉ gắn cảnh báo chân trang khi văn bản thực sự hết hiệu lực hoặc chưa có hiệu lực
            flagged_chunks = [
                allowed[item["chunk_id"]]
                for item in citations
                if allowed[item["chunk_id"]].warning
                and allowed[item["chunk_id"]].effective_status in status_labels
            ]
            warnings = list(dict.fromkeys(chunk.warning for chunk in flagged_chunks))
            if warnings:
                versions = list(dict.fromkeys(
                    (
                        chunk.metadata.get("doc_number", ""),
                        chunk.metadata.get("issued_date", ""),
                        status_labels.get(chunk.effective_status, chunk.effective_status),
                    )
                    for chunk in flagged_chunks
                ))
                version_notes = [
                    f"{number}, ngày ban hành {issued or 'chưa rõ'}, trạng thái {status_text}."
                    for number, issued, status_text in versions
                ]
                answer += "\n\n" + "\n".join(
                    [*(f"- **Hiệu lực nguồn:** {warning}" for warning in warnings),
                     *(f"- **Phiên bản nguồn:** {note}" for note in version_notes)]
                )
        return RagAnswer(answer, sources, [], [], citations, config.version,
                         model_provider + ':' + str(os.getenv({'gemini': 'GEMINI_MODEL', 'openai': 'OPENAI_MODEL', 'local': 'LOCAL_LLM_MODEL', 'anthropic': 'ANTHROPIC_MODEL'}.get(model_provider, 'GEMINI_MODEL')) or 'default'))
