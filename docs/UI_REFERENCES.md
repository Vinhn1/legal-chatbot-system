# UI Design References & Analysis — Legal Chatbot System

Tài liệu này tổng hợp các nguồn tham chiếu thiết kế, phân tích kiến trúc giao diện, typography, hệ màu, bố cục không gian, chuyển động và các bài học ứng dụng thực tế cho Legal Chatbot System.

---

## 1. Danh sách các mẫu tham chiếu chính

### 1.1. Mẫu Landing Page: Tailwind Salient
- **Nguồn tham chiếu:** [Tailwind Salient Preview](https://tailwindcss.com/plus/templates/salient/preview)
- **Khu vực áp dụng:** Trang chủ công khai (`Landing Page`).
- **Đặc điểm phân tích:**
  - **Bố cục (Layout):** Phân tầng thị giác hero cực kỳ rõ ràng, độ rộng container tối ưu (`max-w-7xl`), khoảng cách dòng và khoảng trắng hào phóng (`py-20` đến `py-28`). Khối mockup ứng dụng nổi bật ở trung tâm với hiệu ứng đổ bóng đa tầng (multi-layered drop shadow).
  - **Typography:** Tiêu đề lớn hiển thị sắc nét với sans-serif hiện đại, tracking chặt chẽ (`tracking-tight`), tỷ lệ phân cấp rõ rệt giữa H1 (text-5xl/6xl) và đoạn mô tả (text-lg/xl, leading-relaxed).
  - **Hệ màu & Tương phản:** Nền sáng sạch sẽ (`#FFFFFF` và `#F8FAFC`), màu nhấn xanh dương chủ đạo tinh tế, tương phản đạt chuẩn WCAG AAA.
  - **Khoảng cách (Spacing):** Nhịp điệu section cách nhau từ 80px đến 120px, tạo cảm giác thông thoáng, đẳng cấp và không gây ngột ngạt.
  - **Tính năng nổi bật:** Card tính năng với icon tối giản, có tab chuyển đổi tính năng mượt mà, khối FAQ dạng accordion dễ theo dõi.
  - **Điểm KHÔNG sao chép:** Không sao chép mã nguồn bản quyền thương mại của Tailwind Plus hay tài sản đồ họa; chỉ học hỏi cấu trúc phân tầng thông tin, nhịp điệu khoảng trắng và cách bố trí CTA.

### 1.2. Mẫu Landing Page Mở rộng: Tailwind Radiant
- **Nguồn tham chiếu:** [Tailwind Radiant Template](https://tailwindcss.com/plus/templates/radiant)
- **Khu vực áp dụng:** Cấu trúc trình bày các giải pháp pháp lý và quy trình RAG chuyên sâu.
- **Đặc điểm phân tích:**
  - **Bố cục:** Bố cục marketing nhiều section dạng bento grid, kết hợp card thông tin với các biểu đồ mô phỏng luồng dữ liệu.
  - **Bài học ứng dụng:** Sử dụng bento grid để hiển thị các số liệu chứng minh độ tin cậy: số lượng văn bản pháp lý đã nạp, tỷ lệ trích dẫn chuẩn xác, cơ chế chống ảo giác, và các loại văn bản hỗ trợ (Luật, Nghị định, Thông tư).

### 1.3. Mẫu Trang Quản trị: shadcn/ui Dashboard-01 & Blocks
- **Nguồn tham chiếu:** [shadcn/ui Blocks](https://ui.shadcn.com/blocks)
- **Khu vực áp dụng:** Giao diện khung quản trị (`Admin Shell`), Bảng tài liệu, Thẻ thống kê và Form đăng nhập.
- **Đặc điểm phân tích:**
  - **Bố cục:** Bố cục thanh bên (Sidebar) thu gọn thông minh, Header cố định với breadcrumb và thanh tìm kiếm toàn cục, nội dung chính dạng thẻ card có viền mảnh (`border border-slate-200/80`).
  - **Thẻ thống kê (Metric Cards):** Card nhỏ gọn hiển thị chỉ số chính (KPI), icon ngữ cảnh, giá trị số lớn và nhãn xu hướng thay đổi.
  - **Bảng dữ liệu (Data Table):** Bảng phân trang gọn gàng, hiển thị trạng thái hiệu lực bằng badge tinh tế (Active, Expired, Unknown), action menu trực tiếp ở từng dòng.
  - **Form Đăng nhập:** Thiết kế tập trung giữa màn hình, nhãn rõ ràng, hỗ trợ trạng thái validation tức thì và thông báo lỗi thân thiện.
  - **Bài học ứng dụng:** Dùng cấu trúc component chuẩn của shadcn/ui (đã có sẵn nền tảng trong thư mục `components/ui/` của project) để xây dựng trang quản trị pháp luật chuẩn mực, dễ bảo trì.

### 1.4. Mẫu Quản trị Nâng cao: Studio Admin trên Vercel
- **Nguồn tham chiếu:** [Vercel Studio Admin Dashboard](https://vercel.com/templates/next.js/next-js-and-shadcn-ui-admin-dashboard)
- **Khu vực áp dụng:** Chế độ hiển thị đa nền tảng, Light/Dark mode và cấu trúc phân nhánh nhiều trang quản trị.
- **Đặc điểm phân tích:**
  - Hỗ trợ chế độ màu tối (Dark Mode) chuẩn xác với tông màu đá phiến trầm (`slate-900`/`slate-950`), các viền phát sáng nhẹ tạo chiều sâu không gian.
  - Bố cục responsive linh hoạt, chuyển đổi sidebar dạng trượt (drawer) trên tablet và mobile.

### 1.5. Mẫu Chuyển động: Motion for React
- **Nguồn tham chiếu:** [Motion for React Documentation](https://motion.dev/docs/react)
- **Khu vực áp dụng:** Micro-interactions, mở panel trích dẫn, accordion FAQ, chuyển đổi tab.
- **Đặc điểm phân tích:**
  - Chuyển động có mục đích: Định hướng thị giác khi người dùng bấm vào một trích dẫn luật thì panel nguồn trượt vào mượt mà.
  - Ưu tiên thuộc tính `opacity` và `transform` để tối ưu GPU và 60fps trên mobile.
  - Tôn trọng thuộc tính `prefers-reduced-motion` của hệ điều hành.

---

## 2. Quyết định Hướng thiết kế riêng cho Legal Chatbot System

Dựa trên việc nghiên cứu các mẫu tham chiếu, hệ thống chọn hướng thiết kế mang tên: **"Veritas Legal Design" — Pháp lý Hiện đại & Chuẩn mực Tin cậy**:

1. **Bố cục Trang chủ (Public Facing):**
   - Lấy cảm hứng phân tầng từ **Tailwind Salient**: Hero tập trung vào bài toán cốt lõi "Tra cứu Văn bản Quy phạm Pháp luật Việt Nam với Trích dẫn Chính xác Tuyệt đối".
   - Khung chat thử nghiệm tương tác nhanh ngay trên trang chủ, cho phép người dùng hỏi thử các câu hỏi điển hình (về Luật Đất đai, Luật Doanh nghiệp, Bộ luật Dân sự...).
   - Hiển thị rõ các chỉ số minh bạch: số lượng văn bản trong kho, phạm vi dữ liệu và ngày cập nhật gần nhất.

2. **Bố cục Quản trị (Admin Console):**
   - Kế thừa chuẩn **shadcn/ui Dashboard**: Bố cục Sidebar bên trái, Header phía trên và vùng làm việc đa năng.
   - Quản trị tài liệu dạng bảng với bộ lọc phân cấp (Cơ quan ban hành, Loại văn bản, Trạng thái hiệu lực).
   - Khu vực nạp tài liệu hỗ trợ kéo-thả tệp, hiển thị cảnh báo ngay lập tức nếu tài liệu là bản scan hoặc OCR kém chất lượng cần duyệt tay.

3. **Giao diện Chat & Hiển thị Trích dẫn (Core RAG Experience):**
   - Bong bóng hội thoại thiết kế trang nhã, phân biệt rõ người hỏi và phản hồi từ AI.
   - Bên dưới mỗi câu trả lời là danh sách các **Legal Source Badges** (ví dụ: `[Luật 01/2026/QH] Điều 1. Khoản 2`).
   - Khi nhấp vào badge trích dẫn, một **Side Panel (Drawer)** mở ra hiển thị toàn văn nội dung Điều luật gốc đã được làm giàu ngữ cảnh cha con, kèm ngày ban hành và trạng thái hiệu lực.
   - Nếu trích dẫn thuộc văn bản đã hết hiệu lực, hệ thống hiển thị cảnh báo viền vàng/đỏ nổi bật để người dùng không áp dụng sai quy định cũ.
