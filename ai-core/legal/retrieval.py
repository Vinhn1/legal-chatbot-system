"""Truy xuất pháp luật theo định danh chính xác, BM25 và vector với lọc quyền."""

import logging
import os
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Callable

from hybrid_retriever import BM25Index, reciprocal_rank_fusion
from query_reformulator import (
    LegalReferences,
    extract_legal_references,
    normalize_doc_number,
    normalize_unit_number,
)


logger = logging.getLogger(__name__)
_CURRENT_STATUSES = ["active", "partially_expired", "unknown"]
_ALL_STATUSES = [*_CURRENT_STATUSES, "expired"]


@dataclass(frozen=True)
class RetrievedChunk:
    """Một chunk đã được kiểm tra phạm vi truy cập và trạng thái theo ngày."""

    chunk_id: str
    document: str
    metadata: dict[str, Any]
    score: float
    effective_status: str
    warning: str | None = None


class LocalCrossEncoderReranker:
    """Xếp hạng lại khi quản trị viên cấu hình sẵn mô hình cục bộ."""

    def __init__(self, model_path: str):
        """Giữ đường dẫn mô hình; chỉ nạp khi thực sự có kết quả cần xếp hạng."""
        self.model_path = model_path
        self._model = None

    def __call__(self, question: str, candidates: list[RetrievedChunk]) -> list[RetrievedChunk]:
        """Dùng điểm Cross-Encoder, hoặc giữ thứ tự RRF nếu mô hình không sẵn sàng."""
        if not candidates:
            return candidates
        try:
            if self._model is None:
                from sentence_transformers import CrossEncoder

                self._model = CrossEncoder(self.model_path, max_length=512)
            scores = self._model.predict([(question, item.document[:2048]) for item in candidates])
            ranked = sorted(zip(candidates, scores), key=lambda pair: float(pair[1]), reverse=True)
            return [item for item, _ in ranked]
        except Exception:
            # Không ghi thông điệp ngoại lệ vì có thể chứa đường dẫn hoặc dữ liệu truy vấn.
            logger.warning("Không thể xếp hạng lại bằng mô hình cục bộ.")
            return candidates


class LegalRetriever:
    """Kết hợp ưu tiên metadata chính xác với BM25, vector và RRF."""

    def __init__(self, collection, reranker: Callable | None = None):
        """Nhận collection pháp luật và mô hình xếp hạng lại tùy chọn."""
        self.collection = collection
        configured_model = os.getenv("LEGAL_RERANKER_MODEL_PATH")
        self.reranker = reranker
        if reranker is None and configured_model and Path(configured_model).is_dir():
            self.reranker = LocalCrossEncoderReranker(configured_model)

    @staticmethod
    def _where(allow_internal: bool, statuses: list[str]) -> dict[str, Any]:
        """Đưa bộ lọc quyền và nhãn hiệu lực xuống Chroma trước khi đọc dữ liệu."""
        scope_filter: dict[str, Any] = (
            {"scope": {"$in": ["public", "internal"]}} if allow_internal else {"scope": "public"}
        )
        return {"$and": [scope_filter, {"effective_status": {"$in": statuses}}]}

    @staticmethod
    def _rows(raw: dict[str, Any], allow_internal: bool) -> dict[str, tuple[str, dict[str, Any]]]:
        """Chuyển dữ liệu Chroma thành bảng tra cứu và kiểm tra lại quyền ở ứng dụng."""
        rows: dict[str, tuple[str, dict[str, Any]]] = {}
        for chunk_id, document, metadata in zip(
            raw.get("ids") or [], raw.get("documents") or [], raw.get("metadatas") or []
        ):
            if not isinstance(metadata, dict) or not isinstance(document, str):
                continue
            if metadata.get("scope") not in ({"public", "internal"} if allow_internal else {"public"}):
                continue
            if metadata.get("effective_status") not in _ALL_STATUSES:
                continue
            rows[chunk_id] = (document, metadata)
        return rows

    @staticmethod
    def _status_at(metadata: dict[str, Any], as_of: date) -> str:
        """Tính hiệu lực theo ngày tra cứu, không tự nâng nhãn chưa xác minh thành còn hiệu lực."""
        status = metadata.get("effective_status", "unknown")
        if status == "unknown":
            return "unknown"
        try:
            effective = date.fromisoformat(metadata["effective_date"]) if metadata.get("effective_date") else None
            expiry = date.fromisoformat(metadata["expiry_date"]) if metadata.get("expiry_date") else None
            status_since = date.fromisoformat(metadata["status_since_date"]) if metadata.get("status_since_date") else None
        except (TypeError, ValueError):
            return "unknown"
        if effective is None:
            return "unknown"
        if as_of < effective:
            return "not_yet_effective"
        if expiry and as_of >= expiry:
            return "expired"
        if status_since and as_of < status_since:
            return "active"
        if status == "expired" and expiry and as_of < expiry:
            return "active"
        return status

    @staticmethod
    def _warning(status: str) -> str | None:
        """Tạo cảnh báo rõ ràng cho văn bản không còn nguyên hiệu lực hoặc chưa xác minh."""
        return {
            "expired": "Văn bản đã hết hiệu lực tại thời điểm tra cứu.",
            "partially_expired": "Văn bản đã hết hiệu lực một phần; cần đối chiếu phần còn áp dụng.",
            "unknown": "Hiệu lực văn bản chưa được xác minh.",
            "not_yet_effective": "Văn bản chưa có hiệu lực tại thời điểm tra cứu.",
        }.get(status)

    @staticmethod
    def _matches_exact(metadata: dict[str, Any], references: LegalReferences) -> bool:
        """Chỉ công nhận khớp chính xác khi mọi định danh được hỏi đều khớp metadata."""
        if references.doc_number and normalize_doc_number(str(metadata.get("doc_number", ""))) != references.doc_number:
            return False
        if references.article_number and normalize_unit_number(str(metadata.get("article_number", ""))) != references.article_number:
            return False
        if references.clause_number and normalize_unit_number(str(metadata.get("clause_number", ""))) != references.clause_number:
            return False
        document_type = metadata.get("document_type")
        if references.document_type and document_type and document_type != references.document_type:
            return False
        return True

    @staticmethod
    def _phrase_match_length(query_tokens: list[str], document: str) -> int:
        """Đo cụm từ dài nhất khớp nguyên văn trong nội dung, bỏ tiền tố metadata lặp lại."""
        body = document.partition("\n")[2] or document
        tokens = BM25Index.tokenize(body)
        searchable = "\x1f" + "\x1f".join(tokens) + "\x1f"
        for length in range(min(10, len(query_tokens)), 3, -1):
            for start in range(len(query_tokens) - length + 1):
                phrase = "\x1f" + "\x1f".join(query_tokens[start:start + length]) + "\x1f"
                if phrase in searchable:
                    return length
        return 0

    def _vector_ranked(self, question: str, where: dict[str, Any], allowed_ids: set[str]) -> list[tuple[str, float, str]]:
        """Truy vấn vector trong phạm vi đã lọc và loại kết quả không thuộc tập được phép."""
        if not allowed_ids:
            return []
        try:
            raw = self.collection.query(
                query_texts=[question],
                n_results=len(allowed_ids),
                where=where,
                include=["documents", "metadatas", "distances"],
            )
        except Exception:
            logger.warning("Truy vấn vector không khả dụng; tiếp tục bằng BM25.")
            return []
        ids = (raw.get("ids") or [[]])[0]
        documents = (raw.get("documents") or [[]])[0]
        distances = (raw.get("distances") or [[]])[0]
        return [
            (chunk_id, -float(distance), content)
            for chunk_id, content, distance in zip(ids, documents, distances)
            if chunk_id in allowed_ids and isinstance(content, str)
        ]

    def search(
        self,
        question: str,
        limit: int = 5,
        allow_internal: bool = False,
        as_of: date | None = None,
        include_expired: bool = False,
    ) -> list[RetrievedChunk]:
        """Trả chunk hợp lệ, luôn đưa định danh Điều/Khoản/số hiệu chính xác lên đầu."""
        if not question or not question.strip() or limit < 1:
            return []
        as_of = as_of or date.today()
        references = extract_legal_references(question)
        statuses = _ALL_STATUSES if include_expired else _CURRENT_STATUSES
        where = self._where(allow_internal, statuses)
        normal_rows = self._rows(
            self.collection.get(where=where, include=["documents", "metadatas"]),
            allow_internal,
        )
        # Ngày hết hiệu lực có thể đã qua dù nhãn lưu trữ chưa được cập nhật.
        normal_rows = {
            chunk_id: row for chunk_id, row in normal_rows.items()
            if self._status_at(row[1], as_of) not in ({"not_yet_effective"} if include_expired else {"expired", "not_yet_effective"})
        }

        bm25 = BM25Index()
        bm25.build([row[0] for row in normal_rows.values()], list(normal_rows))
        lexical = bm25.top_k(question, k=len(normal_rows))
        vector = self._vector_ranked(question, where, set(normal_rows))
        fused = reciprocal_rank_fusion(vector, lexical)
        fused_scores = {chunk_id: score for chunk_id, score, _ in fused}
        ranked_ids = [chunk_id for chunk_id, _, _ in fused]

        if references.has_exact_target:
            # Tìm thêm văn bản hết hiệu lực khi số hiệu hoặc Điều/Khoản được nêu rõ.
            exact_rows = self._rows(
                self.collection.get(where=self._where(allow_internal, _ALL_STATUSES), include=["documents", "metadatas"]),
                allow_internal,
            )
            matches = {
                chunk_id: row for chunk_id, row in exact_rows.items()
                if self._matches_exact(row[1], references)
            }
            if not matches:
                return []
            exact_bm25 = BM25Index()
            exact_bm25.build([row[0] for row in matches.values()], list(matches))
            exact_scores = dict(zip(matches, exact_bm25.get_scores(question)))
            ranked_ids = sorted(
                matches,
                key=lambda chunk_id: (-fused_scores.get(chunk_id, 0.0), -exact_scores[chunk_id], chunk_id),
            )
            normal_rows.update(matches)
        else:
            # Cụm từ dài trong nội dung Điều được ưu tiên hơn tiền tố tên văn bản lặp ở mọi chunk.
            query_tokens = BM25Index.tokenize(question)
            phrase_scores = {
                chunk_id: self._phrase_match_length(query_tokens, normal_rows[chunk_id][0])
                for chunk_id in ranked_ids
            }
            if any(score >= 4 for score in phrase_scores.values()):
                ranked_ids.sort(key=lambda chunk_id: (-phrase_scores[chunk_id], -fused_scores.get(chunk_id, 0.0), chunk_id))

        candidates = []
        for chunk_id in ranked_ids:
            document, metadata = normal_rows[chunk_id]
            status = self._status_at(metadata, as_of)
            candidates.append(RetrievedChunk(
                chunk_id, document, metadata, fused_scores.get(chunk_id, 0.0), status, self._warning(status)
            ))
        if self.reranker:
            candidates = self.reranker(question, candidates)
        return candidates[:limit]
