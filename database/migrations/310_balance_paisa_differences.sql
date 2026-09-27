-- validate_voucher_balance lets a voucher commit with up to ₹0.01 between debits and
-- credits, so paisa rounding differences accumulated and the trial balance no longer
-- tallies. Post each voucher's residual difference to a Round Off account (5299) inside
-- the same voucher so every voucher balances exactly.
DO $$
DECLARE
    v RECORD;
    v_round UUID;
    v_group UUID;
BEGIN
    FOR v IN
        SELECT business_id, voucher_id, voucher_type,
               ROUND(SUM(debit) - SUM(credit), 2) AS diff,
               MAX(entry_date) AS entry_date,
               MAX(reference_number) AS reference_number,
               (ARRAY_AGG(branch_id))[1] AS branch_id
          FROM ledger_entry_lines
         GROUP BY business_id, voucher_id, voucher_type
        HAVING ROUND(SUM(debit) - SUM(credit), 2) <> 0
           AND ABS(SUM(debit) - SUM(credit)) <= 0.01
    LOOP
        SELECT id INTO v_round FROM accounts
         WHERE business_id = v.business_id AND account_code = '5299' LIMIT 1;
        IF v_round IS NULL THEN
            SELECT account_group_id INTO v_group FROM accounts
             WHERE business_id = v.business_id AND account_code = '5201' LIMIT 1;
            INSERT INTO accounts (business_id, account_code, account_name, account_type, account_group_id,
                                  nature, is_system, sort_order, description)
            VALUES (v.business_id, '5299', 'Round Off', 'expense', v_group, 'debit', true, 99,
                    'Paisa rounding differences between voucher debits and credits')
            RETURNING id INTO v_round;
        END IF;

        INSERT INTO ledger_entry_lines (
            business_id, voucher_id, voucher_type, account_id, entry_date,
            debit, credit, narration, reference_number, branch_id
        ) VALUES (
            v.business_id, v.voucher_id, v.voucher_type, v_round, v.entry_date,
            CASE WHEN v.diff < 0 THEN -v.diff ELSE 0 END,
            CASE WHEN v.diff > 0 THEN v.diff ELSE 0 END,
            'Round off (paisa difference)', v.reference_number, v.branch_id
        );
    END LOOP;
END $$;
