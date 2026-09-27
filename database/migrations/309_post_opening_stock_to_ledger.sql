-- Opening stock entered on items never reached the ledger, so Inventory (1104) on the
-- balance sheet was short of the stock register. Post each goods item's opening value
-- (item + variants) once as voucher 'opening_stock': Dr 1104 Inventory / Cr 3100
-- Opening Balance Adjustment, dated the start of the current financial year.
-- Mirrors lib/inventory/opening-stock-ledger.ts.
DO $$
DECLARE
    it RECORD;
    v_inventory UUID;
    v_opening UUID;
    v_group UUID;
    v_fy_start DATE;
BEGIN
    FOR it IN
        SELECT i.id, i.business_id, i.name,
               ROUND(COALESCE(i.opening_stock, 0) * COALESCE(i.opening_stock_rate, i.purchase_price, 0)
                     + COALESCE((SELECT SUM(COALESCE(v.opening_stock, 0) * COALESCE(v.purchase_price, i.purchase_price, 0))
                                   FROM item_variants v WHERE v.item_id = i.id), 0), 2) AS value
          FROM items i
         WHERE i.item_type = 'goods'
           AND i.deleted_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM ledger_entry_lines l
                            WHERE l.business_id = i.business_id AND l.voucher_type = 'opening_stock' AND l.voucher_id = i.id)
    LOOP
        CONTINUE WHEN it.value <= 0;

        SELECT id INTO v_inventory FROM accounts
         WHERE business_id = it.business_id AND account_code = '1104' AND is_active LIMIT 1;
        CONTINUE WHEN v_inventory IS NULL;

        SELECT id INTO v_opening FROM accounts
         WHERE business_id = it.business_id
           AND (account_code = '3100' OR account_name = 'Opening Balance Adjustment')
         ORDER BY (account_code = '3100') DESC LIMIT 1;
        IF v_opening IS NULL THEN
            SELECT id INTO v_group FROM account_groups
             WHERE business_id = it.business_id AND group_code = '3000' LIMIT 1;
            IF v_group IS NULL THEN
                INSERT INTO account_groups (business_id, group_code, group_name, group_type, is_system, sort_order)
                VALUES (it.business_id, '3000', 'Capital', 'capital', true, 3)
                ON CONFLICT (business_id, group_code) DO UPDATE SET group_name = EXCLUDED.group_name
                RETURNING id INTO v_group;
            END IF;
            INSERT INTO accounts (business_id, account_code, account_name, account_type, account_group_id,
                                  nature, is_system, sort_order, description)
            VALUES (it.business_id, '3100', 'Opening Balance Adjustment', 'capital', v_group,
                    'credit', true, 1, 'System account for opening balance adjustments')
            RETURNING id INTO v_opening;
        END IF;

        SELECT start_date INTO v_fy_start FROM financial_years
         WHERE business_id = it.business_id AND is_closed = false
           AND start_date <= CURRENT_DATE AND end_date >= CURRENT_DATE
         ORDER BY start_date DESC LIMIT 1;
        IF v_fy_start IS NULL THEN
            v_fy_start := make_date(
                EXTRACT(YEAR FROM CURRENT_DATE)::int - CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) < 4 THEN 1 ELSE 0 END,
                4, 1);
        END IF;

        UPDATE items SET opening_stock_rate = COALESCE(opening_stock_rate, purchase_price, 0) WHERE id = it.id;

        INSERT INTO ledger_entry_lines (
            business_id, voucher_id, voucher_type, account_id, entry_date,
            debit, credit, narration, reference_number, branch_id
        ) VALUES
          (it.business_id, it.id, 'opening_stock', v_inventory, v_fy_start, it.value, 0,
           LEFT('Opening stock - ' || it.name, 500), LEFT(it.name, 100), NULL),
          (it.business_id, it.id, 'opening_stock', v_opening, v_fy_start, 0, it.value,
           LEFT('Opening stock - ' || it.name, 500), LEFT(it.name, 100), NULL);
    END LOOP;
END $$;
