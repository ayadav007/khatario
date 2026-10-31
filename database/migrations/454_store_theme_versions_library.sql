-- Store theme engine M5 (D44): published versions keep the theme's name and preset at publish time, and outlive
-- their theme (theme_id becomes NULL on delete instead of cascading), so history and restore survive a deleted draft.
-- Idempotent: safe to run more than once.
ALTER TABLE store_theme_versions ADD COLUMN IF NOT EXISTS preset VARCHAR(16) NULL;
ALTER TABLE store_theme_versions ADD COLUMN IF NOT EXISTS theme_name VARCHAR(60) NULL;
ALTER TABLE store_theme_versions ALTER COLUMN theme_id DROP NOT NULL;
DO $$
DECLARE fk text;
BEGIN
  SELECT conname INTO fk FROM pg_constraint
   WHERE conrelid = 'store_theme_versions'::regclass AND contype = 'f'
     AND confrelid = 'store_themes'::regclass AND confdeltype <> 'n';
  IF fk IS NOT NULL THEN
    EXECUTE format('ALTER TABLE store_theme_versions DROP CONSTRAINT %I', fk);
    ALTER TABLE store_theme_versions ADD CONSTRAINT store_theme_versions_theme_fk
      FOREIGN KEY (theme_id) REFERENCES store_themes(id) ON DELETE SET NULL;
  END IF;
END $$;
UPDATE store_theme_versions v SET preset = t.preset, theme_name = t.name
  FROM store_themes t WHERE v.theme_id = t.id AND v.preset IS NULL;
