-- Migration 438: Sell in an item's alternate units (a box of 12, a bag of 50 kg)
-- Description: A sales line keeps the quantity and unit the customer bought ("5 BOX") and how many
--   base units one of them held when it was sold (unit_factor = 12). Stock always moves by
--   quantity × unit_factor. The factor is a snapshot: editing the item's units later does not
--   change old documents. Existing rows get 1, so they read exactly as before.
--   A constant default is a metadata-only change, so large line tables are not rewritten.
-- Plan: docs/plan/SELL_IN_ALTERNATE_UNITS.md
-- Created: 2026-10-28

ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS unit_factor NUMERIC(15, 4) NOT NULL DEFAULT 1 CHECK (unit_factor > 0);
ALTER TABLE credit_note_items
  ADD COLUMN IF NOT EXISTS unit_factor NUMERIC(15, 4) NOT NULL DEFAULT 1 CHECK (unit_factor > 0);
ALTER TABLE sales_order_items
  ADD COLUMN IF NOT EXISTS unit_factor NUMERIC(15, 4) NOT NULL DEFAULT 1 CHECK (unit_factor > 0);
ALTER TABLE delivery_challan_items
  ADD COLUMN IF NOT EXISTS unit_factor NUMERIC(15, 4) NOT NULL DEFAULT 1 CHECK (unit_factor > 0);
ALTER TABLE order_return_items
  ADD COLUMN IF NOT EXISTS unit_factor NUMERIC(15, 4) NOT NULL DEFAULT 1 CHECK (unit_factor > 0);

-- A unit can have its own selling price (a box sold cheaper than 12 pieces). Empty means the
-- item's price × factor. Same GST basis as items.selling_price.
ALTER TABLE item_units
  ADD COLUMN IF NOT EXISTS selling_price NUMERIC(12, 2) CHECK (selling_price IS NULL OR selling_price >= 0);

COMMENT ON COLUMN invoice_items.unit_factor IS
  'Base units in one sold unit when the line was saved. Stock moves quantity × unit_factor.';
COMMENT ON COLUMN credit_note_items.unit_factor IS
  'Base units in one credited unit. Stock comes back qty × unit_factor.';
