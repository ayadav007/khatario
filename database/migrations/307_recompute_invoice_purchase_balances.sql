-- Invoice balance = value + active debit notes - active credit notes - receipts.
-- Reverse-charge bills owe the supplier the value net of GST (paid to government instead).
WITH inv AS (
  SELECT i.id,
         COALESCE(i.paid_amount, 0) AS paid,
         GREATEST(0, ROUND(
           i.grand_total
           + COALESCE((SELECT SUM(d.grand_total) FROM debit_notes d
                        WHERE d.invoice_id = i.id AND d.business_id = i.business_id AND d.status = 'active'), 0)
           - COALESCE((SELECT SUM(c.grand_total) FROM credit_notes c
                        WHERE c.invoice_id = i.id AND c.business_id = i.business_id AND c.status = 'active'), 0)
           - COALESCE(i.paid_amount, 0), 2)) AS balance
    FROM invoices i
   WHERE i.status <> 'cancelled'
     AND i.deleted_at IS NULL
     AND (EXISTS (SELECT 1 FROM debit_notes d WHERE d.invoice_id = i.id)
          OR EXISTS (SELECT 1 FROM credit_notes c WHERE c.invoice_id = i.id))
)
UPDATE invoices i
   SET balance_amount = inv.balance,
       payment_status = CASE WHEN inv.paid <= 0.01 THEN 'unpaid'
                             WHEN inv.balance <= 0.01 THEN 'paid'
                             ELSE 'partially_paid' END,
       updated_at = CURRENT_TIMESTAMP
  FROM inv
 WHERE i.id = inv.id
   AND (i.balance_amount IS DISTINCT FROM inv.balance);

WITH pur AS (
  SELECT p.id,
         COALESCE(p.paid_amount, 0) + COALESCE(p.tds_deducted, 0) AS settled,
         GREATEST(0, ROUND(
           p.grand_total - COALESCE(p.tax_total, 0)
           - COALESCE(p.paid_amount, 0) - COALESCE(p.tds_deducted, 0), 2)) AS balance
    FROM purchases p
   WHERE p.is_reverse_charge = true
     AND COALESCE(p.status, '') <> 'cancelled'
     AND p.deleted_at IS NULL
)
UPDATE purchases p
   SET balance_amount = pur.balance,
       payment_status = CASE WHEN pur.settled <= 0.01 THEN 'unpaid'
                             WHEN pur.balance <= 0.01 THEN 'paid'
                             ELSE 'partially_paid' END,
       updated_at = CURRENT_TIMESTAMP
  FROM pur
 WHERE p.id = pur.id
   AND (p.balance_amount IS DISTINCT FROM pur.balance);
