import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LegalArticle, LegalUnitType } from './entities/legal-article.entity';
import { AccessScope, EffectiveStatus, LegalDocument, LegalDocumentType } from './entities/legal-document.entity';

export interface CreateLegalDocument {
  // Dùng cùng định danh tài liệu do AI Core phát hành để đối soát hai kho.
  id?: string;
  documentNumber: string;
  documentType: LegalDocumentType;
  title: string;
  issuingAuthority: string;
  issuedDate: string;
  effectiveDate?: string | null;
  expiryDate?: string | null;
  effectiveStatus?: EffectiveStatus;
  statusSinceDate?: string | null;
  sourceUrl?: string | null;
  contentHash: string;
  scope?: AccessScope;
  version?: number;
}

export interface CreateLegalUnit {
  documentId: string;
  parentId?: string | null;
  unitType: LegalUnitType;
  number: string;
  title?: string | null;
  originalText?: string | null;
  sortOrder: number;
}

const ALLOWED_PARENTS: Record<LegalUnitType, Array<LegalUnitType | null>> = {
  [LegalUnitType.PART]: [null],
  [LegalUnitType.CHAPTER]: [null, LegalUnitType.PART],
  [LegalUnitType.SECTION]: [null, LegalUnitType.PART, LegalUnitType.CHAPTER],
  [LegalUnitType.SUBSECTION]: [null, LegalUnitType.PART, LegalUnitType.CHAPTER, LegalUnitType.SECTION],
  [LegalUnitType.GENERAL]: [null, LegalUnitType.PART, LegalUnitType.CHAPTER, LegalUnitType.SECTION, LegalUnitType.SUBSECTION],
  [LegalUnitType.ARTICLE]: [null, LegalUnitType.PART, LegalUnitType.CHAPTER, LegalUnitType.SECTION, LegalUnitType.SUBSECTION],
  [LegalUnitType.CLAUSE]: [LegalUnitType.ARTICLE],
  [LegalUnitType.POINT]: [LegalUnitType.CLAUSE],
};

function isCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
}

@Injectable()
export class LegalService {
  constructor(
    @InjectRepository(LegalDocument)
    private readonly documents: Repository<LegalDocument>,
    @InjectRepository(LegalArticle)
    private readonly units: Repository<LegalArticle>,
  ) {}

  async createDocument(input: CreateLegalDocument): Promise<LegalDocument> {
    for (const value of [input.documentNumber, input.title, input.issuingAuthority]) {
      if (!value?.trim()) throw new BadRequestException('Thiếu thông tin bắt buộc của văn bản.');
    }
    if (!Object.values(LegalDocumentType).includes(input.documentType)) {
      throw new BadRequestException('Loại văn bản không hợp lệ.');
    }
    if (!isCalendarDate(input.issuedDate)) {
      throw new BadRequestException('Ngày ban hành phải có dạng YYYY-MM-DD.');
    }
    for (const date of [input.effectiveDate, input.expiryDate, input.statusSinceDate]) {
      if (date && !isCalendarDate(date)) {
        throw new BadRequestException('Ngày pháp lý phải có dạng YYYY-MM-DD hợp lệ.');
      }
    }
    if (!/^[a-fA-F0-9]{64}$/.test(input.contentHash)) {
      throw new BadRequestException('Content hash phải là SHA256 dạng hex.');
    }
    if (input.effectiveDate && input.expiryDate && input.expiryDate < input.effectiveDate) {
      throw new BadRequestException('Ngày hết hiệu lực phải sau ngày có hiệu lực.');
    }
    if (input.effectiveDate && input.statusSinceDate && input.statusSinceDate < input.effectiveDate) {
      throw new BadRequestException('Ngày đổi trạng thái không thể trước ngày có hiệu lực.');
    }
    if (input.effectiveStatus && !Object.values(EffectiveStatus).includes(input.effectiveStatus)) {
      throw new BadRequestException('Trạng thái hiệu lực không hợp lệ.');
    }
    if (input.scope && !Object.values(AccessScope).includes(input.scope)) {
      throw new BadRequestException('Phạm vi truy cập không hợp lệ.');
    }
    if (input.version !== undefined && (!Number.isInteger(input.version) || input.version < 1)) {
      throw new BadRequestException('Phiên bản phải là số nguyên dương.');
    }
    const document = this.documents.create({
      ...input,
      contentHash: input.contentHash.toLowerCase(),
      effectiveStatus: input.effectiveStatus ?? EffectiveStatus.UNKNOWN,
      scope: input.scope ?? AccessScope.INTERNAL,
    });
    return this.documents.save(document);
  }

  async getDocument(id: string): Promise<LegalDocument> {
    const document = await this.documents.findOneBy({ id });
    if (!document) throw new NotFoundException('Không tìm thấy văn bản pháp luật.');
    return document;
  }

  findByNumber(documentNumber: string): Promise<LegalDocument[]> {
    return this.documents.find({ where: { documentNumber }, order: { version: 'DESC' } });
  }

  /** Tìm bản nội dung đã đồng bộ để nạp lại không tạo dòng trùng. */
  findByContentHash(contentHash: string): Promise<LegalDocument | null> {
    return this.documents.findOneBy({ contentHash: contentHash.toLowerCase() });
  }

  listUnits(documentId: string): Promise<LegalArticle[]> {
    return this.units.find({ where: { documentId }, order: { sortOrder: 'ASC' } });
  }

  async createUnit(input: CreateLegalUnit): Promise<LegalArticle> {
    await this.getDocument(input.documentId);
    if (!Object.values(LegalUnitType).includes(input.unitType) || !input.number?.trim()) {
      throw new BadRequestException('Đơn vị quy phạm hoặc số thứ tự không hợp lệ.');
    }
    if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0) {
      throw new BadRequestException('Thứ tự sắp xếp phải là số nguyên không âm.');
    }
    const parent = input.parentId ? await this.units.findOneBy({ id: input.parentId }) : null;
    if (input.parentId && !parent) throw new NotFoundException('Không tìm thấy đơn vị cha.');
    if (parent && parent.documentId !== input.documentId) {
      throw new BadRequestException('Đơn vị cha phải thuộc cùng văn bản.');
    }
    if (!ALLOWED_PARENTS[input.unitType].includes(parent?.unitType ?? null)) {
      throw new BadRequestException('Quan hệ phân cấp đơn vị pháp lý không hợp lệ.');
    }
    return this.units.save(this.units.create({ ...input, parentId: parent?.id ?? null }));
  }

  // expiryDate là ngày đầu tiên không còn hiệu lực. Thiếu xác minh luôn trả unknown.
  getEffectiveStatusAt(document: LegalDocument, asOf: string): EffectiveStatus {
    if (!isCalendarDate(asOf)) {
      throw new BadRequestException('Ngày tra cứu phải có dạng YYYY-MM-DD.');
    }
    if (document.effectiveStatus === EffectiveStatus.UNKNOWN) return EffectiveStatus.UNKNOWN;
    if (!document.effectiveDate || asOf < document.effectiveDate) return EffectiveStatus.UNKNOWN;
    if (document.expiryDate && asOf >= document.expiryDate) return EffectiveStatus.EXPIRED;
    if (document.statusSinceDate && asOf < document.statusSinceDate) return EffectiveStatus.ACTIVE;
    if (document.effectiveStatus === EffectiveStatus.EXPIRED && document.expiryDate && asOf < document.expiryDate) {
      return EffectiveStatus.ACTIVE;
    }
    return document.effectiveStatus;
  }

  /** Xóa văn bản và toàn bộ đơn vị phân cấp liên quan theo tiêu đề, số hiệu hoặc id. */
  async deleteDocumentByName(target: string): Promise<boolean> {
    const trimmed = target.trim();
    if (!trimmed) return false;
    const doc = await this.documents.findOne({
      where: [
        { title: trimmed },
        { documentNumber: trimmed },
        ...(trimmed.length === 36 ? [{ id: trimmed }] : []),
      ],
    });
    if (!doc) return false;
    await this.documents.remove(doc);
    return true;
  }
}
