-- Supplier PAN drives s.206AA (higher TDS when the deductee has no PAN). Registered
-- suppliers' PAN is characters 3-12 of their GSTIN, so backfill it from there.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS pan VARCHAR(10);
UPDATE suppliers
   SET pan = UPPER(SUBSTRING(TRIM(gstin) FROM 3 FOR 10))
 WHERE pan IS NULL
   AND gstin IS NOT NULL
   AND UPPER(TRIM(gstin)) ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}$';

ALTER TABLE tds_transactions ADD COLUMN IF NOT EXISTS payee_pan VARCHAR(10);
ALTER TABLE tds_transactions ADD COLUMN IF NOT EXISTS higher_rate_206aa BOOLEAN NOT NULL DEFAULT false;

-- TDS withheld by customers on receipts (credited to 1116 TDS Receivable; claimed via 26AS).
ALTER TABLE payments ADD COLUMN IF NOT EXISTS tds_amount DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS tds_section VARCHAR(20);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tds_received DECIMAL(12,2) NOT NULL DEFAULT 0;
