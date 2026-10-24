-- Where a sale came from: online store, WhatsApp bot, POS counter, a converted sales order or a
-- manually created invoice. Set by server code only; the POS screen may only ask for 'counter'.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS channel VARCHAR(20) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS sales_order_id UUID REFERENCES sales_orders(id) ON DELETE SET NULL;

ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_channel_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_channel_check
  CHECK (channel IN ('online_store', 'whatsapp', 'counter', 'manual', 'sales_order'));

UPDATE invoices SET channel = 'online_store'
 WHERE store_order_id IS NOT NULL AND channel = 'manual';

UPDATE invoices i
   SET sales_order_id = so.id,
       channel = CASE WHEN so.whatsapp_conversation_id IS NOT NULL THEN 'whatsapp' ELSE 'sales_order' END
  FROM sales_orders so
 WHERE so.converted_invoice_id = i.id
   AND so.business_id = i.business_id
   AND i.sales_order_id IS NULL
   AND i.store_order_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_business_channel ON invoices (business_id, channel, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_sales_order ON invoices (sales_order_id) WHERE sales_order_id IS NOT NULL;
