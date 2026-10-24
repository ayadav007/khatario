-- repair: QA Run 1 master data (M1, M4, M-VAL, M-UQC, S8, N2-form)
--   1. Business and supplier PAN backfilled from characters 3-12 of the GSTIN where PAN is empty.
--   2. businesses.aggregate_turnover_above_5cr drives the HSN digit rule
--      (Notification 78/2020-CT: 4 digits for B2B below Rs 5 cr, 6 digits for all invoices above).
--   3. items.uqc holds the GST Unit Quantity Code used in the GSTR-1 HSN summary; backfilled from items.unit.
--   4. invoices.prices_include_gst stores the invoice-level "prices include GST" choice.
--   5. credit_note_items.hsn_sac so note lines carry HSN like debit_note_items already do.
--   6. LIFO removed from items.valuation_method (not permitted under Ind AS 2 / AS 2); any LIFO item becomes FIFO.
-- Safe to re-run: every step is IF NOT EXISTS or only touches rows still needing the change.

UPDATE businesses
   SET pan = UPPER(SUBSTRING(TRIM(gstin) FROM 3 FOR 10))
 WHERE (pan IS NULL OR TRIM(pan) = '')
   AND gstin IS NOT NULL
   AND LENGTH(TRIM(gstin)) = 15
   AND UPPER(SUBSTRING(TRIM(gstin) FROM 3 FOR 10)) ~ '^[A-Z]{5}[0-9]{4}[A-Z]$';

UPDATE suppliers
   SET pan = UPPER(SUBSTRING(TRIM(gstin) FROM 3 FOR 10))
 WHERE (pan IS NULL OR TRIM(pan) = '')
   AND gstin IS NOT NULL
   AND LENGTH(TRIM(gstin)) = 15
   AND UPPER(SUBSTRING(TRIM(gstin) FROM 3 FOR 10)) ~ '^[A-Z]{5}[0-9]{4}[A-Z]$';

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS aggregate_turnover_above_5cr BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE items ADD COLUMN IF NOT EXISTS uqc VARCHAR(3);

-- Mirrors lib/gst/uqc.ts toGstUqc(); services (SAC 99xxxx) report NA.
UPDATE items
   SET uqc = CASE
     WHEN hsn_sac LIKE '99%' THEN 'NA'
     ELSE CASE UPPER(REGEXP_REPLACE(COALESCE(unit, ''), '[.\s]', '', 'g'))
       WHEN 'KG' THEN 'KGS' WHEN 'KGS' THEN 'KGS' WHEN 'KILO' THEN 'KGS' WHEN 'KILOGRAM' THEN 'KGS' WHEN 'KILOGRAMS' THEN 'KGS'
       WHEN 'G' THEN 'GMS' WHEN 'GM' THEN 'GMS' WHEN 'GMS' THEN 'GMS' WHEN 'GRAM' THEN 'GMS' WHEN 'GRAMS' THEN 'GMS'
       WHEN 'L' THEN 'LTR' WHEN 'LT' THEN 'LTR' WHEN 'LTR' THEN 'LTR' WHEN 'LITRE' THEN 'LTR' WHEN 'LITER' THEN 'LTR'
       WHEN 'LITRES' THEN 'LTR' WHEN 'LITERS' THEN 'LTR'
       WHEN 'ML' THEN 'MLT' WHEN 'MLT' THEN 'MLT'
       WHEN 'M' THEN 'MTR' WHEN 'MT' THEN 'MTR' WHEN 'MTR' THEN 'MTR' WHEN 'METER' THEN 'MTR' WHEN 'METRE' THEN 'MTR'
       WHEN 'METERS' THEN 'MTR' WHEN 'METRES' THEN 'MTR'
       WHEN 'CM' THEN 'CMS' WHEN 'CMS' THEN 'CMS' WHEN 'KM' THEN 'KME'
       WHEN 'PC' THEN 'PCS' WHEN 'PCS' THEN 'PCS' WHEN 'PIECE' THEN 'PCS' WHEN 'PIECES' THEN 'PCS'
       WHEN 'NO' THEN 'NOS' WHEN 'NOS' THEN 'NOS' WHEN 'NUMBER' THEN 'NOS' WHEN 'NUMBERS' THEN 'NOS'
       WHEN 'EA' THEN 'NOS' WHEN 'EACH' THEN 'NOS'
       WHEN 'UNIT' THEN 'UNT' WHEN 'UNITS' THEN 'UNT' WHEN 'UNT' THEN 'UNT'
       WHEN 'DOZEN' THEN 'DOZ' WHEN 'DOZ' THEN 'DOZ' WHEN 'PAIR' THEN 'PRS' WHEN 'PAIRS' THEN 'PRS' WHEN 'PRS' THEN 'PRS'
       WHEN 'PKT' THEN 'PAC' WHEN 'PACK' THEN 'PAC' WHEN 'PACKET' THEN 'PAC' WHEN 'PAC' THEN 'PAC'
       WHEN 'BOTTLE' THEN 'BTL' WHEN 'BOTTLES' THEN 'BTL' WHEN 'BTL' THEN 'BTL'
       WHEN 'ROLL' THEN 'ROL' WHEN 'ROLLS' THEN 'ROL' WHEN 'ROL' THEN 'ROL'
       WHEN 'TONNE' THEN 'TON' WHEN 'TONNES' THEN 'TON' WHEN 'TON' THEN 'TON'
       WHEN 'QUINTAL' THEN 'QTL' WHEN 'QTL' THEN 'QTL'
       WHEN 'SQFT' THEN 'SQF' WHEN 'SQF' THEN 'SQF' WHEN 'SQMT' THEN 'SQM' WHEN 'SQM' THEN 'SQM'
       WHEN 'CARTON' THEN 'CTN' WHEN 'CARTONS' THEN 'CTN' WHEN 'CTN' THEN 'CTN'
       WHEN 'BOX' THEN 'BOX' WHEN 'BAG' THEN 'BAG' WHEN 'CAN' THEN 'CAN' WHEN 'SET' THEN 'SET'
       WHEN 'HOUR' THEN 'NA' WHEN 'HOURS' THEN 'NA' WHEN 'HRS' THEN 'NA' WHEN 'SERVICE' THEN 'NA'
       ELSE 'OTH'
     END
   END
 WHERE uqc IS NULL;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS prices_include_gst BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE credit_note_items ADD COLUMN IF NOT EXISTS hsn_sac VARCHAR(10);

UPDATE credit_note_items cni
   SET hsn_sac = i.hsn_sac
  FROM items i
 WHERE cni.item_id = i.id
   AND cni.hsn_sac IS NULL
   AND i.hsn_sac IS NOT NULL;

UPDATE items SET valuation_method = 'fifo' WHERE valuation_method = 'lifo';

ALTER TABLE items DROP CONSTRAINT IF EXISTS items_valuation_method_check;
ALTER TABLE items
  ADD CONSTRAINT items_valuation_method_check CHECK (valuation_method IN ('fifo', 'weighted_avg', 'simple'));
