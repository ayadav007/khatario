-- Premium themes: per-product card fields (badge text, craft/origin line, colour swatches).
ALTER TABLE items ADD COLUMN IF NOT EXISTS store_badge varchar(24);
ALTER TABLE items ADD COLUMN IF NOT EXISTS store_tagline varchar(60);
ALTER TABLE items ADD COLUMN IF NOT EXISTS store_swatches jsonb NOT NULL DEFAULT '[]'::jsonb;
