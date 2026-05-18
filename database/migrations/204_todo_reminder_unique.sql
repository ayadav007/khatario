-- Dedupe: remove exact duplicate todo_reminder rows (keeps oldest id).
-- Unique index is created in 205_todo_reminder_unique_index_concurrent.sql (CONCURRENTLY, not in a transaction).
DELETE FROM notifications n
USING notifications n2
WHERE n.id > n2.id
  AND n.type = 'todo_reminder'
  AND n2.type = 'todo_reminder'
  AND n.reference_type = 'todo'
  AND n2.reference_type = 'todo'
  AND n.user_id IS NOT DISTINCT FROM n2.user_id
  AND n.reference_id IS NOT DISTINCT FROM n2.reference_id;
