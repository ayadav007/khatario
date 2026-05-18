-- Migration 078: Inventory Adjustments System
-- Supports both Quantity and Value adjustments with full audit trail and accounting integration

-- Create inventory_adjustments table
CREATE TABLE IF NOT EXISTS inventory_adjustments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    adjustment_number VARCHAR(100) NOT NULL UNIQUE,
    adjustment_date DATE NOT NULL,
    adjustment_type VARCHAR(20) NOT NULL CHECK (adjustment_type IN ('QUANTITY', 'VALUE')),
    direction VARCHAR(20) CHECK (direction IN ('INCREASE', 'DECREASE')), -- Only for QUANTITY adjustments
    item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    variant_id UUID REFERENCES item_variants(id) ON DELETE CASCADE,
    location_id UUID REFERENCES business_locations(id) ON DELETE SET NULL, -- Multi-warehouse support
    
    -- Quantity adjustment fields
    quantity_change DECIMAL(15,3), -- Signed number: positive for increase, negative for decrease
    quantity_before DECIMAL(15,3) NOT NULL,
    quantity_after DECIMAL(15,3) NOT NULL,
    
    -- Value adjustment fields
    value_change DECIMAL(15,2), -- Signed number: positive for increase, negative for decrease
    unit_cost_before DECIMAL(15,2) NOT NULL,
    unit_cost_after DECIMAL(15,2) NOT NULL,
    total_value_before DECIMAL(15,2) NOT NULL,
    total_value_after DECIMAL(15,2) NOT NULL,
    
    -- Reason and notes
    reason_code VARCHAR(50) NOT NULL CHECK (reason_code IN (
        'STOCK_TAKE', 'DAMAGE', 'THEFT', 'EXPIRED', 'FREE_SAMPLE',
        'COST_CORRECTION', 'LANDED_COST', 'REVALUATION', 'WRITE_DOWN'
    )),
    reason_notes TEXT,
    notes TEXT,
    
    -- Accounting integration
    journal_entry_id UUID, -- Reference to ledger_entries if accounting is enabled
    gst_impact DECIMAL(15,2) DEFAULT 0, -- GST impact for value adjustments
    
    -- Audit fields
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT chk_quantity_adjustment CHECK (
        (adjustment_type = 'QUANTITY' AND direction IS NOT NULL AND quantity_change IS NOT NULL) OR
        (adjustment_type = 'VALUE' AND direction IS NULL AND value_change IS NOT NULL)
    ),
    CONSTRAINT chk_quantity_non_negative CHECK (quantity_after >= 0),
    CONSTRAINT chk_value_adjustment_quantity CHECK (
        (adjustment_type = 'VALUE' AND quantity_before > 0) OR adjustment_type = 'QUANTITY'
    )
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_business_id ON inventory_adjustments(business_id);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_item_id ON inventory_adjustments(item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_variant_id ON inventory_adjustments(variant_id);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_location_id ON inventory_adjustments(location_id);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_date ON inventory_adjustments(adjustment_date);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_type ON inventory_adjustments(adjustment_type);
CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_reason ON inventory_adjustments(reason_code);

-- Update trigger for updated_at
DROP TRIGGER IF EXISTS update_inventory_adjustments_updated_at ON inventory_adjustments;
CREATE TRIGGER update_inventory_adjustments_updated_at BEFORE UPDATE ON inventory_adjustments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to generate adjustment number
CREATE OR REPLACE FUNCTION generate_adjustment_number(business_id_param UUID)
RETURNS VARCHAR(100) AS $$
DECLARE
    prefix VARCHAR(10) := 'ADJ';
    last_number INTEGER := 0;
    new_number VARCHAR(100);
BEGIN
    -- Get the last adjustment number for this business
    SELECT COALESCE(
        MAX(CAST(SUBSTRING(adjustment_number FROM '[0-9]+$') AS INTEGER)),
        0
    ) INTO last_number
    FROM inventory_adjustments
    WHERE business_id = business_id_param
    AND adjustment_number ~ ('^' || prefix || '-[0-9]+$');
    
    -- Generate new number
    new_number := prefix || '-' || LPAD((last_number + 1)::TEXT, 6, '0');
    
    RETURN new_number;
END;
$$ LANGUAGE plpgsql;

-- Add comment for documentation
COMMENT ON TABLE inventory_adjustments IS 'Inventory adjustments for quantity and value corrections with full audit trail';
COMMENT ON COLUMN inventory_adjustments.adjustment_type IS 'QUANTITY: Adjusts stock quantity. VALUE: Adjusts inventory value/unit cost';
COMMENT ON COLUMN inventory_adjustments.direction IS 'INCREASE or DECREASE (only for QUANTITY adjustments)';
COMMENT ON COLUMN inventory_adjustments.quantity_change IS 'Signed quantity change: positive for increase, negative for decrease';
COMMENT ON COLUMN inventory_adjustments.value_change IS 'Signed value change: positive for increase, negative for decrease';
COMMENT ON COLUMN inventory_adjustments.reason_code IS 'Standard reason code for the adjustment';
COMMENT ON COLUMN inventory_adjustments.journal_entry_id IS 'Reference to accounting journal entry if accounting is enabled';
