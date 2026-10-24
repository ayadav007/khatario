-- Phase 3.6B: store payment and refund state.
-- Does not rewrite historical store orders or post receipts for them.
-- payment_status gains failed / refund_pending / refunded. COD stays COD until
-- cash is collected; collection itself is still cash_collected_at, not "paid".

ALTER TABLE store_orders DROP CONSTRAINT IF EXISTS store_orders_payment_status_check;
ALTER TABLE store_orders
  ADD CONSTRAINT store_orders_payment_status_check
  CHECK (payment_status IN ('unpaid', 'paid', 'cod', 'failed', 'refund_pending', 'refunded'));

ALTER TABLE store_orders
  ADD COLUMN IF NOT EXISTS provider_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS receipt_payment_id UUID,
  ADD COLUMN IF NOT EXISTS receipt_actor_type VARCHAR(32);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'store_orders_receipt_payment_id_fkey'
  ) THEN
    ALTER TABLE store_orders
      ADD CONSTRAINT store_orders_receipt_payment_id_fkey
      FOREIGN KEY (receipt_payment_id) REFERENCES payments(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_store_orders_provider_payment
  ON store_orders (payment_provider, provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_store_orders_receipt_payment
  ON store_orders (receipt_payment_id)
  WHERE receipt_payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS store_payment_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  provider VARCHAR(32) NOT NULL DEFAULT 'razorpay',
  provider_payment_id TEXT NOT NULL,
  provider_order_id TEXT,
  provider_refund_id TEXT,
  idempotency_key VARCHAR(64) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'refunded')),
  actor_type VARCHAR(32) NOT NULL CHECK (actor_type IN ('user', 'razorpay_webhook')),
  actor_user_id UUID,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (order_id),
  UNIQUE (provider, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_store_payment_refunds_provider_refund
  ON store_payment_refunds (provider, provider_refund_id)
  WHERE provider_refund_id IS NOT NULL;

COMMENT ON COLUMN store_orders.receipt_actor_type IS
  'Who posted the store receipt. razorpay_webhook is a provider event, not a users.id.';
COMMENT ON COLUMN store_payment_refunds.actor_user_id IS
  'Session user for an admin refund. Null when a Razorpay webhook confirms the refund.';
