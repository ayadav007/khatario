/**
 * Script to apply PBAC pattern to all remaining report routes
 * This is a helper script - routes are being updated manually for precision
 */

// List of all routes that need PBAC pattern applied
const routesToUpdate = [
  // Purchase routes (5 remaining)
  'app/api/reports/purchase/invoice-wise/route.ts',
  'app/api/reports/purchase/supplier-wise/route.ts',
  'app/api/reports/purchase/tax-wise/route.ts',
  'app/api/reports/purchase/credit/route.ts',
  'app/api/reports/purchase/returns/route.ts',
  'app/api/reports/purchase-summary/route.ts',
  
  // Party routes (5 remaining - receivables already done)
  'app/api/reports/party/payables/route.ts',
  'app/api/reports/party/ledger/route.ts',
  'app/api/reports/party/ageing/route.ts',
  'app/api/reports/party/statement/route.ts',
  'app/api/reports/party/advances/route.ts',
  
  // Expense routes (6)
  'app/api/reports/expense/summary/route.ts',
  'app/api/reports/expense/category-wise/route.ts',
  'app/api/reports/expense/cost-center/route.ts',
  'app/api/reports/expense/expense-vs-sales/route.ts',
  'app/api/reports/expense/monthly-profit/route.ts',
  'app/api/reports/expense/profit-loss/route.ts',
  
  // Stock routes (8 remaining - summary, movement, valuation already done)
  'app/api/reports/stock/low-stock/route.ts',
  'app/api/reports/stock/low-stock-warehouse/route.ts',
  'app/api/reports/stock/expired/route.ts',
  'app/api/reports/stock/damaged/route.ts',
  'app/api/reports/stock/purchase-vs-sales/route.ts',
  'app/api/reports/stock/profit-margin/route.ts',
  'app/api/reports/stock/closing-stock/route.ts',
  'app/api/reports/stock/closing-stock/finalize/route.ts',
  'app/api/reports/stock-summary/route.ts',
  
  // GST routes (3 remaining - gstr1, gstr2b, gstr3b, gstr1/excel already done)
  'app/api/reports/gst/gstr9/route.ts',
  'app/api/reports/gst/gstr1/filings/route.ts',
  'app/api/reports/gst/gstr1/[filingId]/mark-filed/route.ts',
  
  // Aging routes (2)
  'app/api/reports/aging/receivables/route.ts',
  'app/api/reports/aging/payables/route.ts',
  
  // Financial export routes (3)
  'app/api/reports/balance-sheet/pdf/route.ts',
  'app/api/reports/cash-flow/pdf/route.ts',
  'app/api/reports/trial-balance/pdf/route.ts',
  
  // Other (2)
  'app/api/reports/inter-branch-reconciliation/route.ts',
];

console.log(`Total routes to update: ${routesToUpdate.length}`);
console.log('Routes:', routesToUpdate.join('\n'));
