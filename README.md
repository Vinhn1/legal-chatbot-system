# Legal Chatbot System

**Hệ thống Cổng Tra cứu & Trợ lý Pháp luật Việt Nam - Veritas Legal**

Legal Chatbot System hỗ trợ tìm văn bản pháp luật Việt Nam, đối chiếu nguyên văn Điều/Khoản và giải thích câu hỏi dựa trên nguồn đã nạp. Luồng RAG gồm bốn chặng: kiểm tra nguồn, tách cấu trúc pháp lý, lập chỉ mục, truy xuất và sinh câu trả lời có cấu trúc. Backend đọc lại metadata và nội dung chunk từ ChromaDB để xác minh từng trích dẫn trước khi trả về giao diện. Khi thiếu căn cứ, hệ thống từ chối trả lời thay vì tự suy diễn.

## Kiến trúc tổng quan

| Tầng | Thành phần | Trách nhiệm |
|---|---|---|
| Giao diện | React, Vite, Veritas Legal | Cổng tra cứu công khai, xem nguồn trích dẫn, không gian quản trị |
| Điều phối | NestJS, PostgreSQL | Xác thực và phân quyền, giới hạn tần suất, lịch sử chat, kiểm chứng trích dẫn |
| Trí tuệ | FastAPI, ChromaDB, Gemini | Nạp và tách văn bản, tìm kiếm BM25/vector, RRF, tùy chọn xếp hạng lại, tạo JSON câu trả lời |

AI Core chỉ nằm trên mạng Docker nội bộ. Backend là đầu mối gọi AI Core và PostgreSQL. Trích dẫn công khai chỉ được phát hành khi số hiệu, Điều, Khoản và đoạn nguyên văn khớp với chunk đã lưu. Xem [kiến trúc chi tiết](docs/ARCHITECTURE.md) để biết luồng dữ liệu và ranh giới bảo mật.

## Khởi chạy nhanh trong WSL2

Yêu cầu Ubuntu/Debian trên WSL2, Docker Desktop đã bật tích hợp WSL, Docker Compose v2. Mọi lệnh dưới đây chạy trong **bash của WSL2** tại thư mục dự án.

```bash
cd /mnt/d/Workplace/legal-chatbot-system
cp .env.example .env
```

Điền các giá trị riêng của môi trường vào `.env` trên máy vận hành, tối thiểu `DB_PASSWORD`, `JWT_SECRET`, `ADMIN_SEED_PASSWORD`, `AI_CORE_INTERNAL_TOKEN` và `GEMINI_API_KEY`. Không đưa `.env` vào Git hoặc chia sẻ nội dung qua log. Giữ `DB_SYNCHRONIZE=false`. Container Backend chạy migration có version/checksum trước khi mở dịch vụ; database cũ và mới dùng cùng runner. `JWT_SECRET` phải có ít nhất 32 ký tự. Xem [runbook cập nhật](docs/OPERATIONS_2026-10-24.md) trước khi nâng cấp dữ liệu hiện có.

```bash
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

Truy cập giao diện tại `http://localhost:8080`. Backend chỉ mở tại `127.0.0.1:3000` trên host; AI Core cổng `8001` chỉ truy cập được từ mạng Docker nội bộ. Tài khoản quản trị ban đầu là `admin` với mật khẩu đã đặt qua `ADMIN_SEED_PASSWORD` khi cơ sở dữ liệu chưa có tài khoản đó. Nếu kho pháp luật rỗng, chatbot từ chối trả lời; hãy nạp văn bản trước khi đánh giá câu trả lời.

## Phát triển cục bộ

Yêu cầu Node.js 20+, npm và Python 3.12 trong WSL. Mở các terminal bash WSL riêng cho PostgreSQL, AI Core, Backend và Frontend:

```bash
cd /mnt/d/Workplace/legal-chatbot-system
docker compose up -d db
```

```bash
cd /mnt/d/Workplace/legal-chatbot-system/ai-core
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn api_server:app --host 127.0.0.1 --port 8001 --no-access-log
```

```bash
cd /mnt/d/Workplace/legal-chatbot-system/backend
npm ci
npm run start:dev
```

Frontend chạy trong bash WSL:

```bash
cd /mnt/d/Workplace/legal-chatbot-system/frontend
npm ci
npm run dev
```

Không dùng chung binary trong node_modules giữa Windows và Linux. Backend cục bộ dùng DB_HOST=localhost, AI_SERVICE_BASE_URL=http://127.0.0.1:8001 và token nội bộ giống AI Core. Nạp biến môi trường bằng cơ chế riêng an toàn của máy vận hành trước khi chạy npm run migrate.

## Nạp và quản trị nguồn

Trang /admin/ingest gọi API thật cho PDF/DOCX/TXT (tối đa 15 MB), URL công khai và văn bản dán. Metadata có thể tự nhận diện hoặc sửa trước khi xác nhận. needs_review yêu cầu rà soát; indexed chỉ xác nhận đã lập chỉ mục, không xác nhận độ đúng pháp lý. partial nghĩa là vector đã ghi nhưng PostgreSQL chưa đồng bộ; dùng mã công việc và nút phục hồi metadata. Công việc có thể đọc tại GET /legal/jobs và retry tại POST /legal/jobs/:id/retry. Xóa tài liệu dùng ID ổn định và chỉ báo thành công khi xử lý đủ hai kho.

## Kiểm chứng

Các lệnh sau chạy trong bash WSL2:

```bash
cd /mnt/d/Workplace/legal-chatbot-system/ai-core
PYTHON_DOTENV_DISABLED=1 venv/bin/python -m unittest discover -s tests -p 'test_legal_*.py' -v
```

```bash
cd /mnt/d/Workplace/legal-chatbot-system/backend
npm run lint:ci
npm test -- --runInBand
npm run build
```

```bash
cd /mnt/d/Workplace/legal-chatbot-system/frontend
npm run lint
npm run build
```

Benchmark 20 câu hỏi và tám kịch bản dùng collection ChromaDB tạm cùng mô hình giả lập; kết quả này không chứng minh độ chính xác pháp lý trên kho vận hành. Xem [kế hoạch và kết quả kiểm chứng](docs/IMPLEMENTATION_PLAN.md).

## Tài liệu

- [Kiến trúc và ranh giới an toàn](docs/ARCHITECTURE.md)
- [Cẩm nang vận hành WSL2 và Docker](docs/WSL_RUNBOOK.md)
- [Chuẩn bị, nạp và kiểm tra văn bản pháp luật](docs/DATA_INGEST_GUIDE.md)
- [Kế hoạch triển khai và tiến độ](docs/IMPLEMENTATION_PLAN.md)

- [Migration, phục hồi hai kho, health và rollback](docs/OPERATIONS_2026-10-24.md)
