-- Phase 1: Add state_code to customers and suppliers
-- This enables programmatic Place of Supply determination

-- Add state_code to customers
ALTER TABLE customers 
  ADD COLUMN IF NOT EXISTS state_code VARCHAR(2);

-- Add state_code to suppliers
ALTER TABLE suppliers 
  ADD COLUMN IF NOT EXISTS state_code VARCHAR(2);

-- Backfill state_code from state name (if possible)
-- Note: This mapping may need manual correction based on actual state names in your data
-- Common mappings:
UPDATE customers 
SET state_code = CASE 
    WHEN UPPER(state) LIKE '%KARNATAKA%' THEN '29'
    WHEN UPPER(state) LIKE '%MAHARASHTRA%' THEN '27'
    WHEN UPPER(state) LIKE '%TAMIL%' OR UPPER(state) LIKE '%TAMIL NADU%' THEN '33'
    WHEN UPPER(state) LIKE '%GUJARAT%' THEN '24'
    WHEN UPPER(state) LIKE '%DELHI%' THEN '07'
    WHEN UPPER(state) LIKE '%WEST BENGAL%' THEN '19'
    WHEN UPPER(state) LIKE '%RAJASTHAN%' THEN '08'
    WHEN UPPER(state) LIKE '%UP%' OR UPPER(state) LIKE '%UTTAR PRADESH%' THEN '09'
    WHEN UPPER(state) LIKE '%PUNJAB%' THEN '03'
    WHEN UPPER(state) LIKE '%HARYANA%' THEN '06'
    -- Add more mappings as needed
    ELSE NULL
  END
WHERE state_code IS NULL AND state IS NOT NULL;

UPDATE suppliers 
SET state_code = CASE 
    WHEN UPPER(state) LIKE '%KARNATAKA%' THEN '29'
    WHEN UPPER(state) LIKE '%MAHARASHTRA%' THEN '27'
    WHEN UPPER(state) LIKE '%TAMIL%' OR UPPER(state) LIKE '%TAMIL NADU%' THEN '33'
    WHEN UPPER(state) LIKE '%GUJARAT%' THEN '24'
    WHEN UPPER(state) LIKE '%DELHI%' THEN '07'
    WHEN UPPER(state) LIKE '%WEST BENGAL%' THEN '19'
    WHEN UPPER(state) LIKE '%RAJASTHAN%' THEN '08'
    WHEN UPPER(state) LIKE '%UP%' OR UPPER(state) LIKE '%UTTAR PRADESH%' THEN '09'
    WHEN UPPER(state) LIKE '%PUNJAB%' THEN '03'
    WHEN UPPER(state) LIKE '%HARYANA%' THEN '06'
    -- Add more mappings as needed
    ELSE NULL
  END
WHERE state_code IS NULL AND state IS NOT NULL;

-- Add comments
COMMENT ON COLUMN customers.state_code IS '2-digit GST state code (e.g., 29 for Karnataka)';
COMMENT ON COLUMN suppliers.state_code IS '2-digit GST state code (e.g., 29 for Karnataka)';

