"""Truy xuất pháp luật đa truy vấn (Multi-Query Hybrid RRF), cân bằng hạn ngạch văn bản và mở rộng tham chiếu 2 chiều."""

import logging
import os
import threading
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any, Callable

from hybrid_retriever import BM25Index, multi_query_rrf, reciprocal_rank_fusion
from legal.corpus_revision import bump_revision, revision
from legal.parser import parse_fine_grained_unit_refs
from query_reformulator import (
    DecomposedQuery,
    LegalReferences,
    SubQuery,
    _SUBJECT_GROUPS,
    decompose_legal_query,
    expand_legal_query,
    extract_legal_references,
    normalize_doc_number,
    normalize_unit_number,
)


logger = logging.getLogger(__name__)
_CURRENT_STATUSES = ["active", "partially_expired", "unknown"]
_ALL_STATUSES = [*_CURRENT_STATUSES, "expired"]

_QUANTITATIVE_PHRASES: tuple[str, ...] = (
    "dưới 10 tuổi",
    "chiều cao dưới 1,35 mét",
    "1,35 mét",
    "cùng hàng ghế với người lái xe",
    "thiết bị an toàn cho trẻ em",
    "thiết bị an toàn phù hợp cho trẻ em",
    "800.000 đồng đến 1.000.000 đồng",
    "01 tháng 01 năm 2026",
    "01/01/2026",
    "trừ điểm giấy phép lái xe",
    "hiệu lực thi hành",
)

_REVERSE_REF_PRIORITY_TERMS: tuple[str, ...] = (
    "hiệu lực thi hành",
    "điều khoản chuyển tiếp",
    "quy định chuyển tiếp",
    "trừ điểm giấy phép lái xe",
    "điểm giấy phép lái xe",
    "hình thức xử phạt bổ sung",
    "tước quyền sử dụng",
    "biện pháp khắc phục hậu quả",
)


def parse_article_set(raw_value: Any) -> set[str]:
    """Tách chuỗi danh sách Điều phân cách bằng dấu phẩy thành tập hợp chuẩn hóa.

    Tuyệt đối không dùng kiểm tra chuỗi con trực tiếp để tránh khớp nhầm '2' vào '220'.
    """
    if not raw_value or not isinstance(raw_value, str):
        return set()
    return {
        normalize_unit_number(token.strip())
        for token in raw_value.split(",")
        if token.strip()
    }


def parse_unit_ref_list(raw_value: Any) -> list[str]:
    """Tách chuỗi danh sách mã đơn vị tham chiếu chi tiết ('6:3:m,6:5:a,10:3') thành danh sách có thứ tự."""
    if not raw_value or not isinstance(raw_value, str):
        return []
    out: list[str] = []
    for raw_tok in raw_value.split(","):
        tok = raw_tok.strip()
        if not tok:
            continue
        parts = [p.strip() for p in tok.split(":") if p.strip()]
        if not parts:
            continue
        norm_parts = [normalize_unit_number(parts[0])]
        if len(parts) >= 2:
            norm_parts.append(normalize_unit_number(parts[1]))
        if len(parts) >= 3:
            norm_parts.append(parts[2].casefold())
        joined = ":".join(norm_parts)
        if joined not in out:
            out.append(joined)
    return out


def parse_doc_set(raw_value: Any) -> set[str]:
    """Tách chuỗi danh sách văn bản viện dẫn phân cách bằng dấu phẩy thành tập hợp chuẩn hóa."""
    if not raw_value or not isinstance(raw_value, str):
        return set()
    return {
        normalize_doc_number(token.strip())
        for token in raw_value.split(",")
        if token.strip()
    }


def _extract_chunk_body(document: str, keep_clause_frame: bool = True) -> str:
    """Tách phần nội dung thực chất của chunk, bỏ các dòng nhãn [Văn bản...], [Chương...], [Điều...] lặp lại."""
    if not document:
        return ""
    lines = document.splitlines()
    if len(lines) <= 1:
        return document.strip()
    kept: list[str] = []
    in_header = True
    for raw_line in lines:
        stripped = raw_line.strip()
        if in_header and stripped.startswith("[") and stripped.endswith("]"):
            if keep_clause_frame and stripped.lower().startswith("[khoản "):
                kept.append(stripped)
            continue
        in_header = False
        if stripped.startswith("Nội dung chi tiết:"):
            stripped = stripped[len("Nội dung chi tiết:") :].strip()
        if stripped:
            kept.append(stripped)
    return "\n".join(kept).strip() or document.partition("\n")[2].strip() or document.strip()


@dataclass(frozen=True)
class RetrievedChunk:
    """Một chunk đã được kiểm tra phạm vi truy cập và trạng thái theo ngày."""

    chunk_id: str
    document: str
    metadata: dict[str, Any]
    score: float
    effective_status: str
    warning: str | None = None
    raw_document: str = ""
    siblings: tuple[tuple[str, str, dict[str, Any]], ...] = ()


class LocalCrossEncoderReranker:
    """Xếp hạng lại khi quản trị viên cấu hình sẵn mô hình cục bộ."""

    def __init__(self, model_path: str):
        """Giữ đường dẫn mô hình; chỉ nạp khi thực sự có kết quả cần xếp hạng."""
        self.model_path = model_path
        self._model = None

    def __call__(self, question: str, candidates: list[RetrievedChunk]) -> list[RetrievedChunk]:
        """Dùng điểm Cross-Encoder, hoặc giữ thứ tự hiện tại nếu mô hình không sẵn sàng."""
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
            logger.warning("Không thể xếp hạng lại bằng mô hình cục bộ.")
            return candidates


class LightweightLegalReranker:
    """Bộ chấm điểm xếp hạng pháp lý nhẹ bằng Python thuần.

    Kết hợp điểm RRF (BM25 + Vector), điểm từ vựng BM25 cục bộ, độ dài cụm từ khớp nguyên văn,
    tương thích loại văn bản theo khía cạnh (Luật vs Nghị định), khớp ngưỡng định lượng pháp lý
    và điểm thưởng cho chunk có đầy đủ ngữ cảnh phân cấp [Điều X] -> [Khoản Y].
    """

    @staticmethod
    def _matches_subject_hints(document: str, metadata: dict[str, Any], subject_hints: tuple[str, ...]) -> bool:
        """Kiểm tra tiêu đề và nội dung chunk có thuộc lĩnh vực chủ đề mà câu hỏi đang nhắm tới không."""
        if not subject_hints:
            return True
        combined = f"{metadata.get('doc_title', '')} {metadata.get('chapter', '')} {metadata.get('section', '')} {document}".casefold()
        group_map = dict(_SUBJECT_GROUPS)
        for hint in subject_hints:
            keywords = group_map.get(hint, ())
            if any(kw in combined for kw in keywords):
                return True
        return False

    @staticmethod
    def _quantitative_norm_boost(document: str, normalized_norms: tuple[str, ...]) -> float:
        """Cộng điểm thưởng khi chunk khớp trực tiếp các cụm ngưỡng định lượng pháp lý đã chuẩn hóa."""
        if not normalized_norms:
            return 0.0
        doc_lower = document.casefold()
        norms_blob = " ".join(normalized_norms).casefold()
        boost = 0.0
        for phrase in _QUANTITATIVE_PHRASES:
            if phrase in norms_blob and phrase in doc_lower:
                boost += 0.95
        return min(3.8, boost)

    @staticmethod
    def _hierarchical_context_boost(document: str, metadata: dict[str, Any]) -> float:
        """Ưu tiên các chunk có đầy đủ tiền tố phân cấp cha [Điều X] -> [Khoản Y]."""
        boost = 0.0
        has_article = bool(metadata.get("article_number"))
        has_clause = bool(metadata.get("clause_number"))
        parent_ctx = str(metadata.get("parent_context") or "")
        if has_article and has_clause:
            boost += 0.75
            if "[Điều " in parent_ctx and "[Khoản " in parent_ctx:
                boost += 0.35
        elif has_article:
            boost += 0.30
        return boost

    @classmethod
    def score_candidate(
        cls,
        chunk_id: str,
        document: str,
        metadata: dict[str, Any],
        references: LegalReferences,
        rrf_score: float,
        bm25_norm: float,
        phrase_len: int,
        normalized_norms: tuple[str, ...] = (),
        preferred_doc_type: str | None = None,
    ) -> float:
        """Tính tổng điểm xếp hạng pháp lý cho một chunk ứng viên."""
        total = rrf_score * 30.0 + bm25_norm * 2.0
        if phrase_len >= 4:
            total += phrase_len * 0.65

        target_articles = set(references.article_numbers) or (
            {references.article_number} if references.article_number else set()
        )
        domain_aligned = cls._matches_subject_hints(document, metadata, references.subject_hints)
        if references.subject_hints and domain_aligned:
            total += 1.5

        # Trong văn bản quy phạm đã bóc tách cấu trúc (structured), ưu tiên Điều/Khoản/Điểm thực chất hơn phần Căn cứ mở đầu
        if metadata.get("structure_status") == "structured":
            if metadata.get("article_number"):
                total += 1.2 + cls._hierarchical_context_boost(document, metadata)
            else:
                total -= 1.8

        if preferred_doc_type and metadata.get("document_type") == preferred_doc_type:
            total += 1.75

        if normalized_norms:
            total += cls._quantitative_norm_boost(document, normalized_norms)

        if references.doc_number:
            chunk_doc = normalize_doc_number(str(metadata.get("doc_number", "")))
            if chunk_doc == references.doc_number:
                total += 6.0
            elif references.doc_number in parse_doc_set(metadata.get("referenced_docs")):
                total += 3.0

        if target_articles:
            chunk_art = normalize_unit_number(str(metadata.get("article_number", ""))) if metadata.get("article_number") else ""
            mentioned_set = parse_article_set(metadata.get("mentioned_articles"))
            referenced_set = parse_article_set(metadata.get("referenced_articles"))

            if chunk_art and chunk_art in target_articles:
                total += 7.5 if domain_aligned else 0.8
                if references.clause_number:
                    chunk_clause = normalize_unit_number(str(metadata.get("clause_number", ""))) if metadata.get("clause_number") else ""
                    if chunk_clause == references.clause_number:
                        total += 3.5
                if references.point_id:
                    chunk_point = str(metadata.get("point_id", "")).strip().casefold()
                    if chunk_point == references.point_id:
                        total += 3.0
            else:
                matched_mentions = target_articles & (mentioned_set | referenced_set)
                if matched_mentions:
                    total += (2.8 + 0.3 * len(matched_mentions)) if domain_aligned else 0.4
                    if target_articles & referenced_set:
                        total += 0.3

        return total


class LegalRetriever:
    """Kết hợp ưu tiên metadata 3 tầng với Multi-Query Hybrid RRF, hạn ngạch đa văn bản và tham chiếu chéo 2 chiều."""

    def __init__(self, collection, reranker: Callable | None = None, revision_path=None):
        """Nhận collection pháp luật và mô hình xếp hạng lại tùy chọn."""
        self.collection = collection
        self.revision_path = revision_path
        self._cache = {}
        self._cache_lock = threading.RLock()
        self._local_revision = 0
        configured_model = os.getenv("LEGAL_RERANKER_MODEL_PATH")
        self.reranker = reranker
        if reranker is None and configured_model and Path(configured_model).is_dir():
            self.reranker = LocalCrossEncoderReranker(configured_model)

    def invalidate(self):
        """Nạp/xóa/sửa corpus phải xóa snapshot và thông báo cho các worker khác."""
        with self._cache_lock:
            self._cache.clear()
            self._local_revision += 1
            bump_revision(self.revision_path)

    def _snapshot(self, allow_internal, statuses, as_of, include_expired):
        """Cache tối đa tám biến thể phạm vi/ngày/hiệu lực theo phiên bản corpus."""
        count = self.collection.count()
        marker = (revision(self.revision_path), self._local_revision, count)
        key = (marker, allow_internal, tuple(statuses), as_of, include_expired)
        cacheable = type(count) is int
        with self._cache_lock:
            if cacheable and key in self._cache:
                return self._cache[key]
            rows = self._rows(self.collection.get(where=self._where(allow_internal, statuses), include=["documents", "metadatas"]), allow_internal)
            rows = {chunk_id: row for chunk_id, row in rows.items()
                    if include_expired == 'exact' or self._status_at(row[1], as_of) not in ({"not_yet_effective"} if include_expired else {"expired", "not_yet_effective"})}
            index = BM25Index()
            index.build([row[0] for row in rows.values()], list(rows))
            snapshot = (rows, index)
            if cacheable and marker == (revision(self.revision_path), self._local_revision, self.collection.count()):
                if len(self._cache) >= 8:
                    self._cache.pop(next(iter(self._cache)))
                self._cache[key] = snapshot
            return snapshot

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
        """Kiểm tra khớp chính xác định danh cấp văn bản, Điều, Khoản và Điểm."""
        if references.doc_number and normalize_doc_number(str(metadata.get("doc_number", ""))) != references.doc_number:
            return False
        target_articles = set(references.article_numbers) or (
            {references.article_number} if references.article_number else set()
        )
        if target_articles:
            chunk_art = normalize_unit_number(str(metadata.get("article_number", ""))) if metadata.get("article_number") else ""
            if chunk_art not in target_articles:
                return False
        if references.clause_number and normalize_unit_number(str(metadata.get("clause_number", ""))) != references.clause_number:
            return False
        if references.point_id and str(metadata.get("point_id", "")).strip().casefold() != references.point_id:
            return False
        document_type = metadata.get("document_type")
        if not references.doc_number and references.document_type and document_type and document_type != references.document_type:
            return False
        return True

    @staticmethod
    def _matches_mentioned_tier2(metadata: dict[str, Any], references: LegalReferences) -> bool:
        """Kiểm tra Tier 2: khớp số Điều trong tập mentioned_articles hoặc referenced_articles (tách dấu phẩy)."""
        if references.doc_number:
            chunk_doc = normalize_doc_number(str(metadata.get("doc_number", "")))
            ref_docs = parse_doc_set(metadata.get("referenced_docs"))
            if chunk_doc != references.doc_number and references.doc_number not in ref_docs:
                return False
        target_articles = set(references.article_numbers) or (
            {references.article_number} if references.article_number else set()
        )
        if not target_articles:
            return False
        mentioned_set = parse_article_set(metadata.get("mentioned_articles"))
        referenced_set = parse_article_set(metadata.get("referenced_articles"))
        return bool(target_articles & (mentioned_set | referenced_set))

    @staticmethod
    def _phrase_match_length(query_tokens: list[str], document: str) -> int:
        """Đo cụm từ dài nhất khớp nguyên văn trong nội dung, bỏ tiền tố tiêu đề văn bản lặp lại."""
        body = _extract_chunk_body(document, keep_clause_frame=True)
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
                n_results=min(len(allowed_ids), 100),
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

    @staticmethod
    def _extract_chunk_referenced_units(doc_text: str, meta: dict[str, Any]) -> list[str]:
        """Lấy danh sách đơn vị tham chiếu cấp Điểm/Khoản/Điều từ metadata hoặc phân tích trực tiếp cho chunk cũ."""
        stored = parse_unit_ref_list(meta.get("referenced_units"))
        if stored:
            return stored
        art_no = str(meta.get("article_number") or "") or None
        clause_no = str(meta.get("clause_number") or "") or None
        point_id = str(meta.get("point_id") or "") or None
        on_the_fly = parse_fine_grained_unit_refs(
            doc_text,
            self_article=art_no,
            self_clause=clause_no,
            self_point=point_id,
        )
        if on_the_fly:
            return on_the_fly
        raw_refs = str(meta.get("referenced_articles") or meta.get("mentioned_articles") or "")
        return [
            normalize_unit_number(token.strip())
            for token in raw_refs.split(",")
            if token.strip()
        ]

    @staticmethod
    def _is_reverse_priority_chunk(doc_text: str, meta: dict[str, Any]) -> bool:
        """Nhận diện các điều khoản quy định hiệu lực thi hành, trừ điểm GPLX hoặc hình thức xử phạt bổ sung."""
        title_and_text = f"{meta.get('article_title', '')} {doc_text}".casefold()
        return any(term in title_and_text for term in _REVERSE_REF_PRIORITY_TERMS)

    def expand_cross_references(
        self,
        primary_chunks: list[RetrievedChunk],
        all_rows: dict[str, tuple[str, dict[str, Any]]],
        as_of: date,
        max_hop2_chunks: int = 4,
    ) -> list[RetrievedChunk]:
        """Mở rộng tham chiếu chéo 2 chiều (Forward & Reverse 1-Hop) chính xác tới cấp Điểm/Khoản/Điều."""
        if not primary_chunks or not all_rows or max_hop2_chunks < 1:
            return primary_chunks

        def _chunk_sort_key(item: tuple[str, str, dict[str, Any]]) -> tuple[int, str]:
            cid = item[0]
            suffix = cid.rsplit(":", 1)[-1]
            return (int(suffix) if suffix.isdigit() else 999999, cid)

        # Xây dựng bảng chỉ mục xuôi (doc_key + art[:clause[:point]]) và chỉ mục ngược (target_unit -> source_chunks)
        exact_point_index: dict[tuple[str, str, str, str], list[tuple[str, str, dict[str, Any]]]] = {}
        exact_clause_index: dict[tuple[str, str, str], list[tuple[str, str, dict[str, Any]]]] = {}
        articles_index: dict[tuple[str, str], list[tuple[str, str, dict[str, Any]]]] = {}
        reverse_index: dict[tuple[str, str], list[tuple[str, str, dict[str, Any]]]] = {}

        for cid, (doc_text, meta) in all_rows.items():
            doc_key = normalize_doc_number(str(meta.get("doc_number") or meta.get("doc_id") or ""))
            if not doc_key:
                continue
            art_no = normalize_unit_number(str(meta.get("article_number") or "")) if meta.get("article_number") else ""
            clause_no = normalize_unit_number(str(meta.get("clause_number") or "")) if meta.get("clause_number") else ""
            point_id = str(meta.get("point_id") or "").strip().casefold()

            row_tuple = (cid, doc_text, meta)
            if art_no:
                articles_index.setdefault((doc_key, art_no), []).append(row_tuple)
                if clause_no:
                    exact_clause_index.setdefault((doc_key, art_no, clause_no), []).append(row_tuple)
                    if point_id:
                        exact_point_index.setdefault((doc_key, art_no, clause_no, point_id), []).append(row_tuple)

            for ref_unit in self._extract_chunk_referenced_units(doc_text, meta):
                reverse_index.setdefault((doc_key, ref_unit), []).append(row_tuple)

        for idx_map in (exact_point_index, exact_clause_index, articles_index, reverse_index):
            for key in idx_map:
                idx_map[key].sort(key=_chunk_sort_key)

        seen_chunk_ids: set[str] = {chunk.chunk_id for chunk in primary_chunks}
        covered_articles: set[tuple[str, str]] = set()
        covered_clauses: set[tuple[str, str, str]] = set()
        covered_points: set[tuple[str, str, str, str]] = set()

        for chunk in primary_chunks:
            meta = chunk.metadata
            doc_key = normalize_doc_number(str(meta.get("doc_number") or meta.get("doc_id") or ""))
            art_no = normalize_unit_number(str(meta.get("article_number") or "")) if meta.get("article_number") else ""
            clause_no = normalize_unit_number(str(meta.get("clause_number") or "")) if meta.get("clause_number") else ""
            point_id = str(meta.get("point_id") or "").strip().casefold()
            if doc_key and art_no:
                covered_articles.add((doc_key, art_no))
                if clause_no:
                    covered_clauses.add((doc_key, art_no, clause_no))
                    if point_id:
                        covered_points.add((doc_key, art_no, clause_no, point_id))

        hop2_chunks: list[RetrievedChunk] = []

        def _append_hop2(cid: str, doc_text: str, target_meta: dict[str, Any], base_score: float) -> bool:
            if cid in seen_chunk_ids or len(hop2_chunks) >= max_hop2_chunks:
                return False
            status = self._status_at(target_meta, as_of)
            hop2_chunks.append(
                RetrievedChunk(
                    chunk_id=cid,
                    document=doc_text,
                    metadata=target_meta,
                    score=max(0.0, base_score * 0.88),
                    effective_status=status,
                    warning=self._warning(status),
                    raw_document=doc_text,
                )
            )
            seen_chunk_ids.add(cid)
            t_doc = normalize_doc_number(str(target_meta.get("doc_number") or target_meta.get("doc_id") or ""))
            t_art = normalize_unit_number(str(target_meta.get("article_number") or "")) if target_meta.get("article_number") else ""
            t_clause = normalize_unit_number(str(target_meta.get("clause_number") or "")) if target_meta.get("clause_number") else ""
            t_point = str(target_meta.get("point_id") or "").strip().casefold()
            if t_doc and t_art:
                covered_articles.add((t_doc, t_art))
                if t_clause:
                    covered_clauses.add((t_doc, t_art, t_clause))
                    if t_point:
                        covered_points.add((t_doc, t_art, t_clause, t_point))
            return True

        # Chiều 1 (Forward 1-Hop): Mở rộng chính xác tới Điểm -> Khoản -> Điều được dẫn chiếu (hỗ trợ cả "Điều này")
        for chunk in primary_chunks:
            if len(hop2_chunks) >= max_hop2_chunks:
                break
            meta = chunk.metadata
            doc_key = normalize_doc_number(str(meta.get("doc_number") or meta.get("doc_id") or ""))
            if not doc_key:
                continue
            ref_units = self._extract_chunk_referenced_units(chunk.raw_document or chunk.document, meta)
            for ref_unit in ref_units:
                if len(hop2_chunks) >= max_hop2_chunks:
                    break
                parts = ref_unit.split(":")
                if len(parts) == 3:
                    r_art, r_clause, r_point = parts
                    if (doc_key, r_art, r_clause, r_point) in covered_points:
                        continue
                    targets = (
                        exact_point_index.get((doc_key, r_art, r_clause, r_point))
                        or exact_clause_index.get((doc_key, r_art, r_clause))
                        or articles_index.get((doc_key, r_art))
                        or []
                    )
                elif len(parts) == 2:
                    r_art, r_clause = parts
                    if (doc_key, r_art, r_clause) in covered_clauses:
                        continue
                    targets = (
                        exact_clause_index.get((doc_key, r_art, r_clause))
                        or articles_index.get((doc_key, r_art))
                        or []
                    )
                else:
                    r_art = parts[0]
                    if (doc_key, r_art) in covered_articles:
                        continue
                    targets = articles_index.get((doc_key, r_art)) or []

                for cid, doc_text, target_meta in targets:
                    if _append_hop2(cid, doc_text, target_meta, chunk.score):
                        break

        # Chiều 2 (Reverse 1-Hop): Quét ngược các điều khoản Hiệu lực thi hành / Trừ điểm GPLX / Phạt bổ sung trỏ về chunk hiện tại
        for chunk in primary_chunks:
            if len(hop2_chunks) >= max_hop2_chunks:
                break
            meta = chunk.metadata
            doc_key = normalize_doc_number(str(meta.get("doc_number") or meta.get("doc_id") or ""))
            art_no = normalize_unit_number(str(meta.get("article_number") or "")) if meta.get("article_number") else ""
            if not doc_key or not art_no:
                continue
            clause_no = normalize_unit_number(str(meta.get("clause_number") or "")) if meta.get("clause_number") else ""
            point_id = str(meta.get("point_id") or "").strip().casefold()

            probe_keys: list[tuple[str, str]] = []
            if clause_no and point_id:
                probe_keys.append((doc_key, f"{art_no}:{clause_no}:{point_id}"))
            if clause_no:
                probe_keys.append((doc_key, f"{art_no}:{clause_no}"))

            reverse_matches: list[tuple[bool, str, str, dict[str, Any]]] = []
            for p_key in probe_keys:
                for cid, doc_text, r_meta in reverse_index.get(p_key) or []:
                    if cid in seen_chunk_ids:
                        continue
                    is_priority = self._is_reverse_priority_chunk(doc_text, r_meta)
                    reverse_matches.append((is_priority, cid, doc_text, r_meta))

            # Kiểm tra thêm tham chiếu ngược cấp Điều riêng đối với các Điều quy định Hiệu lực thi hành / Chuyển tiếp
            for cid, doc_text, r_meta in reverse_index.get((doc_key, art_no)) or []:
                if cid in seen_chunk_ids:
                    continue
                title_lower = f"{r_meta.get('article_title', '')} {doc_text[:260]}".casefold()
                if any(term in title_lower for term in ("hiệu lực thi hành", "điều khoản chuyển tiếp", "quy định chuyển tiếp")):
                    reverse_matches.append((True, cid, doc_text, r_meta))

            # Ưu tiên tuyệt đối các khoản quy định Hiệu lực thi hành và Trừ điểm GPLX / Phạt bổ sung
            reverse_matches.sort(key=lambda item: (0 if item[0] else 1, item[1]))
            for is_priority, cid, doc_text, r_meta in reverse_matches:
                if not is_priority:
                    continue
                _append_hop2(cid, doc_text, r_meta, chunk.score)
                if len(hop2_chunks) >= max_hop2_chunks:
                    break

        return [*primary_chunks, *hop2_chunks]

    @staticmethod
    def _enrich_sibling_context(
        candidates: list[RetrievedChunk],
        all_rows: dict[str, tuple[str, dict[str, Any]]],
        max_extra_chars: int = 1800,
    ) -> list[RetrievedChunk]:
        """Gom bổ sung các Khoản/Điểm anh em trong cùng một Điều và lưu bảng ánh xạ chunk gốc."""
        if not candidates or not all_rows:
            return candidates

        def _sib_sort_key(item: tuple[str, str, dict[str, Any], str]) -> tuple[int, str]:
            cid = item[0]
            suffix = cid.rsplit(":", 1)[-1]
            return (int(suffix) if suffix.isdigit() else 999999, cid)

        by_article: dict[tuple[str, str, str, str], list[tuple[str, str, dict[str, Any], str]]] = {}
        for cid, (doc_text, meta) in all_rows.items():
            doc_id = str(meta.get("doc_id") or meta.get("doc_number") or "")
            art_no = str(meta.get("article_number") or "")
            if not doc_id or not art_no:
                continue
            key = (
                doc_id,
                str(meta.get("part") or ""),
                str(meta.get("chapter") or ""),
                art_no,
            )
            body = _extract_chunk_body(doc_text, keep_clause_frame=False)
            by_article.setdefault(key, []).append((cid, doc_text, meta, body))

        for key in by_article:
            by_article[key].sort(key=_sib_sort_key)

        enriched: list[RetrievedChunk] = []
        for item in candidates:
            meta = item.metadata
            raw_doc = item.raw_document or item.document
            doc_id = str(meta.get("doc_id") or meta.get("doc_number") or "")
            art_no = str(meta.get("article_number") or "")
            if not doc_id or not art_no or meta.get("structure_status") != "structured":
                enriched.append(
                    RetrievedChunk(
                        chunk_id=item.chunk_id,
                        document=item.document,
                        metadata=item.metadata,
                        score=item.score,
                        effective_status=item.effective_status,
                        warning=item.warning,
                        raw_document=raw_doc,
                        siblings=item.siblings,
                    )
                )
                continue
            key = (
                doc_id,
                str(meta.get("part") or ""),
                str(meta.get("chapter") or ""),
                art_no,
            )
            siblings = by_article.get(key) or []
            sibling_tuples = tuple(
                (sib_id, sib_raw_doc, sib_meta)
                for sib_id, sib_raw_doc, sib_meta, _ in siblings
                if sib_id != item.chunk_id
            )
            if len(siblings) <= 1:
                enriched.append(
                    RetrievedChunk(
                        chunk_id=item.chunk_id,
                        document=item.document,
                        metadata=item.metadata,
                        score=item.score,
                        effective_status=item.effective_status,
                        warning=item.warning,
                        raw_document=raw_doc,
                        siblings=sibling_tuples,
                    )
                )
                continue

            extra_lines: list[str] = []
            current_chars = 0
            for sib_id, _sib_raw_doc, _sib_meta, sib_body in siblings:
                if sib_id == item.chunk_id or not sib_body or sib_body in item.document:
                    continue
                if current_chars + len(sib_body) > max_extra_chars:
                    break
                extra_lines.append(sib_body)
                current_chars += len(sib_body)

            if not extra_lines:
                enriched.append(
                    RetrievedChunk(
                        chunk_id=item.chunk_id,
                        document=item.document,
                        metadata=item.metadata,
                        score=item.score,
                        effective_status=item.effective_status,
                        warning=item.warning,
                        raw_document=raw_doc,
                        siblings=sibling_tuples,
                    )
                )
                continue

            new_doc = f"{item.document}\n[Ngữ cảnh bổ sung cùng Điều {art_no}]:\n" + "\n".join(extra_lines)
            enriched.append(
                RetrievedChunk(
                    chunk_id=item.chunk_id,
                    document=new_doc,
                    metadata=item.metadata,
                    score=item.score,
                    effective_status=item.effective_status,
                    warning=item.warning,
                    raw_document=raw_doc,
                    siblings=sibling_tuples,
                )
            )
        return enriched

    def _multi_query_hybrid_search(
        self,
        decomposed: DecomposedQuery,
        references: LegalReferences,
        normal_rows: dict[str, tuple[str, dict[str, Any]]],
        bm25: BM25Index,
        where: dict[str, Any],
        base_fused: list[tuple[str, float, str]],
        effective_limit: int,
    ) -> tuple[list[str], dict[str, float]]:
        """Chạy Hybrid Search cho từng sub-query, áp dụng hạn ngạch đa văn bản (Luật + Nghị định) và Rerank."""
        allowed_ids = set(normal_rows)
        per_query_k = min(len(normal_rows), max(60, effective_limit * 10))

        ranked_lists: list[tuple[list[tuple[str, float, str]], float]] = [(base_fused, 1.0)]
        subquery_fused_maps: list[tuple[SubQuery, dict[str, float]]] = []

        for sq in decomposed.sub_queries:
            sq_lex = bm25.top_k(sq.query, k=per_query_k)
            sq_vec = self._vector_ranked(sq.query, where, allowed_ids)
            sq_fused = reciprocal_rank_fusion(sq_vec, sq_lex)
            ranked_lists.append((sq_fused, 1.15))
            subquery_fused_maps.append((sq, {cid: sc for cid, sc, _ in sq_fused}))

        merged_rrf = multi_query_rrf(ranked_lists)
        merged_scores = {cid: sc for cid, sc, _ in merged_rrf}
        pool_ids = [cid for cid, _, _ in merged_rrf if cid in normal_rows][: max(80, effective_limit * 12)]
        if not pool_ids:
            return [], merged_scores

        pool_bm25 = BM25Index()
        pool_bm25.build([normal_rows[cid][0] for cid in pool_ids], pool_ids)

        global_bm25_raw = pool_bm25.get_scores(decomposed.expanded_question)
        global_bm25_max = max(global_bm25_raw, default=0.0) or 1.0
        global_bm25_map = {cid: s / global_bm25_max for cid, s in zip(pool_ids, global_bm25_raw)}
        orig_tokens = BM25Index.tokenize(decomposed.original_question)

        # Chấm điểm chuyên biệt theo từng sub-query để chọn đại diện tốt nhất cho mỗi khía cạnh pháp lý
        per_subquery_rankings: list[tuple[SubQuery, list[str], dict[str, float]]] = []
        best_facet_score: dict[str, float] = {}

        for sq, sq_rrf_map in subquery_fused_maps:
            sq_bm25_raw = pool_bm25.get_scores(sq.query)
            sq_bm25_max = max(sq_bm25_raw, default=0.0) or 1.0
            sq_bm25_map = {cid: s / sq_bm25_max for cid, s in zip(pool_ids, sq_bm25_raw)}
            sq_tokens = BM25Index.tokenize(sq.query)

            sq_scores: dict[str, float] = {}
            for cid in pool_ids:
                doc_txt, meta = normal_rows[cid]
                score = LightweightLegalReranker.score_candidate(
                    chunk_id=cid,
                    document=doc_txt,
                    metadata=meta,
                    references=references,
                    rrf_score=sq_rrf_map.get(cid, merged_scores.get(cid, 0.0) * 0.5),
                    bm25_norm=sq_bm25_map.get(cid, 0.0),
                    phrase_len=self._phrase_match_length(sq_tokens, doc_txt),
                    normalized_norms=decomposed.normalized_norms,
                    preferred_doc_type=sq.target_doc_type,
                )
                sq_scores[cid] = score
                if score > best_facet_score.get(cid, -1e9):
                    best_facet_score[cid] = score

            sq_ordered = sorted(pool_ids, key=lambda cid: (-sq_scores[cid], -sq_rrf_map.get(cid, 0.0), cid))
            per_subquery_rankings.append((sq, sq_ordered, sq_scores))

        global_rerank_scores: dict[str, float] = {}
        for cid in pool_ids:
            doc_txt, meta = normal_rows[cid]
            base_score = LightweightLegalReranker.score_candidate(
                chunk_id=cid,
                document=doc_txt,
                metadata=meta,
                references=references,
                rrf_score=merged_scores.get(cid, 0.0),
                bm25_norm=global_bm25_map.get(cid, 0.0),
                phrase_len=self._phrase_match_length(orig_tokens, doc_txt),
                normalized_norms=decomposed.normalized_norms,
            )
            global_rerank_scores[cid] = base_score * 0.45 + best_facet_score.get(cid, base_score) * 0.55

        global_ordered = sorted(pool_ids, key=lambda cid: (-global_rerank_scores[cid], -merged_scores.get(cid, 0.0), cid))

        # Giai đoạn 1: Hạn ngạch theo từng khía cạnh sub-query (bảo đảm mỗi khía cạnh có ít nhất 1 ứng viên đầu bảng)
        selected: list[str] = []
        for sq, sq_ordered, _ in per_subquery_rankings:
            picked = False
            if sq.target_doc_type:
                for cid in sq_ordered[:12]:
                    if cid not in selected and normal_rows[cid][1].get("document_type") == sq.target_doc_type:
                        selected.append(cid)
                        picked = True
                        break
            if not picked:
                for cid in sq_ordered[:8]:
                    if cid not in selected:
                        selected.append(cid)
                        break

        # Giai đoạn 2: Hạn ngạch cân bằng đa văn bản (Document-Diversity Quota giữa Luật và Nghị định)
        wanted_doc_types = {sq.target_doc_type for sq in decomposed.sub_queries if sq.target_doc_type}
        if len(wanted_doc_types) >= 2 and effective_limit >= 6:
            min_per_doc_type = max(2, effective_limit // 4)
            for dtype in sorted(wanted_doc_types):
                current_count = sum(1 for cid in selected if normal_rows[cid][1].get("document_type") == dtype)
                if current_count >= min_per_doc_type:
                    continue
                for cid in global_ordered:
                    if cid in selected:
                        continue
                    if normal_rows[cid][1].get("document_type") == dtype:
                        selected.append(cid)
                        current_count += 1
                        if current_count >= min_per_doc_type or len(selected) >= effective_limit:
                            break

        # Giai đoạn 3: Lấp đầy các vị trí còn lại tới Top 8-10 theo điểm Rerank tổng hợp
        for cid in global_ordered:
            if cid not in selected:
                selected.append(cid)

        return selected, merged_scores

    def search(
        self,
        question: str,
        limit: int = 5,
        allow_internal: bool = False,
        as_of: date | None = None,
        include_expired: bool = False,
    ) -> list[RetrievedChunk]:
        """Truy xuất 3 tầng (Exact -> Mentioned/Referenced -> Multi-Query Hybrid RRF + Rerank + 2-Way Cross-Ref)."""
        if not question or not question.strip() or limit < 1:
            return []
        as_of = as_of or date.today()
        references = extract_legal_references(question)
        decomposed = (
            DecomposedQuery(original_question=question.strip(), expanded_question=expand_legal_query(question))
            if references.has_exact_target
            else decompose_legal_query(question, use_llm=True)
        )
        expanded_query = decomposed.expanded_question
        statuses = _ALL_STATUSES if include_expired else _CURRENT_STATUSES
        where = self._where(allow_internal, statuses)
        normal_rows, bm25 = self._snapshot(allow_internal, statuses, as_of, include_expired)

        # Với câu hỏi tình huống phức hợp nhiều ý (có >= 2 sub-queries) và limit mặc định >= 5, nâng Top-K lên 8-10 chunks
        effective_limit = (
            max(limit, min(10, 4 + len(decomposed.sub_queries) * 2))
            if (not references.has_exact_target and limit >= 5 and len(decomposed.sub_queries) >= 2)
            else limit
        )

        lexical = bm25.top_k(expanded_query, k=min(len(normal_rows), max(60, effective_limit * 12)))
        vector = self._vector_ranked(expanded_query, where, set(normal_rows))
        fused = reciprocal_rank_fusion(vector, lexical)
        fused_scores = {chunk_id: score for chunk_id, score, _ in fused}
        rrf_ranked_ids = [chunk_id for chunk_id, _, _ in fused]

        query_tokens = BM25Index.tokenize(question)

        if references.has_exact_target:
            exact_rows, _ = self._snapshot(allow_internal, _ALL_STATUSES, as_of, "exact")

            # Tầng 1: Khớp chính xác Điều/Khoản/Điểm/Số hiệu trên văn bản quy phạm
            tier1_matches = {
                chunk_id: row for chunk_id, row in exact_rows.items()
                if self._matches_exact(row[1], references)
            }
            if not tier1_matches and (references.point_id or references.clause_number):
                relaxed_no_point = LegalReferences(
                    doc_number=references.doc_number,
                    article_number=references.article_number,
                    clause_number=references.clause_number,
                    document_type=references.document_type,
                    point_id=None,
                    article_numbers=references.article_numbers,
                    subject_hints=references.subject_hints,
                )
                tier1_matches = {
                    chunk_id: row for chunk_id, row in exact_rows.items()
                    if self._matches_exact(row[1], relaxed_no_point)
                }
            if not tier1_matches and references.clause_number and (references.article_number or references.article_numbers):
                relaxed_art_only = LegalReferences(
                    doc_number=references.doc_number,
                    article_number=references.article_number,
                    clause_number=None,
                    document_type=references.document_type,
                    point_id=None,
                    article_numbers=references.article_numbers,
                    subject_hints=references.subject_hints,
                )
                tier1_matches = {
                    chunk_id: row for chunk_id, row in exact_rows.items()
                    if self._matches_exact(row[1], relaxed_art_only)
                }
            if not tier1_matches and references.document_type and (references.article_number or references.article_numbers):
                relaxed_no_doctype = LegalReferences(
                    doc_number=references.doc_number,
                    article_number=references.article_number,
                    clause_number=None,
                    document_type=None,
                    point_id=None,
                    article_numbers=references.article_numbers,
                    subject_hints=references.subject_hints,
                )
                tier1_matches = {
                    chunk_id: row for chunk_id, row in exact_rows.items()
                    if self._matches_exact(row[1], relaxed_no_doctype)
                }

            # Tầng 2: Khớp tập mentioned_articles / referenced_articles
            tier2_matches = {
                chunk_id: row for chunk_id, row in normal_rows.items()
                if chunk_id not in tier1_matches and self._matches_mentioned_tier2(row[1], references)
            }

            combined_pool = {**tier1_matches, **tier2_matches}

            if references.doc_number and not combined_pool:
                return []

            if not references.doc_number and len(combined_pool) < max(effective_limit * 3, 15):
                for cid in rrf_ranked_ids:
                    if cid in normal_rows and cid not in combined_pool:
                        combined_pool[cid] = normal_rows[cid]
                        if len(combined_pool) >= max(effective_limit * 4, 20):
                            break
                if not combined_pool and normal_rows:
                    for cid, row in list(normal_rows.items())[: max(effective_limit * 2, 10)]:
                        combined_pool[cid] = row

            if not combined_pool:
                return []

            pool_bm25 = BM25Index()
            pool_bm25.build([row[0] for row in combined_pool.values()], list(combined_pool))
            raw_bm25_scores = pool_bm25.get_scores(expanded_query)
            max_bm25 = max(raw_bm25_scores, default=0.0) or 1.0
            bm25_map = {
                cid: score / max_bm25 for cid, score in zip(combined_pool, raw_bm25_scores)
            }

            scored_ids = sorted(
                combined_pool,
                key=lambda cid: (
                    -LightweightLegalReranker.score_candidate(
                        chunk_id=cid,
                        document=combined_pool[cid][0],
                        metadata=combined_pool[cid][1],
                        references=references,
                        rrf_score=fused_scores.get(cid, 0.0),
                        bm25_norm=bm25_map.get(cid, 0.0),
                        phrase_len=self._phrase_match_length(query_tokens, combined_pool[cid][0]),
                    ),
                    -fused_scores.get(cid, 0.0),
                    cid,
                ),
            )
            ranked_ids = scored_ids
            normal_rows = {**normal_rows, **combined_pool}
        elif len(decomposed.sub_queries) >= 2 and normal_rows:
            # Truy vấn phức hợp nhiều ý: Multi-Query Hybrid Search + Document-Diversity Quota + Reranking
            ranked_ids, fused_scores = self._multi_query_hybrid_search(
                decomposed=decomposed,
                references=references,
                normal_rows=normal_rows,
                bm25=bm25,
                where=where,
                base_fused=fused,
                effective_limit=effective_limit,
            )
        else:
            # Truy vấn ngữ nghĩa đơn ý: kết hợp RRF, BM25, Phrase Match và Domain Hint
            if not rrf_ranked_ids and normal_rows:
                rrf_ranked_ids = list(normal_rows.keys())[: max(effective_limit * 4, 20)]

            pool_ids = rrf_ranked_ids[: max(60, effective_limit * 12)]
            if pool_ids:
                pool_bm25 = BM25Index()
                pool_bm25.build([normal_rows[cid][0] for cid in pool_ids], pool_ids)
                raw_bm25_scores = pool_bm25.get_scores(expanded_query)
                max_bm25 = max(raw_bm25_scores, default=0.0) or 1.0
                bm25_map = {cid: s / max_bm25 for cid, s in zip(pool_ids, raw_bm25_scores)}
                phrase_scores = {
                    cid: self._phrase_match_length(query_tokens, normal_rows[cid][0])
                    for cid in pool_ids
                }
                has_long_phrase = any(score >= 4 for score in phrase_scores.values())
                if has_long_phrase:
                    pool_ids.sort(
                        key=lambda cid: (
                            -phrase_scores[cid],
                            -LightweightLegalReranker.score_candidate(
                                chunk_id=cid,
                                document=normal_rows[cid][0],
                                metadata=normal_rows[cid][1],
                                references=references,
                                rrf_score=fused_scores.get(cid, 0.0),
                                bm25_norm=bm25_map.get(cid, 0.0),
                                phrase_len=phrase_scores[cid],
                                normalized_norms=decomposed.normalized_norms,
                            ),
                            -fused_scores.get(cid, 0.0),
                            cid,
                        )
                    )
                else:
                    pool_ids.sort(
                        key=lambda cid: (
                            -LightweightLegalReranker.score_candidate(
                                chunk_id=cid,
                                document=normal_rows[cid][0],
                                metadata=normal_rows[cid][1],
                                references=references,
                                rrf_score=fused_scores.get(cid, 0.0),
                                bm25_norm=bm25_map.get(cid, 0.0),
                                phrase_len=phrase_scores[cid],
                                normalized_norms=decomposed.normalized_norms,
                            ),
                            -fused_scores.get(cid, 0.0),
                            cid,
                        )
                    )
                ranked_ids = pool_ids
            else:
                ranked_ids = []

        candidates = []
        for chunk_id in ranked_ids:
            document, metadata = normal_rows[chunk_id]
            status = self._status_at(metadata, as_of)
            candidates.append(
                RetrievedChunk(
                    chunk_id,
                    document,
                    metadata,
                    fused_scores.get(chunk_id, 0.0),
                    status,
                    self._warning(status),
                    raw_document=document,
                )
            )
        if self.reranker:
            candidates = self.reranker(question, candidates[: max(50, min(100, effective_limit * 10))])
        top_candidates = candidates[:effective_limit]
        expanded_candidates = self.expand_cross_references(top_candidates, normal_rows, as_of=as_of)
        return self._enrich_sibling_context(expanded_candidates, normal_rows)
