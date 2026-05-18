-- Registry entries for WhatsApp credit threshold alerts + automated email payment reminders (plan-gated).

INSERT INTO platform_features (id, category, label, description, is_active, sort_order)
VALUES
  (
    'whatsapp_credit_alerts',
    'integrations',
    'WhatsApp credit alerts',
    'Notify staff on WhatsApp when customer/supplier crosses credit utilization thresholds',
    TRUE,
    46
  ),
  (
    'email_reminders',
    'integrations',
    'Email payment reminders',
    'Send payment due / overdue reminders by email alongside WhatsApp when configured',
    TRUE,
    47
  )
ON CONFLICT (id) DO NOTHING;

-- Paid tiers — align with whatsapp_auto_reminders / recovery tooling (omit free tier)
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
SELECT pid, fk, TRUE
FROM unnest(ARRAY['professional', 'business', 'enterprise', 'trial']::text[]) AS p(pid)
CROSS JOIN unnest(
  ARRAY[
    'whatsapp_credit_alerts',
    'email_reminders'
  ]::text[]
) AS fk
WHERE EXISTS (SELECT 1 FROM subscription_plans sp WHERE sp.id = pid)
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = EXCLUDED.enabled;
