-- Migration 130: Update Default Roles with Warehouse Permissions
-- Adds warehouse permissions to existing default roles
-- This ensures all businesses with default roles get warehouse permissions

-- Update Primary Admin role: Grant all warehouse permissions
INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
SELECT ur.id, 'warehouses', true, true, true, true, true
FROM user_roles ur
WHERE ur.role_key = 'primary_admin'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp 
    WHERE rp.role_id = ur.id AND rp.module_key = 'warehouses'
  );

-- Update Inventory Manager role: Grant full warehouse permissions
INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
SELECT ur.id, 'warehouses', true, true, true, true, false
FROM user_roles ur
WHERE ur.role_key = 'inventory_manager'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp 
    WHERE rp.role_id = ur.id AND rp.module_key = 'warehouses'
  );

-- Update Sales role: Grant view-only warehouse permissions (for viewing stock)
INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
SELECT ur.id, 'warehouses', true, false, false, false, false
FROM user_roles ur
WHERE ur.role_key = 'sales'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp 
    WHERE rp.role_id = ur.id AND rp.module_key = 'warehouses'
  );

-- Update Accountant role: Grant view-only warehouse permissions
INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
SELECT ur.id, 'warehouses', true, false, false, false, false
FROM user_roles ur
WHERE ur.role_key = 'accountant'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp 
    WHERE rp.role_id = ur.id AND rp.module_key = 'warehouses'
  );

COMMENT ON TABLE role_permissions IS 'Role permissions - Updated with warehouse permissions for default roles';
