import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatHistory } from './chat-history.entity';

@Injectable()
export class ChatHistoryService {
  constructor(
    @InjectRepository(ChatHistory)
    private readonly chatHistoryRepository: Repository<ChatHistory>,
  ) {}

  // 1. Lưu tin nhắn mới vào database (dùng cho cả người dùng và bot)
  async saveMessage(sessionId: string, role: string, message: string): Promise<ChatHistory> {
    const chatMsg = this.chatHistoryRepository.create({
      sessionId,
      role,
      message,
    });
    return await this.chatHistoryRepository.save(chatMsg);
  }

  // 2. Lấy danh sách lịch sử tin nhắn của một phiên chat
  async getHistory(sessionId: string, limit: number = 10): Promise<ChatHistory[]> {
    // Lấy N tin nhắn gần đây nhất xếp theo thứ tự mới nhất -> cũ nhất (DESC)
    const history = await this.chatHistoryRepository.find({
      where: { sessionId },
      order: { createdAt: 'DESC' },
      take: limit,
    });

    // Để gửi cho AI hiểu đúng luồng hội thoại, ta phải đảo ngược mảng lại
    // để tin nhắn cũ hiển thị trước, tin nhắn mới hiển thị sau (Thời gian tăng dần)
    return history.reverse();
  }

  // 3. Lấy toàn bộ lịch sử tin nhắn (Dành cho Admin Dashboard)
  async getAllHistory(): Promise<ChatHistory[]> {
    return await this.chatHistoryRepository.find({
      order: { createdAt: 'DESC' },
    });
  }
}
