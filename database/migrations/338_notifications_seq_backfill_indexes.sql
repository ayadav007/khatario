-- Notifications Release 2, part 2 of 2: backfill notifications.seq and build indexes.
--
-- Contains CREATE INDEX CONCURRENTLY, so the runner executes it statement by statement in
-- autocommit mode (it splits on semicolons: no DO blocks or dollar quotes in this file).
-- Every statement is safe to re-run: if the file fails part-way it is recorded as failed and
-- the next run resumes (invalid indexes are dropped and rebuilt, the backfill continues from
-- the last committed batch, NOT NULL is skipped once set).
--
-- Locking:
-- * CREATE/DROP INDEX CONCURRENTLY never block reads or writes on notifications/todos.
-- * The backfill commits every 5000 rows and only row-locks the batch it is numbering.
-- * NOT NULL: brief ACCESS EXCLUSIVE locks only, the scan runs under SHARE UPDATE EXCLUSIVE.
-- The backfill updates an indexed column, so updated rows are not HOT: expect index growth
-- roughly proportional to the backfilled row count until autovacuum catches up.
--
-- Requires 337. Verification and rollback: database/scripts/notifications-r2-verify.sql and
-- database/scripts/notifications-r2-rollback.sql.

CALL notifications_r2_drop_invalid_indexes();

-- Unique before the backfill so a duplicate can never be committed.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_notifications_seq ON notifications (seq);

-- Temporary: lets each backfill batch find the oldest unnumbered rows without a table scan.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_seq_backfill
  ON notifications (created_at NULLS FIRST, id) WHERE seq IS NULL;

CALL notifications_backfill_seq(5000);

CALL notifications_seq_set_not_null();

DROP INDEX CONCURRENTLY IF EXISTS idx_notifications_seq_backfill;

-- Catch-up: WHERE business_id = $1 AND (user_id = $2 OR user_id IS NULL) AND seq > $3 ORDER BY seq.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_business_user_seq
  ON notifications (business_id, user_id, seq);

-- Pending reminder sweep (todos/check-reminders, cron/send-todo-reminders).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_todos_reminder_sweep
  ON todos (reminder_time)
  WHERE reminder_sent = false AND status IN ('pending', 'in_progress', 'overdue');
