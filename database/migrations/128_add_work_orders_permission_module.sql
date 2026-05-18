-- Migration 128: Add Work Orders Permission Module
-- Adds work_orders module to permission_modules and permissions tables
-- Work orders need separate permission controls for create, read, update, delete

-- Check if new permissions table exists
DO $$
DECLARE
    has_new_system BOOLEAN;
    module_rec RECORD;
    perm_keys TEXT[] := ARRAY['create', 'read', 'update', 'delete', 'export'];
    perm_names TEXT[] := ARRAY['Create', 'Read', 'Update', 'Delete', 'Export'];
    i INTEGER;
    work_order_module_id UUID;
BEGIN
    -- Check if permissions table exists (new system from migration 059)
    SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'permissions'
    ) INTO has_new_system;

    -- Insert work_orders module if it doesn't exist
    INSERT INTO permission_modules (module_key, module_name, description, display_order) VALUES
    ('work_orders', 'Work Orders', 'Service and job work order management', 9)
    ON CONFLICT (module_key) DO NOTHING;

    -- Only create permissions if new system exists (migration 059 has run)
    IF has_new_system THEN
        -- Get work_orders module ID
        SELECT id INTO work_order_module_id FROM permission_modules WHERE module_key = 'work_orders';
        
        -- Insert standard permissions for work_orders module
        IF work_order_module_id IS NOT NULL THEN
            FOR i IN 1..array_length(perm_keys, 1) LOOP
                INSERT INTO permissions (module_id, permission_key, permission_name)
                VALUES (work_order_module_id, perm_keys[i], perm_names[i])
                ON CONFLICT (module_id, permission_key) DO NOTHING;
            END LOOP;
        END IF;
    END IF;
END $$;

COMMENT ON TABLE permission_modules IS 'System modules for permission management - Includes Work Orders module';
