# Khatario phone app — build plan

Flutter app in `phone/`. The current APK is a prototype: 13 screens, sample shop **Gupta Kirana**, no server calls. Install id `com.khatario.phone` (the Capacitor app stays `com.khatario.app`).

Counted on 12 Oct 2026 from `app/(app)/**/page.tsx`.

| | Screens |
|---|---|
| Signed-in website | 288 |
| Built on the phone, live data | 0 |
| Prototype only | 13 |
| Not ported | 4 (3 debug + `invoices/mock`) |

Each phase ends in a new APK. The server keeps tax, stock, and the ledger. Flutter calls the existing APIs. Posted edits and cancellations use the existing reversals, period locks, and GST locks. `business_id` and the acting user come from the session, never from the phone body.

Phone screen counts are lower than website routes where a view and a detail page become one receipt, or new and edit share one form. List, form, and receipt from phase 1 are reused later.

Marketing, admin, and the customer-facing store stay websites.

## Phases

| Phase | Name | Website | Phone | Ships |
|---|---|---|---|---|
| 1 | Counter | 18 | 18 | First real APK |
| 2 | Other sales | 25 | 16 | APK |
| 3 | Purchases | 26 | 16 | APK |
| 4 | Stock | 17 | 12 | APK |
| 5 | Books | 24 | 18 | APK |
| 6 | Reports | 28 | 20 | APK |
| 7 | Shop settings | 36 | 22 | APK |
| 8 | HR | 61 | 40 | APK |
| 9 | WhatsApp | 28 | 18 | APK |
| 10 | Tools | 17 | 12 | APK |
| 11 | Online store (owner) | 4 | 4 | APK |
| | Not ported | 4 | 0 | |
| | **Total** | **288** | | |

Sign-in (`app/login`) is outside the 288 and is part of phase 1.

## How a phase is built

1. Read the website route, the service it calls, and the existing tests.
2. Call that API from the phone. Do not copy GST or stock math into Flutter.
3. Build the list, then the form, then the receipt.
4. Cover an empty list, a server error, and a locked period.
5. Build the APK after that phase’s main path works.

## Phase 1 — Counter

Done when a shop user signs in, today’s figures come from the server, a saved bill posts stock and tax the same way the website does, and a payment can be collected. Sample names are gone.

Sign-in, then these 18 routes:

- `dashboard`
- `invoices`, `invoices/new`, `invoices/[id]`, `invoices/[id]/view`, `invoices/[id]/edit`
- `customers`, `customers/new`, `customers/[id]`, `customers/[id]/edit`, `customers/[id]/statement`
- `items`, `items/new`, `items/[id]`
- `payments/in`
- `more`, `search`, `notifications`

`invoices/[id]` and `invoices/[id]/view` are one phone receipt.

## Phase 2 — Other sales

25 routes. Reuse the bill list, form, and receipt.

- `estimates`
- `orders`
- `sales-orders`, `sales-orders/new`, `sales-orders/[id]`
- `delivery-challans`, `delivery-challans/new`, `delivery-challans/[id]`, `delivery-challans/edit/[id]`
- `work-orders`, `work-orders/new`, `work-orders/[id]`, `work-orders/edit/[id]`
- `credit-notes`, `credit-notes/new`, `credit-notes/[id]`
- `debit-notes`, `debit-notes/new`, `debit-notes/[id]`
- `credit-approvals`
- `invoices/recurring`, `recurring-invoices`, `invoices/whatsapp`
- `payments/out`, `payments/reconciliation`

## Phase 3 — Purchases

26 routes.

- `suppliers`, `suppliers/new`, `suppliers/[id]`
- `suppliers/hub`, `suppliers/hub/[businessId]`, `suppliers/requests`
- `suppliers/dashboard`, `suppliers/dashboard/analytics`, `suppliers/dashboard/thresholds`
- `settings/suppliers-directory`
- `purchases`, `purchases/new`, `purchases/new/select-item`, `purchases/[id]`, `purchases/categories`, `purchases/requests`, `purchases/scan-record`
- `purchase-orders`, `purchase-orders/new`, `purchase-orders/[id]`
- `purchase-returns`, `purchase-returns/new`, `purchase-returns/[id]`
- `expenses`, `expenses/new`, `expenses/categories`

## Phase 4 — Stock

17 routes.

- `items/categories`, `items/barcodes`, `pricing/party-item`
- `inventory-adjustments`, `inventory-adjustments/new`, `inventory-adjustments/[id]`
- `stock-transfers`, `stock-transfers/new`, `stock-transfers/[id]`, `stock-transfers/[id]/receive`
- `settings/warehouses`, `settings/warehouses/new`, `settings/warehouses/[id]/edit`, `settings/user-warehouses`
- `settings/label-templates`, `settings/label-templates/new`, `settings/label-templates/[id]`

## Phase 5 — Books

24 routes.

- `accounts`, `accounts/new`, `accounts/[id]`, `accounts/[id]/edit`, `accounts/[id]/reconciliation`
- `journal-entries`, `journal-entries/new`, `journal-entries/[id]`, `journal-entries/templates`
- `ledger`, `ledger/account/[id]`
- `bank/import`, `bank/reconciliation`
- `contra`, `advances`, `fixed-assets`, `opening-balances/setup`, `provisions`, `activity-logs`
- `tds`, `tds/categories`, `tds/certificates`, `tds/payments`, `tds/transactions`

## Phase 6 — Reports

28 routes.

- `reports`
- `reports/profit-loss`, `reports/profit-loss/validation`, `reports/profit-by-invoice`
- `reports/balance-sheet`, `reports/cash-flow`, `reports/trial-balance`
- `reports/aging/receivables`, `reports/aging/payables`
- `reports/gst/gstr1`, `reports/gst/gstr2b`, `reports/gst/gstr2b-reconciliation`, `reports/gst/gstr3b`, `reports/gst/gstr9`, `reports/gst/cash-ledger`, `reports/gst/compliance`, `reports/gst/reconciliation`
- `reports/stock/summary`, `reports/stock/closing-stock`, `reports/stock/valuation`, `reports/stock/fifo-lots`
- `reports/sales/[reportType]`, `reports/purchase/[reportType]`
- `reports/builder`, `reports/credit-risk`, `reports/deleted`, `reports/inter-branch-reconciliation`, `reports/label-print-log`

## Phase 7 — Shop settings

35 settings routes plus `upgrade` (36).

- `settings` (the hub)
- `settings/business`, `settings/invoice`, `settings/gst-config`, `settings/tax`, `settings/number-series`, `settings/payments`, `settings/signature`
- `settings/templates`, `settings/templates/customize`
- `settings/bluetooth-printer`, `settings/bluetooth-printer/diagnostics`
- `settings/users`, `settings/user-management`, `settings/roles`, `settings/user-branches`
- `settings/branches`, `settings/branches/new`, `settings/branches/[id]/edit`
- `settings/subscription`, `upgrade`, `settings/features`, `settings/products`
- `settings/backup`, `settings/export`, `settings/offline-sync`, `settings/period-locks`, `settings/financial-years`
- `settings/account-mappings`, `settings/custom-fields`, `settings/integrations`, `settings/email`, `settings/automation`, `settings/activity`
- `settings/help`, `settings/help/how-to`

## Phase 8 — HR

61 routes: 32 under `employees/`, 9 under `hr/`, and these 20 settings:

`attendance-policy`, `attendance-regularization`, `commission-rules`, `departments`, `employee-portal`, `hiring`, `holiday-lists`, `holidays`, `hr-approval`, `hr-employee`, `hr-exit`, `leave-plan`, `leave-types`, `offer-letter`, `onboarding-templates`, `ot-policy`, `payroll`, `salary-components`, `shifts`, `weekly-off`.

## Phase 9 — WhatsApp

28 routes: 17 under `whatsapp/`, `connect/whatsapp`, 7 under `settings/whatsapp/`, and `settings/ai-agent`, `settings/ai-assistant`, `settings/ai-config`.

## Phase 10 — Tools

17 routes under `tools/`.

## Phase 11 — Online store (owner)

4 routes: `settings/online-store`, `settings/online-store/enquiries`, `settings/online-store/orders`, `settings/online-store/studio`.

Buyers keep using the store website.

## Not ported

- `debug/dashboard-refresh`, `debug/sqlite`, `debug/webview`
- `invoices/mock`
