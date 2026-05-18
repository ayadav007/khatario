-- Read-only audit: branch_item_stock rows where item belongs to a different business
-- Review results before any cleanup. Orphan rows break stock trust.

SELECT
  bis.id,
  bis.business_id AS stock_business_id,
  bis.branch_id,
  bis.item_id,
  bis.quantity,
  i.business_id AS item_owner_business_id,
  i.name AS item_name
FROM branch_item_stock bis
JOIN items i ON i.id = bis.item_id
WHERE i.business_id IS DISTINCT FROM bis.business_id
ORDER BY bis.updated_at DESC NULLS LAST;
