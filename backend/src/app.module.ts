import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ChatModule } from './chat/chat.module';
import { ChatHistoryModule } from './chat-history/chat-history.module';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { NotificationsModule } from './notifications/notifications.module';
import { EmailModule } from './email/email.module';
import { User } from './users/user.entity';
import { ChatHistory } from './chat-history/chat-history.entity';
import { LegalModule } from './legal/legal.module';
import { LegalDocument } from './legal/entities/legal-document.entity';
import { LegalArticle } from './legal/entities/legal-article.entity';
import { ModelConfig } from './chat/model-config.entity';

@Module({
  imports: [
    // 1. Load các biến môi trường từ file .env ra toàn app (isGlobal: true)
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    // 2. Cấu hình kết nối PostgreSQL sử dụng các biến từ ConfigService
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 5432),
        username: configService.get<string>('DB_USERNAME'),
        password: configService.get<string>('DB_PASSWORD'),
        database: configService.get<string>('DB_DATABASE'),
        entities: [User, ChatHistory, LegalDocument, LegalArticle, ModelConfig],
        // Tự động đồng bộ hóa cấu trúc bảng trong Code với Database (tắt ở production/staging)
        synchronize: configService.get<string>('DB_SYNCHRONIZE') === 'true',

      }),
    }),

    ChatModule,


    ChatHistoryModule,

    UsersModule,

    AuthModule,


    NotificationsModule,
    EmailModule,
    LegalModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
