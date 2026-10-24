-- Due date on purchase bills, like invoices.due_date. Payables ageing (lib/reports/party-ledger-docs.ts)
-- ages a bill from its due date and treats bills not yet due as "Not due", as Zoho Books does.
-- NULL means due on the bill date. Re-runnable.

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS due_date DATE;

COMMENT ON COLUMN purchases.due_date IS
  'Date the bill is payable by. NULL = due on bill_date. Used by payables ageing.';

ALTER TABLE purchases DROP CONSTRAINT IF EXISTS purchases_due_date_after_bill_date;
ALTER TABLE purchases ADD CONSTRAINT purchases_due_date_after_bill_date
  CHECK (due_date IS NULL OR bill_date IS NULL OR due_date >= bill_date);
