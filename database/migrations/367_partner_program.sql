-- Platform partner / reseller program (sell Khatario subscriptions).
-- Attribution is locked at signup (?ref=CODE) or claim; commission only on paid settlement.

CREATE TABLE IF NOT EXISTS platform_partners (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    partner_type VARCHAR(20) NOT NULL DEFAULT 'freelancer'
        CHECK (partner_type IN ('freelancer', 'agency')),
    name VARCHAR(200) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    password_hash TEXT NOT NULL,
    referral_code VARCHAR(32) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (status IN ('pending', 'active', 'suspended')),
    -- Per-partner commission (admin-configurable)
    commission_type VARCHAR(20) NOT NULL DEFAULT 'percentage'
        CHECK (commission_type IN ('percentage', 'fixed')),
    commission_value NUMERIC(12, 2) NOT NULL DEFAULT 20,
    -- first_payment = only first settled paid invoice; recurring = every paid renewal
    commission_basis VARCHAR(20) NOT NULL DEFAULT 'first_payment'
        CHECK (commission_basis IN ('first_payment', 'recurring')),
    hold_days INTEGER, -- NULL = use program default
    pan VARCHAR(20),
    gstin VARCHAR(20),
    bank_account_name VARCHAR(200),
    bank_account_number VARCHAR(50),
    bank_ifsc VARCHAR(20),
    upi_id VARCHAR(100),
    notes TEXT,
    created_by_admin_id UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT platform_partners_email_unique UNIQUE (email),
    CONSTRAINT platform_partners_referral_code_unique UNIQUE (referral_code)
);

CREATE INDEX IF NOT EXISTS idx_platform_partners_status ON platform_partners(status);
CREATE INDEX IF NOT EXISTS idx_platform_partners_type ON platform_partners(partner_type);

CREATE TABLE IF NOT EXISTS platform_partner_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    partner_id UUID NOT NULL REFERENCES platform_partners(id) ON DELETE CASCADE,
    session_token VARCHAR(128) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT platform_partner_sessions_token_unique UNIQUE (session_token)
);

CREATE INDEX IF NOT EXISTS idx_platform_partner_sessions_partner
    ON platform_partner_sessions(partner_id);
CREATE INDEX IF NOT EXISTS idx_platform_partner_sessions_expires
    ON platform_partner_sessions(expires_at);

-- One partner attribution per business (locked at signup/claim).
CREATE TABLE IF NOT EXISTS business_partner_attributions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    partner_id UUID NOT NULL REFERENCES platform_partners(id) ON DELETE RESTRICT,
    source VARCHAR(20) NOT NULL
        CHECK (source IN ('ref_link', 'code', 'claim', 'admin')),
    referral_code VARCHAR(32),
    attributed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    attributed_by_partner_id UUID REFERENCES platform_partners(id) ON DELETE SET NULL,
    attributed_by_admin_id UUID REFERENCES platform_admins(id) ON DELETE SET NULL,
    notes TEXT,
    CONSTRAINT business_partner_attributions_business_unique UNIQUE (business_id)
);

CREATE INDEX IF NOT EXISTS idx_business_partner_attr_partner
    ON business_partner_attributions(partner_id);

CREATE TABLE IF NOT EXISTS partner_deals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    partner_id UUID NOT NULL REFERENCES platform_partners(id) ON DELETE CASCADE,
    business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
    contact_name VARCHAR(200) NOT NULL,
    contact_phone VARCHAR(20),
    contact_email VARCHAR(255),
    company_name VARCHAR(200),
    stage VARCHAR(30) NOT NULL DEFAULT 'lead'
        CHECK (stage IN (
            'lead', 'contacted', 'demo_booked', 'demo_done',
            'trial', 'proposal', 'won', 'lost'
        )),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_partner_deals_partner ON partner_deals(partner_id, stage);
CREATE INDEX IF NOT EXISTS idx_partner_deals_business ON partner_deals(business_id)
    WHERE business_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS partner_commissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    partner_id UUID NOT NULL REFERENCES platform_partners(id) ON DELETE RESTRICT,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    billing_transaction_id UUID NOT NULL REFERENCES billing_transactions(id) ON DELETE CASCADE,
    sale_amount NUMERIC(12, 2) NOT NULL,
    commission_type VARCHAR(20) NOT NULL,
    commission_rate NUMERIC(12, 2) NOT NULL,
    commission_amount NUMERIC(12, 2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'paid', 'cancelled')),
    eligible_at TIMESTAMPTZ NOT NULL,
    approved_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    rule_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT partner_commissions_billing_tx_unique UNIQUE (billing_transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_partner_commissions_partner_status
    ON partner_commissions(partner_id, status);
CREATE INDEX IF NOT EXISTS idx_partner_commissions_eligible
    ON partner_commissions(status, eligible_at)
    WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS partner_program_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    default_hold_days INTEGER NOT NULL DEFAULT 14,
    default_commission_type VARCHAR(20) NOT NULL DEFAULT 'percentage',
    default_commission_value NUMERIC(12, 2) NOT NULL DEFAULT 20,
    default_commission_basis VARCHAR(20) NOT NULL DEFAULT 'first_payment',
    tds_enabled BOOLEAN NOT NULL DEFAULT true,
    tds_section VARCHAR(20) NOT NULL DEFAULT '194H',
    tds_rate_percent NUMERIC(5, 2) NOT NULL DEFAULT 2,
    tds_annual_threshold NUMERIC(12, 2) NOT NULL DEFAULT 20000,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO partner_program_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE platform_partners IS 'External freelancers/agencies selling Khatario subscriptions';
COMMENT ON TABLE business_partner_attributions IS 'Locks which partner owns a business for commission (set at trial signup or claim)';
COMMENT ON TABLE partner_commissions IS 'Commission rows created only when a billing payment settles';
