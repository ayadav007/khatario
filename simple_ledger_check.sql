-- =====================================================
-- SIMPLE LEDGER VERIFICATION - ONE QUERY
-- Business ID: bdc92fad-c81b-480d-9dbf-dea019ebcee8
-- =====================================================

SELECT 
  'Transaction Coverage' as check_type,
  'Invoices' as item,
  (SELECT COUNT(*) FROM invoices WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' AND status = 'final') as total,
  (SELECT COUNT(DISTINCT voucher_id) FROM ledger_entry_lines WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' AND voucher_type = 'invoice') as with_ledger,
  CASE 
    WHEN (SELECT COUNT(*) FROM invoices WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' AND status = 'final') = 
         (SELECT COUNT(DISTINCT voucher_id) FROM ledger_entry_lines WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' AND voucher_type = 'invoice')
    THEN '✅ OK' ELSE '❌ MISSING' 
  END as status

UNION ALL

SELECT 
  'Transaction Coverage',
  'Purchases',
  (SELECT COUNT(*) FROM purchases WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' AND status = 'final'),
  (SELECT COUNT(DISTINCT voucher_id) FROM ledger_entry_lines WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' AND voucher_type = 'purchase'),
  CASE 
    WHEN (SELECT COUNT(*) FROM purchases WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' AND status = 'final') = 
         (SELECT COUNT(DISTINCT voucher_id) FROM ledger_entry_lines WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' AND voucher_type = 'purchase')
    THEN '✅ OK' ELSE '❌ MISSING' 
  END

UNION ALL

SELECT 
  'Transaction Coverage',
  'Expenses',
  (SELECT COUNT(*) FROM expenses WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8'),
  (SELECT COUNT(DISTINCT voucher_id) FROM ledger_entry_lines WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' AND voucher_type = 'expense'),
  CASE 
    WHEN (SELECT COUNT(*) FROM expenses WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8') = 
         (SELECT COUNT(DISTINCT voucher_id) FROM ledger_entry_lines WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' AND voucher_type = 'expense')
    THEN '✅ OK' ELSE '❌ MISSING' 
  END

UNION ALL

SELECT 
  'Transaction Coverage',
  'Payments',
  (SELECT COUNT(*) FROM payments WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8'),
  (SELECT COUNT(DISTINCT voucher_id) FROM ledger_entry_lines WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' AND voucher_type = 'payment'),
  CASE 
    WHEN (SELECT COUNT(*) FROM payments WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8') = 
         (SELECT COUNT(DISTINCT voucher_id) FROM ledger_entry_lines WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' AND voucher_type = 'payment')
    THEN '✅ OK' ELSE '❌ MISSING' 
  END

UNION ALL

SELECT 
  'Transaction Coverage',
  'Credit Notes',
  (SELECT COUNT(*) FROM credit_notes WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8'),
  (SELECT COUNT(DISTINCT voucher_id) FROM ledger_entry_lines WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' AND voucher_type = 'credit_note'),
  CASE 
    WHEN (SELECT COUNT(*) FROM credit_notes WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8') = 
         (SELECT COUNT(DISTINCT voucher_id) FROM ledger_entry_lines WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' AND voucher_type = 'credit_note')
    THEN '✅ OK' ELSE '❌ MISSING' 
  END

UNION ALL

SELECT 
  'Transaction Coverage',
  'Purchase Returns',
  (SELECT COUNT(*) FROM purchase_returns WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8'),
  (SELECT COUNT(DISTINCT voucher_id) FROM ledger_entry_lines WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' AND voucher_type = 'purchase_return'),
  CASE 
    WHEN (SELECT COUNT(*) FROM purchase_returns WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8') = 
         (SELECT COUNT(DISTINCT voucher_id) FROM ledger_entry_lines WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8' AND voucher_type = 'purchase_return')
    THEN '✅ OK' ELSE '❌ MISSING' 
  END

UNION ALL

SELECT 
  'Double-Entry Balance',
  'Overall Ledger',
  ROUND((SELECT SUM(debit) FROM ledger_entry_lines WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8'), 2),
  ROUND((SELECT SUM(credit) FROM ledger_entry_lines WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8'), 2),
  CASE 
    WHEN ABS((SELECT SUM(debit) - SUM(credit) FROM ledger_entry_lines WHERE business_id = 'bdc92fad-c81b-480d-9dbf-dea019ebcee8')) < 0.01
    THEN '✅ BALANCED' ELSE '❌ NOT BALANCED' 
  END

ORDER BY check_type, item;

