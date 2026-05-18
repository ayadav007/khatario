-- Session invalidation for platform admin JWT cookies (same pattern as business users)
ALTER TABLE platform_admins
  ADD COLUMN IF NOT EXISTS auth_session_version INTEGER NOT NULL DEFAULT 1;
