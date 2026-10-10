"""Chỉ mục BM25 và hàm hợp nhất thứ hạng cho truy xuất văn bản pháp luật."""

import math
import re
import unicodedata


class BM25Index:
    """Tính điểm BM25 trên các chunk đã được lọc quyền và hiệu lực."""

    K1 = 1.5
    B = 0.75
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
        self.doc_ids: list[str] = []
        self.doc_texts: list[str] = []
        self.idf: dict[str, float] = {}
        self.avgdl = 0.0
        self._built = False

    @staticmethod
    def tokenize(text: str) -> list[str]:
        """Chuẩn hóa Unicode, bỏ từ dừng và giữ số Điều/Khoản một chữ số."""
        normalized = unicodedata.normalize("NFKC", text).lower()
        tokens = re.sub(r"[^\w\s]", " ", normalized).split()
        return [token for token in tokens if token not in BM25Index._VI_STOPWORDS and (len(token) > 1 or token.isdigit())]

    def build(self, documents: list[str], doc_ids: list[str]) -> None:
        """Lập chỉ mục từ vựng và tần suất nghịch đảo cho tập chunk được phép xem."""
        if len(documents) != len(doc_ids):
            raise ValueError("Số văn bản và số định danh BM25 phải bằng nhau.")
        self.doc_ids = list(doc_ids)
        self.doc_texts = list(documents)
        self.corpus_tokens = [self.tokenize(document) for document in documents]
        self.idf = {}
        self._built = False
        count = len(self.corpus_tokens)
        if count == 0:
            self.avgdl = 0.0
            return
        self.avgdl = sum(len(tokens) for tokens in self.corpus_tokens) / count
        frequencies: dict[str, int] = {}
        for tokens in self.corpus_tokens:
            for term in set(tokens):
                frequencies[term] = frequencies.get(term, 0) + 1
        self.idf = {
            term: math.log((count - frequency + 0.5) / (frequency + 0.5) + 1)
            for term, frequency in frequencies.items()
        }
        self._built = True

    def get_scores(self, query: str) -> list[float]:
        """Tính điểm BM25 cho từng chunk theo từ khóa trong câu hỏi."""
        scores = [0.0] * len(self.corpus_tokens)
        if not self._built or self.avgdl == 0:
            return scores
        for term in self.tokenize(query):
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
