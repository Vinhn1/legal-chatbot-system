import {
  Body, Controller, Delete, Get, HttpException, HttpStatus, Param,
  Post, Query, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ChatService } from './chat.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import { RateLimiterGuard } from '../common/guards/rate-limiter.guard';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /** Xác thực câu hỏi công khai trước khi chuyển sang dịch vụ truy xuất pháp luật. */
  @Post()
  @UseGuards(RateLimiterGuard)
  async handleChat(@Body('message') message: string, @Body('sessionId') sessionId?: string) {
    if (typeof message !== 'string' || !message.trim()) {
      throw new HttpException('Tin nhắn không được để trống', HttpStatus.BAD_REQUEST);
    }
    const normalized = message.trim();
    if (normalized.length > 2000) {
      throw new HttpException('Câu hỏi không được vượt quá 2000 ký tự', HttpStatus.BAD_REQUEST);
    }
    // Từ chối mã HTML thực thi được trước khi lưu hội thoại hoặc gọi AI Core.
    if (/<\s*script\b|\bon\w+\s*=|javascript\s*:/i.test(normalized)) {
      throw new HttpException('Câu hỏi chứa nội dung không hợp lệ', HttpStatus.BAD_REQUEST);
    }
    return this.chatService.sendMessageToAi(normalized, sessionId);
  }

  /** Cung cấp số liệu công khai đã được AI Core lọc theo quyền truy cập. */
  @Get('public-summary')
  getPublicSummary() {
    return this.chatService.getPublicSummary();
  }

  @Get('history')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  getHistory() {
    return this.chatService.getAllHistory();
  }

  @Get('history/:sessionId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  getSessionHistory(@Param('sessionId') sessionId: string) {
    return this.chatService.getSessionHistory(sessionId);
  }

  @Get('config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  getConfig() {
    return this.chatService.getRagConfig();
  }

  @Post('config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  updateConfig(@Body() config: unknown) {
    return this.chatService.updateRagConfig(config);
  }

  /** Chỉ quản trị viên được đọc cấu hình khóa đã che hoặc thay đổi khóa. */
  @Get('model-config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  getModelConfig() { return this.chatService.getModelConfig(); }

  @Post('model-config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  updateModelConfig(@Body() input: { provider?: string; api_key?: string }) { return this.chatService.updateModelConfig(input); }

  @Post('model-test')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  testModelConnection(@Body() input: { provider?: string; api_key?: string }) { return this.chatService.testModelConnection(input); }

  @Get('documents')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  getDocuments() {
    return this.chatService.getDocuments();
  }

  @Delete('documents')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  deleteDocument(@Query('name') name: string) {
    if (!name) {
      throw new HttpException('Thiếu tên tài liệu', HttpStatus.BAD_REQUEST);
    }
    return this.chatService.deleteDocument(name);
  }

  @Post('ingest-url')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  ingestFromUrl(@Body('url') url: string) {
    if (!url) {
      throw new HttpException('Thiếu URL', HttpStatus.BAD_REQUEST);
    }
    return this.chatService.ingestFromUrl(url);
  }

  @Post('ingest-html')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  ingestFromHtml(
    @Body('source_title') sourceTitle: string,
    @Body('html_content') htmlContent: string,
    @Body('source_url') sourceUrl?: string,
  ) {
    if (!htmlContent) {
      throw new HttpException('Thiếu nội dung', HttpStatus.BAD_REQUEST);
    }
    return this.chatService.ingestFromHtml(sourceTitle, htmlContent, sourceUrl);
  }

  @Get('documents/web-chunks')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  getWebDocumentChunks(@Query('name') name: string) {
    return this.chatService.getWebDocumentChunks(name);
  }

  @Post('upload')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  // Giới hạn ngay tại lớp nhận multipart trước khi chuyển tệp tới AI Core.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  uploadFile(@UploadedFile() file: any) {
    if (!file) {
      throw new HttpException('Thiếu tệp', HttpStatus.BAD_REQUEST);
    }
    return this.chatService.uploadDocument(file);
  }

  @Get('suggestions')
  getSuggestions() {
    return this.chatService.getDynamicSuggestions();
  }
}
