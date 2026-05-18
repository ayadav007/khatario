-- Migration: Add Missing Sales Features
-- Adds: Delivery Challans, Work Orders, Debit Notes, Proforma Invoice
-- Date: 2024
-- Description: Add missing features to Feature Matrix for proper lock icon display

-- Add Delivery Challans feature
INSERT INTO platform_features (id, category, label, description, route_path, sort_order, is_active, is_addon) VALUES
('sales_delivery_challans', 'sales', 'Delivery Challans', 'Create and manage delivery challans for goods dispatch', '/delivery-challans', 6, true, false)
ON CONFLICT (id) DO UPDATE SET
  category = EXCLUDED.category,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  route_path = EXCLUDED.route_path,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  is_addon = EXCLUDED.is_addon,
  updated_at = CURRENT_TIMESTAMP;

-- Add Work Orders feature
INSERT INTO platform_features (id, category, label, description, route_path, sort_order, is_active, is_addon) VALUES
('sales_work_orders', 'sales', 'Work Orders', 'Create and manage work orders for services', '/work-orders', 7, true, false)
ON CONFLICT (id) DO UPDATE SET
  category = EXCLUDED.category,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  route_path = EXCLUDED.route_path,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  is_addon = EXCLUDED.is_addon,
  updated_at = CURRENT_TIMESTAMP;

-- Add Debit Notes feature
INSERT INTO platform_features (id, category, label, description, route_path, sort_order, is_active, is_addon) VALUES
('sales_debit_notes', 'sales', 'Debit Notes', 'Create debit notes for additional charges and adjustments', '/debit-notes', 8, true, false)
ON CONFLICT (id) DO UPDATE SET
  category = EXCLUDED.category,
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  route_path = EXCLUDED.route_path,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active,
  is_addon = EXCLUDED.is_addon,
  updated_at = CURRENT_TIMESTAMP;

-- Note: Proforma Invoice uses /invoices/new?type=proforma_invoice
-- We'll map it to sales_estimates feature (same functionality as Estimates/Quotations)
-- No separate feature needed - handled via query param in sidebar

-- Update Estimates & Quotations label to match sidebar (if needed)
-- Keep the existing route /estimates for the estimates page
UPDATE platform_features 
SET label = 'Estimates & Quotations',
    description = 'Create quotations and convert to invoices',
    updated_at = CURRENT_TIMESTAMP
WHERE id = 'sales_estimates';

-- Map new features to subscription plans
-- Free/Starter: All disabled
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled) VALUES
('free', 'sales_delivery_challans', false),
('free', 'sales_work_orders', false),
('free', 'sales_debit_notes', false)
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = EXCLUDED.enabled;

-- Professional: All enabled
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled) VALUES
('professional', 'sales_delivery_challans', true),
('professional', 'sales_work_orders', true),
('professional', 'sales_debit_notes', true)
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = EXCLUDED.enabled;

-- Business: All enabled
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled) VALUES
('business', 'sales_delivery_challans', true),
('business', 'sales_work_orders', true),
('business', 'sales_debit_notes', true)
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = EXCLUDED.enabled;

-- Enterprise: All enabled
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled) VALUES
('enterprise', 'sales_delivery_challans', true),
('enterprise', 'sales_work_orders', true),
('enterprise', 'sales_debit_notes', true)
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = EXCLUDED.enabled;
