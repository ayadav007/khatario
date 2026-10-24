-- repair: QA Run 6 (E2-E4, F1, V1, IA1, SO1, P-INVVAL, P-SAC)
--   1. expenses: ITC eligibility, reverse charge, TDS and supplier columns; categories carry s.17(5) blocked flag.
--   2. depreciation_schedule: unique period key used by the depreciation upsert.
--   3. Back-post ledger vouchers for documents saved without any ledger lines:
--      provision entries, stock adjustments, final sales invoices (plus their receipts)
--      and final purchase bills (PO conversions).
--   4. QA bill AM/2026/52: SAC 998216 legal retainer was stocked as goods; turn the line into a service
--      and reverse the stock.
--   5. Re-state the Inventory transfer on final bills where it differs from the bill's goods taxable value.
-- Safe to re-run: every back-post skips documents that already have lines; each document runs in its own
-- sub-transaction so one locked period does not block the rest.

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS itc_eligible BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS is_reverse_charge BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS tds_section VARCHAR(10);
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS tds_amount NUMERIC(15,2) NOT NULL DEFAULT 0;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP;
CREATE INDEX IF NOT EXISTS idx_expenses_supplier_id ON expenses(supplier_id) WHERE supplier_id IS NOT NULL;

ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS itc_blocked BOOLEAN NOT NULL DEFAULT false;

INSERT INTO expense_categories (business_id, name, account_id, itc_blocked)
SELECT b.business_id, d.name, a.id, d.blocked
  FROM (SELECT DISTINCT business_id FROM expense_categories) b
 CROSS JOIN (VALUES
   ('Food & Refreshments', '5214', true),
   ('Staff Welfare', '5214', false),
   ('Travelling & Conveyance', '5215', false)
 ) AS d(name, code, blocked)
  LEFT JOIN accounts a ON a.business_id = b.business_id AND a.account_code = d.code AND a.is_active = true
ON CONFLICT (business_id, name) DO NOTHING;

UPDATE expense_categories ec
   SET account_id = a.id, updated_at = CURRENT_TIMESTAMP
  FROM (VALUES
    ('Rent', '5213'), ('Electricity', '5201'), ('Salaries & Wages', '5212'), ('Salaries', '5212'),
    ('Transport & Freight', '5202'), ('Office Supplies', '5201'), ('Telephone & Internet', '5201'),
    ('Repairs & Maintenance', '5201'), ('Professional Fees', '5216'), ('Bank Charges', '5217'),
    ('Food & Refreshments', '5214'), ('Staff Welfare', '5214'), ('Travelling & Conveyance', '5215'),
    ('Miscellaneous', '5201')
  ) AS d(name, code),
       accounts a
 WHERE ec.account_id IS NULL
   AND ec.name = d.name
   AND a.business_id = ec.business_id
   AND a.account_code = d.code
   AND a.is_active = true;

UPDATE expense_categories SET itc_blocked = true
 WHERE name IN ('Food & Refreshments') AND itc_blocked = false;

DELETE FROM depreciation_schedule d
 USING depreciation_schedule k
 WHERE d.asset_id = k.asset_id
   AND d.financial_year = k.financial_year
   AND d.period_start_date = k.period_start_date
   AND d.period_end_date = k.period_end_date
   AND d.id <> k.id
   AND (COALESCE(k.is_posted, false), k.created_at, k.id::text) > (COALESCE(d.is_posted, false), d.created_at, d.id::text);

CREATE UNIQUE INDEX IF NOT EXISTS uq_depreciation_schedule_period
  ON depreciation_schedule (asset_id, financial_year, period_start_date, period_end_date);

-- Helpers (session-local).
CREATE OR REPLACE FUNCTION pg_temp.acc(p_business UUID, p_code TEXT) RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT id FROM accounts
   WHERE business_id = p_business AND account_code = p_code
   ORDER BY is_active DESC NULLS LAST
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION pg_temp.main_branch(p_business UUID) RETURNS UUID
LANGUAGE sql STABLE AS $$
  SELECT id FROM branches
   WHERE business_id = p_business
   ORDER BY is_primary DESC NULLS LAST, is_default DESC NULLS LAST, created_at
   LIMIT 1
$$;

-- Signed amount: positive = debit, negative = credit. Zero is skipped.
CREATE OR REPLACE FUNCTION pg_temp.post(
  p_business UUID, p_branch UUID, p_voucher UUID, p_type TEXT, p_date DATE,
  p_account UUID, p_amount NUMERIC, p_narration TEXT, p_ref TEXT
) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE v NUMERIC := ROUND(COALESCE(p_amount, 0), 2);
BEGIN
  IF v = 0 THEN RETURN; END IF;
  IF p_account IS NULL THEN
    RAISE EXCEPTION 'ledger account missing for % %', p_type, p_ref;
  END IF;
  INSERT INTO ledger_entry_lines
    (business_id, branch_id, voucher_id, voucher_type, entry_date, account_id, debit, credit, narration, reference_number)
  VALUES
    (p_business, p_branch, p_voucher, p_type, p_date, p_account,
     GREATEST(v, 0), GREATEST(-v, 0), p_narration, p_ref);
END;
$$;

-- 3a. Provision entries (V1).
DO $$
DECLARE
  r RECORD;
  amt NUMERIC;
  prov UUID;
  expn UUID;
  counter UUID;
  label TEXT;
  br UUID;
BEGIN
  FOR r IN
    SELECT pe.*, pr.provision_name, pr.provision_account_id, pr.expense_account_id
      FROM provision_entries pe
      JOIN provisions pr ON pr.id = pe.provision_id
     WHERE NOT EXISTS (SELECT 1 FROM ledger_entry_lines l WHERE l.voucher_id = pe.id)
       AND ROUND(ABS(COALESCE(pe.closing_balance, 0) - COALESCE(pe.opening_balance, 0)), 2) > 0
  LOOP
    BEGIN
      amt := ROUND(ABS(r.closing_balance - r.opening_balance), 2);
      prov := COALESCE(r.provision_account_id, pg_temp.acc(r.business_id, '2108'));
      expn := COALESCE(r.expense_account_id, pg_temp.acc(r.business_id, '5207'));
      counter := CASE WHEN r.entry_type = 'utilization' THEN pg_temp.acc(r.business_id, '1103') ELSE expn END;
      label := COALESCE(r.narration, r.provision_name || ' - ' || r.entry_type);
      br := pg_temp.main_branch(r.business_id);
      IF r.entry_type = 'addition' THEN
        PERFORM pg_temp.post(r.business_id, br, r.id, 'provision', r.entry_date, expn, amt, label, r.provision_name);
        PERFORM pg_temp.post(r.business_id, br, r.id, 'provision', r.entry_date, prov, -amt, label, r.provision_name);
      ELSE
        PERFORM pg_temp.post(r.business_id, br, r.id, 'provision', r.entry_date, prov, amt, label, r.provision_name);
        PERFORM pg_temp.post(r.business_id, br, r.id, 'provision', r.entry_date, counter, -amt, label, r.provision_name);
      END IF;
      UPDATE provision_entries SET is_posted = true, posted_date = r.entry_date, journal_entry_id = r.id WHERE id = r.id;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'provision entry % not back-posted: %', r.id, SQLERRM;
    END;
  END LOOP;
END $$;

-- 3b. Stock adjustments (IA1) with s.17(5)(h) ITC reversal (IA2).
DO $$
DECLARE
  r RECORD;
  amt NUMERIC;
  is_dec BOOLEAN;
  inv UUID;
  counter UUID;
  rate NUMERIC;
  inter BOOLEAN;
  itc NUMERIC;
  half NUMERIC;
  label TEXT;
BEGIN
  FOR r IN
    SELECT ia.*, i.tax_rate AS item_tax_rate, i.purchase_price AS item_purchase_price
      FROM inventory_adjustments ia
      LEFT JOIN items i ON i.id = ia.item_id
     WHERE NOT EXISTS (SELECT 1 FROM ledger_entry_lines l WHERE l.voucher_id = ia.id)
  LOOP
    BEGIN
      is_dec := UPPER(COALESCE(r.direction, '')) = 'DECREASE';
      IF UPPER(r.adjustment_type) = 'QUANTITY' THEN
        amt := ROUND(ABS(COALESCE(
          r.total_value_before - r.total_value_after,
          r.quantity_change * COALESCE(r.unit_cost_before, r.item_purchase_price, 0)
        )), 2);
      ELSE
        amt := ROUND(ABS(COALESCE(r.value_change, 0)), 2);
      END IF;
      CONTINUE WHEN amt = 0;

      inv := pg_temp.acc(r.business_id, '1104');
      IF is_dec THEN
        counter := CASE UPPER(r.reason_code)
          WHEN 'FREE_SAMPLE' THEN COALESCE(pg_temp.acc(r.business_id, '5202'), pg_temp.acc(r.business_id, '5201'))
          WHEN 'LANDED_COST' THEN COALESCE(pg_temp.acc(r.business_id, '5105'), pg_temp.acc(r.business_id, '5101'))
          ELSE COALESCE(pg_temp.acc(r.business_id, '5106'), pg_temp.acc(r.business_id, '5201'))
        END;
      ELSE
        counter := CASE UPPER(r.reason_code)
          WHEN 'LANDED_COST' THEN COALESCE(pg_temp.acc(r.business_id, '5105'), pg_temp.acc(r.business_id, '5101'))
          ELSE pg_temp.acc(r.business_id, '4201')
        END;
      END IF;
      label := r.adjustment_number || ' - ' || COALESCE(r.reason_code, 'adjustment');

      PERFORM pg_temp.post(r.business_id, r.branch_id, r.id, 'stock_adjustment', r.adjustment_date,
                           counter, CASE WHEN is_dec THEN amt ELSE -amt END, label, r.adjustment_number);
      PERFORM pg_temp.post(r.business_id, r.branch_id, r.id, 'stock_adjustment', r.adjustment_date,
                           inv, CASE WHEN is_dec THEN -amt ELSE amt END, label, r.adjustment_number);

      itc := 0;
      rate := COALESCE(r.item_tax_rate, 0);
      IF is_dec AND UPPER(r.adjustment_type) = 'QUANTITY'
         AND UPPER(r.reason_code) IN ('DAMAGE', 'THEFT', 'EXPIRED', 'WRITE_DOWN', 'FREE_SAMPLE')
         AND rate > 0 THEN
        SELECT COALESCE(pi.igst_amount, 0) > 0 INTO inter
          FROM purchase_items pi
          JOIN purchases pu ON pu.id = pi.purchase_id
         WHERE pi.item_id = r.item_id AND pu.business_id = r.business_id AND pu.deleted_at IS NULL
           AND COALESCE(pu.status, '') NOT IN ('draft', 'cancelled')
           AND pu.itc_eligible IS DISTINCT FROM false
         ORDER BY pu.bill_date DESC, pu.created_at DESC
         LIMIT 1;
        IF FOUND THEN
          itc := ROUND(amt * rate / 100, 2);
          label := 'ITC reversed u/s 17(5)(h) - ' || r.adjustment_number;
          PERFORM pg_temp.post(r.business_id, r.branch_id, r.id, 'itc_reversal', r.adjustment_date,
                               counter, itc, label, r.adjustment_number);
          IF inter THEN
            PERFORM pg_temp.post(r.business_id, r.branch_id, r.id, 'itc_reversal', r.adjustment_date,
                                 pg_temp.acc(r.business_id, '1112'), -itc, label, r.adjustment_number);
          ELSE
            half := ROUND(itc / 2, 2);
            PERFORM pg_temp.post(r.business_id, r.branch_id, r.id, 'itc_reversal', r.adjustment_date,
                                 pg_temp.acc(r.business_id, '1110'), -half, label, r.adjustment_number);
            PERFORM pg_temp.post(r.business_id, r.branch_id, r.id, 'itc_reversal', r.adjustment_date,
                                 pg_temp.acc(r.business_id, '1111'), -(itc - half), label, r.adjustment_number);
          END IF;
        END IF;
      END IF;

      UPDATE inventory_adjustments
         SET value_change = CASE WHEN is_dec THEN -amt ELSE amt END,
             gst_impact = -itc,
             updated_at = CURRENT_TIMESTAMP
       WHERE id = r.id;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'inventory adjustment % not back-posted: %', r.adjustment_number, SQLERRM;
    END;
  END LOOP;
END $$;

-- 3c. Final sales invoices with no ledger (SO1: sales-order / estimate / WhatsApp conversions).
DO $$
DECLARE
  r RECORD;
  p RECORD;
  tax NUMERIC;
  taxable NUMERIC;
  cogs NUMERIC;
  perpetual BOOLEAN;
  ref TEXT;
BEGIN
  FOR r IN
    SELECT i.*
      FROM invoices i
     WHERE i.status = 'final'
       AND i.deleted_at IS NULL
       AND COALESCE(i.document_type, 'tax_invoice') IN ('tax_invoice', 'bill_of_supply')
       AND COALESCE(i.is_export, false) = false
       AND COALESCE(i.grand_total, 0) > 0
       AND NOT EXISTS (SELECT 1 FROM ledger_entry_lines l WHERE l.voucher_id = i.id)
  LOOP
    BEGIN
      ref := r.invoice_number;
      tax := COALESCE(r.cgst_total, 0) + COALESCE(r.sgst_total, 0) + COALESCE(r.igst_total, 0);
      taxable := r.grand_total - tax - COALESCE(r.round_off, 0);

      PERFORM pg_temp.post(r.business_id, r.branch_id, r.id, 'invoice', r.invoice_date,
                           pg_temp.acc(r.business_id, '1103'), r.grand_total, 'Sales - Invoice ' || ref, ref);
      PERFORM pg_temp.post(r.business_id, r.branch_id, r.id, 'invoice', r.invoice_date,
                           pg_temp.acc(r.business_id, '4101'), -taxable, 'Sales (taxable) - Invoice ' || ref, ref);
      PERFORM pg_temp.post(r.business_id, r.branch_id, r.id, 'invoice', r.invoice_date,
                           pg_temp.acc(r.business_id, '2150'), -COALESCE(r.cgst_total, 0), 'Output CGST - Invoice ' || ref, ref);
      PERFORM pg_temp.post(r.business_id, r.branch_id, r.id, 'invoice', r.invoice_date,
                           pg_temp.acc(r.business_id, '2151'), -COALESCE(r.sgst_total, 0), 'Output SGST - Invoice ' || ref, ref);
      PERFORM pg_temp.post(r.business_id, r.branch_id, r.id, 'invoice', r.invoice_date,
                           pg_temp.acc(r.business_id, '2152'), -COALESCE(r.igst_total, 0), 'Output IGST - Invoice ' || ref, ref);
      PERFORM pg_temp.post(r.business_id, r.branch_id, r.id, 'invoice', r.invoice_date,
                           pg_temp.acc(r.business_id, '5299'), -COALESCE(r.round_off, 0), 'Round off - Invoice ' || ref, ref);

      SELECT COALESCE(bs.inventory_model, 'perpetual') <> 'periodic' INTO perpetual
        FROM (SELECT r.business_id AS business_id) x
        LEFT JOIN business_settings bs ON bs.business_id = x.business_id;
      IF perpetual THEN
        SELECT COALESCE(SUM(ii.quantity * COALESCE(it.purchase_price, 0)), 0) INTO cogs
          FROM invoice_items ii
          JOIN items it ON it.id = ii.item_id AND it.business_id = r.business_id
         WHERE ii.invoice_id = r.id AND it.item_type = 'goods';
        PERFORM pg_temp.post(r.business_id, r.branch_id, r.id, 'invoice', r.invoice_date,
                             pg_temp.acc(r.business_id, '5104'), cogs, 'Cost of goods sold - ' || ref, ref);
        PERFORM pg_temp.post(r.business_id, r.branch_id, r.id, 'invoice', r.invoice_date,
                             pg_temp.acc(r.business_id, '1104'), -cogs, 'Cost of goods sold - ' || ref, ref);
      END IF;

      FOR p IN
        SELECT pay.* FROM payments pay
         WHERE pay.reference_id = r.id
           AND pay.type = 'receivable'
           AND pay.deleted_at IS NULL
           AND COALESCE(pay.amount, 0) > 0
           AND NOT EXISTS (SELECT 1 FROM ledger_entry_lines l WHERE l.voucher_id = pay.id)
      LOOP
        PERFORM pg_temp.post(p.business_id, COALESCE(p.branch_id, r.branch_id), p.id, 'payment', p.payment_date,
                             pg_temp.acc(p.business_id, CASE WHEN LOWER(COALESCE(p.payment_mode, 'cash')) = 'cash' THEN '1101' ELSE '1102' END),
                             p.amount, 'Receipt against Invoice ' || ref, ref);
        PERFORM pg_temp.post(p.business_id, COALESCE(p.branch_id, r.branch_id), p.id, 'payment', p.payment_date,
                             pg_temp.acc(p.business_id, '1103'), -p.amount, 'Receipt against Invoice ' || ref, ref);
      END LOOP;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'invoice % not back-posted: %', r.invoice_number, SQLERRM;
    END;
  END LOOP;
END $$;

-- 3d. Final purchase bills with no ledger (PO conversion). Inventory transfer is added in step 5.
DO $$
DECLARE
  r RECORD;
  tax NUMERIC;
  itc BOOLEAN;
  ref TEXT;
BEGIN
  FOR r IN
    SELECT pu.*
      FROM purchases pu
     WHERE pu.status = 'final'
       AND pu.deleted_at IS NULL
       AND COALESCE(pu.is_reverse_charge, false) = false
       AND COALESCE(pu.grand_total, 0) > 0
       AND NOT EXISTS (SELECT 1 FROM ledger_entry_lines l WHERE l.voucher_id = pu.id)
  LOOP
    BEGIN
      ref := COALESCE(r.bill_number, LEFT(r.id::text, 8));
      tax := COALESCE(r.cgst_total, 0) + COALESCE(r.sgst_total, 0) + COALESCE(r.igst_total, 0);
      itc := r.itc_eligible IS DISTINCT FROM false;

      PERFORM pg_temp.post(r.business_id, r.branch_id, r.id, 'purchase', r.bill_date,
                           pg_temp.acc(r.business_id, '5101'),
                           r.grand_total - COALESCE(r.round_off, 0) - CASE WHEN itc THEN tax ELSE 0 END,
                           'Purchases (taxable) - ' || ref, ref);
      IF itc THEN
        PERFORM pg_temp.post(r.business_id, r.branch_id, r.id, 'purchase', r.bill_date,
                             pg_temp.acc(r.business_id, '1110'), COALESCE(r.cgst_total, 0), 'Input CGST - ' || ref, ref);
        PERFORM pg_temp.post(r.business_id, r.branch_id, r.id, 'purchase', r.bill_date,
                             pg_temp.acc(r.business_id, '1111'), COALESCE(r.sgst_total, 0), 'Input SGST - ' || ref, ref);
        PERFORM pg_temp.post(r.business_id, r.branch_id, r.id, 'purchase', r.bill_date,
                             pg_temp.acc(r.business_id, '1112'), COALESCE(r.igst_total, 0), 'Input IGST - ' || ref, ref);
      END IF;
      PERFORM pg_temp.post(r.business_id, r.branch_id, r.id, 'purchase', r.bill_date,
                           pg_temp.acc(r.business_id, '5299'), COALESCE(r.round_off, 0), 'Round off - ' || ref, ref);
      PERFORM pg_temp.post(r.business_id, r.branch_id, r.id, 'purchase', r.bill_date,
                           pg_temp.acc(r.business_id, CASE WHEN r.supplier_id IS NULL THEN '1101' ELSE '2101' END),
                           -r.grand_total,
                           CASE WHEN r.supplier_id IS NULL THEN 'Cash purchase - ' ELSE 'Credit purchase - ' END || ref, ref);
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'purchase % not back-posted: %', r.bill_number, SQLERRM;
    END;
  END LOOP;
END $$;

-- 4. QA bill AM/2026/52 (P-SAC): legal retainer SAC 998216 stocked as goods.
DO $$
DECLARE
  v_purchase CONSTANT UUID := 'a2ed5803-665a-413d-8427-d64f1c8d0fea';
  v_business CONSTANT UUID := '5ee47b2a-47bf-4e93-84ff-cf2142fd2e0e';
  v_item UUID;
BEGIN
  SELECT pi.item_id INTO v_item
    FROM purchase_items pi
    JOIN purchases pu ON pu.id = pi.purchase_id
   WHERE pu.id = v_purchase AND pu.business_id = v_business
     AND pi.hsn_sac LIKE '99%' AND COALESCE(pi.line_item_type, 'goods') = 'goods'
   LIMIT 1;
  IF v_item IS NULL THEN
    RETURN;
  END IF;

  UPDATE purchase_items SET line_item_type = 'service', item_id = NULL
   WHERE purchase_id = v_purchase AND item_id = v_item;
  UPDATE purchase_items SET item_id = NULL
   WHERE item_id = v_item AND line_item_type = 'service';
  DELETE FROM stock_movements
   WHERE business_id = v_business AND item_id = v_item AND reference_id = v_purchase;

  IF NOT EXISTS (SELECT 1 FROM stock_movements WHERE item_id = v_item)
     AND NOT EXISTS (SELECT 1 FROM invoice_items WHERE item_id = v_item) THEN
    DELETE FROM branch_item_stock WHERE business_id = v_business AND item_id = v_item;
    DELETE FROM location_stock WHERE item_id = v_item;
    UPDATE items SET item_type = 'service', current_stock = 0, updated_at = CURRENT_TIMESTAMP
     WHERE id = v_item AND business_id = v_business;
  END IF;
END $$;

-- 5. Inventory transfer on final bills must equal the bill's goods taxable value (P-INVVAL).
DO $$
DECLARE
  r RECORD;
  inv UUID;
  pur UUID;
  ref TEXT;
BEGIN
  FOR r IN
    SELECT * FROM (
      SELECT pu.id, pu.business_id, pu.branch_id, pu.bill_date, pu.bill_number,
             (SELECT COALESCE(SUM(pi.taxable_value), 0)
                FROM purchase_items pi
                JOIN items i ON i.id = pi.item_id AND i.business_id = pu.business_id
               WHERE pi.purchase_id = pu.id AND i.item_type = 'goods'
                 AND COALESCE(pi.line_item_type, 'goods') <> 'service') AS goods,
             (SELECT COALESCE(SUM(l.debit), 0)
                FROM ledger_entry_lines l
                JOIN accounts a ON a.id = l.account_id
               WHERE l.voucher_id = pu.id AND l.voucher_type = 'purchase' AND a.account_code = '1104') AS inv_dr
        FROM purchases pu
        LEFT JOIN business_settings bs ON bs.business_id = pu.business_id
       WHERE pu.status = 'final' AND pu.deleted_at IS NULL
         AND COALESCE(bs.inventory_model, 'perpetual') <> 'periodic'
         AND EXISTS (SELECT 1 FROM ledger_entry_lines l WHERE l.voucher_id = pu.id AND l.voucher_type = 'purchase')
    ) b
    WHERE ABS(b.goods - b.inv_dr) > 0.005
  LOOP
    BEGIN
      ref := COALESCE(r.bill_number, LEFT(r.id::text, 8));
      inv := pg_temp.acc(r.business_id, '1104');
      pur := pg_temp.acc(r.business_id, '5101');
      DELETE FROM ledger_entry_lines l
       WHERE l.voucher_id = r.id AND l.voucher_type = 'purchase'
         AND ((l.account_id = inv AND l.debit > 0) OR (l.account_id = pur AND l.narration LIKE 'Transfer to inventory%'));
      PERFORM pg_temp.post(r.business_id, r.branch_id, r.id, 'purchase', r.bill_date,
                           inv, r.goods, 'Inventory addition - ' || ref, ref);
      PERFORM pg_temp.post(r.business_id, r.branch_id, r.id, 'purchase', r.bill_date,
                           pur, -r.goods, 'Transfer to inventory - ' || ref, ref);
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'purchase % inventory not restated: %', r.bill_number, SQLERRM;
    END;
  END LOOP;
END $$;
