-- 460: Order returns release 1 - how the item comes back (courier pickup / customer sends / no return),
-- the Shiprocket return pickup, refunds to the original payment through the gateway, and a timeline.
--
-- order_returns: return method, pickup address and parcel size (saved at approval), pickup status and
--   the Shiprocket / AWB details. pickup_status null = no pickup. pickup_attempt numbers the Shiprocket
--   reference (RET-0001, RET-0001-2 ...).
-- return_gateway_refunds: one row per refund asked of Razorpay / Easebuzz for a return. At most one
--   pending row per return; the idempotency key is unique per business.
-- order_return_events: the timeline shown on every screen. created_at uses clock_timestamp() so events
--   recorded in one transaction keep their order.
-- items.store_returnable: false = the shop does not take this product back online.

ALTER TABLE order_returns
  ADD COLUMN IF NOT EXISTS return_method VARCHAR(16),
  ADD COLUMN IF NOT EXISTS return_instructions TEXT,
  ADD COLUMN IF NOT EXISTS pickup_address TEXT,
  ADD COLUMN IF NOT EXISTS pickup_pincode VARCHAR(6),
  ADD COLUMN IF NOT EXISTS pickup_phone VARCHAR(15),
  ADD COLUMN IF NOT EXISTS pickup_weight_kg NUMERIC,
  ADD COLUMN IF NOT EXISTS pickup_length_cm NUMERIC,
  ADD COLUMN IF NOT EXISTS pickup_breadth_cm NUMERIC,
  ADD COLUMN IF NOT EXISTS pickup_height_cm NUMERIC,
  ADD COLUMN IF NOT EXISTS pickup_status VARCHAR(16),
  ADD COLUMN IF NOT EXISTS pickup_attempt SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS carrier_order_id VARCHAR(40),
  ADD COLUMN IF NOT EXISTS carrier_shipment_id VARCHAR(40),
  ADD COLUMN IF NOT EXISTS awb VARCHAR(100),
  ADD COLUMN IF NOT EXISTS courier_name VARCHAR(120),
  ADD COLUMN IF NOT EXISTS tracking_url TEXT,
  ADD COLUMN IF NOT EXISTS pickup_scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pickup_error TEXT;

ALTER TABLE order_returns DROP CONSTRAINT IF EXISTS order_returns_return_method_check;
ALTER TABLE order_returns ADD CONSTRAINT order_returns_return_method_check
  CHECK (return_method IS NULL OR return_method IN ('courier_pickup', 'customer_sends', 'no_return'));

ALTER TABLE order_returns DROP CONSTRAINT IF EXISTS order_returns_pickup_status_check;
ALTER TABLE order_returns ADD CONSTRAINT order_returns_pickup_status_check
  CHECK (pickup_status IS NULL OR pickup_status IN ('booked', 'out_for_pickup', 'pickup_issue', 'in_transit', 'arrived', 'cancelled'));

ALTER TABLE order_returns DROP CONSTRAINT IF EXISTS order_returns_refund_method_check;
ALTER TABLE order_returns ADD CONSTRAINT order_returns_refund_method_check
  CHECK (refund_method IS NULL OR refund_method IN ('store_credit', 'cash', 'upi', 'bank', 'original_payment'));

CREATE INDEX IF NOT EXISTS idx_order_returns_awb
  ON order_returns (business_id, awb) WHERE awb IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_returns_carrier_order
  ON order_returns (business_id, carrier_order_id) WHERE carrier_order_id IS NOT NULL;

ALTER TABLE credit_note_refunds DROP CONSTRAINT IF EXISTS credit_note_refunds_mode_check;
ALTER TABLE credit_note_refunds ADD CONSTRAINT credit_note_refunds_mode_check
  CHECK (mode IN ('cash', 'upi', 'bank', 'gateway'));

CREATE TABLE IF NOT EXISTS return_gateway_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  order_return_id UUID NOT NULL REFERENCES order_returns(id) ON DELETE CASCADE,
  store_order_id UUID REFERENCES store_orders(id) ON DELETE SET NULL,
  credit_note_id UUID REFERENCES credit_notes(id) ON DELETE SET NULL,
  provider VARCHAR(12) NOT NULL CHECK (provider IN ('razorpay', 'easebuzz')),
  provider_payment_id VARCHAR(100),
  provider_refund_id VARCHAR(100),
  idempotency_key VARCHAR(120) NOT NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  status VARCHAR(12) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'failed')),
  failure_reason TEXT,
  credit_note_refund_id UUID REFERENCES credit_note_refunds(id) ON DELETE SET NULL,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_return_gateway_refunds_key UNIQUE (business_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_return_gateway_refunds_one_pending
  ON return_gateway_refunds (order_return_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_return_gateway_refunds_return
  ON return_gateway_refunds (order_return_id);
CREATE INDEX IF NOT EXISTS idx_return_gateway_refunds_provider_refund
  ON return_gateway_refunds (provider, provider_refund_id) WHERE provider_refund_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS order_return_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id UUID NOT NULL REFERENCES order_returns(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind VARCHAR(20) NOT NULL CHECK (kind IN (
    'requested', 'approved', 'rejected', 'pickup_booked', 'pickup_status', 'pickup_cancelled',
    'received', 'refund_pending', 'refunded', 'refund_failed', 'cancelled'
  )),
  note TEXT,
  actor_type VARCHAR(10) NOT NULL CHECK (actor_type IN ('customer', 'staff', 'webhook', 'system')),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS idx_order_return_events_return
  ON order_return_events (return_id, created_at);

ALTER TABLE items ADD COLUMN IF NOT EXISTS store_returnable BOOLEAN NOT NULL DEFAULT true;
