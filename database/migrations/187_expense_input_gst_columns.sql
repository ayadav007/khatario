-- Optional Input GST breakdown on expenses (ITC on B2B expense bills).
-- Ledger: Dr expense (taxable) + Dr Input CGST/SGST/IGST = Cr Cash/AP (total).

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS cgst_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sgst_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS igst_amount DECIMAL(12,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN expenses.cgst_amount IS 'Input CGST on this expense bill (ITC), if applicable';
COMMENT ON COLUMN expenses.sgst_amount IS 'Input SGST on this expense bill (ITC), if applicable';
COMMENT ON COLUMN expenses.igst_amount IS 'Input IGST on this expense bill (ITC), if applicable';
