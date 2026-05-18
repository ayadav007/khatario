-- Migration 070: Multi-Currency Support
-- Creates tables for currency management and exchange rates

-- Currencies
CREATE TABLE IF NOT EXISTS currencies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    currency_code VARCHAR(3) NOT NULL, -- 'USD', 'EUR', 'GBP', etc.
    currency_name VARCHAR(100) NOT NULL,
    symbol VARCHAR(10) NOT NULL, -- '$', '€', '£', etc.
    is_base_currency BOOLEAN DEFAULT false, -- Base currency for the business
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, currency_code)
);

-- Exchange Rates (Historical exchange rates)
CREATE TABLE IF NOT EXISTS exchange_rates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    from_currency_code VARCHAR(3) NOT NULL,
    to_currency_code VARCHAR(3) NOT NULL,
    rate_date DATE NOT NULL,
    exchange_rate DECIMAL(15,6) NOT NULL, -- Rate to convert from_currency to to_currency
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, from_currency_code, to_currency_code, rate_date)
);

-- Add currency columns to transaction tables
-- Note: This migration adds currency support to existing tables
-- We'll add currency_code, base_amount, and exchange_rate to invoices, purchases, payments, etc.

DO $$ 
BEGIN
    -- Add currency columns to invoices if they don't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'invoices' AND column_name = 'currency_code'
    ) THEN
        ALTER TABLE invoices ADD COLUMN currency_code VARCHAR(3) DEFAULT 'INR';
        ALTER TABLE invoices ADD COLUMN base_amount DECIMAL(15,2);
        ALTER TABLE invoices ADD COLUMN exchange_rate DECIMAL(15,6) DEFAULT 1.0;
    END IF;

    -- Add currency columns to purchases if they don't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'purchases' AND column_name = 'currency_code'
    ) THEN
        ALTER TABLE purchases ADD COLUMN currency_code VARCHAR(3) DEFAULT 'INR';
        ALTER TABLE purchases ADD COLUMN base_amount DECIMAL(15,2);
        ALTER TABLE purchases ADD COLUMN exchange_rate DECIMAL(15,6) DEFAULT 1.0;
    END IF;

    -- Add currency columns to payments if they don't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'payments' AND column_name = 'currency_code'
    ) THEN
        ALTER TABLE payments ADD COLUMN currency_code VARCHAR(3) DEFAULT 'INR';
        ALTER TABLE payments ADD COLUMN base_amount DECIMAL(15,2);
        ALTER TABLE payments ADD COLUMN exchange_rate DECIMAL(15,6) DEFAULT 1.0;
    END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_currencies_business_id ON currencies(business_id);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_business_id ON exchange_rates(business_id);
CREATE INDEX IF NOT EXISTS idx_exchange_rates_date ON exchange_rates(rate_date);

COMMENT ON TABLE currencies IS 'Currency master for multi-currency support';
COMMENT ON TABLE exchange_rates IS 'Historical exchange rates for currency conversion';

