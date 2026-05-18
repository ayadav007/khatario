-- Migration: Fix Payment Constraint to Allow Cash Sales
-- Purpose: Update check_payment_party constraint to allow both customer_id and supplier_id to be NULL
--          for cash sale invoices (where customer_id is NULL)

-- Drop the old constraint
ALTER TABLE payments DROP CONSTRAINT IF EXISTS check_payment_party;

-- Add new constraint that allows both NULL for cash sales (when reference_type = 'invoice')
-- This allows:
-- 1. customer_id NOT NULL, supplier_id NULL (normal customer payment)
-- 2. customer_id NULL, supplier_id NOT NULL (supplier payment)  
-- 3. customer_id NULL, supplier_id NULL (cash sale invoice payment)
ALTER TABLE payments ADD CONSTRAINT check_payment_party CHECK (
    (customer_id IS NOT NULL AND supplier_id IS NULL) OR 
    (customer_id IS NULL AND supplier_id IS NOT NULL) OR
    (customer_id IS NULL AND supplier_id IS NULL)
);

COMMENT ON CONSTRAINT check_payment_party ON payments IS 'Allows customer_id OR supplier_id OR both NULL (for cash sales)';

