-- Owner updates on the business's own WhatsApp (Cloud API or QR), plus a log of inbound /
-- outbound message ids that drops Meta's repeated deliveries and stops self-chat reply loops.

CREATE TABLE IF NOT EXISTS whatsapp_inbound_events (
    id BIGSERIAL PRIMARY KEY,
    provider VARCHAR(16) NOT NULL CHECK (provider IN ('cloud', 'baileys', 'platform')),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    message_id VARCHAR(255) NOT NULL,
    sender_phone VARCHAR(32),
    direction VARCHAR(8) NOT NULL DEFAULT 'in' CHECK (direction IN ('in', 'out')),
    handled_as VARCHAR(32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per provider + message id; NULL business (platform number) shares one namespace.
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_inbound_events_msg
    ON whatsapp_inbound_events (provider, COALESCE(business_id, '00000000-0000-0000-0000-000000000000'::uuid), message_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_inbound_events_created ON whatsapp_inbound_events (created_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_inbound_events_sender
    ON whatsapp_inbound_events (business_id, sender_phone, created_at DESC);

CREATE TABLE IF NOT EXISTS owner_whatsapp_links (
    business_id UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    linked_phone VARCHAR(32),
    linked_at TIMESTAMPTZ,
    self_chat BOOLEAN NOT NULL DEFAULT FALSE,
    link_code VARCHAR(8),
    link_code_expires_at TIMESTAMPTZ,
    daily_summary_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    daily_summary_time TIME NOT NULL DEFAULT '21:00',
    last_summary_sent_on DATE,
    last_summary_error TEXT,
    last_owner_message_at TIMESTAMPTZ,
    template_name VARCHAR(512),
    template_status VARCHAR(20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_owner_whatsapp_links_phone ON owner_whatsapp_links (linked_phone) WHERE linked_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_owner_whatsapp_links_code ON owner_whatsapp_links (link_code) WHERE link_code IS NOT NULL;
