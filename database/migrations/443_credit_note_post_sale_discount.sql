-- Migration 443: Post-sale discount credit notes (s.15(3)(b) CGST Act as substituted by Finance Act 2026)
-- Description: A credit note can now be a post-sale discount over a period of supplies instead of a
--   sales return against one invoice. It carries no items and no stock, links no invoice, and records
--   the supply period it covers. The period's first day sets the s.34(2) deadline and is stored as
--   original_invoice_date so GSTR-1 and GSTR-9 read it as before. Existing rows are sales returns.
-- Created: 2026-10-29

ALTER TABLE credit_notes
  ADD COLUMN IF NOT EXISTS note_type VARCHAR(20) NOT NULL DEFAULT 'sales_return',
  ADD COLUMN IF NOT EXISTS supply_period_from DATE,
  ADD COLUMN IF NOT EXISTS supply_period_to DATE;

ALTER TABLE credit_notes DROP CONSTRAINT IF EXISTS credit_notes_note_type_check;
ALTER TABLE credit_notes
  ADD CONSTRAINT credit_notes_note_type_check CHECK (note_type IN ('sales_return', 'post_sale_discount'));

ALTER TABLE credit_notes DROP CONSTRAINT IF EXISTS credit_notes_discount_period_check;
ALTER TABLE credit_notes
  ADD CONSTRAINT credit_notes_discount_period_check CHECK (
    note_type <> 'post_sale_discount'
    OR (supply_period_from IS NOT NULL AND supply_period_to IS NOT NULL AND supply_period_from <= supply_period_to)
  );

COMMENT ON COLUMN credit_notes.note_type IS
  'sales_return: goods come back, usually against one invoice. post_sale_discount: s.15(3)(b) discount over a supply period, no invoice link, no stock.';
COMMENT ON COLUMN credit_notes.supply_period_from IS 'post_sale_discount only: first day of the supplies the discount covers.';
COMMENT ON COLUMN credit_notes.supply_period_to IS 'post_sale_discount only: last day of the supplies the discount covers.';
