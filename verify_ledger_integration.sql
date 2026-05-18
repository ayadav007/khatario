-- =====================================================
-- COMPREHENSIVE LEDGER INTEGRATION VERIFICATION
-- Business ID: bdc92fad-c81b-480d-9dbf-dea019ebcee8
-- =====================================================

-- All queries use the business_id: bdc92fad-c81b-480d-9dbf-dea019ebcee8
-- (Previously used psql variable syntax :'business_id', now replaced with direct UUID value)

-- =====================================================
-- 1. CHECK IF ALL TRANSACTIONS HAVE LEDGER ENTRIES
-- =====================================================
SELECT 
  '=== TRANSACTION LEDGER ENTRY COVERAGE ===' as section;

SELECT 
  'Invoices' as transaction_type,
  COUNT(*) as total_transactions,
  COUNT(DISTINCT lel.voucher_id) as transactions_with_ledger,
  COUNT(*) - COUNT(DISTINCT lel.voucher_id) as missing_ledger_entries,
  CASE 
    WHEN COUNT(*) = COUNT(DISTINCT lel.voucher_id) THEN '✅ ALL HAVE LEDGER ENTRIES'
    ELSE '❌ SOME MISSING LEDGER ENTRIES'
  END as status
FROM invoices i
LEFT JOIN ledger_entry_lines lel ON i.id = lel.voucher_id AND lel.voucher_type = 'invoice'
WHERE i.business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' AND i.status = 'final'

UNION ALL

SELECT 
  'Purchases' as transaction_type,
  COUNT(*) as total_transactions,
  COUNT(DISTINCT lel.voucher_id) as transactions_with_ledger,
  COUNT(*) - COUNT(DISTINCT lel.voucher_id) as missing_ledger_entries,
  CASE 
    WHEN COUNT(*) = COUNT(DISTINCT lel.voucher_id) THEN '✅ ALL HAVE LEDGER ENTRIES'
    ELSE '❌ SOME MISSING LEDGER ENTRIES'
  END as status
FROM purchases p
LEFT JOIN ledger_entry_lines lel ON p.id = lel.voucher_id AND lel.voucher_type = 'purchase'
WHERE p.business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' AND p.status = 'final'

UNION ALL

SELECT 
  'Expenses' as transaction_type,
  COUNT(*) as total_transactions,
  COUNT(DISTINCT lel.voucher_id) as transactions_with_ledger,
  COUNT(*) - COUNT(DISTINCT lel.voucher_id) as missing_ledger_entries,
  CASE 
    WHEN COUNT(*) = COUNT(DISTINCT lel.voucher_id) THEN '✅ ALL HAVE LEDGER ENTRIES'
    ELSE '❌ SOME MISSING LEDGER ENTRIES'
  END as status
FROM expenses e
LEFT JOIN ledger_entry_lines lel ON e.id = lel.voucher_id AND lel.voucher_type = 'expense'
WHERE e.business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8'

UNION ALL

SELECT 
  'Payments' as transaction_type,
  COUNT(*) as total_transactions,
  COUNT(DISTINCT lel.voucher_id) as transactions_with_ledger,
  COUNT(*) - COUNT(DISTINCT lel.voucher_id) as missing_ledger_entries,
  CASE 
    WHEN COUNT(*) = COUNT(DISTINCT lel.voucher_id) THEN '✅ ALL HAVE LEDGER ENTRIES'
    ELSE '❌ SOME MISSING LEDGER ENTRIES'
  END as status
FROM payments pay
LEFT JOIN ledger_entry_lines lel ON pay.id = lel.voucher_id AND lel.voucher_type = 'payment'
WHERE pay.business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8'

UNION ALL

SELECT 
  'Credit Notes' as transaction_type,
  COUNT(*) as total_transactions,
  COUNT(DISTINCT lel.voucher_id) as transactions_with_ledger,
  COUNT(*) - COUNT(DISTINCT lel.voucher_id) as missing_ledger_entries,
  CASE 
    WHEN COUNT(*) = COUNT(DISTINCT lel.voucher_id) THEN '✅ ALL HAVE LEDGER ENTRIES'
    ELSE '❌ SOME MISSING LEDGER ENTRIES'
  END as status
FROM credit_notes cn
LEFT JOIN ledger_entry_lines lel ON cn.id = lel.voucher_id AND lel.voucher_type = 'credit_note'
WHERE cn.business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8'

UNION ALL

SELECT 
  'Purchase Returns' as transaction_type,
  COUNT(*) as total_transactions,
  COUNT(DISTINCT lel.voucher_id) as transactions_with_ledger,
  COUNT(*) - COUNT(DISTINCT lel.voucher_id) as missing_ledger_entries,
  CASE 
    WHEN COUNT(*) = COUNT(DISTINCT lel.voucher_id) THEN '✅ ALL HAVE LEDGER ENTRIES'
    ELSE '❌ SOME MISSING LEDGER ENTRIES'
  END as status
FROM purchase_returns pr
LEFT JOIN ledger_entry_lines lel ON pr.id = lel.voucher_id AND lel.voucher_type = 'purchase_return'
WHERE pr.business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8';

-- =====================================================
-- 2. DOUBLE-ENTRY BALANCE VERIFICATION
-- =====================================================
SELECT 
  '=== DOUBLE-ENTRY BALANCE CHECK ===' as section;

SELECT 
  voucher_type,
  COUNT(DISTINCT voucher_id) as total_vouchers,
  SUM(debit) as total_debit,
  SUM(credit) as total_credit,
  SUM(debit) - SUM(credit) as difference,
  CASE 
    WHEN ABS(SUM(debit) - SUM(credit)) < 0.01 THEN '✅ BALANCED'
    ELSE '❌ NOT BALANCED'
  END as status
FROM ledger_entry_lines
WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8'
GROUP BY voucher_type
ORDER BY voucher_type;

-- Overall balance check
SELECT 
  '=== OVERALL LEDGER BALANCE ===' as section,
  SUM(debit) as total_debit,
  SUM(credit) as total_credit,
  SUM(debit) - SUM(credit) as difference,
  CASE 
    WHEN ABS(SUM(debit) - SUM(credit)) < 0.01 THEN '✅ PERFECTLY BALANCED'
    ELSE '❌ NOT BALANCED - CHECK ABOVE'
  END as status
FROM ledger_entry_lines
WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8';

-- =====================================================
-- 3. TRIAL BALANCE VERIFICATION
-- =====================================================
SELECT 
  '=== TRIAL BALANCE SUMMARY ===' as section;

SELECT 
  SUM(
    CASE 
      WHEN a.nature = 'debit' AND balance >= 0 THEN balance
      WHEN a.nature = 'credit' AND balance < 0 THEN ABS(balance)
      ELSE 0
    END
  ) as total_debit,
  SUM(
    CASE 
      WHEN a.nature = 'credit' AND balance >= 0 THEN balance
      WHEN a.nature = 'debit' AND balance < 0 THEN ABS(balance)
      ELSE 0
    END
  ) as total_credit,
  SUM(
    CASE 
      WHEN a.nature = 'debit' AND balance >= 0 THEN balance
      WHEN a.nature = 'credit' AND balance < 0 THEN ABS(balance)
      ELSE 0
    END
  ) - SUM(
    CASE 
      WHEN a.nature = 'credit' AND balance >= 0 THEN balance
      WHEN a.nature = 'debit' AND balance < 0 THEN ABS(balance)
      ELSE 0
    END
  ) as difference,
  CASE 
    WHEN ABS(
      SUM(
        CASE 
          WHEN a.nature = 'debit' AND balance >= 0 THEN balance
          WHEN a.nature = 'credit' AND balance < 0 THEN ABS(balance)
          ELSE 0
        END
      ) - SUM(
        CASE 
          WHEN a.nature = 'credit' AND balance >= 0 THEN balance
          WHEN a.nature = 'debit' AND balance < 0 THEN ABS(balance)
          ELSE 0
        END
      )
    ) < 0.01 THEN '✅ TRIAL BALANCE BALANCED'
    ELSE '❌ TRIAL BALANCE NOT BALANCED'
  END as status
FROM accounts a
LEFT JOIN LATERAL (
  SELECT get_account_balance(a.id, 'bdc92fad-c81b-480d-9dbf-dea019ebcee8', CURRENT_DATE) as balance
) balance_calc ON true
WHERE a.business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' AND a.is_active = true;

-- =====================================================
-- 4. CUSTOMER BALANCE RECONCILIATION
-- =====================================================
SELECT 
  '=== CUSTOMER BALANCE RECONCILIATION ===' as section;

SELECT 
  c.id,
  c.name as customer_name,
  c.current_balance as customer_table_balance,
  COALESCE(inv_balance.total_receivable, 0) as invoice_balance_total,
  COALESCE(cn_balance.total_credit_notes, 0) as credit_note_total,
  COALESCE(pay_balance.total_payments, 0) as payment_total,
  (COALESCE(inv_balance.total_receivable, 0) - COALESCE(cn_balance.total_credit_notes, 0) - COALESCE(pay_balance.total_payments, 0)) as calculated_balance,
  c.current_balance - (COALESCE(inv_balance.total_receivable, 0) - COALESCE(cn_balance.total_credit_notes, 0) - COALESCE(pay_balance.total_payments, 0)) as difference,
  CASE 
    WHEN ABS(c.current_balance - (COALESCE(inv_balance.total_receivable, 0) - COALESCE(cn_balance.total_credit_notes, 0) - COALESCE(pay_balance.total_payments, 0))) < 0.01 THEN '✅ MATCHES'
    ELSE '❌ MISMATCH'
  END as status
FROM customers c
LEFT JOIN (
  SELECT customer_id, SUM(balance_amount) as total_receivable
  FROM invoices
  WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' AND status = 'final' AND customer_id IS NOT NULL
  GROUP BY customer_id
) inv_balance ON c.id = inv_balance.customer_id
LEFT JOIN (
  SELECT customer_id, SUM(grand_total) as total_credit_notes
  FROM credit_notes
  WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8'
  GROUP BY customer_id
) cn_balance ON c.id = cn_balance.customer_id
LEFT JOIN (
  SELECT customer_id, SUM(amount) as total_payments
  FROM payments
  WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' AND type = 'receivable' AND customer_id IS NOT NULL
  GROUP BY customer_id
) pay_balance ON c.id = pay_balance.customer_id
WHERE c.business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8'
ORDER BY ABS(c.current_balance - (COALESCE(inv_balance.total_receivable, 0) - COALESCE(cn_balance.total_credit_notes, 0) - COALESCE(pay_balance.total_payments, 0))) DESC;

-- =====================================================
-- 5. SUPPLIER BALANCE RECONCILIATION
-- =====================================================
SELECT 
  '=== SUPPLIER BALANCE RECONCILIATION ===' as section;

SELECT 
  s.id,
  s.name as supplier_name,
  s.current_balance as supplier_table_balance,
  COALESCE(pur_balance.total_payable, 0) as purchase_balance_total,
  COALESCE(pr_balance.total_returns, 0) as purchase_return_total,
  COALESCE(pay_balance.total_payments, 0) as payment_total,
  (COALESCE(pur_balance.total_payable, 0) - COALESCE(pr_balance.total_returns, 0) - COALESCE(pay_balance.total_payments, 0)) as calculated_balance,
  s.current_balance - (COALESCE(pur_balance.total_payable, 0) - COALESCE(pr_balance.total_returns, 0) - COALESCE(pay_balance.total_payments, 0)) as difference,
  CASE 
    WHEN ABS(s.current_balance - (COALESCE(pur_balance.total_payable, 0) - COALESCE(pr_balance.total_returns, 0) - COALESCE(pay_balance.total_payments, 0))) < 0.01 THEN '✅ MATCHES'
    ELSE '❌ MISMATCH'
  END as status
FROM suppliers s
LEFT JOIN (
  SELECT supplier_id, SUM(balance_amount) as total_payable
  FROM purchases
  WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' AND status = 'final' AND supplier_id IS NOT NULL
  GROUP BY supplier_id
) pur_balance ON s.id = pur_balance.supplier_id
LEFT JOIN (
  SELECT supplier_id, SUM(grand_total) as total_returns
  FROM purchase_returns
  WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8'
  GROUP BY supplier_id
) pr_balance ON s.id = pr_balance.supplier_id
LEFT JOIN (
  SELECT supplier_id, SUM(amount) as total_payments
  FROM payments
  WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' AND type = 'payable' AND supplier_id IS NOT NULL
  GROUP BY supplier_id
) pay_balance ON s.id = pay_balance.supplier_id
WHERE s.business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8'
ORDER BY ABS(s.current_balance - (COALESCE(pur_balance.total_payable, 0) - COALESCE(pr_balance.total_returns, 0) - COALESCE(pay_balance.total_payments, 0))) DESC;

-- =====================================================
-- 6. ACCOUNT BALANCE SUMMARY
-- =====================================================
SELECT 
  '=== ACCOUNT BALANCE SUMMARY ===' as section;

SELECT 
  a.account_code,
  a.account_name,
  a.account_type,
  a.nature,
  a.opening_balance,
  a.opening_balance_type,
  COALESCE(SUM(lel.debit), 0) as total_debit,
  COALESCE(SUM(lel.credit), 0) as total_credit,
  get_account_balance(a.id, 'bdc92fad-c81b-480d-9dbf-dea019ebcee8', CURRENT_DATE) as current_balance
FROM accounts a
LEFT JOIN ledger_entry_lines lel ON a.id = lel.account_id AND lel.business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8'
WHERE a.business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' AND a.is_active = true
GROUP BY a.id, a.account_code, a.account_name, a.account_type, a.nature, a.opening_balance, a.opening_balance_type
ORDER BY a.account_code;

-- =====================================================
-- 7. RECENT TRANSACTIONS WITHOUT LEDGER ENTRIES (IF ANY)
-- =====================================================
SELECT 
  '=== RECENT TRANSACTIONS WITHOUT LEDGER ENTRIES ===' as section;

-- Invoices without ledger entries
SELECT 
  'Invoice' as transaction_type,
  i.id::text as id,
  i.invoice_number as reference,
  i.invoice_date as transaction_date,
  i.grand_total as amount,
  i.status
FROM invoices i
LEFT JOIN ledger_entry_lines lel ON i.id = lel.voucher_id AND lel.voucher_type = 'invoice'
WHERE i.business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' 
  AND i.status = 'final'
  AND lel.id IS NULL

UNION ALL

-- Purchases without ledger entries
SELECT 
  'Purchase' as transaction_type,
  p.id::text as id,
  p.bill_number as reference,
  p.bill_date as transaction_date,
  p.grand_total as amount,
  p.status
FROM purchases p
LEFT JOIN ledger_entry_lines lel ON p.id = lel.voucher_id AND lel.voucher_type = 'purchase'
WHERE p.business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' 
  AND p.status = 'final'
  AND lel.id IS NULL

UNION ALL

-- Expenses without ledger entries
SELECT 
  'Expense' as transaction_type,
  e.id::text as id,
  e.description as reference,
  e.expense_date as transaction_date,
  e.amount,
  'final' as status
FROM expenses e
LEFT JOIN ledger_entry_lines lel ON e.id = lel.voucher_id AND lel.voucher_type = 'expense'
WHERE e.business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' 
  AND lel.id IS NULL

UNION ALL

-- Payments without ledger entries
SELECT 
  'Payment' as transaction_type,
  pay.id::text as id,
  pay.payment_mode || ' - ' || COALESCE(pay.notes, '') as reference,
  pay.payment_date as transaction_date,
  pay.amount,
  pay.type as status
FROM payments pay
LEFT JOIN ledger_entry_lines lel ON pay.id = lel.voucher_id AND lel.voucher_type = 'payment'
WHERE pay.business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' 
  AND lel.id IS NULL

UNION ALL

-- Credit Notes without ledger entries
SELECT 
  'Credit Note' as transaction_type,
  cn.id::text as id,
  cn.credit_note_number as reference,
  cn.credit_note_date as transaction_date,
  cn.grand_total as amount,
  'final' as status
FROM credit_notes cn
LEFT JOIN ledger_entry_lines lel ON cn.id = lel.voucher_id AND lel.voucher_type = 'credit_note'
WHERE cn.business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' 
  AND lel.id IS NULL

UNION ALL

-- Purchase Returns without ledger entries
SELECT 
  'Purchase Return' as transaction_type,
  pr.id::text as id,
  pr.return_number as reference,
  pr.return_date as transaction_date,
  pr.grand_total as amount,
  'final' as status
FROM purchase_returns pr
LEFT JOIN ledger_entry_lines lel ON pr.id = lel.voucher_id AND lel.voucher_type = 'purchase_return'
WHERE pr.business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' 
  AND lel.id IS NULL
ORDER BY transaction_date DESC
LIMIT 10;

-- =====================================================
-- END OF VERIFICATION
-- =====================================================

