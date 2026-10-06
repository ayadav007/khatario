-- Migration 366: Add branch_id to sales_orders
-- Aligns sales orders with other commercial documents for branch scoping.

ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

-- Backfill from each business's primary branch
UPDATE sales_orders so
SET branch_id = (
  SELECT b.id
  FROM branches b
  WHERE b.business_id = so.business_id
    AND b.is_primary = true
  LIMIT 1
)
WHERE so.branch_id IS NULL;

-- Fallback: any active branch for the business
UPDATE sales_orders so
SET branch_id = (
  SELECT b.id
  FROM branches b
  WHERE b.business_id = so.business_id
    AND COALESCE(b.is_active, true) = true
  ORDER BY b.created_at ASC NULLS LAST
  LIMIT 1
)
WHERE so.branch_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_sales_orders_branch_id ON sales_orders(branch_id);

COMMENT ON COLUMN sales_orders.branch_id IS
  'Branch (accounting entity) that created this sales order.';
