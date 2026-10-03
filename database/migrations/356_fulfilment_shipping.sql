-- Migration 356: delivery address and box count per shipment, for shipping labels.
-- ship_address / ship_pincode override the order's address (store order, invoice, sales order
-- or customer record) when staff correct or fill it in at dispatch.

ALTER TABLE order_fulfilments
  ADD COLUMN IF NOT EXISTS ship_address TEXT,
  ADD COLUMN IF NOT EXISTS ship_pincode VARCHAR(10),
  ADD COLUMN IF NOT EXISTS packages SMALLINT NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_fulfilments_packages_check') THEN
    ALTER TABLE order_fulfilments
      ADD CONSTRAINT order_fulfilments_packages_check CHECK (packages BETWEEN 1 AND 50);
  END IF;
END $$;
