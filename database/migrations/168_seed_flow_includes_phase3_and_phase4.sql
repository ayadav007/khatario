-- ============================================================================
-- Migration 168: Seed flow includes Phase-3 GST accounts + Phase-4 settings
-- ============================================================================
-- WHY THIS EXISTS
-- ---------------
-- Migration 063 created create_default_chart_of_accounts(business_id) which
-- is called by the signup flow (app/api/signup/route.ts:190) and by the
-- admin /api/accounts/initialize endpoint whenever a new business is born.
--
-- Migration 166 added Phase-3 GST split accounts (Output 2150-2155, Input
-- 1110-1115) but only back-filled EXISTING businesses. The seed function
-- was never taught to call ensure_phase3_gst_accounts(), so every business
-- created AFTER migration 166 was missing the GST split accounts.
--
-- Since Phase-5 made ledger posting fail loudly when core accounts are
-- absent, the very next invoice with CGST > 0 in a newly-created business
-- would throw 500. This migration closes that gap.
--
-- Additionally, the business_settings row was previously created lazily
-- (on first use). Phase-4 requires inventory_model='periodic' and
-- stock_valuation_method (migration 167 added the columns with DEFAULTS,
-- but only if a row exists). We now guarantee the row is created at
-- business birth so Phase-4 defaults are always in effect.
--
-- IDEMPOTENT: safe to run multiple times. Uses CREATE OR REPLACE and
-- ON CONFLICT DO NOTHING throughout.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Patch create_default_chart_of_accounts to call Phase-3 seeding at end.
-- ----------------------------------------------------------------------------
-- The function body below is identical to migration 063 for accounts 1101-
-- 5211, then appends a PERFORM call to ensure_phase3_gst_accounts() and a
-- bootstrap INSERT for business_settings.
--
-- We rewrite the whole function (rather than create a tiny wrapper) because
-- the signup route calls this exact name and signature, and because
-- PL/pgSQL doesn't support injecting code into a function body from outside.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION create_default_chart_of_accounts(p_business_id UUID)
RETURNS void AS $$
DECLARE
    v_assets_group_id UUID;
    v_liabilities_group_id UUID;
    v_capital_group_id UUID;
    v_income_group_id UUID;
    v_expenses_group_id UUID;
    v_elimination_group_id UUID;
    v_current_assets_id UUID;
    v_fixed_assets_id UUID;
    v_current_liabilities_id UUID;
    v_sales_id UUID;
    v_purchases_id UUID;
BEGIN
    -- =========================================================================
    -- Top-level account groups (idempotent)
    -- =========================================================================
    INSERT INTO account_groups (business_id, group_code, group_name, group_type, is_system, sort_order)
    VALUES
        (p_business_id, '1000', 'Assets',                                    'asset',       true, 1),
        (p_business_id, '2000', 'Liabilities',                               'liability',   true, 2),
        (p_business_id, '3000', 'Capital',                                   'capital',     true, 3),
        (p_business_id, '4000', 'Income',                                    'income',      true, 4),
        (p_business_id, '5000', 'Expenses',                                  'expense',     true, 5),
        (p_business_id, '6000', 'Inter-Branch Transactions (Elimination)',   'elimination', true, 6)
    ON CONFLICT (business_id, group_code) DO NOTHING;

    SELECT id INTO v_assets_group_id      FROM account_groups WHERE business_id = p_business_id AND group_code = '1000';
    SELECT id INTO v_liabilities_group_id FROM account_groups WHERE business_id = p_business_id AND group_code = '2000';
    SELECT id INTO v_capital_group_id     FROM account_groups WHERE business_id = p_business_id AND group_code = '3000';
    SELECT id INTO v_income_group_id      FROM account_groups WHERE business_id = p_business_id AND group_code = '4000';
    SELECT id INTO v_expenses_group_id    FROM account_groups WHERE business_id = p_business_id AND group_code = '5000';
    SELECT id INTO v_elimination_group_id FROM account_groups WHERE business_id = p_business_id AND group_code = '6000';

    -- =========================================================================
    -- Sub-groups (idempotent)
    -- =========================================================================
    INSERT INTO account_groups (business_id, group_code, group_name, group_type, parent_group_id, is_system, sort_order)
    VALUES
        (p_business_id, '1100', 'Current Assets',        'asset',     v_assets_group_id,      true, 1),
        (p_business_id, '1200', 'Fixed Assets',          'asset',     v_assets_group_id,      true, 2),
        (p_business_id, '1300', 'Investments',           'asset',     v_assets_group_id,      true, 3),
        (p_business_id, '2100', 'Current Liabilities',   'liability', v_liabilities_group_id, true, 1),
        (p_business_id, '2200', 'Long-term Liabilities', 'liability', v_liabilities_group_id, true, 2),
        (p_business_id, '4100', 'Sales',                 'income',    v_income_group_id,      true, 1),
        (p_business_id, '4200', 'Other Income',          'income',    v_income_group_id,      true, 2),
        (p_business_id, '5100', 'Direct Expenses',       'expense',   v_expenses_group_id,    true, 1),
        (p_business_id, '5200', 'Indirect Expenses',     'expense',   v_expenses_group_id,    true, 2)
    ON CONFLICT (business_id, group_code) DO NOTHING;

    SELECT id INTO v_current_assets_id      FROM account_groups WHERE business_id = p_business_id AND group_code = '1100';
    SELECT id INTO v_fixed_assets_id        FROM account_groups WHERE business_id = p_business_id AND group_code = '1200';
    SELECT id INTO v_current_liabilities_id FROM account_groups WHERE business_id = p_business_id AND group_code = '2100';
    SELECT id INTO v_sales_id               FROM account_groups WHERE business_id = p_business_id AND group_code = '4100';
    SELECT id INTO v_purchases_id           FROM account_groups WHERE business_id = p_business_id AND group_code = '5100';

    -- =========================================================================
    -- Current Assets (1101-1108)
    -- =========================================================================
    INSERT INTO accounts (business_id, account_code, account_name, account_type, account_group_id, nature, is_system, sort_order)
    VALUES
        (p_business_id, '1101', 'Cash',                  'asset', v_current_assets_id, 'debit', true, 1),
        (p_business_id, '1102', 'Bank Account',          'asset', v_current_assets_id, 'debit', true, 2),
        (p_business_id, '1103', 'Accounts Receivable',   'asset', v_current_assets_id, 'debit', true, 3),
        (p_business_id, '1104', 'Inventory',             'asset', v_current_assets_id, 'debit', true, 4),
        (p_business_id, '1105', 'Prepaid Expenses',      'asset', v_current_assets_id, 'debit', true, 5),
        (p_business_id, '1106', 'Accrued Income',        'asset', v_current_assets_id, 'debit', true, 6),
        (p_business_id, '1107', 'Advances to Suppliers', 'asset', v_current_assets_id, 'debit', true, 7),
        (p_business_id, '1108', 'Loans and Advances',    'asset', v_current_assets_id, 'debit', true, 8)
    ON CONFLICT (business_id, account_code) DO NOTHING;

    -- Fixed Assets (1201-1202)
    INSERT INTO accounts (business_id, account_code, account_name, account_type, account_group_id, nature, is_system, sort_order)
    VALUES
        (p_business_id, '1201', 'Fixed Assets',             'asset', v_fixed_assets_id, 'debit',  true, 1),
        (p_business_id, '1202', 'Accumulated Depreciation', 'asset', v_fixed_assets_id, 'credit', true, 2)
    ON CONFLICT (business_id, account_code) DO NOTHING;

    -- =========================================================================
    -- Current Liabilities (2101-2110). Note: 2103 legacy is still seeded so
    -- ensure_phase3_gst_accounts() can flip it to inactive immediately below.
    -- =========================================================================
    INSERT INTO accounts (business_id, account_code, account_name, account_type, account_group_id, nature, is_system, sort_order)
    VALUES
        (p_business_id, '2101', 'Accounts Payable',        'liability', v_current_liabilities_id, 'credit', true, 1),
        (p_business_id, '2102', 'TDS Payable',             'liability', v_current_liabilities_id, 'credit', true, 2),
        (p_business_id, '2103', 'GST Payable',             'liability', v_current_liabilities_id, 'credit', true, 3),
        (p_business_id, '2104', 'Outstanding Expenses',    'liability', v_current_liabilities_id, 'credit', true, 4),
        (p_business_id, '2105', 'Accrued Expenses',        'liability', v_current_liabilities_id, 'credit', true, 5),
        (p_business_id, '2106', 'Advances from Customers', 'liability', v_current_liabilities_id, 'credit', true, 6),
        (p_business_id, '2107', 'Unearned Revenue',        'liability', v_current_liabilities_id, 'credit', true, 7),
        (p_business_id, '2108', 'Provisions',              'liability', v_current_liabilities_id, 'credit', true, 8),
        (p_business_id, '2109', 'Current Tax Payable',     'liability', v_current_liabilities_id, 'credit', true, 9),
        (p_business_id, '2110', 'Deferred Tax Liability',  'liability', v_current_liabilities_id, 'credit', true, 10)
    ON CONFLICT (business_id, account_code) DO NOTHING;

    -- =========================================================================
    -- Capital (3001-3002)
    -- =========================================================================
    INSERT INTO accounts (business_id, account_code, account_name, account_type, account_group_id, nature, is_system, sort_order)
    VALUES
        (p_business_id, '3001', 'Capital',           'capital', v_capital_group_id, 'credit', true, 1),
        (p_business_id, '3002', 'Retained Earnings', 'capital', v_capital_group_id, 'credit', true, 2)
    ON CONFLICT (business_id, account_code) DO NOTHING;

    -- =========================================================================
    -- Income (4101-4204)
    -- =========================================================================
    INSERT INTO accounts (business_id, account_code, account_name, account_type, account_group_id, nature, is_system, sort_order)
    VALUES
        (p_business_id, '4101', 'Sales',                'income', v_sales_id,          'credit', true, 1),
        (p_business_id, '4102', 'Discount Received',    'income', v_income_group_id,   'credit', true, 2),
        (p_business_id, '4201', 'Other Income',         'income', v_income_group_id,   'credit', true, 4),
        (p_business_id, '4202', 'Interest Income',      'income', v_income_group_id,   'credit', true, 5),
        (p_business_id, '4203', 'Dividend Income',      'income', v_income_group_id,   'credit', true, 6),
        (p_business_id, '4204', 'Foreign Exchange Gain','income', v_income_group_id,   'credit', true, 7)
    ON CONFLICT (business_id, account_code) DO NOTHING;

    -- =========================================================================
    -- Inter-Branch (6000 elimination group). Defensive fork for schemas that
    -- don't yet have migration 126's is_elimination_account column.
    -- =========================================================================
    IF v_elimination_group_id IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'accounts' AND column_name = 'is_elimination_account'
        ) THEN
            INSERT INTO accounts (business_id, account_code, account_name, account_type, account_group_id, nature, is_system, sort_order, is_elimination_account)
            VALUES
                (p_business_id, '1109', 'Inter-Branch Receivables', 'asset',     v_elimination_group_id, 'debit',  true, 1, true),
                (p_business_id, '2111', 'Inter-Branch Payables',    'liability', v_elimination_group_id, 'credit', true, 2, true),
                (p_business_id, '4103', 'Inter-Branch Sales',       'income',    v_elimination_group_id, 'credit', true, 3, true),
                (p_business_id, '5103', 'Inter-Branch Purchases',   'expense',   v_elimination_group_id, 'debit',  true, 4, true)
            ON CONFLICT (business_id, account_code) DO NOTHING;
        ELSE
            INSERT INTO accounts (business_id, account_code, account_name, account_type, account_group_id, nature, is_system, sort_order)
            VALUES
                (p_business_id, '1109', 'Inter-Branch Receivables', 'asset',     v_elimination_group_id, 'debit',  true, 1),
                (p_business_id, '2111', 'Inter-Branch Payables',    'liability', v_elimination_group_id, 'credit', true, 2),
                (p_business_id, '4103', 'Inter-Branch Sales',       'income',    v_elimination_group_id, 'credit', true, 3),
                (p_business_id, '5103', 'Inter-Branch Purchases',   'expense',   v_elimination_group_id, 'debit',  true, 4)
            ON CONFLICT (business_id, account_code) DO NOTHING;
        END IF;
    END IF;

    -- =========================================================================
    -- Expenses (5101-5211)
    -- =========================================================================
    INSERT INTO accounts (business_id, account_code, account_name, account_type, account_group_id, nature, is_system, sort_order)
    VALUES
        (p_business_id, '5101', 'Purchases',                      'expense', v_purchases_id,      'debit',  true, 1),
        (p_business_id, '5102', 'Purchase Returns',               'expense', v_purchases_id,      'credit', true, 2),
        (p_business_id, '5104', 'Cost of Goods Sold',             'expense', v_purchases_id,      'debit',  true, 4),
        (p_business_id, '5201', 'Administrative Expenses',        'expense', v_expenses_group_id, 'debit',  true, 1),
        (p_business_id, '5202', 'Selling Expenses',               'expense', v_expenses_group_id, 'debit',  true, 2),
        (p_business_id, '5203', 'Financial Expenses',             'expense', v_expenses_group_id, 'debit',  true, 3),
        (p_business_id, '5204', 'Depreciation',                   'expense', v_expenses_group_id, 'debit',  true, 4),
        (p_business_id, '5205', 'Interest Expense',               'expense', v_expenses_group_id, 'debit',  true, 5),
        (p_business_id, '5206', 'Foreign Exchange Loss',          'expense', v_expenses_group_id, 'debit',  true, 6),
        (p_business_id, '5207', 'Provision for Bad Debts',        'expense', v_expenses_group_id, 'debit',  true, 7),
        (p_business_id, '5208', 'Provision for Warranty',         'expense', v_expenses_group_id, 'debit',  true, 8),
        (p_business_id, '5209', 'Provision for Employee Benefits','expense', v_expenses_group_id, 'debit',  true, 9),
        (p_business_id, '5210', 'Current Tax Expense',            'expense', v_expenses_group_id, 'debit',  true, 10),
        (p_business_id, '5211', 'Deferred Tax Expense',           'expense', v_expenses_group_id, 'debit',  true, 11)
    ON CONFLICT (business_id, account_code) DO NOTHING;

    -- =========================================================================
    -- Phase-3: GST split accounts (2150-2155 + 1110-1115) and deactivate 2103.
    -- Called AFTER the base 1100/2100 groups exist above. Safe if the function
    -- is not yet defined (older schemas) — wrap in a defensive check.
    -- =========================================================================
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE p.proname = 'ensure_phase3_gst_accounts'
          AND n.nspname = 'public'
    ) THEN
        PERFORM ensure_phase3_gst_accounts(p_business_id);
    ELSE
        RAISE NOTICE 'Phase-3 GST seed skipped: ensure_phase3_gst_accounts() not found. Run migration 166 first.';
    END IF;

    -- =========================================================================
    -- Phase-4: Ensure business_settings row exists with periodic inventory
    -- defaults (migration 167 added the columns with defaults, but no row
    -- meant no settings).
    -- =========================================================================
    INSERT INTO business_settings (business_id)
    VALUES (p_business_id)
    ON CONFLICT (business_id) DO NOTHING;

END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_default_chart_of_accounts(UUID) IS
'Creates default chart of accounts for a new business. As of migration 168 this also seeds Phase-3 GST split accounts (via ensure_phase3_gst_accounts) and bootstraps the business_settings row with Phase-4 periodic-inventory defaults. Idempotent — safe to call multiple times on the same business.';

-- ----------------------------------------------------------------------------
-- 2. Verification view — quickly see which businesses have a complete seed.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_business_coa_readiness AS
SELECT
    b.id AS business_id,
    b.name AS business_name,
    b.gst_registration_type,
    -- Core accounts
    EXISTS (SELECT 1 FROM accounts a WHERE a.business_id = b.id AND a.account_code = '1101' AND a.is_active)  AS has_cash,
    EXISTS (SELECT 1 FROM accounts a WHERE a.business_id = b.id AND a.account_code = '1103' AND a.is_active)  AS has_ar,
    EXISTS (SELECT 1 FROM accounts a WHERE a.business_id = b.id AND a.account_code = '2101' AND a.is_active)  AS has_ap,
    EXISTS (SELECT 1 FROM accounts a WHERE a.business_id = b.id AND a.account_code = '4101' AND a.is_active)  AS has_sales,
    EXISTS (SELECT 1 FROM accounts a WHERE a.business_id = b.id AND a.account_code = '5101' AND a.is_active)  AS has_purchases,
    EXISTS (SELECT 1 FROM accounts a WHERE a.business_id = b.id AND a.account_code = '5104' AND a.is_active)  AS has_cogs,
    -- Phase-3 GST output
    EXISTS (SELECT 1 FROM accounts a WHERE a.business_id = b.id AND a.account_code = '2150' AND a.is_active)  AS has_output_cgst,
    EXISTS (SELECT 1 FROM accounts a WHERE a.business_id = b.id AND a.account_code = '2151' AND a.is_active)  AS has_output_sgst,
    EXISTS (SELECT 1 FROM accounts a WHERE a.business_id = b.id AND a.account_code = '2152' AND a.is_active)  AS has_output_igst,
    EXISTS (SELECT 1 FROM accounts a WHERE a.business_id = b.id AND a.account_code = '2155' AND a.is_active)  AS has_rcm_output,
    -- Phase-3 GST input (ITC)
    EXISTS (SELECT 1 FROM accounts a WHERE a.business_id = b.id AND a.account_code = '1110' AND a.is_active)  AS has_input_cgst,
    EXISTS (SELECT 1 FROM accounts a WHERE a.business_id = b.id AND a.account_code = '1111' AND a.is_active)  AS has_input_sgst,
    EXISTS (SELECT 1 FROM accounts a WHERE a.business_id = b.id AND a.account_code = '1112' AND a.is_active)  AS has_input_igst,
    EXISTS (SELECT 1 FROM accounts a WHERE a.business_id = b.id AND a.account_code = '1115' AND a.is_active)  AS has_rcm_input,
    -- Legacy 2103 should be INACTIVE for Phase-3-ready businesses
    EXISTS (SELECT 1 FROM accounts a WHERE a.business_id = b.id AND a.account_code = '2103' AND a.is_active = false) AS legacy_2103_deactivated,
    -- Phase-4 settings row
    EXISTS (SELECT 1 FROM business_settings bs WHERE bs.business_id = b.id) AS has_settings_row
FROM businesses b;

COMMENT ON VIEW v_business_coa_readiness IS
'Phase-3/4 readiness flag per business. Every column should be TRUE for a business created via migration 168 or later. Run SELECT * FROM v_business_coa_readiness; after creating a new business to verify.';
