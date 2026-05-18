-- Migration 124: Add Inter-Branch Transaction Support
-- Adds columns and indexes for inter-branch transfers and invoices

-- Step 1: Add inter_branch_invoice_id to stock_transfers
ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS inter_branch_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL;

-- Step 2: Add branch_id to customers (for branch-as-customer)
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

-- Step 3: Add customer_type to customers (to distinguish branch customers)
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS customer_type VARCHAR(50) DEFAULT 'regular';

-- Step 4: Create index for branch customers
CREATE INDEX IF NOT EXISTS idx_customers_branch_id ON customers(business_id, branch_id) WHERE branch_id IS NOT NULL;

-- Step 5: Create index for inter-branch invoices
CREATE INDEX IF NOT EXISTS idx_stock_transfers_inter_branch_invoice ON stock_transfers(inter_branch_invoice_id) WHERE inter_branch_invoice_id IS NOT NULL;

-- Step 6: Add comment
COMMENT ON COLUMN stock_transfers.inter_branch_invoice_id IS 'Invoice generated for inter-branch transfer (when branches are different)';
COMMENT ON COLUMN customers.branch_id IS 'Link to branch if this customer represents a branch';
COMMENT ON COLUMN customers.customer_type IS 'Type of customer: regular, branch, etc.';
