import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { ChatHistory } from './chat-history.entity';
import { redactConversation } from './privacy';

@Injectable()
export class ChatHistoryService {
  constructor(
    @InjectRepository(ChatHistory)
    private readonly chatHistoryRepository: Repository<ChatHistory>,
  ) {}

  /** Ghi trọn một lượt hỏi đáp để lỗi lưu phản hồi không tạo câu hỏi lẻ hoặc thống kê sai. */
  saveExchange(sessionId: string, question: string, answer: string, resultMeta: Record<string, unknown>) {
    return this.chatHistoryRepository.manager.transaction(async manager => {
      const repository = manager.getRepository(ChatHistory);
      await repository.save([
        repository.create({ sessionId, role: 'user', message: redactConversation(question) }),
        repository.create({ sessionId, role: 'bot', message: redactConversation(answer), resultMeta }),
      ]);
    });
  }

  // 1. Lưu tin nhắn mới vào database (dùng cho cả người dùng và bot)
  async saveMessage(sessionId: string, role: string, message: string, resultMeta?: Record<string, unknown>): Promise<ChatHistory> {
    const chatMsg = this.chatHistoryRepository.create({
      sessionId,
      role,
      message: redactConversation(message),
      ...(resultMeta ? { resultMeta } : {}),
    });
    return await this.chatHistoryRepository.save(chatMsg);
  }

  // 2. Lấy danh sách lịch sử tin nhắn của một phiên chat
  async getHistory(sessionId: string, limit: number = 10): Promise<ChatHistory[]> {
    // Lấy N tin nhắn gần đây nhất xếp theo thứ tự mới nhất -> cũ nhất (DESC)
    const history = await this.chatHistoryRepository.find({
      where: { sessionId },
      order: { id: 'DESC' },
      take: limit,
    });

    // Để gửi cho AI hiểu đúng luồng hội thoại, ta phải đảo ngược mảng lại
    // để tin nhắn cũ hiển thị trước, tin nhắn mới hiển thị sau (Thời gian tăng dần)
    return history.reverse();
  }

  // 3. Lấy toàn bộ lịch sử tin nhắn (Dành cho Admin Dashboard)
  async getAllHistory(before?: number, limit = 100, from?: string, to?: string): Promise<ChatHistory[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (before !== undefined && (!Number.isSafeInteger(before) || before < 1))) throw new BadRequestException('Tham số phân trang không hợp lệ.');
    const query = this.chatHistoryRepository.createQueryBuilder('h').orderBy('h.id', 'DESC').take(limit);
    if (before) query.andWhere('h.id < :before', { before });
    for (const [name, value] of [['from', from], ['to', to]]) {
      if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new BadRequestException('Ngày lọc không hợp lệ.');
      if (value) query.andWhere(`h.created_at ${name === 'from' ? '>=' : '<'} :${name}::date ${name === 'to' ? "+ INTERVAL '1 day'" : ''}`, { [name!]: value });
    }
    if (from && to && from > to) throw new BadRequestException('Khoảng ngày lọc không hợp lệ.');
    // Không phát sinh response không giới hạn khi dữ liệu lịch sử tăng.
    const rows = await query.getMany();
    const reviewRows = rows.length ? await this.chatHistoryRepository.query('SELECT session_id,status FROM conversation_reviews WHERE session_id=ANY($1)', [Array.from(new Set(rows.map(row => row.sessionId)))]) : [];
    const reviews = new Map(reviewRows.map((row: any) => [row.session_id, row.status]));
    return rows.map(row => Object.assign(row, { reviewStatus: reviews.get(row.sessionId) || 'pending' }));
  }

  /** Thống kê từ trạng thái có cấu trúc, tách riêng dữ liệu cũ chưa xác định. */
  async analytics() {
    const rows = await this.chatHistoryRepository.query(`SELECT
      COUNT(*) FILTER(WHERE role='user')::int AS questions,
      COUNT(*) FILTER(WHERE role='bot' AND result_meta->>'answer_status'='cited')::int AS cited,
      COUNT(*) FILTER(WHERE role='bot' AND result_meta->>'answer_status'='refused')::int AS refused,
      COUNT(*) FILTER(WHERE role='bot' AND result_meta->>'answer_status'='error')::int AS errors,
      COUNT(*) FILTER(WHERE role='bot' AND result_meta IS NULL)::int AS unknown,
      AVG((result_meta->>'latency_ms')::numeric) FILTER(WHERE role='bot' AND result_meta IS NOT NULL) AS latency_ms
      FROM chat_history`);
    const stats = rows[0];
    const measured = stats.cited + stats.refused + stats.errors;
    return { ...stats, measured, citation_rate: measured ? Math.round(stats.cited * 100 / measured) : null,
      refusal_rate: measured ? Math.round(stats.refused * 100 / measured) : null };
  }

  async review(sessionId: string, status: string, reviewerId: number) {
    if (!['reviewed', 'need_review'].includes(status) || !sessionId || sessionId.length > 100) throw new BadRequestException('Trạng thái rà soát không hợp lệ.');
    if (!(await this.chatHistoryRepository.existsBy({ sessionId }))) throw new BadRequestException('Không tìm thấy phiên hội thoại.');
    await this.chatHistoryRepository.query(`INSERT INTO conversation_reviews(session_id,status,reviewer_id) VALUES($1,$2,$3)
      ON CONFLICT(session_id) DO UPDATE SET status=$2,reviewer_id=$3,reviewed_at=NOW()`, [sessionId, status, reviewerId]);
    return { success: true, status };
  }

  /** Chỉ chạy chủ động theo chính sách lưu trữ; không tự xóa khi khởi động dịch vụ. */
  async purgeBefore(date: Date) {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime()) || date.getTime() > Date.now() - 86400000) throw new BadRequestException('Mốc xóa phải cách hiện tại ít nhất một ngày.');
    return this.chatHistoryRepository.delete({ createdAt: LessThan(date) });
  }
}
