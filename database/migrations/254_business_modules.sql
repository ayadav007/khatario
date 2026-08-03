-- Migration 254: Composable platform modules per business (Billing, HR, Connect, CRM)

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS primary_module VARCHAR(32);

COMMENT ON COLUMN businesses.primary_module IS
  'Default app home / primary product module: billing | hr | connect | crm';

CREATE TABLE IF NOT EXISTS business_modules (
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  module_key VARCHAR(32) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  source VARCHAR(32) NOT NULL DEFAULT 'signup',
  enabled_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (business_id, module_key),
  CONSTRAINT business_modules_module_key_check
    CHECK (module_key IN ('billing', 'hr', 'connect', 'crm'))
);

CREATE INDEX IF NOT EXISTS idx_business_modules_business
  ON business_modules(business_id) WHERE enabled = true;

COMMENT ON TABLE business_modules IS
  'Enabled product modules on a business account; upsell adds rows (billing, hr, connect, crm).';

-- Backfill from product_line (253) or default billing for legacy tenants
INSERT INTO business_modules (business_id, module_key, enabled, source)
SELECT id,
  CASE
    WHEN product_line = 'hr' THEN 'hr'
    WHEN product_line = 'connect' THEN 'connect'
    ELSE 'billing'
  END,
  true,
  'backfill'
FROM businesses
ON CONFLICT (business_id, module_key) DO NOTHING;

UPDATE businesses b
SET primary_module = COALESCE(
  b.primary_module,
  CASE
    WHEN b.product_line = 'hr' THEN 'hr'
    WHEN b.product_line = 'connect' THEN 'connect'
    ELSE 'billing'
  END
)
WHERE b.primary_module IS NULL;
