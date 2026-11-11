-- Store theme engine M6: new stores start on the new store design. Existing stores are switched by
-- `scripts/migrate-store-themes.mjs --switch-on` (or the Store editor's switch button), not here.
ALTER TABLE business_settings ALTER COLUMN store_engine SET DEFAULT true;
