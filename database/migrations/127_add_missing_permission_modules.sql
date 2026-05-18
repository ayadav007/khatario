-- Migration 127: Add Missing Permission Modules
-- Adds HR, WhatsApp, Payroll, Credit Notes, and other missing modules
-- that are used in authorization checks but missing from permission_modules
-- 
-- This migration works with BOTH permission systems:
-- - Old system (Migration 019): Only adds to permission_modules
-- - New system (Migration 059): Adds to permission_modules AND permissions table
--
-- The API endpoint /api/permissions will automatically detect which system to use

-- Check if new permissions table exists
DO $$
DECLARE
    has_new_system BOOLEAN;
    module_rec RECORD;
    perm_keys TEXT[] := ARRAY['create', 'read', 'update', 'delete', 'approve', 'export'];
    perm_names TEXT[] := ARRAY['Create', 'Read', 'Update', 'Delete', 'Approve', 'Export'];
    i INTEGER;
    journal_module_id UUID;
    invoice_module_id UUID;
    period_module_id UUID;
    report_module_id UUID;
    transfer_module_id UUID;
BEGIN
    -- Check if permissions table exists (new system from migration 059)
    SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'permissions'
    ) INTO has_new_system;

    -- Insert missing modules if they don't exist
    -- Note: 'employees' already exists in migration 059, so we're adding 'hr' as an alias for consistency
    INSERT INTO permission_modules (module_key, module_name, description, display_order) VALUES
-- HR & Employee Management
-- Note: 'employees' module already exists, 'hr' is an alias we use in some places
-- But since we use 'hr' in authorization calls, we'll add it
-- In practice, 'employees' and 'hr' can be treated as the same module
-- Note: 'employees' and 'attendance' already exist in migration 059
-- Adding 'hr' as an alias, and missing modules:
('hr', 'HR / Employees', 'Employee management and HR operations (same as Employees)', 20),
('payroll', 'Payroll', 'Salary, payslips, and payroll management', 21),
('leave_requests', 'Leave Requests', 'Employee leave requests and approvals', 22),
-- Note: Migration 059 has 'leaves' but we use 'leave_requests' in authorization

-- Financial
('credit_notes', 'Credit Notes', 'Sales returns and credit notes', 7),
('debit_notes', 'Debit Notes', 'Debit notes management', 8),
('journal', 'Journal Entries', 'Accounting journal entries', 26),
('accounting_period', 'Accounting Periods', 'Period locks and accounting periods', 27),

-- Communication
('whatsapp', 'WhatsApp', 'WhatsApp messaging and bot management', 28),

-- Inventory
('warehouse_transfer', 'Stock Transfers', 'Warehouse and stock transfers', 29),
('inventory_adjustment', 'Inventory Adjustments', 'Stock adjustments and corrections', 30),

-- Tools & Utilities  
('tools', 'Tools', 'Utility tools and system functions', 31),

-- Reports (specific sub-modules if needed)
-- Note: 'reports' already exists, but we use 'report' (singular) in some authorization calls
('report', 'Reports', 'General reports access (same as Reports)', 32),
('report.financial', 'Financial Reports', 'Financial statements and reports', 33),
('report.gst', 'GST Reports', 'GST filing and reports', 34),
('report.inventory', 'Inventory Reports', 'Stock and inventory reports', 35)
ON CONFLICT (module_key) DO NOTHING;

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

    -- Only create permissions if new system exists (migration 059 has run)
    IF has_new_system THEN
        -- Insert permissions for the new modules
        -- Note: This uses the same permission structure as migration 059
        -- Only process modules that were just inserted (or already exist)
            FOR module_rec IN 
                SELECT id, module_key FROM permission_modules 
                WHERE module_key IN (
                    'hr', 'payroll', 'leave_requests', 'credit_notes', 'debit_notes',
                    'journal', 'accounting_period', 'whatsapp', 'warehouse_transfer',
                    'inventory_adjustment', 'tools', 'report', 'report.financial',
                    'report.gst', 'report.inventory'
                )
            LOOP
                FOR i IN 1..array_length(perm_keys, 1) LOOP
                    INSERT INTO permissions (module_id, permission_key, permission_name)
                    VALUES (module_rec.id, perm_keys[i], perm_names[i])
                    ON CONFLICT (module_id, permission_key) DO NOTHING;
                END LOOP;
            END LOOP;

            -- Add additional permissions for specific modules that need them
            -- Get module IDs
            SELECT id INTO journal_module_id FROM permission_modules WHERE module_key = 'journal';
            SELECT id INTO invoice_module_id FROM permission_modules WHERE module_key = 'invoices';
            SELECT id INTO period_module_id FROM permission_modules WHERE module_key = 'accounting_period';
            SELECT id INTO report_module_id FROM permission_modules WHERE module_key = 'report';
            SELECT id INTO transfer_module_id FROM permission_modules WHERE module_key = 'warehouse_transfer';

            -- Add 'finalize', 'cancel', 'post', 'lock', 'unlock' permissions for journal entries
            IF journal_module_id IS NOT NULL THEN
                INSERT INTO permissions (module_id, permission_key, permission_name) VALUES
                (journal_module_id, 'post', 'Post'),
                (journal_module_id, 'lock', 'Lock'),
                (journal_module_id, 'unlock', 'Unlock')
                ON CONFLICT (module_id, permission_key) DO NOTHING;
            END IF;

            -- Add 'finalize', 'cancel' permissions for invoices
            IF invoice_module_id IS NOT NULL THEN
                INSERT INTO permissions (module_id, permission_key, permission_name) VALUES
                (invoice_module_id, 'finalize', 'Finalize'),
                (invoice_module_id, 'cancel', 'Cancel')
                ON CONFLICT (module_id, permission_key) DO NOTHING;
            END IF;

            -- Add 'lock', 'unlock' permissions for accounting periods
            IF period_module_id IS NOT NULL THEN
                INSERT INTO permissions (module_id, permission_key, permission_name) VALUES
                (period_module_id, 'lock', 'Lock Period'),
                (period_module_id, 'unlock', 'Unlock Period')
                ON CONFLICT (module_id, permission_key) DO NOTHING;
            END IF;

            -- Ensure report module has 'read' and 'export' permissions
            IF report_module_id IS NOT NULL THEN
                INSERT INTO permissions (module_id, permission_key, permission_name) VALUES
                (report_module_id, 'read', 'Read'),
                (report_module_id, 'export', 'Export')
                ON CONFLICT (module_id, permission_key) DO NOTHING;
            END IF;

            -- Add 'dispatch', 'receive', 'cancel' permissions for warehouse_transfer
            IF transfer_module_id IS NOT NULL THEN
                INSERT INTO permissions (module_id, permission_key, permission_name) VALUES
                (transfer_module_id, 'dispatch', 'Dispatch'),
                (transfer_module_id, 'receive', 'Receive'),
                (transfer_module_id, 'cancel', 'Cancel')
                ON CONFLICT (module_id, permission_key) DO NOTHING;
            END IF;
    END IF; -- End of IF has_new_system
END $$; -- End of outer DO block

COMMENT ON TABLE permission_modules IS 'System modules for permission management - Updated with HR, WhatsApp, and other modules';
