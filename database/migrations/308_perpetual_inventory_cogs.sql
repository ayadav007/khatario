-- Perpetual inventory. Purchases already capitalise goods into Inventory (1104), but sales
-- never moved their cost out, so P&L showed negative COGS and Inventory stayed at full
-- purchase value. From now on each sale posts Dr COGS (5104) / Cr Inventory (1104) at
-- weighted-average cost inside the invoice voucher (credit notes post the reverse).
-- This migration switches every business to perpetual and back-posts that cost for
-- existing live invoices and active credit notes that have ledger lines but no COGS line.

-- Rate at which opening stock was valued; frozen so later purchase-price edits don't revalue it.
ALTER TABLE items ADD COLUMN IF NOT EXISTS opening_stock_rate NUMERIC(14,4);
UPDATE items SET opening_stock_rate = COALESCE(purchase_price, 0)
 WHERE opening_stock_rate IS NULL AND COALESCE(opening_stock, 0) > 0;

ALTER TABLE business_settings ALTER COLUMN inventory_model SET DEFAULT 'perpetual';
UPDATE business_settings SET inventory_model = 'perpetual' WHERE inventory_model IS DISTINCT FROM 'perpetual';

COMMENT ON COLUMN business_settings.inventory_model IS
  'perpetual (default): each sale posts Dr 5104 COGS / Cr 1104 Inventory at weighted-average cost; '
  'credit notes post the reverse. periodic: COGS derived at period end (legacy).';

-- Same rule as lib/inventory/cogs-posting.ts weightedAverageCosts().
CREATE OR REPLACE FUNCTION pg_temp.item_avg_cost(p_business UUID, p_item UUID, p_as_of DATE)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
           (COALESCE(i.opening_stock, 0) * COALESCE(i.opening_stock_rate, i.purchase_price, 0) + COALESCE(p.value, 0))
             / NULLIF(COALESCE(i.opening_stock, 0) + COALESCE(p.qty, 0), 0),
           i.purchase_price,
           0)
    FROM items i
    LEFT JOIN (
      SELECT SUM(pi.quantity) AS qty, SUM(pi.taxable_value) AS value
        FROM purchase_items pi
        JOIN purchases pu ON pu.id = pi.purchase_id
       WHERE pu.business_id = p_business
         AND pi.item_id = p_item
         AND COALESCE(pu.status, '') NOT IN ('cancelled', 'draft')
         AND pu.bill_date <= p_as_of
         AND pi.quantity > 0
         AND pi.taxable_value > 0
    ) p ON true
   WHERE i.id = p_item AND i.business_id = p_business
$$;

-- Goods cost of (item, qty) lines; bundles costed through their goods components.
CREATE OR REPLACE FUNCTION pg_temp.line_goods_cost(p_business UUID, p_item UUID, p_qty NUMERIC, p_as_of DATE)
RETURNS NUMERIC LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN i.item_type <> 'goods' THEN 0
    WHEN COALESCE(i.is_bundle, false) THEN COALESCE((
      SELECT SUM(bi.quantity * p_qty * pg_temp.item_avg_cost(p_business, bi.item_id, p_as_of))
        FROM bundle_items bi
        JOIN items c ON c.id = bi.item_id AND c.item_type = 'goods'
       WHERE bi.bundle_id = i.id), 0)
    ELSE p_qty * pg_temp.item_avg_cost(p_business, i.id, p_as_of)
  END
    FROM items i
   WHERE i.id = p_item AND i.business_id = p_business
$$;

DO $$
DECLARE
    doc RECORD;
    v_cost NUMERIC;
    v_inventory UUID;
    v_cogs UUID;
BEGIN
    FOR doc IN
        SELECT 'invoice'::text AS vtype, i.id, i.business_id, i.invoice_number AS ref, i.invoice_date::date AS d,
               (SELECT l.branch_id FROM ledger_entry_lines l
                 WHERE l.business_id = i.business_id AND l.voucher_type = 'invoice' AND l.voucher_id = i.id LIMIT 1) AS branch_id
          FROM invoices i
         WHERE COALESCE(i.status, '') <> 'cancelled'
           AND EXISTS (SELECT 1 FROM ledger_entry_lines l
                        WHERE l.business_id = i.business_id AND l.voucher_type = 'invoice' AND l.voucher_id = i.id)
        UNION ALL
        SELECT 'credit_note', cn.id, cn.business_id, cn.credit_note_number, cn.credit_note_date::date,
               (SELECT l.branch_id FROM ledger_entry_lines l
                 WHERE l.business_id = cn.business_id AND l.voucher_type = 'credit_note' AND l.voucher_id = cn.id LIMIT 1)
          FROM credit_notes cn
         WHERE COALESCE(cn.status, 'active') = 'active'
           AND EXISTS (SELECT 1 FROM ledger_entry_lines l
                        WHERE l.business_id = cn.business_id AND l.voucher_type = 'credit_note' AND l.voucher_id = cn.id)
    LOOP
        SELECT id INTO v_inventory FROM accounts WHERE business_id = doc.business_id AND account_code = '1104' AND is_active LIMIT 1;
        SELECT id INTO v_cogs FROM accounts WHERE business_id = doc.business_id AND account_code = '5104' AND is_active LIMIT 1;
        CONTINUE WHEN v_inventory IS NULL OR v_cogs IS NULL;

        CONTINUE WHEN EXISTS (
            SELECT 1 FROM ledger_entry_lines l
             WHERE l.business_id = doc.business_id AND l.voucher_type = doc.vtype
               AND l.voucher_id = doc.id AND l.account_id = v_cogs);

        IF doc.vtype = 'invoice' THEN
            SELECT COALESCE(SUM(pg_temp.line_goods_cost(doc.business_id, ii.item_id, ii.quantity, doc.d)), 0)
              INTO v_cost
              FROM invoice_items ii
             WHERE ii.invoice_id = doc.id AND ii.item_id IS NOT NULL;
        ELSE
            SELECT COALESCE(SUM(pg_temp.line_goods_cost(doc.business_id, ci.item_id, ci.qty, doc.d)), 0)
              INTO v_cost
              FROM credit_note_items ci
             WHERE ci.credit_note_id = doc.id AND ci.item_id IS NOT NULL;
        END IF;

        v_cost := ROUND(COALESCE(v_cost, 0), 2);
        CONTINUE WHEN v_cost <= 0;

        INSERT INTO ledger_entry_lines (
            business_id, voucher_id, voucher_type, account_id, entry_date,
            debit, credit, narration, reference_number, branch_id
        ) VALUES
          (doc.business_id, doc.id, doc.vtype, v_cogs, doc.d,
           CASE WHEN doc.vtype = 'invoice' THEN v_cost ELSE 0 END,
           CASE WHEN doc.vtype = 'invoice' THEN 0 ELSE v_cost END,
           CASE WHEN doc.vtype = 'invoice' THEN 'Cost of goods sold - ' ELSE 'Cost of goods returned - ' END || doc.ref,
           doc.ref, doc.branch_id),
          (doc.business_id, doc.id, doc.vtype, v_inventory, doc.d,
           CASE WHEN doc.vtype = 'invoice' THEN 0 ELSE v_cost END,
           CASE WHEN doc.vtype = 'invoice' THEN v_cost ELSE 0 END,
           CASE WHEN doc.vtype = 'invoice' THEN 'Cost of goods sold - ' ELSE 'Cost of goods returned - ' END || doc.ref,
           doc.ref, doc.branch_id);
    END LOOP;
END $$;
