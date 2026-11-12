-- Migration 474: paying an invoice online from its public link, and measuring reminder recovery
-- 1. invoice_online_payments: one row per "Pay now" on /i/<token>. The gateway's verified notice
--    posts a receipt against that invoice once (lib/invoices/online-pay.ts). The business and the
--    invoice come from this row, never from the gateway payload.
-- 2. whatsapp_messages.amount_due: what the invoice still owed when a reminder went out, so the
--    recovery dashboard can say how much was chased (older rows fall back to an estimate).
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS invoice_online_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  provider VARCHAR(16) NOT NULL CHECK (provider IN ('razorpay', 'easebuzz')),
  payment_ref VARCHAR(80),
  provider_payment_id VARCHAR(80),
  status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  settled_amount DECIMAL(12,2),
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoice_online_payments_ref
  ON invoice_online_payments (provider, payment_ref) WHERE payment_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_online_payments_provider_payment
  ON invoice_online_payments (provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoice_online_payments_invoice
  ON invoice_online_payments (business_id, invoice_id, created_at DESC);

ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS amount_due DECIMAL(15,2);

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_invoice_reminders
  ON whatsapp_messages (business_id, reference_id, sent_at)
  WHERE message_type = 'reminder' AND reference_type = 'invoice' AND status = 'sent';
