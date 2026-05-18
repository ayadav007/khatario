-- Phase 1: Create debit_notes table
-- This enables reporting of sales-side adjustments in GSTR-1 Table 9B

CREATE TABLE IF NOT EXISTS debit_notes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
    invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
    debit_note_number VARCHAR(100) NOT NULL,
    debit_note_date DATE NOT NULL,
    reason VARCHAR(200),
    subtotal DECIMAL(15, 2) NOT NULL DEFAULT 0,
    discount_total DECIMAL(15, 2) DEFAULT 0,
    tax_total DECIMAL(15, 2) DEFAULT 0,
    cgst_total DECIMAL(12,2) DEFAULT 0,
    sgst_total DECIMAL(12,2) DEFAULT 0,
    igst_total DECIMAL(12,2) DEFAULT 0,
    round_off DECIMAL(10, 2) DEFAULT 0,
    grand_total DECIMAL(15, 2) NOT NULL DEFAULT 0,
    place_of_supply_state_code VARCHAR(2),
    original_invoice_date DATE,
    adjustment_status VARCHAR(20) NOT NULL DEFAULT 'pending', -- 'pending', 'adjusted', 'refunded'
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    CONSTRAINT unique_business_debit_note UNIQUE(business_id, debit_note_number)
);

-- Debit Note Items
CREATE TABLE IF NOT EXISTS debit_note_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    debit_note_id UUID REFERENCES debit_notes(id) ON DELETE CASCADE,
    item_id UUID REFERENCES items(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    hsn_sac VARCHAR(10),
    qty DECIMAL(10, 2) NOT NULL,
    unit VARCHAR(50),
    unit_price DECIMAL(15, 2) NOT NULL,
    discount DECIMAL(10, 2) DEFAULT 0,
    tax_rate DECIMAL(5, 2) DEFAULT 0,
    tax_amount DECIMAL(15, 2) DEFAULT 0,
    cgst_amount DECIMAL(12,2) DEFAULT 0,
    sgst_amount DECIMAL(12,2) DEFAULT 0,
    igst_amount DECIMAL(12,2) DEFAULT 0,
    taxable_value DECIMAL(12,2) DEFAULT 0,
    line_total DECIMAL(15, 2) NOT NULL,
    sort_order INTEGER DEFAULT 0
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_debit_notes_business_id ON debit_notes(business_id);
CREATE INDEX IF NOT EXISTS idx_debit_notes_customer_id ON debit_notes(customer_id);
CREATE INDEX IF NOT EXISTS idx_debit_notes_invoice_id ON debit_notes(invoice_id);
CREATE INDEX IF NOT EXISTS idx_debit_notes_date ON debit_notes(debit_note_date);
CREATE INDEX IF NOT EXISTS idx_debit_note_items_debit_note_id ON debit_note_items(debit_note_id);

-- Add update trigger
CREATE TRIGGER update_debit_notes_updated_at BEFORE UPDATE ON debit_notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add comments
COMMENT ON TABLE debit_notes IS 'Debit notes for sales-side adjustments (price corrections, additional charges)';
COMMENT ON TABLE debit_note_items IS 'Line items for debit notes';

