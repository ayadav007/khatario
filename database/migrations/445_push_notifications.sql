-- Migration 445: Push notifications (Firebase Cloud Messaging) for the Capacitor app and the phone app
-- Description: Device tokens for two audiences that must never mix: business users (tenants and
--   their staff, identified by users.id) and store customers (identified by store_customers.id,
--   always scoped to the shop that signed them in). A push job is the outbox: every row written to
--   notifications becomes one job by trigger (a re-fired todo reminder with a new seq becomes a new
--   job), and customer-facing messages are queued by the server explicitly. A worker claims jobs
--   with SKIP LOCKED, sends through FCM and records one delivery row per device, so concurrent
--   workers never send the same job twice and a provider failure never touches the notification
--   row itself. Tokens are stored once; their sha256 is what logs and delivery rows carry.
--   Audit: docs/qa/notification-audit/08-push-implementation.md
-- Created: 2026-10-29

CREATE TABLE IF NOT EXISTS push_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audience VARCHAR(16) NOT NULL CHECK (audience IN ('business', 'customer')),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES store_customers(id) ON DELETE CASCADE,
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    app_id VARCHAR(80) NOT NULL,
    platform VARCHAR(16) NOT NULL DEFAULT 'android',
    token TEXT NOT NULL,
    token_hash CHAR(64) NOT NULL,
    environment VARCHAR(16) NOT NULL DEFAULT 'production',
    session_version INTEGER,
    device_label VARCHAR(120),
    app_version VARCHAR(40),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMPTZ,
    revoked_reason VARCHAR(40),
    CONSTRAINT uq_push_devices_token UNIQUE (token),
    CONSTRAINT chk_push_devices_owner CHECK (
        (audience = 'business' AND user_id IS NOT NULL AND customer_id IS NULL)
        OR (audience = 'customer' AND customer_id IS NOT NULL AND business_id IS NOT NULL AND user_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_push_devices_user ON push_devices (user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_push_devices_customer ON push_devices (customer_id, business_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_push_devices_token_hash ON push_devices (token_hash);

CREATE TABLE IF NOT EXISTS push_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind VARCHAR(16) NOT NULL CHECK (kind IN ('notification', 'customer')),
    audience VARCHAR(16) NOT NULL CHECK (audience IN ('business', 'customer')),
    notification_id UUID REFERENCES notifications(id) ON DELETE CASCADE,
    notification_seq BIGINT,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    -- business audience: the one recipient, or NULL for every member of the business
    user_id UUID,
    customer_id UUID REFERENCES store_customers(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    body TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_at TIMESTAMPTZ,
    last_error VARCHAR(200),
    sent_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMPTZ,
    CONSTRAINT chk_push_jobs_target CHECK (
        (audience = 'business' AND customer_id IS NULL)
        OR (audience = 'customer' AND customer_id IS NOT NULL)
    )
);

-- One job per notification occurrence (a todo re-fire has a new seq and gets a new job).
CREATE UNIQUE INDEX IF NOT EXISTS uq_push_jobs_notification_seq
    ON push_jobs (notification_id, notification_seq) WHERE notification_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_push_jobs_pending ON push_jobs (next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_push_jobs_business_created ON push_jobs (business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS push_deliveries (
    id BIGSERIAL PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES push_jobs(id) ON DELETE CASCADE,
    device_id UUID REFERENCES push_devices(id) ON DELETE SET NULL,
    token_hash CHAR(64),
    status VARCHAR(16) NOT NULL CHECK (status IN ('accepted', 'retry', 'invalid_token', 'failed')),
    error_code VARCHAR(80),
    provider_message_id VARCHAR(200),
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_push_deliveries_job ON push_deliveries (job_id);

-- Outbox trigger: every notification row (and every re-fire) becomes a push job for its business
-- audience. The job commits with the producer's transaction, so a rolled-back producer leaves no job.
-- seq is read through to_jsonb so the function has no catalog dependency on the column: the
-- Release 2 test reset (and any rollback that drops seq) can still run, and a row without a
-- seq simply queues a job with notification_seq NULL.
CREATE OR REPLACE FUNCTION notifications_enqueue_push() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  new_seq bigint := (to_jsonb(NEW)->>'seq')::bigint;
  old_seq bigint;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    old_seq := (to_jsonb(OLD)->>'seq')::bigint;
    -- Only a re-fire (new seq) is a new occurrence; reads and dismissals change nothing here.
    IF new_seq IS NOT DISTINCT FROM old_seq THEN
      RETURN NEW;
    END IF;
  END IF;
  INSERT INTO push_jobs (kind, audience, notification_id, notification_seq, business_id, user_id, title, body, data)
  VALUES (
    'notification', 'business', NEW.id, new_seq, NEW.business_id, NEW.user_id,
    LEFT(COALESCE(NEW.title, ''), 255), COALESCE(NEW.message, ''),
    jsonb_strip_nulls(jsonb_build_object(
      'type', NEW.type,
      'reference_type', NEW.reference_type,
      'reference_id', NEW.reference_id::text
    ))
  )
  ON CONFLICT (notification_id, notification_seq) WHERE notification_id IS NOT NULL DO NOTHING;
  PERFORM pg_notify('push_jobs', '');
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_notifications_push_insert ON notifications;
CREATE TRIGGER trg_notifications_push_insert
  AFTER INSERT ON notifications
  FOR EACH ROW
  EXECUTE FUNCTION notifications_enqueue_push();

-- Not "UPDATE OF seq" and no WHEN clause: the re-fire seq is assigned by the BEFORE trigger from
-- migration 337, not by the statement's SET list, and a WHEN clause naming seq would tie the
-- trigger to the column. The function returns at once when seq did not change.
DROP TRIGGER IF EXISTS trg_notifications_push_refire ON notifications;
CREATE TRIGGER trg_notifications_push_refire
  AFTER UPDATE ON notifications
  FOR EACH ROW
  EXECUTE FUNCTION notifications_enqueue_push();

DO $$
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE push_devices, push_jobs, push_deliveries TO PUBLIC;
  GRANT USAGE, SELECT ON SEQUENCE push_deliveries_id_seq TO PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'khatario_user') THEN
    GRANT ALL PRIVILEGES ON TABLE push_devices, push_jobs, push_deliveries TO khatario_user;
    GRANT ALL PRIVILEGES ON SEQUENCE push_deliveries_id_seq TO khatario_user;
  END IF;
END $$;

COMMENT ON TABLE push_devices IS 'FCM tokens per device; audience business (users) or customer (store_customers of one shop), never both';
COMMENT ON TABLE push_jobs IS 'Push outbox: one job per notification occurrence or customer message; claimed with SKIP LOCKED';
COMMENT ON TABLE push_deliveries IS 'One row per device per attempt; carries the token hash, never the token';
