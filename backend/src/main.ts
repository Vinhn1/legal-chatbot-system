import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SafeExceptionFilter } from './common/filters/safe-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Chỉ tin một proxy Nginx phía trước; cổng Docker của Backend chỉ mở trên loopback host.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  const accessLogger = new Logger('HttpAccess');
  // Tạo mã yêu cầu tại máy chủ và chỉ ghi phương thức, trạng thái cùng thời điểm xử lý.
  app.use((request: Request & { requestId?: string }, response: Response, next: NextFunction) => {
    const requestId = randomUUID();
    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);
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

  // Tăng giới hạn dung lượng body để hỗ trợ upload tài liệu lớn (PDF, DOCX, XLSX...)
  app.use(json({ limit: '100mb' }));
  app.use(urlencoded({ limit: '100mb', extended: true }));

  // Lắng nghe trên 0.0.0.0 để Windows host và proxy kết nối thông suốt qua cả IPv4 và IPv6
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();

