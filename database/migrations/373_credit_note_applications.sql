-- Credit from a paid sales return can be applied to a later invoice.
-- The portion that only clears an unpaid bill is not spendable and is marked adjusted.

CREATE TABLE IF NOT EXISTS credit_note_applications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    credit_note_id UUID NOT NULL REFERENCES credit_notes(id) ON DELETE RESTRICT,
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
    amount DECIMAL(15, 2) NOT NULL CHECK (amount > 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id),
    reversed_at TIMESTAMP,
    reversed_by UUID REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_credit_note_applications_note
    ON credit_note_applications (business_id, credit_note_id)
    WHERE reversed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_credit_note_applications_invoice
    ON credit_note_applications (business_id, invoice_id)
    WHERE reversed_at IS NULL;

-- Notes that were fully used to cancel the bill they were raised against are not waiting for a refund.
UPDATE credit_notes cn
   SET refund_status = 'adjusted',
       refund_mode = COALESCE(NULLIF(cn.refund_mode, ''), 'adjusted_to_invoice'),
       updated_at = CURRENT_TIMESTAMP
  FROM invoices i
 WHERE i.id = cn.invoice_id
   AND i.business_id = cn.business_id
   AND cn.status = 'active'
   AND cn.refund_status = 'pending'
   AND (
     cn.grand_total - LEAST(
       cn.grand_total,
       GREATEST(
         0,
         COALESCE(i.grand_total, 0)
         + COALESCE((
             SELECT SUM(d.grand_total) FROM debit_notes d
              WHERE d.invoice_id = i.id AND d.business_id = cn.business_id AND d.status = 'active'
           ), 0)
         - COALESCE(i.paid_amount, 0)
         - COALESCE(i.tds_received, 0)
         - COALESCE(i.advance_adjusted, 0)
         - COALESCE((
             SELECT SUM(earlier.grand_total) FROM credit_notes earlier
              WHERE earlier.invoice_id = cn.invoice_id
                AND earlier.business_id = cn.business_id
                AND earlier.status = 'active'
                AND earlier.id <> cn.id
                AND (earlier.created_at, earlier.id) < (cn.created_at, cn.id)
           ), 0)
       )
     ) - COALESCE(cn.refund_amount, 0)
   ) <= 0.005;
