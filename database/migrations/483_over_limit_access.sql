-- 483: users and branches over the plan limit after a downgrade (SUB-24).
-- Follows 482. Additive and idempotent; nothing is deleted and no existing row changes value.
-- MUST run before the code that reads these columns is deployed (scripts/deploy-vps.sh runs
-- db:migrate:pending before the build and the reload).
--
-- Who is paused / read-only is decided at request time from the current plan and these columns, so an
-- upgrade restores access at once with no job. The columns only store the owner's explicit choice:
--   users.over_limit_keep     true = the owner chose this user to keep a seat when seats run short
--   branches.over_limit_keep  true = the owner chose this branch to stay writable when branches run short
-- Order used when seats / branches run short: owner (or default branch) first, then the owner's choice,
-- then the longest-standing (created_at ascending). Default: nobody is flagged, so the oldest keep access.

SET LOCAL lock_timeout = '5s';

ALTER TABLE users    ADD COLUMN IF NOT EXISTS over_limit_keep BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE branches ADD COLUMN IF NOT EXISTS over_limit_keep BOOLEAN NOT NULL DEFAULT false;

-- Who last saved the choice, and when (for support).
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS over_limit_choice_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS over_limit_choice_updated_by UUID;

DO $$
BEGIN
  RAISE NOTICE '483: over-limit access columns ready (users.over_limit_keep, branches.over_limit_keep)';
END $$;
