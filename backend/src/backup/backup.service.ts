import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

export interface BackupItem {
  filename: string;
  sizeBytes: number;
  sizeFormatted: string;
  createdAt: string;
  type: 'scheduled' | 'manual' | 'safety';
  typeLabel: string;
  hasSha256: boolean;
  sha256Value?: string;
}

export interface BackupStatusOverview {
  totalBackups: number;
  totalSizeBytes: number;
  totalSizeFormatted: string;
  lastBackupAt: string | null;
  latestBackupFile: string | null;
  scheduledCron: string;
  isProcessRunning: boolean;
  currentAction: string | null;
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private isRunning = false;
  private currentActionDescription: string | null = null;

  /** Xác định đường dẫn thư mục gốc của dự án */
  private getProjectRoot(): string {
    const cwd = process.cwd();
    if (fs.existsSync(path.resolve(cwd, 'scripts/backup.sh'))) {
      return path.resolve(cwd);
    }
    if (fs.existsSync(path.resolve(cwd, '../scripts/backup.sh'))) {
      return path.resolve(cwd, '..');
    }
    return cwd;
  }

  /** Thư mục chứa các gói sao lưu storage/backups */
  private getBackupsDir(): string {
    const root = this.getProjectRoot();
    const dir = path.join(root, 'storage', 'backups');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /** Định dạng dung lượng byte sang đơn vị KB/MB/GB dễ đọc */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  /** Lấy danh sách các bản sao lưu hiện có và thông tin tổng quan */
  async listBackups(): Promise<{ items: BackupItem[]; status: BackupStatusOverview }> {
    const backupsDir = this.getBackupsDir();
    const files = fs.readdirSync(backupsDir);

    const items: BackupItem[] = [];
    let totalSizeBytes = 0;
    let latestTime = 0;
    let latestFile: string | null = null;

    for (const file of files) {
      if (!file.endsWith('.tar.gz')) continue;

      const fullPath = path.join(backupsDir, file);
      try {
        const stats = fs.statSync(fullPath);
        totalSizeBytes += stats.size;

        if (stats.mtimeMs > latestTime) {
          latestTime = stats.mtimeMs;
          latestFile = file;
        }

        const shaPath = `${fullPath}.sha256`;
        const hasSha = fs.existsSync(shaPath);
        let shaValue: string | undefined = undefined;
        if (hasSha) {
          try {
            const raw = fs.readFileSync(shaPath, 'utf8').trim();
            shaValue = raw.split(/\s+/)[0];
          } catch {
            // Không chặn tiến trình nếu đọc tệp sha thất bại
          }
        }

        // Phân loại bản sao lưu theo tiền tố và thời gian
        let type: 'scheduled' | 'manual' | 'safety' = 'manual';
        let typeLabel = 'Thủ công';
        if (file.startsWith('safety_before_restore_')) {
          type = 'safety';
          typeLabel = 'Ảnh chụp an toàn';
        } else if (file.startsWith('backup_')) {
          // Kiểm tra nếu tạo vào khung giờ 02:xx (theo cấu hình cron tự động)
          const timeMatch = file.match(/backup_\d{8}_(\d{2})\d{4}\.tar\.gz/);
          if (timeMatch && timeMatch[1] === '02') {
            type = 'scheduled';
            typeLabel = 'Tự động định kỳ';
          }
        }

        items.push({
          filename: file,
          sizeBytes: stats.size,
          sizeFormatted: this.formatBytes(stats.size),
          createdAt: stats.mtime.toISOString(),
          type,
          typeLabel,
          hasSha256: hasSha,
          sha256Value: shaValue,
        });
      } catch (err) {
        this.logger.warn(`Không thể đọc thông tin tệp ${file}: ${err}`);
      }
    }

    // Sắp xếp bản sao lưu mới nhất lên đầu
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const status: BackupStatusOverview = {
      totalBackups: items.length,
      totalSizeBytes,
      totalSizeFormatted: this.formatBytes(totalSizeBytes),
      lastBackupAt: latestTime > 0 ? new Date(latestTime).toISOString() : null,
      latestBackupFile: latestFile,
      scheduledCron: '02:00 sáng mỗi ngày (Cron)',
      isProcessRunning: this.isRunning,
      currentAction: this.currentActionDescription,
    };

    return { items, status };
  }

  /** Kích hoạt tiến trình sao lưu toàn diện theo yêu cầu */
  async createBackup(): Promise<{ message: string; output: string }> {
    if (this.isRunning) {
      throw new ConflictException(
        `Đang có một tiến trình ${this.currentActionDescription || 'sao lưu/phục hồi'} đang chạy. Vui lòng chờ tiến trình hoàn tất.`,
      );
    }

    this.isRunning = true;
    this.currentActionDescription = 'Sao lưu toàn diện hệ thống';
    const root = this.getProjectRoot();
    const scriptPath = path.join(root, 'scripts', 'backup.sh');

    if (!fs.existsSync(scriptPath)) {
      this.isRunning = false;
      this.currentActionDescription = null;
      throw new NotFoundException(`Không tìm thấy kịch bản sao lưu tại ${scriptPath}`);
    }

    this.logger.log(`Bắt đầu chạy kịch bản sao lưu: ${scriptPath}`);

    return new Promise((resolve, reject) => {
      const child = spawn('/bin/bash', [scriptPath], {
        cwd: root,
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        this.isRunning = false;
        this.currentActionDescription = null;

        if (code === 0) {
          this.logger.log('Kịch bản sao lưu hoàn thành thành công mã thoát 0.');
          resolve({
            message: 'Tạo bản sao lưu toàn diện hệ thống thành công.',
            output: stdout,
          });
        } else {
          this.logger.error(`Sao lưu thất bại với mã lỗi ${code}: ${stderr}`);
          reject(
            new InternalServerErrorException(
              `Tiến trình sao lưu thất bại (mã thoát ${code}): ${stderr || stdout}`,
            ),
          );
        }
      });

      child.on('error', (err) => {
        this.isRunning = false;
        this.currentActionDescription = null;
        this.logger.error(`Lỗi kích hoạt tiến trình sao lưu: ${err.message}`);
        reject(new InternalServerErrorException(`Không thể khởi chạy kịch bản sao lưu: ${err.message}`));
      });
    });
  }

  /** Kích hoạt quy trình khôi phục an toàn từ bản sao lưu đã chọn */
  async restoreBackup(
    filename: string,
    confirmation: string,
  ): Promise<{ message: string; output: string }> {
    if (confirmation !== 'XAC-NHAN-PHUC-HOI') {
      throw new BadRequestException(
        'Mã xác nhận không chính xác. Bạn phải nhập chính xác chuỗi: XAC-NHAN-PHUC-HOI để bảo vệ an toàn dữ liệu.',
      );
    }

    if (this.isRunning) {
      throw new ConflictException(
        `Đang có một tiến trình ${this.currentActionDescription || 'hệ thống'} đang chạy. Vui lòng chờ hoàn tất.`,
      );
    }

    const safeName = this.validateBackupFilename(filename);
    const backupsDir = this.getBackupsDir();
    const targetFile = path.join(backupsDir, safeName);

    if (!fs.existsSync(targetFile)) {
      throw new NotFoundException(`Bản sao lưu ${safeName} không tồn tại trên hệ thống.`);
    }

    this.isRunning = true;
    this.currentActionDescription = `Khôi phục dữ liệu từ ${safeName}`;
    const root = this.getProjectRoot();
    const scriptPath = path.join(root, 'scripts', 'restore.sh');

    if (!fs.existsSync(scriptPath)) {
      this.isRunning = false;
      this.currentActionDescription = null;
      throw new NotFoundException(`Không tìm thấy kịch bản khôi phục tại ${scriptPath}`);
    }

    this.logger.log(`Bắt đầu chạy kịch bản phục hồi từ gói: ${targetFile}`);

    return new Promise((resolve, reject) => {
      const child = spawn('/bin/bash', [scriptPath, targetFile], {
        cwd: root,
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        this.isRunning = false;
        this.currentActionDescription = null;

        if (code === 0) {
          this.logger.log('Kịch bản khôi phục hoàn tất thành công mã thoát 0.');
          resolve({
            message: `Khôi phục dữ liệu từ bản sao lưu ${safeName} thành công.`,
            output: stdout,
          });
        } else {
          this.logger.error(`Khôi phục thất bại với mã lỗi ${code}: ${stderr}`);
          reject(
            new InternalServerErrorException(
              `Tiến trình phục hồi thất bại (mã thoát ${code}): ${stderr || stdout}`,
            ),
          );
        }
      });

      child.on('error', (err) => {
        this.isRunning = false;
        this.currentActionDescription = null;
        this.logger.error(`Lỗi kích hoạt tiến trình phục hồi: ${err.message}`);
        reject(new InternalServerErrorException(`Không thể khởi chạy kịch bản phục hồi: ${err.message}`));
      });
    });
  }

  /** Kiểm tra định dạng tên tệp sao lưu hợp lệ, ngăn chặn path traversal và thao tác tệp tùy ý */
  private validateBackupFilename(filename: string): string {
    const safeName = path.basename(filename);
    const validPattern = /^(backup|safety_before_restore)_\d{8}_\d{6}\.tar\.gz(\.enc)?$/;
    if (!validPattern.test(safeName)) {
      throw new BadRequestException('Tên tệp sao lưu không hợp lệ. Chỉ chấp nhận tệp định dạng nén chuẩn của hệ thống.');
    }
    return safeName;
  }

  /** Lấy đường dẫn tệp sao lưu an toàn để tải xuống */
  getBackupFilePath(filename: string): string {
    const safeName = this.validateBackupFilename(filename);
    const fullPath = path.join(this.getBackupsDir(), safeName);
    if (!fs.existsSync(fullPath)) {
      throw new NotFoundException(`Tệp sao lưu ${safeName} không tồn tại.`);
    }
    return fullPath;
  }

  /** Xóa bản sao lưu cũ không còn nhu cầu lưu trữ */
  async deleteBackup(filename: string): Promise<{ message: string }> {
    const safeName = this.validateBackupFilename(filename);
    const backupsDir = this.getBackupsDir();
    const fullPath = path.join(backupsDir, safeName);
    const shaPath = `${fullPath}.sha256`;

    if (!fs.existsSync(fullPath)) {
      throw new NotFoundException(`Tệp sao lưu ${safeName} không tồn tại.`);
    }

    try {
      fs.unlinkSync(fullPath);
      if (fs.existsSync(shaPath)) {
        fs.unlinkSync(shaPath);
      }
      this.logger.log(`Đã xóa bản sao lưu: ${safeName}`);
      return { message: `Đã xóa bản sao lưu ${safeName} thành công.` };
    } catch (err: any) {
      throw new InternalServerErrorException(`Không thể xóa bản sao lưu: ${err.message}`);
    }
  }

  /** Đọc nhật ký vận hành sao lưu và phục hồi gần nhất */
  async getRecentLogs(): Promise<{ backupLog: string; restoreLog: string }> {
    const backupsDir = this.getBackupsDir();
    const backupLogPath = path.join(backupsDir, 'backup.log');
    const restoreLogPath = path.join(backupsDir, 'restore.log');

    const readTail = (filePath: string, maxLines = 80): string => {
      if (!fs.existsSync(filePath)) return 'Chưa có dữ liệu nhật ký.';
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n');
        return lines.slice(-maxLines).join('\n');
      } catch {
        return 'Không thể đọc tệp nhật ký.';
      }
    };

    return {
      backupLog: readTail(backupLogPath),
      restoreLog: readTail(restoreLogPath),
    };
  }
}
