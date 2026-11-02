import { BadRequestException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { EmailService } from '../email/email.service';
import { OtpService } from './otp.service';
import { randomUUID } from 'crypto';
import { User } from '../users/user.entity';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
    private readonly otp?: OtpService,
  ) {}

  async validateUser(username: string, pass: string) {
    const user = await this.usersService.findByUsername(username);
    if (!user || !pass || !(await bcrypt.compare(pass, user.password))) {
      return null;
    }
    const { password, ...result } = user;
    return result;
  }

  login(user: any) {
    const payload = { username: user.username, sub: user.id, role: user.role, version: user.tokenVersion || 0 };
    const { password, otpCode, otpCreatedAt, tokenVersion, ...publicUser } = user;
    return { access_token: this.jwtService.sign(payload), user: publicUser };
  }

  sendLogin2FaOtp(userId: number) {
    return this.usersService.requestLoginOtp(userId);
  }

  async verify2FaLogin(username: string, otpCode: string, challengeId: string) {
    const user = await this.usersService.verify2FaOtp(username, otpCode, challengeId);
    return this.login(user);
  }

  async sendResetPasswordOtp(email: string) {
    if (!email || !email.includes('@')) {
      throw new BadRequestException('Địa chỉ email không hợp lệ.');
    }
    const user = await this.usersService.findByEmail(email.toLowerCase().trim());
    // Cùng cấu trúc và thông báo cho tài khoản có/không tồn tại, kể cả lỗi gửi email.
    let challengeId = randomUUID();
    if (user) {
      try { challengeId = (await this.otp!.issue(user.id, user.email!, 'password_reset', email.toLowerCase().trim())).challengeId; }
      catch { /* Không tiết lộ trạng thái tài khoản qua lỗi gửi mã hoặc cooldown. */ }
    }
    return { success: true, challengeId, expiresIn: 180, message: 'Nếu tài khoản tồn tại, mã xác thực sẽ được gửi qua email.' };
  }

  async verifyResetPasswordOtp(email: string, otpCode: string, challengeId: string) {
    await this.otp!.verify(challengeId, otpCode, 'password_reset', undefined, email.toLowerCase().trim(), false, async () => true);
    return { success: true, message: 'Mã xác thực hợp lệ.' };
  }

  async resetPassword(email: string, otpCode: string, pass: string, challengeId: string) {
    if (typeof pass !== 'string' || pass.length < 8 || pass.length > 128) throw new BadRequestException('Mật khẩu phải có từ 8 đến 128 ký tự.');
    const password = await bcrypt.hash(pass, 10);
    // Đổi mật khẩu và tiêu thụ challenge trong cùng transaction để chống hai request đồng thời.
    await this.otp!.verify(challengeId, otpCode, 'password_reset', undefined, email.toLowerCase().trim(), true, async (manager, id) => {
      await manager.update(User, id, { password, tokenVersion: () => 'token_version + 1', otpCode: null, otpCreatedAt: null });
    });
    return { success: true, message: 'Đặt lại mật khẩu thành công.' };
  }

  /** Thu hồi phiên khi nhận yêu cầu đăng xuất đã xác thực. */
  logout(userId: number) { return this.usersService.revokeSessions(userId); }
}
