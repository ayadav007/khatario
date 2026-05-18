-- Persist goods vs service intent per purchase line (for auto-creating catalogue items on finalize).

ALTER TABLE purchase_items
  ADD COLUMN IF NOT EXISTS line_item_type VARCHAR(20) DEFAULT 'goods'
  CHECK (line_item_type IS NULL OR line_item_type IN ('goods', 'service'));

COMMENT ON COLUMN purchase_items.line_item_type IS
  'goods vs service from purchase UI. Used with auto-create missing catalogue rows on final purchase.';
