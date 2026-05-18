-- Migration 155: Customer and invoice billing/shipping address columns
-- Fixes 42703 when POST /api/customers or POST /api/invoices references columns
-- that were never added on older databases (API expects them).

-- ---------------------------------------------------------------------------
-- customers: align with app/api/customers/route.ts INSERT
-- ---------------------------------------------------------------------------
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS billing_address TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address TEXT,
  ADD COLUMN IF NOT EXISTS shipping_city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS shipping_state VARCHAR(100),
  ADD COLUMN IF NOT EXISTS shipping_pincode VARCHAR(20);

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS country VARCHAR(100) DEFAULT 'India';

COMMENT ON COLUMN customers.billing_address IS 'Billing address (may duplicate address for legacy)';
COMMENT ON COLUMN customers.shipping_address IS 'Shipping / delivery address';

-- ---------------------------------------------------------------------------
-- invoices: align with app/api/invoices/route.ts INSERT paths
-- ---------------------------------------------------------------------------
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS billing_address TEXT,
  ADD COLUMN IF NOT EXISTS shipping_address TEXT;

COMMENT ON COLUMN invoices.billing_address IS 'Snapshot of billing address on invoice';
COMMENT ON COLUMN invoices.shipping_address IS 'Snapshot of shipping address on invoice';
