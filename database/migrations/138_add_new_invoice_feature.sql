-- =====================================================
-- ADD NEW INVOICE FEATURE
-- Migration: 138_add_new_invoice_feature.sql
-- Description: Add "New Invoice" as a separate feature in Feature Registry
-- =====================================================

-- Insert "New Invoice" feature into platform_features
INSERT INTO platform_features (id, category, label, description, route_path, sort_order, is_active, is_addon)
VALUES (
  'sales_new_invoice',
  'sales',
  'New Invoice',
  'Create new tax invoices',
  '/invoices/new',
  1.5, -- Between "Invoices" (1) and "Estimates" (2)
  true,
  false
)
ON CONFLICT (id) DO UPDATE
SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  route_path = EXCLUDED.route_path,
  sort_order = EXCLUDED.sort_order,
  updated_at = CURRENT_TIMESTAMP;

-- Enable this feature for all existing plans that have 'sales_invoices' enabled
-- This ensures backward compatibility
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
SELECT 
  spf.plan_id,
  'sales_new_invoice' as feature_id,
  spf.enabled
FROM subscription_plan_features spf
WHERE spf.feature_id = 'sales_invoices'
ON CONFLICT (plan_id, feature_id) DO UPDATE
SET enabled = EXCLUDED.enabled;
