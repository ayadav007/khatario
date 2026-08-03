-- Migration 262: Module-aware default roles — HR signup gets HR presets only, not billing Sales/Accountant/Inventory

CREATE OR REPLACE FUNCTION business_has_enabled_module(p_business_id UUID, p_module_key TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'business_modules'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM business_modules
      WHERE business_id = p_business_id
        AND module_key = p_module_key
        AND enabled = true
    ) THEN
      RETURN true;
    END IF;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM businesses b
    WHERE b.id = p_business_id
      AND (
        (p_module_key = 'billing' AND COALESCE(b.product_line, 'billing') IN ('billing', 'connect', 'crm'))
        OR (p_module_key = 'hr' AND b.product_line = 'hr')
        OR (p_module_key = 'connect' AND b.product_line = 'connect')
      )
  );
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION ensure_billing_default_roles_for_business(p_business_id UUID)
RETURNS VOID AS $$
DECLARE
    v_sales_role_id UUID;
    v_accountant_role_id UUID;
    v_inventory_role_id UUID;
BEGIN
    IF NOT business_has_enabled_module(p_business_id, 'billing') THEN
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM user_roles WHERE business_id = p_business_id AND role_key = 'sales'
    ) THEN
        INSERT INTO user_roles (business_id, role_name, role_key, description, is_system_role)
        VALUES (p_business_id, 'Sales', 'sales', 'Create and manage sales invoices', true)
        RETURNING id INTO v_sales_role_id;

        INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
        VALUES
            (v_sales_role_id, 'dashboard', true, false, false, false, false),
            (v_sales_role_id, 'invoices', true, true, true, false, true),
            (v_sales_role_id, 'credit_notes', true, true, false, false, false),
            (v_sales_role_id, 'customers', true, true, true, false, false),
            (v_sales_role_id, 'items', true, false, false, false, false),
            (v_sales_role_id, 'warehouses', true, false, false, false, false),
            (v_sales_role_id, 'payments', true, true, false, false, false);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM user_roles WHERE business_id = p_business_id AND role_key = 'accountant'
    ) THEN
        INSERT INTO user_roles (business_id, role_name, role_key, description, is_system_role)
        VALUES (p_business_id, 'Accountant', 'accountant', 'Manage finances and payments', true)
        RETURNING id INTO v_accountant_role_id;

        INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
        VALUES
            (v_accountant_role_id, 'dashboard', true, false, false, false, false),
            (v_accountant_role_id, 'invoices', true, false, true, false, true),
            (v_accountant_role_id, 'credit_notes', true, true, true, false, false),
            (v_accountant_role_id, 'customers', true, true, true, false, false),
            (v_accountant_role_id, 'purchases', true, false, true, false, false),
            (v_accountant_role_id, 'purchase_returns', true, true, true, false, false),
            (v_accountant_role_id, 'suppliers', true, true, true, false, false),
            (v_accountant_role_id, 'payments', true, true, true, false, false),
            (v_accountant_role_id, 'warehouses', true, false, false, false, false),
            (v_accountant_role_id, 'reports', true, false, false, false, true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM user_roles WHERE business_id = p_business_id AND role_key = 'inventory_manager'
    ) THEN
        INSERT INTO user_roles (business_id, role_name, role_key, description, is_system_role)
        VALUES (p_business_id, 'Inventory Manager', 'inventory_manager', 'Manage inventory and purchases', true)
        RETURNING id INTO v_inventory_role_id;

        INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
        VALUES
            (v_inventory_role_id, 'dashboard', true, false, false, false, false),
            (v_inventory_role_id, 'purchases', true, true, true, false, false),
            (v_inventory_role_id, 'purchase_returns', true, true, true, false, false),
            (v_inventory_role_id, 'suppliers', true, true, true, false, false),
            (v_inventory_role_id, 'items', true, true, true, true, false),
            (v_inventory_role_id, 'warehouses', true, true, true, true, false),
            (v_inventory_role_id, 'reports', true, false, false, false, false);
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION create_default_roles_for_business(p_business_id UUID)
RETURNS VOID AS $$
DECLARE
    v_primary_admin_role_id UUID;
BEGIN
    INSERT INTO user_roles (business_id, role_name, role_key, description, is_system_role)
    VALUES (p_business_id, 'Primary Admin', 'primary_admin', 'Full access to all features', true)
    RETURNING id INTO v_primary_admin_role_id;

    INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
    SELECT v_primary_admin_role_id, module_key, true, true, true, true, true
    FROM permission_modules WHERE is_active = true;

    PERFORM ensure_billing_default_roles_for_business(p_business_id);

    IF business_has_enabled_module(p_business_id, 'hr') THEN
        PERFORM ensure_hr_default_roles_for_business(p_business_id);
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION create_default_roles_for_business_if_missing(p_business_id UUID)
RETURNS VOID AS $$
DECLARE
    v_primary_admin_role_id UUID;
    v_role_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_role_count
    FROM user_roles
    WHERE business_id = p_business_id;

    IF v_role_count = 0 THEN
        INSERT INTO user_roles (business_id, role_name, role_key, description, is_system_role)
        VALUES (p_business_id, 'Primary Admin', 'primary_admin', 'Full access to all features', true)
        RETURNING id INTO v_primary_admin_role_id;

        INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
        SELECT v_primary_admin_role_id, module_key, true, true, true, true, true
        FROM permission_modules WHERE is_active = true;
    END IF;

    PERFORM ensure_billing_default_roles_for_business(p_business_id);

    IF business_has_enabled_module(p_business_id, 'hr') THEN
        PERFORM ensure_hr_default_roles_for_business(p_business_id);
    END IF;
END;
$$ LANGUAGE plpgsql;

-- HR-only businesses: hide billing preset roles (keep rows for audit; no users should be assigned)
UPDATE user_roles ur
SET is_active = false, updated_at = CURRENT_TIMESTAMP
WHERE ur.is_system_role = true
  AND ur.role_key IN ('sales', 'accountant', 'inventory_manager')
  AND ur.is_active = true
  AND business_has_enabled_module(ur.business_id, 'hr')
  AND NOT business_has_enabled_module(ur.business_id, 'billing')
  AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.role_id = ur.id
  );

COMMENT ON FUNCTION business_has_enabled_module IS 'True when business_modules or product_line includes the platform module';
COMMENT ON FUNCTION ensure_billing_default_roles_for_business IS 'Creates Sales, Accountant, Inventory Manager when billing module is enabled';
