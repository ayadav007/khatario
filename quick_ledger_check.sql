-- =====================================================
-- QUICK LEDGER INTEGRATION CHECK
-- Business ID: bdc92fad-c81b-480d-9dbf-dea019ebcee8
-- Run this for a quick overview
-- =====================================================

WITH business_id AS (SELECT 'bdc92fad-c81b-480d-9dbf-dea019ebcee8'::uuid as id),

-- Transaction counts
transaction_counts AS (
  SELECT 
    'Invoices' as type,
    COUNT(*) as total,
    COUNT(DISTINCT lel.voucher_id) as with_ledger
  FROM invoices i
  CROSS JOIN business_id bid
  LEFT JOIN ledger_entry_lines lel ON i.id = lel.voucher_id AND lel.voucher_type = 'invoice'
  WHERE i.business_id = bid.id AND i.status = 'final'
  
  UNION ALL
  
  SELECT 'Purchases', COUNT(*), COUNT(DISTINCT lel.voucher_id)
  FROM purchases p
  CROSS JOIN business_id bid
  LEFT JOIN ledger_entry_lines lel ON p.id = lel.voucher_id AND lel.voucher_type = 'purchase'
  WHERE p.business_id = bid.id AND p.status = 'final'
  
  UNION ALL
  
  SELECT 'Expenses', COUNT(*), COUNT(DISTINCT lel.voucher_id)
  FROM expenses e
  CROSS JOIN business_id bid
  LEFT JOIN ledger_entry_lines lel ON e.id = lel.voucher_id AND lel.voucher_type = 'expense'
  WHERE e.business_id = bid.id
  
  UNION ALL
  
  SELECT 'Payments', COUNT(*), COUNT(DISTINCT lel.voucher_id)
  FROM payments pay
  CROSS JOIN business_id bid
  LEFT JOIN ledger_entry_lines lel ON pay.id = lel.voucher_id AND lel.voucher_type = 'payment'
  WHERE pay.business_id = bid.id
  
  UNION ALL
  
  SELECT 'Credit Notes', COUNT(*), COUNT(DISTINCT lel.voucher_id)
  FROM credit_notes cn
  CROSS JOIN business_id bid
  LEFT JOIN ledger_entry_lines lel ON cn.id = lel.voucher_id AND lel.voucher_type = 'credit_note'
  WHERE cn.business_id = bid.id
  
  UNION ALL
  
  SELECT 'Purchase Returns', COUNT(*), COUNT(DISTINCT lel.voucher_id)
  FROM purchase_returns pr
  CROSS JOIN business_id bid
  LEFT JOIN ledger_entry_lines lel ON pr.id = lel.voucher_id AND lel.voucher_type = 'purchase_return'
  WHERE pr.business_id = bid.id
),

-- Balance check
balance_check AS (
  SELECT 
    SUM(debit) as total_debit,
    SUM(credit) as total_credit,
    SUM(debit) - SUM(credit) as difference
  FROM ledger_entry_lines lel
  CROSS JOIN business_id bid
  WHERE lel.business_id = bid.id
)

SELECT 
  '📊 TRANSACTION COVERAGE' as check_type,
  type as item,
  total::text as value1,
  with_ledger::text as value2,
  (total - with_ledger)::text as value3,
  CASE WHEN total = with_ledger THEN '✅ OK' ELSE '❌ MISSING' END as status
FROM transaction_counts

UNION ALL

SELECT 
  '💰 DOUBLE-ENTRY BALANCE' as check_type,
  'Overall Ledger' as item,
  ROUND(total_debit, 2)::text as value1,
  ROUND(total_credit, 2)::text as value2,
  ROUND(difference, 2)::text as value3,
  CASE WHEN ABS(difference) < 0.01 THEN '✅ BALANCED' ELSE '❌ NOT BALANCED' END as status
FROM balance_check;

