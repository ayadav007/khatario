-- Rollback for notifications Release 2 foundation (migrations 337 + 338).
--
-- No application code reads seq, popup_dismissed_at or notification_reads yet, so rollback is
-- only needed if a step misbehaves. It never drops data or columns: notifications.seq,
-- notifications.popup_dismissed_at, notifications_seq and notification_reads (with any rows)
-- are kept, so re-applying later is safe.
--
-- Run with psql in autocommit mode (DROP INDEX CONCURRENTLY cannot run in a transaction).
-- Pick the steps you need; each is independent and idempotent.

-- 1. Restore pre-Release-2 re-fire behaviour (re-fired reminders keep their old seq).
DROP TRIGGER IF EXISTS trg_notifications_refire_seq ON notifications;
DROP FUNCTION IF EXISTS notifications_refire_new_seq();

-- 2. Remove the new indexes (no data loss; writes get slightly cheaper).
DROP INDEX CONCURRENTLY IF EXISTS idx_notifications_seq_backfill;
DROP INDEX CONCURRENTLY IF EXISTS idx_notifications_business_user_seq;
DROP INDEX CONCURRENTLY IF EXISTS idx_todos_reminder_sweep;
DROP INDEX CONCURRENTLY IF EXISTS uq_notifications_seq;

-- 3. Stop assigning seq to new rows while keeping existing values.
ALTER TABLE notifications ALTER COLUMN seq DROP NOT NULL;
ALTER TABLE notifications ALTER COLUMN seq DROP DEFAULT;
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_seq_not_null;

-- 4. Remove helper procedures (code only). 338 calls them, so re-running it needs 337 first (step 5).
DROP PROCEDURE IF EXISTS notifications_backfill_seq(integer);
DROP PROCEDURE IF EXISTS notifications_seq_set_not_null();
DROP PROCEDURE IF EXISTS notifications_r2_drop_invalid_indexes();

-- 5. Only if 337/338 should run again on the next deploy (they are idempotent):
-- DELETE FROM schema_migrations
--  WHERE migration_name IN ('337_notifications_seq_foundation.sql', '338_notifications_seq_backfill_indexes.sql');
