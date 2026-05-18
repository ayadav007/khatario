-- Migration 127: Add Missing Permission Modules
-- Adds HR, WhatsApp, Payroll, Credit Notes, and other missing modules
-- that are used in authorization checks but missing from permission_modules

-- Insert missing modules if they don't exist
INSERT INTO permission_modules (module_key, module_name, description, display_order) VALUES
-- HR & Employee Management
('hr', 'HR / Employees', 'Employee management and HR operations', 20),
('payroll', 'Payroll', 'Salary, payslips, and payroll management', 21),
('leave_requests', 'Leave Requests', 'Employee leave requests and approvals', 22),

-- Financial
('credit_notes', 'Credit Notes', 'Sales returns and credit notes', 7),
('debit_notes', 'Debit Notes', 'Debit notes management', 8),
('journal', 'Journal Entries', 'Accounting journal entries', 23),
('accounting_period', 'Accounting Periods', 'Period locks and accounting periods', 24),

-- Communication
('whatsapp', 'WhatsApp', 'WhatsApp messaging and bot management', 25),

-- Inventory
('warehouse_transfer', 'Stock Transfers', 'Warehouse and stock transfers', 26),
('inventory_adjustment', 'Inventory Adjustments', 'Stock adjustments and corrections', 27),

-- Tools & Utilities
('tools', 'Tools', 'Utility tools and system functions', 28),

-- Reports (specific sub-modules if needed)
('report', 'Reports', 'General reports access', 29),
('report.financial', 'Financial Reports', 'Financial statements and reports', 30),
('report.gst', 'GST Reports', 'GST filing and reports', 31),
('report.inventory', 'Inventory Reports', 'Stock and inventory reports', 32)
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

-- Insert permissions for the new modules
-- Note: This uses the same permission structure as migration 059
DO $$
DECLARE
    module_rec RECORD;
    perm_keys TEXT[] := ARRAY['create', 'read', 'update', 'delete', 'approve', 'export'];
    perm_names TEXT[] := ARRAY['Create', 'Read', 'Update', 'Delete', 'Approve', 'Export'];
    i INTEGER;
BEGIN
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
END $$;

-- Add additional permissions for specific modules that need them
DO $$
DECLARE
    journal_module_id UUID;
    invoice_module_id UUID;
    period_module_id UUID;
    report_module_id UUID;
BEGIN
    -- Get module IDs
    SELECT id INTO journal_module_id FROM permission_modules WHERE module_key = 'journal';
    SELECT id INTO invoice_module_id FROM permission_modules WHERE module_key = 'invoices';
    SELECT id INTO period_module_id FROM permission_modules WHERE module_key = 'accounting_period';
    SELECT id INTO report_module_id FROM permission_modules WHERE module_key = 'report';

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
END $$;

COMMENT ON TABLE permission_modules IS 'System modules for permission management - Updated with HR, WhatsApp, and other modules';
