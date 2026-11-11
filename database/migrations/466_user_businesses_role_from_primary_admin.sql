-- Migration 466: correct membership roles left by the migration 208 backfill.
-- Description: Migration 208 registered every existing user as an 'owner' member of their
-- business, including staff users created through Settings → Users. The business switch
-- route treated an 'owner' membership as grounds to assign the primary_admin role, so a
-- pre-migration staff user could switch to their own business and gain full permissions.
--
-- The switch route no longer trusts the membership role alone. This migration also repairs
-- the data: a user the platform does not recognise as a business owner (users.is_primary_admin
-- is false or NULL) cannot be an 'owner' member of any business. Their memberships become
-- 'staff'. Real owners (is_primary_admin = true) are untouched, including their memberships in
-- additional businesses created through the add-business flow, which only owners may use.
-- Safe to run more than once.
-- Created: 2026-11-05

UPDATE user_businesses ub
SET role = 'staff'
FROM users u
WHERE ub.user_id = u.id
  AND ub.role = 'owner'
  AND COALESCE(u.is_primary_admin, false) = false;
