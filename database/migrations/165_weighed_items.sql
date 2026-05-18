-- Migration 165: Weighed / PLU items
--
-- Adds the minimal data needed to print weight- or price-embedded EAN-13
-- barcodes (the kind supermarket scales and pre-pack operators use):
--
--   Digit 1    : '2'       (GS1 in-store / variable-measure indicator)
--   Digit 2    : mode      ('1' = weight, '2' = price)
--   Digit 3-7  : PLU code  (zero-padded 5-digit item identifier)
--   Digit 8-12 : measure   (grams OR paise, zero-padded 5 digits)
--   Digit 13   : EAN-13 check digit
--
-- The app generates the actual barcode at label-print time; on the DB side
-- we only need to know:
--
--   1. Is this item sold by weight / variable price? -> is_weighed
--   2. Which PLU does the scale/operator reference?  -> plu_code
--   3. Does the embedded digits encode weight or price? -> weight_barcode_mode

ALTER TABLE items
    ADD COLUMN IF NOT EXISTS is_weighed BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS plu_code VARCHAR(10),
    ADD COLUMN IF NOT EXISTS weight_barcode_mode VARCHAR(10)
        NOT NULL DEFAULT 'weight'
        CHECK (weight_barcode_mode IN ('weight', 'price'));

-- PLU codes are only required when the item is flagged as weighed; they must
-- be unique within a business so the scale scans to exactly one item.
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_plu_per_business
    ON items(business_id, plu_code)
    WHERE plu_code IS NOT NULL AND plu_code <> '';

-- Fast path for label-printing queries that need every weighed item.
CREATE INDEX IF NOT EXISTS idx_items_is_weighed
    ON items(business_id, is_weighed)
    WHERE is_weighed = TRUE;

COMMENT ON COLUMN items.is_weighed IS
    'True when the item is sold by weight or variable price, and its label uses an EAN-13 with GS1 prefix 2';
COMMENT ON COLUMN items.plu_code IS
    '4-5 digit Price Lookup code embedded in the weight/price barcode (digits 3-7)';
COMMENT ON COLUMN items.weight_barcode_mode IS
    'What the 5-digit measure portion of the barcode encodes: weight (grams) or price (paise)';
