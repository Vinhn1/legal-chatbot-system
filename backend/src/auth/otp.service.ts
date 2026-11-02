import { BadRequestException, Injectable, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'crypto';
import { EmailService } from '../email/email.service';
import { jwtSecret } from './security-config';

export type OtpPurpose = 'login' | 'password_reset' | 'toggle_2fa' | 'phone_change';

/** Challenge độc lập, giới hạn thử bền vững và cập nhật tài khoản trong cùng transaction. */
@Injectable()
export class OtpService {
  constructor(private readonly db: DataSource, private readonly email: EmailService, private readonly config: ConfigService) {}

  private digest(id: string, code: string): string {
    return createHmac('sha256', jwtSecret(this.config)).update(`${id}:${code}`).digest('hex');
  }

  async issue(userId: number, email: string, purpose: OtpPurpose, target = '') {
    if (!email) throw new BadRequestException('Tài khoản chưa cấu hình email xác thực.');
    const challengeId = randomUUID();
    const code = randomInt(100000, 1000000).toString();
    await this.db.transaction(async manager => {
      // Khóa tài khoản để hai yêu cầu gửi mã đồng thời không vượt qua cooldown.
      await manager.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const recent = await manager.query("SELECT id FROM auth_challenges WHERE user_id=$1 AND purpose=$2 AND created_at > NOW() - INTERVAL '60 seconds' LIMIT 1", [userId, purpose]);
      if (recent.length) throw new HttpException('Vui lòng chờ trước khi yêu cầu mã mới.', 429);
      await manager.query('UPDATE auth_challenges SET consumed_at=NOW() WHERE user_id=$1 AND purpose=$2 AND consumed_at IS NULL', [userId, purpose]);
      await manager.query("INSERT INTO auth_challenges(id,user_id,purpose,code_hash,target,expires_at,account_version) SELECT $1,id,$3,$4,$5,NOW()+INTERVAL '3 minutes',token_version FROM users WHERE id=$2", [challengeId, userId, purpose, this.digest(challengeId, code), target]);
    });
    if (!(await this.email.sendOtpEmail(email, code))) {
      await this.db.query('UPDATE auth_challenges SET consumed_at=NOW() WHERE id=$1', [challengeId]);
      throw new BadRequestException('Không thể gửi email xác thực.');
    }
    return { success: true, challengeId, expiresIn: 180, message: 'Mã xác thực đã được gửi qua email.' };
  }

  async verify<T>(id: string, code: string, purpose: OtpPurpose, userId: number | undefined,
    target: string | undefined, consume: boolean, action: (manager: EntityManager, accountId: number) => Promise<T>): Promise<T> {
    if (!/^[0-9a-f-]{36}$/i.test(id || '') || !/^\d{6}$/.test(code || '')) throw new BadRequestException('Challenge hoặc mã xác thực không hợp lệ.');
    const outcome = await this.db.transaction(async manager => {
      // Luôn khóa tài khoản trước challenge, cùng thứ tự với thao tác phát hành mã.
      const owners = await manager.query('SELECT user_id FROM auth_challenges WHERE id=$1', [id]);
      if (!owners.length) return { valid: false as const };
      const accounts = await manager.query('SELECT token_version FROM users WHERE id=$1 FOR UPDATE', [owners[0].user_id]);
      const rows = await manager.query('SELECT * FROM auth_challenges WHERE id=$1 FOR UPDATE', [id]);
      const row = rows[0];
      if (!row || !accounts.length || row.consumed_at || new Date(row.expires_at).getTime() <= Date.now() || row.attempts >= 5) return { valid: false as const };
      // Ghi số lần thử ngay cả khi sai mục đích hoặc sai tài khoản; không rollback khi mã sai.
      await manager.query('UPDATE auth_challenges SET attempts=attempts+1 WHERE id=$1', [id]);
      const expected = Buffer.from(row.code_hash, 'hex');
      const actual = Buffer.from(this.digest(id, code), 'hex');
      if (row.purpose !== purpose || (userId !== undefined && row.user_id !== userId)
        || (target !== undefined && row.target !== target) || row.account_version !== accounts[0].token_version
        || expected.length !== actual.length || !timingSafeEqual(expected, actual)) return { valid: false as const };
      if (consume) await manager.query('UPDATE auth_challenges SET consumed_at=NOW() WHERE id=$1', [id]);
      return { valid: true as const, value: await action(manager, row.user_id) };
    });
    if (!outcome.valid) throw new BadRequestException('Mã xác thực không hợp lệ, đã dùng hoặc đã hết hạn.');
    return outcome.value;
  }
}
