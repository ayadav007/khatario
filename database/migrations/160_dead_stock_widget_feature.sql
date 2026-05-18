-- Migration 160: Dead Stock widget feature
-- Adds the `dead_stock_widget` feature to the platform registry so the
-- customizable dashboard "Dead stock" widget can be toggled per subscription
-- plan from the admin feature matrix.
--
-- Mirrors the pattern established in 147_phase3_features.sql for
-- `customizable_dashboard`. Uses the same id in code and DB so no additional
-- canonical->registry mapping is required in lib/subscription/feature-access.ts.

-- Register the platform feature
INSERT INTO platform_features (id, category, label, description, is_active, sort_order)
VALUES
  (
    'dead_stock_widget',
    'inventory',
    'Dead Stock Widget',
    'Dashboard widget highlighting inventory with no recent sales, with branch/warehouse drill-down',
    TRUE,
    107
  )
ON CONFLICT (id) DO NOTHING;

-- Enable for all existing subscription plans by default. Admins can toggle
-- per plan via /admin/plans/[planId]/features if a stricter matrix is needed.
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
SELECT sp.id, 'dead_stock_widget', TRUE
FROM subscription_plans sp
ON CONFLICT (plan_id, feature_id) DO NOTHING;
