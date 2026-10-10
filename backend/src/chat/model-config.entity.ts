import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Bản ghi duy nhất lưu khóa mô hình đã mã hóa. */
@Entity('model_config')
export class ModelConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ default: 'gemini' })
  provider: string;

  @Column({ type: 'text', nullable: true })
  encryptedKey: string | null;
}
