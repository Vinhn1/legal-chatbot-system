/** Ẩn định danh thường gặp trước khi lưu hội thoại; nguồn pháp luật gốc không bị thay đổi. */
export function redactConversation(value: string): string {
  return value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email đã ẩn]')
    .replace(/\b(?:0\d{9}|\d{12})\b/g, '[định danh đã ẩn]');
}
