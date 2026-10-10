import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly transporter: nodemailer.Transporter | null;
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly configService: ConfigService) {
    const host = this.configService.get<string>('SMTP_HOST');
    const port = this.configService.get<number>('SMTP_PORT', 587);
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');
    this.transporter = host && user && pass
      ? nodemailer.createTransport({ host, port, secure: Number(port) === 465, auth: { user, pass } })
      : null;
  }

  async sendOtpEmail(to: string, otpCode: string): Promise<boolean> {
    if (!this.transporter) {
      this.logger.warn('SMTP chưa được cấu hình; không thể gửi mã xác thực.');
      return false;
    }
    try {
      await this.transporter.sendMail({
        from: this.configService.get<string>('SMTP_FROM', 'Legal Chatbot'),
        to,
        subject: 'Mã xác thực tài khoản Legal Chatbot',
        text: `Mã xác thực của bạn: ${otpCode}. Mã có hiệu lực trong 3 phút.`,
      });
      return true;
    } catch {
      this.logger.error('Không thể gửi mã xác thực qua SMTP.');
      return false;
    }
  }
}
