import { ExecutionContext, HttpException } from '@nestjs/common';
import { RateLimiterGuard } from './rate-limiter.guard';

describe('RateLimiterGuard', () => {
  it('giới hạn 30 yêu cầu trong 60 giây cho cùng một địa chỉ', () => {
    const guard = new RateLimiterGuard();
    const context = { switchToHttp: () => ({ getRequest: () => ({ ip: '203.0.113.1' }) }) } as ExecutionContext;
    // Một sessionId tự thay đổi không ảnh hưởng đến hạn mức theo địa chỉ kết nối.
    for (let index = 0; index < 30; index++) expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow(HttpException);
    try {
      guard.canActivate(context);
    } catch (error) {
      expect((error as HttpException).getStatus()).toBe(429);
    }
  });
});
