/** DTO yêu cầu khôi phục bản sao lưu dữ liệu có mã xác nhận an toàn */
export class RestoreBackupDto {
  filename: string;
  confirmation: string;
}
