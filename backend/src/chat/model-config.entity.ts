import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Bản ghi duy nhất lưu khóa mô hình đã mã hóa. */
@Entity('model_config')
export class ModelConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ default: 'gemini' })
  provider: string;

  @Column({ name: 'encrypted_key', type: 'text', nullable: true })
  encryptedKey: string | null;

  @Column({ name: 'encrypted_embedding_key', type: 'text', nullable: true })
  encryptedEmbeddingKey: string | null;
}
