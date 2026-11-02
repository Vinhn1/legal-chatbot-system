"""Trích xuất số hiệu, quy đổi dữ kiện thực tế sang quy phạm và phân rã đa truy vấn (Multi-Query Decomposition)."""

import json
import logging
import os
import re
import sys
from collections import OrderedDict
from dataclasses import dataclass

try:
    from google import genai
    from google.genai import types as genai_types
except ImportError:
    genai = None
    genai_types = None


logger = logging.getLogger(__name__)

_DOC_NUMBER = re.compile(
    r"(?<!\d)(\d{1,4}\s*/\s*\d{4}\s*/\s*[A-ZÀ-ỸĐ0-9]+(?:[-–][A-ZÀ-ỸĐ0-9]+)*|\bCD-\d+\b)(?![\w/])",
    re.IGNORECASE,
)
_ARTICLE = re.compile(r"\bđiều\s+(\d+[a-z]?)\b", re.IGNORECASE)
_MULTI_ARTICLE_SPAN = re.compile(
    r"\bđiều\s+\d+[a-z]?(?:\s*(?:,|và|hoặc|đến|-)\s*(?:điều\s+)?\d+[a-z]?)+",
    re.IGNORECASE,
)
_NUMBER_TOKEN = re.compile(r"\b(\d+[a-z]?)\b", re.IGNORECASE)
_CLAUSE = re.compile(r"\bkhoản\s+(\d+)\b", re.IGNORECASE)
_POINT = re.compile(r"\bđiểm\s+([a-zđ])(?:\)|\b)", re.IGNORECASE)

_DOCUMENT_TYPES = {
    "nghị định": "decree",
    "nghị quyết": "resolution",
    "thông tư": "circular",
    "luật": "law",
}

# Từ điển ánh xạ ngôn ngữ đời thường sang thuật ngữ pháp lý chuẩn Việt Nam
LEGAL_SYNONYM_MAP: tuple[tuple[tuple[str, ...], str], ...] = (
    (
        ("tách sổ đỏ", "tách sổ hồng", "tách sổ", "chia đất", "tách đất", "chia tách thửa đất"),
        "tách thửa đất điều kiện tách thửa đất diện tích tối thiểu được tách thửa",
    ),
    (
        ("sổ đỏ", "sổ hồng", "giấy chủ quyền đất"),
        "Giấy chứng nhận quyền sử dụng đất quyền sở hữu tài sản gắn liền với đất",
    ),
    (
        ("gộp sổ", "gộp đất", "nhập thửa", "gộp thửa"),
        "hợp thửa đất điều kiện hợp thửa đất",
    ),
    (
        ("mặt tiền", "bề rộng đất", "chiều ngang đất"),
        "kích thước cạnh tiếp giáp đường giao thông chiều sâu thửa đất diện tích tối thiểu",
    ),
    (
        ("đuổi việc", "cho thôi việc", "sa thải", "cắt hợp đồng"),
        "đơn phương chấm dứt hợp đồng lao động xử lý kỷ luật sa thải Bộ luật Lao động",
    ),
    (
        ("nghỉ ngang", "tự ý bỏ việc"),
        "người lao động đơn phương chấm dứt hợp đồng lao động trái pháp luật",
    ),
    (
        ("cổ phần", "cổ đông", "đại hội đồng cổ đông", "hội đồng quản trị"),
        "công ty cổ phần cổ đông Luật Doanh nghiệp",
    ),
    (
        ("vốn điều lệ", "góp vốn", "tăng vốn", "giảm vốn"),
        "vốn điều lệ góp vốn thành lập doanh nghiệp Luật Doanh nghiệp",
    ),
    (
        ("công ty tnhh", "tnhh 1 thành viên", "tnhh 2 thành viên"),
        "công ty trách nhiệm hữu hạn một thành viên hai thành viên trở lên Luật Doanh nghiệp",
    ),
    (
        ("phá sản", "vỡ nợ", "đóng cửa công ty"),
        "tổ chức lại giải thể và phá sản doanh nghiệp mất khả năng thanh toán",
    ),
    (
        ("ghế phụ", "cạnh ghế lái", "kế ghế lái", "kế bên tài xế", "ghế trước cạnh tài xế"),
        "ngồi cùng hàng ghế với người lái xe trên xe ô tô trừ loại xe ô tô chỉ có một hàng ghế",
    ),
    (
        ("ghế riêng cho trẻ", "ghế riêng cho bé", "ghế trẻ em", "ghế an toàn", "nôi trẻ em", "dây an toàn có sẵn"),
        "thiết bị an toàn cho trẻ em bảo đảm an toàn cho trẻ em ở tư thế ngồi hoặc nằm trên xe ô tô",
    ),
    (
        ("bằng lái", "bằng lái xe", "trừ điểm bằng lái", "tước bằng lái"),
        "giấy phép lái xe trừ điểm giấy phép lái xe phục hồi điểm giấy phép lái xe",
    ),
    (
        ("uống bia", "uống rượu", "say rượu", "thổi nồng độ cồn"),
        "trong máu hoặc hơi thở có nồng độ cồn điều khiển xe trên đường",
    ),
    (
        ("vượt đèn đỏ", "vượt đèn vàng", "không chấp hành đèn tín hiệu"),
        "không chấp hành hiệu lệnh của đèn tín hiệu giao thông",
    ),
)

# Các cụm từ nhận diện lĩnh vực chủ đề trong câu hỏi để phân biệt Điều trùng số giữa các văn bản
_SUBJECT_GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("doanh_nghiep", ("doanh nghiệp", "công ty", "cổ phần", "cổ đông", "tnhh", "vốn điều lệ", "góp vốn", "kinh doanh", "phá sản", "giải thể", "hộ kinh doanh", "chuyên đề")),
    ("dat_dai_tay_ninh", ("tách thửa", "hợp thửa", "thửa đất", "sổ đỏ", "sổ hồng", "tách sổ", "đất ở", "đất nông nghiệp", "tây ninh", "diện tích tối thiểu")),
    ("an_ninh_kinh_te", ("an ninh", "kinh tế - xã hội", "bảo đảm an ninh", "quốc phòng", "312/2026")),
    ("lao_dong", ("người lao động", "người sử dụng lao động", "hợp đồng lao động", "tiền lương", "sa thải", "thử việc")),
    ("du_lieu_ca_nhan", ("dữ liệu cá nhân", "bảo vệ dữ liệu", "chủ thể dữ liệu")),
    (
        "giao_thong",
        (
            "giao thông", "ô tô", "xe máy", "mô tô", "xe cơ giới", "ghế lái", "ghế phụ",
            "hàng ghế", "thiết bị an toàn", "dây đai an toàn", "dây an toàn", "cảnh sát giao thông",
            "giấy phép lái xe", "trừ điểm", "nồng độ cồn", "đèn tín hiệu", "tốc độ", "36/2024", "168/2024",
        ),
    ),
)

# Biểu thức chính quy phát hiện thông số định lượng thực tế (tuổi, chiều cao trẻ em, phương tiện)
_CHILD_AGE_RE = re.compile(
    r"(?:(?:con|bé|cháu|trẻ(?:\s+em)?)\s+(?:trai\s+|gái\s+)?)?\b([1-9])\s*tuổi\b|\b(\d{1,2})\s*tháng\s*tuổi\b",
    re.IGNORECASE,
)
_CHILD_HEIGHT_M_RE = re.compile(
    r"\b(?:cao\s*)?1\s*(?:m|[.,])\s*(0\d|1\d|2\d|3[0-4])(?:\s*m(?:ét)?)?\b|\b(?:cao\s*)?0\s*(?:m|[.,])\s*([4-9]\d?)\b",
    re.IGNORECASE,
)
_CHILD_HEIGHT_CM_RE = re.compile(
    r"\b(?:cao\s*)?([5-9]\d|1[0-2]\d|13[0-4])\s*cm\b",
    re.IGNORECASE,
)
_CAR_CONTEXT_WORDS = ("ô tô", "xe hơi", "4 chỗ", "5 chỗ", "7 chỗ", "ghế lái", "ghế phụ", "tài xế", "lái xe")
_CHILD_WORDS = ("con", "cháu", "bé", "trẻ em", "trẻ nhỏ")

_RULE_TRIGGERS = (
    "có vi phạm", "vi phạm quy tắc", "có được phép", "có được cho", "có được",
    "quy tắc an toàn", "quy tắc giao thông", "có cấm", "bắt buộc", "đúng hay sai",
)
_DEFINITION_TRIGGERS = (
    "thế nào là", "thế nào mới là", "là gì", "được hiểu như thế nào",
    "định nghĩa", "giải thích từ ngữ", "tiêu chuẩn", "thiết bị an toàn chuẩn",
)
_PENALTY_TRIGGERS = (
    "phạt bao nhiêu", "bị phạt", "mức phạt", "xử phạt", "phạt tiền",
    "trừ điểm", "trừ bao nhiêu điểm", "phạt bổ sung", "tước bằng", "tước giấy phép", "cảnh sát giao thông",
)
_EFFECTIVE_TRIGGERS = (
    "từ thời điểm nào", "thời điểm nào", "khi nào có hiệu lực", "áp dụng từ",
    "có hiệu lực từ", "bắt đầu áp dụng", "khi nào áp dụng", "hiệu lực thi hành",
)

_DECOMPOSE_CACHE: "OrderedDict[str, DecomposedQuery]" = OrderedDict()
_SHARED_DECOMPOSE_CLIENT = None


@dataclass(frozen=True)
class LegalReferences:
    """Các định danh pháp lý và tín hiệu chủ đề mà người hỏi đã chỉ định tường minh."""

    doc_number: str | None = None
    article_number: str | None = None
    clause_number: str | None = None
    document_type: str | None = None
    point_id: str | None = None
    article_numbers: tuple[str, ...] = ()
    subject_hints: tuple[str, ...] = ()

    @property
    def has_exact_target(self) -> bool:
        """Cho biết câu hỏi có đủ dấu hiệu để ưu tiên khớp metadata chính xác."""
        return any((self.doc_number, self.article_number, self.clause_number, self.point_id, self.article_numbers))


@dataclass(frozen=True)
class SubQuery:
    """Một truy vấn con độc lập đại diện cho một khía cạnh pháp lý cụ thể."""

    facet: str  # "rule" | "definition" | "penalty" | "effective_date"
    query: str
    target_doc_type: str | None = None


@dataclass(frozen=True)
class DecomposedQuery:
    """Kết quả chuẩn hóa thông số định lượng và phân rã câu hỏi phức hợp thành 2-5 sub-queries."""

    original_question: str
    expanded_question: str
    normalized_norms: tuple[str, ...] = ()
    sub_queries: tuple[SubQuery, ...] = ()


def normalize_doc_number(value: str) -> str:
    """Chuẩn hóa khoảng trắng, dấu gạch nối và chữ hoa trong số hiệu văn bản."""
    return re.sub(r"\s+", "", value).replace("–", "-").upper()


def normalize_unit_number(value: str) -> str:
    """Quy về cùng biểu diễn số Điều/Khoản kể cả khi người hỏi thêm số không ở đầu."""
    match = re.fullmatch(r"(\d+)([a-z]?)", value.strip(), re.IGNORECASE)
    if not match:
        return value.strip().casefold()
    return f"{int(match.group(1))}{match.group(2).casefold()}"


def map_facts_to_legal_norms(question: str) -> list[str]:
    """Quy đổi thông số định lượng và tình huống đời thường sang thuật ngữ quy phạm pháp luật."""
    if not question or not question.strip():
        return []
    lowered = question.casefold()
    norms: list[str] = []

    has_car = any(w in lowered for w in _CAR_CONTEXT_WORDS)
    has_child_word = any(w in lowered for w in _CHILD_WORDS)
    under_10_age = bool(_CHILD_AGE_RE.search(question)) and (has_child_word or has_car)
    under_135_height = bool(_CHILD_HEIGHT_M_RE.search(question) or _CHILD_HEIGHT_CM_RE.search(question))

    if has_car and (under_10_age or under_135_height or (has_child_word and ("ghế" in lowered or "dây an toàn" in lowered))):
        norms.append(
            "khi chở trẻ em dưới 10 tuổi và chiều cao dưới 1,35 mét trên xe ô tô không được cho trẻ em "
            "ngồi cùng hàng ghế với người lái xe trừ loại xe ô tô chỉ có một hàng ghế người lái xe phải "
            "sử dụng hướng dẫn sử dụng thiết bị an toàn phù hợp cho trẻ em"
        )

    if any(p in lowered for p in ("ghế phụ", "cạnh ghế lái", "kế ghế lái", "ghế trước", "kế bên tài xế")):
        norms.append("ngồi cùng hàng ghế với người lái xe trên xe ô tô")

    if any(p in lowered for p in ("ghế riêng", "ghế trẻ em", "ghế an toàn", "thiết bị an toàn", "nôi trẻ em", "dây an toàn có sẵn")):
        norms.append(
            "thiết bị an toàn cho trẻ em là thiết bị có đủ khả năng bảo đảm an toàn cho trẻ em "
            "ở tư thế ngồi hoặc nằm trên xe ô tô được thiết kế để giảm nguy cơ chấn thương cho người dùng "
            "trong trường hợp xảy ra va chạm hoặc xe ô tô giảm tốc độ đột ngột"
        )

    if any(p in lowered for p in _PENALTY_TRIGGERS) and has_car:
        if norms:
            norms.append(
                "xử phạt người điều khiển xe ô tô phạt tiền từ 800.000 đồng đến 1.000.000 đồng "
                "chở trẻ em dưới 10 tuổi và chiều cao dưới 1,35 mét trên xe ô tô ngồi cùng hàng ghế với người lái xe "
                "hoặc không sử dụng thiết bị an toàn phù hợp cho trẻ em theo quy định"
            )
        else:
            norms.append(
                "xử phạt trừ điểm giấy phép lái xe của người điều khiển xe ô tô vi phạm quy tắc giao thông đường bộ"
            )

    if any(p in lowered for p in _EFFECTIVE_TRIGGERS):
        norms.append("hiệu lực thi hành điều khoản chuyển tiếp có hiệu lực thi hành từ ngày 01 tháng 01 năm 2026")

    return norms


def expand_legal_query(question: str) -> str:
    """Mở rộng câu hỏi bằng cả từ điển đồng nghĩa lẫn quy tắc ánh xạ thông số định lượng pháp lý."""
    if not question or not question.strip():
        return question
    lowered = question.casefold()
    expansions: list[str] = []
    for triggers, legal_terms in LEGAL_SYNONYM_MAP:
        if any(trigger in lowered for trigger in triggers):
            if legal_terms not in expansions:
                expansions.append(legal_terms)
    for norm in map_facts_to_legal_norms(question):
        if norm not in expansions:
            expansions.append(norm)
    if not expansions:
        return question
    return f"{question.strip()} ({'; '.join(expansions)})"


def _build_rule_based_subqueries(question: str, norms: list[str]) -> list[SubQuery]:
    """Sinh danh sách sub-queries xác định theo 4 khía cạnh: quy tắc, định nghĩa, chế tài và hiệu lực."""
    lowered = question.casefold()
    has_car = any(w in lowered for w in _CAR_CONTEXT_WORDS)
    has_child_case = any("trẻ em dưới 10 tuổi" in n for n in norms)

    wants_rule = any(t in lowered for t in _RULE_TRIGGERS)
    wants_def = any(t in lowered for t in _DEFINITION_TRIGGERS)
    wants_penalty = any(t in lowered for t in _PENALTY_TRIGGERS)
    wants_effective = any(t in lowered for t in _EFFECTIVE_TRIGGERS)

    sub_queries: list[SubQuery] = []

    if wants_rule or (has_child_case and (wants_penalty or wants_def)):
        if has_child_case:
            sub_queries.append(
                SubQuery(
                    facet="rule",
                    query=(
                        "Quy tắc chung khi chở trẻ em dưới 10 tuổi và chiều cao dưới 1,35 mét trên xe ô tô "
                        "không được cho trẻ em ngồi cùng hàng ghế với người lái xe phải sử dụng hướng dẫn sử dụng "
                        "thiết bị an toàn phù hợp cho trẻ em"
                    ),
                    target_doc_type="law",
                )
            )
        else:
            norm_hint = " ".join(norms[:2])
            sub_queries.append(
                SubQuery(
                    facet="rule",
                    query=f"Quy tắc hành vi điều cấm nghĩa vụ theo Luật: {question.strip()} {norm_hint}".strip(),
                    target_doc_type="law",
                )
            )

    if wants_def:
        if has_child_case or "thiết bị an toàn" in lowered or "ghế" in lowered:
            sub_queries.append(
                SubQuery(
                    facet="definition",
                    query=(
                        "Giải thích từ ngữ Thiết bị an toàn cho trẻ em là thiết bị có đủ khả năng bảo đảm an toàn "
                        "cho trẻ em ở tư thế ngồi hoặc nằm trên xe ô tô giảm nguy cơ chấn thương khi va chạm"
                    ),
                    target_doc_type="law",
                )
            )
        else:
            sub_queries.append(
                SubQuery(
                    facet="definition",
                    query=f"Giải thích từ ngữ khái niệm định nghĩa pháp lý: {question.strip()}",
                    target_doc_type="law",
                )
            )

    if wants_penalty:
        if has_child_case and has_car:
            sub_queries.append(
                SubQuery(
                    facet="penalty",
                    query=(
                        "Xử phạt người điều khiển xe ô tô vi phạm quy tắc giao thông đường bộ phạt tiền từ 800.000 đồng "
                        "đến 1.000.000 đồng chở trẻ em dưới 10 tuổi và chiều cao dưới 1,35 mét trên xe ô tô ngồi cùng "
                        "hàng ghế với người lái xe hoặc không sử dụng thiết bị an toàn phù hợp cho trẻ em trừ điểm giấy phép lái xe"
                    ),
                    target_doc_type="decree",
                )
            )
        else:
            vehicle_hint = "người điều khiển xe ô tô" if has_car else ""
            sub_queries.append(
                SubQuery(
                    facet="penalty",
                    query=(
                        f"Mức phạt tiền hình thức xử phạt bổ sung trừ điểm giấy phép lái xe Nghị định xử phạt: "
                        f"{vehicle_hint} {question.strip()}"
                    ).strip(),
                    target_doc_type="decree",
                )
            )

    if wants_effective:
        if has_child_case and has_car:
            sub_queries.append(
                SubQuery(
                    facet="effective_date",
                    query=(
                        "Hiệu lực thi hành quy định tại điểm m khoản 3 Điều 6 chở trẻ em trên xe ô tô "
                        "có hiệu lực thi hành từ ngày 01 tháng 01 năm 2026 từ ngày 01 tháng 01 năm 2025"
                    ),
                    target_doc_type="decree",
                )
            )
        else:
            sub_queries.append(
                SubQuery(
                    facet="effective_date",
                    query=f"Hiệu lực thi hành thời điểm áp dụng điều khoản chuyển tiếp: {question.strip()}",
                    target_doc_type=None,
                )
            )

    return sub_queries


def _llm_decompose_subqueries(
    question: str,
    gemini_client=None,
    gemini_model: str | None = None,
) -> tuple[list[str], list[SubQuery]]:
    """Dùng LLM tốc độ cao trả về JSON có cấu trúc để phân rã câu hỏi đa ý và quy đổi thuật ngữ luật."""
    global _SHARED_DECOMPOSE_CLIENT
    in_test = bool(os.getenv("PYTEST_CURRENT_TEST")) or ("unittest" in sys.modules and gemini_client is None)
    if in_test or genai is None or genai_types is None:
        return [], []

    client = gemini_client
    if client is None:
        raw_keys = (os.getenv("GEMINI_API_KEYS") or os.getenv("GEMINI_API_KEY") or "").strip()
        keys = [k.strip() for k in raw_keys.split(",") if k.strip() and len(k.strip()) >= 20 and not k.strip().startswith(("test", "fake", "gia-lap"))]
        if not keys:
            return [], []
        api_key = keys[0]
        if _SHARED_DECOMPOSE_CLIENT is None:
            http_options = None
            if genai_types and hasattr(genai_types, "HttpOptions") and hasattr(genai_types, "HttpRetryOptions"):
                http_options = genai_types.HttpOptions(
                    timeout=15000,
                    retry_options=genai_types.HttpRetryOptions(attempts=1, http_status_codes=[]),
                )
            _SHARED_DECOMPOSE_CLIENT = genai.Client(api_key=api_key, http_options=http_options)
        client = _SHARED_DECOMPOSE_CLIENT

    model_name = gemini_model or os.getenv("LEGAL_QUERY_MODEL") or "gemini-2.5-flash-lite"
    system_instruction = (
        "Bạn là bộ phân tích câu hỏi pháp luật Việt Nam cho hệ thống RAG. "
        "Nhiệm vụ: (1) Quy đổi các con số, tình huống đời thường sang thuật ngữ định lượng trong Luật/Nghị định "
        "(ví dụ: '8 tuổi, cao 1m25' -> 'trẻ em dưới 10 tuổi và chiều cao dưới 1,35 mét'; "
        "'ghế phụ cạnh ghế lái' -> 'ngồi cùng hàng ghế với người lái xe'; "
        "'ghế riêng cho bé' -> 'thiết bị an toàn cho trẻ em'). "
        "(2) Tách câu hỏi phức hợp thành 2 đến 5 sub_queries độc lập theo các khía cạnh có trong câu hỏi: "
        "'rule' (quy tắc hành vi/điều cấm trong Luật, target_doc_type='law'), "
        "'definition' (giải thích từ ngữ/định nghĩa trong Luật, target_doc_type='law'), "
        "'penalty' (mức phạt tiền/phạt bổ sung/trừ điểm GPLX trong Nghị định, target_doc_type='decree'), "
        "'effective_date' (hiệu lực thi hành/điều khoản chuyển tiếp, target_doc_type='decree'). "
        "Chỉ trả về JSON hợp lệ theo mẫu: "
        '{"normalized_norms": ["..."], "sub_queries": [{"facet": "rule|definition|penalty|effective_date", "query": "...", "target_doc_type": "law|decree"}]}'
    )
    config_kwargs: dict = {
        "temperature": 0.0,
        "max_output_tokens": 512,
        "system_instruction": system_instruction,
        "response_mime_type": "application/json",
    }
    if "2.5" in model_name and hasattr(genai_types, "ThinkingConfig"):
        try:
            config_kwargs["thinking_config"] = genai_types.ThinkingConfig(thinking_budget=0)
        except Exception:
            pass

    try:
        response = client.models.generate_content(
            model=model_name,
            contents=f"Câu hỏi: {question.strip()}",
            config=genai_types.GenerateContentConfig(**config_kwargs),
        )
        raw_text = (getattr(response, "text", None) or "").strip()
        if not raw_text:
            return [], []
        payload = json.loads(raw_text)
        if not isinstance(payload, dict):
            return [], []
        llm_norms = [
            str(item).strip()
            for item in (payload.get("normalized_norms") or [])
            if isinstance(item, str) and item.strip()
        ][:5]
        valid_facets = {"rule", "definition", "penalty", "effective_date"}
        valid_doc_types = {"law", "decree", "resolution", "circular"}
        llm_subs: list[SubQuery] = []
        for item in (payload.get("sub_queries") or [])[:5]:
            if not isinstance(item, dict):
                continue
            facet = str(item.get("facet") or "rule").strip().lower()
            if facet not in valid_facets:
                facet = "rule"
            q_txt = str(item.get("query") or "").strip()
            if len(q_txt) < 6:
                continue
            doc_type = str(item.get("target_doc_type") or "").strip().lower() or None
            if doc_type not in valid_doc_types:
                doc_type = None
            llm_subs.append(SubQuery(facet=facet, query=q_txt, target_doc_type=doc_type))
        return llm_norms, llm_subs
    except Exception as exc:
        logger.debug("Gemini phân rã câu hỏi gặp lỗi (%s), kích hoạt dự phòng OpenAI...", type(exc).__name__)
        # Tự động kích hoạt dự phòng OpenAI gpt-4o-mini nếu Gemini thất bại hoặc hết hạn mức
        openai_key = (os.getenv("OPENAI_API_KEY") or "").strip()
        if openai_key:
            try:
                import openai
                oai_client = openai.OpenAI(api_key=openai_key)
                oai_resp = oai_client.chat.completions.create(
                    model="gpt-4o-mini",
                    messages=[
                        {"role": "system", "content": system_instruction},
                        {"role": "user", "content": f"Câu hỏi: {question.strip()}"},
                    ],
                    response_format={"type": "json_object"},
                    temperature=0.0,
                    max_tokens=512,
                    timeout=10.0,
                )
                raw_text = (oai_resp.choices[0].message.content or "").strip()
                if raw_text:
                    payload = json.loads(raw_text)
                    if isinstance(payload, dict):
                        llm_norms = [
                            str(item).strip()
                            for item in (payload.get("normalized_norms") or [])
                            if isinstance(item, str) and item.strip()
                        ][:5]
                        valid_facets = {"rule", "definition", "penalty", "effective_date"}
                        valid_doc_types = {"law", "decree", "resolution", "circular"}
                        llm_subs: list[SubQuery] = []
                        for item in (payload.get("sub_queries") or [])[:5]:
                            if not isinstance(item, dict):
                                continue
                            facet = str(item.get("facet") or "rule").strip().lower()
                            if facet not in valid_facets:
                                facet = "rule"
                            q_txt = str(item.get("query") or "").strip()
                            if len(q_txt) < 6:
                                continue
                            doc_type = str(item.get("target_doc_type") or "").strip().lower() or None
                            if doc_type not in valid_doc_types:
                                doc_type = None
                            llm_subs.append(SubQuery(facet=facet, query=q_txt, target_doc_type=doc_type))
                        return llm_norms, llm_subs
            except Exception as oai_exc:
                logger.debug("Dự phòng OpenAI phân rã truy vấn thất bại: %s", oai_exc)

        logger.debug("Bỏ qua phân rã LLM, sử dụng bộ quy tắc định lượng cục bộ: %s", type(exc).__name__)
        return [], []


def decompose_legal_query(
    question: str,
    use_llm: bool = True,
    gemini_client=None,
    gemini_model: str | None = None,
) -> DecomposedQuery:
    """Chuẩn hóa thông số thực tế và tách câu hỏi dài nhiều ý thành 2-5 sub-queries độc lập."""
    if not question or not question.strip():
        return DecomposedQuery(original_question=question or "", expanded_question=question or "")

    cache_key = f"{question.strip()}|llm={bool(use_llm and gemini_client is None)}"
    if gemini_client is None and cache_key in _DECOMPOSE_CACHE:
        return _DECOMPOSE_CACHE[cache_key]

    rule_norms = map_facts_to_legal_norms(question)
    rule_subs = _build_rule_based_subqueries(question, rule_norms)

    word_count = len(question.split())
    clause_marks = question.count("?") + question.count(",") + question.count(";")
    is_complex = len(rule_subs) >= 2 or (word_count >= 18 and clause_marks >= 1)

    llm_norms: list[str] = []
    llm_subs: list[SubQuery] = []
    if use_llm and is_complex:
        llm_norms, llm_subs = _llm_decompose_subqueries(
            question,
            gemini_client=gemini_client,
            gemini_model=gemini_model,
        )

    merged_norms: list[str] = []
    for norm in [*rule_norms, *llm_norms]:
        if norm and norm not in merged_norms:
            merged_norms.append(norm)

    # Ưu tiên giữ đủ đại diện các khía cạnh từ rule-based và bổ sung truy vấn con giàu từ khóa từ LLM (tối đa 5)
    merged_subs: list[SubQuery] = []
    seen_facets: dict[str, int] = {}
    for sq in [*rule_subs, *llm_subs]:
        if any(existing.query.casefold() == sq.query.casefold() for existing in merged_subs):
            continue
        facet_count = seen_facets.get(sq.facet, 0)
        if facet_count >= 2:
            continue
        merged_subs.append(sq)
        seen_facets[sq.facet] = facet_count + 1
        if len(merged_subs) >= 5:
            break

    base_expanded = expand_legal_query(question)
    extra_llm_norms = [n for n in llm_norms if n not in base_expanded]
    if extra_llm_norms:
        base_expanded = f"{base_expanded} ({'; '.join(extra_llm_norms)})"

    decomposed = DecomposedQuery(
        original_question=question.strip(),
        expanded_question=base_expanded,
        normalized_norms=tuple(merged_norms),
        sub_queries=tuple(merged_subs),
    )
    if gemini_client is None:
        if len(_DECOMPOSE_CACHE) >= 128:
            _DECOMPOSE_CACHE.popitem(last=False)
        _DECOMPOSE_CACHE[cache_key] = decomposed
    return decomposed


def extract_legal_references(question: str) -> LegalReferences:
    """Tách số hiệu, danh sách Điều, Khoản, Điểm, loại văn bản và chủ đề từ câu hỏi."""
    number = _DOC_NUMBER.search(question)
    clause = _CLAUSE.search(question)
    point = _POINT.search(question)
    lowered = question.casefold()

    # Trích xuất toàn bộ danh sách số Điều (hỗ trợ cả "Điều 6 và Điều 7" hoặc "Điều 9, 10")
    articles_found: list[str] = []
    for span in _MULTI_ARTICLE_SPAN.finditer(question):
        for num_match in _NUMBER_TOKEN.finditer(span.group(0)):
            norm = normalize_unit_number(num_match.group(1))
            if norm and norm not in articles_found:
                articles_found.append(norm)
    for single in _ARTICLE.finditer(question):
        norm = normalize_unit_number(single.group(1))
        if norm and norm not in articles_found:
            articles_found.append(norm)

    primary_article = articles_found[0] if articles_found else None
    document_type = next((kind for label, kind in _DOCUMENT_TYPES.items() if label in lowered), None)

    expanded_lower = expand_legal_query(question).casefold()
    hints: list[str] = []
    for group_name, keywords in _SUBJECT_GROUPS:
        if any(kw in expanded_lower for kw in keywords):
            hints.append(group_name)

    return LegalReferences(
        doc_number=normalize_doc_number(number.group(1)) if number else None,
        article_number=primary_article,
        clause_number=normalize_unit_number(clause.group(1)) if clause else None,
        document_type=document_type,
        point_id=point.group(1).casefold() if point else None,
        article_numbers=tuple(articles_found),
        subject_hints=tuple(hints),
    )


def reformulate_query(question, chat_history=None, gemini_client=None, gemini_model=None):
    """Mở rộng từ đồng nghĩa và ánh xạ thông số thực tế sang thuật ngữ định lượng pháp lý."""
    decomposed = decompose_legal_query(
        question,
        use_llm=gemini_client is not None,
        gemini_client=gemini_client,
        gemini_model=gemini_model,
    )
    return decomposed.expanded_question, decomposed.expanded_question != question
