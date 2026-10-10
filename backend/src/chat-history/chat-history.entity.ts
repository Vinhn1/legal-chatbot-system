import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// 1. Khai báo bảng 'chat_history' trong database
@Entity('chat_history')
export class ChatHistory {
  @PrimaryGeneratedColumn()
  id: number;

  // 2. ID phiên chat (Session). Mỗi người dùng/tab chat sẽ có 1 sessionId riêng để gom nhóm tin nhắn
  @Column({ name: 'session_id' })
  sessionId: string;

  // 3. Vai trò người gửi: 'user' (người dùng) hoặc 'bot' (chatbot)
  @Column()
  role: string;

  // 4. Nội dung tin nhắn (dùng type text vì tin nhắn có thể rất dài)
  @Column({ type: 'text' })
  message: string;

  // 5. Thời gian tin nhắn được gửi
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
