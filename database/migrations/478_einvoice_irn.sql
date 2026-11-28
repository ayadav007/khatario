-- e-invoice (IRN) support: the IRN and signed QR returned by the portal, the date e-invoicing
-- starts for each GSTIN, and a monthly limit. No data is changed except the limit rows.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS irn VARCHAR(64),
  ADD COLUMN IF NOT EXISTS irn_ack_no VARCHAR(20),
  ADD COLUMN IF NOT EXISTS irn_ack_date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS irn_signed_qr TEXT,
  ADD COLUMN IF NOT EXISTS irn_signed_invoice TEXT,
  ADD COLUMN IF NOT EXISTS irn_status VARCHAR(10) CHECK (irn_status IN ('active', 'cancelled')),
  ADD COLUMN IF NOT EXISTS irn_cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS irn_cancel_reason VARCHAR(120),
  ADD COLUMN IF NOT EXISTS irn_last_error TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_business_irn ON invoices (business_id, irn) WHERE irn IS NOT NULL;

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS einvoice_from DATE;
ALTER TABLE branches   ADD COLUMN IF NOT EXISTS einvoice_from DATE;

-- The monthly limit is unlimited (-1) for every plan: the e_invoice plan feature is what turns e-invoices on or off,
-- so a plan given the feature later works at once. Safe to run again: a row seeded 0 by an earlier version of this
-- migration is corrected to -1, and a positive limit set on purpose is kept.
INSERT INTO platform_limits (limit_key, category, label, description, unit, default_value, sort_order) VALUES
  ('max_einvoices_per_month', 'sales', 'e-Invoices per month', 'Maximum e-invoices (IRN) generated per month', 'per month', -1, 8)
ON CONFLICT (limit_key) DO UPDATE SET default_value = -1 WHERE platform_limits.default_value = 0;

INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value)
SELECT sp.id, 'max_einvoices_per_month', -1
  FROM subscription_plans sp
ON CONFLICT (plan_id, limit_key) DO UPDATE SET limit_value = -1 WHERE subscription_plan_limits.limit_value = 0;
