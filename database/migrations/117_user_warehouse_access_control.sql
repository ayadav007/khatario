-- Migration 117: User-Warehouse Access Control
-- Enables restricting users to specific warehouses for security and access control

CREATE TABLE IF NOT EXISTS user_warehouses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES business_locations(id) ON DELETE CASCADE,
  can_view BOOLEAN DEFAULT true,
  can_edit BOOLEAN DEFAULT false,
  can_transfer BOOLEAN DEFAULT false,
  can_adjust BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, warehouse_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_warehouses_user ON user_warehouses(user_id);
CREATE INDEX IF NOT EXISTS idx_user_warehouses_warehouse ON user_warehouses(warehouse_id);

-- Add comments
COMMENT ON TABLE user_warehouses IS 'Maps users to warehouses they can access. If a user has no entries, they can access all warehouses (legacy behavior).';
COMMENT ON COLUMN user_warehouses.can_view IS 'User can view stock and reports for this warehouse';
COMMENT ON COLUMN user_warehouses.can_edit IS 'User can create/update transactions (purchases, sales) for this warehouse';
COMMENT ON COLUMN user_warehouses.can_transfer IS 'User can create stock transfers from/to this warehouse';
COMMENT ON COLUMN user_warehouses.can_adjust IS 'User can create inventory adjustments for this warehouse';
