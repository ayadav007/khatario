-- Migration: WhatsApp Add-on Subscriptions
-- Creates table for managing WhatsApp feature add-ons

CREATE TABLE IF NOT EXISTS whatsapp_addons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    addon_type VARCHAR(50) NOT NULL, -- 'whatsapp_bot', 'whatsapp_send_message', etc.
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active', 'expired', 'cancelled'
    price_monthly DECIMAL(10, 2) NOT NULL DEFAULT 0,
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date DATE, -- NULL = no expiration (ongoing subscription)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, addon_type) -- One active addon of each type per business
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_whatsapp_addons_business_id ON whatsapp_addons(business_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_addons_status ON whatsapp_addons(status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_addons_type ON whatsapp_addons(addon_type);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_whatsapp_addons_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER whatsapp_addons_updated_at
    BEFORE UPDATE ON whatsapp_addons
    FOR EACH ROW
    EXECUTE FUNCTION update_whatsapp_addons_updated_at();

-- Add comment to table
COMMENT ON TABLE whatsapp_addons IS 'Stores WhatsApp feature add-on subscriptions for businesses';
COMMENT ON COLUMN whatsapp_addons.addon_type IS 'Type of addon: whatsapp_bot, whatsapp_send_message';
COMMENT ON COLUMN whatsapp_addons.status IS 'Status: active, expired, cancelled';

