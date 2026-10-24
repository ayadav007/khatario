-- repair: purchases created by invoice → purchase conversion that never posted a voucher (QA R10-N1)
--   convert-to-purchase inserted a final purchase (and stock) but never called the purchase
--   ledger posting, so AP, Purchases, Inventory and Input GST (hence GSTR-3B ITC) missed the bill,
--   and the supplier balance was never raised. It also copied the seller's paid amount.
--   Scope: final purchases with no 'purchase' ledger lines whose bill number and total match an
--   invoice of the same business (the conversion copies both).
--   * Voucher: Dr Purchases (grand − tax) + Dr Input CGST/SGST/IGST/Cess / Cr AP (Cash when no
--     supplier); goods lines linked to catalogue items then move Dr Inventory / Cr Purchases.
--     Bills flagged itc_eligible = false keep the tax inside Purchases.
--   * paid_amount / balance_amount are reset to the payments actually recorded against the bill,
--     and the supplier balance is raised by the resulting balance.
--   * Rows in a locked or closed period, or with missing accounts, are skipped with a NOTICE.
-- Safe to re-run: a purchase is posted only if it has no ledger lines yet.

DO $$
DECLARE
  r RECORD;
  v_branch UUID;
  v_purch UUID; v_inv UUID; v_ap UUID; v_cash UUID;
  v_cgst UUID; v_sgst UUID; v_igst UUID; v_cess UUID;
  v_credit UUID;
  v_tax NUMERIC(15,2);
  v_inventory NUMERIC(15,2);
  v_paid NUMERIC(15,2);
  v_label TEXT;
BEGIN
  FOR r IN
    SELECT p.id, p.business_id, p.branch_id, p.supplier_id, p.bill_number, p.bill_date,
           COALESCE(p.grand_total, 0) AS grand_total,
           COALESCE(p.cgst_total, 0) AS cgst, COALESCE(p.sgst_total, 0) AS sgst,
           COALESCE(p.igst_total, 0) AS igst, COALESCE(p.cess_total, 0) AS cess,
           (p.itc_eligible IS DISTINCT FROM false) AS eligible
      FROM purchases p
     WHERE p.status = 'final'
       AND p.deleted_at IS NULL
       AND COALESCE(p.grand_total, 0) > 0
       AND NOT EXISTS (
         SELECT 1 FROM ledger_entry_lines l WHERE l.voucher_id = p.id AND l.voucher_type = 'purchase'
       )
       AND EXISTS (
         SELECT 1 FROM invoices i
          WHERE i.business_id = p.business_id
            AND i.invoice_number = p.bill_number
            AND i.grand_total = p.grand_total
       )
  LOOP
    SELECT id INTO v_purch FROM accounts WHERE business_id = r.business_id AND account_code = '5101' LIMIT 1;
    SELECT id INTO v_inv   FROM accounts WHERE business_id = r.business_id AND account_code = '1104' LIMIT 1;
    SELECT id INTO v_ap    FROM accounts WHERE business_id = r.business_id AND account_code = '2101' LIMIT 1;
    SELECT id INTO v_cash  FROM accounts WHERE business_id = r.business_id AND account_code = '1101' LIMIT 1;
    SELECT id INTO v_cgst  FROM accounts WHERE business_id = r.business_id AND account_code = '1110' LIMIT 1;
    SELECT id INTO v_sgst  FROM accounts WHERE business_id = r.business_id AND account_code = '1111' LIMIT 1;
    SELECT id INTO v_igst  FROM accounts WHERE business_id = r.business_id AND account_code = '1112' LIMIT 1;
    SELECT id INTO v_cess  FROM accounts WHERE business_id = r.business_id AND account_code = '1113' LIMIT 1;
    v_credit := CASE WHEN r.supplier_id IS NULL THEN v_cash ELSE v_ap END;

    IF v_purch IS NULL OR v_credit IS NULL
       OR (r.eligible AND ((r.cgst > 0 AND v_cgst IS NULL) OR (r.sgst > 0 AND v_sgst IS NULL)
                           OR (r.igst > 0 AND v_igst IS NULL) OR (r.cess > 0 AND v_cess IS NULL))) THEN
      RAISE NOTICE 'Purchase % (%): required account missing, not posted', r.bill_number, r.id;
      CONTINUE;
    END IF;

    v_tax := CASE WHEN r.eligible THEN r.cgst + r.sgst + r.igst + r.cess ELSE 0 END;
    SELECT COALESCE(SUM(pi.taxable_value), 0) INTO v_inventory
      FROM purchase_items pi
      JOIN items i ON i.id = pi.item_id AND i.business_id = r.business_id
     WHERE pi.purchase_id = r.id AND COALESCE(i.item_type, 'goods') = 'goods'
       AND COALESCE(pi.line_item_type, 'goods') <> 'service'
       AND pi.itc_type IS DISTINCT FROM 'capital_goods';
    IF v_inv IS NULL THEN v_inventory := 0; END IF;
    SELECT COALESCE(SUM(amount), 0) INTO v_paid
      FROM payments WHERE reference_type = 'purchase' AND reference_id = r.id;
    v_label := 'Purchase (backfill, converted invoice) - ' || COALESCE(r.bill_number, r.id::text);
    v_branch := COALESCE(r.branch_id,
      (SELECT id FROM branches WHERE business_id = r.business_id AND is_default = true LIMIT 1));

    BEGIN
      INSERT INTO ledger_entry_lines (business_id, voucher_id, voucher_type, account_id, entry_date,
                                      debit, credit, narration, reference_number, branch_id)
      SELECT r.business_id, r.id, 'purchase', x.account_id, r.bill_date, x.debit, x.credit,
             x.narration, r.bill_number, v_branch
        FROM (VALUES
          (v_credit, 0::numeric, r.grand_total, v_label),
          (v_purch, r.grand_total - v_tax, 0::numeric, v_label),
          (v_cgst, CASE WHEN r.eligible THEN r.cgst ELSE 0 END, 0::numeric, 'Input CGST - ' || v_label),
          (v_sgst, CASE WHEN r.eligible THEN r.sgst ELSE 0 END, 0::numeric, 'Input SGST - ' || v_label),
          (v_igst, CASE WHEN r.eligible THEN r.igst ELSE 0 END, 0::numeric, 'Input IGST - ' || v_label),
          (v_cess, CASE WHEN r.eligible THEN r.cess ELSE 0 END, 0::numeric, 'Input Cess - ' || v_label),
          (v_inv, v_inventory, 0::numeric, 'Inventory addition - ' || v_label),
          (v_purch, 0::numeric, v_inventory, 'Transfer to inventory - ' || v_label)
        ) AS x(account_id, debit, credit, narration)
       WHERE x.account_id IS NOT NULL AND (x.debit > 0 OR x.credit > 0);

      UPDATE purchases
         SET paid_amount = v_paid,
             balance_amount = r.grand_total - v_paid,
             payment_status = CASE WHEN r.grand_total - v_paid <= 0 THEN 'paid'
                                   WHEN v_paid > 0 THEN 'partially_paid' ELSE 'unpaid' END,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = r.id;
      IF r.supplier_id IS NOT NULL AND r.grand_total - v_paid <> 0 THEN
        UPDATE suppliers SET current_balance = COALESCE(current_balance, 0) + (r.grand_total - v_paid),
                             updated_at = CURRENT_TIMESTAMP
         WHERE id = r.supplier_id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Purchase % (%): not posted: %', r.bill_number, r.id, SQLERRM;
    END;
  END LOOP;
END $$;
