import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { UnauthorizedException } from '@nestjs/common';

/** Capability riêng của phiên công khai; không dùng UUID đơn lẻ làm quyền đọc ngữ cảnh. */
export function publicSession(secret: string, id?: string, token?: string) {
  const digest = (value: string) => createHmac('sha256', secret).update(`public-session:${value}`).digest('hex');
  if (!token) {
    const sessionId = randomUUID();
    const payload = `${sessionId}.${Date.now() + 24 * 60 * 60 * 1000}`;
    return { sessionId, sessionToken: `${payload}.${digest(payload)}` };
  }
  const parts = typeof token === 'string' ? token.split('.') : [];
  const payload = parts.slice(0, 2).join('.');
  const actual = Buffer.from(parts[2] || '', 'hex');
  const expected = Buffer.from(digest(payload), 'hex');
  if (parts.length !== 3 || !/^[a-f0-9]{64}$/.test(parts[2] || '') || parts[0] !== id || !/^[0-9a-f-]{36}$/i.test(id || '') || Number(parts[1]) <= Date.now()
    || !Number.isFinite(Number(parts[1])) || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new UnauthorizedException('Phiên hội thoại không hợp lệ hoặc đã hết hạn.');
  }
  return { sessionId: id!, sessionToken: token };
}
