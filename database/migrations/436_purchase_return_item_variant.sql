-- 436: Purchase returns remember the size or colour (item variant) of each line.
-- A purchase line bought into a variant adds stock to branch_item_variant_stock, not to the
-- item's own branch_item_stock. Without the variant on the return line, a return took the goods
-- out of the item's own stock and left the variant's stock unchanged.
-- Returns recorded before this keep variant_id NULL; cancelling them follows their stock movements.

ALTER TABLE purchase_return_items
  ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES item_variants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_return_items_variant_id
  ON purchase_return_items (variant_id) WHERE variant_id IS NOT NULL;

COMMENT ON COLUMN purchase_return_items.variant_id IS
  'Size or colour returned; stock leaves branch_item_variant_stock for it (warehouse mode: location_stock at item level)';
