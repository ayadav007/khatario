-- 430: Directory review, and one order system.
--   * platform_settings.supplier_hub_review_listings: when on, a business that lists itself in the
--     Supplier Hub directory waits for a platform admin to approve it (directory_approved).
--   * Open single-item stock requests (quantity_requests, pending) between connected businesses
--     move to Supplier Hub orders, so there is one place to answer them. The old request is closed
--     with a note pointing at the new order; nothing is deleted.

ALTER TABLE platform_settings
  ADD COLUMN IF NOT EXISTS supplier_hub_review_listings BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN platform_settings.supplier_hub_review_listings IS
  'New Supplier Hub directory listings wait for platform approval before they show';

ALTER TABLE business_discovery
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_note TEXT;

COMMENT ON COLUMN business_discovery.reviewed_at IS 'When a platform admin approved or hid this directory listing';

ALTER TABLE quantity_requests ADD COLUMN IF NOT EXISTS moved_to_supply_order_id UUID REFERENCES supply_orders(id) ON DELETE SET NULL;

DO $$
DECLARE
  r RECORD;
  new_order UUID;
BEGIN
  FOR r IN
    SELECT q.*, i.name AS item_name
      FROM quantity_requests q
      JOIN items i ON i.id = q.item_id AND i.business_id = q.requester_business_id
     WHERE q.status = 'pending'
       AND q.moved_to_supply_order_id IS NULL
       AND q.requested_qty > 0
       AND EXISTS (
         SELECT 1 FROM suppliers s
          WHERE s.business_id = q.requester_business_id AND s.linked_business_id = q.responder_business_id
            AND s.approval_status = 'approved' AND s.deleted_at IS NULL
       )
  LOOP
    INSERT INTO supply_orders (buyer_business_id, vendor_business_id, status, origin, need_by, notes, created_by_business_id, created_at)
    VALUES (r.requester_business_id, r.responder_business_id, 'pending', 'buyer', r.need_by_date,
            COALESCE(NULLIF(r.notes, ''), 'Moved from a stock request'), r.requester_business_id, r.created_at)
    RETURNING id INTO new_order;

    INSERT INTO supply_order_lines (order_id, buyer_item_id, vendor_item_id, item_name, qty, buyer_units_per_vendor_unit)
    VALUES (new_order, r.item_id, r.responder_item_id, r.item_name, r.requested_qty, 1);

    UPDATE quantity_requests
       SET status = 'declined', moved_to_supply_order_id = new_order,
           notes = CONCAT_WS(E'\n', NULLIF(notes, ''), 'Moved to Supplier Hub orders'),
           updated_at = CURRENT_TIMESTAMP
     WHERE id = r.id;
  END LOOP;
END $$;
