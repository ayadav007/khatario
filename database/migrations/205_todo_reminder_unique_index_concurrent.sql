-- Single statement: must not run inside an explicit transaction block.
-- (node scripts/run-migration.js sends one query; psql -f is also fine.)
-- If the index already exists from an earlier 204 run, IF NOT EXISTS skips creation.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_notifications_todo_reminder_user_ref
  ON notifications (user_id, reference_id)
  WHERE (type = 'todo_reminder');

COMMENT ON INDEX uq_notifications_todo_reminder_user_ref IS
  'Prevents duplicate todo_reminder in-app rows per user per todo.';
