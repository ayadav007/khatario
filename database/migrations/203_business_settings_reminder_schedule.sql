-- When automatic WhatsApp payment reminders are evaluated (local clock + IANA zone).
-- The cron should run at least every 15 minutes; see vercel.json.

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS reminder_send_time TIME DEFAULT TIME '09:00:00';

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS reminder_send_timezone VARCHAR(100) DEFAULT 'Asia/Kolkata';

COMMENT ON COLUMN business_settings.reminder_send_time IS 'Local time of day to send auto payment reminders (payment_due + overdue) for this business';
COMMENT ON COLUMN business_settings.reminder_send_timezone IS 'IANA time zone for reminder_send_time (e.g. Asia/Kolkata)';
