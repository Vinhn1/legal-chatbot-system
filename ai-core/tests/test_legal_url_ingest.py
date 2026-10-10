"""Kiểm tra tải HTML công khai và chặn URL nội bộ trước khi gửi yêu cầu mạng."""

import importlib
import json
import sys
import types
import unittest
from unittest.mock import MagicMock, patch

import requests
from fastapi import HTTPException

from legal.metadata_extractor import extract_metadata_heuristic
from legal.parser import parse_legal_text
from legal.url_ingest import build_document_metadata, fetch_and_clean_url, ingest_from_url


class UrlIngestTests(unittest.TestCase):
    """Dùng HTML giả lập, không phụ thuộc dịch vụ bên ngoài hay ChromaDB thật."""

    @patch("legal.url_ingest.validate_public_url", side_effect=lambda value: value)
    @patch("legal.url_ingest.requests.get")
    @patch("legal.url_ingest.trafilatura.extract")
    def test_extracts_article_and_title(self, extract, get, _validate):
        """Nội dung chính và tiêu đề được lấy từ trafilatura."""
        response = MagicMock()
        response.status_code = 200
        response.headers = {"Content-Type": "text/html; charset=utf-8"}
        response.iter_content.return_value = [b"<html><title>Trang goc</title><article>Dieu 1</article></html>"]
        get.return_value.__enter__.return_value = response
        extract.return_value = json.dumps({"text": "Điều 1. Quy định chung", "title": "Luật thử nghiệm"})
        self.assertEqual(fetch_and_clean_url("https://example.org/law"), ("Điều 1. Quy định chung", "Luật thử nghiệm"))
        get.assert_called_once()
        headers = get.call_args.kwargs["headers"]
        self.assertIn("Mozilla/5.0", headers["User-Agent"])
        self.assertIn("text/html", headers["Accept"])
        self.assertIn("vi-VN", headers["Accept-Language"])
        self.assertIn("Sec-Ch-Ua", headers)

    @patch("legal.url_ingest.validate_public_url", side_effect=lambda value: value)
    @patch("legal.url_ingest.requests.get")
    def test_http_errors_report_specific_reasons(self, get, _validate):
        """Các mã HTTP phổ biến trả thông báo rõ ràng mà không lộ URL gốc."""
        cases = (
            (403, "Trang web nguồn từ chối truy cập (403 Forbidden). Vui lòng tải file hoặc copy nội dung văn bản trực tiếp."),
            (404, "Không tìm thấy trang web nguồn (404 Not Found). Vui lòng kiểm tra lại đường dẫn URL."),
            (503, "Máy chủ trang nguồn gặp sự cố (mã phản hồi 503)."),
        )
        for status, message in cases:
            with self.subTest(status=status):
                error_response = requests.Response()
                error_response.status_code = status
                response = MagicMock()
                response.status_code = status
                response.raise_for_status.side_effect = requests.exceptions.HTTPError(
                    "Đường dẫn riêng tư trong lỗi gốc", response=error_response,
                )
                get.return_value.__enter__.return_value = response
                with self.assertRaises(ValueError) as raised:
                    fetch_and_clean_url("https://example.org/law")
                self.assertEqual(str(raised.exception), message)

    @patch("legal.url_ingest.validate_public_url", side_effect=lambda value: value)
    @patch("legal.url_ingest.requests.get")
    def test_network_errors_report_specific_reasons(self, get, _validate):
        """Lỗi chờ, SSL và kết nối được chuyển thành thông báo an toàn."""
        cases = (
            (requests.exceptions.Timeout, "Hết thời gian chờ phản hồi từ trang web nguồn (quá 30 giây)."),
            (requests.exceptions.SSLError, "Lỗi xác thực chứng chỉ SSL/TLS của trang web nguồn."),
            (requests.exceptions.ConnectionError, "Không thể kết nối đến máy chủ trang nguồn. Vui lòng kiểm tra lại URL hoặc kết nối mạng."),
        )
        for error_type, message in cases:
            with self.subTest(error=error_type.__name__):
                get.side_effect = error_type("Đường dẫn riêng tư trong lỗi gốc")
                with self.assertRaises(ValueError) as raised:
                    fetch_and_clean_url("https://example.org/law")
                self.assertEqual(str(raised.exception), message)

    def test_api_returns_400_and_logs_unexpected_error(self):
        """Endpoint trả lỗi người dùng ở mã 400 và ghi traceback cho lỗi nội bộ."""
        fake_rag = types.ModuleType("rag_pipeline")
        fake_rag.AIServiceError = type("FakeAIServiceError", (Exception,), {})
        fake_rag.LegalRAG = lambda: types.SimpleNamespace(collection=None)
        # Tránh khởi tạo ChromaDB khi chỉ kiểm tra ánh xạ lỗi của endpoint.
        with patch.dict(sys.modules, {"rag_pipeline": fake_rag}):
            api = importlib.import_module("api_server")
        message = "Trang web nguồn từ chối truy cập (403 Forbidden). Vui lòng tải file hoặc copy nội dung văn bản trực tiếp."
        request = api.IngestUrlRequest(url="https://example.org/law")
        with patch.object(api, "ingest_from_url", side_effect=ValueError(message)):
            with self.assertRaises(HTTPException) as raised:
                api.ingest_url(request)
        self.assertEqual(raised.exception.status_code, 400)
        self.assertEqual(raised.exception.detail, message)

        with patch.object(api, "ingest_from_url", side_effect=RuntimeError("Dữ liệu riêng tư")):
            with patch.object(api.logger, "exception") as log_error:
                with self.assertRaises(HTTPException) as raised:
                    api.ingest_url(request)
        self.assertEqual(raised.exception.status_code, 502)
        self.assertEqual(raised.exception.detail, "Không tải được trang nguồn công khai.")
        log_error.assert_called_once()
        self.assertNotIn("Dữ liệu riêng tư", str(log_error.call_args))

    @patch("legal.url_ingest.validate_public_url", side_effect=lambda value: value)
    @patch("legal.url_ingest.requests.get")
    @patch("legal.url_ingest.trafilatura.extract", return_value=None)
    def test_falls_back_to_article_without_navigation(self, _extract, get, _validate):
        """HTML đặc thù chỉ lấy vùng article sau khi bỏ thành phần điều hướng."""
        response = MagicMock()
        response.status_code = 200
        response.headers = {"Content-Type": "text/html"}
        response.iter_content.return_value = ["<title>Luật mẫu</title><nav>Menu</nav><article>Điều 2. Nội dung pháp luật.</article>".encode("utf-8")]
        get.return_value.__enter__.return_value = response
        text, title = fetch_and_clean_url("https://example.org/law")
        self.assertEqual((text, title), ("Điều 2. Nội dung pháp luật.", "Luật mẫu"))

    @patch("legal.url_ingest._download_public_html")
    def test_prefers_active_vietnamese_tab_and_page_heading(self, download):
        """Tab tiếng Việt được giữ lại, bản dịch ẩn không lọt vào parser."""
        download.return_value = """<html><head><title>Labor Code</title></head><body>
        <h1>Bộ luật Lao động 2019</h1>
        <div id="legal_doc_2" class="tab-pane show active"><article id="printableContent">
        <p>QUỐC HỘI</p><p>BỘ LUẬT LAO ĐỘNG</p>
        <p>Điều 1. Phạm vi điều chỉnh</p><p>Quy định về quyền và nghĩa vụ của người lao động.</p>
        <p>Điều 2. Đối tượng áp dụng</p><p>Người sử dụng lao động thực hiện đúng quy định.</p>
        </article></div>
        <div id="legal_doc_en" class="tab-pane"><p>National Assembly</p><p>Article 1. Labor Code</p></div>
        <div id="other_en" hidden><p>Article 2. Hidden translation</p></div>
        </body></html>""".encode("utf-8")
        text, title = fetch_and_clean_url("https://example.org/law")
        self.assertEqual(title, "Bộ luật Lao động 2019")
        self.assertNotIn("Article", text)
        self.assertEqual(len(parse_legal_text(text).articles), 2)
        self.assertEqual(extract_metadata_heuristic(text)["issuing_authority"], "Quốc hội")
        with patch("legal.url_ingest.auto_extract_metadata", return_value={
            "doc_title": "Bộ Luật", "issuing_authority": "Quốc hội", "doc_number": "45/2019/QH14",
            "document_type": "law", "issued_date": "2019-11-20", "scope": "public",
        }):
            metadata = build_document_metadata(text.encode("utf-8"), "web_document.txt", page_title=title)
        self.assertEqual(metadata.doc_title, "Bộ luật Lao động 2019")

    @patch("legal.url_ingest._download_public_html", return_value=b"<html><title>Labor Code</title><article>National Assembly. Article 1. Labor Code.</article></html>")
    @patch("legal.url_ingest.trafilatura.extract", return_value='{"text":"National Assembly. Article 1. Labor Code.","title":"Labor Code"}')
    def test_rejects_english_only_content(self, _extract, _download):
        """Nguồn chỉ chứa bản dịch tiếng Anh không được đưa vào ChromaDB."""
        with self.assertRaises(ValueError) as raised:
            fetch_and_clean_url("https://example.org/law")
        self.assertIn("tiếng Việt có dấu", str(raised.exception))

    @patch("legal.url_ingest.requests.get")
    def test_rejects_internal_url_before_download(self, get):
        """URL loopback bị từ chối trước khi chạm tới HTTP client."""
        with self.assertRaises(ValueError):
            fetch_and_clean_url("http://127.0.0.1/secret")
        get.assert_not_called()

    @patch("legal.url_ingest.validate_public_url", side_effect=lambda value: value)
    @patch("legal.url_ingest.requests.get")
    def test_rejects_redirect_to_internal_url(self, get, _validate):
        """Mỗi lần chuyển hướng đều phải qua bộ kiểm tra SSRF."""
        response = MagicMock()
        response.status_code = 302
        response.headers = {"Location": "http://127.0.0.1/secret"}
        get.return_value.__enter__.return_value = response
        with patch("legal.url_ingest.validate_public_url", side_effect=lambda value: value if "127.0.0.1" not in value else (_ for _ in ()).throw(ValueError("Nội bộ"))):
            with self.assertRaises(ValueError):
                fetch_and_clean_url("https://example.org/law")

    @patch("legal.url_ingest.validate_public_url", side_effect=lambda value: value)
    @patch("legal.url_ingest.fetch_and_clean_url", return_value=("Điều 1. Quy định chung\nNội dung pháp luật.", "Luật thử nghiệm"))
    @patch("legal.url_ingest.auto_extract_metadata")
    def test_url_reuses_file_pipeline(self, extract, _fetch, _validate):
        """Metadata tự động và URL nguồn được lưu vào các chunk của pipeline chung."""
        extract.return_value = {
            "doc_number": "01/2026/QH", "doc_title": "Luật thử nghiệm", "document_type": "law",
            "issuing_authority": "Quốc hội", "issued_date": "2026-01-01", "effective_status": "unknown",
            "scope": "public", "source_url": "https://congbao.chinhphu.vn",
        }
        collection = MagicMock()
        collection.get.return_value = {"ids": []}
        result = ingest_from_url("https://example.org/law", collection)
        self.assertEqual(result.status, "indexed")
        self.assertEqual(result.source_url, "https://example.org/law")
        self.assertGreater(result.chunk_count, 0)
        self.assertEqual(collection.add.call_args.kwargs["metadatas"][0]["source_url"], "https://example.org/law")
        self.assertEqual(collection.add.call_args.kwargs["metadatas"][0]["source_type"], "web")


if __name__ == "__main__":
    unittest.main()
