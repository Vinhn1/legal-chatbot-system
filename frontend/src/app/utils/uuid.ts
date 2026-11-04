/**
 * Tạo mã UUID v4 an toàn cho mọi trình duyệt và ngữ cảnh kết nối.
 * Tránh lỗi 'TypeError: crypto.randomUUID is not a function' khi chạy qua HTTP trên địa chỉ IP máy chủ.
 */
export function generateUUID(): string {
  if (typeof window !== "undefined" && window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  // Thuật toán chuẩn RFC4122 v4 dự phòng khi window.crypto.randomUUID bị vô hiệu hóa trong Insecure Context (HTTP)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

