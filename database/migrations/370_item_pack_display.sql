-- Optional display pack. Stock quantity stays in items.unit.
-- pack_size 10 and pack_unit CTN shows 47 PCS as "4 CTN + 7 PCS".
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS pack_size INTEGER,
  ADD COLUMN IF NOT EXISTS pack_unit VARCHAR(20);

ALTER TABLE items DROP CONSTRAINT IF EXISTS items_pack_size_range;
ALTER TABLE items
  ADD CONSTRAINT items_pack_size_range
  CHECK (pack_size IS NULL OR (pack_size >= 2 AND pack_size <= 100000));
