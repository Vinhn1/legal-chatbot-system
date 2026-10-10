import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { EmailService } from '../email/email.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly emailService: EmailService,
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
    return this.usersService.request2FaOtp(userId);
  }

  async verify2FaLogin(username: string, otpCode: string) {
    const user = await this.usersService.verify2FaOtp(username, otpCode);
    return this.login(user);
  }

  async sendResetPasswordOtp(email: string) {
    if (!email || !email.includes('@')) {
      throw new BadRequestException('Địa chỉ email không hợp lệ.');
    }
    const user = await this.usersService.findByEmail(email.toLowerCase().trim());
    if (!user) {
      throw new NotFoundException('Không tìm thấy tài khoản liên kết với email này.');
    }
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otpCode = otp;
    user.otpCreatedAt = new Date();
    await this.usersService.saveUser(user);
    if (!(await this.emailService.sendOtpEmail(email, otp))) {
      throw new BadRequestException('Không thể gửi email xác thực.');
    }
    return { success: true, message: 'Mã xác thực đã được gửi qua email.' };
  }

  private async getUserWithValidOtp(email: string, otpCode: string) {
    if (!email || !otpCode) {
      throw new BadRequestException('Thiếu email hoặc mã xác thực.');
    }
    const user = await this.usersService.findByEmail(email.toLowerCase().trim());
    if (!user) {
      throw new NotFoundException('Không tìm thấy tài khoản liên kết với email này.');
    }
    const elapsed = user.otpCreatedAt ? Date.now() - new Date(user.otpCreatedAt).getTime() : Infinity;
    if (!user.otpCode || user.otpCode !== otpCode || elapsed > 3 * 60 * 1000) {
      throw new BadRequestException('Mã xác thực không hợp lệ hoặc đã hết hạn.');
    }
    return user;
  }

  async verifyResetPasswordOtp(email: string, otpCode: string) {
    await this.getUserWithValidOtp(email, otpCode);
    return { success: true, message: 'Mã xác thực hợp lệ.' };
  }

  async resetPassword(email: string, otpCode: string, pass: string) {
    if (!pass) {
      throw new BadRequestException('Thiếu mật khẩu mới.');
    }
    const user = await this.getUserWithValidOtp(email, otpCode);
    user.password = await bcrypt.hash(pass, 10);
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    user.otpCode = null;
    user.otpCreatedAt = null;
    await this.usersService.saveUser(user);
    return { success: true, message: 'Đặt lại mật khẩu thành công.' };
  }

  /** Thu hồi phiên khi nhận yêu cầu đăng xuất đã xác thực. */
  logout(userId: number) { return this.usersService.revokeSessions(userId); }
}
