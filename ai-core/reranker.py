"""Xếp hạng lại đoạn nguồn mà không ghi nội dung pháp lý vào log."""

import logging
from typing import Optional

logger = logging.getLogger(__name__)

_reranker_model = None
_reranker_model_name = None


def _get_reranker(model_name="cross-encoder/ms-marco-MiniLM-L-6-v2"):
    global _reranker_model, _reranker_model_name
    if _reranker_model is not None and _reranker_model_name == model_name:
        return _reranker_model
    try:
        from sentence_transformers import CrossEncoder
        logger.info("Đang nạp mô hình xếp hạng lại.")
        _reranker_model = CrossEncoder(model_name, max_length=512)
        _reranker_model_name = model_name
        logger.info("Đã nạp mô hình xếp hạng lại.")
        return _reranker_model
    except ImportError:
        logger.warning("Thiếu thư viện xếp hạng lại; giữ thứ tự nguồn ban đầu.")
        return None
    except Exception:
        logger.warning("Không thể nạp mô hình xếp hạng lại.")
        return None


def rerank(
    query: str,
    candidates: list[dict],
    top_k: int = 5,
    model_name: str = "cross-encoder/ms-marco-MiniLM-L-6-v2",
) -> list[dict]:
    """
    Rerank candidates bằng CrossEncoder cross-encoder scoring.
    Mỗi candidate là dict chứa ít nhất: {id, document, metadata, score}
    Returns top_k candidates đã được sắp xếp lại theo cross-encoder score.
    """
    if not candidates:
        return candidates

    model = _get_reranker(model_name)
    if model is None:
        logger.debug("Giữ thứ tự nguồn ban đầu.")
        return candidates[:top_k]

    try:
        pairs = [[query, c["document"][:512]] for c in candidates]
        scores = model.predict(pairs)
        for i, c in enumerate(candidates):
            c["rerank_score"] = float(scores[i])
        reranked = sorted(candidates, key=lambda x: x.get("rerank_score", 0), reverse=True)
        # Không in đoạn nguồn, câu hỏi hoặc điểm số có thể gắn với dữ liệu nội bộ.
        logger.debug("Đã hoàn tất xếp hạng lại nguồn.")
        return reranked[:top_k]
    except Exception:
        logger.warning("Không thể xếp hạng lại; giữ thứ tự nguồn ban đầu.")
        return candidates[:top_k]
