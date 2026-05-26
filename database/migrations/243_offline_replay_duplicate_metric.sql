-- Migration 243: duplicate prevention metric for offline replay observability

ALTER TABLE offline_replay_log
  ADD COLUMN IF NOT EXISTS duplicate_prevented_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN offline_replay_log.duplicate_prevented_count IS
  'Times a completed replay was returned without re-executing (idempotency hits)';
