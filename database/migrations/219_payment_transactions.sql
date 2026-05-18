-- Payment transactions for sales orders (gateway / UPI collect / VA, etc.)
-- Adds payment_transactions table and sales_orders.payment_status / payment_method

-- ---------------------------------------------------------------------------
-- payment_transactions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
    provider VARCHAR(64) NOT NULL,
    provider_payment_id VARCHAR(255),
    method VARCHAR(32) NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    utr VARCHAR(128),
    payer_name VARCHAR(255),
    raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_payment_transactions_method CHECK (
        method IN ('upi_collect', 'virtual_account')
    ),
    CONSTRAINT chk_payment_transactions_status CHECK (
        status IN ('pending', 'success', 'failed')
    )
);

CREATE INDEX IF NOT EXISTS idx_payment_transactions_business ON payment_transactions(business_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_order ON payment_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_transactions_status ON payment_transactions(business_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_transactions_provider_ref
    ON payment_transactions(business_id, provider, provider_payment_id)
    WHERE provider_payment_id IS NOT NULL;

-- No DROP TRIGGER here: first-run only; avoids NOTICE "trigger does not exist, skipping"
CREATE TRIGGER update_payment_transactions_updated_at
    BEFORE UPDATE ON payment_transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE payment_transactions IS 'Individual payment attempts / callbacks tied to sales_orders';
COMMENT ON COLUMN payment_transactions.order_id IS 'sales_orders.id';
COMMENT ON COLUMN payment_transactions.provider IS 'Gateway or rail identifier (e.g. razorpay, phonepe, manual)';
COMMENT ON COLUMN payment_transactions.provider_payment_id IS 'Provider-side payment / charge id when known';
COMMENT ON COLUMN payment_transactions.method IS 'upi_collect | virtual_account';
COMMENT ON COLUMN payment_transactions.status IS 'pending | success | failed';

-- ---------------------------------------------------------------------------
-- sales_orders: aggregate payment fields
-- ---------------------------------------------------------------------------
ALTER TABLE sales_orders
    ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'unpaid',
    ADD COLUMN IF NOT EXISTS payment_method VARCHAR(32);

COMMENT ON COLUMN sales_orders.payment_status IS 'unpaid | pending | partial | paid | failed — aggregate from payment_transactions / flows';
COMMENT ON COLUMN sales_orders.payment_method IS 'Last / primary collection method: upi_collect, virtual_account, etc.';

CREATE INDEX IF NOT EXISTS idx_sales_orders_payment_status ON sales_orders(business_id, payment_status);
