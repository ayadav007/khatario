-- 482: the HR Lite plan description stops saying it comes with every Billing plan (SUB-44 follow-up).
-- Since migration 387 the bundle depends on the Billing plan: Billing Starter includes HR Lite,
-- Billing Growth includes HR Starter, Billing Business includes HR Pro, Free includes none.
-- Text only: no price, limit, feature or subscription changes. Idempotent.

SET LOCAL lock_timeout = '5s';

UPDATE subscription_plans
SET description = 'Included with Billing Starter: add up to 30 staff, mark attendance and pay salary. Billing Growth and Billing Business come with a bigger HR plan.',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'hr_staff_lite'
  AND description IS DISTINCT FROM 'Included with Billing Starter: add up to 30 staff, mark attendance and pay salary. Billing Growth and Billing Business come with a bigger HR plan.';

DO $$
BEGIN
  RAISE NOTICE '482: HR Lite description updated where it differed (text only).';
END $$;
