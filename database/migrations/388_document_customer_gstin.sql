-- Customer GSTIN as it stood on the document.
-- GSTR-1 classifies a supply as B2B or B2C by the recipient's registration at the time of supply.
-- Reports read customers.gstin today, so adding or changing a GSTIN on the customer later moves
-- past invoices between B2B and B2C in returns already filed. The GSTIN is now kept on the
-- invoice / credit note / debit note: set on insert, refreshed when the customer changes or the
-- document is finalised, and frozen after that.

-- 1. Columns ---------------------------------------------------------------------------------
ALTER TABLE invoices     ADD COLUMN IF NOT EXISTS customer_gstin VARCHAR(15);
ALTER TABLE credit_notes ADD COLUMN IF NOT EXISTS customer_gstin VARCHAR(15);
ALTER TABLE debit_notes  ADD COLUMN IF NOT EXISTS customer_gstin VARCHAR(15);

-- 2. Snapshot trigger ------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_document_customer_gstin() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('final', 'active')) THEN
    IF TG_OP = 'INSERT' AND NEW.customer_gstin IS NOT NULL THEN
      NEW.customer_gstin := NULLIF(UPPER(TRIM(NEW.customer_gstin)), '');
    ELSE
      NEW.customer_gstin := (
        SELECT NULLIF(UPPER(TRIM(c.gstin)), '') FROM customers c WHERE c.id = NEW.customer_id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoices_customer_gstin ON invoices;
CREATE TRIGGER trg_invoices_customer_gstin
  BEFORE INSERT OR UPDATE OF customer_id, status ON invoices
  FOR EACH ROW EXECUTE FUNCTION set_document_customer_gstin();

DROP TRIGGER IF EXISTS trg_credit_notes_customer_gstin ON credit_notes;
CREATE TRIGGER trg_credit_notes_customer_gstin
  BEFORE INSERT OR UPDATE OF customer_id, status ON credit_notes
  FOR EACH ROW EXECUTE FUNCTION set_document_customer_gstin();

DROP TRIGGER IF EXISTS trg_debit_notes_customer_gstin ON debit_notes;
CREATE TRIGGER trg_debit_notes_customer_gstin
  BEFORE INSERT OR UPDATE OF customer_id, status ON debit_notes
  FOR EACH ROW EXECUTE FUNCTION set_document_customer_gstin();

-- 3. Backfill: the customer's current GSTIN is the best record of the past -------------------
UPDATE invoices i SET customer_gstin = NULLIF(UPPER(TRIM(c.gstin)), '')
  FROM customers c WHERE c.id = i.customer_id AND i.customer_gstin IS NULL;
UPDATE credit_notes n SET customer_gstin = NULLIF(UPPER(TRIM(c.gstin)), '')
  FROM customers c WHERE c.id = n.customer_id AND n.customer_gstin IS NULL;
UPDATE debit_notes n SET customer_gstin = NULLIF(UPPER(TRIM(c.gstin)), '')
  FROM customers c WHERE c.id = n.customer_id AND n.customer_gstin IS NULL;
