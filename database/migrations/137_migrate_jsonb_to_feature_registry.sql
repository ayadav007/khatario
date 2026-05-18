-- =====================================================
-- FINAL MIGRATION: JSONB TO FEATURE REGISTRY
-- Migration: 137_migrate_jsonb_to_feature_registry.sql
-- Date: 2024
-- Description: ONE-WAY migration from JSONB features to Feature Registry
--              NO FALLBACKS. Feature Registry is the ONLY source of truth.
-- =====================================================

-- =====================================================
-- PHASE 1: DATA MIGRATION
-- =====================================================

-- Map canonical JSONB feature keys to Feature Registry IDs
-- This mapping must be complete and accurate
DO $$
DECLARE
  plan_record RECORD;
  feature_key_var TEXT;
  feature_value_var BOOLEAN;
  registry_id_var TEXT;
  mapped_count INTEGER := 0;
  unmapped_keys TEXT[] := ARRAY[]::TEXT[];
  plan_enabled_count INTEGER;
BEGIN
  RAISE NOTICE 'Starting JSONB to Feature Registry migration...';
  
  -- Clear existing subscription_plan_features to ensure clean migration
  -- (This is safe because we're re-migrating from source of truth: JSONB)
  DELETE FROM subscription_plan_features;
  RAISE NOTICE 'Cleared existing subscription_plan_features';
  
  -- Loop through all subscription plans
  FOR plan_record IN 
    SELECT id, name, features 
    FROM subscription_plans 
    WHERE is_active = true
    ORDER BY id
  LOOP
    RAISE NOTICE 'Processing plan: % (%)', plan_record.name, plan_record.id;
    plan_enabled_count := 0;
    
    -- Extract features from JSONB
    IF plan_record.features->'features' IS NOT NULL THEN
      FOR feature_key_var, feature_value_var IN 
        SELECT * FROM jsonb_each_text(plan_record.features->'features')
      LOOP
        -- Skip false values (only migrate enabled features)
        IF feature_value_var = 'true' THEN
          -- Map canonical JSONB key to Feature Registry ID
          CASE feature_key_var
            -- Sales features
            WHEN 'invoice_creation' THEN registry_id_var := 'sales_invoices';
            WHEN 'estimates_quotations' THEN registry_id_var := 'sales_estimates';
            WHEN 'credit_notes' THEN registry_id_var := 'sales_credit_notes';
            WHEN 'recurring_invoices' THEN registry_id_var := 'sales_recurring_invoices';
            WHEN 'sales_orders' THEN registry_id_var := 'sales_sales_orders';
            
            -- Purchase features
            WHEN 'purchase_management' THEN registry_id_var := 'purchase_management';
            WHEN 'supplier_management' THEN registry_id_var := 'purchase_suppliers';
            WHEN 'expense_tracking' THEN registry_id_var := 'purchase_expenses';
            WHEN 'inventory_adjustments' THEN registry_id_var := 'purchase_inventory_adjustments';
            
            -- Settings features
            WHEN 'template_customization' THEN registry_id_var := 'settings_template_customization';
            WHEN 'multi_user' THEN registry_id_var := 'settings_multi_user';
            WHEN 'multi_branch' THEN registry_id_var := 'settings_multi_branch';
            WHEN 'multi_warehouse' THEN registry_id_var := 'settings_multi_warehouse';
            WHEN 'backup_restore' THEN registry_id_var := 'settings_backup';
            WHEN 'pos_mode' THEN registry_id_var := 'settings_pos_mode';
            
            -- Integration features
            WHEN 'email_invoicing' THEN registry_id_var := 'integration_email';
            WHEN 'payment_gateway' THEN registry_id_var := 'integration_payment_gateway';
            WHEN 'api_access' THEN registry_id_var := 'integration_api';
            
            -- Advanced features
            WHEN 'ledger_accounting' THEN registry_id_var := 'advanced_ledger';
            
            -- Tools features
            WHEN 'todo' THEN registry_id_var := 'tools_todo';
            
            -- Core features (always enabled, not in registry)
            -- These are handled separately and don't need registry entries
            WHEN 'customer_management' THEN registry_id_var := NULL;
            WHEN 'item_management' THEN registry_id_var := NULL;
            WHEN 'payment_tracking' THEN registry_id_var := NULL;
            WHEN 'stock_tracking' THEN registry_id_var := NULL;
            WHEN 'template_basic' THEN registry_id_var := NULL;
            WHEN 'template_all' THEN registry_id_var := NULL;
            WHEN 'template_thermal' THEN registry_id_var := NULL;
            WHEN 'pdf_generation' THEN registry_id_var := NULL;
            WHEN 'dashboard_analytics' THEN registry_id_var := NULL;
            WHEN 'reports_basic' THEN registry_id_var := NULL;
            WHEN 'reports_gst' THEN registry_id_var := NULL;
            WHEN 'reports_advanced' THEN registry_id_var := NULL;
            WHEN 'reports_analytics' THEN registry_id_var := NULL;
            WHEN 'alert_low_stock' THEN registry_id_var := NULL;
            WHEN 'alert_credit_limit' THEN registry_id_var := NULL;
            WHEN 'whatsapp_manual' THEN registry_id_var := NULL; -- Addon-based
            WHEN 'whatsapp_auto_reminders' THEN registry_id_var := NULL; -- Addon-based
            WHEN 'online_store' THEN registry_id_var := NULL;
            WHEN 'barcode_scanning' THEN registry_id_var := NULL;
            WHEN 'multi_currency' THEN registry_id_var := NULL;
            WHEN 'custom_branding' THEN registry_id_var := NULL;
            
            -- Unknown feature key
            ELSE 
              registry_id_var := NULL;
              unmapped_keys := array_append(unmapped_keys, format('%s (plan: %s)', feature_key_var, plan_record.id));
          END CASE;
          
          -- Insert into registry if mapping exists
          IF registry_id_var IS NOT NULL THEN
            -- Check if feature exists in platform_features
            IF EXISTS (SELECT 1 FROM platform_features WHERE id = registry_id_var) THEN
              INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
              VALUES (plan_record.id, registry_id_var, true)
              ON CONFLICT (plan_id, feature_id) 
              DO UPDATE SET enabled = true;
              
              plan_enabled_count := plan_enabled_count + 1;
              mapped_count := mapped_count + 1;
            ELSE
              RAISE WARNING 'Feature % does not exist in platform_features (plan: %, key: %)', 
                registry_id_var, plan_record.id, feature_key_var;
            END IF;
          END IF;
        END IF;
      END LOOP;
      
      RAISE NOTICE 'Plan %: Migrated % enabled features', plan_record.id, plan_enabled_count;
      
      -- FAIL if plan has zero enabled features (indicates migration issue)
      IF plan_enabled_count = 0 THEN
        RAISE EXCEPTION 'Plan % (%) has zero enabled features after migration. This indicates a migration failure.', 
          plan_record.name, plan_record.id;
      END IF;
    ELSE
      RAISE WARNING 'Plan % has no features JSONB object', plan_record.id;
    END IF;
  END LOOP;
  
  RAISE NOTICE 'Migration complete. Total features migrated: %', mapped_count;
  
  -- Report unmapped keys (non-fatal, but should be reviewed)
  IF array_length(unmapped_keys, 1) > 0 THEN
    RAISE WARNING 'Unmapped feature keys found: %', array_to_string(unmapped_keys, ', ');
  END IF;
END $$;

-- =====================================================
-- PHASE 2: REGISTRY COMPLETENESS GUARANTEE
-- =====================================================

-- Add registry_complete flag to subscription_plans
ALTER TABLE subscription_plans 
ADD COLUMN IF NOT EXISTS registry_complete BOOLEAN DEFAULT false;

-- Mark all plans as registry_complete after successful migration
UPDATE subscription_plans 
SET registry_complete = true 
WHERE is_active = true;

-- Add comment
COMMENT ON COLUMN subscription_plans.registry_complete IS 
  'Indicates that this plan has been fully migrated to Feature Registry. When true, JSONB features are ignored and registry is the only source of truth.';

-- =====================================================
-- VERIFICATION
-- =====================================================

-- Verify migration: Check that all active plans have registry entries
DO $$
DECLARE
  plan_count INTEGER;
  registry_count INTEGER;
  incomplete_plans TEXT[];
BEGIN
  SELECT COUNT(*) INTO plan_count 
  FROM subscription_plans 
  WHERE is_active = true;
  
  SELECT COUNT(DISTINCT plan_id) INTO registry_count 
  FROM subscription_plan_features;
  
  IF plan_count != registry_count THEN
    SELECT array_agg(id) INTO incomplete_plans
    FROM subscription_plans
    WHERE is_active = true
      AND id NOT IN (SELECT DISTINCT plan_id FROM subscription_plan_features);
    
    RAISE EXCEPTION 'Migration verification failed. Expected % plans, found % in registry. Incomplete plans: %', 
      plan_count, registry_count, array_to_string(incomplete_plans, ', ');
  END IF;
  
  RAISE NOTICE 'Verification passed: All % active plans have registry entries', plan_count;
END $$;

-- =====================================================
-- INDEXES (if not already present)
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_plan_features_plan_enabled 
ON subscription_plan_features(plan_id, enabled) 
WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_subscription_plans_registry_complete 
ON subscription_plans(registry_complete) 
WHERE registry_complete = true;
