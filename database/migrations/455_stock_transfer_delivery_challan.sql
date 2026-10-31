-- Migration 455: delivery challan for stock transfers under one GSTIN
-- Goods moved between places of business on the same registration are not a supply, but they
-- still travel under a delivery challan (Rule 55 CGST Rules), and an e-way bill over Rs 50,000.
-- Dispatch issues that challan from the delivery challan series; this links it to the transfer.

ALTER TABLE delivery_challans
  ADD COLUMN IF NOT EXISTS stock_transfer_id UUID REFERENCES stock_transfers(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_delivery_challans_stock_transfer
  ON delivery_challans(stock_transfer_id) WHERE stock_transfer_id IS NOT NULL;

COMMENT ON COLUMN delivery_challans.stock_transfer_id IS
  'Stock transfer this challan was issued for on dispatch (both godowns on the same GSTIN)';
