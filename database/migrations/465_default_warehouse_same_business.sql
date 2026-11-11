-- Migration 465: get_default_warehouse_for_branch must only return a warehouse of the branch's business.
-- Description: The function joined branch_warehouses to warehouses without checking that the linked
-- warehouse and the branch share a business. A cross-tenant link row (now refused by the API) would
-- have routed one business's stock postings into another business's warehouse. Every lookup now
-- requires w.business_id = b.business_id, and each step picks the oldest matching warehouse
-- (created_at, then id), so a branch with several primary warehouses always gets the same one;
-- this matches the warehouse-mode switch's picker.
-- Created: 2026-11-05

CREATE OR REPLACE FUNCTION get_default_warehouse_for_branch(
  p_branch_id UUID
)
RETURNS UUID AS $$
DECLARE
  v_warehouse_id UUID;
BEGIN
  -- 1) Primary warehouse linked to the branch, in the same business
  SELECT w.id INTO v_warehouse_id
  FROM warehouses w
  JOIN branch_warehouses bw ON w.id = bw.warehouse_id
  JOIN branches b ON b.id = bw.branch_id
  WHERE bw.branch_id = p_branch_id
    AND w.business_id = b.business_id
    AND bw.is_primary = true
    AND w.is_active = true
  ORDER BY w.created_at ASC, w.id ASC
  LIMIT 1;

  -- 2) Any active warehouse linked to the branch, in the same business
  IF v_warehouse_id IS NULL THEN
    SELECT w.id INTO v_warehouse_id
    FROM warehouses w
    JOIN branch_warehouses bw ON w.id = bw.warehouse_id
    JOIN branches b ON b.id = bw.branch_id
    WHERE bw.branch_id = p_branch_id
      AND w.business_id = b.business_id
      AND w.is_active = true
    ORDER BY w.created_at ASC, w.id ASC
    LIMIT 1;
  END IF;

  -- 3) Any active shared warehouse (branch_id IS NULL) of the branch's business
  IF v_warehouse_id IS NULL THEN
    SELECT w.id INTO v_warehouse_id
    FROM warehouses w
    JOIN branches b ON w.business_id = b.business_id
    WHERE b.id = p_branch_id
      AND w.branch_id IS NULL
      AND w.is_active = true
    ORDER BY w.created_at ASC, w.id ASC
    LIMIT 1;
  END IF;

  RETURN v_warehouse_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_default_warehouse_for_branch IS 'Returns the default warehouse for a branch, always within the branch''s own business. Priority: 1) primary warehouse linked via branch_warehouses, 2) any warehouse linked to the branch, 3) any shared warehouse (branch_id IS NULL) of the business.';
