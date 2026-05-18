-- Reminders: attach invoice PDF by default (opt-out via include_pdf = false in settings).

ALTER TABLE whatsapp_reminder_settings
  ALTER COLUMN include_pdf SET DEFAULT true;

UPDATE whatsapp_reminder_settings
SET include_pdf = true
WHERE include_pdf = false;

COMMENT ON COLUMN whatsapp_reminder_settings.include_pdf IS 'When true, payment reminders send the invoice PDF; default is on (set false to text-only).';
