import { Controller, Post, Body, UnauthorizedException, ForbiddenException, HttpCode, HttpStatus, Request, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthRateGuard } from './auth-rate.guard';
import { authInput } from './auth-input';

@Controller('auth')
@UseGuards(AuthRateGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Đăng xuất thu hồi JWT hiện hành và mọi phiên cũ của tài khoản.
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logout(@Request() req: any) {
    await this.authService.logout(req.user.userId);
    return { success: true };
  }

  // Route POST /auth/login dùng để đăng nhập hệ thống Admin
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() body: any) {
    const { username } = authInput(body, { username: 'identifier' });
    // Mật khẩu cũ ngắn vẫn được phép đăng nhập; chính sách 8 ký tự áp dụng khi tạo/đổi.
    const password = body.password;
    if (typeof password !== 'string' || !password || password.length > 128) throw new UnauthorizedException('Thông tin đăng nhập không hợp lệ.');
    
    // 1. Xác thực tài khoản
    const user = await this.authService.validateUser(username, password);
    if (!user) {
      throw new UnauthorizedException('Tài khoản hoặc mật khẩu không chính xác');
    }

    // 1b. Nếu đã kích hoạt 2FA, yêu cầu mã OTP
    if (user.twoFaEnabled) {
      const challenge = await this.authService.sendLogin2FaOtp(user.id);
      return { require2fa: true, username: user.username, ...challenge };
    }

    // 2. Sinh và trả về JWT Token
    return this.authService.login(user);
  }

  // Route POST /auth/verify-2fa để hoàn tất đăng nhập sau khi nhập OTP
  @Post('verify-2fa')
  @HttpCode(HttpStatus.OK)
  async verify2Fa(@Body() body: any) {
    const { username, otpCode, challengeId } = authInput(body, { username: 'identifier', otpCode: 'otp', challengeId: 'challenge' });
    return await this.authService.verify2FaLogin(username, otpCode, challengeId);
  }

  // Đăng nhập 1-Click dành cho khách truy cập trải nghiệm hệ thống
  @Post('demo-login')
  @HttpCode(HttpStatus.OK)
  async demoLogin(@Body('role') role: string) {
    return await this.authService.demoLogin(role || 'admin');
  }

  @Post('register')
  @HttpCode(HttpStatus.FORBIDDEN)
  async register() {
    throw new ForbiddenException(
      'Đăng ký tài khoản không được phép. Vui lòng liên hệ quản trị viên để được cấp quyền truy cập hệ thống.',
    );
  }

  // 1. Gửi OTP khôi phục mật khẩu qua Email
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() body: unknown) {
    const { email } = authInput(body, { email: 'email' });
    return await this.authService.sendResetPasswordOtp(email);
  }

  // 2. Xác thực OTP khôi phục mật khẩu
  @Post('verify-reset-otp')
  @HttpCode(HttpStatus.OK)
  async verifyResetOtp(
    @Body() body: unknown,
  ) {
    const { email, otpCode, challengeId } = authInput(body, { email: 'email', otpCode: 'otp', challengeId: 'challenge' });
    return await this.authService.verifyResetPasswordOtp(email, otpCode, challengeId);
  }

  // 3. Đặt lại mật khẩu mới sau khi xác thực OTP thành công
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() body: unknown,
  ) {
    const { email, otpCode, password, challengeId } = authInput(body, { email: 'email', otpCode: 'otp', password: 'password', challengeId: 'challenge' });
    return await this.authService.resetPassword(email, otpCode, password, challengeId);
  }
}


