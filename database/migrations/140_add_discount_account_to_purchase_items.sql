-- Migration 140: Add discount_account_id to purchase_items for line-item discount accounting
-- This enables associating discount amounts with specific chart of accounts
-- 
-- IMPORTANT: 
-- - Column is nullable to support legacy purchases
-- - When discount_account_id is set, discount amounts will be posted to that account
-- - Default behavior: if NULL, discount is just factored into purchase amount (current behavior)

-- Add discount_account_id column (references accounts)
ALTER TABLE purchase_items 
ADD COLUMN IF NOT EXISTS discount_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_purchase_items_discount_account ON purchase_items(discount_account_id);

-- Add comment
COMMENT ON COLUMN purchase_items.discount_account_id IS 'Account to which discount amount should be posted. NULL means discount is factored into purchase amount (legacy behavior). Typically "Discount Received" or similar income account.';
