-- Migration 134: Add Warehouse Transfer RBAC Permissions
-- Adds dedicated warehouse_transfer permissions (view, create, approve, dispatch, receive, cancel)
-- Replaces generic items.* permissions with transfer-specific permissions

-- Check if new permissions table exists
DO $$
DECLARE
    has_new_system BOOLEAN;
    transfer_module_id UUID;
    perm_keys TEXT[] := ARRAY['view', 'create', 'approve', 'dispatch', 'receive', 'cancel'];
    perm_names TEXT[] := ARRAY['View', 'Create', 'Approve', 'Dispatch', 'Receive', 'Cancel'];
    i INTEGER;
BEGIN
    -- Check if permissions table exists (new system from migration 059)
    SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'permissions'
    ) INTO has_new_system;

    -- Get warehouse_transfer module ID
    SELECT id INTO transfer_module_id FROM permission_modules WHERE module_key = 'warehouse_transfer';

    -- Only create permissions if new system exists and module exists
    IF has_new_system AND transfer_module_id IS NOT NULL THEN
        -- Insert permissions for warehouse_transfer module
        FOR i IN 1..array_length(perm_keys, 1) LOOP
            INSERT INTO permissions (module_id, permission_key, permission_name)
            VALUES (transfer_module_id, perm_keys[i], perm_names[i])
            ON CONFLICT (module_id, permission_key) DO NOTHING;
        END LOOP;
    END IF;
END $$;

-- For old system (role_permissions table), add warehouse_transfer module permissions
-- Update Primary Admin role: Grant all warehouse_transfer permissions
INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
SELECT ur.id, 'warehouse_transfer', true, true, true, true, true
FROM user_roles ur
WHERE ur.role_key = 'primary_admin'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp 
    WHERE rp.role_id = ur.id AND rp.module_key = 'warehouse_transfer'
  );

-- Update Inventory Manager role: Grant full warehouse_transfer permissions
INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
SELECT ur.id, 'warehouse_transfer', true, true, true, true, false
FROM user_roles ur
WHERE ur.role_key = 'inventory_manager'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp 
    WHERE rp.role_id = ur.id AND rp.module_key = 'warehouse_transfer'
  );

-- Update Sales role: Grant view-only warehouse_transfer permissions
INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
SELECT ur.id, 'warehouse_transfer', true, false, false, false, false
FROM user_roles ur
WHERE ur.role_key = 'sales'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp 
    WHERE rp.role_id = ur.id AND rp.module_key = 'warehouse_transfer'
  );

-- Update Accountant role: Grant view-only warehouse_transfer permissions
INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
SELECT ur.id, 'warehouse_transfer', true, false, false, false, false
FROM user_roles ur
WHERE ur.role_key = 'accountant'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp 
    WHERE rp.role_id = ur.id AND rp.module_key = 'warehouse_transfer'
  );

COMMENT ON TABLE permission_modules IS 'System modules for permission management - Includes warehouse_transfer with dedicated permissions';
