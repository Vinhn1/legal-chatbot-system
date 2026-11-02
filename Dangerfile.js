// Dangerfile.js
// Tự động kiểm tra quy chuẩn PR cho MobiFone Chatbot System
// Docs: https://danger.systems/js

const { danger, warn, fail, message } = require("danger");

const pr = danger.github.pr;
const git = danger.git;

// ─────────────────────────────────────────────────────────
// 1. PR phải có mô tả (description)
// ─────────────────────────────────────────────────────────
if (!pr.body || pr.body.trim().length < 20) {
  fail(
    "❌ **PR chưa có mô tả.**\n\n" +
      "Vui lòng thêm mô tả giải thích:\n" +
      "- Bạn đã thay đổi gì?\n" +
      "- Tại sao cần thay đổi?\n" +
      "- Cách test thay đổi này?"
  );
}

// ─────────────────────────────────────────────────────────
// 2. Cảnh báo khi PR quá lớn (khó review)
// ─────────────────────────────────────────────────────────
const LINES_THRESHOLD = 500;
const totalChanges = pr.additions + pr.deletions;
if (totalChanges > LINES_THRESHOLD) {
  warn(
    `⚠️ **PR này rất lớn** (${totalChanges} dòng thay đổi).\n\n` +
      "Hãy cân nhắc chia nhỏ thành nhiều PR để dễ review hơn.\n" +
      "_Quy tắc: PR tốt < 400 dòng thay đổi._"
  );
}

// ─────────────────────────────────────────────────────────
// 3. Kiểm tra file .env không được commit
// ─────────────────────────────────────────────────────────
const sensitiveFiles = [
  ".env",
  "ai-core/.env",
  "backend/.env",
  "frontend/.env",
];
const committedEnvFiles = git.created_files
  .concat(git.modified_files)
  .filter((f) => sensitiveFiles.some((s) => f.endsWith(s)));

if (committedEnvFiles.length > 0) {
  fail(
    `🔐 **NGUY HIỂM: File .env bị commit!**\n\n` +
      `File bị ảnh hưởng: ${committedEnvFiles.map((f) => `\`${f}\``).join(", ")}\n\n` +
      "Hành động cần làm:\n" +
      "1. Xóa file .env khỏi git: `git rm --cached <file>`\n" +
      "2. Thêm vào `.gitignore`\n" +
      "3. Đổi tất cả secrets đã bị lộ ngay lập tức!"
  );
}

// ─────────────────────────────────────────────────────────
// 4. Cảnh báo khi sửa file cấu hình quan trọng
// ─────────────────────────────────────────────────────────
const criticalFiles = [
  "docker-compose.yml",
  "ai-core/rag_config.json",
  ".github/workflows/deploy.yml",
];
const modifiedCritical = git.modified_files.filter((f) =>
  criticalFiles.some((c) => f.includes(c))
);

if (modifiedCritical.length > 0) {
  warn(
    `⚙️ **File cấu hình quan trọng đã bị sửa:**\n\n` +
      modifiedCritical.map((f) => `- \`${f}\``).join("\n") +
      "\n\n_Vui lòng kiểm tra kỹ trước khi merge. Cần test lại deploy._"
  );
}

// ─────────────────────────────────────────────────────────
// 5. Nhắc viết test khi thêm code mới (backend/ai-core)
// ─────────────────────────────────────────────────────────
const newSourceFiles = git.created_files.filter(
  (f) =>
    (f.startsWith("backend/src/") && f.endsWith(".ts")) ||
    (f.startsWith("ai-core/") && f.endsWith(".py"))
);
const newTestFiles = git.created_files.filter(
  (f) => f.includes(".spec.") || f.includes("_test.") || f.includes("test_")
);

if (newSourceFiles.length > 0 && newTestFiles.length === 0) {
  warn(
    `🧪 **Bạn thêm ${newSourceFiles.length} file source mới nhưng không có test.**\n\n` +
      "Files mới:\n" +
      newSourceFiles.map((f) => `- \`${f}\``).join("\n") +
      "\n\n_Cân nhắc viết unit test để đảm bảo chất lượng code._"
  );
}

// ─────────────────────────────────────────────────────────
// 6. Kiểm tra PR title theo quy ước
// ─────────────────────────────────────────────────────────
const CONVENTIONAL_COMMIT = /^(feat|fix|docs|style|refactor|test|chore|perf|ci)(\(.+\))?: .{5,}/;
if (!CONVENTIONAL_COMMIT.test(pr.title)) {
  warn(
    `📝 **Tiêu đề PR chưa theo quy chuẩn Conventional Commits.**\n\n` +
      `Tiêu đề hiện tại: \`${pr.title}\`\n\n` +
      "**Định dạng:** `<type>(<scope>): <mô tả>`\n\n" +
      "**Ví dụ hợp lệ:**\n" +
      "- `feat(ai-core): thêm tính năng tóm tắt tài liệu`\n" +
      "- `fix(backend): sửa lỗi xác thực JWT`\n" +
      "- `docs: cập nhật README hướng dẫn deploy`\n\n" +
      "**Types:** `feat` `fix` `docs` `style` `refactor` `test` `chore` `perf` `ci`"
  );
}

// ─────────────────────────────────────────────────────────
// 7. Cảnh báo khi xóa nhiều file
// ─────────────────────────────────────────────────────────
if (git.deleted_files.length > 5) {
  warn(
    `🗑️ **PR này xóa ${git.deleted_files.length} file.**\n\n` +
      "Hãy đảm bảo không xóa nhầm file quan trọng."
  );
}

// ─────────────────────────────────────────────────────────
// 8. Thông báo tổng kết (luôn hiển thị)
// ─────────────────────────────────────────────────────────
message(
  `📊 **Tóm tắt PR:**\n` +
    `- ➕ ${pr.additions} dòng thêm  ➖ ${pr.deletions} dòng xóa\n` +
    `- 📁 ${git.modified_files.length} file sửa | ` +
    `🆕 ${git.created_files.length} file mới | ` +
    `🗑️ ${git.deleted_files.length} file xóa\n` +
    `- 👤 Tác giả: @${pr.user.login}`
);
