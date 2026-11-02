import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersService } from './users.service';
import { User } from './user.entity';
import { UsersController } from './users.controller';
import { EmailModule } from '../email/email.module';
import { OtpModule } from '../auth/otp.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User]),
    EmailModule,
    OtpModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}


