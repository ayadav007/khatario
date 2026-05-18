-- Migration: 045_create_business_addons.sql
-- Purpose: Create business_addons table for tracking addon purchases

CREATE TABLE IF NOT EXISTS business_addons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    addon_type VARCHAR(50) NOT NULL, -- 'whatsapp_bot', 'whatsapp', 'whatsapp_send_message', etc.
    status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active', 'inactive', 'expired'
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    end_date DATE, -- NULL for lifetime/unlimited
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_business_addons_business_id ON business_addons(business_id);
CREATE INDEX IF NOT EXISTS idx_business_addons_addon_type ON business_addons(addon_type);
CREATE INDEX IF NOT EXISTS idx_business_addons_status ON business_addons(status);
CREATE INDEX IF NOT EXISTS idx_business_addons_dates ON business_addons(start_date, end_date);

-- Update trigger
CREATE OR REPLACE FUNCTION update_business_addons_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_business_addons_updated_at
    BEFORE UPDATE ON business_addons
    FOR EACH ROW
    EXECUTE FUNCTION update_business_addons_updated_at();

-- Comments
COMMENT ON TABLE business_addons IS 'Tracks addon purchases and subscriptions for businesses';
COMMENT ON COLUMN business_addons.addon_type IS 'Type of addon: whatsapp_bot, whatsapp, whatsapp_send_message, etc.';
COMMENT ON COLUMN business_addons.status IS 'Current status: active, inactive, expired';
COMMENT ON COLUMN business_addons.end_date IS 'Expiry date (NULL for lifetime access)';

-- Insert a default WhatsApp addon for testing (you can modify or remove this)
-- This gives all businesses WhatsApp access by default for testing
INSERT INTO business_addons (business_id, addon_type, status, start_date, end_date)
SELECT id, 'whatsapp_bot', 'active', CURRENT_DATE, NULL
FROM businesses
WHERE NOT EXISTS (
    SELECT 1 FROM business_addons 
    WHERE business_addons.business_id = businesses.id 
    AND business_addons.addon_type IN ('whatsapp_bot', 'whatsapp')
)
ON CONFLICT DO NOTHING;
