-- repair: QA Run 6 (PR2, PR3) purchase returns
--   1. purchase_returns gets a status (final / cancelled) with cancellation audit columns, used by
--      POST /api/purchase-returns/[id]/cancel and by the returned-quantity cap.
--   2. Cancel the two QA returns saved before the cap and server-side GST existed:
--      QA-PR-OVER (11 units returned against a smaller bill) and QA-PR-TAX (client-sent tax of ₹100 on ₹100).
--      Stock goes back in, the ledger voucher gets mirror lines, supplier and bill balances are restored.
-- Safe to re-run: only returns still in 'final' status are touched.

ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'final';
ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP;
ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS cancelled_by UUID;
ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_returns_status_check') THEN
    ALTER TABLE purchase_returns
      ADD CONSTRAINT purchase_returns_status_check CHECK (status IN ('final', 'cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_purchase_returns_purchase_status ON purchase_returns (purchase_id, status);

DO $$
DECLARE
  r RECORD;
  m RECORD;
  v_business CONSTANT UUID := '5ee47b2a-47bf-4e93-84ff-cf2142fd2e0e';
BEGIN
  FOR r IN
    SELECT * FROM purchase_returns
     WHERE business_id = v_business
       AND return_number IN ('QA-PR-OVER', 'QA-PR-TAX')
       AND status = 'final'
     FOR UPDATE
  LOOP
    BEGIN
      FOR m IN
        SELECT item_id, location_id, SUM(quantity) AS qty
          FROM stock_movements
         WHERE business_id = v_business AND reference_type = 'purchase_return'
           AND reference_id = r.id AND type = 'out'
         GROUP BY item_id, location_id
      LOOP
        IF m.location_id IS NOT NULL THEN
          UPDATE location_stock
             SET current_stock_qty = current_stock_qty + m.qty, last_updated = CURRENT_TIMESTAMP
           WHERE location_id = m.location_id AND item_id = m.item_id;
        ELSE
          INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity, created_at, updated_at)
          VALUES (v_business, r.branch_id, m.item_id, m.qty, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT (business_id, branch_id, item_id)
          DO UPDATE SET quantity = branch_item_stock.quantity + EXCLUDED.quantity, updated_at = CURRENT_TIMESTAMP;
          UPDATE items
             SET current_stock = (SELECT COALESCE(SUM(quantity), 0) FROM branch_item_stock
                                   WHERE business_id = v_business AND item_id = m.item_id),
                 updated_at = CURRENT_TIMESTAMP
           WHERE id = m.item_id AND business_id = v_business;
        END IF;
        INSERT INTO stock_movements (business_id, item_id, type, quantity, reference_type, reference_id, location_id, notes)
        VALUES (v_business, m.item_id, 'in', m.qty, 'purchase_return_cancel', r.id, m.location_id,
                'Cancelled return ' || r.return_number || ' (repair 316)');
      END LOOP;

      IF NOT EXISTS (
        SELECT 1 FROM ledger_entry_lines
         WHERE voucher_id = r.id AND voucher_type = 'purchase_return' AND narration LIKE 'Reversal:%'
      ) THEN
        INSERT INTO ledger_entry_lines
          (business_id, voucher_id, voucher_type, account_id, entry_date, debit, credit, narration, reference_number, branch_id)
        SELECT business_id, voucher_id, voucher_type, account_id, entry_date, credit, debit,
               LEFT('Reversal: Purchase return ' || r.return_number || ' cancelled (' || COALESCE(narration, '') || ')', 500),
               reference_number, branch_id
          FROM ledger_entry_lines
         WHERE voucher_id = r.id AND voucher_type = 'purchase_return';
      END IF;

      IF r.supplier_id IS NOT NULL THEN
        UPDATE suppliers SET current_balance = current_balance + r.grand_total, updated_at = CURRENT_TIMESTAMP
         WHERE id = r.supplier_id;
      END IF;
      IF r.purchase_id IS NOT NULL THEN
        UPDATE purchases SET balance_amount = balance_amount + r.grand_total, updated_at = CURRENT_TIMESTAMP
         WHERE id = r.purchase_id;
      END IF;

      UPDATE purchase_returns
         SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, itc_reversed = false,
             cancellation_reason = CASE r.return_number
               WHEN 'QA-PR-OVER' THEN 'Repair 316: quantity exceeded the purchased quantity'
               ELSE 'Repair 316: GST did not match the bill rate'
             END,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = r.id;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'purchase return % not cancelled: %', r.return_number, SQLERRM;
    END;
  END LOOP;
END $$;
