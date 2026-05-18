-- Replaces the index if an older 205 had a different WHERE predicate, so it matches
-- INSERT ... ON CONFLICT (user_id, reference_id) WHERE (type = 'todo_reminder') DO NOTHING
-- (single transaction; non-concurrent build — brief lock, OK for small notification volume).
DROP INDEX IF EXISTS uq_notifications_todo_reminder_user_ref;
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_todo_reminder_user_ref
  ON notifications (user_id, reference_id)
  WHERE (type = 'todo_reminder');

COMMENT ON INDEX uq_notifications_todo_reminder_user_ref IS
  'Prevents duplicate todo_reminder in-app rows per user per todo.';
