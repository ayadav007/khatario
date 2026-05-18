# Report Verification Audit Report

**Generated:** 2026-01-19T01:44:11.423Z

---

## 📊 Executive Summary

| Metric | Count |
|--------|-------|
| Total API Routes | 62 |
| Routes with Enforcement | 62 |
| Routes without Enforcement | 0 |
| Sidebar Routes | 31 |
| Legacy Map Entries | 81 |

### Category Breakdown

| Category | Count |
|----------|-------|
| Basic Reports | 33 |
| GST Reports | 8 |
| Advanced Reports | 21 |
| Unknown/No Enforcement | 0 |

## ⚠️ Issues Found

### ⚠️ Routes Missing in Legacy Map (1)

These routes are in the API but not mapped in Sidebar.tsx legacyRouteFeatureMap:

- `/reports/gst/gstr1//mark-filed` → Should map to `reports_gst`

### ⚠️ Sidebar Routes Without API Routes (1)

These routes are in the sidebar but don't have corresponding API routes:

- `/reports/gst/gstr2b-reconciliation`

## 📋 Detailed Report List

### Basic Reports (33)

| API Route | Sidebar Route | Category | Legacy Map | Plan Access |
|----------|---------------|----------|------------|------------|
| `app\api\reports\credit-risk\route.ts` | `/reports/credit-risk` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\expense\category-wise\route.ts` | `/reports/expense/category-wise` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\expense\summary\route.ts` | `/reports/expense/summary` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\party\advances\route.ts` | `/reports/party/advances` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\party\ledger\route.ts` | `/reports/party/ledger` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\party\payables\route.ts` | `/reports/party/payables` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\party\receivables\route.ts` | `/reports/party/receivables` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\party\statement\route.ts` | `/reports/party/statement` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\purchase\credit\route.ts` | `/reports/purchase/credit` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\purchase\invoice-wise\route.ts` | `/reports/purchase/invoice-wise` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\purchase\returns\route.ts` | `/reports/purchase/returns` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\purchase\summary\route.ts` | `/reports/purchase/summary` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\purchase\supplier-wise\route.ts` | `/reports/purchase/supplier-wise` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\purchase\tax-wise\route.ts` | `/reports/purchase/tax-wise` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\purchase-summary\route.ts` | `/reports/purchase-summary` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\sales\cancelled\route.ts` | `/reports/sales/cancelled` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\sales\credit\route.ts` | `/reports/sales/credit` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\sales\discount\route.ts` | `/reports/sales/discount` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\sales\invoice-wise\route.ts` | `/reports/sales/invoice-wise` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\sales\item-wise\route.ts` | `/reports/sales/item-wise` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\sales\party-wise\route.ts` | `/reports/sales/party-wise` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\sales\payment-mode\route.ts` | `/reports/sales/payment-mode` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\sales\returns\route.ts` | `/reports/sales/returns` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\sales\summary\route.ts` | `/reports/sales/summary` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\sales\tax-wise\route.ts` | `/reports/sales/tax-wise` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\sales-summary\route.ts` | `/reports/sales-summary` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\stock\damaged\route.ts` | `/reports/stock/damaged` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\stock\expired\route.ts` | `/reports/stock/expired` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\stock\low-stock\route.ts` | `/reports/stock/low-stock` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\stock\low-stock-warehouse\route.ts` | `/reports/stock/low-stock-warehouse` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\stock\movement\route.ts` | `/reports/stock/movement` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\stock\summary\route.ts` | `/reports/stock/summary` | `basic` | ✅ | professional, business, enterprise |
| `app\api\reports\stock-summary\route.ts` | `/reports/stock-summary` | `basic` | ✅ | professional, business, enterprise |

### GST Reports (8)

| API Route | Sidebar Route | Category | Legacy Map | Plan Access |
|----------|---------------|----------|------------|------------|
| `app\api\reports\gst\gstr1\export\excel\route.ts` | `/reports/gst/gstr1/export/excel` | `gst` | ✅ | business, enterprise |
| `app\api\reports\gst\gstr1\filings\route.ts` | `/reports/gst/gstr1/filings` | `gst` | ✅ | business, enterprise |
| `app\api\reports\gst\gstr1\route.ts` | `/reports/gst/gstr1` | `gst` | ✅ | business, enterprise |
| `app\api\reports\gst\gstr1\[filingId]\mark-filed\route.ts` | `/reports/gst/gstr1//mark-filed` | `gst` | ❌ | business, enterprise |
| `app\api\reports\gst\gstr2b\route.ts` | `/reports/gst/gstr2b` | `gst` | ✅ | business, enterprise |
| `app\api\reports\gst\gstr3b\route.ts` | `/reports/gst/gstr3b` | `gst` | ✅ | business, enterprise |
| `app\api\reports\gst\gstr9\route.ts` | `/reports/gst/gstr9` | `gst` | ✅ | business, enterprise |
| `app\api\reports\sales\b2b-b2c\route.ts` | `/reports/sales/b2b-b2c` | `gst` | ✅ | business, enterprise |

### Advanced Reports (21)

| API Route | Sidebar Route | Category | Legacy Map | Plan Access |
|----------|---------------|----------|------------|------------|
| `app\api\reports\aging\payables\route.ts` | `/reports/aging/payables` | `advanced` | ✅ | business, enterprise |
| `app\api\reports\aging\receivables\route.ts` | `/reports/aging/receivables` | `advanced` | ✅ | business, enterprise |
| `app\api\reports\balance-sheet\pdf\route.ts` | `/reports/balance-sheet/pdf` | `advanced` | ✅ | business, enterprise |
| `app\api\reports\balance-sheet\route.ts` | `/reports/balance-sheet` | `advanced` | ✅ | business, enterprise |
| `app\api\reports\cash-flow\pdf\route.ts` | `/reports/cash-flow/pdf` | `advanced` | ✅ | business, enterprise |
| `app\api\reports\cash-flow\route.ts` | `/reports/cash-flow` | `advanced` | ✅ | business, enterprise |
| `app\api\reports\expense\cost-center\route.ts` | `/reports/expense/cost-center` | `advanced` | ✅ | business, enterprise |
| `app\api\reports\expense\expense-vs-sales\route.ts` | `/reports/expense/expense-vs-sales` | `advanced` | ✅ | business, enterprise |
| `app\api\reports\expense\monthly-profit\route.ts` | `/reports/expense/monthly-profit` | `advanced` | ✅ | business, enterprise |
| `app\api\reports\expense\profit-loss\route.ts` | `/reports/expense/profit-loss` | `advanced` | ✅ | business, enterprise |
| `app\api\reports\inter-branch-reconciliation\route.ts` | `/reports/inter-branch-reconciliation` | `advanced` | ✅ | business, enterprise |
| `app\api\reports\party\ageing\route.ts` | `/reports/party/ageing` | `advanced` | ✅ | business, enterprise |
| `app\api\reports\profit-loss\pdf\route.ts` | `/reports/profit-loss/pdf` | `advanced` | ✅ | business, enterprise |
| `app\api\reports\profit-loss\route.ts` | `/reports/profit-loss` | `advanced` | ✅ | business, enterprise |
| `app\api\reports\stock\closing-stock\finalize\route.ts` | `/reports/stock/closing-stock/finalize` | `advanced` | ✅ | business, enterprise |
| `app\api\reports\stock\closing-stock\route.ts` | `/reports/stock/closing-stock` | `advanced` | ✅ | business, enterprise |
| `app\api\reports\stock\profit-margin\route.ts` | `/reports/stock/profit-margin` | `advanced` | ✅ | business, enterprise |
| `app\api\reports\stock\purchase-vs-sales\route.ts` | `/reports/stock/purchase-vs-sales` | `advanced` | ✅ | business, enterprise |
| `app\api\reports\stock\valuation\route.ts` | `/reports/stock/valuation` | `advanced` | ✅ | business, enterprise |
| `app\api\reports\trial-balance\pdf\route.ts` | `/reports/trial-balance/pdf` | `advanced` | ✅ | business, enterprise |
| `app\api\reports\trial-balance\route.ts` | `/reports/trial-balance` | `advanced` | ✅ | business, enterprise |

## 🎯 Plan Access Matrix

| Report Category | Free | Professional | Business | Enterprise |
|----------------|------|-------------|----------|-----------|
| BASIC | ❌ | ✅ | ✅ | ✅ |
| GST | ❌ | ❌ | ✅ | ✅ |
| ADVANCED | ❌ | ❌ | ✅ | ✅ |

## 💡 Recommendations

### 1. Add Missing Routes to Legacy Map

Add these entries to `legacyRouteFeatureMap` in `Sidebar.tsx`:

```typescript
  '/reports/gst/gstr1//mark-filed': 'reports_gst',
```

