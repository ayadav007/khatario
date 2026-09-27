-- Invoices cancelled before the cancel route reversed the books still carry their sales,
-- output GST and receivable lines, and the customer balance still includes them.
-- Reverse each such voucher once (same voucher id, same date) and take it off the customer.
DO $$
DECLARE
    inv RECORD;
BEGIN
    FOR inv IN
        SELECT i.id, i.business_id, i.customer_id, i.invoice_number, i.grand_total, i.document_type
          FROM invoices i
         WHERE i.status = 'cancelled'
           AND EXISTS (
                 SELECT 1 FROM ledger_entry_lines l
                  WHERE l.business_id = i.business_id AND l.voucher_type = 'invoice' AND l.voucher_id = i.id)
           AND NOT EXISTS (
                 SELECT 1 FROM ledger_entry_lines l
                  WHERE l.business_id = i.business_id AND l.voucher_type = 'invoice' AND l.voucher_id = i.id
                    AND l.narration LIKE 'Reversal:%')
    LOOP
        INSERT INTO ledger_entry_lines (
            business_id, voucher_id, voucher_type, account_id, entry_date,
            debit, credit, narration, reference_number, branch_id
        )
        SELECT l.business_id, l.voucher_id, l.voucher_type, l.account_id, l.entry_date,
               l.credit, l.debit,
               LEFT('Reversal: Invoice ' || inv.invoice_number || ' cancelled (' || COALESCE(l.narration, '') || ')', 500),
               l.reference_number, l.branch_id
          FROM ledger_entry_lines l
         WHERE l.business_id = inv.business_id AND l.voucher_type = 'invoice' AND l.voucher_id = inv.id;

        IF inv.customer_id IS NOT NULL AND COALESCE(inv.document_type, '') <> 'proforma_invoice' THEN
            UPDATE customers
               SET current_balance = current_balance - COALESCE(inv.grand_total, 0),
                   updated_at = CURRENT_TIMESTAMP
             WHERE id = inv.customer_id AND business_id = inv.business_id;
        END IF;

        UPDATE invoices SET balance_amount = 0 WHERE id = inv.id;
    END LOOP;
END $$;
