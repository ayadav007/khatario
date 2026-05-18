-- Migration 118: Stock Reservation System
-- Enables reserving stock for pending orders/transfers to prevent overselling

CREATE TABLE IF NOT EXISTS stock_reservations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES business_locations(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  variant_id UUID REFERENCES item_variants(id) ON DELETE CASCADE,
  quantity DECIMAL(15, 3) NOT NULL,
  reserved_for_type VARCHAR(50) NOT NULL, -- 'sales_order', 'transfer', 'adjustment', 'manual'
  reserved_for_id UUID, -- ID of the order/transfer/etc
  status VARCHAR(20) NOT NULL DEFAULT 'active', -- 'active', 'fulfilled', 'cancelled', 'expired'
  expires_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id),
  fulfilled_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  cancelled_by UUID REFERENCES users(id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_stock_reservations_business ON stock_reservations(business_id);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_location ON stock_reservations(location_id);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_item ON stock_reservations(item_id);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_variant ON stock_reservations(variant_id);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_status ON stock_reservations(status);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_type ON stock_reservations(reserved_for_type, reserved_for_id);
CREATE INDEX IF NOT EXISTS idx_stock_reservations_expires ON stock_reservations(expires_at) WHERE expires_at IS NOT NULL;

-- Add comments
COMMENT ON TABLE stock_reservations IS 'Reserves stock for pending orders/transfers to prevent overselling';
COMMENT ON COLUMN stock_reservations.reserved_for_type IS 'Type of entity reserving stock: sales_order, transfer, adjustment, manual';
COMMENT ON COLUMN stock_reservations.reserved_for_id IS 'ID of the entity reserving stock';
COMMENT ON COLUMN stock_reservations.status IS 'Reservation status: active, fulfilled, cancelled, expired';
COMMENT ON COLUMN stock_reservations.expires_at IS 'When reservation expires. NULL means no expiration.';
