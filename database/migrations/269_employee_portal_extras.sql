-- Migration 269: Employee portal extras (celebrations, announcements)

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS date_of_birth DATE;

COMMENT ON COLUMN employees.date_of_birth IS 'Used for birthday celebrations on employee portal home';

CREATE TABLE IF NOT EXISTS hr_announcements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  body TEXT,
  author_name VARCHAR(255),
  published_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hr_announcements_business
  ON hr_announcements(business_id, published_at DESC)
  WHERE is_active = true;

COMMENT ON TABLE hr_announcements IS 'Company announcements shown on employee portal home';
