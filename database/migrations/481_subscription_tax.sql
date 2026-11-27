-- 481: optional GST on Khatario's own subscription charges, numbered tax invoices and credit notes (SUB-13).
-- Follows 480 (refund indexes). Additive and idempotent; never modifies or deletes an existing payment row.
-- MUST run before the code that reads these columns is deployed: scripts/deploy-vps.sh does that through
-- db:migrate:pending, before the build and the reload.
--   Numbers are issued only for payments (and their refunds) that carry GST. In mode 'none' nothing is
--   numbered, the counter table is never touched, and invoice_number stays NULL.

SET LOCAL lock_timeout = '5s';

-- ===================================================================================================
-- GST on subscription charges (SUB-13). Off by default: with the defaults below nothing a customer is
-- charged changes. Amounts stay in the existing columns: amount = list price, total_amount = what is
-- charged, tax_amount = the GST part of total_amount. The new columns hold the breakdown.
--   subscription_gst_mode   none      no tax line (a receipt, not a tax invoice)
--                           inclusive listed prices already include GST; the charge is unchanged
--                           exclusive GST is added on top of the price after coupon and credit
-- ===================================================================================================

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS subscription_gst_mode TEXT NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS subscription_gst_rate NUMERIC(5,2) NOT NULL DEFAULT 18,
  ADD COLUMN IF NOT EXISTS subscription_seller_gstin TEXT,
  ADD COLUMN IF NOT EXISTS subscription_seller_legal_name TEXT,
  ADD COLUMN IF NOT EXISTS subscription_seller_address TEXT,
  ADD COLUMN IF NOT EXISTS subscription_seller_state_code VARCHAR(2),
  ADD COLUMN IF NOT EXISTS subscription_sac_code TEXT NOT NULL DEFAULT '998314',
  ADD COLUMN IF NOT EXISTS subscription_invoice_prefix TEXT NOT NULL DEFAULT 'KH',
  ADD COLUMN IF NOT EXISTS subscription_tax_updated_by TEXT,
  ADD COLUMN IF NOT EXISTS subscription_tax_updated_at TIMESTAMPTZ;

ALTER TABLE platform_settings DROP CONSTRAINT IF EXISTS platform_settings_gst_mode_chk;
ALTER TABLE platform_settings ADD CONSTRAINT platform_settings_gst_mode_chk
  CHECK (subscription_gst_mode IN ('none', 'inclusive', 'exclusive'));

ALTER TABLE platform_settings DROP CONSTRAINT IF EXISTS platform_settings_gst_rate_chk;
ALTER TABLE platform_settings ADD CONSTRAINT platform_settings_gst_rate_chk
  CHECK (subscription_gst_rate >= 0 AND subscription_gst_rate <= 28);

ALTER TABLE platform_settings DROP CONSTRAINT IF EXISTS platform_settings_invoice_prefix_chk;
ALTER TABLE platform_settings ADD CONSTRAINT platform_settings_invoice_prefix_chk
  CHECK (subscription_invoice_prefix ~ '^[A-Z0-9]{1,10}$');

-- Tax can only be switched on once the seller (GSTIN, legal name, state) is known (the admin route checks this too and says so in words).
ALTER TABLE platform_settings DROP CONSTRAINT IF EXISTS platform_settings_gst_seller_chk;
ALTER TABLE platform_settings ADD CONSTRAINT platform_settings_gst_seller_chk
  CHECK (subscription_gst_mode = 'none'
         OR (COALESCE(btrim(subscription_seller_gstin), '') <> '' AND COALESCE(btrim(subscription_seller_legal_name), '') <> ''
             AND COALESCE(btrim(subscription_seller_state_code), '') <> ''));

COMMENT ON COLUMN platform_settings.subscription_gst_mode IS 'GST on Khatario subscription charges: none (default) | inclusive | exclusive';

-- The breakdown of each payment (and each refund: its own share). NULL on rows from before this change:
-- they are treated as tax-free (taxable = total_amount).
ALTER TABLE billing_transactions
  ADD COLUMN IF NOT EXISTS taxable_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS cgst_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS sgst_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS igst_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS gst_mode VARCHAR(12);

-- The archive (migration 479) keeps the same columns, so a deleted business's tax records survive too.
DO $$
BEGIN
  IF to_regclass('billing_transactions_archive') IS NULL THEN
    RAISE NOTICE '481: billing_transactions_archive does not exist (run migration 479 first); tax columns not added to it';
  ELSE
    ALTER TABLE billing_transactions_archive
      ADD COLUMN IF NOT EXISTS taxable_amount NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS cgst_amount NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS sgst_amount NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS igst_amount NUMERIC(12,2),
      ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(5,2),
      ADD COLUMN IF NOT EXISTS gst_mode VARCHAR(12);
  END IF;
END $$;

-- Gap-free numbers: one counter row per series and Indian financial year (April-March, by the date in IST).
-- Series: 'invoice' (payments that carry GST) and 'credit_note' (refunds). The completing
-- transaction locks the row (INSERT ... ON CONFLICT DO UPDATE ... RETURNING), so concurrent completions
-- queue up, and a rolled-back completion gives its number back.
CREATE TABLE IF NOT EXISTS subscription_invoice_counters (
  series         TEXT NOT NULL DEFAULT 'invoice',
  financial_year TEXT NOT NULL,
  last_number    INT  NOT NULL,
  PRIMARY KEY (series, financial_year)
);

-- An invoice number is on one row only.
DO $$
DECLARE
  dups integer;
BEGIN
  LOCK TABLE billing_transactions IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'uq_billing_tx_invoice_number') THEN
    RAISE NOTICE '481: uq_billing_tx_invoice_number already exists';
  ELSE
    SELECT COUNT(*) INTO dups FROM (
      SELECT invoice_number FROM billing_transactions
      WHERE invoice_number IS NOT NULL
      GROUP BY invoice_number HAVING COUNT(*) > 1
    ) d;
    IF dups > 0 THEN
      RAISE NOTICE '481: skipped uq_billing_tx_invoice_number: % duplicate invoice number(s) exist', dups;
    ELSE
      CREATE UNIQUE INDEX uq_billing_tx_invoice_number
        ON billing_transactions (invoice_number) WHERE invoice_number IS NOT NULL;
    END IF;
  END IF;
END $$;
