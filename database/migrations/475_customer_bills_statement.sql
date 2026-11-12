-- Migration 475: one combined payment reminder per customer, with a pay-all bills page
-- 1. customers.bills_public_token: the customer's public "your bills" page (/b/<token>), which the
--    combined reminder links to. Unguessable; made on first use.
-- 2. invoice_online_payments can now pay several bills of one customer: invoice_id is NULL and
--    invoice_ids holds the bills the customer picked (NULL = all open bills, oldest due first).
--    invoice_online_payment_allocations records each receipt the payment posted, per invoice.
-- 3. whatsapp_messages.batch_id: one combined reminder is logged as one row per invoice it chased
--    (so per-invoice dedupe and recovery keep working); the rows share a batch_id.
-- Safe to re-run. Needs migration 474.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS bills_public_token VARCHAR(40);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_bills_public_token
  ON customers (bills_public_token) WHERE bills_public_token IS NOT NULL;

ALTER TABLE invoice_online_payments ALTER COLUMN invoice_id DROP NOT NULL;
ALTER TABLE invoice_online_payments ADD COLUMN IF NOT EXISTS invoice_ids UUID[];
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoice_online_payments_target_chk') THEN
    ALTER TABLE invoice_online_payments
      ADD CONSTRAINT invoice_online_payments_target_chk CHECK (invoice_id IS NOT NULL OR customer_id IS NOT NULL);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS invoice_online_payment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  online_payment_id UUID NOT NULL REFERENCES invoice_online_payments(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (online_payment_id, invoice_id)
);
CREATE INDEX IF NOT EXISTS idx_invoice_online_payment_allocations_invoice
  ON invoice_online_payment_allocations (business_id, invoice_id);

-- Single-invoice payments made before this migration get their allocation row.
INSERT INTO invoice_online_payment_allocations (business_id, online_payment_id, invoice_id, payment_id, amount)
SELECT p.business_id, p.id, p.invoice_id, p.payment_id, p.settled_amount
  FROM invoice_online_payments p
 WHERE p.status = 'paid' AND p.invoice_id IS NOT NULL AND COALESCE(p.settled_amount, 0) > 0
ON CONFLICT (online_payment_id, invoice_id) DO NOTHING;

ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS batch_id UUID;
