-- Migration 132: Fix Missing Default Roles for Existing Businesses
-- Creates missing default roles for businesses that have Primary Admin but are missing other roles
-- This fixes the issue where signup only creates Primary Admin, leaving Sales, Accountant, and Inventory Manager missing

-- Function to create missing default roles for a business
CREATE OR REPLACE FUNCTION create_missing_default_roles_for_business(p_business_id UUID)
RETURNS VOID AS $$
DECLARE
    v_primary_admin_role_id UUID;
    v_sales_role_id UUID;
    v_accountant_role_id UUID;
    v_inventory_role_id UUID;
    v_role_exists BOOLEAN;
BEGIN
    -- Check and create Primary Admin role if missing
    SELECT id INTO v_primary_admin_role_id
    FROM user_roles
    WHERE business_id = p_business_id AND role_key = 'primary_admin'
    LIMIT 1;

    IF v_primary_admin_role_id IS NULL THEN
        INSERT INTO user_roles (business_id, role_name, role_key, description, is_system_role)
        VALUES (p_business_id, 'Primary Admin', 'primary_admin', 'Full access to all features', true)
        RETURNING id INTO v_primary_admin_role_id;

        -- Set all permissions for Primary Admin
        INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
        SELECT v_primary_admin_role_id, module_key, true, true, true, true, true
        FROM permission_modules WHERE is_active = true
        ON CONFLICT (role_id, module_key) DO NOTHING;
    ELSE
        -- Update Primary Admin permissions to include any new modules (like warehouses)
        INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
        SELECT v_primary_admin_role_id, module_key, true, true, true, true, true
        FROM permission_modules WHERE is_active = true
        ON CONFLICT (role_id, module_key) DO UPDATE
        SET can_view = true, can_add = true, can_modify = true, can_delete = true, can_share = true;
    END IF;

    -- Check and create Sales role if missing
    SELECT id INTO v_sales_role_id
    FROM user_roles
    WHERE business_id = p_business_id AND role_key = 'sales'
    LIMIT 1;

    IF v_sales_role_id IS NULL THEN
        INSERT INTO user_roles (business_id, role_name, role_key, description, is_system_role)
        VALUES (p_business_id, 'Sales', 'sales', 'Create and manage sales invoices', true)
        RETURNING id INTO v_sales_role_id;

        -- Set permissions for Sales role
        INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
        VALUES
            (v_sales_role_id, 'dashboard', true, false, false, false, false),
            (v_sales_role_id, 'invoices', true, true, true, false, true),
            (v_sales_role_id, 'credit_notes', true, true, false, false, false),
            (v_sales_role_id, 'customers', true, true, true, false, false),
            (v_sales_role_id, 'items', true, false, false, false, false),
            (v_sales_role_id, 'warehouses', true, false, false, false, false), -- View-only for stock
            (v_sales_role_id, 'payments', true, true, false, false, false)
        ON CONFLICT (role_id, module_key) DO NOTHING;
    END IF;

    -- Check and create Accountant role if missing
    SELECT id INTO v_accountant_role_id
    FROM user_roles
    WHERE business_id = p_business_id AND role_key = 'accountant'
    LIMIT 1;

    IF v_accountant_role_id IS NULL THEN
        INSERT INTO user_roles (business_id, role_name, role_key, description, is_system_role)
        VALUES (p_business_id, 'Accountant', 'accountant', 'Manage finances and payments', true)
        RETURNING id INTO v_accountant_role_id;

        -- Set permissions for Accountant role
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
            (v_accountant_role_id, 'warehouses', true, false, false, false, false), -- View-only
            (v_accountant_role_id, 'reports', true, false, false, false, true)
        ON CONFLICT (role_id, module_key) DO NOTHING;
    END IF;

    -- Check and create Inventory Manager role if missing
    SELECT id INTO v_inventory_role_id
    FROM user_roles
    WHERE business_id = p_business_id AND role_key = 'inventory_manager'
    LIMIT 1;

    IF v_inventory_role_id IS NULL THEN
        INSERT INTO user_roles (business_id, role_name, role_key, description, is_system_role)
        VALUES (p_business_id, 'Inventory Manager', 'inventory_manager', 'Manage inventory and purchases', true)
        RETURNING id INTO v_inventory_role_id;

        -- Set permissions for Inventory Manager role
        INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
        VALUES
            (v_inventory_role_id, 'dashboard', true, false, false, false, false),
            (v_inventory_role_id, 'purchases', true, true, true, false, false),
            (v_inventory_role_id, 'purchase_returns', true, true, true, false, false),
            (v_inventory_role_id, 'suppliers', true, true, true, false, false),
            (v_inventory_role_id, 'items', true, true, true, true, false),
            (v_inventory_role_id, 'warehouses', true, true, true, true, false), -- Full warehouse access
            (v_inventory_role_id, 'reports', true, false, false, false, false)
        ON CONFLICT (role_id, module_key) DO NOTHING;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Create missing default roles for ALL businesses
DO $$
DECLARE
    v_business_id UUID;
BEGIN
    FOR v_business_id IN SELECT id FROM businesses LOOP
        PERFORM create_missing_default_roles_for_business(v_business_id);
    END LOOP;
END $$;

-- Update existing roles to include warehouse permissions if they don't have them
-- This ensures roles created before migration 129 have warehouse permissions

-- Update Sales role: Add warehouse view permission if missing
INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
SELECT ur.id, 'warehouses', true, false, false, false, false
FROM user_roles ur
WHERE ur.role_key = 'sales'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp 
    WHERE rp.role_id = ur.id AND rp.module_key = 'warehouses'
  );

-- Update Accountant role: Add warehouse view permission if missing
INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
SELECT ur.id, 'warehouses', true, false, false, false, false
FROM user_roles ur
WHERE ur.role_key = 'accountant'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp 
    WHERE rp.role_id = ur.id AND rp.module_key = 'warehouses'
  );

-- Update Inventory Manager role: Add full warehouse permissions if missing
INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
SELECT ur.id, 'warehouses', true, true, true, true, false
FROM user_roles ur
WHERE ur.role_key = 'inventory_manager'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp 
    WHERE rp.role_id = ur.id AND rp.module_key = 'warehouses'
  );

COMMENT ON FUNCTION create_missing_default_roles_for_business IS 'Creates missing default roles for a business, checking each role individually';
