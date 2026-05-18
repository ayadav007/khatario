-- Migration 120: Update all location_id references to warehouse_id
-- Updates tables that reference business_locations to use warehouses instead

-- Step 1: Update invoice_items.location_id to warehouse_id
ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS warehouse_id UUID;

-- Map old location_id to warehouse_id using temp_location_mapping
UPDATE invoice_items ii
SET warehouse_id = (
  SELECT tlm.new_warehouse_id 
  FROM temp_location_mapping tlm 
  WHERE tlm.old_location_id = ii.location_id
  LIMIT 1
)
WHERE ii.location_id IS NOT NULL AND ii.warehouse_id IS NULL;

-- Drop old foreign key and add new one
ALTER TABLE invoice_items
  DROP CONSTRAINT IF EXISTS invoice_items_location_id_fkey;

ALTER TABLE invoice_items
  DROP COLUMN IF EXISTS location_id;

ALTER TABLE invoice_items
  RENAME COLUMN warehouse_id TO location_id;

ALTER TABLE invoice_items
  ADD CONSTRAINT invoice_items_location_id_fkey 
    FOREIGN KEY (location_id) REFERENCES warehouses(id) ON DELETE SET NULL;

-- Step 2: Update credit_note_items.location_id to warehouse_id
ALTER TABLE credit_note_items
  ADD COLUMN IF NOT EXISTS warehouse_id UUID;

UPDATE credit_note_items cni
SET warehouse_id = (
  SELECT tlm.new_warehouse_id 
  FROM temp_location_mapping tlm 
  WHERE tlm.old_location_id = cni.location_id
  LIMIT 1
)
WHERE cni.location_id IS NOT NULL AND cni.warehouse_id IS NULL;

ALTER TABLE credit_note_items
  DROP CONSTRAINT IF EXISTS credit_note_items_location_id_fkey;

ALTER TABLE credit_note_items
  DROP COLUMN IF EXISTS location_id;

ALTER TABLE credit_note_items
  RENAME COLUMN warehouse_id TO location_id;

ALTER TABLE credit_note_items
  ADD CONSTRAINT credit_note_items_location_id_fkey 
    FOREIGN KEY (location_id) REFERENCES warehouses(id) ON DELETE SET NULL;

-- Step 3: Update stock_movements.location_id to warehouse_id
ALTER TABLE stock_movements
  ADD COLUMN IF NOT EXISTS warehouse_id UUID;

UPDATE stock_movements sm
SET warehouse_id = (
  SELECT tlm.new_warehouse_id 
  FROM temp_location_mapping tlm 
  WHERE tlm.old_location_id = sm.location_id
  LIMIT 1
)
WHERE sm.location_id IS NOT NULL AND sm.warehouse_id IS NULL;

ALTER TABLE stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_location_id_fkey;

ALTER TABLE stock_movements
  DROP COLUMN IF EXISTS location_id;

ALTER TABLE stock_movements
  RENAME COLUMN warehouse_id TO location_id;

ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_location_id_fkey 
    FOREIGN KEY (location_id) REFERENCES warehouses(id) ON DELETE SET NULL;

-- Step 4: Update inventory_adjustments.location_id to warehouse_id
ALTER TABLE inventory_adjustments
  ADD COLUMN IF NOT EXISTS warehouse_id UUID;

UPDATE inventory_adjustments ia
SET warehouse_id = (
  SELECT tlm.new_warehouse_id 
  FROM temp_location_mapping tlm 
  WHERE tlm.old_location_id = ia.location_id
  LIMIT 1
)
WHERE ia.location_id IS NOT NULL AND ia.warehouse_id IS NULL;

ALTER TABLE inventory_adjustments
  DROP CONSTRAINT IF EXISTS inventory_adjustments_location_id_fkey;

ALTER TABLE inventory_adjustments
  DROP COLUMN IF EXISTS location_id;

ALTER TABLE inventory_adjustments
  RENAME COLUMN warehouse_id TO location_id;

ALTER TABLE inventory_adjustments
  ADD CONSTRAINT inventory_adjustments_location_id_fkey 
    FOREIGN KEY (location_id) REFERENCES warehouses(id) ON DELETE SET NULL;

-- Step 5: Update item_batches.location_id to warehouse_id
ALTER TABLE item_batches
  ADD COLUMN IF NOT EXISTS warehouse_id UUID;

UPDATE item_batches ib
SET warehouse_id = (
  SELECT tlm.new_warehouse_id 
  FROM temp_location_mapping tlm 
  WHERE tlm.old_location_id = ib.location_id
  LIMIT 1
)
WHERE ib.location_id IS NOT NULL AND ib.warehouse_id IS NULL;

ALTER TABLE item_batches
  DROP CONSTRAINT IF EXISTS item_batches_location_id_fkey;

ALTER TABLE item_batches
  DROP COLUMN IF EXISTS location_id;

ALTER TABLE item_batches
  RENAME COLUMN warehouse_id TO location_id;

ALTER TABLE item_batches
  ADD CONSTRAINT item_batches_location_id_fkey 
    FOREIGN KEY (location_id) REFERENCES warehouses(id) ON DELETE SET NULL;

-- Step 6: Update item_serials.location_id to warehouse_id
ALTER TABLE item_serials
  ADD COLUMN IF NOT EXISTS warehouse_id UUID;

UPDATE item_serials iser
SET warehouse_id = (
  SELECT tlm.new_warehouse_id 
  FROM temp_location_mapping tlm 
  WHERE tlm.old_location_id = iser.location_id
  LIMIT 1
)
WHERE iser.location_id IS NOT NULL AND iser.warehouse_id IS NULL;

ALTER TABLE item_serials
  DROP CONSTRAINT IF EXISTS item_serials_location_id_fkey;

ALTER TABLE item_serials
  DROP COLUMN IF EXISTS location_id;

ALTER TABLE item_serials
  RENAME COLUMN warehouse_id TO location_id;

ALTER TABLE item_serials
  ADD CONSTRAINT item_serials_location_id_fkey 
    FOREIGN KEY (location_id) REFERENCES warehouses(id) ON DELETE SET NULL;

-- Step 7: Update stock_reservations.location_id to warehouse_id
ALTER TABLE stock_reservations
  ADD COLUMN IF NOT EXISTS warehouse_id UUID;

UPDATE stock_reservations sr
SET warehouse_id = (
  SELECT tlm.new_warehouse_id 
  FROM temp_location_mapping tlm 
  WHERE tlm.old_location_id = sr.location_id
  LIMIT 1
)
WHERE sr.location_id IS NOT NULL AND sr.warehouse_id IS NULL;

ALTER TABLE stock_reservations
  DROP CONSTRAINT IF EXISTS stock_reservations_location_id_fkey;

ALTER TABLE stock_reservations
  DROP COLUMN IF EXISTS location_id;

ALTER TABLE stock_reservations
  RENAME COLUMN warehouse_id TO location_id;

ALTER TABLE stock_reservations
  ADD CONSTRAINT stock_reservations_location_id_fkey 
    FOREIGN KEY (location_id) REFERENCES warehouses(id) ON DELETE CASCADE;

-- Step 8: Update user_warehouses.warehouse_id (already references business_locations)
ALTER TABLE user_warehouses
  ADD COLUMN IF NOT EXISTS new_warehouse_id UUID;

UPDATE user_warehouses uw
SET new_warehouse_id = (
  SELECT tlm.new_warehouse_id 
  FROM temp_location_mapping tlm 
  WHERE tlm.old_location_id = uw.warehouse_id
  LIMIT 1
)
WHERE uw.new_warehouse_id IS NULL;

ALTER TABLE user_warehouses
  DROP CONSTRAINT IF EXISTS user_warehouses_warehouse_id_fkey;

ALTER TABLE user_warehouses
  DROP COLUMN IF EXISTS warehouse_id;

ALTER TABLE user_warehouses
  RENAME COLUMN new_warehouse_id TO warehouse_id;

ALTER TABLE user_warehouses
  ADD CONSTRAINT user_warehouses_warehouse_id_fkey 
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE;

-- Step 9: Update closing_stock_valuations if it exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'closing_stock_valuations') THEN
    ALTER TABLE closing_stock_valuations
      ADD COLUMN IF NOT EXISTS warehouse_id UUID;

    UPDATE closing_stock_valuations csv
    SET warehouse_id = (
      SELECT tlm.new_warehouse_id 
      FROM temp_location_mapping tlm 
      WHERE tlm.old_location_id::text = csv.location_id::text
      LIMIT 1
    )
    WHERE csv.location_id IS NOT NULL AND csv.warehouse_id IS NULL;

    ALTER TABLE closing_stock_valuations
      DROP CONSTRAINT IF EXISTS closing_stock_valuations_location_id_fkey;

    ALTER TABLE closing_stock_valuations
      DROP COLUMN IF EXISTS location_id;

    ALTER TABLE closing_stock_valuations
      RENAME COLUMN warehouse_id TO location_id;

    ALTER TABLE closing_stock_valuations
      ADD CONSTRAINT closing_stock_valuations_location_id_fkey 
        FOREIGN KEY (location_id) REFERENCES warehouses(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Update index names to reflect warehouse_id
DROP INDEX IF EXISTS idx_invoice_items_location;
CREATE INDEX IF NOT EXISTS idx_invoice_items_warehouse ON invoice_items(location_id);

DROP INDEX IF EXISTS idx_credit_note_items_location;
CREATE INDEX IF NOT EXISTS idx_credit_note_items_warehouse ON credit_note_items(location_id);

DROP INDEX IF EXISTS idx_stock_movements_location;
CREATE INDEX IF NOT EXISTS idx_stock_movements_warehouse ON stock_movements(location_id);

DROP INDEX IF EXISTS idx_inventory_adjustments_location_id;
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_warehouse ON inventory_adjustments(location_id);

DROP INDEX IF EXISTS idx_item_batches_location;
CREATE INDEX IF NOT EXISTS idx_item_batches_warehouse ON item_batches(location_id);

DROP INDEX IF EXISTS idx_item_serials_location;
CREATE INDEX IF NOT EXISTS idx_item_serials_warehouse ON item_serials(location_id);

DROP INDEX IF EXISTS idx_stock_reservations_location;
CREATE INDEX IF NOT EXISTS idx_stock_reservations_warehouse ON stock_reservations(location_id);

-- Note: temp_location_mapping will be dropped automatically when session ends
-- For persistent mapping, we'll keep business_locations table for reference (can be dropped later)
