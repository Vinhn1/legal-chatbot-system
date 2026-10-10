import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChatHistoryService } from './chat-history.service';
import { ChatHistory } from './chat-history.entity';

@Module({
  // Đăng ký Entity ChatHistory với TypeORM
  imports: [TypeOrmModule.forFeature([ChatHistory])],
  providers: [ChatHistoryService],
  exports: [ChatHistoryService], // Rất quan trọng: Export để ChatModule dùng được
})
export class ChatHistoryModule {}
