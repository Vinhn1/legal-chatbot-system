import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';

// Chỉ các thông báo cố định từ luồng nạp URL được phép hiển thị cho quản trị viên.
const SAFE_URL_INGEST_MESSAGES = new Set([
  'URL nạp văn bản không hợp lệ.',
  'Chỉ chấp nhận URL HTTP(S) công khai.',
  'Không được nạp văn bản từ địa chỉ nội bộ.',
  'Không xác minh được địa chỉ URL nạp văn bản.',
  'Trang nguồn chuyển hướng không hợp lệ.',
  'Trang nguồn chuyển hướng quá nhiều lần.',
  'URL không trỏ đến trang HTML.',
  'Trang web vượt quá giới hạn 15 MB.',
  'Trang web nguồn từ chối truy cập (403 Forbidden). Vui lòng tải file hoặc copy nội dung văn bản trực tiếp.',
  'Không tìm thấy trang web nguồn (404 Not Found). Vui lòng kiểm tra lại đường dẫn URL.',
  'Trang web nguồn trả về lỗi HTTP không xác định.',
  'Hết thời gian chờ phản hồi từ trang web nguồn (quá 30 giây).',
  'Lỗi xác thực chứng chỉ SSL/TLS của trang web nguồn.',
  'Không thể kết nối đến máy chủ trang nguồn. Vui lòng kiểm tra lại URL hoặc kết nối mạng.',
  'Không tải được trang nguồn công khai do lỗi yêu cầu HTTP.',
  'Trang nguồn không chứa nội dung văn bản tiếng Việt có dấu có thể xác minh.',
  'Không trích xuất được nội dung văn bản từ URL.',
  'Không tạo được đoạn văn bản để lập chỉ mục.',
]);

// Các thông báo nghiệp vụ cố định cho luồng nạp tệp và OCR của quản trị viên.
const SAFE_LEGAL_ADMIN_MESSAGES = new Set([
  'Thiếu tệp văn bản pháp luật cần OCR.',
  'Tệp tải lên phải là định dạng PDF hợp lệ.',
  'Không nhận diện được chữ tiếng Việt rõ ràng từ tệp PDF scan này. Vui lòng dán nội dung văn bản trực tiếp vào ô bên dưới.',
  'Thiếu tệp văn bản pháp luật.',
  'Metadata phải là JSON hợp lệ.',
  'Metadata nạp tài liệu phải là chuỗi JSON hợp lệ.',
  'Cờ lập chỉ mục theo đoạn văn không hợp lệ.',
  'Yêu cầu tải lên tệp PDF, DOCX hoặc TXT không rỗng.',
  'Vui lòng cung cấp tệp PDF, DOCX hoặc TXT có nội dung.',
  'Chỉ hỗ trợ tệp PDF, DOCX hoặc TXT.',
  'Không trích xuất được nội dung văn bản từ tệp tải lên.',
  'Không tạo được đoạn văn bản để lập chỉ mục.',
  'Vui lòng dán nội dung văn bản.',
  'Vui lòng nhập nội dung văn bản cần nạp.',
  'Văn bản vượt quá giới hạn 15 MB.',
]);

/** Chỉ nhận lời nhắn đã biết; không chuyển tiếp dữ liệu tùy ý từ nguồn ngoài. */
function safeUrlIngestMessage(exception: unknown, request: Request, statusCode: number): string | null {
  if (statusCode !== 400 || !(exception instanceof HttpException)) {
    return null;
  }
  const body = exception.getResponse();
  const detail = typeof body === 'string' ? body :
    typeof body === 'object' && body !== null && 'message' in body ? body.message : null;
  if (typeof detail !== 'string') return null;
  const path = request.path || '';
  if (path.endsWith('/legal/ingest-url')) {
    if (SAFE_URL_INGEST_MESSAGES.has(detail)) return detail;
    if (/^Máy chủ trang nguồn gặp sự cố \(mã phản hồi 5\d{2}\)\.$/.test(detail)) return detail;
    if (/^Trang web nguồn từ chối yêu cầu \(mã phản hồi 4\d{2}\)\.$/.test(detail)) return detail;
  }
  if (
    path.endsWith('/legal/ocr') ||
    path.endsWith('/legal/ingest') ||
    path.endsWith('/legal/ingest-text') ||
    path.endsWith('/legal/extract-metadata')
  ) {
    if (SAFE_LEGAL_ADMIN_MESSAGES.has(detail)) return detail;
  }
  return null;
}

/** Phản hồi lỗi chỉ chứa mã và lời nhắn đã kiểm soát, không lộ ngoại lệ gốc. */
@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SafeExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request & { requestId?: string }>();
    const response = http.getResponse<Response>();
    const rawStatus = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const statusCode = rawStatus >= 400 && rawStatus < 600 ? rawStatus : HttpStatus.INTERNAL_SERVER_ERROR;
    const requestId = request.requestId || randomUUID();
    const timestamp = new Date().toISOString();
    const messages: Record<number, string> = {
      400: 'Yêu cầu không hợp lệ. Vui lòng kiểm tra dữ liệu đã nhập.',
      401: 'Vui lòng đăng nhập để tiếp tục.',
      403: 'Bạn không có quyền thực hiện thao tác này.',
      404: 'Không tìm thấy tài nguyên được yêu cầu.',
      413: 'Tệp tải lên vượt quá dung lượng cho phép.',
      422: 'Dữ liệu gửi lên không hợp lệ.',
      429: 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau một phút.',
      502: 'Dịch vụ tra cứu hiện chưa sẵn sàng.',
      503: 'Dịch vụ tra cứu hiện chưa sẵn sàng.',
    };
    const message = safeUrlIngestMessage(exception, request, statusCode) ||
      messages[statusCode] || 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.';
    // Chỉ ghi mã lỗi và định danh; tuyệt đối không ghi body, URL, stack hoặc thông điệp gốc.
    this.logger.warn(JSON.stringify({ requestId, timestamp, method: request.method, statusCode }));
    response.status(statusCode).json({ statusCode, message, timestamp, requestId });
  }
}
