import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { LegalArticle } from './legal-article.entity';

export enum LegalDocumentType {
  LAW = 'law',
  RESOLUTION = 'resolution',
  DECREE = 'decree',
  CIRCULAR = 'circular',
}

export enum EffectiveStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  PARTIALLY_EXPIRED = 'partially_expired',
  UNKNOWN = 'unknown',
}

export enum AccessScope {
  PUBLIC = 'public',
  INTERNAL = 'internal',
}

@Entity('legal_documents')
@Check('CHK_legal_documents_dates', '"expiry_date" IS NULL OR "effective_date" IS NULL OR "expiry_date" >= "effective_date"')
export class LegalDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Số hiệu có thể lặp giữa các lần chỉnh lý; contentHash nhận diện bản nội dung.
  @Index()
  @Column({ name: 'document_number', type: 'varchar', length: 100 })
  documentNumber: string;

  @Column({ name: 'document_type', type: 'enum', enum: LegalDocumentType })
  documentType: LegalDocumentType;

  @Column({ type: 'text' })
  title: string;

  @Column({ name: 'issuing_authority', type: 'varchar', length: 255 })
  issuingAuthority: string;

  // PostgreSQL DATE giữ nguyên ngày pháp lý, không chuyển múi giờ.
  @Column({ name: 'issued_date', type: 'date' })
  issuedDate: string;

  @Column({ name: 'effective_date', type: 'date', nullable: true })
  effectiveDate: string | null;

  @Column({ name: 'expiry_date', type: 'date', nullable: true })
  expiryDate: string | null;

  // Không suy luận còn hiệu lực khi nguồn chưa xác minh.
  @Column({ name: 'effective_status', type: 'enum', enum: EffectiveStatus, default: EffectiveStatus.UNKNOWN })
  effectiveStatus: EffectiveStatus;

  // Ngày bắt đầu trạng thái hiện tại (ví dụ ngày một phần nội dung bị bãi bỏ).
  @Column({ name: 'status_since_date', type: 'date', nullable: true })
  statusSinceDate: string | null;

  @Column({ name: 'source_url', type: 'text', nullable: true })
  sourceUrl: string | null;

  @Index({ unique: true })
  @Column({ name: 'content_hash', type: 'char', length: 64 })
  contentHash: string;

  @Column({ type: 'enum', enum: AccessScope, default: AccessScope.INTERNAL })
  scope: AccessScope;

  @Column({ type: 'integer', default: 1 })
  version: number;

  @OneToMany(() => LegalArticle, (article) => article.document)
  articles: LegalArticle[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamp with time zone' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp with time zone' })
  updatedAt: Date;
}
