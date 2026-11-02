# UI Design Brief — Legal Chatbot System

## 1. Người dùng mục tiêu
- **Khách chưa đăng nhập (Public User / Khách vãng lai):** Tìm hiểu khả năng của hệ thống RAG pháp luật, xem các bộ văn bản pháp lý đang hỗ trợ, thử nghiệm tra cứu văn bản công khai và điều hướng vào trang đăng nhập quản trị.
- **Quản trị viên và Chuyên viên pháp lý (Authenticated Admin / Staff):** Nạp và duyệt tài liệu quy phạm pháp luật, theo dõi pipeline xử lý RAG, thử nghiệm chatbot nội bộ, rà soát lịch sử hội thoại và cấu hình hệ thống.

## 2. Luồng nghiệp vụ chính (Product Flow)
`Landing Page` ➔ `Đăng nhập` ➔ `Dashboard Tổng quan` ➔ `Nạp tài liệu (File/URL/Text)` ➔ `Kiểm tra trạng thái bóc tách & lập chỉ mục` ➔ `Thử nghiệm Chatbot` ➔ `Đối chiếu trích dẫn nguồn văn bản`.

## 3. Danh sách màn hình bắt buộc
1. **Landing Page:** Hero section với thông điệp rõ ràng, minh họa giao diện hỏi đáp pháp luật có trích dẫn, danh mục tính năng nổi bật, quy trình xử lý dữ liệu chuẩn xác, khối CTA đăng nhập/tra cứu, và mục giải đáp thắc mắc thường gặp (FAQ).
2. **Trang Đăng nhập (Login):** Form nhập liệu tối giản, xử lý validate email/username/password, hiển thị lỗi nhập liệu, trạng thái loading khi gửi request và điều hướng sau đăng nhập thành công.
3. **Dashboard Tổng quan (Admin Overview):** Thẻ thống kê số lượng văn bản, số chunk, số truy vấn trong ngày; danh sách hoạt động gần đây; cảnh báo tài liệu cần rà soát thủ công (scan/OCR).
4. **Quản lý Tài liệu (Documents Management):** Bảng danh sách văn bản quy phạm, bộ lọc theo loại văn bản (Luật, Nghị định, Thông tư), bộ lọc trạng thái hiệu lực (active, expired, partially_expired, unknown), tìm kiếm theo số hiệu/trích yếu, xem chi tiết metadata và cấu trúc Điều/Khoản.
5. **Nạp tài liệu pháp luật (Document Ingestion):** Tiếp nhận tệp tải lên (PDF, DOCX, TXT), hỗ trợ nạp qua URL hoặc dán nội dung text trực tiếp; nhập metadata chuẩn (số hiệu, ngày ban hành, hiệu lực, cơ quan); hiển thị tiến trình bóc tách và thông báo kết quả.
6. **Không gian Thử nghiệm Chatbot (Chatbot Playground / Tra cứu):** Khung nhập câu hỏi text lớn, hỗ trợ phím Enter và nút Gửi; hiển thị câu trả lời dạng Markdown; trích dẫn nguồn phân cấp (Điều, Khoản, Văn bản); panel xem nhanh nội dung trích dẫn gốc; cảnh báo hiệu lực văn bản.
7. **Lịch sử Hội thoại (Conversations Log):** Danh sách các phiên hỏi đáp, lọc theo thời gian và đánh giá chất lượng; xem chi tiết từng lượt hỏi-đáp và gắn cờ cần chuyên viên rà soát.
8. **Thống kê & Cài đặt (Analytics & Settings):** Thống kê độ chính xác trích dẫn, thời gian phản hồi, trạng thái kết nối AI Core/ChromaDB và cài đặt phạm vi truy cập (scope).

## 4. Phong cách thiết kế (Design System & Aesthetics)
- **Định vị cảm xúc:** Đáng tin cậy, chuẩn mực, hiện đại, thoáng đãng và tối ưu cho việc đọc văn bản tiếng Việt dài.
- **Hệ màu chủ đạo:**
  - Màu thương hiệu chính: Xanh Navy / Deep Blue (`#1E3A8A`, `#1D4ED8`) thể hiện sự tin cậy và pháp lý chuẩn tắc.
  - Nền & Thẻ: Nền sáng (`#F8FAFC`, `#FFFFFF`), viền sắc nét nhẹ (`#E2E8F0`), hỗ trợ Dark mode sang trọng (`#0F172A`, `#1E293B`).
  - Màu trạng thái: Xanh lá (`Active` / Đang hiệu lực), Đỏ/Cam (`Expired` / Hết hiệu lực), Hổ phách/Vàng (`Needs Review` / Cần rà soát), Xám xanh (`Unknown` / Chưa xác minh).
- **Mascot & Avatar đại diện duy nhất của Chatbot:** Giữ nguyên 100% hình khối và chuyển động tương tác của Robot Mascot (RobotAvatar.tsx - chớp mắt tự nhiên, hướng nhìn linh hoạt, khẩu hình mấp máy khi trả lời, phản ứng vui vẻ). Chuẩn hóa màu sắc sang Xanh Navy Hoàng gia (`#1E3A8A` - `#0F172A`), thân cầu xanh dương (`#2563EB`), mắt cyber cyan phát sáng (`#38BDF8`), và biểu tượng Cán Cân Công Lý (Scale of Justice) cùng nhãn định danh "LEGAL AI" màu vàng kim (Gold `#F59E0B`) trên trán. Tuyệt đối không thay thế bằng avatar khác.
- **Nguyên tắc tương tác:** Ưu tiên hiển thị thông tin trích dẫn, trạng thái dữ liệu và độ tin cậy hơn là các hiệu ứng hình ảnh rườm rà.

## 5. Tiêu chuẩn kỹ thuật và chất lượng
- **Responsive toàn diện:** Hiển thị mượt mà trên Mobile (390px), Tablet (768px) và Desktop (1280px+).
- **Trạng thái thực tế (Real UI States):** Mọi màn hình phải có đầy đủ trạng thái: Loading (Skeleton/Spinner), Empty State (khi chưa có dữ liệu), Success, Error (kèm hướng dẫn khắc phục), và Long text truncation.
- **Khả năng tiếp cận (Accessibility):** Điều hướng bàn phím đầy đủ (Tab, Enter, Escape), focus outline rõ ràng, độ tương phản màu đạt chuẩn WCAG AA.
- **Chống bịa đặt:** Kết nối API thật hoặc thông báo rõ khi chưa có dữ liệu backend, không giả lập dữ liệu tĩnh như thể đã đồng bộ hóa.
