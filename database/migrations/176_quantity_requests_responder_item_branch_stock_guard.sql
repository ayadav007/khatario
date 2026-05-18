-- Responder (supplier) catalog item for B2B quantity requests + DB guard on branch stock rows

ALTER TABLE quantity_requests
  ADD COLUMN IF NOT EXISTS responder_item_id UUID REFERENCES items(id) ON DELETE SET NULL;

COMMENT ON COLUMN quantity_requests.responder_item_id IS
  'Supplier/responder business item master; mandatory before PO/purchase from request for stock correctness';

CREATE INDEX IF NOT EXISTS idx_quantity_requests_responder_item
  ON quantity_requests(responder_item_id) WHERE responder_item_id IS NOT NULL;

-- Prevent cross-business item_id on branch_item_stock (API also enforces on writes)
CREATE OR REPLACE FUNCTION trg_branch_item_stock_validate_item_business()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM items i WHERE i.id = NEW.item_id AND i.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'branch_item_stock: item_id must belong to the same business as the stock row'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_branch_item_stock_item_business_match ON branch_item_stock;
CREATE TRIGGER trg_branch_item_stock_item_business_match
  BEFORE INSERT OR UPDATE OF item_id, business_id ON branch_item_stock
  FOR EACH ROW
  EXECUTE FUNCTION trg_branch_item_stock_validate_item_business();
