-- Migration 156: Branch-level item stock, ledger header branch_id, customer dedupe indexes,
-- inventory_adjustments.branch_id

-- ---------------------------------------------------------------------------
-- 1) branch_item_stock: per-branch quantity for items (when warehouse mode OFF)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS branch_item_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  quantity DECIMAL(15, 3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_branch_item_stock_biz_branch_item UNIQUE (business_id, branch_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_branch_item_stock_business_branch
  ON branch_item_stock (business_id, branch_id);

CREATE INDEX IF NOT EXISTS idx_branch_item_stock_item
  ON branch_item_stock (business_id, item_id);

COMMENT ON TABLE branch_item_stock IS
  'Per-branch sellable quantity when warehouses_enabled is false. When warehouse mode is on, use location_stock.';

-- ---------------------------------------------------------------------------
-- 2) ledger_entries.branch_id (header / reporting; lines remain source of truth)
-- ---------------------------------------------------------------------------
ALTER TABLE ledger_entries
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ledger_entries_business_branch
  ON ledger_entries (business_id, branch_id);

COMMENT ON COLUMN ledger_entries.branch_id IS
  'Accounting branch for this voucher header. Backfilled from source documents; lines may still carry branch_id.';

-- Backfill from invoices
UPDATE ledger_entries le
SET branch_id = i.branch_id
FROM invoices i
WHERE le.branch_id IS NULL
  AND le.transaction_type = 'invoice'
  AND le.transaction_id = i.id;

-- Backfill from payments (when linked)
UPDATE ledger_entries le
SET branch_id = p.branch_id
FROM payments p
WHERE le.branch_id IS NULL
  AND le.transaction_type = 'payment'
  AND le.transaction_id = p.id
  AND p.branch_id IS NOT NULL;

-- Backfill from purchases
UPDATE ledger_entries le
SET branch_id = pu.branch_id
FROM purchases pu
WHERE le.branch_id IS NULL
  AND le.transaction_type = 'purchase'
  AND le.transaction_id = pu.id
  AND pu.branch_id IS NOT NULL;

-- Fallback: derive from ledger_entry_lines (voucher_id + voucher_type align with transaction_id + transaction_type)
UPDATE ledger_entries le
SET branch_id = sub.branch_id
FROM (
  SELECT DISTINCT ON (voucher_id, voucher_type)
    voucher_id,
    voucher_type,
    branch_id
  FROM ledger_entry_lines
  WHERE branch_id IS NOT NULL
    AND voucher_id IS NOT NULL
    AND voucher_type IS NOT NULL
  ORDER BY voucher_id, voucher_type, id
) sub
WHERE le.branch_id IS NULL
  AND le.transaction_id = sub.voucher_id
  AND le.transaction_type = sub.voucher_type;

-- ---------------------------------------------------------------------------
-- 3) inventory_adjustments.branch_id
-- ---------------------------------------------------------------------------
ALTER TABLE inventory_adjustments
  ADD COLUMN IF NOT EXISTS branch_id UUID REFERENCES branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_adjustments_branch
  ON inventory_adjustments (business_id, branch_id);

-- Customer unique indexes: add in a separate migration after deduplicating data
-- (API now returns existing customer on duplicate phone/email — see POST /api/customers).
