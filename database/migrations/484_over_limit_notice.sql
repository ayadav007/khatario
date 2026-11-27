-- 484: a 7-day warning before users are paused or branches turn read-only (SUB-24, deploy-day safety).
-- Follows 483. Additive and idempotent; nothing is deleted and no existing value changes.
-- MUST run before the code that reads these columns is deployed (scripts/deploy-vps.sh runs db:migrate:pending first).
--
--   businesses.over_limit_seats_since     when the business was first seen with more seat holders than its plan allows
--   businesses.over_limit_branches_since  when it was first seen with more active branches than its plan allows
-- Pausing / read-only starts only 7 days after that time. During the 7 days the owner sees a banner in the app and gets
-- one email. The column is set and cleared by the request-time check (lib/subscription/over-limit-access.ts) and is
-- cleared again as soon as the business is back within its limit.

SET LOCAL lock_timeout = '5s';

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS over_limit_seats_since TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS over_limit_branches_since TIMESTAMPTZ;

DO $$
BEGIN
  RAISE NOTICE '484: over-limit warning columns ready (businesses.over_limit_seats_since, over_limit_branches_since)';
END $$;
