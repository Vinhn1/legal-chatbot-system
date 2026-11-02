# Hướng dẫn chuẩn bị và nạp văn bản pháp luật

## 1. Chuẩn bị nguồn

Chỉ nạp văn bản có nguồn và phiên bản đã được quản trị viên đối chiếu. Lưu số hiệu, cơ quan ban hành, ngày ban hành, ngày có hiệu lực, tình trạng hiệu lực tại thời điểm nạp và URL nguồn chính thức. Khi một Điều/Khoản bị sửa đổi, xác định rõ văn bản sửa đổi và mốc áp dụng trước khi gắn nhãn `active` hay `partially_expired`; không suy ra trạng thái từ tên tệp.

Tệp hỗ trợ là **PDF, DOCX, TXT**, tối đa **15 MB/tệp**. PDF cần có lớp văn bản trích xuất được; bản scan hoặc OCR lỗi sẽ nhận `needs_review` và không được lập chỉ mục. TXT dùng UTF-8. DOCX cần cấu trúc OOXML hợp lệ. Tên tệp nên dùng số hiệu, năm và loại văn bản, ví dụ `luat-mau-01-2026-qh.txt`; không dùng đường dẫn, `../` hoặc ký tự điều khiển. Bộ kiểm tra đọc magic bytes thực tế và làm sạch tên tệp.

Để parser nhận Điều/Khoản ổn định, giữ các tiêu đề trên dòng riêng theo thứ tự văn bản, ví dụ:

```text
Chương I. QUY ĐỊNH CHUNG
Điều 1. Phạm vi điều chỉnh
1. Nội dung Khoản thứ nhất của văn bản mẫu.
2. Nội dung Khoản thứ hai của văn bản mẫu.
a) Nội dung Điểm thứ nhất.
```

Đoạn trên chỉ là dữ liệu giả lập để kiểm tra pipeline, không phải quy phạm pháp luật thật.

## 2. Metadata cần cung cấp

Tên trường nghiệp vụ trong quy trình và tên trường **API thực tế** khác nhau ở một số chỗ:

| Nghiệp vụ | Trường gửi `POST /legal/ingest` | Yêu cầu |
|---|---|---|
| Số hiệu | `doc_number` | Bắt buộc, ví dụ `01/2026/QH` cho văn bản mẫu |
| Tên văn bản | `doc_title` | Bắt buộc; trường `title` không được API chấp nhận |
| Cơ quan ban hành | `issuing_authority` | Bắt buộc; trường `issuer` không được API chấp nhận |
| Ngày ban hành | `issued_date` | Bắt buộc, ISO `YYYY-MM-DD`; không dùng `issue_date` |
| Ngày có hiệu lực | `effective_date` | Điền khi đã kiểm chứng, ISO `YYYY-MM-DD` |
| Tình trạng hiệu lực | `effective_status` | `active`, `expired`, `partially_expired`, `unknown` |
| Phạm vi truy cập | `scope` | `public` hoặc `internal`; mặc định API là `internal` |
| Loại văn bản | `document_type` | Bắt buộc: `law`, `resolution`, `decree`, `circular` |
| Địa chỉ nguồn | `source_url` | Bắt buộc, chuỗi không rỗng |
| Ngày hết hiệu lực | `expiry_date` | Tùy chọn, ISO `YYYY-MM-DD` |
| Ngày bắt đầu trạng thái mới | `status_since_date` | Tùy chọn, ISO `YYYY-MM-DD` |

Nhãn nghiệp vụ `con_hieu_luc`, `het_hieu_luc`, `sua_doi_bo_sung` tương ứng với giá trị API `active`, `expired`, `partially_expired`. Nếu chưa xác minh được hiệu lực, dùng `unknown`; không gắn `active` theo suy đoán. `source_url` là đường dẫn để người dùng đối chiếu, không có nghĩa hệ thống đã tự tải tài liệu từ URL đó. Một `doc_id` UUID được tạo tự động nếu không khai báo.

## 3. Phương thức nạp hiện khả dụng

Trang `/admin/ingest` hiển thị ba lựa chọn tệp, URL và dán văn bản, nhưng hiện **chỉ mô phỏng tiến trình bằng bộ đếm thời gian**. Nút trên trang không gửi dữ liệu đến Backend, vì vậy thông báo thành công của trang không chứng minh có chunk trong ChromaDB. Luồng nạp tệp thực tế là **`POST /legal/ingest`**, yêu cầu JWT `admin`, multipart `file` và `metadata` chứa JSON. Backend chuyển tệp sang AI Core qua token nội bộ; quản trị viên không cần gọi trực tiếp AI Core.

Ví dụ dùng một tệp mẫu công khai không chứa dữ liệu nhạy cảm. Tạo `/tmp/luat-mau.txt` bằng nội dung mẫu ở mục 1, rồi tạo metadata:

```bash
cat > /tmp/legal-metadata.json <<'JSON'
{
  "doc_number": "01/2026/QH",
  "doc_title": "Văn bản mẫu phục vụ kiểm tra",
  "document_type": "law",
  "issuing_authority": "Cơ quan mẫu",
  "issued_date": "2026-01-01",
  "effective_date": "2026-02-01",
  "effective_status": "active",
  "source_url": "https://example.org/van-ban-mau",
  "scope": "public"
}
JSON
```

Trong bash WSL2, nhập JWT quản trị vào biến phiên làm việc mà không hiện ký tự trên màn hình. Không ghi token vào tài liệu hay log. Có thể lấy JWT qua luồng đăng nhập quản trị đang hoạt động:

```bash
read -r -s -p 'JWT quản trị: ' ADMIN_JWT
printf '\n'
curl --silent --show-error --fail-with-body \
  -H "Authorization: Bearer ${ADMIN_JWT}" \
  -F 'file=@/tmp/luat-mau.txt' \
  -F 'metadata=</tmp/legal-metadata.json' \
  http://127.0.0.1:3000/legal/ingest \
  --output /tmp/legal-ingest-result.json
```

Chỉ xem các trường trạng thái, số chunk và cờ rà soát; tránh in nội dung tài liệu hoặc token:

```bash
python3 - <<'PY'
import json

with open("/tmp/legal-ingest-result.json", encoding="utf-8") as result_file:
    result = json.load(result_file)
for key in ("status", "structure_status", "needs_review", "chunk_count", "article_count", "warnings"):
    print(key, result.get(key))
PY
```

`status=indexed` cùng `chunk_count>0` nghĩa là đã ghi chunk; `duplicate` nghĩa là nội dung trùng băm; `needs_review` nghĩa là chưa lập chỉ mục. Khi có `needs_review`, sửa cấu trúc hoặc OCR của tệp nguồn rồi nạp lại. Không coi phản hồi HTTP thành công là bằng chứng duy nhất; luôn kiểm tra ChromaDB.

## 4. Kiểm tra chunk trong ChromaDB

Chạy trong môi trường Python của AI Core ở bash WSL2. Câu lệnh chỉ in số lượng và định danh cấu trúc, không in nguyên văn:

```bash
cd /mnt/d/Workplace/legal-chatbot-system/ai-core
source venv/bin/activate
python3 - <<'PY'
import chromadb

collection = chromadb.PersistentClient(path="chroma_db").get_collection("legal_documents")
result = collection.get(where={"doc_number": "01/2026/QH"}, include=["metadatas"])
print("Số chunk:", len(result["ids"]))
for metadata in result["metadatas"]:
    print(metadata.get("article_number"), metadata.get("clause_number"), metadata.get("scope"))
PY
```

Nếu không có chunk, kiểm tra `status`, `needs_review`, định dạng tệp, số hiệu truy vấn và đúng đường dẫn ChromaDB. Trong Docker, collection nằm tại `/app/chroma_db`, được bind với `ai-core/chroma_db` trên host. Không xóa thư mục này hoặc volume PostgreSQL để xử lý lỗi nạp. Endpoint `GET /chat/public-summary` cho phép kiểm tra số văn bản/Điều công khai ở mức tổng hợp; nó không thay thế việc đối chiếu từng chunk.

## 5. URL và văn bản trực tiếp

Các route nạp URL và HTML hiện kiểm tra hoặc tiếp nhận đầu vào nhưng **chưa hoàn tất bước lập chỉ mục**, có thể trả `501`. Không dùng chúng cho quy trình vận hành và không báo đã nạp chỉ vì URL qua được bộ lọc SSRF. Khi có nguồn web, tải và kiểm tra văn bản theo quy trình của tổ chức, chuyển thành PDF/DOCX/TXT hợp lệ rồi nạp qua `POST /legal/ingest`.
