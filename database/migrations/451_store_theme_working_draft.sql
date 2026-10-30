-- Store theme engine M2: the merchant's working draft. At most one draft per business is the one the Studio edits.
ALTER TABLE store_themes ADD COLUMN IF NOT EXISTS is_working boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS store_themes_one_working ON store_themes (business_id) WHERE is_working;
