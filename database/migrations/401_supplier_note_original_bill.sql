-- Supplier credit and debit notes keep the original supplier invoice beside the note number.
-- Amounts on the purchase stay positive. Document type decides the accounting sign.

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS original_bill_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS original_bill_date DATE;

COMMENT ON COLUMN purchases.original_bill_number IS
  'Supplier invoice this credit or debit note adjusts. Not a second purchase.';
COMMENT ON COLUMN purchases.document_type IS
  'tax_invoice, bill_of_supply, bill_of_entry, import_service, supplier_credit_note, supplier_debit_note';
