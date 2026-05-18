-- Migration: Advanced Filters System
-- Description: Add tables for saving and managing advanced filter presets
-- Created: 2026-02-07

-- Table to store saved filter presets
CREATE TABLE IF NOT EXISTS filter_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  entity_type VARCHAR(50) NOT NULL, -- 'invoices', 'customers', 'items', 'purchases', etc.
  filters JSONB NOT NULL, -- Array of filter criteria
  is_public BOOLEAN DEFAULT FALSE, -- If true, visible to all users in business
  is_default BOOLEAN DEFAULT FALSE, -- If true, applied automatically on page load
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_filter_presets_business ON filter_presets(business_id);
CREATE INDEX idx_filter_presets_user ON filter_presets(user_id);
CREATE INDEX idx_filter_presets_entity ON filter_presets(entity_type);
CREATE INDEX idx_filter_presets_default ON filter_presets(business_id, entity_type, is_default) WHERE is_default = TRUE;

-- Add feature to platform registry
INSERT INTO platform_features (id, category, label, description, is_active, sort_order)
VALUES (
  'advanced_filters',
  'settings',
  'Advanced Filters',
  'Multi-criteria filtering with saved filter presets',
  TRUE,
  100
)
ON CONFLICT (id) DO NOTHING;

-- Enable for all subscription plans
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
SELECT id, 'advanced_filters', TRUE
FROM subscription_plans
ON CONFLICT (plan_id, feature_id) DO NOTHING;

COMMENT ON TABLE filter_presets IS 'Stores saved filter presets for quick filtering of entity lists';
COMMENT ON COLUMN filter_presets.filters IS 'JSONB array of filter criteria: [{field: "status", operator: "eq", value: "paid"}]';
COMMENT ON COLUMN filter_presets.is_public IS 'If true, filter is visible to all users in the business';
COMMENT ON COLUMN filter_presets.is_default IS 'If true, filter is automatically applied on page load';
