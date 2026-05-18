-- Refactor: Add itc_type to purchase_items for GSTR-9 compliance
-- Types: 'inputs', 'capital_goods', 'input_services'

ALTER TABLE purchase_items 
ADD COLUMN IF NOT EXISTS itc_type VARCHAR(20) CHECK (itc_type IN ('inputs', 'capital_goods', 'input_services'));

COMMENT ON COLUMN purchase_items.itc_type IS 'ITC classification for GSTR-9 Table 6. Manual entry recommended.';

