-- Supplier Hub phase 1: both sides of a link, and disconnecting it.
-- 1. The supplier's customer record for a linked buyer points at the buyer's business, so the
--    supplier's screens and invoices find that buyer by link instead of by name.
-- 2. Either side can disconnect: the buyer's supplier row keeps its history but stops granting
--    any hub access (approval_status = 'disconnected').

-- 1. Customer side of the link ----------------------------------------------------------------
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS linked_business_id UUID REFERENCES businesses(id) ON DELETE SET NULL;

COMMENT ON COLUMN customers.linked_business_id IS
  'Buyer business on Khatario this customer record stands for (Supplier Hub link)';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_customers_linked_business
  ON customers (business_id, linked_business_id)
  WHERE linked_business_id IS NOT NULL AND deleted_at IS NULL;

-- Backfill approved links where the supplier already has exactly one customer with the
-- buyer's GSTIN. Anything else is linked by the app the next time the link is approved.
WITH candidates AS (
  SELECT c.id AS customer_id, s.business_id AS buyer_id,
         COUNT(*) OVER (PARTITION BY c.business_id, s.business_id) AS n
  FROM suppliers s
  JOIN businesses b ON b.id = s.business_id
  JOIN customers c
    ON c.business_id = s.linked_business_id
   AND c.deleted_at IS NULL
   AND c.linked_business_id IS NULL
   AND NULLIF(UPPER(TRIM(c.gstin)), '') = NULLIF(UPPER(TRIM(b.gstin)), '')
  WHERE s.linked_business_id IS NOT NULL
    AND s.approval_status = 'approved'
    AND s.deleted_at IS NULL
)
UPDATE customers c
SET linked_business_id = cand.buyer_id
FROM candidates cand
WHERE c.id = cand.customer_id
  AND cand.n = 1
  AND NOT EXISTS (
    SELECT 1 FROM customers c2
    WHERE c2.business_id = c.business_id
      AND c2.linked_business_id = cand.buyer_id
      AND c2.deleted_at IS NULL
  );

-- 2. Disconnected links -----------------------------------------------------------------------
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS disconnected_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS disconnected_by_business_id UUID REFERENCES businesses(id) ON DELETE SET NULL;

ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS chk_supplier_approval_status;
ALTER TABLE suppliers ADD CONSTRAINT chk_supplier_approval_status
  CHECK (approval_status IN ('pending', 'approved', 'rejected', 'none', 'disconnected'));

COMMENT ON COLUMN suppliers.disconnected_at IS
  'When either side ended the Supplier Hub link; past documents stay, hub access stops';
