-- Per-user session generation for single-device login policy.
-- When allow_multidevice_sync is false, auth_session_version is incremented on each
-- new login so previous refresh tokens become invalid. JWTs carry the version as claim `sv`.

ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_session_version BIGINT NOT NULL DEFAULT 1;

COMMENT ON COLUMN users.auth_session_version IS 'Incremented to invalidate existing JWTs (single-device logins, password change, policy tighten).';
