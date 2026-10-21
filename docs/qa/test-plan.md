# Test plan

Phase 1 wrote this plan and did not run it. Scenarios stay **not executed** unless the status column below says otherwise. S01–S08 were executed later; the evidence is in `docs/qa/phase-2a-invoice-results.md`. Expected results are stated only where a source file already defines them. Anything else is marked **requirement not found**.

## Existing automation (not executed in this audit)

| Command | What it runs |
| --- | --- |
| `npm test` | Jest (unit, security, db, lib) |
| `npm run test:security` | `tests/security` |
| `npm run test:e2e` | Playwright, Chromium project |
| `npm run test:e2e:mobile` | Playwright, mobile project |
| `npm run test:rag` | RAG tests plus rag isolation |
| `npm run validate:auth` | Authorization coverage script |
| `npm run validate:pbac` | PBAC policy script |

Disposable database name used by project rules: `kh_phase2_test`. Do not point tests at staging or production.

### Test files present

| Location | Files |
| --- | ---: |
| `tests/lib` | 233 |
| `tests/db` | 56 |
| `tests/security` | 29 |
| `tests/pbac` | 11 |
| `tests/rag` | 8 |
| `tests/api` | 2 |
| `tests/invoice-golden.benchmark.test.ts` | 1 |
| `tests/invoice-regression.benchmark.test.ts` | 1 |
| `tests/scripts` | 1 |
| `tests/templates` | 1 |
| `e2e/accounting-ui-alignment.spec.ts` | 1 |
| `e2e/ai-agent.spec.ts` | 1 |
| `e2e/assistant.spec.ts` | 1 |
| `e2e/entitlement-enforcement.spec.ts` | 1 |
| `e2e/entitlement-hardening-pass2.spec.ts` | 1 |
| `e2e/full-journey.spec.ts` | 1 |
| `e2e/identity-boundary.spec.ts` | 1 |
| `e2e/invoice-new-composer-actions.spec.ts` | 1 |
| `e2e/mobile-audit.spec.ts` | 1 |
| `e2e/offline-catalog-boundary.spec.ts` | 1 |
| `e2e/payment-readiness.spec.ts` | 1 |
| `e2e/plan-admin-hardening.spec.ts` | 1 |
| `e2e/plan-catalog-v2.spec.ts` | 1 |
| `e2e/plan-change-flow.spec.ts` | 1 |
| `e2e/plan-settings-coverage.spec.ts` | 1 |
| `e2e/profit-loss-report.spec.ts` | 1 |
| `e2e/role-access.spec.ts` | 1 |
| `e2e/sales-order-composer.spec.ts` | 1 |
| `e2e/site-builder.spec.ts` | 1 |
| `e2e/smoke.spec.ts` | 1 |
| `e2e/subscription-evidence.spec.ts` | 1 |
| `e2e/subscription-mutation-rbac.spec.ts` | 1 |
| `e2e/subscription-revenue.spec.ts` | 1 |
| `e2e/whatsapp-inbox-ownership.spec.ts` | 1 |

Total test files: 367. Playwright specs: 24.

Playwright specs on disk:

- `e2e/accounting-ui-alignment.spec.ts`
- `e2e/ai-agent.spec.ts`
- `e2e/assistant.spec.ts`
- `e2e/entitlement-enforcement.spec.ts`
- `e2e/entitlement-hardening-pass2.spec.ts`
- `e2e/full-journey.spec.ts`
- `e2e/identity-boundary.spec.ts`
- `e2e/invoice-new-composer-actions.spec.ts`
- `e2e/mobile-audit.spec.ts`
- `e2e/offline-catalog-boundary.spec.ts`
- `e2e/payment-readiness.spec.ts`
- `e2e/plan-admin-hardening.spec.ts`
- `e2e/plan-catalog-v2.spec.ts`
- `e2e/plan-change-flow.spec.ts`
- `e2e/plan-settings-coverage.spec.ts`
- `e2e/profit-loss-report.spec.ts`
- `e2e/role-access.spec.ts`
- `e2e/sales-order-composer.spec.ts`
- `e2e/site-builder.spec.ts`
- `e2e/smoke.spec.ts`
- `e2e/subscription-evidence.spec.ts`
- `e2e/subscription-mutation-rbac.spec.ts`
- `e2e/subscription-revenue.spec.ts`
- `e2e/whatsapp-inbox-ownership.spec.ts`

A file existing on disk is not a pass. Several specs are security or subscription checks, not a page-by-page functional suite.

## Roles and data to prepare before any execution phase

| Actor | How the app distinguishes them | Needed for |
| --- | --- | --- |
| Primary business admin | `isPrimaryAdmin` | Full module access, settings, user management |
| Billing staff | Role flags on invoices, customers, items, payments, purchases | CRUD denial cases |
| Read-only staff | `can_view` without add/modify/delete | Buttons that must stay hidden or APIs that must 403 |
| HR manager | employees, attendance, leave_requests, payroll | Leave approve/reject, attendance |
| Connect agent | whatsapp modules; lookup paths in `CONNECT_AGENT_LOOKUP_HREFS` | Inbox plus limited sales lookup |
| Employee portal user | employee portal cookie, ESS API allowlist | `/[slug]/employees` pages |
| Platform admin | platform JWT, `/admin` | Businesses, plans, blog |
| Partner | partner cookie | `/partners` |
| Anonymous | no session | Public pages and middleware redirects |
| Plan without a feature | subscription feature missing | `FEATURE_NOT_IN_PLAN` and locked nav |

Minimum billing fixture (requirement inferred from invoice create validation, not from a product spec): one business with GST registration fields, one branch, one customer, one goods item with stock, one user id from the session. Amounts, tax rates, and expected ledger accounts must come from the GST and ledger helpers under test, not from guessed totals.

## Security regression command

`npm run test:qa:security-live` is the repeatable command for the security checks already recorded in Phases 3A–3O and the chart-of-accounts report HTTP file. The suite list, the ports, and what the command does not cover are in `docs/qa/README.md`. It does not replace the execution order below, and it does not mark untested modules passed. The Phase 3P functional totals are a separate command, `node tests/live/phase3p-functional.mjs`, recorded in `docs/qa/phase-3p-live-workflow-results.md`. The staging browser command is `npx playwright test --config=playwright.staging.config.ts` with `STAGING_TEST_BUSINESS` set to the designated business. Evidence is in `docs/qa/phase-3q-browser-functional-results.md`. The shared Playwright config still defaults to localhost.

## Execution order

Test billing documents first. They move stock, tax, customer balance, and the ledger together. A failure there makes later report tests meaningless.

1. Auth and tenant isolation (session required, `business_id` from session, cross-tenant id rejected).
2. Items and opening stock.
3. Customers.
4. Final tax invoice, including payment on the invoice and a later receipt.
5. Credit note against that invoice.
6. Purchase bill and supplier balance.
7. Inventory adjustment and stock transfer.
8. GST reports (GSTR-1, GSTR-3B, GSTR-2B reconciliation) on the documents just posted.
9. Profit & loss, trial balance, balance sheet on the same period.
10. HR leave and attendance only after billing smoke is stable.
11. WhatsApp, store, and admin last; they depend on external services.

## Scenarios with a code-backed expected result

| ID | Module | Role | Action | Expected result (source) | Status |
| --- | --- | --- | --- | --- | --- |
| S01 | Sales | business user with invoice create | Post final invoice with lines and no payments | Invoice and invoice_items inserted; stock movement `out`; customer balance increases by grand total; ledger entries created | PASS — see `docs/qa/phase-2a-invoice-results.md` |
| S02 | Sales | same | Post final invoice as draft where draft is allowed | No stock deduction, no customer balance change, no ledger | PASS — see `docs/qa/phase-2a-invoice-results.md` |
| S03 | Sales | same | Invoice date on or before closing-stock lock | `CLOSING_STOCK_PERIOD_LOCKED` (409) | PASS after fix — see `docs/qa/phase-2a-invoice-results.md` |
| S04 | Sales | same | Unknown customer id for this business | `CUSTOMER_NOT_FOUND` | PASS after fix — see `docs/qa/phase-2a-invoice-results.md` |
| S05 | Sales | same | Line item soft-deleted | `PRODUCT_DELETED` (409) | PASS after fix — see `docs/qa/phase-2a-invoice-results.md` |
| S06 | Sales | same | Intra-state place of supply | CGST and SGST on lines; IGST zero | PASS — see `docs/qa/phase-2a-invoice-results.md` |
| S07 | Sales | same | Inter-state place of supply | IGST on lines; CGST and SGST zero | PASS — see `docs/qa/phase-2a-invoice-results.md` |
| S08 | Sales | same | Cash sale (no customer) | No customer balance update; cash-sale ledger path | PASS — see `docs/qa/phase-2a-invoice-results.md` |
| S09 | Auth | anonymous | Open `/dashboard` | Redirect to login (middleware) | not executed |
| S10 | Auth | anonymous | Open `/admin` | Redirect to admin login | not executed |
| S11 | Plan | role granted, feature off | Open a plan-gated path | `FEATURE_NOT_IN_PLAN` or locked UI | not executed |
| S12 | Security | any client | Send `x-authenticated-business-id` | Middleware strips spoofed identity headers | PASS for the API paths named in the phase 3A, 3C, and 3E results. Pages were not opened. Handler regression for the seven dashboard GETs is in `docs/qa/phase-3d-dashboard-security-fix-results.md`. Phase 3E handler leaks and the Phase 3F fix are in `docs/qa/phase-3e-identity-audit-results.md` and `docs/qa/phase-3f-identity-fix-results.md`. Phase 3G POST results are in `docs/qa/phase-3g-write-identity-audit-results.md`. The Phase 3H fix is in `docs/qa/phase-3h-write-identity-fix-results.md`. Phase 3I write results are in `docs/qa/phase-3i-write-identity-audit-results.md`. The Phase 3J fix is in `docs/qa/phase-3j-write-identity-fix-results.md`. Phase 3K write results are in `docs/qa/phase-3k-write-identity-audit-results.md`. The Phase 3L fix is in `docs/qa/phase-3l-write-identity-fix-results.md`. Phase 3M live HTTP is in `docs/qa/phase-3m-live-http-security-results.md`. Phase 3N live HTTP is in `docs/qa/phase-3n-live-http-security-results.md`. Phase 3O fixed those failures. The live regression is in `docs/qa/phase-3o-live-http-security-fix-results.md`. Phase 3P live workflows are in `docs/qa/phase-3p-live-workflow-results.md`, including the later functional totals, stock, and ledger checks. Phase 3Q fixed the recurring calendar date. The persisted invoice date is in `docs/qa/phase-3q-recurring-date-fix-results.md`. |

Soft-delete checks after S08, executed on `kh_phase2_test`. Evidence is in `docs/qa/phase-2a-invoice-results.md`.

| Check | What ran | Status |
| --- | --- | --- |
| Item list HTTP | `GET /api/items` with a billing subscription and real `authorize` | PASS |
| Item delete permission | Denied user and allowed user through `DELETE /api/items/[id]` | PASS |
| Items screen | Playwright on a local server bound to `kh_phase2_test` | PASS for list, confirmation, and the row leaving the table |
| Deleted-records report | `GET /api/reports/deleted-items?type=all` | PASS for invoice and supplier. Purchase and payment rows were not seeded. |

## Scenarios blocked on missing requirements

For each page in `route-inventory.md`, the following are **requirement not found** until a spec, test, or validation rule is cited:

- Exact validation messages and field limits.
- Which buttons each role sees.
- Sort, filter, and pagination contracts.
- Export file columns.
- Whether delete is a soft delete, a reversal, or forbidden after posting.
- GST report totals for a given fixture.
- WhatsApp send, store checkout, and payment-gateway success criteria (external systems).

Do not mark any of those passed from a screenshot or from the route existing.

## Per-page status

| Page | Automated artifacts that mention the last path segment (heuristic) | Functional status |
| --- | --- | --- |
| P001 `/[slug]/candidates` | none found | not executed |
| P002 `/[slug]/candidates/tasks/[taskId]` | none found | not executed |
| P003 `/[slug]/employees` | none found | not executed |
| P004 `/[slug]/employees/attendance` | tests/db/staff-attendance.db.test.ts, tests/lib/hr/attendance-matrix.test.ts, tests/security/attendance-check-in-actor.test.ts | not executed |
| P005 `/[slug]/employees/engagement` | none found | not executed |
| P006 `/[slug]/employees/expenses` | none found | not executed |
| P007 `/[slug]/employees/kiosk` | none found | not executed |
| P008 `/[slug]/employees/leaves` | none found | not executed |
| P009 `/[slug]/employees/leaves/new` | none found | not executed |
| P010 `/[slug]/employees/overtime/new` | tests/api/leave-overtime-actor.test.ts, tests/lib/hr/shift-overtime/weekly-off.test.ts | not executed |
| P011 `/[slug]/employees/payslips` | none found | not executed |
| P012 `/[slug]/employees/profile` | tests/lib/business-profile-requirements.test.ts | not executed |
| P013 `/[slug]/employees/team` | none found | not executed |
| P014 `/[slug]/employees/team/approvals` | none found | not executed |
| P015 `/[slug]/employees/todo` | tests/db/todo-reminder-sweep.db.test.ts, tests/lib/todo-reminders/process-reminder-job.test.ts, tests/lib/todo-reminders/sweep-position.test.ts | not executed |
| P016 `/accounts` | none found | not executed |
| P017 `/accounts/[id]` | none found | not executed |
| P018 `/accounts/[id]/edit` | tests/lib/credit-alert-dispatch.test.ts, tests/lib/credit-notes/customer-credit.test.ts | not executed |
| P019 `/accounts/[id]/reconciliation` | tests/lib/export/gstr2b-reconciliation-export.test.ts, tests/lib/invoice-extract/numeric-reconciliation-engine.test.ts, tests/lib/invoice-extract/price-mode-reconciliation.test.ts | not executed |
| P020 `/accounts/new` | none found | not executed |
| P021 `/activity-logs` | none found | not executed |
| P022 `/admin` | tests/lib/admin/tenant-purge.test.ts, e2e/plan-admin-hardening.spec.ts | not executed |
| P023 `/admin/assistant` | e2e/assistant.spec.ts | not executed |
| P024 `/admin/billing` | tests/db/billing-plan-ladder.db.test.ts, tests/lib/billing-transaction-state.test.ts, tests/lib/platform-billing-easebuzz.test.ts, tests/lib/platform-billing-webhook.test.ts | not executed |
| P025 `/admin/blog` | tests/lib/blog/blog.test.ts | not executed |
| P026 `/admin/blog/[id]` | tests/lib/blog/blog.test.ts | not executed |
| P027 `/admin/blog/[id]/preview` | none found | not executed |
| P028 `/admin/blog/new` | tests/lib/blog/blog.test.ts | not executed |
| P029 `/admin/bookings` | none found | not executed |
| P030 `/admin/bookings/[id]` | none found | not executed |
| P031 `/admin/bookings/time-slots` | none found | not executed |
| P032 `/admin/businesses` | tests/lib/businesses/create-business-input.test.ts | not executed |
| P033 `/admin/businesses/[id]` | tests/lib/businesses/create-business-input.test.ts | not executed |
| P034 `/admin/hsn-codes` | none found | not executed |
| P035 `/admin/login` | tests/lib/auth/login-account.test.ts, tests/lib/hr/employee-login-assignment.test.ts | not executed |
| P036 `/admin/partners` | tests/lib/partners/commission.test.ts, tests/lib/partners/payouts.test.ts | not executed |
| P037 `/admin/partners/[id]` | tests/lib/partners/commission.test.ts, tests/lib/partners/payouts.test.ts | not executed |
| P038 `/admin/plans` | none found | not executed |
| P039 `/admin/policies` | tests/pbac/accounting-period-policies.test.ts, tests/pbac/invoice-policies.test.ts, tests/pbac/item-policies.test.ts, tests/pbac/journal-policies.test.ts | not executed |
| P040 `/admin/releases` | none found | not executed |
| P041 `/admin/reports` | tests/db/purchase-reports-zoho-scenario.db.test.ts, tests/db/sales-reports-zoho-scenario.db.test.ts, tests/lib/reports/ageing.test.ts, tests/lib/reports/balance-sheet.test.ts | not executed |
| P042 `/admin/sales-flow` | none found | not executed |
| P043 `/admin/settings` | tests/db/settings-users-hardening.db.test.ts, tests/lib/hr/hr-settings-phase1.test.ts, tests/lib/platform-payment-settings.test.ts, tests/lib/settings/invoice-defaults.test.ts | not executed |
| P044 `/admin/site-builder` | e2e/site-builder.spec.ts | not executed |
| P045 `/admin/site-builder/preview` | none found | not executed |
| P046 `/admin/social` | none found | not executed |
| P047 `/admin/subscriptions` | none found | not executed |
| P048 `/admin/users` | tests/db/settings-users-hardening.db.test.ts | not executed |
| P049 `/admin/videos` | none found | not executed |
| P050 `/advances` | tests/lib/accounting/advances.test.ts | not executed |
| P051 `/attendance/kiosk` | none found | not executed |
| P052 `/attendance/login` | tests/lib/auth/login-account.test.ts, tests/lib/hr/employee-login-assignment.test.ts | not executed |
| P053 `/auth/impersonate` | none found | not executed |
| P054 `/bank/import` | tests/db/gstr2b-excel-import.db.test.ts | not executed |
| P055 `/bank/reconciliation` | tests/lib/export/gstr2b-reconciliation-export.test.ts, tests/lib/invoice-extract/numeric-reconciliation-engine.test.ts, tests/lib/invoice-extract/price-mode-reconciliation.test.ts | not executed |
| P056 `/blog` | tests/lib/blog/blog.test.ts | not executed |
| P057 `/blog/[slug]` | tests/lib/blog/blog.test.ts | not executed |
| P058 `/blog/category/[slug]` | none found | not executed |
| P059 `/book-demo` | none found | not executed |
| P060 `/connect/whatsapp` | tests/db/business-whatsapp-templates.db.test.ts, tests/db/whatsapp-flows.db.test.ts, tests/db/whatsapp-inbox-chat.db.test.ts, tests/db/whatsapp-inbox-ownership.db.test.ts | not executed |
| P061 `/contra` | tests/lib/accounting/contra.test.ts | not executed |
| P062 `/credit-approvals` | none found | not executed |
| P063 `/credit-notes` | tests/lib/credit-notes/customer-credit.test.ts | not executed |
| P064 `/credit-notes/[id]` | tests/lib/credit-notes/customer-credit.test.ts | not executed |
| P065 `/credit-notes/new` | tests/lib/credit-notes/customer-credit.test.ts | not executed |
| P066 `/customers` | tests/security/customers-create-route.test.ts | not executed |
| P067 `/customers/[id]` | tests/security/customers-create-route.test.ts | not executed |
| P068 `/customers/[id]/edit` | tests/lib/credit-alert-dispatch.test.ts, tests/lib/credit-notes/customer-credit.test.ts | not executed |
| P069 `/customers/[id]/statement` | none found | not executed |
| P070 `/customers/new` | tests/security/customers-create-route.test.ts | not executed |
| P071 `/dashboard` | tests/lib/dashboard/recent-transactions.test.ts, tests/lib/dashboard-snapshot.test.ts, tests/lib/employee-portal/portal-dashboard.test.ts, tests/security/dashboard-widgets-route.test.ts | not executed |
| P072 `/debit-notes` | tests/lib/debit-notes/supply-goods.test.ts | not executed |
| P073 `/debit-notes/[id]` | tests/lib/debit-notes/supply-goods.test.ts | not executed |
| P074 `/debit-notes/new` | tests/lib/debit-notes/supply-goods.test.ts | not executed |
| P075 `/debug/dashboard-refresh` | none found | not executed |
| P076 `/debug/sqlite` | none found | not executed |
| P077 `/debug/webview` | none found | not executed |
| P078 `/delivery-challans` | tests/lib/delivery-challans/challan-math.test.ts | not executed |
| P079 `/delivery-challans/[id]` | tests/lib/delivery-challans/challan-math.test.ts | not executed |
| P080 `/delivery-challans/edit/[id]` | tests/lib/credit-alert-dispatch.test.ts, tests/lib/credit-notes/customer-credit.test.ts | not executed |
| P081 `/delivery-challans/new` | tests/lib/delivery-challans/challan-math.test.ts | not executed |
| P082 `/employees` | none found | not executed |
| P083 `/employees/[id]` | none found | not executed |
| P084 `/employees/[id]/edit` | tests/lib/credit-alert-dispatch.test.ts, tests/lib/credit-notes/customer-credit.test.ts | not executed |
| P085 `/employees/attendance` | tests/db/staff-attendance.db.test.ts, tests/lib/hr/attendance-matrix.test.ts, tests/security/attendance-check-in-actor.test.ts | not executed |
| P086 `/employees/attendance/mark` | tests/invoice-golden.benchmark.test.ts, tests/invoice-regression.benchmark.test.ts, tests/lib/marketing/image-style.test.ts, tests/lib/marketing-builder/sanitize.test.ts | not executed |
| P087 `/employees/attendance/mark/advanced` | none found | not executed |
| P088 `/employees/commissions` | none found | not executed |
| P089 `/employees/expenses` | none found | not executed |
| P090 `/employees/expenses/new` | none found | not executed |
| P091 `/employees/leaves` | none found | not executed |
| P092 `/employees/leaves/calendar` | tests/lib/gst-calendar.test.ts | not executed |
| P093 `/employees/leaves/new` | none found | not executed |
| P094 `/employees/manager` | tests/lib/hr/manager-scope.test.ts | not executed |
| P095 `/employees/manager/approvals` | none found | not executed |
| P096 `/employees/manager/attendance` | tests/db/staff-attendance.db.test.ts, tests/lib/hr/attendance-matrix.test.ts, tests/security/attendance-check-in-actor.test.ts | not executed |
| P097 `/employees/manager/team` | none found | not executed |
| P098 `/employees/new` | none found | not executed |
| P099 `/employees/org-chart` | none found | not executed |
| P100 `/employees/performance` | tests/lib/supplier-area-performance.test.ts | not executed |
| P101 `/employees/recruitment` | none found | not executed |
| P102 `/employees/recruitment/candidates/[id]` | none found | not executed |
| P103 `/employees/recruitment/candidates/[id]/tasks/[taskId]` | none found | not executed |
| P104 `/employees/recruitment/jobs/[id]` | none found | not executed |
| P105 `/employees/recruitment/jobs/new` | none found | not executed |
| P106 `/employees/salary/advances` | tests/lib/accounting/advances.test.ts | not executed |
| P107 `/employees/salary/advances/new` | tests/lib/accounting/advances.test.ts | not executed |
| P108 `/employees/salary/payments` | tests/lib/payments/easebuzz-payment-provider.test.ts, tests/lib/payments/payment-in-submission.test.ts, tests/lib/payments/upi-pay-link.test.ts, tests/lib/purchases/cancel-purchase-payments-message.test.ts | not executed |
| P109 `/employees/salary/payments/new` | tests/lib/payments/easebuzz-payment-provider.test.ts, tests/lib/payments/payment-in-submission.test.ts, tests/lib/payments/upi-pay-link.test.ts, tests/lib/purchases/cancel-purchase-payments-message.test.ts | not executed |
| P110 `/employees/salary/payslips/[id]` | none found | not executed |
| P111 `/employees/targets` | none found | not executed |
| P112 `/employees/tasks` | none found | not executed |
| P113 `/employees/tasks/new` | none found | not executed |
| P114 `/estimates` | none found | not executed |
| P115 `/expenses` | none found | not executed |
| P116 `/expenses/categories` | none found | not executed |
| P117 `/expenses/new` | none found | not executed |
| P118 `/fixed-assets` | none found | not executed |
| P119 `/guides` | none found | not executed |
| P120 `/hr/dashboard` | tests/lib/dashboard/recent-transactions.test.ts, tests/lib/dashboard-snapshot.test.ts, tests/lib/employee-portal/portal-dashboard.test.ts, tests/security/dashboard-widgets-route.test.ts | not executed |
| P121 `/hr/documents` | tests/db/phase3-7-final-documents.db.test.ts | not executed |
| P122 `/hr/engagement` | none found | not executed |
| P123 `/hr/exits` | none found | not executed |
| P124 `/hr/leaves/import-balances` | none found | not executed |
| P125 `/hr/leaves/year-end` | none found | not executed |
| P126 `/hr/reports` | tests/db/purchase-reports-zoho-scenario.db.test.ts, tests/db/sales-reports-zoho-scenario.db.test.ts, tests/lib/reports/ageing.test.ts, tests/lib/reports/balance-sheet.test.ts | not executed |
| P127 `/hr/shifts/bulk-assign` | none found | not executed |
| P128 `/hr/shifts/roster` | none found | not executed |
| P129 `/i/[token]` | none found | not executed |
| P130 `/inventory-adjustments` | tests/security/inventory-adjustments-route.test.ts | not executed |
| P131 `/inventory-adjustments/[id]` | tests/security/inventory-adjustments-route.test.ts | not executed |
| P132 `/inventory-adjustments/new` | tests/security/inventory-adjustments-route.test.ts | not executed |
| P133 `/invoices` | tests/lib/invoices/document-counter.test.ts, tests/lib/invoices/invoice-compliance.test.ts, tests/lib/invoices/line-gst.test.ts, tests/lib/invoices/recurring.test.ts | not executed |
| P134 `/invoices/[id]` | tests/lib/invoices/document-counter.test.ts, tests/lib/invoices/invoice-compliance.test.ts, tests/lib/invoices/line-gst.test.ts, tests/lib/invoices/recurring.test.ts | not executed |
| P135 `/invoices/[id]/edit` | tests/lib/credit-alert-dispatch.test.ts, tests/lib/credit-notes/customer-credit.test.ts | not executed |
| P136 `/invoices/[id]/view` | tests/lib/subscription/pricing-view.test.ts, tests/security/invoice-viewed-recipients.test.ts | not executed |
| P137 `/invoices/mock` | none found | not executed |
| P138 `/invoices/new` | tests/lib/invoices/document-counter.test.ts, tests/lib/invoices/invoice-compliance.test.ts, tests/lib/invoices/line-gst.test.ts, tests/lib/invoices/recurring.test.ts | not executed |
| P139 `/invoices/recurring` | tests/lib/invoices/recurring.test.ts | not executed |
| P140 `/invoices/whatsapp` | tests/db/business-whatsapp-templates.db.test.ts, tests/db/whatsapp-flows.db.test.ts, tests/db/whatsapp-inbox-chat.db.test.ts, tests/db/whatsapp-inbox-ownership.db.test.ts | not executed |
| P141 `/items` | tests/lib/ai-agent/order-items.test.ts, tests/lib/fulfilment/parcel-items.test.ts, tests/lib/store/store-items-query.test.ts, tests/security/items-create-route.test.ts | not executed |
| P142 `/items/[id]` | tests/lib/ai-agent/order-items.test.ts, tests/lib/fulfilment/parcel-items.test.ts, tests/lib/store/store-items-query.test.ts, tests/security/items-create-route.test.ts | not executed |
| P143 `/items/barcodes` | none found | not executed |
| P144 `/items/categories` | none found | not executed |
| P145 `/items/new` | tests/lib/ai-agent/order-items.test.ts, tests/lib/fulfilment/parcel-items.test.ts, tests/lib/store/store-items-query.test.ts, tests/security/items-create-route.test.ts | not executed |
| P146 `/journal-entries` | none found | not executed |
| P147 `/journal-entries/[id]` | none found | not executed |
| P148 `/journal-entries/new` | none found | not executed |
| P149 `/journal-entries/templates` | tests/db/business-whatsapp-templates.db.test.ts, tests/lib/platform-email-templates.test.ts, tests/lib/whatsapp/tenant-templates.test.ts, tests/templates/template-field-audit.test.ts | not executed |
| P150 `/ledger` | tests/db/ledger-delete-guard.db.test.ts, tests/lib/accounting/purchase-ledger-scheme.test.ts, tests/lib/gst/cash-ledger.test.ts | not executed |
| P151 `/ledger/account/[id]` | tests/db/phase4-3-on-account-idempotency.db.test.ts, tests/lib/accounting/advances.test.ts, tests/lib/accounting/contra.test.ts, tests/lib/accounting/industry-coa.test.ts | not executed |
| P152 `/login` | tests/lib/auth/login-account.test.ts, tests/lib/hr/employee-login-assignment.test.ts | not executed |
| P153 `/more` | tests/lib/more-menu-for-user.test.ts, tests/lib/more-navigation-agent-sales.test.ts, tests/lib/more-navigation-toggle.test.ts | not executed |
| P154 `/notifications` | tests/db/notifications-seq.db.test.ts, tests/lib/notifications/client/lifecycle.test.ts, tests/lib/notifications/client/notification-store.test.ts, tests/lib/notifications/client/primitives.test.ts | not executed |
| P155 `/offline` | tests/lib/export/gstr1-offline-template.test.ts, tests/lib/offline/action-order.test.ts, tests/lib/offline/catalog/search-helpers.test.ts, tests/lib/offline/conflict-resolver.test.ts | not executed |
| P156 `/opening-balances/setup` | none found | not executed |
| P157 `/orders` | tests/api/sales-orders-update.test.ts, tests/lib/sales-orders/billing-status.test.ts, tests/lib/work-orders/work-order.test.ts | not executed |
| P158 `/page.tsx` | none found | not executed |
| P159 `/partners` | tests/lib/partners/commission.test.ts, tests/lib/partners/payouts.test.ts | not executed |
| P160 `/partners/deals` | none found | not executed |
| P161 `/partners/earnings` | none found | not executed |
| P162 `/partners/kit` | tests/lib/partners/commission.test.ts, tests/lib/partners/payouts.test.ts | not executed |
| P163 `/partners/link` | tests/lib/payments/upi-pay-link.test.ts | not executed |
| P164 `/partners/login` | tests/lib/auth/login-account.test.ts, tests/lib/hr/employee-login-assignment.test.ts | not executed |
| P165 `/partners/payouts` | tests/lib/partners/payouts.test.ts | not executed |
| P166 `/partners/profile` | tests/lib/business-profile-requirements.test.ts | not executed |
| P167 `/partners/team` | none found | not executed |
| P168 `/pay/complete` | none found | not executed |
| P169 `/pay/upi/[token]` | none found | not executed |
| P170 `/payments/in` | tests/lib/payments/easebuzz-payment-provider.test.ts, tests/lib/payments/payment-in-submission.test.ts, tests/lib/payments/upi-pay-link.test.ts, tests/lib/purchases/cancel-purchase-payments-message.test.ts | not executed |
| P171 `/payments/out` | tests/lib/payments/easebuzz-payment-provider.test.ts, tests/lib/payments/payment-in-submission.test.ts, tests/lib/payments/upi-pay-link.test.ts, tests/lib/purchases/cancel-purchase-payments-message.test.ts | not executed |
| P172 `/payments/reconciliation` | tests/lib/export/gstr2b-reconciliation-export.test.ts, tests/lib/invoice-extract/numeric-reconciliation-engine.test.ts, tests/lib/invoice-extract/price-mode-reconciliation.test.ts | not executed |
| P173 `/portal/[slug]` | tests/lib/employee-portal/ess-api-allowlist.test.ts, tests/lib/employee-portal/feature-gates.test.ts, tests/lib/employee-portal/invite.test.ts, tests/lib/employee-portal/password.test.ts | not executed |
| P174 `/pricing/party-item` | none found | not executed |
| P175 `/print/document` | tests/db/phase3-7-final-documents.db.test.ts, tests/lib/invoices/document-counter.test.ts, tests/security/document-access.test.ts | not executed |
| P176 `/privacy` | none found | not executed |
| P177 `/provisions` | none found | not executed |
| P178 `/purchase-orders` | none found | not executed |
| P179 `/purchase-orders/[id]` | none found | not executed |
| P180 `/purchase-orders/new` | none found | not executed |
| P181 `/purchase-returns` | none found | not executed |
| P182 `/purchase-returns/[id]` | none found | not executed |
| P183 `/purchase-returns/new` | none found | not executed |
| P184 `/purchases` | tests/db/purchases-list-cancelled.db.test.ts, tests/lib/purchases/cancel-purchase-payments-message.test.ts, tests/lib/purchases/map-extracted-line.test.ts, tests/lib/purchases/purchase-line-name.test.ts | not executed |
| P185 `/purchases/[id]` | tests/db/purchases-list-cancelled.db.test.ts, tests/lib/purchases/cancel-purchase-payments-message.test.ts, tests/lib/purchases/map-extracted-line.test.ts, tests/lib/purchases/purchase-line-name.test.ts | not executed |
| P186 `/purchases/categories` | none found | not executed |
| P187 `/purchases/incoming` | tests/lib/whatsapp/platform-incoming.test.ts | not executed |
| P188 `/purchases/incoming/[invoiceId]` | tests/lib/whatsapp/platform-incoming.test.ts | not executed |
| P189 `/purchases/new` | tests/db/purchases-list-cancelled.db.test.ts, tests/lib/purchases/cancel-purchase-payments-message.test.ts, tests/lib/purchases/map-extracted-line.test.ts, tests/lib/purchases/purchase-line-name.test.ts | not executed |
| P190 `/purchases/new-arrivals` | none found | not executed |
| P191 `/purchases/new/select-item` | none found | not executed |
| P192 `/purchases/requests` | none found | not executed |
| P193 `/purchases/scan-record` | none found | not executed |
| P194 `/r/[token]` | none found | not executed |
| P195 `/recurring-invoices` | none found | not executed |
| P196 `/reports` | tests/db/purchase-reports-zoho-scenario.db.test.ts, tests/db/sales-reports-zoho-scenario.db.test.ts, tests/lib/reports/ageing.test.ts, tests/lib/reports/balance-sheet.test.ts | not executed |
| P197 `/reports/aging/payables` | none found | not executed |
| P198 `/reports/aging/receivables` | none found | not executed |
| P199 `/reports/balance-sheet` | tests/lib/reports/balance-sheet.test.ts | not executed |
| P200 `/reports/builder` | tests/lib/marketing-builder/sanitize.test.ts, e2e/site-builder.spec.ts | not executed |
| P201 `/reports/cash-flow` | tests/lib/reports/cash-flow.test.ts | not executed |
| P202 `/reports/credit-risk` | none found | not executed |
| P203 `/reports/deleted` | none found | not executed |
| P204 `/reports/gst/cash-ledger` | tests/lib/gst/cash-ledger.test.ts | not executed |
| P205 `/reports/gst/compliance` | tests/lib/gst/compliance-checks.test.ts, tests/lib/invoices/invoice-compliance.test.ts | not executed |
| P206 `/reports/gst/gstr1` | tests/lib/export/gstr1-excel-defects.test.ts, tests/lib/export/gstr1-offline-template.test.ts | not executed |
| P207 `/reports/gst/gstr2b` | tests/db/gstr2b-excel-import.db.test.ts, tests/db/gstr2b-missing-invoice.db.test.ts, tests/db/gstr2b-supplier-notes.db.test.ts, tests/lib/export/gstr2b-reconciliation-export.test.ts | not executed |
| P208 `/reports/gst/gstr2b-reconciliation` | tests/lib/export/gstr2b-reconciliation-export.test.ts | not executed |
| P209 `/reports/gst/gstr3b` | tests/lib/gst/gstr3b-table5.test.ts | not executed |
| P210 `/reports/gst/gstr9` | tests/db/gstr9-table8a.db.test.ts, tests/lib/gst/gstr9-cash-paid.test.ts, tests/lib/gst/gstr9-classify.test.ts, tests/lib/gst/gstr9-table8a.test.ts | not executed |
| P211 `/reports/gst/reconciliation` | tests/lib/export/gstr2b-reconciliation-export.test.ts, tests/lib/invoice-extract/numeric-reconciliation-engine.test.ts, tests/lib/invoice-extract/price-mode-reconciliation.test.ts | not executed |
| P212 `/reports/inter-branch-reconciliation` | none found | not executed |
| P213 `/reports/label-print-log` | none found | not executed |
| P214 `/reports/profit-by-invoice` | none found | not executed |
| P215 `/reports/profit-loss` | tests/lib/export/profit-loss-excel.test.ts, tests/lib/reports/profit-loss.test.ts, e2e/profit-loss-report.spec.ts | not executed |
| P216 `/reports/profit-loss/validation` | tests/lib/whatsapp/tenant-template-validation.test.ts | not executed |
| P217 `/reports/purchase/[reportType]` | tests/db/purchase-reports-zoho-scenario.db.test.ts, tests/db/purchases-list-cancelled.db.test.ts, tests/lib/accounting/purchase-ledger-scheme.test.ts, tests/lib/accounting-ui/purchase-actions.test.ts | not executed |
| P218 `/reports/sales/[reportType]` | tests/api/sales-orders-update.test.ts, tests/db/sales-reports-zoho-scenario.db.test.ts, tests/lib/more-navigation-agent-sales.test.ts, tests/lib/offline-sync/sales-replay.test.ts | not executed |
| P219 `/reports/stock/closing-stock` | none found | not executed |
| P220 `/reports/stock/fifo-lots` | none found | not executed |
| P221 `/reports/stock/summary` | tests/lib/indian-gst-invoice-extract-gst-summary-lines.test.ts, tests/lib/whatsapp/owner-summary-command.test.ts | not executed |
| P222 `/reports/stock/valuation` | none found | not executed |
| P223 `/reports/trial-balance` | none found | not executed |
| P224 `/sales-orders` | tests/api/sales-orders-update.test.ts, tests/lib/sales-orders/billing-status.test.ts | not executed |
| P225 `/sales-orders/[id]` | tests/api/sales-orders-update.test.ts, tests/lib/sales-orders/billing-status.test.ts | not executed |
| P226 `/sales-orders/new` | tests/api/sales-orders-update.test.ts, tests/lib/sales-orders/billing-status.test.ts | not executed |
| P227 `/search` | tests/lib/offline/catalog/search-helpers.test.ts | not executed |
| P228 `/settings` | tests/db/settings-users-hardening.db.test.ts, tests/lib/hr/hr-settings-phase1.test.ts, tests/lib/platform-payment-settings.test.ts, tests/lib/settings/invoice-defaults.test.ts | not executed |
| P229 `/settings/account-mappings` | none found | not executed |
| P230 `/settings/activity` | none found | not executed |
| P231 `/settings/ai-agent` | tests/lib/ai-agent/agent-core.test.ts, tests/lib/ai-agent/knowledge.test.ts, tests/lib/ai-agent/memory.test.ts, tests/lib/ai-agent/order-items.test.ts | not executed |
| P232 `/settings/ai-assistant` | none found | not executed |
| P233 `/settings/ai-config` | none found | not executed |
| P234 `/settings/attendance-policy` | none found | not executed |
| P235 `/settings/attendance-regularization` | none found | not executed |
| P236 `/settings/automation` | none found | not executed |
| P237 `/settings/backup` | none found | not executed |
| P238 `/settings/bluetooth-printer` | none found | not executed |
| P239 `/settings/bluetooth-printer/diagnostics` | none found | not executed |
| P240 `/settings/branches` | none found | not executed |
| P241 `/settings/branches/[id]/edit` | tests/lib/credit-alert-dispatch.test.ts, tests/lib/credit-notes/customer-credit.test.ts | not executed |
| P242 `/settings/branches/new` | none found | not executed |
| P243 `/settings/business` | tests/db/business-whatsapp-templates.db.test.ts, tests/lib/business-profile-requirements.test.ts, tests/lib/business-switch-path.test.ts, tests/lib/businesses/create-business-input.test.ts | not executed |
| P244 `/settings/commission-rules` | none found | not executed |
| P245 `/settings/custom-fields` | none found | not executed |
| P246 `/settings/departments` | none found | not executed |
| P247 `/settings/email` | tests/lib/platform-email-templates.test.ts | not executed |
| P248 `/settings/employee-portal` | tests/lib/employee-portal/ess-api-allowlist.test.ts, tests/lib/employee-portal/feature-gates.test.ts, tests/lib/employee-portal/invite.test.ts, tests/lib/employee-portal/password.test.ts | not executed |
| P249 `/settings/export` | tests/lib/export/gstr1-excel-defects.test.ts, tests/lib/export/gstr1-offline-template.test.ts, tests/lib/export/gstr2b-reconciliation-export.test.ts, tests/lib/export/profit-loss-excel.test.ts | not executed |
| P250 `/settings/features` | none found | not executed |
| P251 `/settings/financial-years` | none found | not executed |
| P252 `/settings/gst-config` | none found | not executed |
| P253 `/settings/help` | tests/lib/gst/return-helpers.test.ts, tests/lib/handlebars-block-helpers.test.ts, tests/lib/hr/salary-payroll-helpers.test.ts, tests/lib/offline/catalog/search-helpers.test.ts | not executed |
| P254 `/settings/help/how-to` | none found | not executed |
| P255 `/settings/hiring` | none found | not executed |
| P256 `/settings/holiday-lists` | none found | not executed |
| P257 `/settings/holidays` | none found | not executed |
| P258 `/settings/hr-approval` | none found | not executed |
| P259 `/settings/hr-employee` | none found | not executed |
| P260 `/settings/hr-exit` | none found | not executed |
| P261 `/settings/integrations` | none found | not executed |
| P262 `/settings/invoice` | tests/db/gstr2b-missing-invoice.db.test.ts, tests/db/phase3-5-store-invoice.db.test.ts, tests/invoice-golden.benchmark.test.ts, tests/invoice-regression.benchmark.test.ts | not executed |
| P263 `/settings/label-templates` | none found | not executed |
| P264 `/settings/label-templates/[id]` | none found | not executed |
| P265 `/settings/label-templates/new` | none found | not executed |
| P266 `/settings/leave-plan` | none found | not executed |
| P267 `/settings/leave-types` | none found | not executed |
| P268 `/settings/number-series` | none found | not executed |
| P269 `/settings/offer-letter` | none found | not executed |
| P270 `/settings/offline-sync` | tests/lib/offline-sync/idempotent-replay-savepoint.test.ts, tests/lib/offline-sync/purchase-replay.test.ts, tests/lib/offline-sync/sales-replay.test.ts, tests/lib/offline-sync/with-idempotent-replay.test.ts | not executed |
| P271 `/settings/onboarding-templates` | none found | not executed |
| P272 `/settings/online-store` | none found | not executed |
| P273 `/settings/online-store/enquiries` | none found | not executed |
| P274 `/settings/online-store/orders` | tests/api/sales-orders-update.test.ts, tests/lib/sales-orders/billing-status.test.ts, tests/lib/work-orders/work-order.test.ts | not executed |
| P275 `/settings/online-store/studio` | tests/lib/store/studio.test.ts | not executed |
| P276 `/settings/ot-policy` | none found | not executed |
| P277 `/settings/payments` | tests/lib/payments/easebuzz-payment-provider.test.ts, tests/lib/payments/payment-in-submission.test.ts, tests/lib/payments/upi-pay-link.test.ts, tests/lib/purchases/cancel-purchase-payments-message.test.ts | not executed |
| P278 `/settings/payroll` | tests/lib/hr/salary-payroll-helpers.test.ts | not executed |
| P279 `/settings/period-locks` | none found | not executed |
| P280 `/settings/products` | none found | not executed |
| P281 `/settings/roles` | tests/security/roles-screen-save-route.test.ts | not executed |
| P282 `/settings/salary-components` | tests/lib/hr/salary-components.test.ts | not executed |
| P283 `/settings/shifts` | none found | not executed |
| P284 `/settings/signature` | none found | not executed |
| P285 `/settings/subscription` | tests/db/module-subscription-sole-source.db.test.ts, tests/lib/subscription/hr-bundle.test.ts, tests/lib/subscription/lifecycle-notifications.test.ts, tests/lib/subscription/pricing-view.test.ts | not executed |
| P286 `/settings/suppliers-directory` | none found | not executed |
| P287 `/settings/tax` | tests/db/settings-users-hardening.db.test.ts, tests/lib/hr/hr-settings-phase1.test.ts, tests/lib/platform-payment-settings.test.ts, tests/lib/settings/invoice-defaults.test.ts | not executed |
| P288 `/settings/templates` | tests/db/business-whatsapp-templates.db.test.ts, tests/lib/platform-email-templates.test.ts, tests/lib/whatsapp/tenant-templates.test.ts, tests/templates/template-field-audit.test.ts | not executed |
| P289 `/settings/templates/customize` | none found | not executed |
| P290 `/settings/user-branches` | none found | not executed |
| P291 `/settings/user-management` | none found | not executed |
| P292 `/settings/user-warehouses` | none found | not executed |
| P293 `/settings/users` | tests/db/settings-users-hardening.db.test.ts | not executed |
| P294 `/settings/warehouses` | none found | not executed |
| P295 `/settings/warehouses/[id]/edit` | tests/lib/credit-alert-dispatch.test.ts, tests/lib/credit-notes/customer-credit.test.ts | not executed |
| P296 `/settings/warehouses/new` | none found | not executed |
| P297 `/settings/weekly-off` | tests/lib/hr/shift-overtime/weekly-off.test.ts | not executed |
| P298 `/settings/whatsapp` | tests/db/business-whatsapp-templates.db.test.ts, tests/db/whatsapp-flows.db.test.ts, tests/db/whatsapp-inbox-chat.db.test.ts, tests/db/whatsapp-inbox-ownership.db.test.ts | not executed |
| P299 `/settings/whatsapp/ai-agent` | tests/lib/ai-agent/agent-core.test.ts, tests/lib/ai-agent/knowledge.test.ts, tests/lib/ai-agent/memory.test.ts, tests/lib/ai-agent/order-items.test.ts | not executed |
| P300 `/settings/whatsapp/inbox` | tests/db/whatsapp-inbox-chat.db.test.ts, tests/db/whatsapp-inbox-ownership.db.test.ts, tests/lib/connect-seats-and-inbox-permission.test.ts, tests/lib/whatsapp/inbox-ownership.test.ts | not executed |
| P301 `/settings/whatsapp/notifications` | tests/db/notifications-seq.db.test.ts, tests/lib/notifications/client/lifecycle.test.ts, tests/lib/notifications/client/notification-store.test.ts, tests/lib/notifications/client/primitives.test.ts | not executed |
| P302 `/settings/whatsapp/shop` | tests/db/whatsapp-shop.db.test.ts, tests/lib/whatsapp-shop/shop.test.ts | not executed |
| P303 `/settings/whatsapp/team` | none found | not executed |
| P304 `/settings/whatsapp/templates` | tests/db/business-whatsapp-templates.db.test.ts, tests/lib/platform-email-templates.test.ts, tests/lib/whatsapp/tenant-templates.test.ts, tests/templates/template-field-audit.test.ts | not executed |
| P305 `/signup` | none found | not executed |
| P306 `/solution/accounting` | tests/lib/accounting/advances.test.ts, tests/lib/accounting/contra.test.ts, tests/lib/accounting/industry-coa.test.ts, tests/lib/accounting/it-depreciation.test.ts | not executed |
| P307 `/solution/inventory` | tests/lib/inventory/fifo-engine.test.ts, tests/lib/inventory/fifo-recost.test.ts, tests/security/inventory-adjustments-route.test.ts | not executed |
| P308 `/stock-transfers` | none found | not executed |
| P309 `/stock-transfers/[id]` | none found | not executed |
| P310 `/stock-transfers/[id]/receive` | none found | not executed |
| P311 `/stock-transfers/new` | none found | not executed |
| P312 `/store` | tests/db/easebuzz-store-payment.db.test.ts, tests/db/phase3-5-store-invoice.db.test.ts, tests/db/phase3-6a-store-cancel.db.test.ts, tests/db/phase3-6b-store-payment.db.test.ts | not executed |
| P313 `/store/about` | none found | not executed |
| P314 `/store/account` | tests/db/phase4-3-on-account-idempotency.db.test.ts, tests/lib/accounting/advances.test.ts, tests/lib/accounting/contra.test.ts, tests/lib/accounting/industry-coa.test.ts | not executed |
| P315 `/store/cart` | none found | not executed |
| P316 `/store/checkout` | tests/db/store-checkout-stock.db.test.ts | not executed |
| P317 `/store/contact` | none found | not executed |
| P318 `/store/privacy` | none found | not executed |
| P319 `/store/products/[id]` | none found | not executed |
| P320 `/store/refund` | none found | not executed |
| P321 `/store/terms` | none found | not executed |
| P322 `/store/wishlist` | none found | not executed |
| P323 `/suppliers` | none found | not executed |
| P324 `/suppliers/[id]` | none found | not executed |
| P325 `/suppliers/[id]/item-links` | none found | not executed |
| P326 `/suppliers/[id]/items` | tests/lib/ai-agent/order-items.test.ts, tests/lib/fulfilment/parcel-items.test.ts, tests/lib/store/store-items-query.test.ts, tests/security/items-create-route.test.ts | not executed |
| P327 `/suppliers/catalog` | tests/db/plan-catalog-v2.db.test.ts, tests/lib/gst/hsn-catalog.test.ts, tests/lib/offline/catalog/search-helpers.test.ts, e2e/offline-catalog-boundary.spec.ts | not executed |
| P328 `/suppliers/dashboard` | tests/lib/dashboard/recent-transactions.test.ts, tests/lib/dashboard-snapshot.test.ts, tests/lib/employee-portal/portal-dashboard.test.ts, tests/security/dashboard-widgets-route.test.ts | not executed |
| P329 `/suppliers/dashboard/analytics` | none found | not executed |
| P330 `/suppliers/dashboard/thresholds` | none found | not executed |
| P331 `/suppliers/hub` | none found | not executed |
| P332 `/suppliers/hub/[businessId]` | none found | not executed |
| P333 `/suppliers/hub/find` | none found | not executed |
| P334 `/suppliers/new` | none found | not executed |
| P335 `/suppliers/requests` | none found | not executed |
| P336 `/supply-orders` | none found | not executed |
| P337 `/supply-orders/[id]` | none found | not executed |
| P338 `/supply-orders/new` | none found | not executed |
| P339 `/tds` | none found | not executed |
| P340 `/tds/categories` | none found | not executed |
| P341 `/tds/certificates` | none found | not executed |
| P342 `/tds/payments` | tests/lib/payments/easebuzz-payment-provider.test.ts, tests/lib/payments/payment-in-submission.test.ts, tests/lib/payments/upi-pay-link.test.ts, tests/lib/purchases/cancel-purchase-payments-message.test.ts | not executed |
| P343 `/tds/transactions` | tests/lib/dashboard/recent-transactions.test.ts | not executed |
| P344 `/terms` | none found | not executed |
| P345 `/tools` | tests/lib/insights/tools-turn.test.ts | not executed |
| P346 `/tools/currency-converter` | none found | not executed |
| P347 `/tools/discount-calculator` | none found | not executed |
| P348 `/tools/emi-calculator` | none found | not executed |
| P349 `/tools/google-lead-extractor` | none found | not executed |
| P350 `/tools/gst-calculator` | tests/lib/purchase-gst-calculator.test.ts | not executed |
| P351 `/tools/gstin-validator` | none found | not executed |
| P352 `/tools/hsn-finder` | none found | not executed |
| P353 `/tools/image-background-remover` | none found | not executed |
| P354 `/tools/image-size-reducer` | none found | not executed |
| P355 `/tools/interest-calculator` | none found | not executed |
| P356 `/tools/invoice-number-generator` | none found | not executed |
| P357 `/tools/pan-validator` | none found | not executed |
| P358 `/tools/price-margin-calculator` | none found | not executed |
| P359 `/tools/tds-calculator` | none found | not executed |
| P360 `/tools/todo` | tests/db/todo-reminder-sweep.db.test.ts, tests/lib/todo-reminders/process-reminder-job.test.ts, tests/lib/todo-reminders/sweep-position.test.ts | not executed |
| P361 `/tools/whatsapp-group-extractor` | none found | not executed |
| P362 `/track/[token]` | tests/security/promotions-track-route.test.ts | not executed |
| P363 `/upgrade` | none found | not executed |
| P364 `/wa-shop/[token]` | none found | not executed |
| P365 `/whatsapp` | tests/db/business-whatsapp-templates.db.test.ts, tests/db/whatsapp-flows.db.test.ts, tests/db/whatsapp-inbox-chat.db.test.ts, tests/db/whatsapp-inbox-ownership.db.test.ts | not executed |
| P366 `/whatsapp/bot-rules` | none found | not executed |
| P367 `/whatsapp/campaigns` | none found | not executed |
| P368 `/whatsapp/campaigns/[id]` | none found | not executed |
| P369 `/whatsapp/contacts` | none found | not executed |
| P370 `/whatsapp/contacts/groups` | none found | not executed |
| P371 `/whatsapp/conversations` | none found | not executed |
| P372 `/whatsapp/dashboard` | tests/lib/dashboard/recent-transactions.test.ts, tests/lib/dashboard-snapshot.test.ts, tests/lib/employee-portal/portal-dashboard.test.ts, tests/security/dashboard-widgets-route.test.ts | not executed |
| P373 `/whatsapp/flows` | tests/db/whatsapp-flows.db.test.ts, tests/lib/whatsapp/flows.test.ts, tests/security/whatsapp-flows-routes.test.ts | not executed |
| P374 `/whatsapp/flows/[id]` | tests/db/whatsapp-flows.db.test.ts, tests/lib/whatsapp/flows.test.ts, tests/security/whatsapp-flows-routes.test.ts | not executed |
| P375 `/whatsapp/group-extractor` | none found | not executed |
| P376 `/whatsapp/orders` | tests/api/sales-orders-update.test.ts, tests/lib/sales-orders/billing-status.test.ts, tests/lib/work-orders/work-order.test.ts | not executed |
| P377 `/whatsapp/reminders` | tests/lib/todo-reminders/process-reminder-job.test.ts, tests/lib/todo-reminders/sweep-position.test.ts, tests/security/check-reminders-route.test.ts | not executed |
| P378 `/whatsapp/saved-replies` | none found | not executed |
| P379 `/whatsapp/send-message` | none found | not executed |
| P380 `/whatsapp/unsubscribes` | none found | not executed |
| P381 `/whatsapp/who-to-message` | tests/lib/whatsapp/who-to-message.test.ts | not executed |
| P382 `/work-orders` | tests/lib/work-orders/work-order.test.ts | not executed |
| P383 `/work-orders/[id]` | tests/lib/work-orders/work-order.test.ts | not executed |
| P384 `/work-orders/edit/[id]` | tests/lib/credit-alert-dispatch.test.ts, tests/lib/credit-notes/customer-credit.test.ts | not executed |
| P385 `/work-orders/new` | tests/lib/work-orders/work-order.test.ts | not executed |

The artifact column is a filename hint only. It does not mean the test opens that page.
