-- Migration 444: Store khata (order from the online store, pay on the customer's settlement day)
-- Description: A business opens a khata (running credit account) for a customer with a settlement
--   day of the month. That customer can order from the online store on khata; the order posts an
--   invoice like cash on delivery but with nothing to collect, due on the next settlement date.
--   Business rules decide what happens when the customer is over the credit limit or has overdue
--   bills (block, warn and allow, or send to the business for approval), with per-customer overrides.
--   Statements are stored per settlement date; online khata payments are tracked until settled.
--   Plan: docs/plan/STORE_KHATA.md
-- Created: 2026-10-29

-- Customer khata account
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS khata_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS khata_settlement_day SMALLINT,
  ADD COLUMN IF NOT EXISTS khata_over_limit_rule VARCHAR(10),
  ADD COLUMN IF NOT EXISTS khata_overdue_rule VARCHAR(10),
  ADD COLUMN IF NOT EXISTS khata_opened_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS khata_requested_at TIMESTAMP;

ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_khata_settlement_day_check;
ALTER TABLE customers
  ADD CONSTRAINT customers_khata_settlement_day_check
  CHECK (khata_settlement_day IS NULL OR khata_settlement_day BETWEEN 0 AND 28);
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_khata_open_needs_day_check;
ALTER TABLE customers
  ADD CONSTRAINT customers_khata_open_needs_day_check
  CHECK (NOT khata_enabled OR khata_settlement_day IS NOT NULL);
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_khata_over_limit_rule_check;
ALTER TABLE customers
  ADD CONSTRAINT customers_khata_over_limit_rule_check
  CHECK (khata_over_limit_rule IS NULL OR khata_over_limit_rule IN ('block', 'warn', 'approval'));
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_khata_overdue_rule_check;
ALTER TABLE customers
  ADD CONSTRAINT customers_khata_overdue_rule_check
  CHECK (khata_overdue_rule IS NULL OR khata_overdue_rule IN ('block', 'warn', 'approval'));

CREATE INDEX IF NOT EXISTS idx_customers_khata
  ON customers (business_id, khata_settlement_day)
  WHERE khata_enabled = true AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_customers_khata_requested
  ON customers (business_id, khata_requested_at)
  WHERE khata_requested_at IS NOT NULL AND khata_enabled = false AND deleted_at IS NULL;

COMMENT ON COLUMN customers.khata_enabled IS 'Store khata open: the customer may order from the online store on credit.';
COMMENT ON COLUMN customers.khata_settlement_day IS 'Day of month the khata statement is made and payment is due: 1 to 28, or 0 for the last day of the month.';
COMMENT ON COLUMN customers.khata_over_limit_rule IS 'Override of business_settings.khata_over_limit_rule for this customer; NULL uses the business rule.';
COMMENT ON COLUMN customers.khata_overdue_rule IS 'Override of business_settings.khata_overdue_rule for this customer; NULL uses the business rule.';
COMMENT ON COLUMN customers.khata_requested_at IS 'When the shopper asked for a khata from the online store; cleared when the khata is opened.';

-- Business khata rules
ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS khata_over_limit_rule VARCHAR(10) NOT NULL DEFAULT 'approval',
  ADD COLUMN IF NOT EXISTS khata_overdue_rule VARCHAR(10) NOT NULL DEFAULT 'approval',
  ADD COLUMN IF NOT EXISTS khata_grace_days SMALLINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS khata_reminder_interval_days SMALLINT NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS khata_allow_part_payment BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS khata_statements_enabled BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE business_settings DROP CONSTRAINT IF EXISTS business_settings_khata_rules_check;
ALTER TABLE business_settings
  ADD CONSTRAINT business_settings_khata_rules_check CHECK (
    khata_over_limit_rule IN ('block', 'warn', 'approval')
    AND khata_overdue_rule IN ('block', 'warn', 'approval')
    AND khata_grace_days BETWEEN 0 AND 60
    AND khata_reminder_interval_days BETWEEN 1 AND 30
  );

-- Store shopper to customer link (set when a khata is opened or requested)
ALTER TABLE store_customers
  ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_store_customers_customer
  ON store_customers (customer_id) WHERE customer_id IS NOT NULL;

-- Khata store orders: payment_status 'cod' with payment_provider 'khata'
ALTER TABLE store_orders
  ADD COLUMN IF NOT EXISTS khata_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS khata_due_date DATE,
  ADD COLUMN IF NOT EXISTS khata_approval VARCHAR(10),
  ADD COLUMN IF NOT EXISTS khata_approval_reason VARCHAR(20);

ALTER TABLE store_orders DROP CONSTRAINT IF EXISTS store_orders_khata_approval_check;
ALTER TABLE store_orders
  ADD CONSTRAINT store_orders_khata_approval_check CHECK (
    (khata_approval IS NULL OR khata_approval IN ('pending', 'approved', 'rejected'))
    AND (khata_approval_reason IS NULL OR khata_approval_reason IN ('over_limit', 'overdue', 'over_limit_overdue'))
  );
CREATE INDEX IF NOT EXISTS idx_store_orders_khata_pending
  ON store_orders (business_id, created_at)
  WHERE khata_approval = 'pending';
CREATE INDEX IF NOT EXISTS idx_store_orders_khata_customer
  ON store_orders (khata_customer_id) WHERE khata_customer_id IS NOT NULL;

COMMENT ON COLUMN store_orders.khata_customer_id IS 'Khata orders: the customer whose khata the order is on; the invoice uses this customer.';
COMMENT ON COLUMN store_orders.khata_due_date IS 'Khata orders: settlement date the order is due on.';
COMMENT ON COLUMN store_orders.khata_approval IS 'Khata orders sent to the business: pending (no invoice yet), approved, rejected (order cancelled).';

-- Statements, one per customer per settlement date
CREATE TABLE IF NOT EXISTS khata_statements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  statement_date DATE NOT NULL,
  due_date DATE NOT NULL,
  opening_due DECIMAL(12,2) NOT NULL DEFAULT 0,
  charges DECIMAL(12,2) NOT NULL DEFAULT 0,
  payments DECIMAL(12,2) NOT NULL DEFAULT 0,
  closing_due DECIMAL(12,2) NOT NULL DEFAULT 0,
  public_token VARCHAR(48) NOT NULL,
  sent_at TIMESTAMP,
  last_reminder_at TIMESTAMP,
  reminder_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, customer_id, statement_date),
  UNIQUE (public_token)
);
CREATE INDEX IF NOT EXISTS idx_khata_statements_customer
  ON khata_statements (business_id, customer_id, statement_date DESC);

-- Online khata payments (store gateway), settled across open bills when the gateway confirms
CREATE TABLE IF NOT EXISTS khata_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  store_customer_id UUID REFERENCES store_customers(id) ON DELETE SET NULL,
  amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
  provider VARCHAR(16) NOT NULL CHECK (provider IN ('razorpay', 'easebuzz')),
  payment_ref VARCHAR(80),
  provider_payment_id VARCHAR(80),
  status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
  settled_amount DECIMAL(12,2),
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_khata_payments_ref
  ON khata_payments (provider, payment_ref) WHERE payment_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_khata_payments_provider_payment
  ON khata_payments (provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_khata_payments_customer
  ON khata_payments (business_id, customer_id, created_at DESC);

-- Orders hub: report khata store orders as 'khata' (approved or not needing approval) or
-- 'khata_pending' (waiting for the business), so no screen offers to collect cash for them.
-- Same columns as migration 355; only the store payment_status expression changes.
CREATE OR REPLACE VIEW order_hub AS
SELECT
  'store_order'::text AS source_type,
  so.id AS source_id,
  so.business_id,
  so.branch_id,
  'online_store'::varchar AS channel,
  so.order_number::text AS order_number,
  so.invoice_id,
  inv.invoice_number::text AS invoice_number,
  inv.customer_id,
  so.customer_name::text AS customer_name,
  so.customer_phone::text AS customer_phone,
  so.grand_total::numeric AS amount,
  CASE
    WHEN so.payment_status = 'cod' AND so.cash_collected_at IS NOT NULL THEN 'paid'
    -- Migration 444: khata orders have nothing to collect; 'khata_pending' waits for approval.
    WHEN so.payment_status = 'cod' AND so.payment_provider = 'khata' THEN
      CASE WHEN so.khata_approval = 'pending' THEN 'khata_pending' ELSE 'khata' END
    ELSE so.payment_status
  END::text AS payment_status,
  so.status::text AS order_status,
  NULL::uuid AS whatsapp_conversation_id,
  f.id AS fulfilment_id,
  COALESCE(f.status, CASE so.status
    WHEN 'pending' THEN 'new'
    WHEN 'confirmed' THEN 'confirmed'
    WHEN 'ready' THEN CASE WHEN so.delivery_mode = 'pickup' THEN 'ready_for_pickup' ELSE 'shipped' END
    WHEN 'delivered' THEN 'delivered'
    WHEN 'cancelled' THEN 'cancelled'
  END)::text AS delivery_status,
  COALESCE(f.method, CASE WHEN so.delivery_mode = 'pickup' THEN 'pickup' END)::text AS method,
  f.partner_name, COALESCE(f.awb, so.awb)::text AS awb, COALESCE(f.tracking_url, so.tracking_url) AS tracking_url,
  f.rider_name, f.rider_phone, f.pickup_code, f.public_token,
  COALESCE(f.cod_amount, 0) AS cod_amount, f.cod_collected_at,
  so.created_at::timestamptz AS created_at,
  COALESCE(f.status_changed_at, so.updated_at::timestamptz) AS status_changed_at
FROM store_orders so
LEFT JOIN invoices inv ON inv.id = so.invoice_id
LEFT JOIN LATERAL (
  SELECT * FROM order_fulfilments x WHERE x.store_order_id = so.id ORDER BY x.seq LIMIT 1
) f ON TRUE

UNION ALL

SELECT
  'sales_order'::text,
  s.id,
  s.business_id,
  COALESCE(f.branch_id, inv.branch_id),
  CASE WHEN s.whatsapp_conversation_id IS NOT NULL THEN 'whatsapp' ELSE 'sales_order' END::varchar,
  s.order_number::text,
  s.converted_invoice_id,
  inv.invoice_number::text,
  s.customer_id,
  COALESCE(f.buyer_name, c.name, wc.whatsapp_display_name)::text,
  COALESCE(f.buyer_phone, c.phone, wc.conversation_id)::text,
  s.grand_total::numeric,
  COALESCE(NULLIF(inv.payment_status, ''), s.payment_status, 'unpaid')::text,
  s.status::text,
  s.whatsapp_conversation_id,
  f.id,
  COALESCE(f.status, CASE
    WHEN s.status IN ('cancelled', 'rejected') THEN 'cancelled'
    WHEN s.status = 'draft' THEN 'new'
    ELSE 'confirmed'
  END)::text,
  f.method::text,
  f.partner_name, f.awb::text, f.tracking_url,
  f.rider_name, f.rider_phone, f.pickup_code, f.public_token,
  COALESCE(f.cod_amount, 0), f.cod_collected_at,
  s.created_at::timestamptz,
  COALESCE(f.status_changed_at, s.updated_at::timestamptz)
FROM sales_orders s
LEFT JOIN invoices inv ON inv.id = s.converted_invoice_id
LEFT JOIN customers c ON c.id = s.customer_id
LEFT JOIN whatsapp_conversations wc ON wc.id = s.whatsapp_conversation_id
LEFT JOIN LATERAL (
  SELECT * FROM order_fulfilments x
   WHERE x.sales_order_id = s.id AND x.store_order_id IS NULL
   ORDER BY x.seq LIMIT 1
) f ON TRUE

UNION ALL

SELECT
  'invoice'::text,
  i.id,
  i.business_id,
  i.branch_id,
  i.channel,
  i.invoice_number::text,
  i.id,
  i.invoice_number::text,
  i.customer_id,
  COALESCE(f.buyer_name, c.name)::text,
  COALESCE(f.buyer_phone, c.phone)::text,
  i.grand_total::numeric,
  i.payment_status::text,
  i.status::text,
  NULL::uuid,
  f.id,
  COALESCE(f.status, CASE
    WHEN i.status = 'cancelled' THEN 'cancelled'
    WHEN i.channel = 'counter' THEN 'delivered'
  END)::text,
  COALESCE(f.method, CASE WHEN i.channel = 'counter' THEN 'pickup' END)::text,
  f.partner_name, f.awb::text, f.tracking_url,
  f.rider_name, f.rider_phone, f.pickup_code, f.public_token,
  COALESCE(f.cod_amount, 0), f.cod_collected_at,
  i.created_at::timestamptz,
  COALESCE(f.status_changed_at, i.updated_at::timestamptz)
FROM invoices i
LEFT JOIN customers c ON c.id = i.customer_id
LEFT JOIN LATERAL (
  SELECT * FROM order_fulfilments x
   WHERE x.invoice_id = i.id AND x.store_order_id IS NULL AND x.sales_order_id IS NULL
   ORDER BY x.seq LIMIT 1
) f ON TRUE
WHERE i.deleted_at IS NULL
  AND i.store_order_id IS NULL
  AND i.sales_order_id IS NULL
  AND i.status = 'final'
  AND COALESCE(i.document_type, 'tax_invoice') NOT IN ('proforma_invoice', 'estimate', 'quotation', 'credit_note', 'debit_note', 'delivery_challan')
  AND NOT EXISTS (SELECT 1 FROM sales_orders s2 WHERE s2.converted_invoice_id = i.id);
