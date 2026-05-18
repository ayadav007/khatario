-- Migration: Add payment methods support for businesses
-- Purpose: Store UPI IDs and other payment methods for WhatsApp payment links

-- Payment Methods table: Store multiple payment methods per business
CREATE TABLE IF NOT EXISTS payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    method_type VARCHAR(50) NOT NULL, -- 'upi', 'bank_transfer', 'wallet', 'card', 'other'
    method_name VARCHAR(255) NOT NULL, -- Display name, e.g., "UPI ID 1", "Google Pay", "PhonePe"
    upi_id VARCHAR(100), -- For UPI method_type
    bank_account_id UUID REFERENCES bank_accounts(id) ON DELETE SET NULL, -- For bank_transfer
    wallet_provider VARCHAR(50), -- 'gpay', 'phonepe', 'paytm', etc.
    account_details JSONB DEFAULT '{}'::jsonb, -- Flexible storage for other payment methods
    is_active BOOLEAN DEFAULT true,
    is_default BOOLEAN DEFAULT false, -- Only one default per business
    priority INTEGER DEFAULT 0, -- Display order (lower = higher priority)
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT valid_method_type CHECK (method_type IN ('upi', 'bank_transfer', 'wallet', 'card', 'other')),
    CONSTRAINT valid_upi_id CHECK (
        method_type != 'upi' OR (upi_id IS NOT NULL AND upi_id ~ '^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$')
    )
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_payment_methods_business_id ON payment_methods(business_id);
CREATE INDEX IF NOT EXISTS idx_payment_methods_active ON payment_methods(business_id, is_active) WHERE is_active = true;

-- Ensure only one default per business
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_methods_one_default 
    ON payment_methods(business_id) 
    WHERE is_default = true AND is_active = true;

-- Comments
COMMENT ON TABLE payment_methods IS 'Payment methods (UPI, bank transfer, etc.) for businesses to receive payments via WhatsApp';
COMMENT ON COLUMN payment_methods.upi_id IS 'UPI ID in format: username@paytm, username@ybl, etc.';
COMMENT ON COLUMN payment_methods.is_default IS 'Default payment method to use when sending payment links';
