-- Migration 129: Add Warehouse Permissions
-- Adds dedicated warehouses module and permissions for granular warehouse control
-- This separates warehouse management from items/inventory module

-- Check if new permissions table exists
DO $$
DECLARE
    has_new_system BOOLEAN;
    warehouse_module_id UUID;
    perm_keys TEXT[] := ARRAY['create', 'read', 'update', 'delete'];
    perm_names TEXT[] := ARRAY['Create', 'Read', 'Update', 'Delete'];
    i INTEGER;
BEGIN
    -- Check if permissions table exists (new system from migration 059)
    SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'permissions'
    ) INTO has_new_system;

    -- Insert warehouses module if it doesn't exist
    INSERT INTO permission_modules (module_key, module_name, description, display_order) VALUES
    ('warehouses', 'Warehouses', 'Manage warehouses and warehouse access', 10)
    ON CONFLICT (module_key) DO UPDATE
    SET module_name = EXCLUDED.module_name,
        description = EXCLUDED.description,
        display_order = EXCLUDED.display_order;

    -- Get warehouse module ID
    SELECT id INTO warehouse_module_id FROM permission_modules WHERE module_key = 'warehouses';

    -- Only create permissions if new system exists (migration 059 has run)
    IF has_new_system AND warehouse_module_id IS NOT NULL THEN
        -- Insert permissions for warehouses module
        FOR i IN 1..array_length(perm_keys, 1) LOOP
            INSERT INTO permissions (module_id, permission_key, permission_name)
            VALUES (warehouse_module_id, perm_keys[i], perm_names[i])
            ON CONFLICT (module_id, permission_key) DO NOTHING;
        END LOOP;
    END IF;
END $$;

-- Update display_order for existing modules to maintain logical grouping
UPDATE permission_modules SET display_order = 1 WHERE module_key = 'dashboard';
UPDATE permission_modules SET display_order = 2 WHERE module_key = 'invoices';
UPDATE permission_modules SET display_order = 3 WHERE module_key = 'credit_notes';
UPDATE permission_modules SET display_order = 4 WHERE module_key = 'customers';
UPDATE permission_modules SET display_order = 5 WHERE module_key = 'purchases';
UPDATE permission_modules SET display_order = 6 WHERE module_key = 'suppliers';
UPDATE permission_modules SET display_order = 7 WHERE module_key = 'items';
UPDATE permission_modules SET display_order = 8 WHERE module_key = 'payments';
UPDATE permission_modules SET display_order = 9 WHERE module_key = 'expenses';
UPDATE permission_modules SET display_order = 10 WHERE module_key = 'warehouses';
UPDATE permission_modules SET display_order = 11 WHERE module_key = 'reports';
UPDATE permission_modules SET display_order = 12 WHERE module_key = 'settings';

COMMENT ON TABLE permission_modules IS 'System modules for permission management - Includes Warehouses module';
