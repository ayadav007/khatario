-- 477: free plans never carry an end date, grace period or scheduled plan.
-- Plain statements separated by semicolons (no parameters, no psql meta-commands).

UPDATE business_module_subscriptions
   SET end_date = NULL, grace_period_end = NULL, scheduled_plan_id = NULL, updated_at = CURRENT_TIMESTAMP
 WHERE plan_id IN ('free', 'hr_free', 'connect_free', 'hr_staff_lite')
   AND (end_date IS NOT NULL OR grace_period_end IS NOT NULL);

-- Existing Khatario AI buyers had no end date; they get 30 days from the day this is applied.
UPDATE whatsapp_addons
   SET end_date = (CURRENT_DATE + INTERVAL '30 days')::date, updated_at = CURRENT_TIMESTAMP
 WHERE addon_type = 'khatario_ai' AND status = 'active' AND end_date IS NULL;
