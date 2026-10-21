-- Sales-invoice charge contract for drafts, conversions, recurrence and parcels.
-- Already-posted invoices are not rewritten. charge_line stays false on existing rows.
-- A historical additional_charges amount is not classified or taxed by this migration.

ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS charge_line BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE recurring_invoices
  ADD COLUMN IF NOT EXISTS charges JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS charge_classification TEXT,
  ADD COLUMN IF NOT EXISTS charge_hsn_sac VARCHAR(10),
  ADD COLUMN IF NOT EXISTS charge_tax_rate NUMERIC(5,2);

ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS charge_classification TEXT,
  ADD COLUMN IF NOT EXISTS charge_hsn_sac VARCHAR(10),
  ADD COLUMN IF NOT EXISTS charge_tax_rate NUMERIC(5,2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_orders_charge_classification_check'
  ) THEN
    ALTER TABLE sales_orders
      ADD CONSTRAINT sales_orders_charge_classification_check
      CHECK (charge_classification IS NULL OR charge_classification IN ('follows_goods', 'separate_supply'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'estimates_charge_classification_check'
  ) THEN
    ALTER TABLE estimates
      ADD CONSTRAINT estimates_charge_classification_check
      CHECK (charge_classification IS NULL OR charge_classification IN ('follows_goods', 'separate_supply'));
  END IF;
END $$;

COMMENT ON COLUMN invoice_items.charge_line IS
  'True for a separate-supply charge row. It is not stock, not a parcel line, and not a physical quantity.';
COMMENT ON COLUMN recurring_invoices.charges IS
  'Classified charges passed to the sales-invoice calculator on each run. Empty means no charge.';
