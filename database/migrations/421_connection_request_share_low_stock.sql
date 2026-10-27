-- 421: The buyer agrees to share low stock when asking to connect, so the reorder side of
-- Supplier Hub works from the first day. Accepting the request copies this onto
-- suppliers.allow_low_stock_access; the buyer can switch it off later on the supplier page.

ALTER TABLE supplier_connection_requests
  ADD COLUMN IF NOT EXISTS share_low_stock BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN supplier_connection_requests.share_low_stock IS
  'Buyer consent, given with the request, to share low stock and sales of the supplier''s items once accepted';
