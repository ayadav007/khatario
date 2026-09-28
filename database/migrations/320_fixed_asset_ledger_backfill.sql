-- repair: fixed assets and posted depreciation that predate ledger posting (QA F2)
--   Assets created before migration 318 never posted Dr Fixed Asset, and depreciation marked
--   is_posted in depreciation_schedule never posted Dr Depreciation / Cr 1202, so the balance
--   sheet showed neither the asset nor its accumulated depreciation.
--   * Capitalisation is credited to 3100 Opening Balance Adjustment: the original payment was
--     never booked either, so there is no bank or creditor line to reverse. Reclassify with a
--     journal if the funding source is known.
--   * Rows in a locked or closed period are skipped with a NOTICE rather than failing the run.
-- Safe to re-run: each voucher is posted only if it has no ledger lines yet.

DO $$
DECLARE
  r RECORD;
  v_branch UUID;
  v_credit UUID;
  v_accum UUID;
BEGIN
  FOR r IN
    SELECT fa.id, fa.business_id, fa.branch_id, fa.account_id, fa.asset_name, fa.asset_code,
           fa.purchase_date, fa.purchase_cost
      FROM fixed_assets fa
     WHERE COALESCE(fa.purchase_cost, 0) > 0
       AND fa.account_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM ledger_entry_lines l
          WHERE l.voucher_id = fa.id AND l.voucher_type = 'asset_purchase'
       )
  LOOP
    SELECT id INTO v_credit FROM accounts
     WHERE business_id = r.business_id AND account_code = '3100' LIMIT 1;
    IF v_credit IS NULL THEN
      RAISE NOTICE 'Asset % (%): account 3100 missing, capitalisation not posted', r.asset_code, r.id;
      CONTINUE;
    END IF;
    v_branch := COALESCE(r.branch_id,
      (SELECT id FROM branches WHERE business_id = r.business_id AND is_default = true LIMIT 1));
    BEGIN
      INSERT INTO ledger_entry_lines (business_id, voucher_id, voucher_type, account_id, entry_date,
                                      debit, credit, narration, reference_number, branch_id)
      VALUES
        (r.business_id, r.id, 'asset_purchase', r.account_id, r.purchase_date, r.purchase_cost, 0,
         'Fixed asset purchase (backfill): ' || r.asset_name, r.asset_code, v_branch),
        (r.business_id, r.id, 'asset_purchase', v_credit, r.purchase_date, 0, r.purchase_cost,
         'Fixed asset purchase (backfill): ' || r.asset_name, r.asset_code, v_branch);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Asset % (%): capitalisation not posted: %', r.asset_code, r.id, SQLERRM;
    END;
  END LOOP;

  FOR r IN
    SELECT ds.id, ds.business_id, ds.period_end_date, ds.depreciation_amount, ds.financial_year,
           fa.branch_id, fa.depreciation_account_id, fa.asset_name, fa.asset_code
      FROM depreciation_schedule ds
      JOIN fixed_assets fa ON fa.id = ds.asset_id
     WHERE ds.is_posted = true
       AND COALESCE(ds.depreciation_amount, 0) > 0
       AND fa.depreciation_account_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM ledger_entry_lines l
          WHERE l.voucher_id = ds.id AND l.voucher_type = 'depreciation'
       )
  LOOP
    SELECT id INTO v_accum FROM accounts
     WHERE business_id = r.business_id AND account_code = '1202' LIMIT 1;
    IF v_accum IS NULL THEN
      RAISE NOTICE 'Depreciation % (%): account 1202 missing, not posted', r.asset_code, r.id;
      CONTINUE;
    END IF;
    v_branch := COALESCE(r.branch_id,
      (SELECT id FROM branches WHERE business_id = r.business_id AND is_default = true LIMIT 1));
    BEGIN
      INSERT INTO ledger_entry_lines (business_id, voucher_id, voucher_type, account_id, entry_date,
                                      debit, credit, narration, reference_number, branch_id)
      VALUES
        (r.business_id, r.id, 'depreciation', r.depreciation_account_id, r.period_end_date,
         r.depreciation_amount, 0,
         'Depreciation (backfill): ' || r.asset_name || ' - ' || r.financial_year, r.asset_code, v_branch),
        (r.business_id, r.id, 'depreciation', v_accum, r.period_end_date,
         0, r.depreciation_amount,
         'Depreciation (backfill): ' || r.asset_name || ' - ' || r.financial_year, r.asset_code, v_branch);
      UPDATE depreciation_schedule SET journal_entry_id = COALESCE(journal_entry_id, id) WHERE id = r.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Depreciation % (%): not posted: %', r.asset_code, r.id, SQLERRM;
    END;
  END LOOP;
END $$;
