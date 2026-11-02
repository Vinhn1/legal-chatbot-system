import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { createHmac } from 'crypto';
import { jwtSecret } from './security-config';

/** Giới hạn theo IP, định danh và challenge; dùng PostgreSQL chung cho nhiều tiến trình. */
@Injectable()
export class AuthRateGuard implements CanActivate {
  constructor(private readonly db: DataSource, private readonly config: ConfigService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const route = String(req.route?.path || context.getHandler().name);
    const hash = (value: string) => createHmac('sha256', jwtSecret(this.config)).update(value).digest('hex');
    const account = req.body?.username || req.body?.email || String(req.user?.userId || '');
    const keys: Array<[string, number]> = [[`ip:${req.ip}`, 100]];
    if (typeof account === 'string' && account) keys.push([`account:${route}:${account.toLowerCase().trim()}`, 15]);
    if (typeof req.body?.challengeId === 'string') keys.push([`challenge:${req.body.challengeId}`, 10]);
    for (const [key, limit] of keys) {
      const rows = await this.db.query(`INSERT INTO auth_rate_limits(key,hits,expires_at) VALUES($1,1,NOW()+INTERVAL '10 minutes')
        ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN auth_rate_limits.expires_at <= NOW() THEN 1 ELSE auth_rate_limits.hits+1 END,
        expires_at=CASE WHEN auth_rate_limits.expires_at <= NOW() THEN NOW()+INTERVAL '10 minutes' ELSE auth_rate_limits.expires_at END RETURNING hits`, [hash(key)]);
      if (rows[0].hits > limit) { response.setHeader('Retry-After', '600'); throw new HttpException('Quá nhiều lần xác thực. Vui lòng thử lại sau.', 429); }
    }
    // Chỉ xóa cửa sổ đã hết hạn; không lưu IP/email nguyên văn.
    await this.db.query('DELETE FROM auth_rate_limits WHERE expires_at < NOW()');
    return true;
  }
}
