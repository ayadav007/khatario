-- User Management System Migration
-- Implements role-based access control (RBAC) with granular permissions

-- Create roles table for predefined and custom roles
CREATE TABLE IF NOT EXISTS user_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    role_name VARCHAR(100) NOT NULL,
    role_key VARCHAR(50) NOT NULL, -- 'primary_admin', 'sales', 'accountant', 'inventory_manager', 'custom'
    description TEXT,
    is_system_role BOOLEAN DEFAULT false, -- System roles can't be deleted
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, role_key)
);

-- Create permission modules table (modules that can have permissions)
CREATE TABLE IF NOT EXISTS permission_modules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    module_key VARCHAR(50) NOT NULL UNIQUE, -- 'invoices', 'purchases', 'customers', etc.
    module_name VARCHAR(100) NOT NULL,
    description TEXT,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create role permissions table (junction table)
CREATE TABLE IF NOT EXISTS role_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role_id UUID REFERENCES user_roles(id) ON DELETE CASCADE,
    module_key VARCHAR(50) NOT NULL,
    can_view BOOLEAN DEFAULT false,
    can_add BOOLEAN DEFAULT false,
    can_modify BOOLEAN DEFAULT false,
    can_delete BOOLEAN DEFAULT false,
    can_share BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(role_id, module_key)
);

-- Update users table with new fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES user_roles(id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_primary_admin BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS allow_multidevice_sync BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMP;

-- Create user activity logs
CREATE TABLE IF NOT EXISTS user_activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    user_name VARCHAR(255), -- Store name in case user is deleted
    action VARCHAR(100) NOT NULL, -- 'create_invoice', 'edit_purchase', 'delete_customer', etc.
    module VARCHAR(50) NOT NULL, -- 'invoices', 'purchases', 'customers'
    entity_type VARCHAR(50), -- 'invoice', 'purchase', 'customer'
    entity_id UUID,
    details JSONB DEFAULT '{}',
    ip_address VARCHAR(50),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create business settings table
CREATE TABLE IF NOT EXISTS business_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE UNIQUE,
    user_management_enabled BOOLEAN DEFAULT false,
    require_password BOOLEAN DEFAULT true,
    session_timeout_minutes INTEGER DEFAULT 30,
    max_failed_login_attempts INTEGER DEFAULT 5,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_roles_business_id ON user_roles(business_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_users_business_id ON users(business_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_logs_business_id ON user_activity_logs(business_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_logs_user_id ON user_activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_logs_created_at ON user_activity_logs(created_at DESC);

-- Insert default permission modules
INSERT INTO permission_modules (module_key, module_name, description, display_order) VALUES
('dashboard', 'Dashboard', 'View dashboard and analytics', 1),
('invoices', 'Sales / Invoices', 'Manage sales invoices', 2),
('credit_notes', 'Credit Notes', 'Manage credit notes (sales returns)', 3),
('customers', 'Customers', 'Manage customer information', 4),
('purchases', 'Purchases', 'Manage purchase bills', 5),
('purchase_returns', 'Purchase Returns', 'Manage purchase returns', 6),
('suppliers', 'Suppliers', 'Manage supplier information', 7),
('items', 'Items & Inventory', 'Manage items and stock', 8),
('payments', 'Payments', 'Manage payments (in/out)', 9),
('reports', 'Reports', 'View and export reports', 10),
('settings', 'Settings', 'Access business settings', 11)
ON CONFLICT (module_key) DO NOTHING;

-- Function to create default roles for a business
CREATE OR REPLACE FUNCTION create_default_roles_for_business(p_business_id UUID)
RETURNS VOID AS $$
DECLARE
    v_primary_admin_role_id UUID;
    v_sales_role_id UUID;
    v_accountant_role_id UUID;
    v_inventory_role_id UUID;
BEGIN
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

END;
$$ LANGUAGE plpgsql;

-- Create default business settings for existing businesses
INSERT INTO business_settings (business_id, user_management_enabled)
SELECT id, false FROM businesses
ON CONFLICT (business_id) DO NOTHING;

-- Mark existing users as primary admins (they own the business)
UPDATE users SET is_primary_admin = true WHERE is_primary_admin IS NULL OR is_primary_admin = false;

-- Create default roles for all existing businesses
DO $$
DECLARE
    v_business_id UUID;
BEGIN
    FOR v_business_id IN SELECT id FROM businesses LOOP
        PERFORM create_default_roles_for_business(v_business_id);
    END LOOP;
END $$;

-- Assign Primary Admin role to existing users
UPDATE users u
SET role_id = (
    SELECT ur.id 
    FROM user_roles ur 
    WHERE ur.business_id = u.business_id 
    AND ur.role_key = 'primary_admin'
    LIMIT 1
)
WHERE u.is_primary_admin = true AND u.role_id IS NULL;

COMMENT ON TABLE user_roles IS 'Defines user roles within a business';
COMMENT ON TABLE permission_modules IS 'Defines available modules that can have permissions';
COMMENT ON TABLE role_permissions IS 'Stores permissions for each role per module';
COMMENT ON TABLE user_activity_logs IS 'Tracks all user actions for audit and accountability';
COMMENT ON TABLE business_settings IS 'Stores business-level configuration settings';

