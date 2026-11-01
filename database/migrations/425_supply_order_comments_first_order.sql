-- 425: Talk on an order, and order in the same step as asking to connect.
--   * supply_order_comments: a thread on each Supplier Hub order, visible to both businesses.
--   * status 'awaiting_link': a buyer's first order from a supplier's public catalogue, sent with
--     the connection request (connection_request_id). Accepting the request turns it into a
--     normal pending order; declining or withdrawing cancels it.

CREATE TABLE IF NOT EXISTS supply_order_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id UUID NOT NULL REFERENCES supply_orders(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (length(trim(body)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_supply_order_comments_order ON supply_order_comments (order_id, created_at);

ALTER TABLE supply_orders DROP CONSTRAINT IF EXISTS supply_orders_status_check;
ALTER TABLE supply_orders ADD CONSTRAINT supply_orders_status_check
  CHECK (status IN ('awaiting_link', 'draft', 'proposed', 'pending', 'confirmed', 'partial', 'declined',
                    'invoiced', 'dispatched', 'received', 'cancelled'));

ALTER TABLE supply_orders
  ADD COLUMN IF NOT EXISTS connection_request_id UUID REFERENCES supplier_connection_requests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_supply_orders_connection_request
  ON supply_orders (connection_request_id) WHERE connection_request_id IS NOT NULL;
