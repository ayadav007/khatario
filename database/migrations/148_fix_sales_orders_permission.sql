-- Migration: Fix Sales Orders Permission
-- Issue: sales_sales_orders permission missing from role_permissions
-- This migration ensures all roles have the sales_sales_orders permission

-- Add sales_sales_orders permission to all existing roles
INSERT INTO role_permissions (
  id,
  role_id,
  module_key,
  can_view,
  can_add,
  can_edit,
  can_delete
)
SELECT 
  gen_random_uuid(),
  r.id,
  'sales_sales_orders',
  true,  -- can_view
  true,  -- can_add (create)
  true,  -- can_edit (update)
  true   -- can_delete
FROM roles r
WHERE NOT EXISTS (
  SELECT 1 
  FROM role_permissions rp 
  WHERE rp.role_id = r.id 
    AND rp.module_key = 'sales_sales_orders'
);

-- Verify the permission was added
DO $$
DECLARE
  perm_count integer;
BEGIN
  SELECT COUNT(*) INTO perm_count
  FROM role_permissions
  WHERE module_key = 'sales_sales_orders';
  
  RAISE NOTICE '✅ Added sales_sales_orders permission to % roles', perm_count;
END $$;
