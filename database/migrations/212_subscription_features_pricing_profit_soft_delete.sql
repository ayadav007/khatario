-- Migration 212: Party pricing, invoice profit visibility, profit report tiers, soft delete entitlement
--
-- Khatario plan ids (see database/seed_subscriptions.sql): free, professional, business, enterprise, trial
-- Mapping (same intent as “silver / gold” product tiers, but real plan keys):
--   professional: party_pricing, profit_invoice, profit_reports_basic
--   business, enterprise, trial: those three + profit_reports_advanced + soft_delete

INSERT INTO platform_features (id, category, label, description, is_active, sort_order)
VALUES
  (
    'party_pricing',
    'sales',
    'Party-specific item pricing',
    'Override catalog prices per customer for items (party–item pricing matrix)',
    TRUE,
    220
  ),
  (
    'profit_invoice',
    'sales',
    'Invoice profitability',
    'Show gross profit / margin breakdown on invoice detail using line revenue and costs',
    TRUE,
    221
  ),
  (
    'profit_reports_basic',
    'reports',
    'Profit reports (basic)',
    'Profit-by-invoice and related basic profitability reports',
    TRUE,
    222
  ),
  (
    'profit_reports_advanced',
    'reports',
    'Profit reports (advanced)',
    'Advanced profitability analytics and segmented profit reporting',
    TRUE,
    223
  ),
  (
    'soft_delete',
    'settings',
    'Soft delete & restore',
    'Soft-delete invoices, purchases, payments, and customers; restore from archive',
    TRUE,
    224
  )
ON CONFLICT (id) DO NOTHING;

-- Mid paid tier — basic profitability + party pricing (professional)
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
SELECT 'professional', f, TRUE
FROM unnest(
  ARRAY[
    'party_pricing',
    'profit_invoice',
    'profit_reports_basic'
  ]::text[]
) AS f
WHERE EXISTS (SELECT 1 FROM subscription_plans WHERE id = 'professional')
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = EXCLUDED.enabled;

-- Higher tiers — full entitlement (business, enterprise, trial clones enterprise features)
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
SELECT pid, fk, TRUE
FROM unnest(
  ARRAY['business', 'enterprise', 'trial']::text[]
) AS p(pid)
CROSS JOIN unnest(
  ARRAY[
    'party_pricing',
    'profit_invoice',
    'profit_reports_basic',
    'profit_reports_advanced',
    'soft_delete'
  ]::text[]
) AS fk
WHERE EXISTS (SELECT 1 FROM subscription_plans sp WHERE sp.id = pid)
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = EXCLUDED.enabled;
