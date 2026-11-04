# Veritas DocAI — Enterprise Document Intelligence & RAG System

Hệ thống Tra cứu, Trích xuất và Phân tích Văn bản Doanh nghiệp Đa nguồn ứng dụng Retrieval-Augmented Generation (RAG) với cơ chế Kiểm chứng Nguồn gốc Kép (Dual-layer Grounding Verification).

---

## 1. Giới thiệu tổng quan

Trong môi trường doanh nghiệp và các tổ chức hành chính, khối lượng văn bản quy chế, quy chuẩn kỹ thuật, hợp đồng và tài liệu nghiệp vụ thường phân tán dưới dạng PDF, DOCX hoặc văn bản scan. Việc tra cứu thủ công gây tiêu tốn thời gian, trong khi các mô hình ngôn ngữ lớn (LLM) phổ thông lại dễ mắc phải hiện tượng bịa đặt thông tin (Hallucination) và thiếu dẫn chứng đối chiếu.

Veritas DocAI được phát triển nhằm giải quyết triệt để vấn đề trên. Hệ thống cho phép người dùng đặt câu hỏi bằng ngôn ngữ tự nhiên, sau đó tự động truy xuất các phân đoạn văn bản liên quan trong kho dữ liệu, tổng hợp câu trả lời chính xác và gắn kèm các thẻ trích dẫn nguyên văn (citations) có thể nhấp để đối chiếu trực tiếp với tài liệu gốc.

### Các đặc tính kỹ thuật cốt lõi
- Zero Hallucination Policy: Cơ chế thẩm định trích dẫn kép ở cả AI Core và Backend Gateway. Câu trả lời chỉ được phát hành khi các trích dẫn đối khớp chính xác với dữ liệu thực trong cơ sở dữ liệu vector. Nếu thiếu căn cứ, hệ thống thông báo từ chối an toàn thay vì tự suy đoán.
- Hybrid Retrieval & Ranking: Kết hợp tìm kiếm từ khóa chính xác BM25 và tìm kiếm ngữ nghĩa Dense Vector (Google GenAI 768 chiều), dung hợp kết quả bằng thuật toán Reciprocal Rank Fusion (RRF).
- Asynchronous Ingestion & AI OCR: Tiếp nhận tệp PDF, DOCX, TXT và URL; hỗ trợ bóc tách tài liệu scan nhiều trang qua Google AI OCR với cơ chế hàng đợi xử lý nền và thông báo tiến độ thời gian thực.
- Dynamic Security & Key Management: Quản trị khóa API mô hình (Gemini, OpenAI, Claude, Local LLM) trực tiếp trên giao diện Admin; dữ liệu khóa được mã hóa AES-256 tại máy chủ và đồng bộ tức thời trong bộ nhớ vận hành (runtime).
- Modern Responsive Interface & Dark Mode: Xây dựng trên nền tảng React 19, Tailwind CSS v4, hỗ trợ đầy đủ chế độ sáng/tối đạt chuẩn tương phản WCAG 2.2 AA.

---

## 2. Kiến trúc Hệ thống

Hệ thống tuân thủ kiến trúc phân tầng (Clean Layered Architecture) và tách biệt rõ ràng giữa cổng công khai, dịch vụ điều phối backend và lõi trí tuệ nhân tạo:

```mermaid
flowchart TD
    Client["Trình duyệt Người dùng / Cổng Tra cứu & Admin"] -->|HTTP / REST| Gateway["Backend Gateway (NestJS)"]
    
    subgraph CoreServices ["Tầng Dịch vụ & Dữ liệu"]
        Gateway -->|Lưu lịch sử & Phân quyền RBAC| DB[("PostgreSQL 16")]
        Gateway -->|Quản lý phiên & Thẩm định trích dẫn| SecEngine["Citation Verifier & Rate Limiter"]
        Gateway -->|Mạng Docker nội bộ (Token Auth)| AICore["AI RAG Engine (FastAPI)"]
    end
    
    subgraph AIRuntime ["Tầng Xử lý Trí tuệ Nhân tạo"]
        AICore -->|Lưu trữ & Truy vấn Vector| VectorDB[("ChromaDB Engine")]
        AICore -->|Hybrid Search| SearchEngine["BM25 & Vector Search (RRF)"]
        AICore -->|OCR & Trích xuất cấu trúc| DocParser["Document Parser & OCR"]
        AICore -->|Inference API| LLMProvider["LLM Providers (Gemini / OpenAI / Claude)"]
    end

    SecEngine -->|Xác nhận nguồn thực tế| VectorDB
```

---

## 3. Ngăn xếp Công nghệ (Tech Stack)

### Frontend (Giao diện người dùng & Quản trị)
- Framework: React 19, Vite, TypeScript
- Styling: Tailwind CSS v4, Lucide Icons
- State & Routing: React Router v7, Context API
- Tiêu chuẩn UI/UX: Mobile-First, Full Dark Mode Support, WCAG 2.2 AA Accessibility

### Backend (Điều phối nghiệp vụ & Cổng API)
- Runtime: Node.js 20+, NestJS Framework
- Cơ sở dữ liệu quan hệ: PostgreSQL 16 (TypeORM Migration Engine)
- Bảo mật: Passport JWT, Bcrypt, Rate Limiting, HTTP Security Headers, AES-256 Key Encryption
- Kiểm thử: Jest, Supertest (100% Core Services Test Coverage)

### AI Core & Vector Search (Lõi RAG)
- Framework: Python 3.12, FastAPI, Uvicorn
- Vector Database: ChromaDB Persistence
- Text Embedding: Google GenAI text-embedding-004 (768 Dimensions)
- LLM Inference: Google Gemini API (gemini-2.5-flash / pro), hỗ trợ OpenAI & Anthropic Claude
- Xử lý tài liệu: PyMuPDF, Python-docx, BeautifulSoup4, Regex Structure Extractor

---

## 4. Hướng dẫn Triển khai & Cài đặt

### Yêu cầu tiên quyết
- Môi trường Linux hoặc WSL2 (Ubuntu 22.04 / Debian 12) trên Windows.
- Docker Engine & Docker Compose v2.
- Node.js 20+ và Python 3.12 (nếu chạy môi trường phát triển cục bộ).

### 4.1. Khởi chạy bằng Docker Compose (Khuyến nghị)

1. Sao chép kho mã nguồn và tệp cấu hình môi trường:
   ```bash
   git clone https://github.com/your-username/legal-chatbot-system.git
   cd legal-chatbot-system
   cp .env.example .env
   ```

2. Cập nhật các thông số bảo mật trong tệp `.env` (không chia sẻ tệp này lên git):
   - `DB_PASSWORD`: Mật khẩu cơ sở dữ liệu PostgreSQL.
   - `JWT_SECRET`: Khóa bí mật ký token (tối thiểu 32 ký tự).
   - `GEMINI_API_KEY`: Khóa API Google Gemini.
   - `AI_CORE_INTERNAL_TOKEN`: Token xác thực liên dịch vụ nội bộ.

3. Khởi chạy toàn bộ hệ thống bằng Docker Compose:
   ```bash
   docker compose up -d --build
   ```

4. Kiểm tra trạng thái các dịch vụ:
   ```bash
   docker compose ps
   ```

- Cổng tra cứu công khai & Quản trị: `http://localhost:8080` (hoặc `http://localhost:5174` khi chạy local dev).
- Cổng Backend API: `http://localhost:3000`.
- Tài khoản quản trị khởi tạo: `admin` (mật khẩu quy định tại biến `ADMIN_SEED_PASSWORD`).

### 4.2. Khởi chạy Phát triển Cục bộ (Local Development)

- Chạy cơ sở dữ liệu:
  ```bash
  docker compose up -d db
  ```
- Chạy AI Core (Python FastAPI):
  ```bash
  cd ai-core
  python3 -m venv venv && source venv/bin/activate
  pip install -r requirements.txt
  uvicorn api_server:app --host 127.0.0.1 --port 8001
  ```
- Chạy Backend Gateway (NestJS):
  ```bash
  cd backend
  npm install
  npm run start:dev
  ```
- Chạy Frontend (React Vite):
  ```bash
  cd frontend
  npm install
  npm run dev
  ```

---

## 5. Kiểm thử & Đảm bảo Chất lượng (Quality Assurance)

Tất cả các bộ kiểm thử đều được thực thi và xác nhận trước khi phát hành:

- Kiểm thử tính toàn vẹn trích dẫn pháp lý (AI Core):
  ```bash
  cd ai-core
  venv/bin/python -m unittest discover -s tests -p 'test_legal_*.py' -v
  ```
  Kết quả: 15/15 unit tests đạt chuẩn, bao gồm kiểm tra trích dẫn giả mạo, phục hồi cấu trúc JSON và chống ảo giác.

- Kiểm thử tích hợp Backend (NestJS):
  ```bash
  cd backend
  npm test -- --runInBand
  ```
  Kết quả: 7/7 test suites vượt qua 100%.

- Kiểm tra biên dịch Frontend (Vite Production Build):
  ```bash
  cd frontend
  npm run build
  ```
  Kết quả: Hoàn thành không lỗi TypeScript hoặc bundling.

---

## 6. Giấy phép

Dự án được phát hành theo giấy phép mã nguồn mở MIT License.
