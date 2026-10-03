-- One delivery record per shipment for every sales channel (online store, WhatsApp, counter,
-- manual, sales order). An order may ship in parts (seq 1, 2, ...). Every status change is kept
-- in order_fulfilment_events, which drives the order timeline, buyer updates and the public
-- tracking page (looked up by public_token only).

CREATE TABLE IF NOT EXISTS order_fulfilments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
  channel VARCHAR(20) NOT NULL DEFAULT 'manual',
  store_order_id UUID REFERENCES store_orders(id) ON DELETE CASCADE,
  sales_order_id UUID REFERENCES sales_orders(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  seq SMALLINT NOT NULL DEFAULT 1,
  buyer_name VARCHAR(255),
  buyer_phone VARCHAR(20),
  status VARCHAR(24) NOT NULL DEFAULT 'new',
  method VARCHAR(16),
  partner_name VARCHAR(100),
  awb VARCHAR(100),
  tracking_url TEXT,
  rider_name VARCHAR(100),
  rider_phone VARCHAR(20),
  pickup_code VARCHAR(8),
  proof_photo_url TEXT,
  cod_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  cod_collected_at TIMESTAMPTZ,
  failure_reason TEXT,
  public_token VARCHAR(48) NOT NULL,
  notified_statuses TEXT[] NOT NULL DEFAULT '{}',
  status_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT order_fulfilments_channel_check
    CHECK (channel IN ('online_store', 'whatsapp', 'counter', 'manual', 'sales_order')),
  CONSTRAINT order_fulfilments_status_check
    CHECK (status IN ('new', 'confirmed', 'packed', 'ready_for_pickup', 'shipped', 'out_for_delivery',
                      'delivered', 'delivery_failed', 'returned', 'cancelled')),
  CONSTRAINT order_fulfilments_method_check
    CHECK (method IS NULL OR method IN ('pickup', 'own_rider', 'shiprocket', 'courier', 'local_app')),
  CONSTRAINT order_fulfilments_cod_check CHECK (cod_amount >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_order_fulfilments_token ON order_fulfilments (public_token);
CREATE UNIQUE INDEX IF NOT EXISTS uq_order_fulfilments_store_seq
  ON order_fulfilments (store_order_id, seq) WHERE store_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_order_fulfilments_sales_seq
  ON order_fulfilments (sales_order_id, seq) WHERE sales_order_id IS NOT NULL AND store_order_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_order_fulfilments_invoice_seq
  ON order_fulfilments (invoice_id, seq) WHERE invoice_id IS NOT NULL AND store_order_id IS NULL AND sales_order_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_order_fulfilments_business_status
  ON order_fulfilments (business_id, status, status_changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_fulfilments_awb ON order_fulfilments (business_id, awb) WHERE awb IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_fulfilments_phone ON order_fulfilments (business_id, buyer_phone);

CREATE TABLE IF NOT EXISTS order_fulfilment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fulfilment_id UUID NOT NULL REFERENCES order_fulfilments(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  status VARCHAR(24) NOT NULL,
  note TEXT,
  actor_type VARCHAR(16) NOT NULL DEFAULT 'staff',
  -- No FK: the timeline must not block an order action or a user delete.
  actor_user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT order_fulfilment_events_actor_check CHECK (actor_type IN ('staff', 'webhook', 'system', 'bot'))
);

CREATE INDEX IF NOT EXISTS idx_order_fulfilment_events_fulfilment
  ON order_fulfilment_events (fulfilment_id, created_at);

-- Buyer WhatsApp updates per status and the "not dispatched" alert threshold.
ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS order_update_settings JSONB NOT NULL DEFAULT '{}'::jsonb;

-- One row per sale across channels: store orders, sales orders (incl. unpaid WhatsApp drafts) and
-- invoices that did not come from either. Delivery fields come from the first fulfilment; a
-- counter sale with no record counts as delivered, a plain invoice with none is "not tracked" (NULL).
-- Always filter by business_id.
DROP VIEW IF EXISTS order_hub;
CREATE VIEW order_hub AS
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
