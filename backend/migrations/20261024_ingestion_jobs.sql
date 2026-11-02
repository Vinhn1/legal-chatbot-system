-- Lưu kết quả trung gian để phục hồi sau khi ChromaDB đã ghi nhưng PostgreSQL chưa đồng bộ.
CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), operation varchar NOT NULL DEFAULT 'ingest',
  status varchar NOT NULL CHECK(status IN ('pending','indexed','metadata_synced','failed')),
  content_hash char(64), document_id uuid, payload jsonb, error_code varchar,
  created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ingestion_job_status ON ingestion_jobs(status,updated_at);
