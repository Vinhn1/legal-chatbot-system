import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { LegalArticle } from './entities/legal-article.entity';
import { LegalDocument } from './entities/legal-document.entity';
import { LegalController } from './legal.controller';
import { LegalService } from './legal.service';
import { IngestionJobsService } from './ingestion-jobs.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { DocumentParserModule } from '../document-parser/document-parser.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([LegalDocument, LegalArticle]),
    HttpModule,
    NotificationsModule,
    DocumentParserModule,
  ],
  controllers: [LegalController],
  providers: [LegalService, IngestionJobsService],
  exports: [LegalService, IngestionJobsService],
})
export class LegalModule {}
