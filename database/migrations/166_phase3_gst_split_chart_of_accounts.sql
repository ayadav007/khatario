-- ============================================================================
-- Migration 166: Phase-3 GST split — Chart of Accounts additions
-- ============================================================================
-- Adds the proper Output GST liability accounts (CGST/SGST/IGST/Cess + Net
-- settlement + RCM Output) and Input GST asset accounts (CGST/SGST/IGST/Cess
-- + ITC Suspense + RCM Input) so that invoice / purchase ledger postings can
-- split GST out of revenue / cost into their correct heads — required for
-- Indian GAAP compliance and for any meaningful GSTR-3B reconciliation.
--
-- Strategy: ADD only. We do NOT renumber any existing account. The legacy
-- catch-all "2103 GST Payable" stays in place (renamed to make its legacy
-- status obvious) so old ledger lines and any user-defined mappings keep
-- pointing somewhere valid. A separate one-off reclassification JV will
-- drain its balance into the new split accounts after Phase-3 ships.
--
-- Idempotent: safe to run multiple times. Per-business backfill is handled
-- by ensure_phase3_gst_accounts(business_id) which is also re-callable.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Per-business backfill function
-- ----------------------------------------------------------------------------
-- Adds the new accounts for one business in the same shape that the
-- 063_chart_of_accounts_seed.sql function uses, so Trial Balance / Balance
-- Sheet groupings continue to work.
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS ensure_phase3_gst_accounts(UUID);

CREATE OR REPLACE FUNCTION ensure_phase3_gst_accounts(p_business_id UUID)
RETURNS TABLE(out_account_code VARCHAR, out_action TEXT) AS $$
DECLARE
    v_current_assets_id UUID;
    v_current_liabilities_id UUID;
BEGIN
    -- Resolve target groups created by migration 063
    SELECT id INTO v_current_assets_id
      FROM account_groups
     WHERE business_id = p_business_id AND group_code = '1100';

    SELECT id INTO v_current_liabilities_id
      FROM account_groups
     WHERE business_id = p_business_id AND group_code = '2100';

    IF v_current_assets_id IS NULL OR v_current_liabilities_id IS NULL THEN
        RAISE NOTICE 'Phase-3 GST seed skipped for business %: base CoA groups (1100/2100) not present yet.', p_business_id;
        RETURN;
    END IF;

    -- ------------------------------------------------------------------
    -- Output GST liabilities (2150-2155)
    -- ------------------------------------------------------------------
    INSERT INTO accounts (business_id, account_code, account_name, account_type, account_group_id, nature, is_system, sort_order)
    VALUES
        (p_business_id, '2150', 'Output CGST Payable',          'liability', v_current_liabilities_id, 'credit', true, 50),
        (p_business_id, '2151', 'Output SGST Payable',          'liability', v_current_liabilities_id, 'credit', true, 51),
        (p_business_id, '2152', 'Output IGST Payable',          'liability', v_current_liabilities_id, 'credit', true, 52),
        (p_business_id, '2153', 'Output Cess Payable',          'liability', v_current_liabilities_id, 'credit', true, 53),
        (p_business_id, '2154', 'GST Payable (Net Settlement)', 'liability', v_current_liabilities_id, 'credit', true, 54),
        (p_business_id, '2155', 'RCM Output Tax Payable',       'liability', v_current_liabilities_id, 'credit', true, 55)
    ON CONFLICT (business_id, account_code) DO NOTHING;

    -- ------------------------------------------------------------------
    -- Input GST assets (1110-1115)
    -- ------------------------------------------------------------------
    INSERT INTO accounts (business_id, account_code, account_name, account_type, account_group_id, nature, is_system, sort_order)
    VALUES
        (p_business_id, '1110', 'Input CGST (ITC)',                       'asset', v_current_assets_id, 'debit', true, 10),
        (p_business_id, '1111', 'Input SGST (ITC)',                       'asset', v_current_assets_id, 'debit', true, 11),
        (p_business_id, '1112', 'Input IGST (ITC)',                       'asset', v_current_assets_id, 'debit', true, 12),
        (p_business_id, '1113', 'Input Cess (ITC)',                       'asset', v_current_assets_id, 'debit', true, 13),
        (p_business_id, '1114', 'ITC Suspense (Pending GSTR-2B Match)',   'asset', v_current_assets_id, 'debit', true, 14),
        (p_business_id, '1115', 'RCM Input GST (ITC)',                    'asset', v_current_assets_id, 'debit', true, 15)
    ON CONFLICT (business_id, account_code) DO NOTHING;

    -- ------------------------------------------------------------------
    -- Re-label the legacy 2103 account so it is unmistakable in reports.
    -- We keep is_system = true so the user can't delete it, but flip it
    -- to inactive so the new posting code never picks it accidentally.
    -- The one-off reclassification JV (run later) will drain its balance.
    -- ------------------------------------------------------------------
    UPDATE accounts
       SET account_name = 'GST Payable (Legacy — pre-Phase-3, do not use)',
           is_active = false
     WHERE business_id = p_business_id
       AND account_code = '2103'
       AND account_name IN ('GST Payable', 'GST Payable (Legacy — pre-Phase-3, do not use)');

    -- Return what we did so the caller can log
    RETURN QUERY
        SELECT a.account_code AS out_account_code, 'present'::TEXT AS out_action
          FROM accounts a
         WHERE a.business_id = p_business_id
           AND a.account_code = ANY(ARRAY[
               '2150','2151','2152','2153','2154','2155',
               '1110','1111','1112','1113','1114','1115',
               '2103'
           ])
         ORDER BY a.account_code;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION ensure_phase3_gst_accounts(UUID) IS
'Phase-3: idempotently adds the GST split accounts (Output 2150-2155, Input 1110-1115) for a business and deactivates the legacy 2103 GST Payable. Safe to call multiple times. Called from migration 166 for every existing business and from chart_of_accounts seed flow for new businesses.';

-- ----------------------------------------------------------------------------
-- 2. Backfill EVERY existing business that already has the seed CoA
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    biz RECORD;
    v_added INT := 0;
    v_skipped INT := 0;
BEGIN
    FOR biz IN
        SELECT b.id, b.name
          FROM businesses b
         WHERE EXISTS (
             SELECT 1 FROM account_groups ag
              WHERE ag.business_id = b.id AND ag.group_code = '1100'
         )
           AND EXISTS (
             SELECT 1 FROM account_groups ag
              WHERE ag.business_id = b.id AND ag.group_code = '2100'
         )
    LOOP
        BEGIN
            PERFORM ensure_phase3_gst_accounts(biz.id);
            v_added := v_added + 1;
            RAISE NOTICE 'Phase-3 GST seed: OK for % (%)', biz.name, biz.id;
        EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'Phase-3 GST seed FAILED for business % (%): %', biz.name, biz.id, SQLERRM;
            v_skipped := v_skipped + 1;
        END;
    END LOOP;

    RAISE NOTICE 'Phase-3 GST seed: backfilled % businesses, skipped %', v_added, v_skipped;
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Convenience view to quickly see Phase-3 readiness across businesses
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_phase3_gst_readiness AS
SELECT
    b.id              AS business_id,
    b.name            AS business_name,
    BOOL_OR(a.account_code = '2150') AS has_output_cgst,
    BOOL_OR(a.account_code = '2151') AS has_output_sgst,
    BOOL_OR(a.account_code = '2152') AS has_output_igst,
    BOOL_OR(a.account_code = '2154') AS has_gst_settlement,
    BOOL_OR(a.account_code = '2155') AS has_rcm_output,
    BOOL_OR(a.account_code = '1110') AS has_input_cgst,
    BOOL_OR(a.account_code = '1111') AS has_input_sgst,
    BOOL_OR(a.account_code = '1112') AS has_input_igst,
    BOOL_OR(a.account_code = '1115') AS has_rcm_input,
    BOOL_AND(
        a.account_code IN ('2150','2151','2152','2154','2155','1110','1111','1112','1115')
    ) AS phase3_ready
FROM businesses b
LEFT JOIN accounts a
    ON a.business_id = b.id
   AND a.account_code = ANY(ARRAY['2150','2151','2152','2154','2155','1110','1111','1112','1115'])
GROUP BY b.id, b.name;

COMMENT ON VIEW v_phase3_gst_readiness IS
'Phase-3: per-business readiness flag for GST split. phase3_ready=true means the business has all required output + input GST accounts wired up.';
