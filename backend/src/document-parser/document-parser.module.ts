import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { DocumentParserService } from './document-parser.service';
import { DocumentParserController } from './document-parser.controller';

/**
 * Module xử lý đọc và trích xuất tài liệu PDF pháp luật phức tạp (scan, dấu đỏ) bằng LlamaParse API.
 */
@Module({
  imports: [
    HttpModule,
    ConfigModule,
  ],
  controllers: [DocumentParserController],
  providers: [DocumentParserService],
  exports: [DocumentParserService],
})
export class DocumentParserModule {}
