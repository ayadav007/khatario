-- Migration 242: Durable offline replay registry (Phase 3b idempotency)
-- tenant scope = business_id (multi-tenant accounting boundary)

CREATE TABLE IF NOT EXISTS offline_replay_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  action_type TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  request_payload JSONB NOT NULL,
  response_payload JSONB NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'manual_review')),
  error_message TEXT NULL,
  entity_type TEXT NULL,
  entity_id UUID NULL,
  replay_attempts INTEGER NOT NULL DEFAULT 0,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  created_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  device_id TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_offline_replay_log_business_idempotency
  ON offline_replay_log (business_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_offline_replay_log_status
  ON offline_replay_log (status);

CREATE INDEX IF NOT EXISTS idx_offline_replay_log_created_at
  ON offline_replay_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_offline_replay_log_business_status
  ON offline_replay_log (business_id, status, created_at DESC);

COMMENT ON TABLE offline_replay_log IS 'Idempotent offline action replay registry — prevents duplicate accounting commits';
COMMENT ON COLUMN offline_replay_log.business_id IS 'Tenant scope (business)';
COMMENT ON COLUMN offline_replay_log.idempotency_key IS 'Client-supplied deduplication key, unique per business';
COMMENT ON COLUMN offline_replay_log.request_hash IS 'SHA-256 of canonical request payload for tamper detection';

GRANT SELECT, INSERT, UPDATE ON TABLE offline_replay_log TO PUBLIC;
