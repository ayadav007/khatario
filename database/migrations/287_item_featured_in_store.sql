-- Homepage featured items (max 6 per business), toggled on the item.

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS featured_in_store BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_items_featured_in_store
  ON items (business_id)
  WHERE featured_in_store = true AND deleted_at IS NULL;

-- Carry over the old single featured_item_id from store_theme when still valid.
UPDATE items i
SET featured_in_store = true
FROM business_settings bs
WHERE bs.business_id = i.business_id
  AND i.deleted_at IS NULL
  AND i.show_in_store = true
  AND NULLIF(BTRIM(COALESCE(bs.store_theme->>'featured_item_id', '')), '') IS NOT NULL
  AND i.id::text = BTRIM(bs.store_theme->>'featured_item_id');
