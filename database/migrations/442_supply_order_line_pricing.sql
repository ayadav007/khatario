-- Migration 442: Supplier Hub order lines priced like the supplier's own bills
-- Description: A hub order line now gets its price from the same rules the supplier's bills use
--   for the linked customer (customer price, price level with quantity slabs, customer discount %,
--   category discount, size/colour prices). The line keeps the discount next to the price, and
--   the supplier's size/colour so the bill can use that variant's price and stock.
--   discount_percent NULL means the line was priced before this migration: the bill then takes
--   the discount from the customer's current rules.
-- Created: 2026-10-29

ALTER TABLE supply_order_lines
  ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS vendor_variant_id UUID REFERENCES item_variants(id) ON DELETE SET NULL;

COMMENT ON COLUMN supply_order_lines.discount_percent IS
  'Discount % on unit_price from the supplier''s price rules for the linked customer; NULL on lines priced before migration 442.';
COMMENT ON COLUMN supply_order_lines.vendor_variant_id IS
  'The supplier''s size/colour for this line, matched by name from the listing option or the buyer''s variant.';
