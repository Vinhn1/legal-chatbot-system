-- Challenge mới không chấp nhận OTP theo cơ chế cũ; không lưu mã xác thực nguyên văn.
CREATE TABLE IF NOT EXISTS auth_challenges (
  id uuid PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose varchar(30) NOT NULL CHECK (purpose IN ('login','password_reset','toggle_2fa','phone_change')),
  code_hash char(64) NOT NULL, target varchar(254) NOT NULL DEFAULT '', account_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(), expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0, consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_auth_challenge_account ON auth_challenges(user_id,purpose,created_at DESC);
CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key char(64) PRIMARY KEY, hits integer NOT NULL, expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_rate_expiry ON auth_rate_limits(expires_at);
UPDATE users SET otp_code=NULL, otp_created_at=NULL WHERE otp_code IS NOT NULL OR otp_created_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_legal_root_unit" ON legal_articles(document_id,unit_type,number) WHERE parent_id IS NULL;
