-- Migration 208: Multi-company user membership (user_businesses)
-- Description: Links users to businesses with roles; backfills from users.business_id as owner.
-- Created: 2026-04-28

CREATE TABLE IF NOT EXISTS user_businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'staff')),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT user_businesses_user_business_unique UNIQUE (user_id, business_id)
);

-- List members by business (unique index on (user_id, business_id) already supports lookups by user_id)
CREATE INDEX IF NOT EXISTS idx_user_businesses_business_id ON user_businesses(business_id);

COMMENT ON TABLE user_businesses IS
  'Membership of a user in a business with role owner, admin, or staff.';

-- Backfill: existing users have a single business on users.business_id — register as owner
INSERT INTO user_businesses (user_id, business_id, role)
SELECT u.id, u.business_id, 'owner'
FROM users u
WHERE u.business_id IS NOT NULL
ON CONFLICT (user_id, business_id) DO NOTHING;
