> Cập nhật 24/10/2026: [runbook migration và phục hồi](OPERATIONS_2026-10-24.md) là nguồn hướng dẫn cho các hành vi mới. Không chạy frontend bằng Windows.

# Runbook vận hành trên WSL2

Tất cả lệnh trong tài liệu này chạy trong **bash Ubuntu/Debian của WSL2** tại `/mnt/d/Workplace/legal-chatbot-system`. Không chạy bằng PowerShell. Không in, chia sẻ hoặc commit nội dung `.env`, JWT, API key, tài liệu nội bộ. Giữ nguyên volume `postgres_data` và thư mục `ai-core/chroma_db` khi dừng hoặc cập nhật dịch vụ.

## 1. Điều kiện tiên quyết

- WSL2 với Ubuntu 22.04 hoặc 24.04; Docker Desktop bật tích hợp cho distro WSL đang dùng; Docker Compose v2.
- Node.js 20+, npm và Python 3.10+ cùng `venv`/`pip` trong WSL. Docker tự dùng Node 20 và Python 3.11 trong image.
- Dung lượng đĩa và kết nối mạng đủ để tải dependency Python, image Docker và mô hình embedding lần đầu. Gemini chỉ hoạt động khi cấu hình khóa hợp lệ.
- Repository đã có tại `/mnt/d/Workplace/legal-chatbot-system`.

Kiểm tra công cụ mà không in biến môi trường:

```bash
cd /mnt/d/Workplace/legal-chatbot-system
node --version
python3 --version
docker compose version
```

## 2. Chuẩn bị cấu hình an toàn

```bash
cd /mnt/d/Workplace/legal-chatbot-system
cp .env.example .env
```

Mở `.env` bằng trình soạn thảo trong WSL và điền giá trị riêng của môi trường. Các trường tối thiểu cho luồng đăng nhập, nạp văn bản và hỏi đáp là `DB_PASSWORD`, `JWT_SECRET`, `ADMIN_SEED_PASSWORD`, `AI_CORE_INTERNAL_TOKEN` và `GEMINI_API_KEY`. Dùng cùng `AI_CORE_INTERNAL_TOKEN` cho Backend và AI Core. `SMTP_*` chỉ cần khi dùng OTP/email; `LEGAL_RERANKER_MODEL_PATH` để trống nếu chưa cài Cross-Encoder cục bộ. Không dùng giá trị mẫu rỗng ở môi trường vận hành. Không chạy `cat .env`, `docker compose config` không kèm `--quiet`, hoặc chia sẻ ảnh màn hình có bí mật.

### Khởi tạo PostgreSQL mới

Dùng `npm run migrate` với biến kết nối đã nạp an toàn, giữ `DB_SYNCHRONIZE=false` kể cả database mới. Runner tạo bootstrap schema và theo dõi version/checksum. Container Backend chạy migration trước khi khởi động. Xem [migration, backup/restore và rollback](OPERATIONS_2026-10-24.md); không bật synchronize để thay thế migration.

## 3. Chạy trọn gói bằng Docker Compose

```bash
cd /mnt/d/Workplace/legal-chatbot-system
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker compose logs -f
```

Thoát chế độ theo dõi log bằng `Ctrl+C`; dịch vụ vẫn chạy. Chỉ chia sẻ log sau khi đã kiểm tra và che thông tin nhạy cảm. Frontend ở `http://localhost:8080`, Backend ở `http://127.0.0.1:3000`. AI Core `:8001` **không mở ra host** trong chế độ Compose. Nginx của Frontend chuyển `/api/` tới Backend; không gọi trực tiếp `ai-core` từ trình duyệt. PostgreSQL hiện ánh xạ cổng `5432` trên host; kiểm soát tường lửa nếu máy có mạng ngoài.

Để kiểm tra tình trạng chung, dùng `docker compose ps`, sau đó `curl --fail http://127.0.0.1:3000/` nếu cần kiểm tra Backend. Trên kho rỗng, chatbot trả lời từ chối là hành vi đúng. Tài khoản `admin` chỉ được tạo nếu `ADMIN_SEED_PASSWORD` đã cấu hình trước lần khởi động Backend đầu tiên; đổi mật khẩu theo quy trình quản trị sau đăng nhập.

Khi cần dừng dịch vụ mà vẫn giữ dữ liệu:

```bash
docker compose stop
```

Không dùng `docker compose down -v`; lệnh đó xóa volume PostgreSQL. Không xóa `ai-core/chroma_db`.

## 4. Chạy phát triển cục bộ

Mọi thành phần chạy trong bash WSL, mỗi dịch vụ dùng terminal riêng. Cài dependency Node bằng npm ci trong từng thư mục backend/frontend; dùng Python venv Linux cho AI Core. Không dùng chung binary node_modules Windows và Linux.

- PostgreSQL: docker compose up -d db. Cổng host chỉ bind loopback.
- AI Core: trong ai-core, kích hoạt venv rồi chạy uvicorn api_server:app --host 127.0.0.1 --port 8001 --no-access-log.
- Backend: nạp biến môi trường an toàn (DB_HOST=localhost, AI_SERVICE_BASE_URL=http://127.0.0.1:8001), chạy npm run migrate rồi npm run start:dev.
- Frontend: trong frontend, chạy npm run dev, mở cổng Vite được thông báo (mặc định 5174). Proxy /api gọi Backend trên loopback.

Không in biến môi trường ra terminal hoặc log để kiểm tra kết nối. Dùng readiness endpoint và mã HTTP.

## 5. Nạp dữ liệu và kiểm tra

Trang `/admin/ingest` gọi API thật cho tệp, URL và text. `needs_review` cần rà soát, `indexed` là đã ghi vector và đồng bộ metadata, `partial` là còn phần metadata chưa hoàn tất. Dùng nút phục hồi hoặc `POST /legal/jobs/:id/retry`; kiểm tra `GET /legal/reconcile` khi nghi ngờ lệch kho. Scan/OCR kém không được coi là nguồn đáng tin chỉ vì đã nhận tệp. Xem [hướng dẫn vận hành mới](OPERATIONS_2026-10-24.md).

## 6. Kiểm thử và build

Sau khi cài dependency trong WSL2, chạy từ đúng thư mục. Nếu vừa chạy Frontend bằng Windows, chạy `npm ci` trong WSL trước khi build Frontend. Bộ benchmark sử dụng collection tạm, không sửa kho runtime:

```bash
cd /mnt/d/Workplace/legal-chatbot-system/ai-core
source venv/bin/activate
python3 -m unittest discover -s tests -p 'test_legal_*.py' -v
```

```bash
cd /mnt/d/Workplace/legal-chatbot-system/backend
npm test -- --runInBand
npm run build
```

```bash
cd /mnt/d/Workplace/legal-chatbot-system/frontend
npm run build
```

Lần kiểm chứng T09 ghi nhận 36 kiểm thử AI Core và 38 kiểm thử Backend. Số lượng có thể thay đổi khi bổ sung chức năng; luôn dựa vào mã thoát `0` của lệnh hiện tại.

## 7. Xử lý sự cố thường gặp

| Triệu chứng | Cách kiểm tra và xử lý |
|---|---|
| `http proxy error ECONNREFUSED 127.0.0.1:3000` ở Vite | Backend chưa chạy hoặc chưa nghe cổng 3000; khởi động PostgreSQL và Backend trước, sau đó tải lại Frontend. |
| Backend không kết nối PostgreSQL | Kiểm tra `docker compose ps`, `DB_HOST=127.0.0.1` khi chạy local, `DB_HOST=db` trong Compose và các trường DB trong `.env`. Không in mật khẩu để chẩn đoán. |
| Không đăng nhập được tài khoản quản trị mới | Kiểm tra đã cấu hình `ADMIN_SEED_PASSWORD` trước lần Backend đầu tiên, bảng đã được tạo, rồi xem log đã che dữ liệu nhạy cảm. Nếu tài khoản đã tồn tại, biến seed không ghi đè mật khẩu. |
| Chat trả từ chối | Kiểm tra collection có chunk `public`, metadata Điều/Khoản đúng và văn bản có căn cứ. Từ chối là đúng khi không có nguồn. |
| Chat báo dịch vụ chưa sẵn sàng | Kiểm tra AI Core hoạt động, `AI_SERVICE_BASE_URL` đúng môi trường và khóa Gemini được cấu hình. Không in khóa ra terminal. |
| Nạp trả `needs_review` hoặc `chunk_count=0` | Kiểm tra lớp văn bản PDF/OCR, định dạng dòng Điều/Khoản và metadata; chuẩn hóa tệp rồi nạp lại. |
| Nạp URL hoặc text trả `501` | Đây là giới hạn chức năng hiện tại; dùng tệp qua `POST /legal/ingest`. |

## 8. Ranh giới vận hành

Không công bố cổng AI Core hoặc token nội bộ. Không để `DB_SYNCHRONIZE=true` sau khởi tạo. Chỉ đánh dấu một văn bản còn hiệu lực sau khi đã đối chiếu nguồn pháp lý và phiên bản áp dụng. Đối với sao lưu và khôi phục, lập quy trình riêng cho PostgreSQL và `ai-core/chroma_db`; runbook này không thực hiện thao tác xóa hoặc làm sạch dữ liệu runtime.
