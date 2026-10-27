-- 423: Supplier Hub orders keep what the supplier could not send yet, and show when a billed
-- order is on its way.
--   * origin 'backorder': the rest of a partly confirmed order, opened as a new pending order
--     for the supplier to confirm when stock arrives; parent_order_id points at the original.
--   * status 'dispatched': the supplier sent the billed goods (invoiced -> dispatched ->
--     received); dispatch_note holds the transporter, LR or vehicle number.

ALTER TABLE supply_orders DROP CONSTRAINT IF EXISTS supply_orders_status_check;
ALTER TABLE supply_orders ADD CONSTRAINT supply_orders_status_check
  CHECK (status IN ('draft', 'proposed', 'pending', 'confirmed', 'partial', 'declined',
                    'invoiced', 'dispatched', 'received', 'cancelled'));

ALTER TABLE supply_orders DROP CONSTRAINT IF EXISTS supply_orders_origin_check;
ALTER TABLE supply_orders ADD CONSTRAINT supply_orders_origin_check
  CHECK (origin IN ('buyer', 'vendor', 'suggested', 'catalog', 'backorder'));

ALTER TABLE supply_orders
  ADD COLUMN IF NOT EXISTS parent_order_id UUID REFERENCES supply_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dispatched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatch_note TEXT;

CREATE INDEX IF NOT EXISTS idx_supply_orders_parent ON supply_orders (parent_order_id) WHERE parent_order_id IS NOT NULL;

COMMENT ON COLUMN supply_orders.parent_order_id IS 'For a backorder: the partly confirmed order it carries on from';
COMMENT ON COLUMN supply_orders.dispatch_note IS 'Transporter, LR or vehicle number given when the supplier marked the order dispatched';
