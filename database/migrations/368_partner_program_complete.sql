-- Partner program completion: agency seats, payouts+TDS, sales kit, session user link.

CREATE TABLE IF NOT EXISTS platform_partner_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    partner_id UUID NOT NULL REFERENCES platform_partners(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'member'
        CHECK (role IN ('owner', 'member')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT platform_partner_users_email_unique UNIQUE (email)
);

CREATE INDEX IF NOT EXISTS idx_platform_partner_users_partner
    ON platform_partner_users(partner_id) WHERE is_active = true;

-- Backfill owner seats from existing partners
INSERT INTO platform_partner_users (
  partner_id, name, email, phone, password_hash, role, is_active, last_login_at
)
SELECT
  p.id, p.name, p.email, p.phone, p.password_hash, 'owner', true, p.last_login_at
FROM platform_partners p
WHERE NOT EXISTS (
  SELECT 1 FROM platform_partner_users u WHERE lower(u.email) = lower(p.email)
)
ON CONFLICT (email) DO NOTHING;

ALTER TABLE platform_partner_sessions
  ADD COLUMN IF NOT EXISTS partner_user_id UUID REFERENCES platform_partner_users(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS partner_payouts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    partner_id UUID NOT NULL REFERENCES platform_partners(id) ON DELETE RESTRICT,
    gross_amount NUMERIC(12, 2) NOT NULL,
    tds_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    net_amount NUMERIC(12, 2) NOT NULL,
    tds_section VARCHAR(20),
    tds_rate_percent NUMERIC(5, 2),
    status VARCHAR(20) NOT NULL DEFAULT 'paid'
        CHECK (status IN ('draft', 'paid', 'cancelled')),
    payment_reference VARCHAR(100),
    payment_method VARCHAR(40),
    notes TEXT,
    paid_at TIMESTAMPTZ,
    paid_by_admin_id UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_partner_payouts_partner
    ON partner_payouts(partner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS partner_payout_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payout_id UUID NOT NULL REFERENCES partner_payouts(id) ON DELETE CASCADE,
    commission_id UUID NOT NULL REFERENCES partner_commissions(id) ON DELETE RESTRICT,
    commission_amount NUMERIC(12, 2) NOT NULL,
    tds_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    CONSTRAINT partner_payout_items_commission_unique UNIQUE (commission_id)
);

CREATE INDEX IF NOT EXISTS idx_partner_payout_items_payout
    ON partner_payout_items(payout_id);

CREATE TABLE IF NOT EXISTS partner_sales_kit_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(200) NOT NULL,
    description TEXT,
    kind VARCHAR(20) NOT NULL DEFAULT 'link'
        CHECK (kind IN ('link', 'text', 'file')),
    url TEXT,
    body_text TEXT,
    file_name VARCHAR(255),
    file_path TEXT,
    mime_type VARCHAR(120),
    size_bytes INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by_admin_id UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_partner_sales_kit_active
    ON partner_sales_kit_items(is_active, sort_order);

COMMENT ON TABLE platform_partner_users IS 'Agency/freelancer portal logins (owner + members share one partner ledger)';
COMMENT ON TABLE partner_payouts IS 'Partner payout batches with TDS snapshot';
COMMENT ON TABLE partner_sales_kit_items IS 'Marketing assets shared with all partners';
