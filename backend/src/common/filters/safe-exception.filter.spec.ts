import { ArgumentsHost, HttpException } from '@nestjs/common';
import { SafeExceptionFilter } from './safe-exception.filter';

describe('SafeExceptionFilter', () => {
  /** Ghi nhận phản hồi HTTP mà không khởi động máy chủ thật. */
  function capture(exception: HttpException, path: string) {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = { switchToHttp: () => ({
      getRequest: () => ({ requestId: 'request-gia-lap', method: 'POST', path }),
      getResponse: () => ({ status }),
    }) } as ArgumentsHost;
    new SafeExceptionFilter().catch(exception, host);
    return { json, status };
  }

  it('che nội dung ngoại lệ và giữ requestId trong phản hồi', () => {
    // Thông điệp gốc giả lập chứa bí mật không được xuất hiện trong JSON trả về.
    const { json, status } = capture(new HttpException('token-rieng-tu', 500), '/legal/ingest-url');
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      statusCode: 500, requestId: 'request-gia-lap',
      message: 'Đã xảy ra lỗi hệ thống. Vui lòng thử lại sau.',
    }));
    expect(JSON.stringify(json.mock.calls)).not.toContain('token-rieng-tu');
  });

  it('hiển thị nguyên nhân nạp URL đã được phép công khai', () => {
    const reason = 'Trang web nguồn từ chối truy cập (403 Forbidden). Vui lòng tải file hoặc copy nội dung văn bản trực tiếp.';
    const { json, status } = capture(new HttpException(reason, 400), '/legal/ingest-url');
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ message: reason }));
  });

  it('che lỗi URL không nằm trong danh sách và lỗi tại route khác', () => {
    const secret = 'URL có token-rieng-tu trong chuỗi lỗi';
    const unknown = capture(new HttpException(secret, 400), '/legal/ingest-url');
    const unrelated = capture(new HttpException('Không xác minh được địa chỉ URL nạp văn bản.', 400), '/chat');
    for (const result of [unknown, unrelated]) {
      expect(result.json).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Yêu cầu không hợp lệ. Vui lòng kiểm tra dữ liệu đã nhập.',
      }));
    }
    expect(JSON.stringify(unknown.json.mock.calls)).not.toContain('token-rieng-tu');
  });
});
