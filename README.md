# Veritas DocAI — Enterprise Document Intelligence & Legal RAG Platform

> Hệ thống Tra cứu, Bóc tách và Phân tích Văn bản Doanh nghiệp ứng dụng Retrieval-Augmented Generation (RAG) với cơ chế Thẩm định Nguồn kép (Dual-layer Grounding Verification).

[![Production Status](https://img.shields.io/badge/Status-Live%20Production-success?style=flat-square)](http://13.54.34.84/)
[![Demo Accounts](https://img.shields.io/badge/Demo-1--Click%20Login-blue?style=flat-square)](http://13.54.34.84/demo-accounts)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-Compose%20v2-2496ED?style=flat-square&logo=docker&logoColor=white)](docker-compose.yml)
[![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?style=flat-square&logo=node.js&logoColor=white)](backend/package.json)
[![NestJS](https://img.shields.io/badge/NestJS-10.x-E0234E?style=flat-square&logo=nestjs&logoColor=white)](backend/package.json)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python&logoColor=white)](ai-core/requirements.txt)
[![React](https://img.shields.io/badge/React-19.x-61DAFB?style=flat-square&logo=react&logoColor=black)](frontend/package.json)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4.0-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](frontend/package.json)

---

## Trải nghiệm Trực tiếp (Live Demo & Quick Access)

Hệ thống hiện đã được triển khai hoàn chỉnh và đang vận hành trực tuyến trên hạ tầng điện toán đám mây **AWS Cloud (EC2)**:

| Cổng dịch vụ | Đường dẫn truy cập trực tiếp | Mục đích sử dụng |
| :--- | :--- | :--- |
| **Cổng tra cứu công khai** | [http://13.54.34.84/](http://13.54.34.84/) | Dành cho người dùng cuối tra cứu thông tin, hỏi đáp tự nhiên và đối chiếu văn bản gốc. |
| **Tài khoản dùng thử (1-Click)** | [http://13.54.34.84/demo-accounts](http://13.54.34.84/demo-accounts) | Trải nghiệm tức thì các vai trò mà không cần đăng ký hay nhập mật khẩu. |
| **Cổng Quản trị viên (Admin)** | [http://13.54.34.84/admin](http://13.54.34.84/admin) | Bảng điều khiển quản lý tài liệu, nạp dữ liệu đa nguồn, kiểm duyệt và cấu hình AI. |

### Các vai trò trải nghiệm có sẵn tại `/demo-accounts`:
- **Quản trị viên (Admin):** Toàn quyền kiểm soát kho dữ liệu, nạp file/văn bản/URL, cấu hình tham số AI (Temperature, Top-K, Chunks, API Keys) và quản lý người dùng.
- **Biên tập viên (Staff):** Truy cập thẳng vào quy trình nạp tài liệu (`/admin/ingest`), kiểm duyệt phân đoạn (chunks) và thử nghiệm đối chiếu câu trả lời.
- **Khách tra cứu (Viewer):** Trải nghiệm giao diện tìm kiếm thông minh, nhận câu trả lời kèm thẻ trích dẫn chính xác và mở xem nguyên văn ngữ cảnh.

---

## 1. Giới thiệu Bài toán & Giải pháp

Trong môi trường doanh nghiệp, tổ chức pháp lý và cơ quan hành chính, khối lượng văn bản quy chế, điều lệ, hợp đồng và tiêu chuẩn kỹ thuật thường phân tán dưới dạng PDF, DOCX hoặc tài liệu scan. Việc tra cứu thủ công gây tiêu tốn thời gian, trong khi các mô hình ngôn ngữ lớn (LLM) thông thường dễ gặp lỗi **ảo giác (hallucination)** và không thể chỉ ra chính xác số hiệu, điều khoản hay trang văn bản làm căn cứ.

**Veritas DocAI** giải quyết triệt để bài toán này bằng kiến trúc **Legal RAG (Retrieval-Augmented Generation)** tiên tiến:
1. Tiếp nhận tài liệu từ nhiều định dạng (PDF văn bản số, PDF scan dạng ảnh, DOCX, TXT hoặc URL trang web).
2. Tự động bóc tách phân đoạn (chunking) theo cấu trúc ngữ nghĩa (Chương, Điều, Khoản, Mục).
3. Đánh chỉ mục kết hợp (Hybrid Indexing: BM25 + Dense Semantic Vector).
4. Thẩm định trích dẫn kép độc lập (Dual-layer Grounding): Nếu câu trả lời không có căn cứ xác thực trong kho dữ liệu, hệ thống thông báo từ chối an toàn thay vì tự suy đoán.

---

## 2. Đặc tính Kỹ thuật Nổi bật

- **Chính sách Chống ảo giác Tuyệt đối (Zero Hallucination Policy):**
  Mỗi câu trả lời do LLM sinh ra đều bắt buộc đi kèm danh sách trích dẫn (`citations`). Lớp Backend Gateway độc lập đọc lại trực tiếp từ ChromaDB để xác thực nội dung trích dẫn. Nếu phát hiện trích dẫn sai lệch hoặc không tồn tại, toàn bộ câu trả lời sẽ bị từ chối phát hành nhằm bảo đảm độ tin cậy tuyệt đối.

- **Truy xuất Lai Kết hợp Tái xếp hạng (Multi-Query Hybrid RRF):**
  Kết hợp thuật toán tìm kiếm từ khóa chính xác BM25 và tìm kiếm vector ngữ nghĩa (Google GenAI 768 chiều), dung hợp kết quả bằng thuật toán Reciprocal Rank Fusion (RRF). Hỗ trợ xếp hạng lại (reranking) để ưu tiên các điều khoản trọng tâm.

- **Nạp Dữ liệu Đa nguồn & Xử lý OCR Đa luồng (Smart Ingestion Pipeline):**
  - Hỗ trợ tải tệp PDF, Word (.docx), văn bản thuần (.txt) và liên kết trang web (URL).
  - Tích hợp công nghệ nhận diện quang học AI OCR để xử lý các tệp PDF scan hình ảnh.
  - Xử lý bất đồng bộ trong nền với hàng đợi kiểm tra tiến độ, không làm nghẽn giao diện người dùng.

- **Bảo mật Đa tầng & Quản lý Khóa Động (Dynamic Model & Key Management):**
  - Cho phép quản trị viên thay đổi nhà cung cấp AI (Google Gemini, OpenAI GPT, Anthropic Claude, Local LLM/vLLM) ngay trên giao diện web.
  - Các khóa API được mã hóa bằng thuật toán AES-256-GCM tại tầng máy chủ trước khi lưu vào PostgreSQL.
  - Cơ chế Hot-reload runtime tự động đồng bộ khóa nhúng sang bộ nhớ AI Core mà không cần khởi động lại container hay sửa file `.env`.
  - Hỗ trợ bảo mật 2 lớp (2FA OTP qua Email) cho tài khoản quản trị.

- **Giao diện Tiêu chuẩn Doanh nghiệp & Accessibility (Modern UI/UX):**
  - Phát triển trên React 19 và Tailwind CSS v4, tối ưu hóa kích thước gói tải (bundle size < 250 KB gzip).
  - Hỗ trợ toàn diện chế độ Giao diện Sáng / Tối (Light & Dark Theme).
  - Đạt tiêu chuẩn tương phản và khả năng tiếp cận WCAG 2.2 AA.

---

## 3. Kiến trúc Hệ thống (System Architecture)

Hệ thống được thiết kế theo mô hình Clean Architecture đa tầng, phân tách ranh giới rõ ràng giữa cổng công khai, dịch vụ điều phối và lõi trí tuệ nhân tạo:

```mermaid
flowchart TD
    Client["Trình duyệt Người dùng (Client Browser)"] -->|HTTP :80| Nginx["Nginx Reverse Proxy (Frontend Container)"]
    
    subgraph FrontendApp ["Tầng Trình bày (React 19 + Tailwind v4)"]
        Nginx -->|Phục vụ Static Assets| SPA["Single Page Application"]
        Nginx -->|Chuyển tiếp /api/*| Gateway
    end

    subgraph BackendApp ["Tầng Điều phối Nghiệp vụ (NestJS Gateway)"]
        Gateway["NestJS API Gateway (:3000)"]
        Gateway -->|Quản lý phiên, RBAC & Lịch sử| DB[("PostgreSQL 16")]
        Gateway -->|Xác minh Trích dẫn Độc lập| Verifier["Citation Grounding Verifier"]
        Gateway -->|Mã hóa AES-256| SecretStore["Encrypted Model Key Store"]
    end

    subgraph AICoreApp ["Tầng Lõi Trí tuệ Nhân tạo (Python FastAPI :8001)"]
        AICore["FastAPI RAG Engine"]
        Gateway -->|Mạng Docker Nội bộ (X-Internal-Token)| AICore
        AICore -->|Hybrid Search| HybridRetriever["BM25 & Semantic Search (RRF)"]
        AICore -->|Lưu trữ & Truy vấn Vector| Chroma[("ChromaDB Vector Store")]
        AICore -->|Bóc tách cấu trúc & AI OCR| IngestEngine["Document Ingestion Engine"]
        AICore -->|Inference Gọi LLM| LLM["Google Gemini / OpenAI / Claude"]
    end

    Verifier -.->|Đọc lại nguyên văn kiểm chứng| Chroma
```

---

## 4. Ngăn xếp Công nghệ (Technology Stack)

| Thành phần | Công nghệ chủ đạo | Vai trò kỹ thuật |
| :--- | :--- | :--- |
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS v4 | Giao diện Single Page Application, hỗ trợ responsive di động và Dark mode |
| **UI Components** | Lucide React, Custom Accessibility Primitives | Thư viện biểu tượng vector và thành phần giao diện đạt chuẩn WCAG 2.2 AA |
| **Backend Gateway** | Node.js 20, NestJS 10, TypeORM, Express | Điều phối API, phân quyền vai trò (RBAC), bảo vệ rate limit, quản lý phiên chat |
| **Cơ sở dữ liệu** | PostgreSQL 16 (Alpine) | Lưu trữ người dùng, quyền hạn, lịch sử hội thoại, đánh giá audit và cấu hình |
| **Lõi AI (AI Core)** | Python 3.11+, FastAPI, Uvicorn | Xử lý pipeline RAG, tạo gợi ý câu hỏi, điều phối OCR và chuẩn hóa prompt |
| **Vector Database** | ChromaDB Persistent Storage | Lưu trữ và tìm kiếm vector nhúng ngữ nghĩa của các phân đoạn văn bản |
| **Embeddings & LLM** | Google GenAI Embedding, Gemini 2.5 Flash / Pro, GPT-4o | Tạo vector 768 chiều và tổng hợp câu trả lời có cấu trúc JSON |
| **Xử lý tài liệu** | PyMuPDF, python-docx, BeautifulSoup4, LlamaParse | Bóc tách văn bản, trích xuất cấu trúc văn bản pháp lý theo Điều/Khoản |
| **Reverse Proxy** | Nginx Alpine | Cân bằng tải, nén gzip, quản lý bộ nhớ đệm tĩnh và proxy bảo mật |
| **Hạ tầng Cloud** | Docker, Docker Compose v2, AWS EC2 (Ubuntu 26.04) | Đóng gói container hóa toàn diện, triển khai 1-lệnh trên môi trường cloud |

---

## 5. Hướng dẫn Cài đặt & Triển khai Cục bộ

### Yêu cầu môi trường
- Hệ điều hành: Linux, macOS hoặc Windows (WSL2 Ubuntu/Debian).
- Docker Engine 24+ và Docker Compose v2.
- (Tùy chọn cho local dev): Node.js 20+ và Python 3.11+.

### 5.1. Khởi chạy nhanh bằng Docker Compose

1. **Sao chép mã nguồn:**
   ```bash
   git clone https://github.com/Vinhn1/legal-chatbot-system.git
   cd legal-chatbot-system
   ```

2. **Cấu hình tệp biến môi trường `.env`:**
   ```bash
   cp .env.example .env
   ```
   *Mở `.env` và cập nhật các giá trị cơ bản:*
   ```env
   DB_USERNAME=legal_user
   DB_PASSWORD=legal_db_secure_password_2026
   DB_DATABASE=legal_db

   JWT_SECRET=b7962c64dbde8c9d09c6df810f274a4ff18a1a3644f128c73499bb8ee4769062
   JWT_EXPIRES_IN=7d
   ADMIN_SEED_PASSWORD=AdminPass2026!

   AI_CORE_INTERNAL_TOKEN=legal_internal_secret_token_2026
   GEMINI_API_KEY=your_gemini_api_key_here
   GEMINI_MODEL=gemini-2.5-flash
   LLM_KEY_ENCRYPTION_SECRET=your_32_characters_secret_key_here
   ```

3. **Khởi chạy toàn bộ hệ thống:**
   ```bash
   docker compose up -d --build
   ```

4. **Kiểm tra trạng thái container:**
   ```bash
   docker compose ps
   ```
   *Khi cả 4 container (`legal_db`, `legal_ai_core`, `legal_backend`, `legal_frontend`) đều báo trạng thái **Up**, bạn có thể mở trình duyệt tại:*
   - **Giao diện Web:** `http://localhost:80`
   - **Tài khoản dùng thử:** `http://localhost:80/demo-accounts`
   - **API Backend:** `http://localhost:3000`

---

### 5.2. Chạy Phát triển Từng Dịch vụ (Local Development)

Nếu muốn phát triển hoặc gỡ lỗi trực tiếp từng thành phần:

```bash
# 1. Khởi động cơ sở dữ liệu PostgreSQL
docker compose up -d db

# 2. Khởi chạy AI Core (Python FastAPI)
cd ai-core
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn api_server:app --host 127.0.0.1 --port 8001 --reload

# 3. Khởi chạy Backend Gateway (NestJS)
cd ../backend
npm install
npm run start:dev

# 4. Khởi chạy Frontend (Vite React)
cd ../frontend
npm install
npm run dev
```

---

## 6. Kiểm thử & Đảm bảo Chất lượng (Quality Assurance)

Mọi chức năng cốt lõi của hệ thống đều được kiểm thử tự động nghiêm ngặt trước khi đóng gói phát hành:

- **Kiểm thử AI Core & Pipeline Thẩm định Trích dẫn:**
  ```bash
  cd ai-core
  python3 -m unittest discover -s tests -p "test_legal_*.py" -v
  ```
  *Bao gồm 15+ test cases: kiểm tra trích dẫn giả mạo, phục hồi cấu trúc JSON, xử lý xung đột hiệu lực văn bản.*

- **Kiểm thử Tích hợp Backend (NestJS / Jest):**
  ```bash
  cd backend
  npm test -- --runInBand
  ```
  *Bao gồm các bài kiểm tra xác thực người dùng, mã hóa khóa API, giới hạn rate limit và API Chat.*

- **Kiểm thử Biên dịch Frontend (Type-check & Production Build):**
  ```bash
  cd frontend
  npm run build
  ```
  *Đảm bảo 0 lỗi TypeScript, 0 lỗi cú pháp CSS và bundle assets đạt dung lượng tối ưu.*

---

## 7. Giấy phép Bản quyền (License)

Dự án được phát hành và duy trì theo giấy phép mã nguồn mở [MIT License](LICENSE). Mọi đóng góp, báo cáo lỗi (issues) và đề xuất nâng cấp đều được hoan nghênh.
