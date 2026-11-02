import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';
import { jwtSecret } from '../security-config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService, private readonly usersService: UsersService) {
    super({
      // Chỉ nhận bearer header để token không xuất hiện trong URL và lịch sử trình duyệt.
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret(configService),
    });
  }

  // Hàm này tự động chạy sau khi Passport giải mã token thành công
  async validate(payload: any) {
    // So sánh phiên bản JWT với tài khoản đang lưu để thu hồi phiên cũ.
    const user = await this.usersService.getProfile(payload.sub).catch(() => null);
    if (!user || payload.version !== (user.tokenVersion || 0) || payload.role !== user.role) {
      throw new UnauthorizedException('Phiên làm việc không còn hiệu lực.');
    }
    // Giá trị trả về ở đây sẽ được gán vào request.user
    return {
      userId: payload.sub,
      username: payload.username,
      phoneNumber: payload.phoneNumber,
      role: payload.role || 'user',
    };
  }
}
