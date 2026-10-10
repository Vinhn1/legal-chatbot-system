/** Chuẩn hóa gốc API để mọi màn hình dùng cùng đường dẫn POST /chat. */
export const API_BASE = (import.meta.env.VITE_API_URL || "/api").replace(/\/+$/, "");

/** Trả URL tuyệt đối cho các thành phần cần mở liên kết tới backend. */
export const getAbsoluteApiUrl = (path: string): string => {
  if (API_BASE.startsWith("http://") || API_BASE.startsWith("https://")) {
    return `${API_BASE}${path}`;
  }
  return `${window.location.origin}${API_BASE}${path}`;
};
