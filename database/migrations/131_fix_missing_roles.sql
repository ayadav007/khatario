-- Migration 131: Fix Missing Roles for Existing Businesses
-- Creates default roles for businesses that don't have any roles
-- This fixes the issue where only Primary Admin is visible in the Roles screen

-- Function to create default roles for a business (if they don't exist)
CREATE OR REPLACE FUNCTION create_default_roles_for_business_if_missing(p_business_id UUID)
RETURNS VOID AS $$
DECLARE
    v_primary_admin_role_id UUID;
    v_sales_role_id UUID;
    v_accountant_role_id UUID;
    v_inventory_role_id UUID;
    v_role_count INTEGER;
BEGIN
    -- Check if roles already exist
    SELECT COUNT(*) INTO v_role_count
    FROM user_roles
    WHERE business_id = p_business_id;

    -- Only create roles if none exist
    IF v_role_count = 0 THEN
        -- Create Primary Admin role
        INSERT INTO user_roles (business_id, role_name, role_key, description, is_system_role)
        VALUES (p_business_id, 'Primary Admin', 'primary_admin', 'Full access to all features', true)
        RETURNING id INTO v_primary_admin_role_id;

        -- Set all permissions for Primary Admin
        INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
        SELECT v_primary_admin_role_id, module_key, true, true, true, true, true
        FROM permission_modules WHERE is_active = true;

        -- Create Sales role
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
            (v_sales_role_id, 'payments', true, true, false, false, false);

        -- Create Accountant role
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
            (v_accountant_role_id, 'reports', true, false, false, false, true);

        -- Create Inventory Manager role
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
            (v_inventory_role_id, 'reports', true, false, false, false, false);
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Create default roles for all businesses that don't have any roles
DO $$
DECLARE
    v_business_id UUID;
BEGIN
    FOR v_business_id IN 
        SELECT id FROM businesses 
        WHERE id NOT IN (SELECT DISTINCT business_id FROM user_roles WHERE business_id IS NOT NULL)
    LOOP
        PERFORM create_default_roles_for_business_if_missing(v_business_id);
    END LOOP;
END $$;

-- Assign Primary Admin role to existing primary admin users who don't have a role
UPDATE users u
SET role_id = (
    SELECT ur.id 
    FROM user_roles ur 
    WHERE ur.business_id = u.business_id 
    AND ur.role_key = 'primary_admin'
    LIMIT 1
)
WHERE u.is_primary_admin = true 
  AND u.role_id IS NULL;

COMMENT ON FUNCTION create_default_roles_for_business_if_missing IS 'Creates default roles for a business only if they don''t already exist';
