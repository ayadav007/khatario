-- Purchase compensation cess + repair: legacy fixed-asset disposals with no ledger voucher
--   1. purchase_items.cess_amount / purchases.cess_total: cess on the supplier's bill is now
--      captured, posted to Input Cess (1113) and reported in GSTR-3B 4A, GSTR-9 Table 6 and 2B recon.
--   2. repair: assets marked is_disposed before migration 318 never posted a disposal voucher, so
--      cost stayed in the Fixed Assets account and accumulated depreciation in 1202.
--      * Accumulated depreciation removed = what the ledger actually holds in 1202 for the asset.
--      * Proceeds are debited to the disposal account recorded on the asset / disposal row; when
--        none was recorded, to 3100 Opening Balance Adjustment (the receipt was never booked).
--        Reclassify with a journal if the bank account is known.
--      * Rows in a locked or closed period, or missing accounts, are skipped with a NOTICE.
-- Safe to re-run: columns are IF NOT EXISTS; a disposal is posted only if it has no ledger lines.

ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS cess_amount NUMERIC(15,2) NOT NULL DEFAULT 0;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS cess_total NUMERIC(15,2) NOT NULL DEFAULT 0;

DO $$
DECLARE
  r RECORD;
  v_disposal UUID;
  v_branch UUID;
  v_accum UUID;
  v_gain UUID;
  v_loss UUID;
  v_proceeds_acc UUID;
  v_accumulated NUMERIC(15,2);
  v_cost NUMERIC(15,2);
  v_proceeds NUMERIC(15,2);
  v_gain_loss NUMERIC(15,2);
  v_label TEXT;
BEGIN
  FOR r IN
    SELECT fa.id, fa.business_id, fa.branch_id, fa.account_id, fa.asset_name, fa.asset_code,
           fa.purchase_cost,
           COALESCE(fa.disposal_date, ad.disposal_date) AS disposal_date,
           COALESCE(fa.disposal_amount, ad.disposal_amount, 0) AS proceeds,
           COALESCE(fa.disposal_account_id, ad.disposal_account_id) AS proceeds_account_id,
           ad.id AS disposal_id
      FROM fixed_assets fa
      LEFT JOIN asset_disposals ad ON ad.asset_id = fa.id
     WHERE fa.is_disposed = true
       AND fa.account_id IS NOT NULL
       AND COALESCE(fa.purchase_cost, 0) > 0
       AND NOT EXISTS (
         SELECT 1 FROM ledger_entry_lines l
          WHERE l.voucher_type = 'asset_disposal'
            AND l.voucher_id = COALESCE(ad.voucher_id, ad.id)
       )
  LOOP
    IF r.disposal_date IS NULL THEN
      RAISE NOTICE 'Asset % (%): no disposal date, disposal not posted', r.asset_code, r.id;
      CONTINUE;
    END IF;

    SELECT id INTO v_accum FROM accounts WHERE business_id = r.business_id AND account_code = '1202' LIMIT 1;
    SELECT id INTO v_gain  FROM accounts WHERE business_id = r.business_id AND account_code = '4205' LIMIT 1;
    SELECT id INTO v_loss  FROM accounts WHERE business_id = r.business_id AND account_code = '5218' LIMIT 1;
    v_proceeds_acc := COALESCE(r.proceeds_account_id,
      (SELECT id FROM accounts WHERE business_id = r.business_id AND account_code = '3100' LIMIT 1));
    IF v_accum IS NULL OR v_gain IS NULL OR v_loss IS NULL OR v_proceeds_acc IS NULL THEN
      RAISE NOTICE 'Asset % (%): account 1202/4205/5218/3100 missing, disposal not posted', r.asset_code, r.id;
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(l.credit - l.debit), 0) INTO v_accumulated
      FROM ledger_entry_lines l
      JOIN depreciation_schedule ds ON ds.id = l.voucher_id
     WHERE ds.asset_id = r.id AND l.voucher_type = 'depreciation' AND l.account_id = v_accum;

    v_cost := ROUND(r.purchase_cost, 2);
    v_accumulated := LEAST(GREATEST(ROUND(v_accumulated, 2), 0), v_cost);
    v_proceeds := GREATEST(ROUND(r.proceeds, 2), 0);
    v_gain_loss := v_proceeds - (v_cost - v_accumulated);
    v_label := 'Disposal (backfill): ' || r.asset_name || ' (' || r.asset_code || ')';
    v_branch := COALESCE(r.branch_id,
      (SELECT id FROM branches WHERE business_id = r.business_id AND is_default = true LIMIT 1));

    BEGIN
      v_disposal := r.disposal_id;
      IF v_disposal IS NULL THEN
        INSERT INTO asset_disposals (business_id, asset_id, disposal_date, disposal_amount,
                                     disposal_account_id, reason)
        VALUES (r.business_id, r.id, r.disposal_date, v_proceeds, r.proceeds_account_id,
                'Backfilled by migration 321')
        RETURNING id INTO v_disposal;
      END IF;

      INSERT INTO ledger_entry_lines (business_id, voucher_id, voucher_type, account_id, entry_date,
                                      debit, credit, narration, reference_number, branch_id)
      SELECT r.business_id, v_disposal, 'asset_disposal', x.account_id, r.disposal_date,
             x.debit, x.credit, x.narration, r.asset_code, v_branch
        FROM (VALUES
          (v_proceeds_acc, v_proceeds, 0::numeric, v_label),
          (v_accum, v_accumulated, 0::numeric, v_label),
          (r.account_id, 0::numeric, v_cost, v_label),
          (v_gain, 0::numeric, GREATEST(v_gain_loss, 0), v_label || ' - profit'),
          (v_loss, GREATEST(-v_gain_loss, 0), 0::numeric, v_label || ' - loss')
        ) AS x(account_id, debit, credit, narration)
       WHERE x.debit > 0 OR x.credit > 0;

      UPDATE asset_disposals
         SET voucher_id = v_disposal, journal_entry_id = COALESCE(journal_entry_id, v_disposal),
             book_value = v_cost - v_accumulated, gain_loss = v_gain_loss
       WHERE id = v_disposal;
      UPDATE fixed_assets SET current_book_value = 0, updated_at = CURRENT_TIMESTAMP WHERE id = r.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Asset % (%): disposal not posted: %', r.asset_code, r.id, SQLERRM;
    END;
  END LOOP;
END $$;
