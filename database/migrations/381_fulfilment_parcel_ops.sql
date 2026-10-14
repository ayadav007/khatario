-- 381: Parcel operations for Orders & delivery.
--   * order_fulfilment_items: which order lines (and how many) travel in each parcel. A parcel with
--     no rows carries whatever the order's other parcels do not.
--   * Parcel size (L x B x H cm) for courier rates and bookings.
--   * Rider link: a separate token so a rider can open the drop details and update the status
--     without a Khatario login (the buyer's public_token stays read-only).
--   * Failed delivery (NDR): what the shop asked the courier to do next.
--   * COD remittances: cash the courier or rider paid over to the shop, matched to parcels.
--   * Stuck parcel notice: when the buyer was told a parcel is taking longer than usual.

CREATE TABLE IF NOT EXISTS order_fulfilment_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  fulfilment_id UUID NOT NULL REFERENCES order_fulfilments(id) ON DELETE CASCADE,
  -- Source line id: store_order_items.id, sales_order_items.id or invoice_items.id.
  line_id UUID NOT NULL,
  item_name VARCHAR(255) NOT NULL,
  quantity NUMERIC(15, 3) NOT NULL CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_order_fulfilment_items_line UNIQUE (fulfilment_id, line_id)
);
CREATE INDEX IF NOT EXISTS idx_order_fulfilment_items_fulfilment ON order_fulfilment_items (fulfilment_id);

ALTER TABLE order_fulfilments
  ADD COLUMN IF NOT EXISTS length_cm NUMERIC(6, 1),
  ADD COLUMN IF NOT EXISTS breadth_cm NUMERIC(6, 1),
  ADD COLUMN IF NOT EXISTS height_cm NUMERIC(6, 1),
  ADD COLUMN IF NOT EXISTS rider_token VARCHAR(48),
  ADD COLUMN IF NOT EXISTS ndr_action VARCHAR(16),
  ADD COLUMN IF NOT EXISTS ndr_note TEXT,
  ADD COLUMN IF NOT EXISTS ndr_reattempt_date DATE,
  ADD COLUMN IF NOT EXISTS ndr_attempts SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ndr_actioned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cod_remittance_id UUID,
  ADD COLUMN IF NOT EXISTS stuck_notified_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_fulfilments_dims_check') THEN
    ALTER TABLE order_fulfilments ADD CONSTRAINT order_fulfilments_dims_check CHECK (
      (length_cm IS NULL OR (length_cm > 0 AND length_cm <= 300))
      AND (breadth_cm IS NULL OR (breadth_cm > 0 AND breadth_cm <= 300))
      AND (height_cm IS NULL OR (height_cm > 0 AND height_cm <= 300))
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_fulfilments_ndr_action_check') THEN
    ALTER TABLE order_fulfilments ADD CONSTRAINT order_fulfilments_ndr_action_check
      CHECK (ndr_action IS NULL OR ndr_action IN ('reattempt', 'return_to_origin', 'change_address'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_order_fulfilments_rider_token
  ON order_fulfilments (rider_token) WHERE rider_token IS NOT NULL;

CREATE TABLE IF NOT EXISTS cod_remittances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  -- Who paid the cash over: a courier company (e.g. Shiprocket) or the shop's own rider.
  source VARCHAR(16) NOT NULL CHECK (source IN ('shiprocket', 'courier', 'own_rider', 'local_app')),
  partner_name VARCHAR(100),
  reference VARCHAR(100),
  remitted_on DATE NOT NULL,
  expected_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  received_amount NUMERIC(12, 2) NOT NULL CHECK (received_amount >= 0),
  deductions NUMERIC(12, 2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cod_remittances_business ON cod_remittances (business_id, remitted_on DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_fulfilments_cod_remittance_fkey') THEN
    ALTER TABLE order_fulfilments ADD CONSTRAINT order_fulfilments_cod_remittance_fkey
      FOREIGN KEY (cod_remittance_id) REFERENCES cod_remittances(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_order_fulfilments_cod_open
  ON order_fulfilments (business_id)
  WHERE cod_amount > 0 AND cod_collected_at IS NOT NULL AND cod_remittance_id IS NULL;

-- Riders update their drop from the rider link: their timeline events are marked 'rider'.
ALTER TABLE order_fulfilment_events DROP CONSTRAINT IF EXISTS order_fulfilment_events_actor_check;
ALTER TABLE order_fulfilment_events ADD CONSTRAINT order_fulfilment_events_actor_check
  CHECK (actor_type IN ('staff', 'webhook', 'system', 'bot', 'rider'));
