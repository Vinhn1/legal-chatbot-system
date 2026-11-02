# Kế hoạch Nâng cấp Toàn diện Hệ thống Quản trị Veritas Legal & Đặc tả Kỹ thuật

> **Tài liệu đặc tả kiến trúc và kế hoạch triển khai (Architecture & Implementation Plan)**  
> **Áp dụng cho:** Hệ thống Cổng quản trị Veritas Legal (Backend NestJS, AI Core FastAPI, Frontend React/Vite/Tailwind).  
> **Mục tiêu:** Hoàn thiện trải nghiệm người dùng nghiệp vụ, tăng cường an ninh bảo mật, hỗ trợ Dark Mode, quản lý tài khoản quản trị và chuẩn hóa pipeline tiếp nhận văn bản.  
> **Nguyên tắc thực thi:** Nghiên cứu kỹ lưỡng, chia nhỏ thành các nhiệm vụ độc lập, thực thi kiểm thử và commit theo từng tính năng hoàn thành.

---

## 1. Tổng quan Yêu cầu Nâng cấp Hệ thống

Dựa trên chỉ đạo và phân tích thực tế sử dụng hệ thống, nhóm phát triển ghi nhận 6 hạng mục nâng cấp trọng tâm:

1. **Bổ sung trang Hồ sơ cá nhân (`/admin/profile`):** Cho phép quản trị viên xem/cập nhật thông tin tài khoản, đổi mật khẩu an toàn và quản lý xác thực 2 lớp (2FA).
2. **Quản lý an toàn API Key cho Model AI:** Cung cấp giao diện trực quan tại trang Cài đặt để quản trị viên nhập, che dấu (masking), kiểm tra kết nối (ping test) và lưu trữ bảo mật API key cho mô hình ngôn ngữ lớn (LLM).
3. **Quản lý & Tạo tài khoản quản trị (Thủ công & CSV):** Cung cấp giao diện quản lý danh sách tài khoản, hỗ trợ thêm mới thủ công từng tài khoản hoặc nhập hàng loạt từ tệp CSV có mẫu sẵn.
4. **Hỗ trợ Chế độ Tối (Dark Mode):** Tích hợp nút chuyển đổi giao diện Sáng / Tối / Tự động theo hệ thống, đồng bộ giao diện toàn bộ Cổng quản trị đạt chuẩn tương phản WCAG 2.1.
5. **Loại bỏ các thành phần UI dành riêng cho Dev:** Dọn dẹp các khối giám sát cổng kỹ thuật (Port 8001, FastAPI, ChromaDB, Pipeline RAG) trên trang Tổng quan và Cài đặt; thay thế bằng các chỉ số nghiệp vụ thiết thực.
6. **Mẫu định dạng chuẩn hóa khi Nạp bằng Văn bản:** Tích hợp mẫu văn bản quy phạm pháp luật chuẩn, nút nạp mẫu thử nghiệm và hướng dẫn thể thức trực quan ngay trong tab "Văn bản" để ngăn ngừa tình trạng thiếu metadata.

---

## 2. Chi tiết Đặc tả Kỹ thuật Từng Tính năng

---

### Tính năng 1: Trang Hồ sơ Cá nhân Quản trị viên (`/admin/profile`)

#### A. Mục tiêu & Vị trí điều hướng
- Tạo tuyến đường mới: `/admin/profile`.
- Bổ sung liên kết truy cập nhanh tại:
  - Khối thông tin người dùng ở chân Sidebar bên trái.
  - Menu góc phải trên thanh Top Header (`AdminLayout.tsx`).

#### B. Các khối chức năng giao diện
1. **Khối Thông tin Cá nhân:**
   - Hiển thị: Họ tên, Tên đăng nhập, Địa chỉ Email, Số điện thoại, Vai trò (`admin` - Quản trị viên toàn quyền / `staff` - Chuyên viên pháp lý), Ngày tạo tài khoản.
   - Form chỉnh sửa: Cập nhật Họ tên, Số điện thoại (sử dụng API có sẵn `PATCH /users/profile`).
2. **Khối Đổi Mật khẩu An toàn:**
   - Các trường: Mật khẩu hiện tại, Mật khẩu mới, Xác nhận mật khẩu mới.
   - Thanh đánh giá độ mạnh mật khẩu (Password Strength Meter: tối thiểu 8 ký tự, có chữ hoa, chữ thường, chữ số và ký tự đặc biệt).
   - Gọi API có sẵn: `POST /users/change-password`.
3. **Khối Xác thực Hai lớp (2FA) & Bảo mật:**
   - Trạng thái 2FA hiện tại: Bật / Tắt.
   - Quy trình bật/tắt 2FA thông qua mã OTP gửi về Email/SMS sử dụng API có sẵn: `POST /users/2fa/request` và `POST /users/2fa/toggle`.

---

### Tính năng 2: Quản lý & Cấu hình An toàn API Key cho Model AI

#### A. Mục tiêu & Vị trí
- Tích hợp tại: Trang Cài đặt (`/admin/settings`), mục **Cấu hình Trí tuệ Nhân tạo & LLM**.

#### B. Đặc tả Giao diện & Tương tác
1. **Ô nhập API Key:**
   - Trường input loại `password` có nút bật/tắt icon mắt (`Eye` / `EyeOff`) để xem hoặc ẩn.
   - Khi API key đã được lưu trước đó: Mặc định hiển thị dạng mã hóa che giấu (Masked display, ví dụ: `AIzaSyB************************3x9A`).
2. **Kiểm tra Kết nối (Ping Test):**
   - Nút **Kiểm tra kết nối** (`Test Connection`): Gửi request xác thực nhanh đến backend/AI Core để kiểm tra API key có hoạt động và còn quota hay không trước khi lưu.
   - Hiển thị phản hồi trạng thái: Huy hiệu xanh (Kết nối thành công, độ trễ ms) hoặc đỏ (Khóa không hợp lệ / Hết hạn mức).
3. **Nhãn lựa chọn nhà cung cấp mô hình:**
   - Lựa chọn: Google Gemini (Mặc định), OpenAI, Anthropic Claude, hoặc Local LLM.

#### C. Yêu cầu An ninh & Bảo mật
- Tuyệt đối không log API key ra file log, console trình duyệt hoặc trả về toàn văn qua các API công khai không có xác thực JWT.
- Khi API backend trả về cấu hình, chỉ trả về chuỗi đã che dấu (masked string) hoặc cờ `has_api_key: true`.

---

### Tính năng 3: Quản lý & Tạo Tài khoản Quản trị (Thủ công & File CSV)

#### A. Mục tiêu & Vị trí
- Tích hợp tại: Trang Cài đặt (`/admin/settings` - Tab Quản lý người dùng) hoặc trang riêng biệt `/admin/users` (chỉ cấp quyền cho vai trò `admin`).

#### B. Phương thức Tạo Thủ công (Manual Form)
- Hộp thoại tạo tài khoản mới:
  - Tên đăng nhập (Username: viết liền, không dấu).
  - Họ và tên đầy đủ.
  - Email làm việc.
  - Số điện thoại.
  - Vai trò: `admin` (Toàn quyền quản trị) hoặc `staff` (Chuyên viên thẩm định/rà soát).
  - Mật khẩu khởi tạo ban đầu (có nút tạo ngẫu nhiên mật khẩu mạnh).
- Gọi API backend có sẵn: `POST /users`.

#### C. Phương thức Nhập Hàng loạt qua CSV (Bulk CSV Import)
1. **Tệp Mẫu CSV Chuẩn:**
   - Nút bấm: **Tải file CSV mẫu** (`template_admin_users.csv`).
   - Cấu trúc các cột: `username,name,email,phone,role,password`.
2. **Trình Upload Kéo thả:**
   - Hỗ trợ kéo thả hoặc chọn file `.csv`.
   - Xem trước danh sách tài khoản được bóc tách từ file trước khi bấm xác nhận.
   - Kiểm tra tính hợp lệ cục bộ (Client-side validation): định dạng email, username trùng lặp, độ dài mật khẩu.
3. **Thực thi:**
   - Gọi API backend có sẵn: `POST /users/bulk-import`.
   - Báo cáo kết quả: Số tài khoản tạo thành công, danh sách dòng bị lỗi (nếu có).

---

### Tính năng 4: Hệ thống Giao diện Chế độ Tối (Dark Mode)

#### A. Kiến trúc Theme Provider
- Tận dụng cấu hình sẵn có trong `frontend/src/styles/theme.css` (`@custom-variant dark (&:is(.dark *));` và class `.dark`).
- Tạo Context / Hook: `useTheme` quản lý 3 trạng thái:
  - `light`: Chế độ sáng truyền thống.
  - `dark`: Chế độ tối chuyên nghiệp cho văn phòng luật đêm.
  - `system`: Tự động theo cài đặt hệ điều hành người dùng (`prefers-color-scheme`).
- Lưu trữ trạng thái trong `localStorage` (`veritas_theme_mode`).
- Đồng bộ tự động gán class `dark` lên thẻ `document.documentElement` (`<html>`).

#### B. Vị trí Nút Chuyển đổi
- Đặt nút chuyển đổi Theme (Icon Mặt trời `Sun` / Mặt trăng `Moon` / Màn hình `Laptop`) tại thanh Top Header của `AdminLayout.tsx` (cạnh nút Cổng công khai).

#### C. Quy chuẩn Phối màu Dark Mode
- Nền chính (Main background): `#0f172a` (Slate 900) hoặc `#121824`.
- Nền thẻ / Bảng (Card / Table background): `#1e293b` (Slate 800) hoặc `#1a2234`.
- Đường viền (Border): `#334155` (Slate 700).
- Chữ tiêu đề (Text heading): `#f8fafc` (Slate 50).
- Chữ nội dung (Text body): `#cbd5e1` (Slate 300).
- Màu nhấn (Accent color): `#38bdf8` (Sky blue) hoặc `#d4af37` (Vàng hoàng gia Veritas).

---

### Tính năng 5: Loại bỏ các Thành phần UI Kỹ thuật (Dev-Only) Không Cần Thiết

#### A. Phân tích Các Thành phần Cần Loại bỏ
Theo phản ánh của người dùng, các khối thông tin sau chỉ có ý nghĩa trong quá trình debug của lập trình viên, gây nhiễu cho người dùng nghiệp vụ:

1. **Tại `AdminSettingsPage.tsx` (dòng 246 - 295):**
   - Khối: *"Trạng thái kết nối dịch vụ backend — Giám sát tình trạng hoạt động thực tế của các thành phần cốt lõi"*.
   - Chi tiết kỹ thuật cần ẩn: Cổng dịch vụ 8001, FastAPI, Khởi tạo Hybrid BM25 & Embedding, ChromaDB Local Engine.
2. **Tại `AdminOverviewPage.tsx` (dòng 408 - 450):**
   - Khối: *"HỆ THỐNG TRUY XUẤT — Trạng thái Pipeline RAG"*.
   - Chi tiết kỹ thuật cần ẩn: Đèn báo cổng 8001, Hybrid BM25 + Vector RRF Rerank, Kho vector ChromaDB.

#### B. Phương án Thay thế Hữu ích cho Nghiệp vụ
- Thay thế các khối trên bằng thông số thống kê nghiệp vụ có giá trị thực tế:
  - **Tỷ lệ kiểm duyệt câu hỏi:** Tỷ lệ câu hỏi đã được chuyên viên kiểm duyệt / cần hiệu chỉnh.
  - **Lối tắt thao tác nhanh (Quick Action Shortcuts):** Nút nạp văn bản mới, nút kiểm thử chatbot, nút rà soát phiên hội thoại.

---

### Tính năng 6: Mẫu Soạn thảo Chuẩn hóa khi Nạp bằng Nội dung Văn bản

#### A. Mục tiêu
- Khắc phục tình trạng người dùng dán văn bản tùy tiện, thiếu thông tin hành chính cốt lõi (Số hiệu, Cơ quan, Ngày ban hành, Chương, Điều) khiến hệ thống báo lỗi hoặc rơi vào hàng đợi `needs_review`.

#### B. Thiết kế Giao diện tại Tab "Văn bản" (`AdminIngestPage.tsx`)
1. **Nút "Nạp văn bản mẫu chuẩn" (Load Sample Template):**
   - Khi bấm, tự động điền một mẫu văn bản quy phạm pháp luật đầy đủ (Nghị định chuẩn) vào vùng soạn thảo.
2. **Bảng "Hướng dẫn Thể thức Văn bản Chuẩn" (Format Guide):**
   - Hiển thị ngay cạnh hoặc phía trên ô nhập:
     - Dòng 1: Tên cơ quan ban hành (Ví dụ: `CHÍNH PHỦ` hoặc `QUỐC HỘI`).
     - Dòng 2: Số hiệu văn bản (Ví dụ: `Số: 13/2023/NĐ-CP`).
     - Dòng 3: Quốc hiệu, tiêu ngữ.
     - Dòng 4: Địa danh, ngày ban hành (Ví dụ: `Hà Nội, ngày 17 tháng 04 năm 2023`).
     - Dòng 5: Tên loại và trích yếu (Ví dụ: `NGHỊ ĐỊNH / Về bảo vệ dữ liệu cá nhân`).
     - Dòng 6: Cấu trúc phân cấp rõ ràng: `Chương I`, `Điều 1.`, `Điều 2.`, `Khoản 1`, `Khoản 2`.
3. **Chế độ Soạn thảo Theo Form (Form Builder Mode) - Tùy chọn:**
   - Công tắc chuyển đổi giữa:
     - *Dán tự do (Raw Text)*: Dành cho người dùng đã có sẵn toàn văn.
     - *Soạn theo biểu mẫu (Guided Form)*: Các ô nhập riêng biệt (Số hiệu, Tên văn bản, Cơ quan, Ngày, Nội dung các Điều) tự động ghép thành văn bản chuẩn trước khi nạp.

---

## 3. Nguyên tắc Bảo mật Tuyệt đối trong Thiết kế & Lập trình Web

Mọi dòng code phát triển mới phải tuân thủ nghiêm ngặt 7 nguyên tắc an ninh thông tin:

1. **Bảo vệ Bí mật & API Key:**
   - Tuyệt đối không commit API key, token bí mật hay JWT secret vào kho lưu trữ git.
   - Lưu trữ bí mật thông qua biến môi trường hoặc bảng cấu hình mã hóa phía backend.
   - Giao diện người dùng chỉ hiển thị khóa dạng đã che dấu (Masked string).
2. **Kiểm tra Quyền Truy cập Đa tầng (RBAC):**
   - Chỉ người dùng có vai trò `admin` mới được truy cập các tính năng: Cấu hình API key, Quản lý tài khoản người dùng, Tạo tài khoản hàng loạt qua CSV.
   - Mọi endpoint backend phải có đầy đủ bộ bảo vệ `@UseGuards(JwtAuthGuard, RolesGuard)` và `@Roles('admin')`.
3. **Phòng chống Tấn công Tiêm nhiễm (XSS & Injection):**
   - Dữ liệu người dùng nhập (Tên, Email, Nội dung văn bản pháp luật) phải được làm sạch và escape an toàn trước khi render.
   - Không sử dụng `dangerouslySetInnerHTML` khi hiển thị dữ liệu chưa được kiểm duyệt.
4. **An toàn Tải lên File CSV:**
   - Kiểm tra định dạng tệp (MIME type `text/csv`, kích thước tối đa 5 MB).
   - Kiểm tra và xử lý chống tấn công CSV Injection (Formula Injection: các ký tự khởi đầu nguy hiểm `=`, `+`, `-`, `@`).
5. **Chống Tiết lộ Thông tin (Information Disclosure):**
   - Không in chi tiết lỗi hệ thống (Stack trace), tên bảng database hoặc kết nối nội bộ ra thông báo lỗi người dùng.
6. **Mã hóa Mật khẩu:**
   - Mật khẩu tài khoản quản trị mới phải được băm an toàn bằng `bcrypt` với cost factor tối thiểu 10 trước khi lưu vào cơ sở dữ liệu.
7. **Bảo mật Phiên làm việc (Session & JWT Security):**
   - Token JWT được quản lý an toàn, tự động thu hồi khi đổi mật khẩu hoặc đăng xuất.

---

## 4. Lộ trình Triển khai Chi tiết (6 Tasks Độc lập)

```
+-----------------------------------------------------------------------------------------+
| SPRINT 1: Dọn dẹp UI Kỹ thuật (Dev-Only) & Tích hợp Mẫu Chuẩn Tab Văn bản               |
| -> AdminOverviewPage & AdminSettingsPage dọn dẹp khối Dev cổng 8001                     |
| -> AdminIngestPage bổ sung Template mẫu & Hướng dẫn thể thức văn bản                    |
+-----------------------------------------------------------------------------------------+
                                           |
                                           v
+-----------------------------------------------------------------------------------------+
| SPRINT 2: Hệ thống Chế độ Tối (Dark Mode) Toàn diện                                     |
| -> Xây dựng ThemeProvider / useTheme hook (Light / Dark / System)                       |
| -> Nút chuyển đổi Theme trên Top Header                                                 |
| -> Cập nhật CSS variables và Tailwind styles tương thích Dark Mode                      |
+-----------------------------------------------------------------------------------------+
                                           |
                                           v
+-----------------------------------------------------------------------------------------+
| SPRINT 3: Giao diện Quản lý & Cấu hình An toàn API Key Model AI                         |
| -> Thêm ô nhập API Key masked, nút ẩn/hiện, nút Ping Test tại AdminSettingsPage        |
| -> Backend / AI Core endpoint lưu trữ và kiểm tra kết nối API Key an toàn               |
+-----------------------------------------------------------------------------------------+
                                           |
                                           v
+-----------------------------------------------------------------------------------------+
| SPRINT 4: Xây dựng Trang Hồ sơ Cá nhân Quản trị viên (`/admin/profile`)                 |
| -> Tạo trang AdminProfilePage kết nối GET /users/me, PATCH /users/profile               |
| -> Form đổi mật khẩu an toàn & Quản lý bảo mật 2FA OTP                                  |
| -> Bổ sung route và liên kết điều hướng từ Avatar/Sidebar                               |
+-----------------------------------------------------------------------------------------+
                                           |
                                           v
+-----------------------------------------------------------------------------------------+
| SPRINT 5: Quản lý & Tạo Tài khoản Quản trị (Thủ công & File CSV)                        |
| -> Giao diện danh sách quản trị viên, form tạo tài khoản thủ công                       |
| -> Chức năng Tải file CSV mẫu và Trình kéo thả upload nhập hàng loạt                     |
| -> Kết nối các endpoint backend: POST /users, POST /users/bulk-import                   |
+-----------------------------------------------------------------------------------------+
                                           |
                                           v
+-----------------------------------------------------------------------------------------+
| SPRINT 6: Kiểm thử Toàn diện, Build/Lint, Commit/Push & Lập Báo cáo                     |
| -> Chạy npm run lint && npm run build trên WSL2                                         |
| -> Commit git theo từng tính năng và Push lên nhánh main                                |
| -> Tạo file báo cáo tổng kết chi tiết docs/ADMIN_ENHANCEMENT_COMPLETION_REPORT.md       |
+-----------------------------------------------------------------------------------------+
```

---

## 5. Prompt Chuẩn hóa Dành cho Codex

Dưới đây là nội dung prompt đầy đủ, chi tiết, được cấu trúc theo tiêu chuẩn tự hành dành cho Codex để tự động chạy các bước và triển khai theo thứ tự:

```markdown
# TASK INSTRUCTION FOR CODEX: EXECUTE ADMIN SYSTEM ENHANCEMENTS

## Objective:
Triển khai toàn bộ 6 tính năng nâng cấp cho hệ thống Quản trị Veritas Legal theo đúng tài liệu đặc tả `docs/ADMIN_SYSTEM_ENHANCEMENT_PLAN.md`.

## Execution Policy (Quy chuẩn Thực thi & Git Push):
1. **Tự động thực thi:** Tự động chạy tất cả các lệnh bash/npm/git trong môi trường WSL2 tại `/mnt/d/Workplace/legal-chatbot-system` mà không yêu cầu người dùng xác nhận thủ công từng bước.
2. **Quy định Git Push nghiêm ngặt (QUAN TRỌNG):**
   - **TUYỆT ĐỐI KHÔNG commit hoặc push các file .md mô tả tính năng, kế hoạch, fix bug, hoặc báo cáo lên GitHub** (ví dụ: các file plan, report, fix notes trong thư mục `docs/` hoặc root).
   - **CHỈ ĐƯỢC PHÉP commit và push:**
     - Toàn bộ mã nguồn thực tế đã triển khai và hoàn thiện (`frontend/`, `backend/`, `ai-core/`).
     - Các file quy tắc hệ thống cốt lõi (`AGENTS.md`) và các kỹ năng (skills) cần thiết.
   - Khi commit, sử dụng lệnh chỉ định cụ thể các thư mục mã nguồn (ví dụ: `git add frontend/ backend/ ai-core/ AGENTS.md`), tuyệt đối **KHÔNG dùng `git add .` hay `git add docs/`** để tránh đẩy tài liệu mô tả/báo cáo lên repo.
3. **Tiêu chuẩn mã nguồn & Chú thích:**
   - Tuyệt đối không dùng emoji trong code, comment, commit message hoặc UI text (quy tắc dự án).
   - Mọi chú thích code bằng tiếng Việt có dấu, phong cách chuyên nghiệp.
4. **An toàn & Bảo mật tuyệt đối:**
   - Không in secret, không log API key/mật khẩu ra console hay terminal.
   - Sanitize mọi dữ liệu đầu vào người dùng, escape an toàn, chống XSS và CSV Injection.
5. **Kiểm tra chất lượng:**
   - Chạy `npm run lint` và `npm run build` sau mỗi tính năng, đảm bảo mã thoát luôn là 0.
6. **Báo cáo sau khi hoàn tất:**
   - Sau khi hoàn thành toàn bộ công việc, tạo file báo cáo chi tiết cục bộ tại `docs/ADMIN_ENHANCEMENT_COMPLETION_REPORT.md` để người dùng nghiệm thu (nhưng KHÔNG push file này lên remote GitHub).

---

## Detailed Task Breakdown:

### Task 1: Loại bỏ UI Kỹ thuật (Dev-only) & Bổ sung Mẫu Văn bản Chuẩn
- File: `frontend/src/app/pages/admin/AdminOverviewPage.tsx`
  - Loại bỏ khối "HỆ THỐNG TRUY XUẤT - Trạng thái Pipeline RAG" (dòng 408-450).
  - Thay thế bằng khối thống kê nghiệp vụ: Tỷ lệ câu hỏi đã duyệt, lối tắt thao tác nhanh (Nạp tài liệu, Thử chatbot, Rà soát hội thoại).
- File: `frontend/src/app/pages/admin/AdminSettingsPage.tsx`
  - Loại bỏ khối "Trạng thái kết nối dịch vụ backend" (dòng 246-295).
- File: `frontend/src/app/pages/admin/AdminIngestPage.tsx`
  - Trong tab "Văn bản": Thêm nút "Nạp văn bản mẫu chuẩn" (tự động điền mẫu Nghị định 13/2023/NĐ-CP đầy đủ thể thức).
  - Thêm hộp thoại/drawer "Hướng dẫn Thể thức Chuẩn" giải thích quy cách cấu trúc Quốc hiệu, Số hiệu, Cơ quan, Ngày ban hành, Chương, Điều, Khoản.
- Kiểm thử: `npm run lint` && `npm run build`.
- Commit (chỉ mã nguồn): `git add frontend/ && git commit -m "feat(ui): clean dev panels and add legal text template guide"`

### Task 2: Triển khai Hệ thống Chế độ Tối (Dark Mode)
- File mới: `frontend/src/app/context/ThemeContext.tsx`
  - Xây dựng ThemeProvider và useTheme hook quản lý 3 chế độ (light, dark, system).
  - Lưu trạng thái vào localStorage (`veritas_theme_mode`).
  - Tự động gắn class `dark` lên `document.documentElement`.
- File: `frontend/src/app/layouts/AdminLayout.tsx`
  - Tích hợp nút bấm chuyển đổi Theme trên Top Header (Icon Sun / Moon).
  - Bổ sung class Tailwind dark: tương thích cho Sidebar, Header, Background (`dark:bg-slate-900`, `dark:text-slate-100`, `dark:border-slate-800`).
- Cập nhật styling dark mode cho các trang quản trị chính.
- Kiểm thử: `npm run lint` && `npm run build`.
- Commit (chỉ mã nguồn): `git add frontend/ && git commit -m "feat(theme): implement dark mode support across admin dashboard"`

### Task 3: Ô nhập API Key cho Model AI & Kiểm tra Kết nối
- File: `frontend/src/app/pages/admin/AdminSettingsPage.tsx`
  - Thêm section "Cấu hình Khóa API Mô hình AI (LLM Provider)".
  - Ô nhập API Key có nút ẩn/hiện mật khẩu, hỗ trợ che dấu (masked string khi đã lưu).
  - Nút "Kiểm tra kết nối" (Ping test) hiển thị trạng thái kết nối và độ trễ.
- File: `backend/src/chat/chat.service.ts` & `backend/src/chat/chat.controller.ts`
  - Cập nhật endpoint config hỗ trợ lưu và che giấu API key khi trả về client.
- Kiểm thử: `npm run lint` && `npm run build`.
- Commit (chỉ mã nguồn): `git add frontend/ backend/ && git commit -m "feat(settings): add secure AI model API key configuration with ping test"`

### Task 4: Xây dựng Trang Hồ sơ Cá nhân (`/admin/profile`)
- File mới: `frontend/src/app/pages/admin/AdminProfilePage.tsx`
  - Khối Thông tin cá nhân: Hiển thị tên, email, vai trò, số điện thoại; hỗ trợ cập nhật thông tin qua `PATCH /users/profile`.
  - Khối Đổi mật khẩu: Mật khẩu hiện tại, mật khẩu mới, xác nhận mật khẩu, thanh đo độ mạnh mật khẩu qua `POST /users/change-password`.
  - Khối Xác thực 2FA OTP qua `POST /users/2fa/request` và `POST /users/2fa/toggle`.
- File: `frontend/src/app/routes.tsx`
  - Đăng ký route mới: `{ path: "profile", Component: AdminProfilePage }`.
- File: `frontend/src/app/layouts/AdminLayout.tsx`
  - Bổ sung liên kết đến `/admin/profile` từ khối user profile ở chân Sidebar và Top Header.
- Kiểm thử: `npm run lint` && `npm run build`.
- Commit (chỉ mã nguồn): `git add frontend/ && git commit -m "feat(profile): create admin profile page with password change and 2FA"`

### Task 5: Quản lý & Tạo Tài khoản Quản trị (Thủ công & CSV)
- File: `frontend/src/app/pages/admin/AdminUsersPage.tsx` (hoặc tab Người dùng trong `AdminSettingsPage.tsx`)
  - Danh sách bảng các tài khoản (`GET /users`) hiển thị tên, email, vai trò, ngày tạo.
  - Form modal tạo tài khoản thủ công (`POST /users`) với validation độ dài mật khẩu và email.
  - Chức năng nạp CSV: Nút "Tải file mẫu CSV", vùng kéo thả upload file CSV, client-side validation và gửi dữ liệu lên `POST /users/bulk-import`.
  - Nút Xóa/Khóa tài khoản (`DELETE /users/:id`).
- File: `frontend/src/app/routes.tsx` & `frontend/src/app/layouts/AdminLayout.tsx`
  - Đăng ký route và liên kết điều hướng danh mục quản trị người dùng.
- Kiểm thử: `npm run lint` && `npm run build`.
- Commit (chỉ mã nguồn): `git add frontend/ && git commit -m "feat(users): add admin user management with manual creation and CSV bulk import"`

### Task 6: Tổng duyệt, Push Git & Lập Báo cáo Cục bộ
- Chạy toàn bộ test suites và kiểm tra build cuối cùng trong WSL2:
  `cd /mnt/d/Workplace/legal-chatbot-system/frontend && npm run lint && npm run build`
- Đẩy toàn bộ các commit mã nguồn lên remote GitHub nhánh hiện tại:
  `git push origin main`
  *(Lưu ý: Chỉ push commit chứa mã nguồn, quy tắc và skill cần thiết; không push bất kỳ file tài liệu mô tả/fix/báo cáo nào).*
- Tạo tệp tài liệu báo cáo nghiệm thu cục bộ tại:
  `docs/ADMIN_ENHANCEMENT_COMPLETION_REPORT.md`
  Ghi nhận đầy đủ: danh sách file thay đổi, các tính năng đã hoàn thiện, kết quả lint/build, hướng dẫn sử dụng và kiểm thử (giữ file này cục bộ cho người dùng kiểm duyệt).
```
