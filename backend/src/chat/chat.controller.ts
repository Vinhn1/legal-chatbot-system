import {
  Body, Controller, Delete, Get, HttpException, HttpStatus, Param,
  Post, Query, Request, UploadedFile, UseGuards, UseInterceptors,
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
  async handleChat(@Body('message') message: string, @Body('sessionId') sessionId?: string, @Body('sessionToken') sessionToken?: string) {
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
    const session = this.chatService.authorizeSession(sessionId, sessionToken);
    const answer = await this.chatService.sendMessageToAi(normalized, session.sessionId);
    return { ...answer, ...session };
  }

  /** Cung cấp số liệu công khai đã được AI Core lọc theo quyền truy cập. */
  @Get('public-summary')
  getPublicSummary() {
    return this.chatService.getPublicSummary();
  }

  @Get('history')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
  getHistory(@Query('before') before?: string, @Query('limit') limit?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.chatService.getAllHistory(before === undefined ? undefined : Number(before), limit === undefined ? 100 : Number(limit), from, to);
  }

  /** Các chỉ số không phụ thuộc nội dung câu từ chối. */
  @Get('analytics')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
  analytics() { return this.chatService.analytics(); }

  @Post('history/:sessionId/review')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
  review(@Param('sessionId') sessionId: string, @Body('status') status: string, @Request() req: any) {
    return this.chatService.review(sessionId, status, req.user.userId);
  }

  @Get('history/:sessionId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
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
  updateModelConfig(@Body() input: { provider?: string; api_key?: string; embedding_api_key?: string }) { return this.chatService.updateModelConfig(input); }

  @Post('model-test')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  testModelConnection(@Body() input: { provider?: string; api_key?: string }) { return this.chatService.testModelConnection(input); }

  @Post('embedding-test')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  testEmbeddingConnection(@Body() input: { api_key?: string }) { return this.chatService.testEmbeddingConnection(input); }

  @Get('documents')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
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

  @Post('documents/bulk-delete')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  bulkDeleteDocuments(@Body('ids') ids: string[]) {
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new HttpException('Danh sách mã tài liệu cần xóa không hợp lệ', HttpStatus.BAD_REQUEST);
    }
    return this.chatService.deleteDocuments(ids);
  }

  @Post('ingest-url')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
  ingestFromUrl(@Body('url') url: string) {
    if (!url) {
      throw new HttpException('Thiếu URL', HttpStatus.BAD_REQUEST);
    }
    return this.chatService.ingestFromUrl(url);
  }

  @Post('ingest-html')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
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
  @Roles('admin', 'staff')
  getWebDocumentChunks(@Query('name') name: string) {
    return this.chatService.getWebDocumentChunks(name);
  }

  /** Trả danh sách các đoạn hoặc Điều đã lập chỉ mục của một văn bản cụ thể cho ngăn kéo chi tiết. */
  @Get('documents/:id/chunks')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
  getDocumentChunks(@Param('id') id: string) {
    if (!id || !/^[A-Za-z0-9_:-]{1,120}$/.test(id)) {
      throw new HttpException('Mã tài liệu không hợp lệ', HttpStatus.BAD_REQUEST);
    }
    return this.chatService.getDocumentChunks(id);
  }

  @Post('upload')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'staff')
  // Giới hạn ngay tại lớp nhận multipart trước khi chuyển tệp tới AI Core.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  uploadFile(@UploadedFile() file: any) {
    if (!file) {
      throw new HttpException('Thiếu tệp', HttpStatus.BAD_REQUEST);
    }
    return this.chatService.uploadDocument(file);
  }

  /** Cung cấp danh sách câu hỏi mẫu tra cứu được tạo dựa trên các văn bản mới nhất. */
  @Get('suggestions')
  getSuggestions(@Query('refresh') refresh?: string) {
    return this.chatService.getDynamicSuggestions(refresh === 'true');
  }
}
