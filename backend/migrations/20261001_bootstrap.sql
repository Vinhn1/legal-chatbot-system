-- Khởi tạo schema rỗng; không sửa hoặc xóa dữ liệu trong bảng đã tồn tại.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
DO $$ BEGIN CREATE TYPE legal_documents_document_type_enum AS ENUM ('law','resolution','decree','circular'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE legal_documents_effective_status_enum AS ENUM ('active','expired','partially_expired','unknown'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE legal_documents_scope_enum AS ENUM ('public','internal'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE legal_articles_unit_type_enum AS ENUM ('part','chapter','section','subsection','general','article','clause','point'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY, username varchar NOT NULL UNIQUE, password varchar NOT NULL,
  token_version integer NOT NULL DEFAULT 0, role varchar NOT NULL DEFAULT 'staff',
  name varchar, phone varchar, email varchar, dob varchar, address varchar, avatar text,
  two_fa_enabled boolean NOT NULL DEFAULT false, otp_code varchar, otp_created_at timestamptz,
  created_at timestamp NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS chat_history (
  id serial PRIMARY KEY, session_id varchar NOT NULL, role varchar NOT NULL,
  message text NOT NULL, created_at timestamp NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS legal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_number varchar(100) NOT NULL,
  document_type legal_documents_document_type_enum NOT NULL, title text NOT NULL,
  issuing_authority varchar(255) NOT NULL, issued_date date NOT NULL, effective_date date,
  expiry_date date, effective_status legal_documents_effective_status_enum NOT NULL DEFAULT 'unknown',
  status_since_date date, source_url text, content_hash char(64) NOT NULL UNIQUE,
  scope legal_documents_scope_enum NOT NULL DEFAULT 'internal', version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT NOW(), updated_at timestamptz NOT NULL DEFAULT NOW(),
  CONSTRAINT "CHK_legal_documents_dates" CHECK (expiry_date IS NULL OR effective_date IS NULL OR expiry_date >= effective_date)
);
CREATE INDEX IF NOT EXISTS idx_legal_document_number ON legal_documents(document_number);
CREATE TABLE IF NOT EXISTS legal_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), document_id uuid NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES legal_articles(id) ON DELETE CASCADE, unit_type legal_articles_unit_type_enum NOT NULL,
  number varchar(30) NOT NULL, title text, original_text text, sort_order integer NOT NULL,
  UNIQUE(document_id,parent_id,unit_type,number)
);
CREATE INDEX IF NOT EXISTS idx_legal_article_document ON legal_articles(document_id);
