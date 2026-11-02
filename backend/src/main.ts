import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SafeExceptionFilter } from './common/filters/safe-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Chỉ tin cậy các dải IP nội bộ hoặc loopback từ reverse proxy (tránh giả mạo X-Forwarded-For)
  const trustProxyConfig = process.env.TRUST_PROXY ?? 'loopback, linklocal, uniquelocal';
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxyConfig);
  const accessLogger = new Logger('HttpAccess');
  // Tạo mã yêu cầu tại máy chủ, ghi log và thiết lập các tiêu đề an ninh HTTP
  app.use((request: Request & { requestId?: string }, response: Response, next: NextFunction) => {
    const requestId = randomUUID();
    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
    response.setHeader('X-Frame-Options', 'SAMEORIGIN');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.on('finish', () => accessLogger.log(JSON.stringify({
      requestId, timestamp: new Date().toISOString(), method: request.method, statusCode: response.statusCode,
    })));
    next();
  });
  app.useGlobalFilters(new SafeExceptionFilter());

  // Kích hoạt CORS với các domain được cấu hình trong biến môi trường
  const corsOrigins = process.env.CORS_ALLOWED_ORIGINS
    ? process.env.CORS_ALLOWED_ORIGINS.split(',')
    : ['http://localhost:5174', 'http://localhost:3000'];
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  // Giới hạn dung lượng body JSON và form-urlencoded ở mức an toàn 10MB (tệp đính kèm xử lý riêng qua multer)
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ limit: '10mb', extended: true }));

  // Lắng nghe trên 0.0.0.0 để Windows host và proxy kết nối thông suốt qua cả IPv4 và IPv6
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
