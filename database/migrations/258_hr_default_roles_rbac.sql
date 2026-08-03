-- Migration 258: HR default roles, RBAC aliases backfill, payroll field permissions
-- Adds HR Admin, Team Lead, and Payroll Clerk system roles (mirrors billing Sales/Accountant pattern).

CREATE OR REPLACE FUNCTION ensure_hr_default_roles_for_business(p_business_id UUID)
RETURNS VOID AS $$
DECLARE
    v_hr_admin_role_id UUID;
    v_team_lead_role_id UUID;
    v_payroll_clerk_role_id UUID;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM user_roles WHERE business_id = p_business_id AND role_key = 'hr_admin'
    ) THEN
        INSERT INTO user_roles (business_id, role_name, role_key, description, is_system_role)
        VALUES (
            p_business_id,
            'HR Admin',
            'hr_admin',
            'Full access to employee records, attendance, leaves, and payroll',
            true
        )
        RETURNING id INTO v_hr_admin_role_id;

        INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
        VALUES
            (v_hr_admin_role_id, 'employees', true, true, true, true, true),
            (v_hr_admin_role_id, 'attendance', true, true, true, true, false),
            (v_hr_admin_role_id, 'leaves', true, true, true, false, false),
            (v_hr_admin_role_id, 'leave_requests', true, true, true, false, false),
            (v_hr_admin_role_id, 'payroll', true, true, true, false, false),
            (v_hr_admin_role_id, 'commissions', true, false, true, false, false);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM user_roles WHERE business_id = p_business_id AND role_key = 'team_lead'
    ) THEN
        INSERT INTO user_roles (business_id, role_name, role_key, description, is_system_role)
        VALUES (
            p_business_id,
            'Team Lead',
            'team_lead',
            'Manage direct reports: roll call, leave approvals, read team roster',
            true
        )
        RETURNING id INTO v_team_lead_role_id;

        INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
        VALUES
            (v_team_lead_role_id, 'employees', true, false, false, false, false),
            (v_team_lead_role_id, 'attendance', true, true, true, false, false),
            (v_team_lead_role_id, 'leaves', true, false, true, false, false),
            (v_team_lead_role_id, 'leave_requests', true, false, true, false, false),
            (v_team_lead_role_id, 'commissions', true, false, false, false, false);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM user_roles WHERE business_id = p_business_id AND role_key = 'payroll_clerk'
    ) THEN
        INSERT INTO user_roles (business_id, role_name, role_key, description, is_system_role)
        VALUES (
            p_business_id,
            'Payroll Clerk',
            'payroll_clerk',
            'Process payroll and view employee records (sensitive fields allowed)',
            true
        )
        RETURNING id INTO v_payroll_clerk_role_id;

        INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
        VALUES
            (v_payroll_clerk_role_id, 'employees', true, false, false, false, false),
            (v_payroll_clerk_role_id, 'attendance', true, false, false, false, false),
            (v_payroll_clerk_role_id, 'payroll', true, true, true, false, false);
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Extend signup default roles with HR presets
CREATE OR REPLACE FUNCTION create_default_roles_for_business(p_business_id UUID)
RETURNS VOID AS $$
DECLARE
    v_primary_admin_role_id UUID;
    v_sales_role_id UUID;
    v_accountant_role_id UUID;
    v_inventory_role_id UUID;
BEGIN
    INSERT INTO user_roles (business_id, role_name, role_key, description, is_system_role)
    VALUES (p_business_id, 'Primary Admin', 'primary_admin', 'Full access to all features', true)
    RETURNING id INTO v_primary_admin_role_id;

    INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
    SELECT v_primary_admin_role_id, module_key, true, true, true, true, true
    FROM permission_modules WHERE is_active = true;

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

    PERFORM ensure_hr_default_roles_for_business(p_business_id);
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION create_default_roles_for_business_if_missing(p_business_id UUID)
RETURNS VOID AS $$
DECLARE
    v_primary_admin_role_id UUID;
    v_sales_role_id UUID;
    v_accountant_role_id UUID;
    v_inventory_role_id UUID;
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

    PERFORM ensure_hr_default_roles_for_business(p_business_id);
END;
$$ LANGUAGE plpgsql;

-- Backfill HR roles for all existing businesses
DO $$
DECLARE
    v_business_id UUID;
BEGIN
    FOR v_business_id IN SELECT id FROM businesses LOOP
        PERFORM ensure_hr_default_roles_for_business(v_business_id);
    END LOOP;
END $$;

-- HR Admin + Payroll Clerk may view/edit salary and bank fields
INSERT INTO field_permissions (role_id, module_key, field_name, can_view, can_edit)
SELECT ur.id, m.module_key, m.field_name, m.can_view, m.can_edit
FROM user_roles ur
CROSS JOIN (VALUES
    ('employees', 'salary', true, true),
    ('employees', 'bank_account_number', true, true),
    ('employees', 'bank_ifsc', true, true),
    ('employees', 'bank_name', true, true),
    ('employees', 'pan_number', true, true),
    ('employees', 'aadhaar_number', true, false)
) AS m(module_key, field_name, can_view, can_edit)
WHERE ur.role_key IN ('hr_admin', 'payroll_clerk')
ON CONFLICT DO NOTHING;

-- Team Lead: hide sensitive compensation fields (same baseline as Sales/Accountant)
INSERT INTO field_permissions (role_id, module_key, field_name, can_view, can_edit)
SELECT ur.id, m.module_key, m.field_name, m.can_view, m.can_edit
FROM user_roles ur
CROSS JOIN (VALUES
    ('employees', 'salary', false, false),
    ('employees', 'bank_account_number', false, false),
    ('employees', 'bank_ifsc', false, false),
    ('employees', 'bank_name', false, false),
    ('employees', 'pan_number', false, false),
    ('employees', 'aadhaar_number', false, false)
) AS m(module_key, field_name, can_view, can_edit)
WHERE ur.role_key = 'team_lead'
ON CONFLICT DO NOTHING;

COMMENT ON FUNCTION ensure_hr_default_roles_for_business IS 'Creates HR Admin, Team Lead, and Payroll Clerk roles if missing for a business';
