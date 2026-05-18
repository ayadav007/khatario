-- Migration 059: Role-Based Access Control (RBAC)
-- Handles module-level and field-level permissions

-- Permission modules (predefined system modules)
CREATE TABLE IF NOT EXISTS permission_modules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    module_key VARCHAR(50) NOT NULL UNIQUE, -- 'invoices', 'items', 'customers', 'employees', etc.
    module_name VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Permissions (actions within modules)
CREATE TABLE IF NOT EXISTS permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    module_id UUID REFERENCES permission_modules(id) ON DELETE CASCADE,
    permission_key VARCHAR(50) NOT NULL, -- 'create', 'read', 'update', 'delete', 'approve', etc.
    permission_name VARCHAR(100) NOT NULL,
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(module_id, permission_key)
);

-- Role permissions (assign permissions to roles)
CREATE TABLE IF NOT EXISTS role_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role_id UUID REFERENCES user_roles(id) ON DELETE CASCADE,
    permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
    granted BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(role_id, permission_id)
);

-- Field-level permissions (for sensitive fields)
CREATE TABLE IF NOT EXISTS field_permissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    role_id UUID REFERENCES user_roles(id) ON DELETE CASCADE,
    module_key VARCHAR(50) NOT NULL,
    field_name VARCHAR(100) NOT NULL,
    can_view BOOLEAN DEFAULT true,
    can_edit BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(role_id, module_key, field_name)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_permissions_module ON permissions(module_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission_id);
CREATE INDEX IF NOT EXISTS idx_field_permissions_role ON field_permissions(role_id, module_key);

-- Insert default modules
INSERT INTO permission_modules (module_key, module_name, description) VALUES
('invoices', 'Invoices', 'Invoice creation, viewing, and management'),
('items', 'Items', 'Product/item management'),
('customers', 'Customers', 'Customer management'),
('employees', 'Employees', 'Employee management'),
('attendance', 'Attendance', 'Attendance tracking and management'),
('commissions', 'Commissions', 'Commission and performance management'),
('leaves', 'Leaves', 'Leave management'),
('expenses', 'Expenses', 'Expense management'),
('reports', 'Reports', 'Reports and analytics'),
('settings', 'Settings', 'System settings'),
('purchases', 'Purchases', 'Purchase order management'),
('warehouses', 'Warehouses', 'Warehouse and inventory management')
ON CONFLICT (module_key) DO NOTHING;

-- Insert default permissions for each module
DO $$
DECLARE
    module_rec RECORD;
    perm_keys TEXT[] := ARRAY['create', 'read', 'update', 'delete', 'approve', 'export'];
    perm_names TEXT[] := ARRAY['Create', 'Read', 'Update', 'Delete', 'Approve', 'Export'];
    i INTEGER;
BEGIN
    FOR module_rec IN SELECT id, module_key FROM permission_modules LOOP
        FOR i IN 1..array_length(perm_keys, 1) LOOP
            INSERT INTO permissions (module_id, permission_key, permission_name)
            VALUES (module_rec.id, perm_keys[i], perm_names[i])
            ON CONFLICT (module_id, permission_key) DO NOTHING;
        END LOOP;
    END LOOP;
END $$;

COMMENT ON TABLE permission_modules IS 'System modules for permission management';
COMMENT ON TABLE permissions IS 'Individual permissions within modules';
COMMENT ON TABLE role_permissions IS 'Permissions assigned to roles';
COMMENT ON TABLE field_permissions IS 'Field-level access control for sensitive data';

