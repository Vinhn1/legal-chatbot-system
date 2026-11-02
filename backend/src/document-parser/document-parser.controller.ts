import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DocumentParserService } from './document-parser.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';

/** Giới hạn kích thước tệp PDF tối đa là 25 MB */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

@Controller('documents')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'staff')
export class DocumentParserController {
  constructor(
    private readonly documentParserService: DocumentParserService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Kiểm tra tình trạng cấu hình LlamaCloud API Key trên hệ thống.
   */
  @Get('parse/health')
  checkConfig() {
    const apiKey = this.configService.get<string>('LLAMA_CLOUD_API_KEY');
    const isConfigured = Boolean(apiKey && apiKey.trim().length > 0);
    return {
      success: true,
      service: 'LlamaParse Document Parser',
      isConfigured,
      message: isConfigured
        ? 'LLAMA_CLOUD_API_KEY đã được cấu hình sẵn sàng.'
        : 'Chưa cấu hình LLAMA_CLOUD_API_KEY trong biến môi trường (.env).',
    };
  }

  /**
   * Endpoint tiếp nhận tệp PDF để phân tích cấu trúc sang Markdown thông qua LlamaParse API.
   * Hỗ trợ tệp PDF có văn bản, PDF scan dạng hình ảnh và con dấu đỏ đè chữ.
   */
  @Post('parse')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  async parsePdf(
    @UploadedFile() file: any,
    @Query('clean') cleanQuery?: string,
  ) {
    if (!file?.buffer || !file.originalname) {
      throw new BadRequestException('Vui lòng đính kèm tệp PDF trong trường "file" (multipart/form-data).');
    }

    const originalName = String(file.originalname).toLowerCase();
    const isPdf = originalName.endsWith('.pdf') || file.mimetype === 'application/pdf';
    if (!isPdf) {
      throw new BadRequestException('Định dạng tệp không được hỗ trợ. Vui lòng tải lên tệp định dạng PDF (.pdf).');
    }

    // Xác thực magic bytes header %PDF-
    if (file.buffer.length < 5 || file.buffer.toString('ascii', 0, 5) !== '%PDF-') {
      throw new BadRequestException('Tệp tải lên không phải là tệp PDF hợp lệ (thiếu tiêu đề %PDF- chuẩn).');
    }

    const detailedResult = await this.documentParserService.parsePdfBufferDetailed(
      file.buffer,
      file.originalname,
    );

    const shouldClean = cleanQuery !== 'false';

    return {
      success: true,
      jobId: detailedResult.jobId,
      fileName: detailedResult.fileName,
      markdown: shouldClean ? detailedResult.cleanedMarkdown : detailedResult.rawMarkdown,
      rawMarkdown: detailedResult.rawMarkdown,
      cleanedMarkdown: detailedResult.cleanedMarkdown,
      characterCount: shouldClean ? detailedResult.cleanedMarkdown.length : detailedResult.rawMarkdown.length,
      createdAt: new Date().toISOString(),
    };
  }
}
