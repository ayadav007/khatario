-- Backfill billing plan feature-registry rows from JSONB, then clone enterprise → trial.
-- Safe on existing DBs: INSERT ... ON CONFLICT DO NOTHING (does not disable features).
-- Needed when seed_subscriptions.sql ran after 012/137/154 (empty catalog → trial with almost no entitlements).

DO $$
DECLARE
  plan_record RECORD;
  feature_key_var TEXT;
  feature_value_var TEXT;
  registry_id_var TEXT;
BEGIN
  FOR plan_record IN
    SELECT id, features
    FROM subscription_plans
    WHERE is_active = true
      AND COALESCE(product_line, 'billing') = 'billing'
  LOOP
    IF plan_record.features->'features' IS NULL THEN
      CONTINUE;
    END IF;

    FOR feature_key_var, feature_value_var IN
      SELECT * FROM jsonb_each_text(plan_record.features->'features')
    LOOP
      IF feature_value_var IS DISTINCT FROM 'true' THEN
        CONTINUE;
      END IF;

      CASE feature_key_var
        WHEN 'invoice_creation' THEN registry_id_var := 'sales_invoices';
        WHEN 'estimates_quotations' THEN registry_id_var := 'sales_estimates';
        WHEN 'credit_notes' THEN registry_id_var := 'sales_credit_notes';
        WHEN 'recurring_invoices' THEN registry_id_var := 'sales_recurring_invoices';
        WHEN 'sales_orders' THEN registry_id_var := 'sales_sales_orders';
        WHEN 'purchase_management' THEN registry_id_var := 'purchase_management';
        WHEN 'supplier_management' THEN registry_id_var := 'purchase_suppliers';
        WHEN 'expense_tracking' THEN registry_id_var := 'purchase_expenses';
        WHEN 'inventory_adjustments' THEN registry_id_var := 'purchase_inventory_adjustments';
        WHEN 'template_customization' THEN registry_id_var := 'settings_template_customization';
        WHEN 'multi_user' THEN registry_id_var := 'settings_multi_user';
        WHEN 'multi_branch' THEN registry_id_var := 'settings_multi_branch';
        WHEN 'multi_warehouse' THEN registry_id_var := 'settings_multi_warehouse';
        WHEN 'backup_restore' THEN registry_id_var := 'settings_backup';
        WHEN 'pos_mode' THEN registry_id_var := 'settings_pos_mode';
        WHEN 'email_invoicing' THEN registry_id_var := 'integration_email';
        WHEN 'payment_gateway' THEN registry_id_var := 'integration_payment_gateway';
        WHEN 'api_access' THEN registry_id_var := 'integration_api';
        WHEN 'ledger_accounting' THEN registry_id_var := 'advanced_ledger';
        WHEN 'todo' THEN registry_id_var := 'tools_todo';
        WHEN 'online_store' THEN registry_id_var := 'advanced_online_store';
        WHEN 'barcode_scanning' THEN registry_id_var := 'advanced_barcode';
        WHEN 'multi_currency' THEN registry_id_var := 'advanced_multi_currency';
        WHEN 'custom_branding' THEN registry_id_var := 'advanced_custom_branding';
        ELSE registry_id_var := NULL;
      END CASE;

      IF registry_id_var IS NOT NULL AND EXISTS (
        SELECT 1 FROM platform_features WHERE id = registry_id_var
      ) THEN
        INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
        VALUES (plan_record.id, registry_id_var, true)
        ON CONFLICT (plan_id, feature_id) DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Trial entitlements = enterprise matrix (same as migration 154, now that enterprise exists).
INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
SELECT 'trial', spf.feature_id, spf.enabled
FROM subscription_plan_features spf
WHERE spf.plan_id = 'enterprise'
  AND EXISTS (SELECT 1 FROM subscription_plans WHERE id = 'trial')
ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = EXCLUDED.enabled;

INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value)
SELECT 'trial', spl.limit_key, spl.limit_value
FROM subscription_plan_limits spl
WHERE spl.plan_id = 'enterprise'
  AND EXISTS (SELECT 1 FROM subscription_plans WHERE id = 'trial')
ON CONFLICT (plan_id, limit_key) DO UPDATE SET limit_value = EXCLUDED.limit_value;
