-- Speeds up per-business due-reminder sweeps (check-reminders, cron) at scale.
CREATE INDEX IF NOT EXISTS idx_todos_reminder_due_business
  ON todos (business_id, reminder_time)
  WHERE reminder_sent = false;

COMMENT ON INDEX idx_todos_reminder_due_business IS
  'Supports WHERE business_id = ? AND reminder_sent = false AND reminder_time <= NOW() (plus app filters).';
