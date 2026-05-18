-- Migration 135: Add auto_assign_branch_warehouses setting
-- Controls whether users automatically get warehouse access when assigned to a branch

-- Add auto_assign_branch_warehouses column to business_settings
ALTER TABLE business_settings 
ADD COLUMN IF NOT EXISTS auto_assign_branch_warehouses BOOLEAN DEFAULT true;

-- Add comment for documentation
COMMENT ON COLUMN business_settings.auto_assign_branch_warehouses IS 'If true, users with branch access automatically get warehouse access for warehouses linked to that branch. If false, warehouse access must be explicitly assigned.';

-- Set default to true for backward compatibility (existing behavior)
UPDATE business_settings
SET auto_assign_branch_warehouses = true
WHERE auto_assign_branch_warehouses IS NULL;
