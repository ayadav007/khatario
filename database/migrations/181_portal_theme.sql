-- Per-business portal appearance (primary color, font preset) for the web app shell.
ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS portal_theme JSONB DEFAULT NULL;

COMMENT ON COLUMN business_settings.portal_theme IS
  'Optional UI theme: { "primary_hex": "#0d9488", "font_preset": "inter"|"system"|"dm_sans"|"source_sans" }. NULL = product defaults.';
