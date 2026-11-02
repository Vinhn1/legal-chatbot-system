import { getMetadataArgsStorage } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { LegalArticle, LegalUnitType } from './entities/legal-article.entity';
import { AccessScope, EffectiveStatus, LegalDocument, LegalDocumentType } from './entities/legal-document.entity';
import { LegalService } from './legal.service';

describe('Legal schema and service', () => {
  const document = {
    id: 'doc-1',
    documentNumber: '01/2026/QH',
    documentType: LegalDocumentType.LAW,
    title: 'Luật mẫu',
    issuingAuthority: 'Quốc hội',
    issuedDate: '2026-01-01',
    effectiveDate: '2026-03-01',
    expiryDate: null,
    statusSinceDate: null,
    effectiveStatus: EffectiveStatus.ACTIVE,
    contentHash: 'a'.repeat(64),
    scope: AccessScope.PUBLIC,
  } as LegalDocument;

  const documents = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
    findOneBy: jest.fn(async () => document),
    find: jest.fn(),
  };
  const units = {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
    findOneBy: jest.fn(),
    find: jest.fn(),
  };
  const service = new LegalService(documents as any, units as any);

  beforeEach(() => jest.clearAllMocks());

  it('defines required document and hierarchical relations', () => {
    const metadata = getMetadataArgsStorage();
    const documentColumns = metadata.columns.filter((column) => column.target === LegalDocument);
    const articleColumns = metadata.columns.filter((column) => column.target === LegalArticle);
    const byName = (columns: typeof documentColumns, name: string) =>
      columns.find((column) => column.propertyName === name)?.options;

    expect(byName(documentColumns, 'documentNumber')?.nullable).not.toBe(true);
    expect(byName(documentColumns, 'issuingAuthority')?.nullable).not.toBe(true);
    expect(byName(documentColumns, 'effectiveStatus')?.default).toBe(EffectiveStatus.UNKNOWN);
    expect(byName(documentColumns, 'scope')?.default).toBe(AccessScope.INTERNAL);
    expect(byName(articleColumns, 'documentId')?.type).toBe('uuid');
    expect(byName(articleColumns, 'parentId')?.nullable).toBe(true);
    expect(metadata.relations.some((relation) => relation.target === LegalArticle && relation.propertyName === 'parent')).toBe(true);
  });

  it('defaults unverified documents to unknown and rejects invalid dates', async () => {
    const { effectiveStatus, scope, ...input } = document;
    await service.createDocument(input);
    expect(documents.save).toHaveBeenCalledWith(expect.objectContaining({
      effectiveStatus: EffectiveStatus.UNKNOWN,
      scope: AccessScope.INTERNAL,
    }));
    await expect(service.createDocument({ ...input, issuedDate: '2026-02-30' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.createDocument({ ...input, contentHash: 'bad' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps clauses under articles and points under clauses in the same document', async () => {
    units.findOneBy.mockResolvedValueOnce({ id: 'article-1', documentId: document.id, unitType: LegalUnitType.ARTICLE });
    await service.createUnit({ documentId: document.id, parentId: 'article-1', unitType: LegalUnitType.CLAUSE, number: '1', sortOrder: 1 });
    expect(units.save).toHaveBeenCalledWith(expect.objectContaining({ parentId: 'article-1', unitType: LegalUnitType.CLAUSE }));

    units.findOneBy.mockResolvedValueOnce({ id: 'article-1', documentId: document.id, unitType: LegalUnitType.ARTICLE });
    await expect(service.createUnit({ documentId: document.id, parentId: 'article-1', unitType: LegalUnitType.POINT, number: 'a', sortOrder: 1 }))
      .rejects.toBeInstanceOf(BadRequestException);
    units.findOneBy.mockResolvedValueOnce({ id: 'article-2', documentId: 'other-doc', unitType: LegalUnitType.ARTICLE });
    await expect(service.createUnit({ documentId: document.id, parentId: 'article-2', unitType: LegalUnitType.CLAUSE, number: '1', sortOrder: 1 }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('chấp nhận Phần và tiểu mục làm đơn vị cha nhưng từ chối Điểm trực thuộc Phần', async () => {
    units.findOneBy.mockResolvedValueOnce({ id: 'part-1', documentId: document.id, unitType: LegalUnitType.PART });
    await service.createUnit({ documentId: document.id, parentId: 'part-1',
      unitType: LegalUnitType.SUBSECTION, number: 'I', sortOrder: 1 });
    expect(units.save).toHaveBeenCalledWith(expect.objectContaining({
      parentId: 'part-1', unitType: LegalUnitType.SUBSECTION,
    }));
    units.findOneBy.mockResolvedValueOnce({ id: 'part-1', documentId: document.id, unitType: LegalUnitType.PART });
    await expect(service.createUnit({ documentId: document.id, parentId: 'part-1',
      unitType: LegalUnitType.POINT, number: 'a', sortOrder: 2 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('evaluates effect on the requested date and never upgrades unknown', () => {
    expect(service.getEffectiveStatusAt(document, '2026-02-28')).toBe(EffectiveStatus.UNKNOWN);
    expect(service.getEffectiveStatusAt(document, '2026-03-01')).toBe(EffectiveStatus.ACTIVE);
    const partial = { ...document, effectiveStatus: EffectiveStatus.PARTIALLY_EXPIRED, statusSinceDate: '2026-06-01' };
    expect(service.getEffectiveStatusAt(partial, '2026-05-31')).toBe(EffectiveStatus.ACTIVE);
    expect(service.getEffectiveStatusAt(partial, '2026-06-01')).toBe(EffectiveStatus.PARTIALLY_EXPIRED);
    expect(service.getEffectiveStatusAt({ ...partial, expiryDate: '2026-09-01' }, '2026-09-01')).toBe(EffectiveStatus.EXPIRED);
    expect(service.getEffectiveStatusAt({ ...document, effectiveStatus: EffectiveStatus.UNKNOWN }, '2026-09-01')).toBe(EffectiveStatus.UNKNOWN);
  });
});
