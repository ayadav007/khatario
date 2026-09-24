-- Fulfilment: pack-by-scan, courier AWB scan, COD cash, dispatch choice

ALTER TABLE store_order_items
  ADD COLUMN IF NOT EXISTS packed_qty DECIMAL(10,3) NOT NULL DEFAULT 0;

ALTER TABLE store_orders
  ADD COLUMN IF NOT EXISTS dispatch_mode VARCHAR(16),
  ADD COLUMN IF NOT EXISTS courier_scanned_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS cash_collected_at TIMESTAMP;

COMMENT ON COLUMN store_orders.dispatch_mode IS 'pickup | self | shiprocket';
