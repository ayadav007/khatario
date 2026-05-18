-- Migration: Add company_name field to customers table
-- Purpose: Allow customers to have a company name separate from their personal/contact name

-- Add company_name column to customers table
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS company_name VARCHAR(255);

-- Add comment for documentation
COMMENT ON COLUMN customers.company_name IS 'Company name for business customers (optional, separate from contact name)';

