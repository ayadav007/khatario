-- Notifications Release 2, part 1 of 2: schema foundation (fast, metadata-only).
--
-- * notifications.seq: monotonic cursor. Nullable here; 338 backfills it and sets NOT NULL.
--   The sequence starts at 1e12 so new rows never collide with the backfill, which numbers
--   pre-existing rows 1..N in (created_at, id) order. Concurrent inserts get a value from the
--   column default as soon as this file commits, so no new NULLs can appear.
-- * Re-fired todo reminders keep their id (ON CONFLICT DO UPDATE) but get a new seq and a
--   cleared popup_dismissed_at, via trigger, without touching reminder code. The upsert always
--   sets created_at = NOW(); read/mark-all updates never change created_at.
-- * notifications.popup_dismissed_at, notification_reads (broadcast read receipts).
-- * Procedures used by 338 (batched backfill, NOT NULL without a long lock).
--
-- ADD COLUMN without a default and SET DEFAULT do not rewrite the table, but need a brief
-- ACCESS EXCLUSIVE lock; lock_timeout makes the file fail fast instead of queueing writers.
-- created_at stays timestamp without time zone (conversion is deferred).

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE SEQUENCE IF NOT EXISTS notifications_seq AS bigint START WITH 1000000000000;

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS seq bigint;
ALTER TABLE notifications ALTER COLUMN seq SET DEFAULT nextval('notifications_seq');
ALTER SEQUENCE notifications_seq OWNED BY notifications.seq;

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS popup_dismissed_at timestamptz;

CREATE TABLE IF NOT EXISTS notification_reads (
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_notification_reads_user ON notification_reads (user_id);

CREATE OR REPLACE FUNCTION notifications_refire_new_seq() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.seq := nextval('notifications_seq');
  NEW.popup_dismissed_at := NULL;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_notifications_refire_seq ON notifications;
CREATE TRIGGER trg_notifications_refire_seq
  BEFORE UPDATE ON notifications
  FOR EACH ROW
  WHEN (NEW.type = 'todo_reminder' AND NEW.created_at IS DISTINCT FROM OLD.created_at)
  EXECUTE FUNCTION notifications_refire_new_seq();

-- Drops a half-built (INVALID) index left by an interrupted concurrent index build in 338,
-- so re-running 338 rebuilds it instead of IF NOT EXISTS silently keeping it.
-- (The runner switches a file to autocommit if its text, comments included, contains the
-- concurrent-index statement, so this file must never spell it out.)
CREATE OR REPLACE PROCEDURE notifications_r2_drop_invalid_indexes()
LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  PERFORM set_config('lock_timeout', '5s', true);
  FOR r IN
    SELECT c.relname
      FROM pg_index i
      JOIN pg_class c ON c.oid = i.indexrelid
     WHERE NOT i.indisvalid
       AND c.relnamespace = 'public'::regnamespace
       AND c.relname IN (
         'uq_notifications_seq',
         'idx_notifications_seq_backfill',
         'idx_notifications_business_user_seq',
         'idx_todos_reminder_sweep'
       )
  LOOP
    EXECUTE format('DROP INDEX public.%I', r.relname);
  END LOOP;
END
$$;

-- Numbers rows that still have seq IS NULL, oldest first, one committed batch at a time.
-- Restart-safe: committed batches stay, the next run continues after the highest backfilled
-- value. Must be CALLed outside an explicit transaction block (it COMMITs).
CREATE OR REPLACE PROCEDURE notifications_backfill_seq(batch_size integer DEFAULT 5000)
LANGUAGE plpgsql AS $$
DECLARE
  reserved_max constant bigint := 999999999999;
  next_seq bigint;
  updated integer;
BEGIN
  IF (SELECT last_value FROM notifications_seq) <= reserved_max THEN
    RAISE EXCEPTION 'notifications_seq is inside the backfill range (%); refusing to backfill',
      (SELECT last_value FROM notifications_seq);
  END IF;

  SELECT coalesce(max(seq), 0) INTO next_seq FROM notifications WHERE seq <= reserved_max;

  LOOP
    WITH picked AS (
      SELECT id, created_at
        FROM notifications
       WHERE seq IS NULL
       ORDER BY created_at NULLS FIRST, id
       LIMIT batch_size
         FOR UPDATE
    ), numbered AS (
      SELECT id, row_number() OVER (ORDER BY created_at NULLS FIRST, id) AS rn FROM picked
    )
    UPDATE notifications n
       SET seq = next_seq + numbered.rn
      FROM numbered
     WHERE n.id = numbered.id
       AND n.seq IS NULL;
    GET DIAGNOSTICS updated = ROW_COUNT;

    next_seq := next_seq + updated;
    IF next_seq > reserved_max THEN
      RAISE EXCEPTION 'notifications backfill exceeded the reserved seq range';
    END IF;
    COMMIT;
    EXIT WHEN updated = 0;
  END LOOP;
END
$$;

-- SET NOT NULL without a full-table scan under ACCESS EXCLUSIVE: a validated CHECK proves
-- there are no NULLs (PostgreSQL 12+), and VALIDATE only takes SHARE UPDATE EXCLUSIVE.
-- Fails (and leaves seq nullable) if any row still has seq IS NULL.
CREATE OR REPLACE PROCEDURE notifications_seq_set_not_null()
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.notifications'::regclass AND attname = 'seq' AND attnotnull
  ) THEN
    RETURN;
  END IF;

  PERFORM set_config('lock_timeout', '5s', true);
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.notifications'::regclass AND conname = 'notifications_seq_not_null'
  ) THEN
    ALTER TABLE notifications ADD CONSTRAINT notifications_seq_not_null CHECK (seq IS NOT NULL) NOT VALID;
  END IF;
  COMMIT;

  ALTER TABLE notifications VALIDATE CONSTRAINT notifications_seq_not_null;
  COMMIT;

  PERFORM set_config('lock_timeout', '5s', true);
  ALTER TABLE notifications ALTER COLUMN seq SET NOT NULL;
  ALTER TABLE notifications DROP CONSTRAINT notifications_seq_not_null;
  COMMIT;
END
$$;

COMMIT;
