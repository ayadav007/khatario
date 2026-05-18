-- Per-business default + per-item override for selling when stock is insufficient.

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS default_allow_sale_when_out_of_stock BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN business_settings.default_allow_sale_when_out_of_stock IS
  'Default for new items: when true, invoices may sell goods with insufficient branch/warehouse qty unless the item overrides.';

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS allow_sale_when_out_of_stock BOOLEAN NULL;

COMMENT ON COLUMN items.allow_sale_when_out_of_stock IS
  'NULL = use business_settings.default_allow_sale_when_out_of_stock; false = block oversell; true = allow.';
