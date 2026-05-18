-- Migration: Export Invoice Compliance Fields
-- Adds all mandatory fields for export invoice compliance

-- 1. Add IEC Code to businesses (MANDATORY for exporters)
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS iec_code VARCHAR(10);

-- 2. Add SWIFT Code to businesses (for international payments)
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS swift_code VARCHAR(11);

-- 3. Add Country field to customers (if not exists)
ALTER TABLE customers ADD COLUMN IF NOT EXISTS country VARCHAR(100) DEFAULT 'India';

-- 4. Add currency and exchange rate fields to invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_currency VARCHAR(3) DEFAULT 'INR';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(10,4);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS base_currency_amount DECIMAL(12,2);

-- 5. Add shipping and export details to invoices
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS country_of_origin VARCHAR(100) DEFAULT 'India';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS port_of_loading VARCHAR(100);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS port_of_discharge VARCHAR(100);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS place_of_delivery VARCHAR(255);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS incoterms VARCHAR(10); -- EXW, FOB, CIF, DDP, etc.
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS awb_number VARCHAR(100); -- Air Waybill Number
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS bl_number VARCHAR(100); -- Bill of Lading Number
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS buyer_tax_id VARCHAR(50); -- Buyer's Tax/VAT ID

-- 6. Add transport mode field (if not exists)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS transport_mode VARCHAR(50); -- Air, Sea, Road, Courier

-- 7. Add export declaration fields
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS export_declaration TEXT; -- Custom export declaration
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS lut_declaration BOOLEAN DEFAULT false; -- Whether LUT declaration is shown

-- Create index for faster queries on export invoices
CREATE INDEX IF NOT EXISTS idx_invoices_is_export ON invoices(is_export) WHERE is_export = true;
CREATE INDEX IF NOT EXISTS idx_invoices_export_type ON invoices(export_type) WHERE export_type IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN businesses.iec_code IS 'Import Export Code - Mandatory for exporters';
COMMENT ON COLUMN businesses.swift_code IS 'SWIFT/BIC code for international wire transfers';
COMMENT ON COLUMN customers.country IS 'Country of destination for export invoices';
COMMENT ON COLUMN invoices.invoice_currency IS 'Currency in which invoice is issued (USD, EUR, etc.)';
COMMENT ON COLUMN invoices.exchange_rate IS 'Exchange rate from invoice currency to INR';
COMMENT ON COLUMN invoices.base_currency_amount IS 'Invoice amount in base currency (INR)';
COMMENT ON COLUMN invoices.country_of_origin IS 'Country of origin of goods (usually India)';
COMMENT ON COLUMN invoices.port_of_loading IS 'Port from where goods are loaded for export';
COMMENT ON COLUMN invoices.port_of_discharge IS 'Port where goods are discharged';
COMMENT ON COLUMN invoices.place_of_delivery IS 'Final place of delivery';
COMMENT ON COLUMN invoices.incoterms IS 'International Commercial Terms (EXW, FOB, CIF, DDP, etc.)';
COMMENT ON COLUMN invoices.awb_number IS 'Air Waybill Number for air shipments';
COMMENT ON COLUMN invoices.bl_number IS 'Bill of Lading Number for sea shipments';
COMMENT ON COLUMN invoices.buyer_tax_id IS 'Buyer Tax/VAT ID for foreign customers';

