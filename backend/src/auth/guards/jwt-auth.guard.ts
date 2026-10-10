import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    // Kế thừa và kích hoạt cơ chế canActivate của Passport Jwt
    return super.canActivate(context);
  }

  // Tùy biến thông điệp lỗi khi Token không hợp lệ hoặc không có Token
  handleRequest(err, user, info) {
    if (err || !user) {
      throw err || new UnauthorizedException('Bạn chưa đăng nhập hoặc Token không hợp lệ');
    }
    return user;
  }
}
