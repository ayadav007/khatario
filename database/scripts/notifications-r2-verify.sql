-- Read-only checks after migrations 337 + 338 (notifications Release 2 foundation).
-- Expected: null_seq = 0, duplicate_seq = 0, every index valid, seq_not_null = true,
-- sequence last_value above max_backfilled and >= 1000000000000.

SELECT migration_name, success, executed_at, error_message
  FROM schema_migrations
 WHERE migration_name IN ('337_notifications_seq_foundation.sql', '338_notifications_seq_backfill_indexes.sql')
 ORDER BY migration_name;

SELECT count(*)                                              AS total_rows,
       count(*) FILTER (WHERE seq IS NULL)                   AS null_seq,
       count(*) FILTER (WHERE seq < 1000000000000)           AS backfilled_rows,
       max(seq) FILTER (WHERE seq < 1000000000000)           AS max_backfilled,
       min(seq) FILTER (WHERE seq >= 1000000000000)          AS min_new_seq
  FROM notifications;

SELECT count(*) AS duplicate_seq
  FROM (SELECT seq FROM notifications WHERE seq IS NOT NULL GROUP BY seq HAVING count(*) > 1) d;

-- Backfilled rows must follow (created_at, id) order: expect 0.
SELECT count(*) AS out_of_order
  FROM (
    SELECT seq, lag(seq) OVER (ORDER BY created_at NULLS FIRST, id) AS prev_seq
      FROM notifications
     WHERE seq < 1000000000000
  ) o
 WHERE prev_seq IS NOT NULL AND seq <= prev_seq;

SELECT a.attnotnull AS seq_not_null, pg_get_expr(d.adbin, d.adrelid) AS seq_default
  FROM pg_attribute a
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
 WHERE a.attrelid = 'public.notifications'::regclass AND a.attname = 'seq';

SELECT last_value, is_called FROM notifications_seq;

SELECT c.relname AS index_name, i.indisvalid AS valid, i.indisready AS ready, pg_get_indexdef(i.indexrelid) AS definition
  FROM pg_index i
  JOIN pg_class c ON c.oid = i.indexrelid
 WHERE c.relname IN (
   'uq_notifications_seq',
   'idx_notifications_business_user_seq',
   'idx_todos_reminder_sweep',
   'idx_notifications_seq_backfill',
   'notification_reads_pkey',
   'idx_notification_reads_user'
 )
 ORDER BY 1;
-- idx_notifications_seq_backfill should be absent after 338 completes.

SELECT to_regclass('public.notification_reads') AS notification_reads,
       (SELECT count(*) FROM notification_reads) AS receipts,
       EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.notifications'::regclass
                AND attname = 'popup_dismissed_at' AND NOT attisdropped) AS has_popup_dismissed_at,
       EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_notifications_refire_seq'
                AND tgrelid = 'public.notifications'::regclass) AS has_refire_trigger;
