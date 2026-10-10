import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatHistoryModule } from '../chat-history/chat-history.module';
import { RateLimiterGuard } from '../common/guards/rate-limiter.guard';
import { LegalModule } from '../legal/legal.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModelConfig } from './model-config.entity';

// Dùng chung LegalService để route nạp URL cũ cũng đồng bộ danh mục PostgreSQL.
@Module({
  imports: [HttpModule, ConfigModule, ChatHistoryModule, LegalModule, TypeOrmModule.forFeature([ModelConfig])],
  controllers: [ChatController],
  providers: [ChatService, RateLimiterGuard]
})
export class ChatModule {}

