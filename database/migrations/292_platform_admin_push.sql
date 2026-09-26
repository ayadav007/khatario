-- Platform admin Web Push subscriptions, VAPID keys, incident log, notification toggles

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS notify_incidents BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_push_signup BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notify_push_incident BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS vapid_public_key TEXT,
  ADD COLUMN IF NOT EXISTS encrypted_vapid_private_key TEXT;

CREATE TABLE IF NOT EXISTS platform_admin_push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id UUID NOT NULL REFERENCES platform_admins(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT platform_admin_push_endpoint_uniq UNIQUE (endpoint)
);

CREATE INDEX IF NOT EXISTS idx_platform_admin_push_admin
  ON platform_admin_push_subscriptions(admin_id);

CREATE TABLE IF NOT EXISTS platform_incidents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    kind VARCHAR(80) NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    url TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_platform_incidents_created
  ON platform_incidents(created_at DESC);

COMMENT ON TABLE platform_admin_push_subscriptions IS 'Web Push endpoints for installable /admin PWA';
COMMENT ON TABLE platform_incidents IS 'Operator-facing incidents (demo bookings, payment failures, etc.)';
