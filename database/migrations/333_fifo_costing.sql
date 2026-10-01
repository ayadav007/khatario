-- FIFO perpetual costing (lib/inventory/fifo-*.ts). Businesses on stock_valuation_method = 'fifo'
-- now cost each sale from its own cost lots instead of a blended average, and backdated stock
-- documents re-cost later vouchers with correction lines in the original voucher.
--
-- fifo_recost_from is the cut-over: automatic recosting never touches vouchers dated earlier.
-- Existing businesses get the date this migration runs, so books already posted at weighted
-- average are not restated without a deliberate recost (POST /api/inventory/fifo-recost).
-- New businesses keep NULL (no limit). No ledger lines are written by this migration.

-- Backfill only when the column is first added, so a re-run never stamps businesses created later.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'business_settings' AND column_name = 'fifo_recost_from'
  ) THEN
    ALTER TABLE business_settings ADD COLUMN fifo_recost_from DATE;
    UPDATE business_settings SET fifo_recost_from = CURRENT_DATE;
  END IF;
END $$;

COMMENT ON COLUMN business_settings.fifo_recost_from IS
  'FIFO cut-over: automatic recosting leaves vouchers dated before this alone. NULL = no limit.';

CREATE INDEX IF NOT EXISTS idx_invoice_items_item_id ON invoice_items(item_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_item_id ON purchase_items(item_id);
CREATE INDEX IF NOT EXISTS idx_credit_note_items_item_id ON credit_note_items(item_id);
CREATE INDEX IF NOT EXISTS idx_purchase_return_items_item_id ON purchase_return_items(item_id);
CREATE INDEX IF NOT EXISTS idx_bundle_items_item_id ON bundle_items(item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_business_item ON inventory_adjustments(business_id, item_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_inter_branch_invoice ON stock_transfers(inter_branch_invoice_id)
  WHERE inter_branch_invoice_id IS NOT NULL;
