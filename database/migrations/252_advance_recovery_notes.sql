-- Notes when HR recovers less than full pending advance in one salary run.

ALTER TABLE advance_recoveries
  ADD COLUMN IF NOT EXISTS recovery_note TEXT;

COMMENT ON COLUMN advance_recoveries.recovery_note IS
  'Optional HR note when recovery is partial or deferred to a later salary';
