-- 422: Suppliers added with a linked business used to wait for an approval screen that no
-- longer exists. Each still-pending link gets a Supplier Hub connection request, so the
-- supplier sees it in "Needs you" and accepting it makes the link live.
-- Needs 421 (share_low_stock).

INSERT INTO supplier_connection_requests (
  buyer_business_id, supplier_business_id, status, message, share_low_stock, created_at
)
SELECT DISTINCT ON (s.business_id, s.linked_business_id)
       s.business_id, s.linked_business_id, 'pending', NULL,
       COALESCE(s.allow_low_stock_access, false), s.created_at
  FROM suppliers s
 WHERE s.approval_status = 'pending'
   AND s.linked_business_id IS NOT NULL
   AND s.linked_business_id <> s.business_id
   AND s.deleted_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM supplier_connection_requests r
      WHERE r.buyer_business_id = s.business_id
        AND r.supplier_business_id = s.linked_business_id
        AND r.status = 'pending'
   )
 ORDER BY s.business_id, s.linked_business_id, s.created_at DESC;
