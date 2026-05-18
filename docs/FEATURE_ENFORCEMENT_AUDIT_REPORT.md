# Feature Enforcement Audit Report

**Generated:** 2026-01-07T07:05:49.817Z

**Total Issues:** 120
**High Severity:** 22
**Medium Severity:** 98
**Features Affected:** 11

## Issues by Feature

### reports_basic

#### 🔴 High Severity

| Route | Method | Issue |
|-------|--------|-------|
| /api/reports/stock/closing-stock/finalize | POST | Missing assertFeatureAccess('reports_basic') |
| /api/reports/stock/closing-stock | POST | Missing assertFeatureAccess('reports_basic') |

#### 🟡 Medium Severity

| Route | Method | Issue |
|-------|--------|-------|
| /api/bank-statements/reconciliation-report | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/expense/category-wise | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/expense/cost-center | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/expense/expense-vs-sales | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/expense/summary | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/party/advances | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/party/ageing | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/party/ledger | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/party/payables | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/party/receivables | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/party/statement | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/purchase/credit | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/purchase/invoice-wise | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/purchase/returns | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/purchase/summary | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/purchase/supplier-wise | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/purchase/tax-wise | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/purchase-summary | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/sales/b2b-b2c | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/sales/cancelled | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/sales/credit | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/sales/discount | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/sales/invoice-wise | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/sales/item-wise | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/sales/party-wise | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/sales/payment-mode | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/sales/returns | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/sales/summary | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/sales/tax-wise | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/sales-summary | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/stock/closing-stock | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/stock/damaged | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/stock/expired | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/stock/low-stock | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/stock/movement | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/stock/purchase-vs-sales | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/stock/summary | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/stock/valuation | GET | Missing assertFeatureAccess('reports_basic') |
| /api/reports/stock-summary | GET | Missing assertFeatureAccess('reports_basic') |
| /api/tds/reports/summary | GET | Missing assertFeatureAccess('reports_basic') |

### recurring_invoices

#### 🔴 High Severity

| Route | Method | Issue |
|-------|--------|-------|
| /api/cron/process-reversing-entries | POST | Missing assertFeatureAccess('recurring_invoices') |

#### 🟡 Medium Severity

| Route | Method | Issue |
|-------|--------|-------|
| /api/cron/process-reversing-entries | GET | Missing assertFeatureAccess('recurring_invoices') |

### purchase_management

#### 🔴 High Severity

| Route | Method | Issue |
|-------|--------|-------|
| /api/purchase-orders | POST | Missing assertFeatureAccess('purchase_management') |
| /api/purchase-orders/[id]/convert | POST | Missing assertFeatureAccess('purchase_management') |
| /api/purchase-returns | POST | Missing assertFeatureAccess('purchase_management') |
| /api/subscriptions/addons/[type]/purchase | POST | Missing assertFeatureAccess('purchase_management') |

#### 🟡 Medium Severity

| Route | Method | Issue |
|-------|--------|-------|
| /api/dashboard/today-purchases | GET | Missing assertFeatureAccess('purchase_management') |
| /api/purchase-orders | GET | Missing assertFeatureAccess('purchase_management') |
| /api/purchase-orders/[id] | GET | Missing assertFeatureAccess('purchase_management') |
| /api/purchase-returns | GET | Missing assertFeatureAccess('purchase_management') |
| /api/purchases/[id]/pdf | GET | Missing assertFeatureAccess('purchase_management') |
| /api/purchases/[id] | GET | Missing assertFeatureAccess('purchase_management') |
| /api/reports/purchase/credit | GET | Missing assertFeatureAccess('purchase_management') |
| /api/reports/purchase/invoice-wise | GET | Missing assertFeatureAccess('purchase_management') |
| /api/reports/purchase/returns | GET | Missing assertFeatureAccess('purchase_management') |
| /api/reports/purchase/summary | GET | Missing assertFeatureAccess('purchase_management') |
| /api/reports/purchase/supplier-wise | GET | Missing assertFeatureAccess('purchase_management') |
| /api/reports/purchase/tax-wise | GET | Missing assertFeatureAccess('purchase_management') |
| /api/reports/purchase-summary | GET | Missing assertFeatureAccess('purchase_management') |
| /api/reports/stock/purchase-vs-sales | GET | Missing assertFeatureAccess('purchase_management') |

### email_invoicing

#### 🟡 Medium Severity

| Route | Method | Issue |
|-------|--------|-------|
| /api/email/test | GET | Missing assertFeatureAccess('email_invoicing') |

### expense_tracking

#### 🔴 High Severity

| Route | Method | Issue |
|-------|--------|-------|
| /api/employees/expenses | POST | Missing assertFeatureAccess('expense_tracking') |
| /api/employees/expenses/[id]/attachments | POST | Missing assertFeatureAccess('expense_tracking') |
| /api/employees/expenses/[id] | PATCH | Missing assertFeatureAccess('expense_tracking') |
| /api/employees/expenses/[id] | DELETE | Missing assertFeatureAccess('expense_tracking') |
| /api/expense-categories | POST | Missing assertFeatureAccess('expense_tracking') |

#### 🟡 Medium Severity

| Route | Method | Issue |
|-------|--------|-------|
| /api/employees/expenses | GET | Missing assertFeatureAccess('expense_tracking') |
| /api/employees/expenses/[id]/attachments | GET | Missing assertFeatureAccess('expense_tracking') |
| /api/employees/expenses/[id]/voucher/pdf | GET | Missing assertFeatureAccess('expense_tracking') |
| /api/employees/expenses/[id]/voucher | GET | Missing assertFeatureAccess('expense_tracking') |
| /api/expense-categories | GET | Missing assertFeatureAccess('expense_tracking') |
| /api/reports/expense/category-wise | GET | Missing assertFeatureAccess('expense_tracking') |
| /api/reports/expense/cost-center | GET | Missing assertFeatureAccess('expense_tracking') |
| /api/reports/expense/expense-vs-sales | GET | Missing assertFeatureAccess('expense_tracking') |
| /api/reports/expense/monthly-profit | GET | Missing assertFeatureAccess('expense_tracking') |
| /api/reports/expense/profit-loss | GET | Missing assertFeatureAccess('expense_tracking') |
| /api/reports/expense/summary | GET | Missing assertFeatureAccess('expense_tracking') |

### estimates_quotations

#### 🔴 High Severity

| Route | Method | Issue |
|-------|--------|-------|
| /api/estimates/[id]/convert | POST | Missing assertFeatureAccess('estimates_quotations') |

### multi_branch

#### 🔴 High Severity

| Route | Method | Issue |
|-------|--------|-------|
| /api/locations/migrate-stock | POST | Missing assertFeatureAccess('multi_branch') |

### credit_notes

#### 🔴 High Severity

| Route | Method | Issue |
|-------|--------|-------|
| /api/purchase-returns | POST | Missing assertFeatureAccess('credit_notes') |

#### 🟡 Medium Severity

| Route | Method | Issue |
|-------|--------|-------|
| /api/purchase-returns | GET | Missing assertFeatureAccess('credit_notes') |
| /api/reports/purchase/credit | GET | Missing assertFeatureAccess('credit_notes') |
| /api/reports/purchase/returns | GET | Missing assertFeatureAccess('credit_notes') |
| /api/reports/sales/credit | GET | Missing assertFeatureAccess('credit_notes') |
| /api/reports/sales/returns | GET | Missing assertFeatureAccess('credit_notes') |

### reports_advanced

#### 🟡 Medium Severity

| Route | Method | Issue |
|-------|--------|-------|
| /api/reports/aging/payables | GET | Missing assertFeatureAccess('reports_advanced') |
| /api/reports/aging/receivables | GET | Missing assertFeatureAccess('reports_advanced') |
| /api/reports/balance-sheet/pdf | GET | Missing assertFeatureAccess('reports_advanced') |
| /api/reports/balance-sheet | GET | Missing assertFeatureAccess('reports_advanced') |
| /api/reports/cash-flow/pdf | GET | Missing assertFeatureAccess('reports_advanced') |
| /api/reports/cash-flow | GET | Missing assertFeatureAccess('reports_advanced') |
| /api/reports/expense/monthly-profit | GET | Missing assertFeatureAccess('reports_advanced') |
| /api/reports/expense/profit-loss | GET | Missing assertFeatureAccess('reports_advanced') |
| /api/reports/profit-loss/pdf | GET | Missing assertFeatureAccess('reports_advanced') |
| /api/reports/profit-loss | GET | Missing assertFeatureAccess('reports_advanced') |
| /api/reports/stock/profit-margin | GET | Missing assertFeatureAccess('reports_advanced') |
| /api/reports/trial-balance/pdf | GET | Missing assertFeatureAccess('reports_advanced') |
| /api/reports/trial-balance | GET | Missing assertFeatureAccess('reports_advanced') |

### reports_gst

#### 🔴 High Severity

| Route | Method | Issue |
|-------|--------|-------|
| /api/reports/gst/gstr1/[filingId]/mark-filed | POST | Missing assertFeatureAccess('reports_gst') |

#### 🟡 Medium Severity

| Route | Method | Issue |
|-------|--------|-------|
| /api/reports/gst/gstr1/export/excel | GET | Missing assertFeatureAccess('reports_gst') |
| /api/reports/gst/gstr1/filings | GET | Missing assertFeatureAccess('reports_gst') |
| /api/reports/gst/gstr1 | GET | Missing assertFeatureAccess('reports_gst') |
| /api/reports/gst/gstr2b | GET | Missing assertFeatureAccess('reports_gst') |
| /api/reports/gst/gstr3b | GET | Missing assertFeatureAccess('reports_gst') |
| /api/reports/gst/gstr9 | GET | Missing assertFeatureAccess('reports_gst') |

### supplier_management

#### 🔴 High Severity

| Route | Method | Issue |
|-------|--------|-------|
| /api/suppliers/dashboard/dismiss-alert | POST | Missing assertFeatureAccess('supplier_management') |
| /api/suppliers/thresholds | POST | Missing assertFeatureAccess('supplier_management') |
| /api/suppliers/thresholds | DELETE | Missing assertFeatureAccess('supplier_management') |
| /api/suppliers/[id]/approve | POST | Missing assertFeatureAccess('supplier_management') |
| /api/suppliers/[id] | PUT | Missing assertFeatureAccess('supplier_management') |
| /api/suppliers/[id] | DELETE | Missing assertFeatureAccess('supplier_management') |

#### 🟡 Medium Severity

| Route | Method | Issue |
|-------|--------|-------|
| /api/reports/purchase/supplier-wise | GET | Missing assertFeatureAccess('supplier_management') |
| /api/suppliers/dashboard/analytics | GET | Missing assertFeatureAccess('supplier_management') |
| /api/suppliers/dashboard | GET | Missing assertFeatureAccess('supplier_management') |
| /api/suppliers/requests | GET | Missing assertFeatureAccess('supplier_management') |
| /api/suppliers/search-business | GET | Missing assertFeatureAccess('supplier_management') |
| /api/suppliers/thresholds | GET | Missing assertFeatureAccess('supplier_management') |
| /api/suppliers/[id] | GET | Missing assertFeatureAccess('supplier_management') |

