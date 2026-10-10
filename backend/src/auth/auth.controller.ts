import { Controller, Post, Body, UnauthorizedException, ForbiddenException, HttpCode, HttpStatus, Request, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Controller('auth')
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
    const { username, password } = body;
    
    // 1. Xác thực tài khoản
    const user = await this.authService.validateUser(username, password);
    if (!user) {
      throw new UnauthorizedException('Tài khoản hoặc mật khẩu không chính xác');
    }

    // 1b. Nếu đã kích hoạt 2FA, yêu cầu mã OTP
    if (user.twoFaEnabled) {
      await this.authService.sendLogin2FaOtp(user.id);
      return { require2fa: true, username: user.username };
    }

    // 2. Sinh và trả về JWT Token
    return this.authService.login(user);
  }

  // Route POST /auth/verify-2fa để hoàn tất đăng nhập sau khi nhập OTP
  @Post('verify-2fa')
  @HttpCode(HttpStatus.OK)
  async verify2Fa(@Body() body: any) {
    const { username, otpCode } = body;
    return await this.authService.verify2FaLogin(username, otpCode);
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
  async forgotPassword(@Body('email') email: string) {
    return await this.authService.sendResetPasswordOtp(email);
  }

  // 2. Xác thực OTP khôi phục mật khẩu
  @Post('verify-reset-otp')
  @HttpCode(HttpStatus.OK)
  async verifyResetOtp(
    @Body('email') email: string,
    @Body('otpCode') otpCode: string,
  ) {
    return await this.authService.verifyResetPasswordOtp(email, otpCode);
  }

  // 3. Đặt lại mật khẩu mới sau khi xác thực OTP thành công
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body('email') email: string,
    @Body('otpCode') otpCode: string,
    @Body('password') pass: string,
  ) {
    return await this.authService.resetPassword(email, otpCode, pass);
  }
}


