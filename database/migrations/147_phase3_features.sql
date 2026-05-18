-- Migration: Phase 3 Features
-- Description: Add tables and features for Phase 3 advanced functionality
-- Created: 2026-02-07

-- 1. Customizable Dashboard
CREATE TABLE IF NOT EXISTS dashboard_layouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL UNIQUE REFERENCES businesses(id) ON DELETE CASCADE,
  widgets JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Report Builder
CREATE TABLE IF NOT EXISTS custom_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  entity_type VARCHAR(50) NOT NULL, -- 'invoices', 'customers', etc.
  fields JSONB NOT NULL, -- Selected fields
  filters JSONB, -- Filter criteria
  grouping JSONB, -- Grouping configuration
  sorting JSONB, -- Sort configuration
  is_public BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Workflow Automation
CREATE TABLE IF NOT EXISTS workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  trigger_type VARCHAR(50) NOT NULL, -- 'invoice_created', 'payment_received', etc.
  trigger_config JSONB,
  conditions JSONB, -- Array of conditions
  actions JSONB NOT NULL, -- Array of actions to perform
  is_active BOOLEAN DEFAULT TRUE,
  execution_count INT DEFAULT 0,
  last_executed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workflow_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  entity_id UUID,
  status VARCHAR(20) NOT NULL, -- 'success', 'failed', 'skipped'
  error_message TEXT,
  executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_dashboard_layouts_business ON dashboard_layouts(business_id);
CREATE INDEX idx_custom_reports_business ON custom_reports(business_id);
CREATE INDEX idx_custom_reports_user ON custom_reports(user_id);
CREATE INDEX idx_workflows_business ON workflows(business_id);
CREATE INDEX idx_workflows_active ON workflows(business_id, is_active) WHERE is_active = TRUE;
CREATE INDEX idx_workflow_executions_workflow ON workflow_executions(workflow_id);

-- Add Phase 3 features to platform registry
INSERT INTO platform_features (id, category, label, description, is_active, sort_order)
VALUES
  ('customizable_dashboard', 'settings', 'Customizable Dashboard', 'Drag-and-drop widgets to customize your dashboard', TRUE, 102),
  ('report_builder', 'reports', 'Report Builder', 'Create custom reports with drag-and-drop fields', TRUE, 103),
  ('workflow_automation', 'settings', 'Workflow Automation', 'Automate repetitive tasks and workflows', TRUE, 104),
  ('mobile_enhancements', 'settings', 'Mobile Enhancements', 'Enhanced mobile experience with swipe gestures', TRUE, 105),
  ('accessibility', 'settings', 'Accessibility Features', 'Enhanced accessibility for screen readers', TRUE, 106)
ON CONFLICT (id) DO NOTHING;

-- Enable for all subscription plans
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
SELECT sp.id, f.feature_id, TRUE
FROM subscription_plans sp
CROSS JOIN (VALUES 
  ('customizable_dashboard'),
  ('report_builder'),
  ('workflow_automation'),
  ('mobile_enhancements'),
  ('accessibility')
) AS f(feature_id)
ON CONFLICT (plan_id, feature_id) DO NOTHING;

-- Comments
COMMENT ON TABLE dashboard_layouts IS 'Stores custom dashboard widget layouts per business';
COMMENT ON TABLE custom_reports IS 'User-created custom reports with field selection';
COMMENT ON TABLE workflows IS 'Automated workflows triggered by business events';
COMMENT ON TABLE workflow_executions IS 'Log of workflow execution history';
