-- Bổ sung loại đơn vị của tài liệu chuyên đề mà không xóa dữ liệu hiện có.
ALTER TYPE legal_articles_unit_type_enum ADD VALUE IF NOT EXISTS 'part';
ALTER TYPE legal_articles_unit_type_enum ADD VALUE IF NOT EXISTS 'subsection';
ALTER TYPE legal_articles_unit_type_enum ADD VALUE IF NOT EXISTS 'general';
