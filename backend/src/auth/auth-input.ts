import { BadRequestException } from '@nestjs/common';

/** Kiểm tra hợp đồng xác thực ở server, không ép kiểu đối tượng đầu vào. */
export function authInput(body: unknown, fields: Record<string, 'email' | 'password' | 'identifier' | 'otp' | 'challenge'>): Record<string, string> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Dữ liệu xác thực không hợp lệ.');
  const result: Record<string, string> = {};
  for (const [name, kind] of Object.entries(fields)) {
    const value = (body as Record<string, unknown>)[name];
    if (typeof value !== 'string') throw new BadRequestException('Thiếu trường xác thực bắt buộc.');
    const valid = kind === 'email' ? value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
      : kind === 'password' ? value.length >= 8 && value.length <= 128
      : kind === 'identifier' ? value.trim().length > 0 && value.length <= 254
      : kind === 'otp' ? /^\d{6}$/.test(value)
      : /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    if (!valid) throw new BadRequestException('Trường xác thực không hợp lệ.');
    result[name] = kind === 'email' ? value.toLowerCase().trim() : value;
  }
  return result;
}
