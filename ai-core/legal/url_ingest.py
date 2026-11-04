"""Tải trang công khai, bóc tách văn bản pháp luật và lập chỉ mục."""

import ipaddress
import json
import re
import socket
from urllib.parse import urljoin

import requests
import trafilatura
from bs4 import BeautifulSoup
import urllib3.util.connection as urllib3_connection

from legal.ingest import IngestDocumentMetadata, IngestResult, MAX_FILE_BYTES, ingest_file
from legal.metadata_extractor import auto_extract_metadata, readable_document_number
from legal.security import validate_public_url

_orig_create_connection = urllib3_connection.create_connection


def _safe_create_connection(address, *args, **kwargs):
    """Xác thực IP tầng socket ngay trước khi kết nối TCP để chặn DNS Rebinding (TOCTOU)."""
    host, port = address
    try:
        ip = ipaddress.ip_address(host)
        addresses = [ip]
    except ValueError:
        records = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        addresses = [ipaddress.ip_address(record[4][0].split("%", 1)[0]) for record in records]

    if not addresses or any(not addr.is_global for addr in addresses):
        raise ValueError("Địa chỉ IP đích không phải là địa chỉ công khai hợp lệ.")
    return _orig_create_connection(address, *args, **kwargs)


DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    "Sec-Ch-Ua": '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    "Upgrade-Insecure-Requests": "1",
}

_VIETNAMESE_MARKS = re.compile(
    r"[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]",
    re.IGNORECASE,
)
_ENGLISH_LEGAL_MARKERS = re.compile(r"\b(?:Article|Chapter|Pursuant to|National Assembly|Labor Code)\b", re.IGNORECASE)
_PREFERRED_CONTENT = ("#printableContent", "#legal_doc_2", ".content-detail", ".toanvan", "article.active")


def _has_vietnamese_text(text: str) -> bool:
    """Chặn bản dịch tiếng Anh khi nội dung không có đủ dấu tiếng Việt."""
    letters = sum(char.isalpha() for char in text)
    marks = len(_VIETNAMESE_MARKS.findall(text))
    if letters == 0 or marks < 2 or marks / letters < 0.015:
        return False
    return not (_ENGLISH_LEGAL_MARKERS.search(text[:5000]) and marks / letters < 0.04)


def _clean_public_dom(soup: BeautifulSoup) -> None:
    """Loại tab ẩn, bản dịch tiếng Anh và thành phần giao diện trước khi bóc tách."""
    for tag in list(soup.find_all(True)):
        if tag.parent is None:
            continue
        classes = [value.lower() for value in tag.get("class", [])]
        identifier = str(tag.get("id", "")).lower()
        names = " ".join([identifier, *classes])
        english = re.search(r"(?:^|[_\s-])en(?:$|[_\s-])|english", names)
        inactive_tab = "tab-pane" in classes and not {"active", "show"}.intersection(classes)
        hidden = (tag.has_attr("hidden") or tag.get("aria-hidden") == "true"
                  or re.search(r"(?:display\s*:\s*none|visibility\s*:\s*hidden)", tag.get("style", ""), re.IGNORECASE))
        if tag.name in {"script", "style", "nav", "footer", "header", "aside", "iframe", "noscript"} or english or inactive_tab or hidden:
            tag.decompose()


def _download_public_html(url: str) -> bytes:
    """Kiểm tra từng đích chuyển hướng và giới hạn dữ liệu nhận từ mạng kèm chống DNS Rebinding."""
    current = validate_public_url(url)
    urllib3_connection.create_connection = _safe_create_connection
    try:
        for _ in range(6):
            with requests.get(current, timeout=30, allow_redirects=False, stream=True,
                              headers=DEFAULT_HEADERS) as response:
                if response.status_code in (301, 302, 303, 307, 308):
                    location = response.headers.get("Location")
                    if not location:
                        raise ValueError("Trang nguồn chuyển hướng không hợp lệ.")
                    current = validate_public_url(urljoin(current, location))
                    continue
                response.raise_for_status()
                content_type = response.headers.get("Content-Type", "").lower()
                if content_type and not any(kind in content_type for kind in ("text/html", "application/xhtml+xml")):
                    raise ValueError("URL không trỏ đến trang HTML.")
                chunks = []
                size = 0
                for chunk in response.iter_content(chunk_size=65536):
                    size += len(chunk)
                    if size > MAX_FILE_BYTES:
                        raise ValueError("Trang web vượt quá giới hạn 15 MB.")
                    chunks.append(chunk)
                return b"".join(chunks)
        raise ValueError("Trang nguồn chuyển hướng quá nhiều lần.")
    except requests.exceptions.HTTPError as exc:
        # Không đưa URL hoặc thông điệp gốc của thư viện HTTP vào phản hồi API.
        code = exc.response.status_code if exc.response is not None else None
        if code == 403:
            raise ValueError("Trang web nguồn từ chối truy cập (403 Forbidden). Vui lòng tải file hoặc copy nội dung văn bản trực tiếp.") from None
        if code == 404:
            raise ValueError("Không tìm thấy trang web nguồn (404 Not Found). Vui lòng kiểm tra lại đường dẫn URL.") from None
        if isinstance(code, int) and 500 <= code <= 599:
            raise ValueError(f"Máy chủ trang nguồn gặp sự cố (mã phản hồi {code}).") from None
        if isinstance(code, int) and 400 <= code <= 499:
            raise ValueError(f"Trang web nguồn từ chối yêu cầu (mã phản hồi {code}).") from None
        raise ValueError("Trang web nguồn trả về lỗi HTTP không xác định.") from None
    except requests.exceptions.Timeout:
        raise ValueError("Hết thời gian chờ phản hồi từ trang web nguồn (quá 30 giây).") from None
    except requests.exceptions.SSLError:
        raise ValueError("Lỗi xác thực chứng chỉ SSL/TLS của trang web nguồn.") from None
    except requests.exceptions.ConnectionError:
        raise ValueError("Không thể kết nối đến máy chủ trang nguồn. Vui lòng kiểm tra lại URL hoặc kết nối mạng.") from None
    except requests.exceptions.RequestException:
        raise ValueError("Không tải được trang nguồn công khai do lỗi yêu cầu HTTP.") from None
    finally:
        urllib3_connection.create_connection = _orig_create_connection


def fetch_and_clean_url(url: str) -> tuple[str, str]:
    """Ưu tiên vùng văn bản gốc và chỉ trả nội dung tiếng Việt có dấu."""
    html = _download_public_html(url)
    soup = BeautifulSoup(html, "html.parser")
    _clean_public_dom(soup)
    title_nodes = [*soup.select("h1")]
    if soup.title:
        title_nodes.append(soup.title)
    title = next((value for node in title_nodes
                  if (value := node.get_text(" ", strip=True)) and _has_vietnamese_text(value)), "")
    saw_content = False
    for selector in _PREFERRED_CONTENT:
        for container in soup.select(selector):
            content = container.get_text("\n", strip=True)
            saw_content = saw_content or bool(content)
            if _has_vietnamese_text(content):
                return content, title

    # Trafilatura chỉ nhận DOM đã loại bản dịch để tránh tự chọn tab tiếng Anh.
    extracted = trafilatura.extract(str(soup), output_format="json", with_metadata=True, target_language="vi")
    if extracted:
        article = json.loads(extracted)
        content = (article.get("text") or "").strip()
        saw_content = saw_content or bool(content)
        if _has_vietnamese_text(content):
            extracted_title = (article.get("title") or "").strip()
            return content, title or (extracted_title if _has_vietnamese_text(extracted_title) else "")
    for container in (soup.find("article"), soup.find("main"), soup.body):
        if container is None:
            continue
        content = container.get_text("\n", strip=True)
        saw_content = saw_content or bool(content)
        if _has_vietnamese_text(content):
            return content, title
    if saw_content:
        raise ValueError("Trang nguồn không chứa nội dung văn bản tiếng Việt có dấu có thể xác minh.")
    raise ValueError("Không trích xuất được nội dung văn bản từ URL.")


def build_document_metadata(data: bytes, filename: str, source_url: str = "", page_title: str = "") -> IngestDocumentMetadata:
    """Chuẩn hóa metadata tự động; đánh dấu trường chưa nhận diện thay vì yêu cầu nhập tay."""
    extracted = auto_extract_metadata(data, filename)
    fields = IngestDocumentMetadata.model_fields
    normalized = {key: value for key, value in extracted.items() if key in fields and value is not None}
    from legal.metadata_extractor import normalize_fallback_title
    fallback_title = normalize_fallback_title(filename)
    # Tiêu đề tiếng Việt trên trang nguồn chính xác hơn tiêu đề heuristic bị cắt ngắn.
    raw_title = page_title or normalized.get("doc_title") or fallback_title
    clean_title = re.sub(r"[_\-]+", " ", raw_title).strip()
    normalized["doc_title"] = re.sub(r"\s+", " ", clean_title) or raw_title
    normalized["doc_number"] = normalized.get("doc_number") or readable_document_number(
        data.decode("utf-8", errors="ignore"), filename, normalized["doc_title"])
    normalized["issuing_authority"] = normalized.get("issuing_authority") or "Chưa xác định"
    normalized["source_url"] = source_url or normalized.get("source_url") or "https://congbao.chinhphu.vn"
    # Không khẳng định còn hiệu lực khi chưa nhận diện được ngày bắt đầu áp dụng.
    if not normalized.get("effective_date"):
        normalized["effective_status"] = "unknown"
    return IngestDocumentMetadata(**normalized)


def ingest_from_url(url: str, collection) -> IngestResult:
    """Đưa nội dung URL qua cùng pipeline phân đoạn và kiểm tra trùng của tệp TXT."""
    public_url = validate_public_url(url)
    text, page_title = fetch_and_clean_url(public_url)
    data = text.encode("utf-8")
    metadata = build_document_metadata(data, "web_document.txt", public_url, page_title)
    return ingest_file(data, "web_document.txt", metadata, collection, source_type="web")
