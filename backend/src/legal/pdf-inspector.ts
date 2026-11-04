/**
 * Mô-đun phân tích nhanh định dạng và cấu trúc nhị phân của tệp PDF.
 * Phục vụ phân loại thông minh giữa tệp PDF số hóa (Native Text) và tệp PDF scan (Scanned Images).
 */

/**
 * Kiểm tra xem buffer của tệp PDF có phải là dạng scan (ảnh thuần túy, không có text layer số hóa) hay không.
 * 
 * Nguyên tắc kiểm tra heuristic nhanh (< 1ms):
 * 1. Quét tìm các định nghĩa font (/Font hoặc /Type /Font) trong luồng nhị phân PDF.
 *    Nếu hoàn toàn không có /Font, tài liệu 100% không chứa văn bản số hóa.
 * 2. Đếm các khối toán tử văn bản PDF (BT = Begin Text, ET = End Text).
 *    Nếu số khối văn bản quá ít (< 3 khối trong toàn bộ tệp), tài liệu là dạng scan ảnh.
 */
export function isScannedPdfBuffer(buffer: Buffer): boolean {
  if (!buffer || buffer.length === 0) return true;

  // Chuyển đổi buffer sang chuỗi ký tự chuẩn Latin1 để quét nhanh toán tử PDF không tốn bộ nhớ
  const str = buffer.toString('latin1');

  // Kiểm tra sự xuất hiện của từ khóa font trong cấu trúc PDF
  const hasFont = /\/(?:Type\s*\/)?Font\b/i.test(str);
  if (!hasFont) {
    return true; // Không có font nào được nhúng hoặc tham chiếu -> dạng scan ảnh
  }

  // Đếm các khối toán tử bắt đầu vẽ văn bản (BT)
  const btMatches = str.match(/\bBT\b/g);
  if (!btMatches || btMatches.length < 3) {
    return true; // Quá ít khối vẽ văn bản -> dạng scan
  }

  return false;
}

