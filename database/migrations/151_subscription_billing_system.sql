-- =====================================================
-- SUBSCRIPTION BILLING SYSTEM MIGRATION
-- Migration: 151_subscription_billing_system.sql
-- Description: Adds billing transactions, coupons, grace period tracking,
--              cancellation scheduling, and usage snapshots.
-- =====================================================

-- 1. Billing Transactions (payment/refund/credit records)
CREATE TABLE IF NOT EXISTS billing_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES business_subscriptions(id) ON DELETE SET NULL,
    type VARCHAR(20) NOT NULL CHECK (type IN ('payment', 'refund', 'credit', 'adjustment')),
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
    amount DECIMAL(12, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    plan_id VARCHAR(50) REFERENCES subscription_plans(id),
    billing_cycle VARCHAR(10) CHECK (billing_cycle IN ('monthly', 'yearly')),
    payment_method VARCHAR(50), -- 'razorpay', 'stripe', 'manual', 'bank_transfer', 'upi'
    payment_reference VARCHAR(255), -- gateway transaction ID
    gateway_order_id VARCHAR(255), -- gateway order ID
    gateway_response JSONB, -- full response from payment gateway
    coupon_id UUID, -- references coupons(id), added after coupons table
    discount_amount DECIMAL(12, 2) DEFAULT 0,
    tax_amount DECIMAL(12, 2) DEFAULT 0,
    total_amount DECIMAL(12, 2) NOT NULL, -- amount - discount + tax
    description TEXT,
    invoice_number VARCHAR(50), -- SaaS invoice number (e.g., INV-2026-001)
    invoice_url TEXT, -- URL to downloadable receipt/invoice PDF
    period_start DATE,
    period_end DATE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_billing_tx_business ON billing_transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_billing_tx_subscription ON billing_transactions(subscription_id);
CREATE INDEX IF NOT EXISTS idx_billing_tx_status ON billing_transactions(status);
CREATE INDEX IF NOT EXISTS idx_billing_tx_created ON billing_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_tx_invoice ON billing_transactions(invoice_number);

-- 2. Coupons
CREATE TABLE IF NOT EXISTS coupons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    type VARCHAR(20) NOT NULL CHECK (type IN ('percentage', 'flat', 'free_months')),
    value DECIMAL(12, 2) NOT NULL, -- percentage (e.g. 20), flat amount (e.g. 500), or number of free months (e.g. 3)
    currency VARCHAR(3) DEFAULT 'INR',
    min_plan_id VARCHAR(50), -- minimum plan required (NULL = any plan)
    applicable_plans VARCHAR(255)[], -- array of plan IDs this coupon applies to (NULL = all)
    max_redemptions INTEGER, -- NULL = unlimited
    current_redemptions INTEGER DEFAULT 0,
    max_per_business INTEGER DEFAULT 1, -- max times one business can use this
    valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_until DATE, -- NULL = no expiry
    is_active BOOLEAN DEFAULT true,
    created_by VARCHAR(100), -- admin who created it
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_active ON coupons(is_active, valid_from, valid_until);

-- 3. Coupon Redemptions
CREATE TABLE IF NOT EXISTS coupon_redemptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    billing_transaction_id UUID REFERENCES billing_transactions(id) ON DELETE SET NULL,
    plan_id VARCHAR(50) NOT NULL,
    discount_amount DECIMAL(12, 2) NOT NULL,
    redeemed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(coupon_id, business_id, billing_transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_coupon_redeem_coupon ON coupon_redemptions(coupon_id);
CREATE INDEX IF NOT EXISTS idx_coupon_redeem_business ON coupon_redemptions(business_id);

-- 4. Add cancellation and grace period columns to business_subscriptions
ALTER TABLE business_subscriptions
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS grace_period_end DATE,
    ADD COLUMN IF NOT EXISTS grace_notified BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS downgraded_from VARCHAR(50),
    ADD COLUMN IF NOT EXISTS scheduled_plan_id VARCHAR(50);

-- 5. Subscription Event Log (audit trail for all subscription changes)
CREATE TABLE IF NOT EXISTS subscription_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    event_type VARCHAR(50) NOT NULL, -- 'created', 'upgraded', 'downgraded', 'cancelled', 'renewed', 'expired', 'trial_started', 'trial_expired', 'grace_started', 'grace_expired', 'payment_succeeded', 'payment_failed'
    from_plan_id VARCHAR(50),
    to_plan_id VARCHAR(50),
    details JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sub_events_business ON subscription_events(business_id);
CREATE INDEX IF NOT EXISTS idx_sub_events_type ON subscription_events(event_type);
CREATE INDEX IF NOT EXISTS idx_sub_events_created ON subscription_events(created_at DESC);

-- 6. Add FK for coupon_id in billing_transactions
ALTER TABLE billing_transactions
    ADD CONSTRAINT fk_billing_tx_coupon FOREIGN KEY (coupon_id) REFERENCES coupons(id) ON DELETE SET NULL;

-- 7. Notification tracking for subscription emails
CREATE TABLE IF NOT EXISTS subscription_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    notification_type VARCHAR(50) NOT NULL, -- 'trial_expiring_7d', 'trial_expiring_3d', 'trial_expiring_1d', 'trial_expired', 'grace_started', 'grace_expiring_3d', 'grace_expired', 'usage_80', 'usage_90', 'usage_100', 'renewal_reminder', 'cancellation_confirmed', 'downgrade_completed'
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sub_notif_unique_per_day
    ON subscription_notifications(business_id, notification_type, (CAST(sent_at AT TIME ZONE 'UTC' AS date)));
CREATE INDEX IF NOT EXISTS idx_sub_notif_business ON subscription_notifications(business_id);
CREATE INDEX IF NOT EXISTS idx_sub_notif_type ON subscription_notifications(notification_type);

-- 8. Usage snapshots (daily snapshots for analytics/history)
CREATE TABLE IF NOT EXISTS subscription_usage_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    plan_id VARCHAR(50) NOT NULL,
    snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
    invoices_count INTEGER DEFAULT 0,
    invoices_limit INTEGER DEFAULT 0,
    customers_count INTEGER DEFAULT 0,
    customers_limit INTEGER DEFAULT 0,
    items_count INTEGER DEFAULT 0,
    items_limit INTEGER DEFAULT 0,
    users_count INTEGER DEFAULT 0,
    users_limit INTEGER DEFAULT 0,
    employees_count INTEGER DEFAULT 0,
    employees_limit INTEGER DEFAULT 0,
    suppliers_count INTEGER DEFAULT 0,
    suppliers_limit INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(business_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_usage_snap_business ON subscription_usage_snapshots(business_id, snapshot_date DESC);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_billing_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_billing_tx_updated') THEN
        CREATE TRIGGER trg_billing_tx_updated BEFORE UPDATE ON billing_transactions
            FOR EACH ROW EXECUTE FUNCTION update_billing_updated_at();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_coupons_updated') THEN
        CREATE TRIGGER trg_coupons_updated BEFORE UPDATE ON coupons
            FOR EACH ROW EXECUTE FUNCTION update_billing_updated_at();
    END IF;
END $$;
