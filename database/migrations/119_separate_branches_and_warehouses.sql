-- Migration 119: Separate Branches and Warehouses
-- Critical architectural fix: Branches (accounting) vs Warehouses (inventory)
-- This migration creates separate tables and migrates existing data

-- Step 1: Create branches table (accounting/compliance entity)
CREATE TABLE IF NOT EXISTS branches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  branch_code VARCHAR(50),
  gstin VARCHAR(15),
  address_line1 VARCHAR(200),
  address_line2 VARCHAR(200),
  city VARCHAR(100),
  state VARCHAR(100),
  state_code VARCHAR(2),
  pincode VARCHAR(20),
  country VARCHAR(100) DEFAULT 'India',
  phone VARCHAR(50),
  email VARCHAR(100),
  branch_type VARCHAR(50) DEFAULT 'retail', -- 'retail', 'warehouse', 'office', 'franchise', 'online'
  is_primary BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  invoice_prefix VARCHAR(10),
  next_invoice_number INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id, branch_code)
);

-- Step 2: Create warehouses table (inventory storage entity)
CREATE TABLE IF NOT EXISTS warehouses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL, -- Optional: which branch primarily uses this
  name VARCHAR(200) NOT NULL,
  warehouse_code VARCHAR(50),
  address_line1 VARCHAR(200),
  address_line2 VARCHAR(200),
  city VARCHAR(100),
  state VARCHAR(100),
  pincode VARCHAR(20),
  country VARCHAR(100) DEFAULT 'India',
  warehouse_type VARCHAR(50) DEFAULT 'physical', -- 'physical', 'virtual', 'damaged_holding'
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Step 3: Create branch-warehouse mapping (many-to-many)
CREATE TABLE IF NOT EXISTS branch_warehouses (
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (branch_id, warehouse_id)
);

-- Step 4: Create temporary mapping table for migration
CREATE TEMP TABLE IF NOT EXISTS temp_location_mapping (
  old_location_id UUID PRIMARY KEY,
  new_branch_id UUID,
  new_warehouse_id UUID
);

-- Step 5: Migrate existing business_locations data
-- Strategy: For each business_location, create both branch and warehouse
-- This ensures we don't lose any data and can refine later
DO $$
DECLARE
  loc_record RECORD;
  new_branch_id UUID;
  new_warehouse_id UUID;
BEGIN
  FOR loc_record IN SELECT * FROM business_locations LOOP
    -- Create branch (all locations become branches for accounting)
    INSERT INTO branches (
      business_id, name, branch_code, gstin, address_line1, address_line2,
      city, state, state_code, pincode, country, phone, email,
      branch_type, is_primary, is_active, created_at, updated_at
    )
    VALUES (
      loc_record.business_id, loc_record.name, loc_record.location_code,
      loc_record.gstin, loc_record.address_line1, loc_record.address_line2,
      loc_record.city, loc_record.state, NULL, loc_record.pincode,
      COALESCE(loc_record.country, 'India'), loc_record.phone, loc_record.email,
      'retail', loc_record.is_primary, loc_record.is_active,
      loc_record.created_at, loc_record.updated_at
    )
    RETURNING id INTO new_branch_id;
    
    -- Create warehouse (all locations become warehouses for inventory)
    INSERT INTO warehouses (
      business_id, branch_id, name, warehouse_code, address_line1, address_line2,
      city, state, pincode, country, warehouse_type, is_active, created_at, updated_at
    )
    VALUES (
      loc_record.business_id, new_branch_id, loc_record.name || ' Warehouse',
      COALESCE(loc_record.location_code, '') || '-WH', loc_record.address_line1,
      loc_record.address_line2, loc_record.city, loc_record.state,
      loc_record.pincode, COALESCE(loc_record.country, 'India'),
      'physical', loc_record.is_active, loc_record.created_at, loc_record.updated_at
    )
    RETURNING id INTO new_warehouse_id;
    
    -- Link branch to warehouse
    INSERT INTO branch_warehouses (branch_id, warehouse_id, is_primary)
    VALUES (new_branch_id, new_warehouse_id, true)
    ON CONFLICT DO NOTHING;
    
    -- Store mapping
    INSERT INTO temp_location_mapping (old_location_id, new_branch_id, new_warehouse_id)
    VALUES (loc_record.id, new_branch_id, new_warehouse_id)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- Step 6: Update location_stock to reference warehouses
-- First, create mapping from old location_id to new warehouse_id
ALTER TABLE location_stock 
  ADD COLUMN IF NOT EXISTS warehouse_id UUID;

-- Update warehouse_id using mapping
UPDATE location_stock ls
SET warehouse_id = (
  SELECT tlm.new_warehouse_id 
  FROM temp_location_mapping tlm 
  WHERE tlm.old_location_id = ls.location_id
  LIMIT 1
)
WHERE warehouse_id IS NULL;

-- If no warehouse found, create one
INSERT INTO warehouses (business_id, name, warehouse_code, warehouse_type, is_active)
SELECT DISTINCT
  bl.business_id,
  bl.name || ' Warehouse',
  COALESCE(bl.location_code, '') || '-WH',
  'physical',
  bl.is_active
FROM business_locations bl
WHERE bl.id IN (
  SELECT DISTINCT location_id 
  FROM location_stock 
  WHERE warehouse_id IS NULL
)
ON CONFLICT DO NOTHING;

-- Update location_stock again with newly created warehouses
UPDATE location_stock ls
SET warehouse_id = w.id
FROM business_locations bl
JOIN warehouses w ON w.business_id = bl.business_id AND w.name LIKE bl.name || '%'
WHERE ls.location_id = bl.id AND ls.warehouse_id IS NULL;

-- Now drop old foreign key and add new one
ALTER TABLE location_stock
  DROP CONSTRAINT IF EXISTS location_stock_location_id_fkey,
  DROP CONSTRAINT IF EXISTS location_stock_warehouse_id_fkey;

ALTER TABLE location_stock
  ADD CONSTRAINT location_stock_warehouse_id_fkey 
    FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE CASCADE;

-- Rename column
ALTER TABLE location_stock 
  RENAME COLUMN location_id TO old_location_id;

ALTER TABLE location_stock 
  RENAME COLUMN warehouse_id TO location_id;

-- Update unique constraint
ALTER TABLE location_stock
  DROP CONSTRAINT IF EXISTS location_stock_location_id_item_id_key;

ALTER TABLE location_stock
  ADD CONSTRAINT location_stock_location_item_unique 
    UNIQUE (location_id, item_id);

-- Step 7: Update stock_transfers to use warehouses
ALTER TABLE stock_transfers
  ADD COLUMN IF NOT EXISTS from_warehouse_id UUID,
  ADD COLUMN IF NOT EXISTS to_warehouse_id UUID;

-- Map old location_ids to warehouse_ids
UPDATE stock_transfers st
SET from_warehouse_id = (
  SELECT tlm.new_warehouse_id 
  FROM temp_location_mapping tlm 
  WHERE tlm.old_location_id = st.from_location_id
  LIMIT 1
),
to_warehouse_id = (
  SELECT tlm.new_warehouse_id 
  FROM temp_location_mapping tlm 
  WHERE tlm.old_location_id = st.to_location_id
  LIMIT 1
);

-- Drop old columns and constraints
ALTER TABLE stock_transfers
  DROP CONSTRAINT IF EXISTS stock_transfers_from_location_id_fkey,
  DROP CONSTRAINT IF EXISTS stock_transfers_to_location_id_fkey;

ALTER TABLE stock_transfers
  DROP COLUMN IF EXISTS from_location_id,
  DROP COLUMN IF EXISTS to_location_id;

-- Rename to final names
ALTER TABLE stock_transfers
  RENAME COLUMN from_warehouse_id TO from_location_id;

ALTER TABLE stock_transfers
  RENAME COLUMN to_warehouse_id TO to_location_id;

-- Add new foreign keys
ALTER TABLE stock_transfers
  ADD CONSTRAINT stock_transfers_from_location_id_fkey 
    FOREIGN KEY (from_location_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  ADD CONSTRAINT stock_transfers_to_location_id_fkey 
    FOREIGN KEY (to_location_id) REFERENCES warehouses(id) ON DELETE RESTRICT;

-- Step 8: Update other tables that reference business_locations
-- These will be updated in subsequent migrations to avoid conflicts

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_branches_business_id ON branches(business_id);
CREATE INDEX IF NOT EXISTS idx_branches_branch_code ON branches(business_id, branch_code);
CREATE INDEX IF NOT EXISTS idx_branches_gstin ON branches(gstin) WHERE gstin IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_warehouses_business_id ON warehouses(business_id);
CREATE INDEX IF NOT EXISTS idx_warehouses_branch_id ON warehouses(branch_id);
CREATE INDEX IF NOT EXISTS idx_branch_warehouses_branch ON branch_warehouses(branch_id);
CREATE INDEX IF NOT EXISTS idx_branch_warehouses_warehouse ON branch_warehouses(warehouse_id);

-- Add comments
COMMENT ON TABLE branches IS 'Business branches - accounting and compliance entities. Each branch can have its own GSTIN, invoice numbering, and financial reporting.';
COMMENT ON TABLE warehouses IS 'Physical warehouses - inventory storage entities. Warehouses hold stock and can be shared across branches.';
COMMENT ON TABLE branch_warehouses IS 'Many-to-many mapping between branches and warehouses. A branch can use multiple warehouses, and a warehouse can serve multiple branches.';
COMMENT ON COLUMN branches.branch_type IS 'Type of branch: retail (store), warehouse (distribution center), office (admin), franchise (semi-independent), online (e-commerce)';
COMMENT ON COLUMN warehouses.warehouse_type IS 'Type of warehouse: physical (real storage), virtual (dropshipping), damaged_holding (quarantine area)';
COMMENT ON COLUMN warehouses.branch_id IS 'Primary branch that uses this warehouse. NULL if shared across branches.';
