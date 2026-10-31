-- Migration 455: delivery challan for stock moved between godowns on one GSTIN
-- Moving goods between places of business on the same GSTIN is not a supply, so no invoice is
-- issued, but the goods still travel under a delivery challan (Rule 55(1)(c)) and, above the
-- limit, an e-way bill. A transfer now gets a paperwork-only challan linked here; the transfer
-- itself moves the stock. `to_warehouse_id` is where the goods go (the e-way bill's ship-to).
-- Safe to re-run.

ALTER TABLE delivery_challans
  -- The challan is derived from the transfer and goes with it (a NULL link would break check_challan_reference).
  ADD COLUMN IF NOT EXISTS stock_transfer_id UUID REFERENCES stock_transfers(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS to_warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_challans_stock_transfer
  ON delivery_challans (stock_transfer_id)
  WHERE stock_transfer_id IS NOT NULL;

ALTER TABLE delivery_challans DROP CONSTRAINT IF EXISTS check_challan_reference;
ALTER TABLE delivery_challans ADD CONSTRAINT check_challan_reference CHECK (
  invoice_id IS NOT NULL OR sales_order_id IS NOT NULL OR customer_id IS NOT NULL
  OR supplier_id IS NOT NULL OR stock_transfer_id IS NOT NULL
);

COMMENT ON COLUMN delivery_challans.stock_transfer_id IS 'Stock transfer this challan carries (same-GSTIN movement; no invoice).';
