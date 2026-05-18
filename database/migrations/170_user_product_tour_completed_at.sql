-- Per-user product tour completion (Zoho-style onboarding); null = never finished or skipped
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS product_tour_completed_at TIMESTAMPTZ;

COMMENT ON COLUMN users.product_tour_completed_at IS 'When the user completed or dismissed the sidebar product tour';
