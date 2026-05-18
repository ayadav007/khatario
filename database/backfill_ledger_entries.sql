-- =====================================================
-- BACKFILL LEDGER ENTRIES FOR EXISTING TRANSACTIONS
-- Business ID: bdc92fad-c81b-480d-9dbf-dea019ebcee8
-- This script creates ledger entries for transactions that were created
-- before the ledger integration was implemented
-- =====================================================

-- First, check if default accounts exist
DO $$
DECLARE
    v_business_id UUID := 'bdc92fad-c81b-480d-9dbf-dea019ebcee8';
    v_account_count INTEGER;
    v_sales_account_id UUID;
    v_receivables_account_id UUID;
    v_cash_account_id UUID;
    v_bank_account_id UUID;
    v_purchases_account_id UUID;
    v_payables_account_id UUID;
    v_inventory_account_id UUID;
    v_cogs_account_id UUID;
    v_expense_account_id UUID;
BEGIN
    -- Check if accounts exist
    SELECT COUNT(*) INTO v_account_count
    FROM accounts
    WHERE business_id = v_business_id AND is_active = true;
    
    IF v_account_count = 0 THEN
        RAISE NOTICE 'No accounts found. Creating default Chart of Accounts...';
        PERFORM create_default_chart_of_accounts(v_business_id);
        RAISE NOTICE 'Default accounts created.';
    END IF;
    
    -- Get account IDs
    SELECT id INTO v_sales_account_id FROM accounts 
    WHERE business_id = v_business_id AND (account_code = '4101' OR account_name = 'Sales') AND is_active = true LIMIT 1;
    
    SELECT id INTO v_receivables_account_id FROM accounts 
    WHERE business_id = v_business_id AND (account_code = '1103' OR account_name LIKE '%Receivable%') AND is_active = true LIMIT 1;
    
    SELECT id INTO v_cash_account_id FROM accounts 
    WHERE business_id = v_business_id AND (account_code = '1101' OR account_name = 'Cash') AND is_active = true LIMIT 1;
    
    SELECT id INTO v_bank_account_id FROM accounts 
    WHERE business_id = v_business_id AND (account_code = '1102' OR account_name LIKE '%Bank%') AND is_active = true LIMIT 1;
    
    SELECT id INTO v_purchases_account_id FROM accounts 
    WHERE business_id = v_business_id AND (account_code = '5101' OR account_name = 'Purchases') AND is_active = true LIMIT 1;
    
    SELECT id INTO v_payables_account_id FROM accounts 
    WHERE business_id = v_business_id AND (account_code = '2101' OR account_name LIKE '%Payable%') AND is_active = true LIMIT 1;
    
    SELECT id INTO v_inventory_account_id FROM accounts 
    WHERE business_id = v_business_id AND (account_code = '1104' OR account_name = 'Inventory') AND is_active = true LIMIT 1;
    
    SELECT id INTO v_cogs_account_id FROM accounts 
    WHERE business_id = v_business_id AND (account_code = '5101' OR account_name LIKE '%COGS%' OR account_name LIKE '%Cost of Goods%') AND is_active = true LIMIT 1;
    
    SELECT id INTO v_expense_account_id FROM accounts 
    WHERE business_id = v_business_id AND (account_code = '5201' OR account_name LIKE '%Administrative%Expense%') AND is_active = true LIMIT 1;
    
    -- Check if required accounts exist
    IF v_sales_account_id IS NULL THEN
        RAISE EXCEPTION 'Sales account not found. Please create accounts first.';
    END IF;
    
    RAISE NOTICE 'Accounts found. Proceeding with ledger entry backfill...';
    RAISE NOTICE 'Sales Account: %', v_sales_account_id;
    RAISE NOTICE 'Receivables Account: %', v_receivables_account_id;
    RAISE NOTICE 'Cash Account: %', v_cash_account_id;
END $$;

-- =====================================================
-- BACKFILL INVOICES
-- =====================================================
DO $$
DECLARE
    v_business_id UUID := 'bdc92fad-c81b-480d-9dbf-dea019ebcee8';
    v_invoice RECORD;
    v_sales_account_id UUID;
    v_receivables_account_id UUID;
    v_cash_account_id UUID;
    v_bank_account_id UUID;
    v_inventory_account_id UUID;
    v_cogs_account_id UUID;
    v_payment_mode TEXT;
    v_is_cash_sale BOOLEAN;
    v_cogs_amount DECIMAL(15,2);
    v_item RECORD;
    v_count INTEGER := 0;
BEGIN
    -- Get account IDs
    SELECT id INTO v_sales_account_id FROM accounts 
    WHERE business_id = v_business_id AND (account_code = '4101' OR account_name = 'Sales') AND is_active = true LIMIT 1;
    
    SELECT id INTO v_receivables_account_id FROM accounts 
    WHERE business_id = v_business_id AND (account_code = '1103' OR account_name LIKE '%Receivable%') AND is_active = true LIMIT 1;
    
    SELECT id INTO v_cash_account_id FROM accounts 
    WHERE business_id = v_business_id AND (account_code = '1101' OR account_name = 'Cash') AND is_active = true LIMIT 1;
    
    SELECT id INTO v_bank_account_id FROM accounts 
    WHERE business_id = v_business_id AND (account_code = '1102' OR account_name LIKE '%Bank%') AND is_active = true LIMIT 1;
    
    SELECT id INTO v_inventory_account_id FROM accounts 
    WHERE business_id = v_business_id AND (account_code = '1104' OR account_name = 'Inventory') AND is_active = true LIMIT 1;
    
    SELECT id INTO v_cogs_account_id FROM accounts 
    WHERE business_id = v_business_id AND (account_code = '5101' OR account_name LIKE '%COGS%' OR account_name LIKE '%Cost of Goods%') AND is_active = true LIMIT 1;
    
    -- Process each invoice that doesn't have ledger entries
    FOR v_invoice IN 
        SELECT i.*
        FROM invoices i
        WHERE i.business_id = v_business_id 
          AND i.status = 'final'
          AND NOT EXISTS (
              SELECT 1 FROM ledger_entry_lines lel 
              WHERE lel.voucher_id = i.id AND lel.voucher_type = 'invoice'
          )
        ORDER BY i.invoice_date
    LOOP
        -- Check if cash sale (no customer or fully paid)
        SELECT payment_mode INTO v_payment_mode
        FROM payments
        WHERE business_id = v_business_id 
          AND reference_type = 'invoice' 
          AND reference_id = v_invoice.id
        LIMIT 1;
        
        v_is_cash_sale := (v_invoice.customer_id IS NULL) OR 
                         (COALESCE(v_invoice.paid_amount, 0) >= v_invoice.grand_total);
        
        -- Calculate COGS
        v_cogs_amount := 0;
        FOR v_item IN 
            SELECT ii.*, it.purchase_price, it.item_type
            FROM invoice_items ii
            LEFT JOIN items it ON ii.item_id = it.id
            WHERE ii.invoice_id = v_invoice.id AND ii.item_id IS NOT NULL
        LOOP
            IF v_item.item_type = 'goods' AND v_item.purchase_price IS NOT NULL THEN
                v_cogs_amount := v_cogs_amount + (v_item.purchase_price * v_item.quantity);
            END IF;
        END LOOP;
        
        -- Create ledger entries
        -- 1. Debit Receivables/Cash, Credit Sales
        IF v_is_cash_sale OR v_invoice.customer_id IS NULL THEN
            -- Cash Sale: Debit Cash/Bank
            INSERT INTO ledger_entry_lines (
                business_id, voucher_id, voucher_type, account_id, entry_date,
                debit, credit, narration, reference_number
            )
            VALUES (
                v_business_id, v_invoice.id, 'invoice',
                COALESCE(
                    CASE WHEN v_payment_mode IN ('bank', 'bank_transfer', 'neft', 'rtgs') THEN v_bank_account_id ELSE NULL END,
                    v_cash_account_id
                ),
                v_invoice.invoice_date,
                v_invoice.grand_total, 0,
                'Cash sale - Invoice ' || v_invoice.invoice_number,
                v_invoice.invoice_number
            );
        ELSE
            -- Credit Sale: Debit Accounts Receivable
            INSERT INTO ledger_entry_lines (
                business_id, voucher_id, voucher_type, account_id, entry_date,
                debit, credit, narration, reference_number
            )
            VALUES (
                v_business_id, v_invoice.id, 'invoice',
                v_receivables_account_id,
                v_invoice.invoice_date,
                v_invoice.grand_total, 0,
                'Credit sale - Invoice ' || v_invoice.invoice_number,
                v_invoice.invoice_number
            );
        END IF;
        
        -- 2. Credit Sales Account
        INSERT INTO ledger_entry_lines (
            business_id, voucher_id, voucher_type, account_id, entry_date,
            debit, credit, narration, reference_number
        )
        VALUES (
            v_business_id, v_invoice.id, 'invoice',
            v_sales_account_id,
            v_invoice.invoice_date,
            0, v_invoice.grand_total,
            'Sales - Invoice ' || v_invoice.invoice_number,
            v_invoice.invoice_number
        );
        
        -- 3 & 4. COGS and Inventory (if applicable)
        IF v_cogs_amount > 0 AND v_cogs_account_id IS NOT NULL AND v_inventory_account_id IS NOT NULL THEN
            -- Debit COGS
            INSERT INTO ledger_entry_lines (
                business_id, voucher_id, voucher_type, account_id, entry_date,
                debit, credit, narration, reference_number
            )
            VALUES (
                v_business_id, v_invoice.id, 'invoice',
                v_cogs_account_id,
                v_invoice.invoice_date,
                v_cogs_amount, 0,
                'COGS - Invoice ' || v_invoice.invoice_number,
                v_invoice.invoice_number
            );
            
            -- Credit Inventory
            INSERT INTO ledger_entry_lines (
                business_id, voucher_id, voucher_type, account_id, entry_date,
                debit, credit, narration, reference_number
            )
            VALUES (
                v_business_id, v_invoice.id, 'invoice',
                v_inventory_account_id,
                v_invoice.invoice_date,
                0, v_cogs_amount,
                'Inventory reduction - Invoice ' || v_invoice.invoice_number,
                v_invoice.invoice_number
            );
        END IF;
        
        v_count := v_count + 1;
    END LOOP;
    
    RAISE NOTICE 'Backfilled % invoices', v_count;
END $$;

-- =====================================================
-- BACKFILL EXPENSES
-- =====================================================
DO $$
DECLARE
    v_business_id UUID := 'bdc92fad-c81b-480d-9dbf-dea019ebcee8';
    v_expense RECORD;
    v_expense_account_id UUID;
    v_cash_account_id UUID;
    v_bank_account_id UUID;
    v_count INTEGER := 0;
BEGIN
    SELECT id INTO v_expense_account_id FROM accounts 
    WHERE business_id = v_business_id AND (account_code = '5201' OR account_name LIKE '%Administrative%Expense%') AND is_active = true LIMIT 1;
    
    SELECT id INTO v_cash_account_id FROM accounts 
    WHERE business_id = v_business_id AND (account_code = '1101' OR account_name = 'Cash') AND is_active = true LIMIT 1;
    
    SELECT id INTO v_bank_account_id FROM accounts 
    WHERE business_id = v_business_id AND (account_code = '1102' OR account_name LIKE '%Bank%') AND is_active = true LIMIT 1;
    
    FOR v_expense IN 
        SELECT e.*
        FROM expenses e
        WHERE e.business_id = v_business_id
          AND NOT EXISTS (
              SELECT 1 FROM ledger_entry_lines lel 
              WHERE lel.voucher_id = e.id AND lel.voucher_type = 'expense'
          )
        ORDER BY e.expense_date
    LOOP
        -- Debit Expense Account
        INSERT INTO ledger_entry_lines (
            business_id, voucher_id, voucher_type, account_id, entry_date,
            debit, credit, narration, reference_number
        )
        VALUES (
            v_business_id, v_expense.id, 'expense',
            COALESCE(v_expense_account_id, (SELECT id FROM accounts WHERE business_id = v_business_id AND account_type = 'expense' AND is_active = true LIMIT 1)),
            v_expense.expense_date,
            v_expense.amount, 0,
            COALESCE(v_expense.description, 'Expense'),
            v_expense.reference_number
        );
        
        -- Credit Cash/Bank Account
        INSERT INTO ledger_entry_lines (
            business_id, voucher_id, voucher_type, account_id, entry_date,
            debit, credit, narration, reference_number
        )
        VALUES (
            v_business_id, v_expense.id, 'expense',
            CASE 
                WHEN v_expense.payment_mode IN ('bank', 'bank_transfer', 'neft', 'rtgs') THEN v_bank_account_id
                ELSE v_cash_account_id
            END,
            v_expense.expense_date,
            0, v_expense.amount,
            'Payment for expense',
            v_expense.reference_number
        );
        
        v_count := v_count + 1;
    END LOOP;
    
    RAISE NOTICE 'Backfilled % expenses', v_count;
END $$;

-- =====================================================
-- BACKFILL PAYMENTS
-- =====================================================
DO $$
DECLARE
    v_business_id UUID := 'bdc92fad-c81b-480d-9dbf-dea019ebcee8';
    v_payment RECORD;
    v_receivables_account_id UUID;
    v_payables_account_id UUID;
    v_cash_account_id UUID;
    v_bank_account_id UUID;
    v_count INTEGER := 0;
BEGIN
    SELECT id INTO v_receivables_account_id FROM accounts 
    WHERE business_id = v_business_id AND (account_code = '1103' OR account_name LIKE '%Receivable%') AND is_active = true LIMIT 1;
    
    SELECT id INTO v_payables_account_id FROM accounts 
    WHERE business_id = v_business_id AND (account_code = '2101' OR account_name LIKE '%Payable%') AND is_active = true LIMIT 1;
    
    SELECT id INTO v_cash_account_id FROM accounts 
    WHERE business_id = v_business_id AND (account_code = '1101' OR account_name = 'Cash') AND is_active = true LIMIT 1;
    
    SELECT id INTO v_bank_account_id FROM accounts 
    WHERE business_id = v_business_id AND (account_code = '1102' OR account_name LIKE '%Bank%') AND is_active = true LIMIT 1;
    
    FOR v_payment IN 
        SELECT p.*
        FROM payments p
        WHERE p.business_id = v_business_id
          AND NOT EXISTS (
              SELECT 1 FROM ledger_entry_lines lel 
              WHERE lel.voucher_id = p.id AND lel.voucher_type = 'payment'
          )
        ORDER BY p.payment_date
    LOOP
        IF v_payment.type = 'receivable' THEN
            -- Debit Cash/Bank
            INSERT INTO ledger_entry_lines (
                business_id, voucher_id, voucher_type, account_id, entry_date,
                debit, credit, narration, reference_number
            )
            VALUES (
                v_business_id, v_payment.id, 'payment',
                CASE 
                    WHEN v_payment.payment_mode IN ('bank', 'bank_transfer', 'neft', 'rtgs') THEN v_bank_account_id
                    ELSE v_cash_account_id
                END,
                v_payment.payment_date,
                v_payment.amount, 0,
                COALESCE(v_payment.notes, 'Payment received'),
                v_payment.reference_id::text
            );
            
            -- Credit Accounts Receivable
            IF v_receivables_account_id IS NOT NULL THEN
                INSERT INTO ledger_entry_lines (
                    business_id, voucher_id, voucher_type, account_id, entry_date,
                    debit, credit, narration, reference_number
                )
                VALUES (
                    v_business_id, v_payment.id, 'payment',
                    v_receivables_account_id,
                    v_payment.payment_date,
                    0, v_payment.amount,
                    COALESCE(v_payment.notes, 'Payment received'),
                    v_payment.reference_id::text
                );
            END IF;
        ELSIF v_payment.type = 'payable' THEN
            -- Debit Accounts Payable
            IF v_payables_account_id IS NOT NULL THEN
                INSERT INTO ledger_entry_lines (
                    business_id, voucher_id, voucher_type, account_id, entry_date,
                    debit, credit, narration, reference_number
                )
                VALUES (
                    v_business_id, v_payment.id, 'payment',
                    v_payables_account_id,
                    v_payment.payment_date,
                    v_payment.amount, 0,
                    COALESCE(v_payment.notes, 'Payment made'),
                    v_payment.reference_id::text
                );
            END IF;
            
            -- Credit Cash/Bank
            INSERT INTO ledger_entry_lines (
                business_id, voucher_id, voucher_type, account_id, entry_date,
                debit, credit, narration, reference_number
            )
            VALUES (
                v_business_id, v_payment.id, 'payment',
                CASE 
                    WHEN v_payment.payment_mode IN ('bank', 'bank_transfer', 'neft', 'rtgs') THEN v_bank_account_id
                    ELSE v_cash_account_id
                END,
                v_payment.payment_date,
                0, v_payment.amount,
                COALESCE(v_payment.notes, 'Payment made'),
                v_payment.reference_id::text
            );
        END IF;
        
        v_count := v_count + 1;
    END LOOP;
    
    RAISE NOTICE 'Backfilled % payments', v_count;
END $$;

-- =====================================================
-- SUMMARY
-- =====================================================
SELECT 
    '✅ BACKFILL COMPLETE' as status,
    (SELECT COUNT(*) FROM ledger_entry_lines WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8') as total_ledger_entries,
    (SELECT COUNT(DISTINCT voucher_id) FROM ledger_entry_lines WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' AND voucher_type = 'invoice') as invoices_with_ledger,
    (SELECT COUNT(DISTINCT voucher_id) FROM ledger_entry_lines WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' AND voucher_type = 'expense') as expenses_with_ledger,
    (SELECT COUNT(DISTINCT voucher_id) FROM ledger_entry_lines WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' AND voucher_type = 'payment') as payments_with_ledger;

