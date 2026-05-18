-- =====================================================================
-- Migration 167 — Phase-4: Periodic inventory + business-wide valuation
-- =====================================================================
--
-- Locks in the Phase-4 design decisions confirmed during the P&L audit:
--
--   1. Inventory model = PERIODIC (Tally default).
--      No COGS posted per invoice. COGS is computed at period end as:
--          COGS = Opening Stock + Net Purchases (ledger 5101 net)
--                 − Closing Stock − Purchase Returns (netted into Purchases)
--
--   2. Closing/Opening stock is DATE-AWARE via stock_movements (no new
--      table required — `stock_movements` already exists and is populated
--      by invoices/purchases/returns/transfers).
--
--   3. Stock valuation method is BUSINESS-WIDE (Tally style).
--      cogs-calculator will read business_settings.stock_valuation_method
--      and IGNORE per-item items.valuation_method going forward.
--      LIFO is BLOCKED (prohibited under Ind AS 2).
--
--   4. Year-end close will write closing_stock_snapshots and post the JV
--      (Dr 1104 Inventory closing, Cr Trading Account / 5101 adjustment).
--      That endpoint is built separately; this migration only prepares
--      the schema + accounts.
--
-- This migration is idempotent and safe to run multiple times.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. business_settings.stock_valuation_method
--    Default 'fifo' (Indian SMB standard, Ind AS 2 compliant).
--    Allowed: fifo | weighted_avg | simple. LIFO is BLOCKED at the
--    constraint level — books must not be set up with LIFO.
-- ---------------------------------------------------------------------
ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS stock_valuation_method VARCHAR(20) DEFAULT 'fifo';

-- Drop any stale check from a prior run, then add the strict one.
ALTER TABLE business_settings
  DROP CONSTRAINT IF EXISTS business_settings_stock_valuation_method_check;

ALTER TABLE business_settings
  ADD CONSTRAINT business_settings_stock_valuation_method_check
  CHECK (stock_valuation_method IN ('fifo', 'weighted_avg', 'simple'));

COMMENT ON COLUMN business_settings.stock_valuation_method IS
  'Phase-4: business-wide stock valuation method used by COGS calculator. '
  'Allowed: fifo (default, Ind AS 2 compliant) | weighted_avg | simple. '
  'LIFO is intentionally NOT allowed (prohibited under Ind AS 2). '
  'This OVERRIDES the per-item items.valuation_method column going forward.';

-- Backfill any existing rows that were created before the column existed.
UPDATE business_settings
   SET stock_valuation_method = 'fifo'
 WHERE stock_valuation_method IS NULL;

-- ---------------------------------------------------------------------
-- 2. business_settings.inventory_model
--    Hard-coded to 'periodic' for now (decision locked). Stored as a
--    column so future businesses can be migrated to perpetual without
--    a code change.
-- ---------------------------------------------------------------------
ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS inventory_model VARCHAR(20) DEFAULT 'periodic';

ALTER TABLE business_settings
  DROP CONSTRAINT IF EXISTS business_settings_inventory_model_check;

ALTER TABLE business_settings
  ADD CONSTRAINT business_settings_inventory_model_check
  CHECK (inventory_model IN ('periodic', 'perpetual'));

COMMENT ON COLUMN business_settings.inventory_model IS
  'Phase-4: inventory accounting model. periodic (Tally default, current) '
  'computes COGS at period end via Opening + Purchases − Closing − Returns. '
  'perpetual posts COGS per sale; not used yet.';

UPDATE business_settings
   SET inventory_model = 'periodic'
 WHERE inventory_model IS NULL;

-- ---------------------------------------------------------------------
-- 3. Track the last completed FY close (for year-end snapshot endpoint
--    to refuse a double close).
-- ---------------------------------------------------------------------
ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS last_closed_financial_year VARCHAR(9);

COMMENT ON COLUMN business_settings.last_closed_financial_year IS
  'Phase-4: last FY for which Year-End Close ran (e.g., "2024-2025"). '
  'Used to refuse a duplicate close.';

-- ---------------------------------------------------------------------
-- 4. Sanity-check that the Periodic-model accounts are present in CoA.
--    Migration 063 already seeds these for new businesses, but if any
--    legacy business is missing them, surface that loudly.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  v_business_id UUID;
  v_missing_count INT := 0;
BEGIN
  FOR v_business_id IN
    SELECT b.id
      FROM businesses b
     WHERE EXISTS (
       SELECT 1 FROM accounts a
        WHERE a.business_id = b.id
          AND a.account_code IN ('5101','5102','5104','1104')
     )
  LOOP
    -- Count which of the four core periodic accounts are missing for this business.
    PERFORM 1
       FROM (VALUES ('5101'),('5102'),('5104'),('1104')) AS need(code)
      WHERE NOT EXISTS (
        SELECT 1 FROM accounts a
         WHERE a.business_id = v_business_id
           AND a.account_code = need.code
      );
    GET DIAGNOSTICS v_missing_count = ROW_COUNT;

    IF v_missing_count > 0 THEN
      RAISE WARNING
        'Phase-4 readiness: business % is missing % of the 4 periodic-inventory '
        'accounts (5101 Purchases / 5102 Purchase Returns / 5104 COGS / 1104 Inventory). '
        'Run migration 063 (chart_of_accounts_seed) for this business before using Phase-4 P&L.',
        v_business_id, v_missing_count;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 5. Helper view: Phase-4 readiness per business.
--    Quick way to inspect "is this business ready for Periodic+date-aware
--    COGS?" — usable from the validation page or psql.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_phase4_inventory_readiness AS
SELECT
  b.id                                          AS business_id,
  b.name                                         AS business_name,
  bs.inventory_model,
  bs.stock_valuation_method,
  bs.last_closed_financial_year,
  EXISTS (SELECT 1 FROM accounts a WHERE a.business_id = b.id AND a.account_code = '5101') AS has_5101_purchases,
  EXISTS (SELECT 1 FROM accounts a WHERE a.business_id = b.id AND a.account_code = '5102') AS has_5102_purchase_returns,
  EXISTS (SELECT 1 FROM accounts a WHERE a.business_id = b.id AND a.account_code = '5104') AS has_5104_cogs,
  EXISTS (SELECT 1 FROM accounts a WHERE a.business_id = b.id AND a.account_code = '1104') AS has_1104_inventory,
  -- Count of historical perpetual COGS lines from invoices that will need
  -- to be drained by the one-shot migration JV.
  COALESCE((
    SELECT COUNT(*)
      FROM ledger_entry_lines lel
      JOIN accounts a ON a.id = lel.account_id
     WHERE a.business_id = b.id
       AND a.account_code IN ('5104','1104')
       AND lel.voucher_type IN ('invoice','credit_note')
  ), 0)                                          AS perpetual_residual_lines,
  -- Sum of net debit on 5104 from invoices (positive = inflated COGS in books)
  COALESCE((
    SELECT SUM(lel.debit - lel.credit)
      FROM ledger_entry_lines lel
      JOIN accounts a ON a.id = lel.account_id
     WHERE a.business_id = b.id
       AND a.account_code = '5104'
       AND lel.voucher_type IN ('invoice','credit_note')
  ), 0)                                          AS perpetual_5104_net_debit,
  COALESCE((
    SELECT COUNT(*)
      FROM closing_stock_snapshots css
     WHERE css.business_id = b.id
  ), 0)                                          AS closing_stock_snapshot_rows
FROM businesses b
LEFT JOIN business_settings bs ON bs.business_id = b.id;

COMMENT ON VIEW v_phase4_inventory_readiness IS
  'Phase-4: per-business readiness for Periodic-inventory + date-aware COGS. '
  'perpetual_residual_lines / perpetual_5104_net_debit show how much historical '
  'cleanup the Phase-4 drain JV will need to do.';

COMMIT;
