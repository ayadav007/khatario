-- Per-store switch for premium theme presets (Heritage Couture): off hides them in Add theme and refuses creating them.
ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS store_premium_themes BOOLEAN NOT NULL DEFAULT false;
