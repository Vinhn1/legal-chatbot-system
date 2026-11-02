# AGENTS.md — Quy tắc thực thi dành cho AI Coding Agents (Codex)

## 1. Môi trường và Nguyên tắc cốt lõi
- **Môi trường thực thi chuẩn:** Mọi lệnh kiểm thử, biên dịch và chạy dịch vụ phải thực hiện trong **bash của WSL2** (Ubuntu/Debian) tại `/mnt/d/Workplace/legal-chatbot-system`. Tuyệt đối không dùng PowerShell.
- **Bảo mật và Bí mật:** Tuyệt đối không in, log, commit bất kỳ API key, token bí mật, JWT secret, thông tin người dùng thực hay tài liệu nội bộ. Chỉ sử dụng `.env.example` với dữ liệu giả lập an toàn.
- **Bảo toàn dữ liệu runtime:** Không xóa volume PostgreSQL và dữ liệu thư mục vector ChromaDB (`legal_documents`).
- **Trung thực và kiểm chứng:** Không bao giờ đánh dấu hoàn thành `[x]` nếu chưa thực sự chạy lệnh kiểm thử trả về mã thoát `0`. Khi không thể truy cập tài liệu hay URL tham chiếu, phải báo cáo rõ thay vì bịa đặt kết quả.
- **Chuẩn mực chú thích mã nguồn:** Mọi mã nguồn (TypeScript, Python, SQL...) khi viết mới hoặc sửa đổi phải có chú thích (comment, docstring) rõ ràng, ngắn gọn, chuyên nghiệp bằng **tiếng Việt có dấu**. Không sử dụng emoji trong mã nguồn và comment.
- **Phối hợp cùng Antigravity:** Kiểm tra `git status` trước khi sửa đổi, không ghi đè lên các thay đổi chưa commit của agent khác.

## 2. UI design and implementation rules
- Product flow: public landing page -> login -> authenticated admin dashboard.
- Admin screens: overview, documents, document ingestion by file/URL/text, chatbot testing, conversations, analytics and settings.
- Before editing UI, inspect the existing frontend framework, routing, component library, styles, assets and API contracts. Record findings.
- Read docs/UI_DESIGN_BRIEF.md and docs/UI_REFERENCES.md before UI work.
- Do not claim to have viewed a reference page or screenshot unless it was actually opened. Record unavailable references as unavailable.
- Research at least two landing references and two admin references. For each, note layout, typography, color, spacing, interaction, responsive behavior, useful patterns and what should not be copied.
- Propose a distinct design direction for this legal RAG product. Use existing project components and conventions where appropriate; justify new libraries.
- Never copy a paid template's source code, artwork or branding without a license. References are for design analysis.
- Implement real UI states: loading, empty, success, error, long text, validation and narrow screens. No dead buttons presented as functional.
- Animate for feedback and orientation, not decoration. Respect reduced motion.
- Run build/lint/tests in WSL. Open the rendered site and inspect desktop, tablet and mobile layouts. Fix visible issues before marking a task done.
- Do not print or expose .env values, tokens, user data or private documents.
- Coordinate with Antigravity: check git status before edits and do not overwrite uncommitted changes made by another agent.
