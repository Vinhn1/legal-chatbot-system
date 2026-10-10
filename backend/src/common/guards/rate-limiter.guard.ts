import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';

/** Giới hạn trượt 30 yêu cầu chat mỗi 60 giây theo địa chỉ kết nối. */
@Injectable()
export class RateLimiterGuard implements CanActivate {
  private readonly requests = new Map<string, number[]>();
  private readonly windowMs = 60_000;
  private readonly maxRequests = 30;

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    // Chỉ dùng địa chỉ do máy chủ xác nhận; sessionId do client tự đặt có thể đổi liên tục.
    const address = request.ip || request.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const recent = (this.requests.get(address) ?? []).filter(time => now - time < this.windowMs);
    if (recent.length >= this.maxRequests) {
      this.requests.set(address, recent);
      throw new HttpException('Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau một phút.', HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    this.requests.set(address, recent);
    // Dọn khóa hết hạn để lưu lượng từ nhiều IP không làm tăng bộ nhớ vô hạn.
    if (this.requests.size > 10_000) {
      for (const [key, times] of this.requests) {
        if (times[times.length - 1] <= now - this.windowMs || this.requests.size > 10_000) this.requests.delete(key);
      }
    }
    return true;
  }
}
