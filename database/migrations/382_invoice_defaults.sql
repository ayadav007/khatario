-- 382: Business defaults for new bills and items (Settings › Invoices & documents › Invoice defaults,
-- and Items & stock › Low-stock alert). Stored as one JSON object; read through
-- lib/settings/invoice-defaults.ts, which fills in missing keys.
ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS invoice_defaults JSONB NOT NULL DEFAULT '{}'::jsonb;
