-- Migration 071: Account Mapping Configuration
-- Adds account mapping settings to business_settings for configurable account assignments

-- Add account_mappings JSONB column to business_settings if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'business_settings' AND column_name = 'account_mappings'
    ) THEN
        ALTER TABLE business_settings 
        ADD COLUMN account_mappings JSONB DEFAULT '{}';
        
        COMMENT ON COLUMN business_settings.account_mappings IS 'Stores account ID mappings for transactions (sales, purchases, expenses, etc.)';
    END IF;
END $$;

-- Default account mapping structure:
-- {
--   "sales_account_id": "uuid",
--   "accounts_receivable_account_id": "uuid",
--   "cash_account_id": "uuid",
--   "bank_account_id": "uuid",
--   "purchases_account_id": "uuid",
--   "accounts_payable_account_id": "uuid",
--   "inventory_account_id": "uuid",
--   "cogs_account_id": "uuid",
--   "expense_account_id": "uuid",
--   "payment_modes": {
--     "cash": "uuid",
--     "bank": "uuid",
--     "upi": "uuid",
--     "credit_card": "uuid"
--   }
-- }

