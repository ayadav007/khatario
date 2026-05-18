-- Migration 158: Branch-aware GL balance, per-branch variant stock, customer model clarity

-- ---------------------------------------------------------------------------
-- 1) get_account_balance: optional 4th argument p_branch_id
--    Replace 3-arg overload so existing 3-arg SQL calls resolve to defaults.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS get_account_balance(uuid, uuid, date);

CREATE OR REPLACE FUNCTION get_account_balance(
    p_account_id UUID,
    p_business_id UUID,
    p_as_on_date DATE DEFAULT NULL,
    p_branch_id UUID DEFAULT NULL
)
RETURNS DECIMAL(15,2) AS $$
DECLARE
    v_opening_balance DECIMAL(15,2);
    v_opening_type VARCHAR(10);
    v_account_nature VARCHAR(10);
    v_debit_total DECIMAL(15,2);
    v_credit_total DECIMAL(15,2);
    v_balance DECIMAL(15,2);
BEGIN
    SELECT opening_balance, opening_balance_type, nature
    INTO v_opening_balance, v_opening_type, v_account_nature
    FROM accounts
    WHERE id = p_account_id AND business_id = p_business_id;

    IF v_opening_balance IS NULL THEN
        RETURN 0;
    END IF;

    IF v_account_nature = 'debit' THEN
        IF v_opening_type = 'debit' THEN
            v_balance := v_opening_balance;
        ELSE
            v_balance := -v_opening_balance;
        END IF;
    ELSE
        IF v_opening_type = 'credit' THEN
            v_balance := -v_opening_balance;
        ELSE
            v_balance := v_opening_balance;
        END IF;
    END IF;

    IF p_as_on_date IS NULL THEN
        SELECT 
            COALESCE(SUM(debit), 0),
            COALESCE(SUM(credit), 0)
        INTO v_debit_total, v_credit_total
        FROM ledger_entry_lines
        WHERE account_id = p_account_id
          AND business_id = p_business_id
          AND (p_branch_id IS NULL OR branch_id = p_branch_id);
    ELSE
        SELECT 
            COALESCE(SUM(debit), 0),
            COALESCE(SUM(credit), 0)
        INTO v_debit_total, v_credit_total
        FROM ledger_entry_lines
        WHERE account_id = p_account_id
          AND business_id = p_business_id
          AND entry_date <= p_as_on_date
          AND (p_branch_id IS NULL OR branch_id = p_branch_id);
    END IF;

    IF v_account_nature = 'debit' THEN
        v_balance := v_balance + v_debit_total - v_credit_total;
    ELSE
        v_balance := v_balance + v_credit_total - v_debit_total;
    END IF;

    RETURN v_balance;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_account_balance(UUID, UUID, DATE, UUID) IS
  'Account balance from ledger_entry_lines. Pass p_branch_id for branch-scoped balance; NULL = all branches (consolidated / year-close).';

-- ---------------------------------------------------------------------------
-- 2) branch_item_variant_stock: per-branch variant qty when warehouse mode OFF
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS branch_item_variant_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  item_variant_id UUID NOT NULL REFERENCES item_variants(id) ON DELETE CASCADE,
  quantity DECIMAL(15, 3) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_branch_item_variant_stock UNIQUE (business_id, branch_id, item_variant_id)
);

CREATE INDEX IF NOT EXISTS idx_branch_item_variant_business_branch
  ON branch_item_variant_stock (business_id, branch_id);

CREATE INDEX IF NOT EXISTS idx_branch_item_variant_variant
  ON branch_item_variant_stock (business_id, item_variant_id);

COMMENT ON TABLE branch_item_variant_stock IS
  'Per-branch quantity for item_variants when warehouses_enabled is false. item_variants.current_stock is kept as SUM across branches for list UI.';

-- Backfill: move legacy global variant stock onto each business default branch
INSERT INTO branch_item_variant_stock (business_id, branch_id, item_variant_id, quantity, created_at, updated_at)
SELECT
  i.business_id,
  b.id AS branch_id,
  iv.id AS item_variant_id,
  COALESCE(iv.current_stock, 0)::decimal(15,3),
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM item_variants iv
JOIN items i ON i.id = iv.item_id
JOIN LATERAL (
  SELECT id FROM branches
  WHERE branches.business_id = i.business_id AND branches.is_default = true AND branches.is_active = true
  ORDER BY branches.created_at ASC NULLS LAST, branches.id ASC
  LIMIT 1
) b ON true
ON CONFLICT (business_id, branch_id, item_variant_id) DO UPDATE SET
  quantity = EXCLUDED.quantity,
  updated_at = CURRENT_TIMESTAMP;

-- ---------------------------------------------------------------------------
-- 3) Customer model: document business-scoped customers + optional branch link
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN customers.branch_id IS
  'Optional: set when this customer row represents another branch (inter-branch). Regular B2B/B2C customers use business_id only; invoice/credit/debit lines carry branch_id.';
