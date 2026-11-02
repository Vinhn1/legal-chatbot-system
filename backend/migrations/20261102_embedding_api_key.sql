-- Thêm cột lưu trữ khóa API Embedding đã mã hóa vào bảng cấu hình mô hình
ALTER TABLE model_config ADD COLUMN IF NOT EXISTS encrypted_embedding_key TEXT;
