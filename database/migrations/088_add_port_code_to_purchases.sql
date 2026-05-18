-- Add port_code field to purchases table for import classification
-- This is needed for GSTR-2B import reporting

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS port_code VARCHAR(10);

COMMENT ON COLUMN purchases.port_code IS 'Port code for imports (Bill of Entry)';

