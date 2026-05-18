-- Migration 077: Batch and Serial Number Tracking for Advanced Inventory
-- Adds support for batch tracking, serial number tracking, and advanced stock valuation methods

-- Add tracking and valuation fields to items table
ALTER TABLE items 
ADD COLUMN IF NOT EXISTS track_batch BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS track_serial BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS valuation_method VARCHAR(20) DEFAULT 'simple' 
  CHECK (valuation_method IN ('fifo', 'lifo', 'weighted_avg', 'simple'));

-- Create item_batches table for batch tracking
CREATE TABLE IF NOT EXISTS item_batches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    variant_id UUID REFERENCES item_variants(id) ON DELETE CASCADE,
    batch_number VARCHAR(255) NOT NULL,
    manufacturing_date DATE,
    expiry_date DATE,
    purchase_price DECIMAL(15,2) NOT NULL,
    quantity DECIMAL(15,3) NOT NULL DEFAULT 0,
    location_id UUID REFERENCES business_locations(id) ON DELETE SET NULL,
    supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(item_id, variant_id, batch_number, location_id)
);

-- Create item_serials table for serial number tracking
CREATE TABLE IF NOT EXISTS item_serials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    variant_id UUID REFERENCES item_variants(id) ON DELETE CASCADE,
    serial_number VARCHAR(255) NOT NULL,
    batch_id UUID REFERENCES item_batches(id) ON DELETE SET NULL,
    purchase_price DECIMAL(15,2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'available' 
      CHECK (status IN ('available', 'sold', 'returned', 'damaged', 'scrapped')),
    location_id UUID REFERENCES business_locations(id) ON DELETE SET NULL,
    supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL,
    sold_to_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    sold_invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    sold_at TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(item_id, variant_id, serial_number)
);

-- Modify stock_movements table to support batch/serial tracking
ALTER TABLE stock_movements
ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES item_batches(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS serial_id UUID REFERENCES item_serials(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(15,2);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_item_batches_item_id ON item_batches(item_id);
CREATE INDEX IF NOT EXISTS idx_item_batches_batch_number ON item_batches(item_id, variant_id, batch_number);
CREATE INDEX IF NOT EXISTS idx_item_batches_location ON item_batches(location_id);
CREATE INDEX IF NOT EXISTS idx_item_batches_expiry ON item_batches(expiry_date) WHERE expiry_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_item_serials_item_id ON item_serials(item_id);
CREATE INDEX IF NOT EXISTS idx_item_serials_serial_number ON item_serials(item_id, variant_id, serial_number);
CREATE INDEX IF NOT EXISTS idx_item_serials_status ON item_serials(status);
CREATE INDEX IF NOT EXISTS idx_item_serials_location ON item_serials(location_id);
CREATE INDEX IF NOT EXISTS idx_item_serials_batch ON item_serials(batch_id);
CREATE INDEX IF NOT EXISTS idx_item_serials_sold ON item_serials(sold_invoice_id) WHERE sold_invoice_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_movements_batch ON stock_movements(batch_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_serial ON stock_movements(serial_id);

-- Add triggers for updated_at
CREATE TRIGGER update_item_batches_updated_at
    BEFORE UPDATE ON item_batches
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_item_serials_updated_at
    BEFORE UPDATE ON item_serials
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Add comments
COMMENT ON TABLE item_batches IS 'Tracks batches/lots of items for FIFO/LIFO valuation and expiry management';
COMMENT ON TABLE item_serials IS 'Tracks individual serial numbers for items requiring serial number tracking';
COMMENT ON COLUMN items.track_batch IS 'Enable batch tracking for this item';
COMMENT ON COLUMN items.track_serial IS 'Enable serial number tracking for this item';
COMMENT ON COLUMN items.valuation_method IS 'Stock valuation method: fifo, lifo, weighted_avg, or simple';
COMMENT ON COLUMN item_batches.batch_number IS 'Unique batch/lot number for this item';
COMMENT ON COLUMN item_serials.serial_number IS 'Unique serial number for this item';
COMMENT ON COLUMN item_serials.status IS 'Current status: available, sold, returned, damaged, scrapped';

