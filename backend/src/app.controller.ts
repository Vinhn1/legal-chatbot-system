import { Controller, Get, Optional, ServiceUnavailableException } from '@nestjs/common';
import { AppService } from './app.service';
import { DataSource } from 'typeorm';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService, @Optional() private readonly db?: DataSource) {}

  /** Liveness không truy cập dependency; readiness kiểm tra DB và AI Core riêng. */
  @Get('health/live')
  live() { return { status: 'alive' }; }

  @Get('health/ready')
  async ready() {
    try {
      if (!this.db) throw new Error('Chưa kết nối database.');
      await this.db.query('SELECT 1');
      const response = await fetch(`${process.env.AI_SERVICE_BASE_URL || 'http://localhost:8001'}/health`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('AI Core chưa sẵn sàng.');
      return { status: 'ready' };
    } catch { throw new ServiceUnavailableException('Dịch vụ phụ thuộc chưa sẵn sàng.'); }
  }

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
