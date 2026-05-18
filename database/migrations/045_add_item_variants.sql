-- Migration to add Item Variants and offline support fields
ALTER TABLE items ADD COLUMN IF NOT EXISTS has_variants BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS item_variants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    item_id UUID REFERENCES items(id) ON DELETE CASCADE,
    variant_name VARCHAR(255) NOT NULL, -- e.g., 'Blue / L'
    sku VARCHAR(100),
    barcode VARCHAR(100),
    purchase_price DECIMAL(12,2),
    selling_price DECIMAL(12,2),
    opening_stock DECIMAL(10,2) DEFAULT 0,
    current_stock DECIMAL(10,2) DEFAULT 0,
    attributes JSONB DEFAULT '{}', -- e.g., {"color": "Blue", "size": "L"}
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_item_variants_item_id ON item_variants(item_id);

-- Add variant_id to transaction tables
ALTER TABLE invoice_items ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES item_variants(id) ON DELETE SET NULL;
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES item_variants(id) ON DELETE SET NULL;
ALTER TABLE stock_movements ADD COLUMN IF NOT EXISTS variant_id UUID REFERENCES item_variants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoice_items_variant_id ON invoice_items(variant_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_variant_id ON purchase_items(variant_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_variant_id ON stock_movements(variant_id);

-- Update trigger for item_variants
DROP TRIGGER IF EXISTS update_item_variants_updated_at ON item_variants;
CREATE TRIGGER update_item_variants_updated_at BEFORE UPDATE ON item_variants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

