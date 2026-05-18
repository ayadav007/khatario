-- Migration: Bulk Actions Feature
-- Description: Add bulk actions feature to platform registry
-- Created: 2026-02-07

-- Add feature to platform registry
INSERT INTO platform_features (id, category, label, description, is_active, sort_order)
VALUES (
  'bulk_actions',
  'settings',
  'Bulk Actions',
  'Perform actions on multiple items at once',
  TRUE,
  101
)
ON CONFLICT (id) DO NOTHING;

-- Enable for all subscription plans
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
SELECT id, 'bulk_actions', TRUE
FROM subscription_plans
ON CONFLICT (plan_id, feature_id) DO NOTHING;
