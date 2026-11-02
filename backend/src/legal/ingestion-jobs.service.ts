import { Injectable, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LegalDocument } from './entities/legal-document.entity';
import { LegalArticle } from './entities/legal-article.entity';
import { LegalService } from './legal.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import * as fs from 'fs';
import * as path from 'path';

/** Nhật ký phục hồi chỉ nằm ở server; đồng bộ cây pháp lý trong một transaction. */
@Injectable()
export class IngestionJobsService {
  constructor(private readonly db: DataSource, private readonly http?: HttpService, private readonly config?: ConfigService) {}

  async begin(operation = 'ingest', documentId?: string) {
    const rows = await this.db.query("INSERT INTO ingestion_jobs(status,operation,document_id) VALUES('pending',$1,$2) RETURNING id", [operation, documentId || null]);
    return rows[0].id as string;
  }

  async fail(id: string, code = 'upstream_failed') {
    await this.db.query("UPDATE ingestion_jobs SET status='failed',error_code=$2,updated_at=NOW() WHERE id=$1", [id, code]);
  }

  async complete(id: string, result: any) {
    if (!['indexed', 'duplicate'].includes(result.status)) {
      await this.fail(id, result.status === 'needs_review' ? 'needs_review' : 'not_indexed');
      return { ...result, job_id: id };
    }
    await this.db.query("UPDATE ingestion_jobs SET status='indexed',payload=$2,content_hash=$3,updated_at=NOW() WHERE id=$1", [id, JSON.stringify(result), result.content_hash]);
    try { await this.retry(id); return { ...result, job_id: id, sync_status: 'metadata_synced' }; }
    catch {
      await this.fail(id, 'metadata_sync_failed');
      return { ...result, status: 'partial', job_id: id, sync_status: 'failed', message: 'Vector đã ghi; metadata chưa đồng bộ. Hãy thử phục hồi theo mã công việc.' };
    }
  }

  async retry(id: string) {
    const current = (await this.db.query('SELECT operation FROM ingestion_jobs WHERE id=$1', [id]))[0];
    if (current?.operation === 'delete') return this.retryDelete(id);
    return this.db.transaction(async manager => {
      const rows = await manager.query('SELECT * FROM ingestion_jobs WHERE id=$1 FOR UPDATE', [id]);
      const job = rows[0];
      if (!job || job.operation !== 'ingest' || !job.payload) throw new BadRequestException('Không có kết quả vector để phục hồi; cần kiểm tra và nạp lại nguồn.');
      if (job.status === 'metadata_synced') return { success: true, job_id: id, sync_status: 'metadata_synced' };
      const result = job.payload;
      // Khóa theo hàm băm để hai job cùng tài liệu không tạo đơn vị trùng.
      await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [result.content_hash]);
      const service = new LegalService(manager.getRepository(LegalDocument), manager.getRepository(LegalArticle));
      const document = await service.findByContentHash(result.content_hash) || await service.createDocument({
        id: result.doc_id, documentNumber: result.doc_number, documentType: result.document_type,
        title: result.doc_title, issuingAuthority: result.issuing_authority, issuedDate: result.issued_date,
        effectiveDate: result.effective_date, effectiveStatus: result.effective_status,
        sourceUrl: result.source_url, contentHash: result.content_hash, scope: result.scope,
      });
      const saved = await service.listUnits(document.id);
      const ids = new Map<string, string>();
      for (const unit of result.units || []) {
        const parentId = unit.parent_key === null ? null : ids.get(unit.parent_key);
        if (unit.parent_key !== null && !parentId) throw new BadRequestException('Thiếu đơn vị cha trong kết quả nạp.');
        const matched = saved.find(row => row.unitType === unit.unit_type && row.number === unit.number && row.parentId === parentId);
        const row = matched || await service.createUnit({ documentId: document.id, parentId, unitType: unit.unit_type,
          number: unit.number, title: unit.title || null, originalText: unit.original_text || null, sortOrder: unit.sort_order });
        ids.set(unit.key, row.id);
        if (!matched) saved.push(row);
      }
      await manager.query("UPDATE ingestion_jobs SET status='metadata_synced',document_id=$2,error_code=NULL,updated_at=NOW() WHERE id=$1", [id, document.id]);
      return { success: true, job_id: id, sync_status: 'metadata_synced' };
    });
  }

  /** Ghi đích xóa trước khi gọi vector; lỗi giữa hai kho được giữ để retry. */
  async deleteDocument(target: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target)) throw new BadRequestException('Chỉ xóa bằng ID tài liệu ổn định.');
    const token = this.config?.get<string>('AI_CORE_INTERNAL_TOKEN');
    if (!token || !this.http) throw new Error('Thiếu xác thực nội bộ.');
    const base = this.config!.get<string>('AI_SERVICE_BASE_URL', 'http://localhost:8001');
    const vectors = await firstValueFrom(this.http.get(base + '/documents', { headers: { 'X-Internal-Token': token }, timeout: 30000 }));
    const contentHash = vectors.data.find((row: any) => row.id === target)?.contentHash || null;
    const id = await this.begin('delete', target);
    // Giữ hash trước khi xóa vector để retry vẫn xử lý được bản PostgreSQL cũ khác ID.
    await this.db.query('UPDATE ingestion_jobs SET payload=$2 WHERE id=$1', [id, JSON.stringify({ target, contentHash })]);
    try { return await this.retryDelete(id); }
    catch { await this.fail(id, 'delete_incomplete'); return { success: false, status: 'partial', job_id: id, message: 'Xóa chưa hoàn tất. Hãy phục hồi theo mã công việc.' }; }
  }

  private async retryDelete(id: string) {
    return this.db.transaction(async manager => {
      const job = (await manager.query('SELECT * FROM ingestion_jobs WHERE id=$1 FOR UPDATE', [id]))[0];
      if (job.status === 'metadata_synced') return { success: true, job_id: id };
      const token = this.config?.get<string>('AI_CORE_INTERNAL_TOKEN');
      if (!token || !this.http) throw new Error('Thiếu xác thực nội bộ.');
      const base = this.config!.get<string>('AI_SERVICE_BASE_URL', 'http://localhost:8001');
      const response = await firstValueFrom(this.http.delete(base + '/documents', { params: { name: job.payload.target },
        headers: { 'X-Internal-Token': token }, timeout: 30000 }));
      if (!response.data?.success) throw new Error('Chưa xác nhận xóa vector.');
      // ID được dùng chung cho dữ liệu mới; hash hỗ trợ đối soát bản nạp cũ khác ID PostgreSQL.
      const repository = manager.getRepository(LegalDocument);
      const contentHash = job.payload.contentHash || response.data.content_hash;
      const document = contentHash ? await repository.findOneBy({ contentHash })
        : await repository.findOneBy({ id: job.payload.target });
      if (document) {
        await repository.remove(document);
        // Dọn dẹp tệp tài liệu thô trên đĩa lưu trữ nếu không còn bản ghi nào khác dùng chung hash
        if (contentHash && /^[0-9a-fA-F]{64}$/.test(contentHash)) {
          const remaining = await repository.countBy({ contentHash });
          if (remaining === 0) {
            try {
              const rawDir = path.resolve(process.cwd(), '..', 'storage', 'raw_documents');
              const localRawDir = path.resolve(process.cwd(), 'storage', 'raw_documents');
              for (const dir of [rawDir, localRawDir]) {
                if (fs.existsSync(dir)) {
                  for (const f of fs.readdirSync(dir)) {
                    if (f.startsWith(contentHash)) {
                      fs.unlinkSync(path.join(dir, f));
                    }
                  }
                }
              }
            } catch {
              // Bỏ qua lỗi dọn dẹp đĩa để không ngắt quãng giao dịch đồng bộ
            }
          }
        }
      }
      await manager.query("UPDATE ingestion_jobs SET status='metadata_synced',error_code=NULL,updated_at=NOW() WHERE id=$1", [id]);
      return { success: true, job_id: id };
    });
  }

  /** Chỉ trả trạng thái, không đưa payload văn bản ra danh sách công việc. */
  list() {
    return this.db.query('SELECT id,operation,status,document_id,error_code,created_at,updated_at FROM ingestion_jobs ORDER BY created_at DESC LIMIT 100');
  }

  async reconcile(vectorDocuments: Array<{ id: string; contentHash?: string }>) {
    const rows = await this.db.getRepository(LegalDocument).find({ select: { id: true, contentHash: true } });
    const pgHashes = new Set(rows.map(row => row.contentHash));
    const vectorHashes = new Set(vectorDocuments.map(row => row.contentHash).filter(Boolean));
    return { vector_only: vectorDocuments.filter(row => row.contentHash && !pgHashes.has(row.contentHash)).map(row => row.id),
      postgres_only: rows.filter(row => !vectorHashes.has(row.contentHash)).map(row => row.id),
      missing_hash: vectorDocuments.filter(row => !row.contentHash).map(row => row.id) };
  }
}
