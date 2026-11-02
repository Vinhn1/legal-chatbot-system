-- Dữ liệu cũ giữ NULL: không suy đoán trạng thái dựa trên nội dung câu trả lời.
ALTER TABLE chat_history ADD COLUMN IF NOT EXISTS result_meta jsonb;
CREATE INDEX IF NOT EXISTS idx_chat_history_session_id ON chat_history(session_id,id DESC);
CREATE INDEX IF NOT EXISTS idx_chat_history_created_id ON chat_history(created_at,id DESC);
CREATE TABLE IF NOT EXISTS conversation_reviews (
  session_id varchar PRIMARY KEY, status varchar NOT NULL CHECK(status IN ('reviewed','need_review')),
  reviewer_id integer REFERENCES users(id) ON DELETE SET NULL, reviewed_at timestamptz NOT NULL DEFAULT NOW()
);
