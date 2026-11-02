import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { OtpService } from './otp.service';
import { AuthRateGuard } from './auth-rate.guard';

/** Chia sẻ challenge giữa xác thực và quản lý tài khoản, không tạo phụ thuộc vòng. */
@Module({ imports: [EmailModule], providers: [OtpService, AuthRateGuard], exports: [OtpService, AuthRateGuard] })
export class OtpModule {}
