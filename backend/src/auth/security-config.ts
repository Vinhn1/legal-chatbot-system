import { ConfigService } from '@nestjs/config';

/** Dừng khởi động khi thiếu khóa đủ mạnh; không dùng khóa dự phòng. */
export function jwtSecret(config: ConfigService): string {
  const secret = config.get<string>('JWT_SECRET');
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET phải có ít nhất 32 ký tự.');
  return secret;
}
