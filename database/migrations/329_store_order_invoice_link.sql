-- Phase 3.5: one store order can point at only one sales invoice, and one invoice
-- can belong to only one store order. Nullable so historical orders stay unlinked.
-- No backfill of existing bare store invoices.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS store_order_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_store_order_id_fkey'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_store_order_id_fkey
      FOREIGN KEY (store_order_id) REFERENCES store_orders(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_store_order_id
  ON invoices (store_order_id) WHERE store_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_store_orders_invoice_id
  ON store_orders (invoice_id) WHERE invoice_id IS NOT NULL;
