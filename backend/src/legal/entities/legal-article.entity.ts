import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LegalDocument } from './legal-document.entity';

export enum LegalUnitType {
  PART = 'part',
  CHAPTER = 'chapter',
  SECTION = 'section',
  SUBSECTION = 'subsection',
  GENERAL = 'general',
  ARTICLE = 'article',
  CLAUSE = 'clause',
  POINT = 'point',
}

@Entity('legal_articles')
@Index(['documentId', 'parentId', 'unitType', 'number'], { unique: true })
@Index('IDX_legal_root_unit', ['documentId', 'unitType', 'number'], { unique: true, where: '"parent_id" IS NULL' })
export class LegalArticle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'document_id', type: 'uuid' })
  documentId: string;

  @ManyToOne(() => LegalDocument, (document) => document.articles, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document: LegalDocument;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId: string | null;

  @ManyToOne(() => LegalArticle, (article) => article.children, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'parent_id' })
  parent: LegalArticle | null;

  @OneToMany(() => LegalArticle, (article) => article.parent)
  children: LegalArticle[];

  @Column({ name: 'unit_type', type: 'enum', enum: LegalUnitType })
  unitType: LegalUnitType;

  // Số La Mã, số Điều/Khoản hoặc chữ cái của Điểm.
  @Column({ type: 'varchar', length: 30 })
  number: string;

  @Column({ type: 'text', nullable: true })
  title: string | null;

  @Column({ name: 'original_text', type: 'text', nullable: true })
  originalText: string | null;

  @Column({ name: 'sort_order', type: 'integer' })
  sortOrder: number;
}
