-- Phase 3: Create advance_payments table
-- This enables reporting of advances received/paid in GSTR-1 Table 11 and GSTR-2 Table 3

CREATE TABLE IF NOT EXISTS advance_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('received', 'paid')),
    amount DECIMAL(12,2) NOT NULL,
    cgst DECIMAL(12,2) DEFAULT 0,
    sgst DECIMAL(12,2) DEFAULT 0,
    igst DECIMAL(12,2) DEFAULT 0,
    tax_rate DECIMAL(5,2) DEFAULT 18.00,  -- Default GST rate for advance
    payment_date DATE NOT NULL,
    adjusted_invoice_id UUID,  -- NULL until adjusted
    adjusted_purchase_id UUID,  -- NULL until adjusted
    is_adjusted BOOLEAN DEFAULT false,
    adjustment_date DATE,
    place_of_supply_state_code VARCHAR(2),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    -- Ensure payment is linked to exactly one party type
    CONSTRAINT check_advance_payment_party CHECK (
        (customer_id IS NOT NULL AND supplier_id IS NULL) OR 
        (customer_id IS NULL AND supplier_id IS NOT NULL)
    ),
    -- Ensure adjustment is linked to correct type
    CONSTRAINT check_advance_adjustment CHECK (
        (type = 'received' AND adjusted_invoice_id IS NOT NULL AND adjusted_purchase_id IS NULL) OR
        (type = 'paid' AND adjusted_purchase_id IS NOT NULL AND adjusted_invoice_id IS NULL) OR
        (is_adjusted = false)
    )
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_advance_payments_business_id ON advance_payments(business_id);
CREATE INDEX IF NOT EXISTS idx_advance_payments_customer_id ON advance_payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_advance_payments_supplier_id ON advance_payments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_advance_payments_type ON advance_payments(type);
CREATE INDEX IF NOT EXISTS idx_advance_payments_is_adjusted ON advance_payments(is_adjusted);
CREATE INDEX IF NOT EXISTS idx_advance_payments_date ON advance_payments(payment_date);

-- Add update trigger
CREATE TRIGGER update_advance_payments_updated_at BEFORE UPDATE ON advance_payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add comments
COMMENT ON TABLE advance_payments IS 'Tracks advance payments/receipts before invoice/purchase creation';
COMMENT ON COLUMN advance_payments.type IS 'Type: received (for sales) or paid (for purchases)';
COMMENT ON COLUMN advance_payments.adjusted_invoice_id IS 'Invoice ID to which this advance was adjusted';
COMMENT ON COLUMN advance_payments.adjusted_purchase_id IS 'Purchase ID to which this advance was adjusted';
COMMENT ON COLUMN advance_payments.is_adjusted IS 'Whether this advance has been adjusted against an invoice/purchase';

