-- repair: QA Run 1 Phase 6 (advances, recurring invoices, fixed assets)
--   1. advance_payments gains the fields a Rule 50 receipt voucher needs (supply type, taxable value,
--      cess, voucher number, bank/cash ledger, branch) and running adjusted / refunded totals.
--      Goods advances carry no GST (Notification 66/2017-CT); service advances do.
--   2. advance_adjustments records each adjustment against an invoice / purchase, and each Rule 51
--      refund voucher, with the GST reversed, so GSTR-1 Table 11B can be built per period.
--   3. invoices.advance_adjusted / purchases.advance_adjusted are the amounts settled from advances;
--      balance recomputation subtracts them alongside receipts and TDS.
--   4. recurring_invoice_history is unique per (recurring_invoice_id, run_date) so a cron retry can
--      never raise a second invoice for the same period; recurring_invoices.auto_finalize chooses
--      draft vs final.
--   5. fixed_assets gains put_to_use_date, Income-tax block and rate (for the half-rate rule when used
--      under 180 days) and the Schedule II category; asset_disposals stores the gain / loss and voucher.
-- Safe to re-run: every step is IF NOT EXISTS or guarded.

ALTER TABLE advance_payments
  ADD COLUMN IF NOT EXISTS supply_type VARCHAR(10) NOT NULL DEFAULT 'goods',
  ADD COLUMN IF NOT EXISTS taxable_value NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS cess NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_account_id UUID REFERENCES accounts(id),
  ADD COLUMN IF NOT EXISTS voucher_id UUID,
  ADD COLUMN IF NOT EXISTS voucher_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS reference_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id),
  ADD COLUMN IF NOT EXISTS adjusted_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'open';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'advance_payments_supply_type_check') THEN
    ALTER TABLE advance_payments
      ADD CONSTRAINT advance_payments_supply_type_check CHECK (supply_type IN ('goods', 'services'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'advance_payments_status_check') THEN
    ALTER TABLE advance_payments
      ADD CONSTRAINT advance_payments_status_check
      CHECK (status IN ('open', 'partially_adjusted', 'adjusted', 'refunded', 'cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'advance_payments_consumed_check') THEN
    ALTER TABLE advance_payments
      ADD CONSTRAINT advance_payments_consumed_check
      CHECK (adjusted_amount >= 0 AND refunded_amount >= 0 AND adjusted_amount + refunded_amount <= amount + 0.01);
  END IF;
END $$;

UPDATE advance_payments
   SET taxable_value = amount - COALESCE(cgst, 0) - COALESCE(sgst, 0) - COALESCE(igst, 0)
 WHERE taxable_value IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_advance_payments_voucher_number
  ON advance_payments (business_id, voucher_number) WHERE voucher_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS advance_adjustments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  advance_id UUID NOT NULL REFERENCES advance_payments(id) ON DELETE CASCADE,
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('invoice', 'purchase', 'refund')),
  invoice_id UUID REFERENCES invoices(id),
  purchase_id UUID REFERENCES purchases(id),
  adjustment_date DATE NOT NULL,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  taxable_value NUMERIC(15,2) NOT NULL DEFAULT 0,
  cgst NUMERIC(15,2) NOT NULL DEFAULT 0,
  sgst NUMERIC(15,2) NOT NULL DEFAULT 0,
  igst NUMERIC(15,2) NOT NULL DEFAULT 0,
  cess NUMERIC(15,2) NOT NULL DEFAULT 0,
  voucher_id UUID,
  voucher_number VARCHAR(50),
  payment_account_id UUID REFERENCES accounts(id),
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT advance_adjustments_target_check CHECK (
    (kind = 'invoice' AND invoice_id IS NOT NULL AND purchase_id IS NULL)
    OR (kind = 'purchase' AND purchase_id IS NOT NULL AND invoice_id IS NULL)
    OR (kind = 'refund' AND invoice_id IS NULL AND purchase_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_advance_adjustments_business_date
  ON advance_adjustments (business_id, adjustment_date);
CREATE INDEX IF NOT EXISTS idx_advance_adjustments_advance ON advance_adjustments (advance_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_advance_adjustments_voucher_number
  ON advance_adjustments (business_id, voucher_number) WHERE voucher_number IS NOT NULL;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS advance_adjusted NUMERIC(15,2) NOT NULL DEFAULT 0;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS advance_adjusted NUMERIC(15,2) NOT NULL DEFAULT 0;

ALTER TABLE recurring_invoices
  ADD COLUMN IF NOT EXISTS auto_finalize BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id),
  ADD COLUMN IF NOT EXISTS last_error TEXT;

DELETE FROM recurring_invoice_history h
 USING recurring_invoice_history d
 WHERE h.recurring_invoice_id = d.recurring_invoice_id
   AND h.run_date = d.run_date
   AND h.status <> 'success'
   AND d.status = 'success'
   AND h.id <> d.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_recurring_invoice_history_period
  ON recurring_invoice_history (recurring_invoice_id, run_date);

ALTER TABLE fixed_assets
  ADD COLUMN IF NOT EXISTS put_to_use_date DATE,
  ADD COLUMN IF NOT EXISTS it_block VARCHAR(60),
  ADD COLUMN IF NOT EXISTS it_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS schedule_ii_category VARCHAR(80),
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id);

UPDATE fixed_assets SET put_to_use_date = purchase_date WHERE put_to_use_date IS NULL;

ALTER TABLE asset_disposals
  ADD COLUMN IF NOT EXISTS book_value NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS gain_loss NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS voucher_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_disposals_asset ON asset_disposals (asset_id);
