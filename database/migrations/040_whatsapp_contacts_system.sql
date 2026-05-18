-- WhatsApp Contacts Management System
-- Migration: 040_whatsapp_contacts_system.sql
-- 
-- Creates tables for:
-- 1. Contacts storage (per business)
-- 2. Contact groups (internal organization)
-- 3. Contact-to-group membership
-- 4. Unsubscribe list (per business)

-- 1. WhatsApp Contacts Table
CREATE TABLE IF NOT EXISTS whatsapp_contacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    phone VARCHAR(20) NOT NULL,
    name VARCHAR(255),
    email VARCHAR(255),
    tags JSONB DEFAULT '[]',
    notes TEXT,
    custom_fields JSONB DEFAULT '{}',
    source VARCHAR(50) DEFAULT 'manual', -- 'manual', 'csv', 'group_extractor'
    imported_from_group VARCHAR(255), -- WhatsApp group JID if imported from group
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, phone)
);

-- 2. WhatsApp Contact Groups Table (Internal organization lists)
CREATE TABLE IF NOT EXISTS whatsapp_contact_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    color VARCHAR(7) DEFAULT '#25D366', -- Hex color code (default WhatsApp green)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, name)
);

-- 3. Contact-to-Group Membership Junction Table
CREATE TABLE IF NOT EXISTS whatsapp_contact_group_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES whatsapp_contact_groups(id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES whatsapp_contacts(id) ON DELETE CASCADE,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(group_id, contact_id)
);

-- 4. Unsubscribe List Table (Per business)
CREATE TABLE IF NOT EXISTS whatsapp_unsubscribes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    phone VARCHAR(20) NOT NULL,
    unsubscribed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, phone)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_contacts_business_id ON whatsapp_contacts(business_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON whatsapp_contacts(phone);
CREATE INDEX IF NOT EXISTS idx_contacts_source ON whatsapp_contacts(source);
CREATE INDEX IF NOT EXISTS idx_contacts_tags ON whatsapp_contacts USING GIN(tags);

CREATE INDEX IF NOT EXISTS idx_contact_groups_business_id ON whatsapp_contact_groups(business_id);

CREATE INDEX IF NOT EXISTS idx_contact_group_members_group_id ON whatsapp_contact_group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_contact_group_members_contact_id ON whatsapp_contact_group_members(contact_id);

CREATE INDEX IF NOT EXISTS idx_unsubscribes_business_id ON whatsapp_unsubscribes(business_id);
CREATE INDEX IF NOT EXISTS idx_unsubscribes_phone ON whatsapp_unsubscribes(phone);

-- Update timestamp trigger for contacts
CREATE OR REPLACE FUNCTION update_whatsapp_contacts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_whatsapp_contacts_updated_at
    BEFORE UPDATE ON whatsapp_contacts
    FOR EACH ROW
    EXECUTE FUNCTION update_whatsapp_contacts_updated_at();

-- Update timestamp trigger for contact groups
CREATE OR REPLACE FUNCTION update_whatsapp_contact_groups_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_whatsapp_contact_groups_updated_at
    BEFORE UPDATE ON whatsapp_contact_groups
    FOR EACH ROW
    EXECUTE FUNCTION update_whatsapp_contact_groups_updated_at();

-- Comments for documentation
COMMENT ON TABLE whatsapp_contacts IS 'Stores contacts for WhatsApp campaigns and messaging (per business)';
COMMENT ON COLUMN whatsapp_contacts.phone IS 'Contact phone number (normalized)';
COMMENT ON COLUMN whatsapp_contacts.tags IS 'Array of tags for categorization';
COMMENT ON COLUMN whatsapp_contacts.custom_fields IS 'Custom key-value fields (JSONB)';
COMMENT ON COLUMN whatsapp_contacts.source IS 'How contact was added: manual, csv, group_extractor';
COMMENT ON COLUMN whatsapp_contacts.imported_from_group IS 'WhatsApp group JID if imported from Group Extractor';

COMMENT ON TABLE whatsapp_contact_groups IS 'Internal organization lists for contacts (separate from WhatsApp groups)';
COMMENT ON COLUMN whatsapp_contact_groups.color IS 'Hex color for UI display';

COMMENT ON TABLE whatsapp_contact_group_members IS 'Junction table linking contacts to groups (many-to-many)';

COMMENT ON TABLE whatsapp_unsubscribes IS 'Users who have unsubscribed from messages (per business)';
COMMENT ON COLUMN whatsapp_unsubscribes.phone IS 'Phone number that unsubscribed';
