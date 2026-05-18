-- Critical Schema Fixes Based on Review
-- Run this after initial schema.sql migration

-- ============================================
-- 1. FIX: Invoice Number Uniqueness (CRITICAL)
-- ============================================
-- Invoice numbers should be unique per business, not globally

-- Drop existing global unique constraint if it exists
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_invoice_number_key;

-- Create composite unique index (business_id + invoice_number)
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_business_invoice_number
ON invoices(business_id, invoice_number);

-- ============================================
-- 2. FIX: Missing updated_at Triggers
-- ============================================
-- Add triggers for tables that have updated_at but no trigger

CREATE TRIGGER update_suppliers_updated_at BEFORE UPDATE ON suppliers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_whatsapp_config_updated_at BEFORE UPDATE ON whatsapp_config
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_invoice_template_settings_updated_at BEFORE UPDATE ON invoice_template_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_whatsapp_reminder_settings_updated_at BEFORE UPDATE ON whatsapp_reminder_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 3. FIX: WhatsApp Config - One Per Business
-- ============================================
-- Ensure only one WhatsApp config per business

ALTER TABLE whatsapp_config
    DROP CONSTRAINT IF EXISTS unique_whatsapp_per_business,
    ADD CONSTRAINT unique_whatsapp_per_business UNIQUE (business_id);

-- ============================================
-- 4. FIX: Template Settings - One Default Per Business
-- ============================================
-- Ensure only one default template per business

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_template_settings_default
ON invoice_template_settings(business_id)
WHERE is_default = true;

-- ============================================
-- 5. ADD: Missing Indexes for Performance
-- ============================================

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_business_id 
ON whatsapp_messages(business_id);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_to_number
ON whatsapp_messages(to_number);

-- ============================================
-- 6. IMPROVEMENT: GST Fields for Indian GST
-- ============================================

-- Add state code to businesses (for GST calculations)
ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS state_code VARCHAR(2);

-- Add place of supply to invoices (for IGST vs CGST+SGST)
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS place_of_supply_state_code VARCHAR(2),
    ADD COLUMN IF NOT EXISTS is_reverse_charge BOOLEAN DEFAULT false;

-- ============================================
-- 7. IMPROVEMENT: Opening Balance Type
-- ============================================

-- Add opening_balance_type to customers
ALTER TABLE customers
    ADD COLUMN IF NOT EXISTS opening_balance_type VARCHAR(10) DEFAULT 'debit' CHECK (opening_balance_type IN ('debit', 'credit'));

-- Add opening_balance_type to suppliers
ALTER TABLE suppliers
    ADD COLUMN IF NOT EXISTS opening_balance_type VARCHAR(10) DEFAULT 'credit' CHECK (opening_balance_type IN ('debit', 'credit'));

-- ============================================
-- 8. IMPROVEMENT: Expense Categories Table
-- ============================================

-- Create expense_categories table
CREATE TABLE IF NOT EXISTS expense_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, name)
);

-- Add category_id to expenses (if expense table exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'expenses') THEN
        -- Add category_id column if it doesn't exist
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'expenses' AND column_name = 'category_id') THEN
            ALTER TABLE expenses ADD COLUMN category_id UUID REFERENCES expense_categories(id) ON DELETE SET NULL;
            
            -- Keep old category column for now (can be dropped later after data migration)
            -- ALTER TABLE expenses DROP COLUMN IF EXISTS category;
        END IF;
    END IF;
END $$;

-- Add trigger for expense_categories updated_at
CREATE TRIGGER update_expense_categories_updated_at BEFORE UPDATE ON expense_categories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Index for expense_categories
CREATE INDEX IF NOT EXISTS idx_expense_categories_business_id 
ON expense_categories(business_id);

-- ============================================
-- 9. IMPROVEMENT: Better Payment Structure
-- ============================================
-- Add explicit customer_id and supplier_id columns for better referential integrity

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'payments') THEN
        -- Add customer_id column if it doesn't exist
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                       WHERE table_name = 'payments' AND column_name = 'customer_id') THEN
            ALTER TABLE payments 
                ADD COLUMN customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
                ADD COLUMN supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;
        END IF;
    END IF;
END $$;

-- ============================================
-- 10. IMPROVEMENT: Additional Useful Indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_date ON invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_payments_business_id ON payments(business_id);
CREATE INDEX IF NOT EXISTS idx_payments_party_type_id ON payments(party_type, party_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_item_id ON stock_movements(item_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_business_id ON stock_movements(business_id);

-- ============================================
-- SUMMARY
-- ============================================
-- This script fixes:
-- ✅ Invoice number uniqueness per business
-- ✅ Missing updated_at triggers
-- ✅ WhatsApp config uniqueness
-- ✅ Template default uniqueness
-- ✅ Missing indexes
-- ✅ GST-specific fields
-- ✅ Opening balance types
-- ✅ Expense categories structure
-- ✅ Better payment structure

