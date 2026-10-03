-- Migration 357: Shiprocket bookings from the Orders screen.
-- carrier_order_id / carrier_shipment_id are Shiprocket's own ids: cancel uses the order id; AWB,
-- pickup, label and manifest calls use the shipment id. weight_kg is what the courier is billed on.

ALTER TABLE order_fulfilments
  ADD COLUMN IF NOT EXISTS carrier_order_id VARCHAR(40),
  ADD COLUMN IF NOT EXISTS carrier_shipment_id VARCHAR(40),
  ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(7, 3),
  ADD COLUMN IF NOT EXISTS label_url TEXT,
  ADD COLUMN IF NOT EXISTS manifest_url TEXT,
  ADD COLUMN IF NOT EXISTS manifested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pickup_scheduled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS booking_error TEXT;

ALTER TABLE store_orders
  ADD COLUMN IF NOT EXISTS carrier_order_id VARCHAR(40),
  ADD COLUMN IF NOT EXISTS courier_name VARCHAR(100);

CREATE INDEX IF NOT EXISTS idx_order_fulfilments_carrier_shipment
  ON order_fulfilments (business_id, carrier_shipment_id)
  WHERE carrier_shipment_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_fulfilments_weight_check') THEN
    ALTER TABLE order_fulfilments
      ADD CONSTRAINT order_fulfilments_weight_check CHECK (weight_kg IS NULL OR (weight_kg > 0 AND weight_kg <= 500));
  END IF;
END $$;
