-- One-time self-serve trial extension (Option A: offer on first login after expiry, no auto grace).

ALTER TABLE business_subscriptions
  ADD COLUMN IF NOT EXISTS trial_extension_granted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trial_extension_declined_at TIMESTAMP;

COMMENT ON COLUMN business_subscriptions.trial_extension_granted IS
  'True when the tenant used the one-time in-app 7-day trial extension.';
COMMENT ON COLUMN business_subscriptions.trial_extension_declined_at IS
  'Set when the tenant chose to continue on the free plan instead of extending.';
