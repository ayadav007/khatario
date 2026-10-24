-- Studio becomes the default storefront theme. Classic, Chowk, Atelier, Noir and Aether are retired;
-- stores on them move to Studio. Unpublished Studio work is auto-saved to store_studio_draft.

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS store_studio_draft JSONB,
  ADD COLUMN IF NOT EXISTS store_studio_draft_at TIMESTAMPTZ;

UPDATE business_settings
SET store_theme = store_theme
  || jsonb_build_object('pack', 'studio', 'preset', 'custom')
  -- Named presets forced their own brand colour, so keep the colour shoppers actually saw.
  || CASE store_theme->>'preset'
       WHEN 'green' THEN jsonb_build_object('accent', '#16a34a')
       WHEN 'saffron' THEN jsonb_build_object('accent', '#ea580c')
       WHEN 'blue' THEN jsonb_build_object('accent', '#2563eb')
       WHEN 'chowk' THEN jsonb_build_object('accent', '#e07030')
       WHEN 'atelier' THEN jsonb_build_object('accent', '#171412')
       WHEN 'noir' THEN jsonb_build_object('accent', '#d4af37')
       WHEN 'aether' THEN jsonb_build_object('accent', '#c4a46a')
       ELSE '{}'::jsonb
     END
  -- Noir and Aether defaulted to dark pages when no mode was stored.
  || CASE
       WHEN store_theme->>'pack' IN ('noir', 'aether') AND NOT (store_theme ? 'appearance_mode')
         THEN jsonb_build_object('appearance_mode', 'dark')
       ELSE '{}'::jsonb
     END
WHERE store_theme IS NOT NULL
  AND jsonb_typeof(store_theme) = 'object'
  AND COALESCE(store_theme->>'preset', '') NOT IN ('khatario', 'grocery', 'studio')
  AND COALESCE(store_theme->>'pack', 'classic') NOT IN ('khatario', 'grocery', 'studio');

COMMENT ON COLUMN business_settings.store_studio_draft IS 'Unpublished Studio editor state {theme, sections, pages}; cleared on publish';
COMMENT ON COLUMN business_settings.store_studio_draft_at IS 'When the Studio draft was last auto-saved';
