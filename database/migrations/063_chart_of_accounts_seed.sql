-- Seed script: Default Chart of Accounts for Indian Accounting
-- This creates standard account groups and accounts that every business needs

-- Function to create default chart of accounts for a business
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
    v_bank_id UUID;
    v_cash_id UUID;
BEGIN
    -- Create Account Groups
    INSERT INTO account_groups (business_id, group_code, group_name, group_type, is_system, sort_order)
    VALUES 
        (p_business_id, '1000', 'Assets', 'asset', true, 1),
        (p_business_id, '2000', 'Liabilities', 'liability', true, 2),
        (p_business_id, '3000', 'Capital', 'capital', true, 3),
        (p_business_id, '4000', 'Income', 'income', true, 4),
        (p_business_id, '5000', 'Expenses', 'expense', true, 5),
        (p_business_id, '6000', 'Inter-Branch Transactions (Elimination)', 'elimination', true, 6);

    -- Get group IDs
    SELECT id INTO v_assets_group_id FROM account_groups WHERE business_id = p_business_id AND group_code = '1000';
    SELECT id INTO v_liabilities_group_id FROM account_groups WHERE business_id = p_business_id AND group_code = '2000';
    SELECT id INTO v_capital_group_id FROM account_groups WHERE business_id = p_business_id AND group_code = '3000';
    SELECT id INTO v_income_group_id FROM account_groups WHERE business_id = p_business_id AND group_code = '4000';
    SELECT id INTO v_expenses_group_id FROM account_groups WHERE business_id = p_business_id AND group_code = '5000';
    SELECT id INTO v_elimination_group_id FROM account_groups WHERE business_id = p_business_id AND group_code = '6000';

    -- Create Sub-Groups
    INSERT INTO account_groups (business_id, group_code, group_name, group_type, parent_group_id, is_system, sort_order)
    VALUES 
        (p_business_id, '1100', 'Current Assets', 'asset', v_assets_group_id, true, 1),
        (p_business_id, '1200', 'Fixed Assets', 'asset', v_assets_group_id, true, 2),
        (p_business_id, '1300', 'Investments', 'asset', v_assets_group_id, true, 3),
        (p_business_id, '2100', 'Current Liabilities', 'liability', v_liabilities_group_id, true, 1),
        (p_business_id, '2200', 'Long-term Liabilities', 'liability', v_liabilities_group_id, true, 2),
        (p_business_id, '4100', 'Sales', 'income', v_income_group_id, true, 1),
        (p_business_id, '4200', 'Other Income', 'income', v_income_group_id, true, 2),
        (p_business_id, '5100', 'Direct Expenses', 'expense', v_expenses_group_id, true, 1),
        (p_business_id, '5200', 'Indirect Expenses', 'expense', v_expenses_group_id, true, 2);

    -- Get sub-group IDs
    SELECT id INTO v_current_assets_id FROM account_groups WHERE business_id = p_business_id AND group_code = '1100';
    SELECT id INTO v_fixed_assets_id FROM account_groups WHERE business_id = p_business_id AND group_code = '1200';
    SELECT id INTO v_current_liabilities_id FROM account_groups WHERE business_id = p_business_id AND group_code = '2100';
    SELECT id INTO v_elimination_group_id FROM account_groups WHERE business_id = p_business_id AND group_code = '6000';

    -- Create Accounts - Current Assets
    INSERT INTO accounts (business_id, account_code, account_name, account_type, account_group_id, nature, is_system, sort_order)
    VALUES 
        (p_business_id, '1101', 'Cash', 'asset', v_current_assets_id, 'debit', true, 1),
        (p_business_id, '1102', 'Bank Account', 'asset', v_current_assets_id, 'debit', true, 2),
        (p_business_id, '1103', 'Accounts Receivable', 'asset', v_current_assets_id, 'debit', true, 3),
        (p_business_id, '1104', 'Inventory', 'asset', v_current_assets_id, 'debit', true, 4),
        (p_business_id, '1105', 'Prepaid Expenses', 'asset', v_current_assets_id, 'debit', true, 5),
        (p_business_id, '1106', 'Accrued Income', 'asset', v_current_assets_id, 'debit', true, 6),
        (p_business_id, '1107', 'Advances to Suppliers', 'asset', v_current_assets_id, 'debit', true, 7),
        (p_business_id, '1108', 'Loans and Advances', 'asset', v_current_assets_id, 'debit', true, 8);

    -- Create Accounts - Fixed Assets
    INSERT INTO accounts (business_id, account_code, account_name, account_type, account_group_id, nature, is_system, sort_order)
    VALUES 
        (p_business_id, '1201', 'Fixed Assets', 'asset', v_fixed_assets_id, 'debit', true, 1),
        (p_business_id, '1202', 'Accumulated Depreciation', 'asset', v_fixed_assets_id, 'credit', true, 2);

    -- Create Accounts - Current Liabilities
    INSERT INTO accounts (business_id, account_code, account_name, account_type, account_group_id, nature, is_system, sort_order)
    VALUES 
        (p_business_id, '2101', 'Accounts Payable', 'liability', v_current_liabilities_id, 'credit', true, 1),
        (p_business_id, '2102', 'TDS Payable', 'liability', v_current_liabilities_id, 'credit', true, 2),
        (p_business_id, '2103', 'GST Payable', 'liability', v_current_liabilities_id, 'credit', true, 3),
        (p_business_id, '2104', 'Outstanding Expenses', 'liability', v_current_liabilities_id, 'credit', true, 4),
        (p_business_id, '2105', 'Accrued Expenses', 'liability', v_current_liabilities_id, 'credit', true, 5),
        (p_business_id, '2106', 'Advances from Customers', 'liability', v_current_liabilities_id, 'credit', true, 6),
        (p_business_id, '2107', 'Unearned Revenue', 'liability', v_current_liabilities_id, 'credit', true, 7),
        (p_business_id, '2108', 'Provisions', 'liability', v_current_liabilities_id, 'credit', true, 8),
        (p_business_id, '2109', 'Current Tax Payable', 'liability', v_current_liabilities_id, 'credit', true, 9),
        (p_business_id, '2110', 'Deferred Tax Liability', 'liability', v_current_liabilities_id, 'credit', true, 10);

    -- Create Accounts - Capital
    SELECT id INTO v_capital_group_id FROM account_groups WHERE business_id = p_business_id AND group_code = '3000';
    INSERT INTO accounts (business_id, account_code, account_name, account_type, account_group_id, nature, is_system, sort_order)
    VALUES 
        (p_business_id, '3001', 'Capital', 'capital', v_capital_group_id, 'credit', true, 1),
        (p_business_id, '3002', 'Retained Earnings', 'capital', v_capital_group_id, 'credit', true, 2);

    -- Create Accounts - Income
    SELECT id INTO v_sales_id FROM account_groups WHERE business_id = p_business_id AND group_code = '4100';
    INSERT INTO accounts (business_id, account_code, account_name, account_type, account_group_id, nature, is_system, sort_order)
    VALUES 
        (p_business_id, '4101', 'Sales', 'income', v_sales_id, 'credit', true, 1),
        (p_business_id, '4102', 'Discount Received', 'income', v_income_group_id, 'credit', true, 2),
        (p_business_id, '4201', 'Other Income', 'income', v_income_group_id, 'credit', true, 4),
        (p_business_id, '4202', 'Interest Income', 'income', v_income_group_id, 'credit', true, 5),
        (p_business_id, '4203', 'Dividend Income', 'income', v_income_group_id, 'credit', true, 6),
        (p_business_id, '4204', 'Foreign Exchange Gain', 'income', v_income_group_id, 'credit', true, 7);

    -- Create Inter-Branch accounts in elimination group (6000)
    IF v_elimination_group_id IS NOT NULL THEN
        -- Check if is_elimination_account column exists
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'accounts' AND column_name = 'is_elimination_account'
        ) THEN
            -- Column exists, include it in INSERT
            INSERT INTO accounts (business_id, account_code, account_name, account_type, account_group_id, nature, is_system, sort_order, is_elimination_account)
            VALUES 
                (p_business_id, '1109', 'Inter-Branch Receivables', 'asset', v_elimination_group_id, 'debit', true, 1, true),
                (p_business_id, '2111', 'Inter-Branch Payables', 'liability', v_elimination_group_id, 'credit', true, 2, true),
                (p_business_id, '4103', 'Inter-Branch Sales', 'income', v_elimination_group_id, 'credit', true, 3, true),
                (p_business_id, '5103', 'Inter-Branch Purchases', 'expense', v_elimination_group_id, 'debit', true, 4, true);
        ELSE
            -- Column doesn't exist yet, insert without it (migration 126 will add it later)
            INSERT INTO accounts (business_id, account_code, account_name, account_type, account_group_id, nature, is_system, sort_order)
            VALUES 
                (p_business_id, '1109', 'Inter-Branch Receivables', 'asset', v_elimination_group_id, 'debit', true, 1),
                (p_business_id, '2111', 'Inter-Branch Payables', 'liability', v_elimination_group_id, 'credit', true, 2),
                (p_business_id, '4103', 'Inter-Branch Sales', 'income', v_elimination_group_id, 'credit', true, 3),
                (p_business_id, '5103', 'Inter-Branch Purchases', 'expense', v_elimination_group_id, 'debit', true, 4);
        END IF;
    END IF;

    -- Create Accounts - Expenses
    SELECT id INTO v_purchases_id FROM account_groups WHERE business_id = p_business_id AND group_code = '5100';
    INSERT INTO accounts (business_id, account_code, account_name, account_type, account_group_id, nature, is_system, sort_order)
    VALUES 
        (p_business_id, '5101', 'Purchases', 'expense', v_purchases_id, 'debit', true, 1),
        (p_business_id, '5102', 'Purchase Returns', 'expense', v_purchases_id, 'credit', true, 2),
        (p_business_id, '5104', 'Cost of Goods Sold', 'expense', v_purchases_id, 'debit', true, 4),
        (p_business_id, '5201', 'Administrative Expenses', 'expense', v_expenses_group_id, 'debit', true, 1),
        (p_business_id, '5202', 'Selling Expenses', 'expense', v_expenses_group_id, 'debit', true, 2),
        (p_business_id, '5203', 'Financial Expenses', 'expense', v_expenses_group_id, 'debit', true, 3),
        (p_business_id, '5204', 'Depreciation', 'expense', v_expenses_group_id, 'debit', true, 4),
        (p_business_id, '5205', 'Interest Expense', 'expense', v_expenses_group_id, 'debit', true, 5),
        (p_business_id, '5206', 'Foreign Exchange Loss', 'expense', v_expenses_group_id, 'debit', true, 6),
        (p_business_id, '5207', 'Provision for Bad Debts', 'expense', v_expenses_group_id, 'debit', true, 7),
        (p_business_id, '5208', 'Provision for Warranty', 'expense', v_expenses_group_id, 'debit', true, 8),
        (p_business_id, '5209', 'Provision for Employee Benefits', 'expense', v_expenses_group_id, 'debit', true, 9),
        (p_business_id, '5210', 'Current Tax Expense', 'expense', v_expenses_group_id, 'debit', true, 10),
        (p_business_id, '5211', 'Deferred Tax Expense', 'expense', v_expenses_group_id, 'debit', true, 11);

END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION create_default_chart_of_accounts IS 'Creates default chart of accounts for a new business';

