import {
  BadRequestException, Body, Controller, HttpException, HttpStatus, Post,
  ServiceUnavailableException, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { firstValueFrom } from 'rxjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { LegalService } from './legal.service';
import { AccessScope, EffectiveStatus, LegalDocumentType } from './entities/legal-document.entity';

// Giới hạn kích thước tệp tải lên tối đa là 15 MB
const MAX_FILE_BYTES = 15 * 1024 * 1024;

/** Phản hồi nạp đã chuẩn hóa từ AI Core để đồng bộ hai kho dữ liệu. */
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
  [key: string]: unknown;
}

/**
 * Controller tiếp nhận và xử lý các thao tác quản lý dữ liệu pháp luật.
 */
@Controller('legal')
export class LegalController {
  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly legalService: LegalService,
  ) {}

  /** Ghi danh mục một lần theo hàm băm sau khi vector đã được lập chỉ mục. */
  private async syncDocument(result: AiIngestResult): Promise<AiIngestResult> {
    if (!['indexed', 'duplicate'].includes(result.status)) return result;
    const existing = await this.legalService.findByContentHash(result.content_hash);
    if (!existing) {
      await this.legalService.createDocument({
        documentNumber: result.doc_number,
        documentType: result.document_type,
        title: result.doc_title,
        issuingAuthority: result.issuing_authority,
        issuedDate: result.issued_date,
        effectiveDate: result.effective_date,
        effectiveStatus: result.effective_status,
        sourceUrl: result.source_url,
        contentHash: result.content_hash,
        scope: result.scope,
      });
    }
    return result;
  }

  /** Chuyển lỗi dịch vụ nguồn thành mã HTTP rõ ràng, không ghi nội dung tài liệu vào log. */
  private rethrowAiError(error: any, fallback: string): never {
    const detail = error.response?.data?.detail || fallback;
    throw new HttpException(detail, error.response?.status || HttpStatus.SERVICE_UNAVAILABLE);
  }

  /**
   * Endpoint tự động trích xuất thông tin phân loại & metadata của văn bản.
   * Tiếp nhận tệp tải lên và chuyển tiếp sang AI Core để bóc tách thông tin trước khi nạp.
   */
  @Post('extract-metadata')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
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
    const timeout = this.configService.get<number>('AI_SERVICE_TIMEOUT_MS', 180000);

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
   * Endpoint nạp văn bản pháp luật vào hệ thống RAG (chỉ cho phép quyền Admin).
   * Tiếp nhận tệp tải lên (PDF, DOCX, TXT) và chuỗi JSON metadata (tùy chọn).
   * Nếu không truyền metadata, AI Core sẽ tự động bóc tách metadata từ văn bản.
   * Cờ force_paragraph chỉ được chuyển tiếp khi quản trị viên xác nhận rà soát.
   */
  @Post('ingest')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  async ingest(@UploadedFile() file: any, @Body('metadata') metadata?: string,
    @Body('sourceUrl') sourceUrl?: string, @Body('force_paragraph') forceParagraph?: string | boolean) {
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

    const filename = file.originalname.replace(/\\/g, '/').split('/').pop();
    const form = new FormData();
    form.append('file', new Blob([Uint8Array.from(file.buffer)]), filename);
    form.append('metadata', metadata || '');
    if (sourceUrl) form.append('source_url', sourceUrl);
    if (forceParagraph === true || forceParagraph === 'true') form.append('force_paragraph', 'true');
    const baseUrl = this.configService.get<string>('AI_SERVICE_BASE_URL', 'http://localhost:8001');
    const timeout = this.configService.get<number>('AI_SERVICE_TIMEOUT_MS', 180000);
    let result: AiIngestResult;
    try {
      const response = await firstValueFrom(this.httpService.post(`${baseUrl}/legal/ingest`, form, {
        headers: { 'X-Internal-Token': token },
        timeout,
      }));
      result = response.data;
    } catch (error: any) {
      this.rethrowAiError(error, 'AI Core không thể nạp văn bản.');
    }
    return this.syncDocument(result);
  }

  /** Nạp văn bản dán như tệp TXT ảo, chỉ nhận nội dung và URL nguồn tùy chọn. */
  @Post('ingest-text')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
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
  @Roles('admin')
  async ingestUrl(@Body() body: { url: string }) {
    if (typeof body?.url !== 'string' || !body.url.trim()) {
      throw new BadRequestException('Vui lòng nhập URL công khai.');
    }
    const token = this.configService.get<string>('AI_CORE_INTERNAL_TOKEN');
    if (!token) throw new ServiceUnavailableException('Chưa cấu hình xác thực nội bộ AI Core.');
    const baseUrl = this.configService.get<string>('AI_SERVICE_BASE_URL', 'http://localhost:8001');
    const timeout = this.configService.get<number>('AI_SERVICE_TIMEOUT_MS', 180000);
    let result: AiIngestResult;
    try {
      const response = await firstValueFrom(this.httpService.post(`${baseUrl}/ingest-url`, { url: body.url.trim() }, {
        headers: { 'X-Internal-Token': token }, timeout,
      }));
      result = response.data;
    } catch (error: any) {
      this.rethrowAiError(error, 'AI Core không thể nạp URL.');
    }
    return this.syncDocument(result);
  }
}
