-- Phase 1: Add document type classification to invoices
-- This enables proper GSTR-1 categorization (B2B, B2C Large, B2C Small, Export, SEZ, etc.)

-- Add document classification columns
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS document_type VARCHAR(50) DEFAULT 'regular',
  ADD COLUMN IF NOT EXISTS supply_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS export_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS shipping_bill_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS shipping_bill_date DATE,
  ADD COLUMN IF NOT EXISTS port_code VARCHAR(10),
  ADD COLUMN IF NOT EXISTS ecommerce_operator_gstin VARCHAR(15),
  ADD COLUMN IF NOT EXISTS is_ecommerce_supply BOOLEAN DEFAULT false;

-- Auto-classify existing invoices based on business rules
-- Note: This is a best-effort classification. Manual review may be needed.

-- B2B: Customer has GSTIN
UPDATE invoices i
SET supply_type = 'b2b'
WHERE i.supply_type IS NULL
  AND EXISTS (
    SELECT 1 FROM customers c 
    WHERE c.id = i.customer_id 
    AND c.gstin IS NOT NULL 
    AND c.gstin != ''
  );

-- B2C Large: Invoice value > ₹2.5 lakh and no GSTIN
UPDATE invoices i
SET supply_type = 'b2c_large'
WHERE i.supply_type IS NULL
  AND i.grand_total > 250000
  AND (
    i.customer_id IS NULL 
    OR NOT EXISTS (
      SELECT 1 FROM customers c 
      WHERE c.id = i.customer_id 
      AND c.gstin IS NOT NULL 
      AND c.gstin != ''
    )
  );

-- B2C Small: Invoice value <= ₹2.5 lakh and no GSTIN
UPDATE invoices i
SET supply_type = 'b2c_small'
WHERE i.supply_type IS NULL
  AND i.grand_total <= 250000
  AND (
    i.customer_id IS NULL 
    OR NOT EXISTS (
      SELECT 1 FROM customers c 
      WHERE c.id = i.customer_id 
      AND c.gstin IS NOT NULL 
      AND c.gstin != ''
    )
  );

-- Export: Place of supply state code = '96' (export) or '97' (SEZ)
UPDATE invoices i
SET supply_type = CASE 
    WHEN i.place_of_supply_state_code = '96' THEN 'export'
    WHEN i.place_of_supply_state_code = '97' THEN 'sez'
    ELSE i.supply_type
  END
WHERE i.supply_type IS NULL
  AND i.place_of_supply_state_code IN ('96', '97');

-- Add comments
COMMENT ON COLUMN invoices.document_type IS 'Document type: regular, bill_of_supply, export_invoice, etc.';
COMMENT ON COLUMN invoices.supply_type IS 'Supply type: b2b, b2c_large, b2c_small, export, sez, deemed_export';
COMMENT ON COLUMN invoices.export_type IS 'Export type: wop (without payment), wp (with payment)';
COMMENT ON COLUMN invoices.ecommerce_operator_gstin IS 'GSTIN of e-commerce operator if applicable';
COMMENT ON COLUMN invoices.is_ecommerce_supply IS 'Whether this is an e-commerce supply';

