-- Return freshness, Rule 47A facts, RCM catalogue (empty), duplicate-bill audit,
-- and acknowledgement history. No notification rows are seeded.

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS supply_received_on DATE,
  ADD COLUMN IF NOT EXISTS supplier_registration_status VARCHAR(20) NOT NULL DEFAULT 'unknown';

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS supply_received_on DATE,
  ADD COLUMN IF NOT EXISTS supplier_registration_status VARCHAR(20) NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS supplier_gstin VARCHAR(15);

ALTER TABLE purchases DROP CONSTRAINT IF EXISTS purchases_supplier_registration_status_check;
ALTER TABLE purchases
  ADD CONSTRAINT purchases_supplier_registration_status_check
  CHECK (supplier_registration_status IN ('registered', 'unregistered', 'unknown'));

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_supplier_registration_status_check;
ALTER TABLE expenses
  ADD CONSTRAINT expenses_supplier_registration_status_check
  CHECK (supplier_registration_status IN ('registered', 'unregistered', 'unknown'));

COMMENT ON COLUMN purchases.supplier_registration_status IS
  'Registration of the supplier on the supply date. A blank GSTIN is unknown, not unregistered.';
COMMENT ON COLUMN purchases.supply_received_on IS
  'Date the goods or services were received. Rule 47A uses this, not bill_date.';

CREATE TABLE IF NOT EXISTS gst_rcm_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  catalogue_version INTEGER NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE,
  supplier_type VARCHAR(20) NOT NULL CHECK (supplier_type IN ('registered', 'unregistered', 'either')),
  sac_prefix VARCHAR(10),
  hsn_prefix VARCHAR(10),
  expense_category VARCHAR(100),
  source_citation TEXT NOT NULL,
  review_only BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE gst_rcm_rules IS
  'Professionally supplied reverse-charge catalogue. Empty until version 1 is signed off.';

CREATE TABLE IF NOT EXISTS purchase_duplicate_overrides (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  existing_purchase_id UUID NOT NULL,
  reason TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gst_period_status (
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('gstr1', 'gstr3b', 'gstr2b', 'gstr9')),
  period_key VARCHAR(10) NOT NULL,
  state VARCHAR(20) NOT NULL CHECK (state IN ('not_checked', 'awaiting_gstr2b', 'stale', 'ready')),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reconciled_at TIMESTAMPTZ,
  PRIMARY KEY (business_id, kind, period_key)
);

CREATE TABLE IF NOT EXISTS reconciliation_decision_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reconciliation_id UUID NOT NULL,
  business_id UUID NOT NULL,
  decision VARCHAR(50) NOT NULL,
  decision_date TIMESTAMPTZ NOT NULL,
  decided_by_user_id UUID NOT NULL,
  remarks TEXT,
  eligible_itc_amount DECIMAL(15,2),
  deferred_to_period VARCHAR(7),
  superseded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gst_return_acknowledgements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind VARCHAR(10) NOT NULL,
  period_key VARCHAR(10) NOT NULL,
  snapshot_id TEXT NOT NULL,
  issue_key TEXT NOT NULL,
  facts JSONB NOT NULL DEFAULT '{}',
  amounts JSONB NOT NULL DEFAULT '{}',
  user_id UUID NOT NULL REFERENCES users(id),
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  invalidated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_gst_ack_open
  ON gst_return_acknowledgements (business_id, kind, period_key)
  WHERE invalidated_at IS NULL;
