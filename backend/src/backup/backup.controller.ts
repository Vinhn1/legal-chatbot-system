import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  Res,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { BackupService } from './backup.service';
import { RestoreBackupDto } from './dto/restore-backup.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/guards/roles.decorator';
import * as fs from 'fs';

@Controller('admin/backups')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  /** Lấy danh sách các bản sao lưu và chỉ số vận hành */
  @Get()
  async listBackups() {
    return await this.backupService.listBackups();
  }

  /** Kích hoạt tiến trình sao lưu toàn diện thủ công */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  async runBackup() {
    return await this.backupService.createBackup();
  }

  /** Tải tệp sao lưu .tar.gz về máy quản trị viên */
  @Get('download/:filename')
  async downloadBackup(@Param('filename') filename: string, @Res() res: any) {
    const filePath = this.backupService.getBackupFilePath(filename);
    const stat = fs.statSync(filePath);

    res.set({
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Content-Length': stat.size,
    });

    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);
  }

  /** Phục hồi cơ sở dữ liệu và vector DB từ bản sao lưu đã chọn */
  @Post('restore')
  @HttpCode(HttpStatus.OK)
  async restoreBackup(@Body() dto: RestoreBackupDto) {
    return await this.backupService.restoreBackup(dto.filename, dto.confirmation);
  }

  /** Xóa bản sao lưu cũ */
  @Delete(':filename')
  @HttpCode(HttpStatus.OK)
  async deleteBackup(@Param('filename') filename: string) {
    return await this.backupService.deleteBackup(filename);
  }

  /** Đọc nhật ký sao lưu và phục hồi gần nhất */
  @Get('logs')
  async getLogs() {
    return await this.backupService.getRecentLogs();
  }
}
