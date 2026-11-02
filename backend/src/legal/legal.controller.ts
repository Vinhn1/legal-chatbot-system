import {
  BadRequestException, Body, Controller, Get, Param, HttpException, HttpStatus, Logger, Post,
  Query, ServiceUnavailableException, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { firstValueFrom } from 'rxjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { LegalService } from './legal.service';
import { IngestionJobsService } from './ingestion-jobs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AccessScope, EffectiveStatus, LegalDocumentType } from './entities/legal-document.entity';
import { LegalUnitType } from './entities/legal-article.entity';
import { DocumentParserService } from '../document-parser/document-parser.service';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Giới hạn kích thước tệp tải lên tối đa là 15 MB
const MAX_FILE_BYTES = 15 * 1024 * 1024;

/** Trạng thái tiến trình phân tích PDF bằng LlamaParse chạy ngầm */
interface LlamaBackgroundJob {
  jobId: string;
  filename: string;
  status: 'queued' | 'running' | 'completed' | 'needs_review' | 'failed';
  stage: 'uploading' | 'queued' | 'ocr' | 'metadata' | 'indexing' | 'done' | 'error';
  autoIngest: boolean;
  processedPages: number;
  totalPages: number;
  percent: number;
  text?: string | null;
  metadata?: any;
  ingestResult?: any;
  error?: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Phản hồi nạp đã chuẩn hóa từ AI Core để đồng bộ hai kho dữ liệu. */
interface AiUnit {
  key: string;
  parent_key: string | null;
  unit_type: LegalUnitType;
  number: string;
  title: string;
  original_text: string;
  sort_order: number;
}

interface AiIngestResult {
  status: string;
  content_hash: string;
  doc_number: string;
  doc_title: string;
  document_type: LegalDocumentType;
  issuing_authority: string;
  issued_date: string;
  effective_date?: string | null;
  effective_status: EffectiveStatus;
  source_url?: string;
  scope: AccessScope;
  units?: AiUnit[];
  [key: string]: unknown;
}

/**
 * Controller tiếp nhận và xử lý các thao tác quản lý dữ liệu pháp luật.
 */
@Controller('legal')
export class LegalController {
  // Bộ đệm chống ghi trùng PostgreSQL khi cả luồng theo dõi nền và trình duyệt cùng kiểm tra kết quả
  private readonly syncedOcrJobs = new Map<string, Promise<any>>();
  // Bộ nhớ theo dõi các tác vụ LlamaParse chạy ngầm
  private readonly llamaJobs = new Map<string, LlamaBackgroundJob>();
  private readonly logger = new Logger(LegalController.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly legalService: LegalService,
    private readonly jobs?: IngestionJobsService,
    private readonly notifications?: NotificationsService,
    private readonly documentParser?: DocumentParserService,
  ) {}

  /** Theo dõi công việc và phục hồi metadata mà không ghi lại vector. */
  @Get('jobs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
  listJobs() { return this.jobs!.list(); }

  @Post('jobs/:id/retry')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
  retryJob(@Param('id') id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new BadRequestException('Mã công việc không hợp lệ.');
    return this.jobs!.retry(id);
  }

  @Get('reconcile')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  async reconcile() {
    const baseUrl = this.configService.get<string>('AI_SERVICE_BASE_URL', 'http://localhost:8001');
    const token = this.configService.get<string>('AI_CORE_INTERNAL_TOKEN');
    if (!token) throw new ServiceUnavailableException('Chưa cấu hình xác thực nội bộ AI Core.');
    const response = await firstValueFrom(this.httpService.get(baseUrl + '/documents', { headers: { 'X-Internal-Token': token }, timeout: 30000 }));
    return this.jobs!.reconcile(response.data);
  }

  /** Chuyển lỗi dịch vụ nguồn thành mã HTTP rõ ràng, không ghi nội dung tài liệu vào log. */
  private rethrowAiError(error: any, fallback: string): never {
    const detail = error.response?.data?.detail || error.response?.data?.message || fallback;
    const status = error.response?.status || HttpStatus.SERVICE_UNAVAILABLE;
    if (
      status === 429 ||
      (typeof detail === 'string' &&
        (detail.includes('429') ||
          detail.includes('RESOURCE_EXHAUSTED') ||
          detail.includes('Quota exceeded') ||
          detail.includes('quota') ||
          detail.includes('Hạn mức')))
    ) {
      throw new HttpException(
        typeof detail === 'string' && detail.length > 20
          ? detail
          : 'Hạn mức Gemini Embedding API (Free Tier 1.000 lượt/ngày) đã đạt giới hạn (429 Resource Exhausted). Vui lòng bổ sung thêm GEMINI_API_KEY hoặc thử lại sau khi hạn mức làm mới.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (typeof detail === 'string' && detail.includes('Expected Embeddings to be non-empty')) {
      throw new HttpException(
        'Lỗi tạo vector nhúng (Embedding): Khóa API Embedding đạt giới hạn hạn mức và không tạo được vector. Vui lòng kiểm tra lại cấu hình API key.',
        HttpStatus.BAD_REQUEST,
      );
    }
    throw new HttpException(detail, status);
  }

  /** Đảm bảo thời gian chờ đủ lớn cho tác vụ OCR và lập chỉ mục tệp PDF nhiều trang. */
  private resolveIngestTimeoutMs(minMs = 180000): number {
    const configured = Number(this.configService.get<string | number>('AI_SERVICE_TIMEOUT_MS', minMs));
    return Number.isFinite(configured) ? Math.max(configured, minMs) : minMs;
  }

  /**
   * Endpoint tự động trích xuất thông tin phân loại & metadata của văn bản.
   * Tiếp nhận tệp tải lên và chuyển tiếp sang AI Core để bóc tách thông tin trước khi nạp.
   */
  @Post('extract-metadata')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  async extractMetadata(@UploadedFile() file: any) {
    if (!file?.buffer || !file.originalname) {
      throw new BadRequestException('Thiếu tệp văn bản pháp luật.');
    }

    const token = this.configService.get<string>('AI_CORE_INTERNAL_TOKEN');
    if (!token) throw new ServiceUnavailableException('Chưa cấu hình xác thực nội bộ AI Core.');

    const filename = file.originalname.replace(/\\/g, '/').split('/').pop();
    const form = new FormData();
    form.append('file', new Blob([Uint8Array.from(file.buffer)]), filename);

    const baseUrl = this.configService.get<string>('AI_SERVICE_BASE_URL', 'http://localhost:8001');
    const timeout = this.resolveIngestTimeoutMs(180000);

    try {
      const response = await firstValueFrom(
        this.httpService.post(`${baseUrl}/legal/extract-metadata`, form, {
          headers: { 'X-Internal-Token': token },
          timeout,
        }),
      );
      return response.data;
    } catch (error: any) {
      const detail = error.response?.data?.detail || error.message || 'AI Core không thể trích xuất metadata văn bản.';
      throw new HttpException(
        detail,
        error.response?.status || HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /**
   * Endpoint nhận diện văn bản tiếng Việt từ tệp PDF scan bằng AI OCR.
   * Trả về văn bản trích xuất và metadata gợi ý để quản trị viên rà soát trước khi nạp.
   */
  @Post('ocr')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  async ocrDocument(@UploadedFile() file: any) {
    if (!file?.buffer || !file.originalname) {
      throw new BadRequestException('Thiếu tệp văn bản pháp luật cần OCR.');
    }

    // Ưu tiên sử dụng LlamaParse nếu đã cấu hình API Key và là tệp PDF
    const llamaKey = this.configService.get<string>('LLAMA_CLOUD_API_KEY');
    const isPdf = Boolean(file.originalname?.toLowerCase().endsWith('.pdf') || file.mimetype === 'application/pdf');
    if (isPdf && llamaKey && llamaKey.trim().length > 0 && this.documentParser) {
      const detailed = await this.documentParser.parsePdfBufferDetailed(file.buffer, file.originalname);
      return {
        text: detailed.cleanedMarkdown,
        raw_text: detailed.rawMarkdown,
        page_count: 1,
        method: 'llamaparse',
      };
    }

    const token = this.configService.get<string>('AI_CORE_INTERNAL_TOKEN');
    if (!token) throw new ServiceUnavailableException('Chưa cấu hình xác thực nội bộ AI Core.');

    const filename = file.originalname.replace(/\\/g, '/').split('/').pop();
    const form = new FormData();
    form.append('file', new Blob([Uint8Array.from(file.buffer)]), filename);

    const baseUrl = this.configService.get<string>('AI_SERVICE_BASE_URL', 'http://localhost:8001');
    const timeout = this.resolveIngestTimeoutMs(600000);
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${baseUrl}/legal/ocr`, form, {
          headers: { 'X-Internal-Token': token },
          timeout,
        }),
      );
      return response.data;
    } catch (error: any) {
      this.rethrowAiError(error, 'AI Core không thể nhận diện văn bản OCR.');
    }
  }

  /** Lưu trữ tệp nhị phân gốc vào thư mục vật lý storage/raw_documents để phục vụ backup và bảo toàn nguồn */
  private saveRawDocumentFile(contentHash: string | undefined, filename: string, buffer: Buffer): void {
    try {
      if (!buffer || buffer.length === 0) return;
      const baseDir = path.resolve(process.cwd(), 'storage/raw_documents');
      const targetDir = fs.existsSync(path.resolve(process.cwd(), 'storage'))
        ? baseDir
        : path.resolve(process.cwd(), '../storage/raw_documents');

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const safeHash = (contentHash || crypto.createHash('sha256').update(buffer).digest('hex')).slice(0, 64);
      const ext = filename && filename.includes('.') ? filename.substring(filename.lastIndexOf('.')) : '.pdf';
      const targetPath = path.join(targetDir, `${safeHash}${ext}`);
      if (!fs.existsSync(targetPath)) {
        fs.writeFileSync(targetPath, buffer);
      }
    } catch {
      // Lưu trữ tệp nhị phân gốc là tác vụ phụ, không làm gián đoạn luồng nghiệp vụ chính
    }
  }

  /** Đồng bộ kết quả lập chỉ mục chạy ngầm vào PostgreSQL đúng một lần cho mỗi mã tiến trình OCR. */
  private syncCompletedOcrJobOnce(ocrJobId: string, filename: string, ingestResult: AiIngestResult): Promise<any> {
    const existing = this.syncedOcrJobs.get(ocrJobId);
    if (existing) return existing;

    if (this.syncedOcrJobs.size > 100) {
      const oldestKey = this.syncedOcrJobs.keys().next().value;
      if (oldestKey) this.syncedOcrJobs.delete(oldestKey);
    }

    const syncPromise = (async () => {
      const dbJobId = await this.jobs!.begin();
      const synced = await this.jobs!.complete(dbJobId, ingestResult);
      this.notifications?.emitNotification('ocr_ingest_completed', {
        ocr_job_id: ocrJobId,
        filename,
        status: synced.status,
        doc_id: synced.doc_id,
        doc_title: synced.doc_title,
        doc_number: synced.doc_number,
        article_count: synced.article_count,
        chunk_count: synced.chunk_count,
      });
      return synced;
    })().catch((err) => {
      this.syncedOcrJobs.delete(ocrJobId);
      throw err;
    });

    this.syncedOcrJobs.set(ocrJobId, syncPromise);
    return syncPromise;
  }

  /** Theo dõi tiến trình OCR chạy ngầm phía máy chủ để vẫn đồng bộ DB kể cả khi người dùng đóng trình duyệt. */
  private watchOcrJobInBackground(ocrJobId: string): void {
    if (process.env.NODE_ENV === 'test') return;
    const baseUrl = this.configService.get<string>('AI_SERVICE_BASE_URL', 'http://localhost:8001');
    const token = this.configService.get<string>('AI_CORE_INTERNAL_TOKEN');
    if (!token) return;

    let attempts = 0;
    const maxAttempts = 360;
    const poll = async () => {
      attempts += 1;
      try {
        const res = await firstValueFrom(
          this.httpService.get(`${baseUrl}/legal/ocr-jobs/${ocrJobId}`, {
            params: { include_text: false },
            headers: { 'X-Internal-Token': token },
            timeout: 30000,
          }),
        );
        const snap = res.data;
        if (snap?.status === 'completed' && snap?.ingest_result && ['indexed', 'duplicate'].includes(snap.ingest_result.status)) {
          await this.syncCompletedOcrJobOnce(ocrJobId, snap.filename || '', snap.ingest_result);
          return;
        }
        if (['completed', 'needs_review', 'failed'].includes(snap?.status)) {
          return;
        }
      } catch {
        // Bỏ qua lỗi mạng thoáng qua; vòng lặp kế tiếp hoặc trình duyệt sẽ đồng bộ lại
      }
      if (attempts < maxAttempts) {
        const timer = setTimeout(() => { void poll(); }, 2500);
        timer.unref?.();
      }
    };
    const initialTimer = setTimeout(() => { void poll(); }, 2500);
    initialTimer.unref?.();
  }

  /** Khởi tạo tác vụ AI OCR chạy ngầm (hỗ trợ tự động lập chỉ mục khi hoàn tất). */
  @Post('ocr-jobs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  async startOcrJob(
    @UploadedFile() file: any,
    @Body('auto_ingest') autoIngest?: string | boolean,
    @Body('metadata') metadata?: string,
    @Body('sourceUrl') sourceUrl?: string,
    @Body('scope') scope?: string,
  ) {
    if (!file?.buffer || !file.originalname) {
      throw new BadRequestException('Thiếu tệp văn bản pháp luật cần quét OCR.');
    }
    if (metadata && typeof metadata === 'string' && metadata.trim()) {
      try {
        JSON.parse(metadata);
      } catch {
        throw new BadRequestException('Metadata phải là JSON hợp lệ.');
      }
    }
    if (![undefined, true, false, 'true', 'false'].includes(autoIngest)) {
      throw new BadRequestException('Tùy chọn tự động nạp chạy ngầm không hợp lệ.');
    }

    const shouldAutoIngest = autoIngest === undefined || autoIngest === true || autoIngest === 'true';
    const filename = file.originalname.replace(/\\/g, '/').split('/').pop() || 'document.pdf';

    // Ưu tiên sử dụng LlamaParse khi đã cấu hình API Key và là tệp PDF
    const llamaKey = this.configService.get<string>('LLAMA_CLOUD_API_KEY');
    const isPdf = Boolean(filename.toLowerCase().endsWith('.pdf') || file.mimetype === 'application/pdf');

    if (isPdf && llamaKey && llamaKey.trim().length > 0 && this.documentParser) {
      const jobId = crypto.randomUUID();
      const state: LlamaBackgroundJob = {
        jobId,
        filename,
        status: 'running',
        stage: 'ocr',
        autoIngest: shouldAutoIngest,
        processedPages: 0,
        totalPages: 1,
        percent: 15,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.llamaJobs.set(jobId, state);

      void this.executeLlamaParseJob(
        jobId,
        file.buffer,
        filename,
        shouldAutoIngest,
        metadata,
        sourceUrl,
        scope,
      );

      return {
        job_id: jobId,
        filename,
        auto_ingest: shouldAutoIngest,
        status: 'running',
        stage: 'ocr',
        percent: 15,
        processed_pages: 0,
        total_pages: 1,
      };
    }

    const token = this.configService.get<string>('AI_CORE_INTERNAL_TOKEN');
    if (!token) throw new ServiceUnavailableException('Chưa cấu hình xác thực nội bộ AI Core.');

    const form = new FormData();
    form.append('file', new Blob([Uint8Array.from(file.buffer)]), filename);
    form.append('auto_ingest', shouldAutoIngest ? 'true' : 'false');
    form.append('metadata', metadata || '');
    if (sourceUrl) form.append('source_url', sourceUrl);
    form.append('scope', scope === 'internal' ? 'internal' : 'public');

    const baseUrl = this.configService.get<string>('AI_SERVICE_BASE_URL', 'http://localhost:8001');
    try {
      const response = await firstValueFrom(
        this.httpService.post(`${baseUrl}/legal/ocr-jobs`, form, {
          headers: { 'X-Internal-Token': token },
          timeout: 60000,
        }),
      );
      if (shouldAutoIngest && response.data?.job_id) {
        this.watchOcrJobInBackground(response.data.job_id);
      }
      return response.data;
    } catch (error: any) {
      this.rethrowAiError(error, 'AI Core không thể khởi tạo tác vụ OCR chạy ngầm.');
    }
  }

  /** Kiểm tra tiến độ theo trang và đồng bộ kết quả nạp của tác vụ AI OCR chạy ngầm. */
  @Get('ocr-jobs/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
  async getOcrJobStatus(@Param('id') id: string, @Query('includeText') includeText?: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new BadRequestException('Mã tiến trình OCR không hợp lệ.');
    }

    // Kiểm tra nếu là tác vụ LlamaParse chạy ngầm trong NestJS
    const llamaJob = this.llamaJobs.get(id);
    if (llamaJob) {
      return {
        job_id: llamaJob.jobId,
        filename: llamaJob.filename,
        status: llamaJob.status,
        stage: llamaJob.stage,
        auto_ingest: llamaJob.autoIngest,
        processed_pages: llamaJob.processedPages,
        total_pages: llamaJob.totalPages,
        percent: llamaJob.percent,
        text: includeText !== 'false' ? llamaJob.text : undefined,
        metadata: llamaJob.metadata,
        ingest_result: llamaJob.ingestResult,
        error: llamaJob.error,
      };
    }

    const token = this.configService.get<string>('AI_CORE_INTERNAL_TOKEN');
    if (!token) throw new ServiceUnavailableException('Chưa cấu hình xác thực nội bộ AI Core.');

    const baseUrl = this.configService.get<string>('AI_SERVICE_BASE_URL', 'http://localhost:8001');
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${baseUrl}/legal/ocr-jobs/${id}`, {
          params: { include_text: includeText !== 'false' },
          headers: { 'X-Internal-Token': token },
          timeout: 60000,
        }),
      );
      const payload = response.data;
      if (
        payload?.status === 'completed' &&
        payload?.ingest_result &&
        ['indexed', 'duplicate'].includes(payload.ingest_result.status)
      ) {
        const syncedResult = await this.syncCompletedOcrJobOnce(id, payload.filename || '', payload.ingest_result);
        return { ...payload, ingest_result: syncedResult };
      }
      return payload;
    } catch (error: any) {
      this.rethrowAiError(error, 'Không thể truy vấn trạng thái tác vụ OCR chạy ngầm.');
    }
  }

  /** Thực thi phân tích tệp PDF bằng LlamaParse và tự động nạp vào ChromaDB/PostgreSQL nếu auto_ingest = true. */
  private async executeLlamaParseJob(
    jobId: string,
    fileBuffer: Buffer,
    filename: string,
    shouldAutoIngest: boolean,
    metadata?: string,
    sourceUrl?: string,
    scope?: string,
  ): Promise<void> {
    const job = this.llamaJobs.get(jobId);
    if (!job || !this.documentParser) return;

    try {
      job.percent = 20;
      job.updatedAt = Date.now();

      const detailed = await this.documentParser.parsePdfBufferDetailed(fileBuffer, filename, {
        onProgress: (p) => {
          job.percent = p;
          job.updatedAt = Date.now();
        },
      });

      job.text = detailed.cleanedMarkdown;
      job.percent = 80;
      job.updatedAt = Date.now();

      if (shouldAutoIngest) {
        job.stage = 'indexing';
        job.percent = 88;
        job.updatedAt = Date.now();

        const baseUrl = this.configService.get<string>('AI_SERVICE_BASE_URL', 'http://localhost:8001');
        const token = this.configService.get<string>('AI_CORE_INTERNAL_TOKEN');
        const form = new FormData();
        form.append('file', new Blob([Uint8Array.from(fileBuffer)]), filename);
        form.append('override_text', detailed.cleanedMarkdown);
        form.append('force_paragraph', 'true');
        if (metadata) form.append('metadata', metadata);
        if (sourceUrl) form.append('source_url', sourceUrl);
        if (scope) form.append('scope', scope);

        const timeout = this.resolveIngestTimeoutMs(300000);
        const response = await firstValueFrom(
          this.httpService.post(`${baseUrl}/legal/ingest`, form, {
            headers: { 'X-Internal-Token': token },
            timeout,
          }),
        );

        const ingestResult = response.data;
        job.ingestResult = ingestResult;
        job.status = ['indexed', 'duplicate'].includes(ingestResult?.status) ? 'completed' : 'needs_review';
        job.stage = 'done';
        job.percent = 100;
        job.updatedAt = Date.now();

        if (['indexed', 'duplicate'].includes(ingestResult?.status)) {
          this.saveRawDocumentFile(ingestResult.content_hash, filename, fileBuffer);
          await this.syncCompletedOcrJobOnce(jobId, filename, ingestResult);
        }
      } else {
        job.status = 'completed';
        job.stage = 'done';
        job.percent = 100;
        job.updatedAt = Date.now();
      }
    } catch (error: any) {
      job.status = 'failed';
      job.stage = 'error';
      const serverDetail = error.response?.data?.detail || error.response?.data?.message || error.message;
      let userFriendlyError = serverDetail || 'Lỗi khi phân tích tệp qua LlamaParse.';
      if (
        error.response?.status === 429 ||
        (typeof serverDetail === 'string' &&
          (serverDetail.includes('429') ||
            serverDetail.includes('RESOURCE_EXHAUSTED') ||
            serverDetail.includes('Quota exceeded') ||
            serverDetail.includes('quota') ||
            serverDetail.includes('Hạn mức')))
      ) {
        userFriendlyError =
          'Hạn mức Gemini Embedding API (Free Tier 1.000 lượt/ngày) đã đạt giới hạn (429 Resource Exhausted). Vui lòng cấu hình thêm GEMINI_API_KEY dự phòng hoặc thử lại sau.';
      } else if (typeof serverDetail === 'string' && serverDetail.includes('Expected Embeddings to be non-empty')) {
        userFriendlyError =
          'Lỗi tạo vector nhúng (Embedding): Khóa API Embedding đạt giới hạn hạn mức và không tạo được vector.';
      }
      job.error = userFriendlyError;
      job.updatedAt = Date.now();
      this.logger.error(`executeLlamaParseJob thất bại cho tệp ${filename}: ${serverDetail}`, error.stack);
    }
  }

  /**
   * Endpoint nạp văn bản pháp luật vào hệ thống RAG (cho phép Admin và Staff).
   * Tiếp nhận tệp tải lên (PDF, DOCX, TXT) và chuỗi JSON metadata (tùy chọn).
   * Nếu không truyền metadata, AI Core sẽ tự động bóc tách metadata từ văn bản.
   * Cờ force_paragraph cho phép yêu cầu phân đoạn toàn văn theo đoạn văn.
   */
  @Post('ingest')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  async ingest(@UploadedFile() file: any, @Body('metadata') metadata?: string,
    @Body('sourceUrl') sourceUrl?: string, @Body('force_paragraph') forceParagraph?: string | boolean,
    @Body('override_text') overrideText?: string) {
    if (!file?.buffer || !file.originalname) {
      throw new BadRequestException('Thiếu tệp văn bản pháp luật.');
    }
    if (metadata && typeof metadata === 'string' && metadata.trim()) {
      try {
        JSON.parse(metadata);
      } catch {
        throw new BadRequestException('Metadata phải là JSON hợp lệ.');
      }
    }
    if (![undefined, true, false, 'true', 'false'].includes(forceParagraph)) {
      throw new BadRequestException('Cờ lập chỉ mục theo đoạn văn không hợp lệ.');
    }

    const token = this.configService.get<string>('AI_CORE_INTERNAL_TOKEN');
    if (!token) throw new ServiceUnavailableException('Chưa cấu hình xác thực nội bộ AI Core.');

    const filename = file.originalname.replace(/\\/g, '/').split('/').pop() || 'document.pdf';
    const llamaKey = this.configService.get<string>('LLAMA_CLOUD_API_KEY');
    const isPdf = Boolean(filename.toLowerCase().endsWith('.pdf') || file.mimetype === 'application/pdf');

    // Nếu là tệp PDF và chưa có văn bản chỉnh sửa thủ công, ưu tiên trích xuất toàn bộ bằng LlamaParse
    let extractedText = overrideText;
    let shouldForceParagraph = forceParagraph === true || forceParagraph === 'true';

    if (!extractedText && isPdf && llamaKey && llamaKey.trim().length > 0 && this.documentParser) {
      try {
        const detailed = await this.documentParser.parsePdfBufferDetailed(file.buffer, filename);
        if (detailed.cleanedMarkdown && detailed.cleanedMarkdown.trim().length > 50) {
          extractedText = detailed.cleanedMarkdown;
          shouldForceParagraph = true;
        }
      } catch {
        // Nếu LlamaParse gián đoạn, tự động chuyển về cơ chế trích xuất văn bản nội bộ AI Core
      }
    }

    const form = new FormData();
    form.append('file', new Blob([Uint8Array.from(file.buffer)]), filename);
    form.append('metadata', metadata || '');
    if (sourceUrl) form.append('source_url', sourceUrl);
    if (shouldForceParagraph) form.append('force_paragraph', 'true');
    if (typeof extractedText === 'string' && extractedText.trim()) form.append('override_text', extractedText.trim());

    const baseUrl = this.configService.get<string>('AI_SERVICE_BASE_URL', 'http://localhost:8001');
    const timeout = this.resolveIngestTimeoutMs(600000);
    const jobId = await this.jobs!.begin();
    let result: AiIngestResult;
    try {
      const response = await firstValueFrom(this.httpService.post(`${baseUrl}/legal/ingest`, form, {
        headers: { 'X-Internal-Token': token },
        timeout,
      }));
      result = response.data;
    } catch (error: any) {
      await this.jobs!.fail(jobId);
      this.rethrowAiError(error, 'AI Core không thể nạp văn bản.');
    }
    const completed = await this.jobs!.complete(jobId, result);

    if (['indexed', 'duplicate'].includes(completed?.status)) {
      this.saveRawDocumentFile(completed.content_hash || result.content_hash, filename, file.buffer);
      this.notifications?.emitNotification('ingest_completed', {
        status: completed.status,
        doc_id: completed.doc_id,
        doc_title: completed.doc_title,
        doc_number: completed.doc_number,
        article_count: completed.article_count,
        chunk_count: completed.chunk_count,
      });
    }
    return completed;
  }

  /** Nạp văn bản dán như tệp TXT ảo, chỉ nhận nội dung và URL nguồn tùy chọn. */
  @Post('ingest-text')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
  async ingestText(@Body() body: { content: string; sourceUrl?: string }) {
    if (typeof body?.content !== 'string' || !body.content.trim()) {
      throw new BadRequestException('Vui lòng dán nội dung văn bản.');
    }
    const bytes = Buffer.from(body.content.trim(), 'utf8');
    if (bytes.length > MAX_FILE_BYTES) throw new BadRequestException('Văn bản vượt quá giới hạn 15 MB.');
    return this.ingest({ buffer: bytes, originalname: 'pasted_text.txt' }, undefined, body.sourceUrl);
  }

  /** Nạp URL qua API nội bộ rồi đồng bộ metadata nhận diện vào PostgreSQL. */
  @Post('ingest-url')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
  async ingestUrl(@Body() body: { url: string }) {
    if (typeof body?.url !== 'string' || !body.url.trim()) {
      throw new BadRequestException('Vui lòng nhập URL công khai.');
    }
    const token = this.configService.get<string>('AI_CORE_INTERNAL_TOKEN');
    if (!token) throw new ServiceUnavailableException('Chưa cấu hình xác thực nội bộ AI Core.');
    const baseUrl = this.configService.get<string>('AI_SERVICE_BASE_URL', 'http://localhost:8001');
    const timeout = this.resolveIngestTimeoutMs(180000);
    const jobId = await this.jobs!.begin();
    let result: AiIngestResult;
    try {
      const response = await firstValueFrom(this.httpService.post(`${baseUrl}/ingest-url`, { url: body.url.trim() }, {
        headers: { 'X-Internal-Token': token }, timeout,
      }));
      result = response.data;
    } catch (error: any) {
      await this.jobs!.fail(jobId);
      this.rethrowAiError(error, 'AI Core không thể nạp URL.');
    }
    const completed = await this.jobs!.complete(jobId, result);
    if (['indexed', 'duplicate'].includes(completed?.status)) {
      this.notifications?.emitNotification('ingest_completed', {
        status: completed.status,
        doc_id: completed.doc_id,
        doc_title: completed.doc_title,
        doc_number: completed.doc_number,
        article_count: completed.article_count,
        chunk_count: completed.chunk_count,
      });
    }
    return completed;
  }
}
