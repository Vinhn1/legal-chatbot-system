"""Chỉ mục BM25 (kết hợp từ đơn và cụm từ ghép pháp lý 2 âm tiết) cùng hàm hợp nhất RRF."""

import math
import re
import unicodedata


class BM25Index:
    """Tính điểm BM25 trên các chunk đã được lọc quyền và hiệu lực."""

    K1 = 1.5
    B = 0.75
    BIGRAM_WEIGHT = 0.40
    # Giữ lại các từ chỉ đơn vị quy phạm như điều, khoản, điểm và số thứ tự.
    _VI_STOPWORDS = {
        "và", "hoặc", "của", "cho", "là", "các", "những", "được", "bị",
        "thì", "mà", "nào", "gì", "đâu", "ở", "khi", "tại", "sao",
        "thế", "hay", "tôi", "bạn", "có", "không", "đã", "đang", "sẽ",
        "lại", "như", "với", "ra", "này", "kia", "đều", "tất", "cả",
        "để", "về", "trong", "trên", "theo", "từ", "đến", "một",
        "va", "hoac", "cua", "cac", "nhung", "duoc", "khong", "theo",
    }

    def __init__(self):
        """Khởi tạo chỉ mục rỗng cho tập chunk hiện hành."""
        self.corpus_tokens: list[list[str]] = []
        self.corpus_bigrams: list[list[str]] = []
        self.doc_ids: list[str] = []
        self.doc_texts: list[str] = []
        self.idf: dict[str, float] = {}
        self.bigram_idf: dict[str, float] = {}
        self.avgdl = 0.0
        self.avg_bigram_dl = 0.0
        self._built = False

    @staticmethod
    def tokenize(text: str) -> list[str]:
        """Chuẩn hóa Unicode, bỏ từ dừng và giữ số Điều/Khoản một chữ số."""
        normalized = unicodedata.normalize("NFKC", text).lower()
        tokens = re.sub(r"[^\w\s]", " ", normalized).split()
        return [token for token in tokens if token not in BM25Index._VI_STOPWORDS and (len(token) > 1 or token.isdigit())]

    @staticmethod
    def bigrams(tokens: list[str]) -> list[str]:
        """Tạo danh sách cụm từ ghép 2 âm tiết liên tiếp để bắt chính xác thuật ngữ pháp lý tiếng Việt."""
        if len(tokens) < 2:
            return []
        return [f"{tokens[i]}_{tokens[i + 1]}" for i in range(len(tokens) - 1)]

    def build(self, documents: list[str], doc_ids: list[str]) -> None:
        """Lập chỉ mục từ vựng đơn và cụm từ ghép cho tập chunk được phép xem."""
        if len(documents) != len(doc_ids):
            raise ValueError("Số văn bản và số định danh BM25 phải bằng nhau.")
        self.doc_ids = list(doc_ids)
        self.doc_texts = list(documents)
        self.corpus_tokens = [self.tokenize(document) for document in documents]
        self.corpus_bigrams = [self.bigrams(tokens) for tokens in self.corpus_tokens]
        self.idf = {}
        self.bigram_idf = {}
        self._built = False
        count = len(self.corpus_tokens)
        if count == 0:
            self.avgdl = 0.0
            self.avg_bigram_dl = 0.0
            return
        self.avgdl = sum(len(tokens) for tokens in self.corpus_tokens) / count
        self.avg_bigram_dl = sum(len(bgs) for bgs in self.corpus_bigrams) / count

        frequencies: dict[str, int] = {}
        for tokens in self.corpus_tokens:
            for term in set(tokens):
                frequencies[term] = frequencies.get(term, 0) + 1
        self.idf = {
            term: math.log((count - frequency + 0.5) / (frequency + 0.5) + 1)
            for term, frequency in frequencies.items()
        }

        bg_frequencies: dict[str, int] = {}
        for bgs in self.corpus_bigrams:
            for bg in set(bgs):
                bg_frequencies[bg] = bg_frequencies.get(bg, 0) + 1
        self.bigram_idf = {
            bg: math.log((count - frequency + 0.5) / (frequency + 0.5) + 1)
            for bg, frequency in bg_frequencies.items()
        }
        self._built = True

    def get_scores(self, query: str) -> list[float]:
        """Tính điểm BM25 kết hợp từ đơn (unigram) và cụm thuật ngữ pháp lý 2 từ (bigram)."""
        scores = [0.0] * len(self.corpus_tokens)
        if not self._built or self.avgdl == 0:
            return scores
        q_tokens = self.tokenize(query)
        for term in q_tokens:
            idf = self.idf.get(term, 0.0)
            if idf == 0:
                continue
            for index, tokens in enumerate(self.corpus_tokens):
                frequency = tokens.count(term)
                if frequency == 0:
                    continue
                numerator = frequency * (self.K1 + 1)
                denominator = frequency + self.K1 * (1 - self.B + self.B * len(tokens) / self.avgdl)
                scores[index] += idf * numerator / denominator

        if self.avg_bigram_dl > 0:
            for bg in self.bigrams(q_tokens):
                bg_idf = self.bigram_idf.get(bg, 0.0)
                if bg_idf == 0:
                    continue
                for index, bgs in enumerate(self.corpus_bigrams):
                    frequency = bgs.count(bg)
                    if frequency == 0:
                        continue
                    numerator = frequency * (self.K1 + 1)
                    denominator = frequency + self.K1 * (1 - self.B + self.B * len(bgs) / self.avg_bigram_dl)
                    scores[index] += self.BIGRAM_WEIGHT * bg_idf * numerator / denominator
        return scores

    def top_k(self, query: str, k: int = 10) -> list[tuple[str, float, str]]:
        """Trả về các chunk có điểm BM25 dương theo thứ tự giảm dần."""
        scores = self.get_scores(query)
        ranked = sorted(enumerate(scores), key=lambda item: item[1], reverse=True)
        return [(self.doc_ids[index], score, self.doc_texts[index]) for index, score in ranked[:k] if score > 0]


def reciprocal_rank_fusion(
    vector_results: list[tuple[str, float, str]],
    bm25_results: list[tuple[str, float, str]],
    k_rrf: int = 60,
    alpha: float = 0.5,
) -> list[tuple[str, float, str]]:
    """Hợp nhất hai bảng xếp hạng bằng RRF mà không phụ thuộc thang điểm gốc."""
    texts: dict[str, str] = {}
    scores: dict[str, float] = {}
    for rank, (chunk_id, _, content) in enumerate(vector_results, start=1):
        texts[chunk_id] = content
        scores[chunk_id] = scores.get(chunk_id, 0.0) + alpha / (k_rrf + rank)
    for rank, (chunk_id, _, content) in enumerate(bm25_results, start=1):
        texts[chunk_id] = content
        scores[chunk_id] = scores.get(chunk_id, 0.0) + (1 - alpha) / (k_rrf + rank)
    ranked = sorted(scores.items(), key=lambda item: (-item[1], item[0]))
    return [(chunk_id, score, texts[chunk_id]) for chunk_id, score in ranked]


def multi_query_rrf(
    ranked_lists: list[tuple[list[tuple[str, float, str]], float]],
    k_rrf: int = 60,
) -> list[tuple[str, float, str]]:
    """Hợp nhất kết quả Hybrid RRF từ câu hỏi gốc và các sub-queries theo cả điểm đỉnh lẫn độ phủ."""
    texts: dict[str, str] = {}
    sum_scores: dict[str, float] = {}
    max_scores: dict[str, float] = {}

    for results, weight in ranked_lists:
        if not results or weight <= 0:
            continue
        for rank, (chunk_id, rrf_val, content) in enumerate(results, start=1):
            texts[chunk_id] = content
            # Kết hợp thứ hạng trong từng sub-query với điểm RRF nội bộ của sub-query đó
            contrib = weight * (0.5 / (k_rrf + rank) + 0.5 * float(rrf_val))
            sum_scores[chunk_id] = sum_scores.get(chunk_id, 0.0) + contrib
            if contrib > max_scores.get(chunk_id, 0.0):
                max_scores[chunk_id] = contrib

    combined: dict[str, float] = {
        cid: max_scores[cid] * 0.70 + sum_scores[cid] * 0.30
        for cid in sum_scores
    }
    ranked = sorted(combined.items(), key=lambda item: (-item[1], item[0]))
    return [(cid, score, texts[cid]) for cid, score in ranked]
