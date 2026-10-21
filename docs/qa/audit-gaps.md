# Audit gaps

Phase 1 inventory only. Nothing in this file was executed against a running app. Later results live in `docs/qa/phase-2a-invoice-results.md` and are indexed in `docs/qa/README.md`. Do not delete these gaps because a later invoice test passed.

Staging browser coverage is only the pages named in `phase-3q-browser-functional-results.md`. The invoice list and side panel were not opened. Purchase, stock, and purchase return stay BLOCKED after “Too many login attempts. Please try again later.” INV-072 and the `P3QB` parties and items are still on Shalini Traders. The corrected test was not run.

## Completeness

| Area | Covered | Not covered |
| --- | --- | --- |
| Registered pages | Every `page.tsx` under `app/` (385) | Screens that exist only inside a tab, dialog, or sheet and have no route |
| Registered handlers | Every `route.ts` under `app/` (947) | Workers, cron entry scripts, and Capacitor native code |
| Actions | Verb-like labels in the page and one import level (827 labels) | Translated labels, icon buttons, and deeper component trees |
| Permissions per button | Not mapped | Need `authorize` / capability checks read per handler |
| Expected totals and copy | Only invoice-create effects cited in the test plan | Almost all other workflows |
| Runtime | Not run | Render, API status, database rows |

## `(app)` pages missing from primary navigation

These routes exist. They may be linked from a settings hub, a row action, or nowhere. Absence from the sidebar is not a defect by itself.

| Page | URL |
| --- | --- |
| P060 | `/connect/whatsapp` |
| P062 | `/credit-approvals` |
| P071 | `/dashboard` |
| P075 | `/debug/dashboard-refresh` |
| P076 | `/debug/sqlite` |
| P077 | `/debug/webview` |
| P154 | `/notifications` |
| P156 | `/opening-balances/setup` |
| P363 | `/upgrade` |
| P365 | `/whatsapp` |
| P366 | `/whatsapp/bot-rules` |
| P378 | `/whatsapp/saved-replies` |

Count: 12.

`/dashboard` is the billing home (`getDefaultHomePath` / sidebar `homeHref`). The nav scrape looks for literal `href:` strings, so it missed that variable. Treat `/dashboard` as linked. `/whatsapp/dashboard` is in the sidebar; `/whatsapp` itself was not a literal nav href. Debug routes (`/debug/*`) should be treated as non-production until confirmed otherwise.

A page marked `child-of-nav` in the route inventory only means some shorter nav href is a prefix. That does not prove the settings hub or an in-page button actually links to it.

## Dynamic templates that need fixture records

These are templates, not data. A test must create or seed the record and open the real id.

| Page | URL | Params |
| --- | --- | --- |
| P001 | `/[slug]/candidates` | slug |
| P002 | `/[slug]/candidates/tasks/[taskId]` | slug, taskId |
| P003 | `/[slug]/employees` | slug |
| P004 | `/[slug]/employees/attendance` | slug |
| P005 | `/[slug]/employees/engagement` | slug |
| P006 | `/[slug]/employees/expenses` | slug |
| P007 | `/[slug]/employees/kiosk` | slug |
| P008 | `/[slug]/employees/leaves` | slug |
| P009 | `/[slug]/employees/leaves/new` | slug |
| P010 | `/[slug]/employees/overtime/new` | slug |
| P011 | `/[slug]/employees/payslips` | slug |
| P012 | `/[slug]/employees/profile` | slug |
| P013 | `/[slug]/employees/team` | slug |
| P014 | `/[slug]/employees/team/approvals` | slug |
| P015 | `/[slug]/employees/todo` | slug |
| P017 | `/accounts/[id]` | id |
| P018 | `/accounts/[id]/edit` | id |
| P019 | `/accounts/[id]/reconciliation` | id |
| P026 | `/admin/blog/[id]` | id |
| P027 | `/admin/blog/[id]/preview` | id |
| P030 | `/admin/bookings/[id]` | id |
| P033 | `/admin/businesses/[id]` | id |
| P037 | `/admin/partners/[id]` | id |
| P057 | `/blog/[slug]` | slug |
| P058 | `/blog/category/[slug]` | slug |
| P064 | `/credit-notes/[id]` | id |
| P067 | `/customers/[id]` | id |
| P068 | `/customers/[id]/edit` | id |
| P069 | `/customers/[id]/statement` | id |
| P073 | `/debit-notes/[id]` | id |
| P079 | `/delivery-challans/[id]` | id |
| P080 | `/delivery-challans/edit/[id]` | id |
| P083 | `/employees/[id]` | id |
| P084 | `/employees/[id]/edit` | id |
| P102 | `/employees/recruitment/candidates/[id]` | id |
| P103 | `/employees/recruitment/candidates/[id]/tasks/[taskId]` | id, taskId |
| P104 | `/employees/recruitment/jobs/[id]` | id |
| P110 | `/employees/salary/payslips/[id]` | id |
| P129 | `/i/[token]` | token |
| P131 | `/inventory-adjustments/[id]` | id |
| P134 | `/invoices/[id]` | id |
| P135 | `/invoices/[id]/edit` | id |
| P136 | `/invoices/[id]/view` | id |
| P142 | `/items/[id]` | id |
| P147 | `/journal-entries/[id]` | id |
| P151 | `/ledger/account/[id]` | id |
| P169 | `/pay/upi/[token]` | token |
| P173 | `/portal/[slug]` | slug |
| P179 | `/purchase-orders/[id]` | id |
| P182 | `/purchase-returns/[id]` | id |
| P185 | `/purchases/[id]` | id |
| P188 | `/purchases/incoming/[invoiceId]` | invoiceId |
| P194 | `/r/[token]` | token |
| P217 | `/reports/purchase/[reportType]` | reportType |
| P218 | `/reports/sales/[reportType]` | reportType |
| P225 | `/sales-orders/[id]` | id |
| P241 | `/settings/branches/[id]/edit` | id |
| P264 | `/settings/label-templates/[id]` | id |
| P295 | `/settings/warehouses/[id]/edit` | id |
| P309 | `/stock-transfers/[id]` | id |
| P310 | `/stock-transfers/[id]/receive` | id |
| P319 | `/store/products/[id]` | id |
| P324 | `/suppliers/[id]` | id |
| P325 | `/suppliers/[id]/item-links` | id |
| P326 | `/suppliers/[id]/items` | id |
| P332 | `/suppliers/hub/[businessId]` | businessId |
| P337 | `/supply-orders/[id]` | id |
| P362 | `/track/[token]` | token |
| P364 | `/wa-shop/[token]` | token |
| P368 | `/whatsapp/campaigns/[id]` | id |
| P374 | `/whatsapp/flows/[id]` | id |
| P383 | `/work-orders/[id]` | id |
| P384 | `/work-orders/edit/[id]` | id |

Count: 73.

## Pages where the scanner found no action labels

Often a thin page that renders a shared component the scanner did not open, or a view with icon-only controls.

| Page | URL | Shells |
| --- | --- | --- |
| P019 | `/accounts/[id]/reconciliation` | — |
| P060 | `/connect/whatsapp` | — |
| P061 | `/contra` | — |
| P069 | `/customers/[id]/statement` | — |
| P076 | `/debug/sqlite` | — |
| P077 | `/debug/webview` | — |
| P085 | `/employees/attendance` | — |
| P086 | `/employees/attendance/mark` | — |
| P087 | `/employees/attendance/mark/advanced` | — |
| P094 | `/employees/manager` | — |
| P095 | `/employees/manager/approvals` | — |
| P096 | `/employees/manager/attendance` | — |
| P097 | `/employees/manager/team` | — |
| P099 | `/employees/org-chart` | — |
| P100 | `/employees/performance` | — |
| P117 | `/expenses/new` | — |
| P123 | `/hr/exits` | — |
| P125 | `/hr/leaves/year-end` | — |
| P126 | `/hr/reports` | — |
| P128 | `/hr/shifts/roster` | bulk-selection |
| P135 | `/invoices/[id]/edit` | — |
| P151 | `/ledger/account/[id]` | — |
| P154 | `/notifications` | tabs |
| P156 | `/opening-balances/setup` | — |
| P177 | `/provisions` | — |
| P179 | `/purchase-orders/[id]` | — |
| P186 | `/purchases/categories` | — |
| P187 | `/purchases/incoming` | — |
| P193 | `/purchases/scan-record` | file-upload |
| P197 | `/reports/aging/payables` | — |
| P198 | `/reports/aging/receivables` | — |
| P199 | `/reports/balance-sheet` | sheet |
| P202 | `/reports/credit-risk` | tabs, sort |
| P204 | `/reports/gst/cash-ledger` | — |
| P206 | `/reports/gst/gstr1` | tabs |
| P207 | `/reports/gst/gstr2b` | tabs |
| P210 | `/reports/gst/gstr9` | — |
| P213 | `/reports/label-print-log` | — |
| P214 | `/reports/profit-by-invoice` | sort |
| P216 | `/reports/profit-loss/validation` | — |
| P221 | `/reports/stock/summary` | pagination |
| P222 | `/reports/stock/valuation` | — |
| P223 | `/reports/trial-balance` | — |
| P229 | `/settings/account-mappings` | — |
| P231 | `/settings/ai-agent` | — |
| P232 | `/settings/ai-assistant` | — |
| P233 | `/settings/ai-config` | — |
| P234 | `/settings/attendance-policy` | — |
| P235 | `/settings/attendance-regularization` | — |
| P245 | `/settings/custom-fields` | — |
| P246 | `/settings/departments` | — |
| P248 | `/settings/employee-portal` | — |
| P249 | `/settings/export` | — |
| P250 | `/settings/features` | — |
| P252 | `/settings/gst-config` | — |
| P253 | `/settings/help` | — |
| P255 | `/settings/hiring` | — |
| P258 | `/settings/hr-approval` | — |
| P259 | `/settings/hr-employee` | — |
| P260 | `/settings/hr-exit` | — |
| P262 | `/settings/invoice` | — |
| P269 | `/settings/offer-letter` | — |
| P273 | `/settings/online-store/enquiries` | pagination |
| P282 | `/settings/salary-components` | — |
| P284 | `/settings/signature` | — |
| P287 | `/settings/tax` | — |
| P291 | `/settings/user-management` | — |
| P297 | `/settings/weekly-off` | — |
| P303 | `/settings/whatsapp/team` | — |
| P325 | `/suppliers/[id]/item-links` | — |
| P326 | `/suppliers/[id]/items` | — |
| P328 | `/suppliers/dashboard` | — |
| P329 | `/suppliers/dashboard/analytics` | — |
| P332 | `/suppliers/hub/[businessId]` | — |
| P333 | `/suppliers/hub/find` | pagination |
| P345 | `/tools` | — |
| P347 | `/tools/discount-calculator` | — |
| P348 | `/tools/emi-calculator` | — |
| P349 | `/tools/google-lead-extractor` | — |
| P350 | `/tools/gst-calculator` | — |
| P352 | `/tools/hsn-finder` | — |
| P354 | `/tools/image-size-reducer` | file-upload |
| P355 | `/tools/interest-calculator` | — |
| P361 | `/tools/whatsapp-group-extractor` | — |
| P363 | `/upgrade` | — |
| P365 | `/whatsapp` | — |
| P366 | `/whatsapp/bot-rules` | — |
| P370 | `/whatsapp/contacts/groups` | — |
| P371 | `/whatsapp/conversations` | pagination |
| P375 | `/whatsapp/group-extractor` | — |
| P381 | `/whatsapp/who-to-message` | — |

Count: 91 in the `(app)` group.

## Query parameters seen in scanned source

| Page | URL | Params |
| --- | --- | --- |
| P008 | `/[slug]/employees/leaves` | tab |
| P045 | `/admin/site-builder/preview` | product |
| P053 | `/auth/impersonate` | token |
| P055 | `/bank/reconciliation` | bank_statement_id |
| P066 | `/customers` | tab |
| P114 | `/estimates` | select |
| P132 | `/inventory-adjustments/new` | item_id |
| P133 | `/invoices` | status, channel, branch_id |
| P136 | `/invoices/[id]/view` | from, supply_order_id |
| P138 | `/invoices/new` | type, work_order_id, supply_order_id, edit, customer_id, item_id, qty, convert_from |
| P141 | `/items` | stock, filter |
| P145 | `/items/new` | edit |
| P152 | `/login` | redirect |
| P158 | `/page.tsx` | product |
| P178 | `/purchase-orders` | id |
| P180 | `/purchase-orders/new` | supplier_id, item_id, qty |
| P191 | `/purchases/new/select-item` | kind, returnTo, warehouse_id |
| P193 | `/purchases/scan-record` | returnTo |
| P211 | `/reports/gst/reconciliation` | period, mode, branch_id, view |
| P222 | `/reports/stock/valuation` | warehouse_id, location_id |
| P226 | `/sales-orders/new` | edit, convert_from, customer_id, item_id, qty |
| P227 | `/search` | q |
| P243 | `/settings/business` | highlight, business_profile_tour |
| P261 | `/settings/integrations` | category |
| P271 | `/settings/onboarding-templates` | tab |
| P280 | `/settings/products` | upsell |
| P285 | `/settings/subscription` | payment, plan |
| P289 | `/settings/templates/customize` | template_id, template_name, document_type |
| P305 | `/signup` | product, lead, ref |
| P371 | `/whatsapp/conversations` | phone, c |
| P377 | `/whatsapp/reminders` | tab |
| P379 | `/whatsapp/send-message` | tab |

## Middleware-public API prefixes

These skip the business session in `middleware.ts`. Each handler must enforce its own check. Phase 3A ran the existing cron-secret test for `POST /api/cron/process-campaigns` only. The other rows in this list were not called. Phase 3B fixed four protected list handlers that trusted a query identity; it did not review this public list. Phase 3C found the same query-identity pattern on seven dashboard GET handlers. Phase 3D fixed those seven. Phase 3E confirmed nine more session-protected GET handlers. Phase 3F fixed those nine. Phase 3G audited six POST handlers on the same routes. Estimates, sales orders, and customers failed. Phase 3H fixed those three and expenses POST. Phase 3I audited five more write handlers. Items, purchase orders, inventory adjustments, suppliers, and customer update failed. Phase 3J fixed those five. See `docs/qa/phase-3i-write-identity-audit-results.md` and `docs/qa/phase-3j-write-identity-fix-results.md`. Phase 3K audited six more write handlers. Stock transfers, purchase returns, and recurring-invoice item references failed. Phase 3L fixed those three. See `docs/qa/phase-3k-write-identity-audit-results.md` and `docs/qa/phase-3l-write-identity-fix-results.md`. Phase 3M called the fixed routes through a local Next.js server. See `docs/qa/phase-3m-live-http-security-results.md`. Phase 3N called the remaining list GETs and POST purchases, payments, and journal entries. Purchase-order and purchase-return lists failed. See `docs/qa/phase-3n-live-http-security-results.md`. Phase 3O fixed those four handlers. See `docs/qa/phase-3o-live-http-security-fix-results.md`. Phase 3P called the remaining live lists, creates, transfer dispatch and receipt, purchase-return cancellation, and recurring generation. The recurring run date was one calendar day early. See `docs/qa/phase-3p-live-workflow-results.md`. Phase 3Q keeps that database date as a calendar day. See `docs/qa/phase-3q-recurring-date-fix-results.md`. A later Phase 3P run checked stored purchase-order totals, purchase-return stock and ledger lines, transfer quantities, and the generated invoice date. See the functional follow-up in `docs/qa/phase-3p-live-workflow-results.md`.

| ID | URL | Session note |
| --- | --- | --- |
| A0133 | `/api/auth/forgot-password` | middleware-public |
| A0134 | `/api/auth/impersonate/consume` | middleware-public |
| A0135 | `/api/auth/login` | middleware-public |
| A0136 | `/api/auth/logout` | middleware-public |
| A0137 | `/api/auth/me` | middleware-public |
| A0138 | `/api/auth/refresh` | middleware-public |
| A0139 | `/api/auth/reset-password` | middleware-public |
| A0140 | `/api/auth/session` | middleware-public |
| A0194 | `/api/cron/assistant-maintenance` | middleware-public (cron secret expected in handler) |
| A0195 | `/api/cron/check-low-stock` | middleware-public (cron secret expected in handler) |
| A0196 | `/api/cron/check-subscriptions` | middleware-public (cron secret expected in handler) |
| A0197 | `/api/cron/expire-sales-order-reservations` | middleware-public (cron secret expected in handler) |
| A0198 | `/api/cron/gst-compliance-alerts` | middleware-public (cron secret expected in handler) |
| A0199 | `/api/cron/hr-probation-confirm` | middleware-public (cron secret expected in handler) |
| A0200 | `/api/cron/leave-accrual` | middleware-public (cron secret expected in handler) |
| A0201 | `/api/cron/leave-year-end` | middleware-public (cron secret expected in handler) |
| A0202 | `/api/cron/marketing-draft` | middleware-public (cron secret expected in handler) |
| A0203 | `/api/cron/marketing-insights` | middleware-public (cron secret expected in handler) |
| A0204 | `/api/cron/marketing-publish` | middleware-public (cron secret expected in handler) |
| A0205 | `/api/cron/order-dispatch-alerts` | middleware-public (cron secret expected in handler) |
| A0206 | `/api/cron/owner-daily-summary` | middleware-public (cron secret expected in handler) |
| A0207 | `/api/cron/process-campaigns` | middleware-public (cron secret expected in handler) |
| A0208 | `/api/cron/process-reversing-entries` | middleware-public (cron secret expected in handler) |
| A0209 | `/api/cron/process-scheduled-backups` | middleware-public (cron secret expected in handler) |
| A0210 | `/api/cron/recurring-invoices` | middleware-public (cron secret expected in handler) |
| A0211 | `/api/cron/refresh-profile-pictures` | middleware-public (cron secret expected in handler) |
| A0212 | `/api/cron/sales-funnel` | middleware-public (cron secret expected in handler) |
| A0213 | `/api/cron/send-daily-invoice-summary` | middleware-public (cron secret expected in handler) |
| A0214 | `/api/cron/send-payment-reminders` | middleware-public (cron secret expected in handler) |
| A0215 | `/api/cron/send-todo-reminders` | middleware-public (cron secret expected in handler) |
| A0216 | `/api/cron/shift-roster-absent` | middleware-public (cron secret expected in handler) |
| A0217 | `/api/cron/stuck-parcels` | middleware-public (cron secret expected in handler) |
| A0218 | `/api/cron/whatsapp-auto-resolve` | middleware-public (cron secret expected in handler) |
| A0511 | `/api/payments/return/easebuzz` | middleware-public (provider signature expected in handler) |
| A0513 | `/api/payments/webhook/[provider]` | middleware-public (provider signature expected in handler) |
| A0514 | `/api/payments/webhook/easebuzz` | middleware-public (provider signature expected in handler) |
| A0515 | `/api/payments/webhook/instamojo` | middleware-public (provider signature expected in handler) |
| A0516 | `/api/payments/webhook/payu` | middleware-public (provider signature expected in handler) |
| A0517 | `/api/payments/webhook/phonepe` | middleware-public (provider signature expected in handler) |
| A0529 | `/api/public/assistant/action` | middleware-public (own auth in handler) |
| A0530 | `/api/public/assistant/chat` | middleware-public (own auth in handler) |
| A0531 | `/api/public/assistant/conversation/[id]` | middleware-public (own auth in handler) |
| A0532 | `/api/public/assistant/feedback` | middleware-public (own auth in handler) |
| A0533 | `/api/public/candidate/[slug]` | middleware-public (own auth in handler) |
| A0534 | `/api/public/candidate/[slug]/request-otp` | middleware-public (own auth in handler) |
| A0535 | `/api/public/candidate/[slug]/verify-otp` | middleware-public (own auth in handler) |
| A0536 | `/api/public/candidate/session/documents` | middleware-public (own auth in handler) |
| A0537 | `/api/public/candidate/session/logout` | middleware-public (own auth in handler) |
| A0538 | `/api/public/candidate/session/me` | middleware-public (own auth in handler) |
| A0539 | `/api/public/candidate/session/offer` | middleware-public (own auth in handler) |
| A0540 | `/api/public/candidate/session/offer/pdf` | middleware-public (own auth in handler) |
| A0541 | `/api/public/candidate/session/tasks` | middleware-public (own auth in handler) |
| A0542 | `/api/public/candidate/session/tasks/[taskId]` | middleware-public (own auth in handler) |
| A0543 | `/api/public/candidate/session/tasks/[taskId]/files` | middleware-public (own auth in handler) |
| A0544 | `/api/public/candidate/session/tasks/[taskId]/identity/[docKey]` | middleware-public (own auth in handler) |
| A0545 | `/api/public/employee/[slug]` | middleware-public (own auth in handler) |
| A0546 | `/api/public/employee/[slug]/forgot-password` | middleware-public (own auth in handler) |
| A0547 | `/api/public/employee/[slug]/login` | middleware-public (own auth in handler) |
| A0548 | `/api/public/employee/[slug]/reset-password` | middleware-public (own auth in handler) |
| A0549 | `/api/public/employee/portal/dashboard` | middleware-public (own auth in handler) |
| A0550 | `/api/public/employee/portal/engagement` | middleware-public (own auth in handler) |
| A0551 | `/api/public/employee/portal/leave-insights` | middleware-public (own auth in handler) |
| A0552 | `/api/public/employee/portal/profile` | middleware-public (own auth in handler) |
| A0553 | `/api/public/employee/portal/resignation` | middleware-public (own auth in handler) |
| A0554 | `/api/public/employee/portal/tasks` | middleware-public (own auth in handler) |
| A0555 | `/api/public/employee/session/change-password` | middleware-public (own auth in handler) |
| A0556 | `/api/public/employee/session/logout` | middleware-public (own auth in handler) |
| A0557 | `/api/public/employee/session/me` | middleware-public (own auth in handler) |
| A0558 | `/api/public/i/[token]` | middleware-public (own auth in handler) |
| A0559 | `/api/public/i/[token]/pdf` | middleware-public (own auth in handler) |
| A0560 | `/api/public/i/[token]/view` | middleware-public (own auth in handler) |
| A0561 | `/api/public/meta-pixel` | middleware-public (own auth in handler) |
| A0562 | `/api/public/platform-otp` | middleware-public (own auth in handler) |
| A0563 | `/api/public/portal/[slug]` | middleware-public (own auth in handler) |
| A0564 | `/api/public/portal/[slug]/request-otp` | middleware-public (own auth in handler) |
| A0565 | `/api/public/portal/[slug]/verify-otp` | middleware-public (own auth in handler) |
| A0566 | `/api/public/portal/session/invoices` | middleware-public (own auth in handler) |
| A0567 | `/api/public/portal/session/logout` | middleware-public (own auth in handler) |
| A0568 | `/api/public/pricing` | middleware-public (own auth in handler) |
| A0569 | `/api/public/rider/[token]` | middleware-public (own auth in handler) |
| A0570 | `/api/public/sales-funnel/lead-prefill` | middleware-public (own auth in handler) |
| A0571 | `/api/public/store/[subdomain]` | middleware-public (own auth in handler) |
| A0572 | `/api/public/store/[subdomain]/account` | middleware-public (own auth in handler) |
| A0573 | `/api/public/store/[subdomain]/enquiries` | middleware-public (own auth in handler) |
| A0574 | `/api/public/store/[subdomain]/favorites` | middleware-public (own auth in handler) |
| A0575 | `/api/public/store/[subdomain]/items` | middleware-public (own auth in handler) |
| A0576 | `/api/public/store/[subdomain]/items/[id]` | middleware-public (own auth in handler) |
| A0577 | `/api/public/store/[subdomain]/orders` | middleware-public (own auth in handler) |
| A0578 | `/api/public/store/[subdomain]/orders/[id]/return` | middleware-public (own auth in handler) |
| A0579 | `/api/public/store/[subdomain]/otp` | middleware-public (own auth in handler) |
| A0580 | `/api/public/store/[subdomain]/quote` | middleware-public (own auth in handler) |
| A0581 | `/api/public/store/[subdomain]/ratings` | middleware-public (own auth in handler) |
| A0582 | `/api/public/wa-shop/[token]` | middleware-public (own auth in handler) |
| A0583 | `/api/public/wa-shop/image/[itemId]` | middleware-public (own auth in handler) |
| A0757 | `/api/signup` | middleware-public |
| A0759 | `/api/staff-app/challenge` | middleware-public (own auth in handler) |
| A0760 | `/api/staff-app/face/enroll` | middleware-public (own auth in handler) |
| A0761 | `/api/staff-app/pair` | middleware-public (own auth in handler) |
| A0762 | `/api/staff-app/punch` | middleware-public (own auth in handler) |
| A0763 | `/api/staff-app/status` | middleware-public (own auth in handler) |
| A0869 | `/api/webhooks/meta-whatsapp` | middleware-public (provider signature expected in handler) |
| A0870 | `/api/webhooks/platform-billing/easebuzz` | middleware-public (provider signature expected in handler) |
| A0871 | `/api/webhooks/platform-billing/razorpay` | middleware-public (provider signature expected in handler) |
| A0872 | `/api/webhooks/store/easebuzz` | middleware-public (provider signature expected in handler) |
| A0873 | `/api/webhooks/store/razorpay` | middleware-public (provider signature expected in handler) |
| A0874 | `/api/webhooks/store/shiprocket` | middleware-public (provider signature expected in handler) |

Count: 106.

## Handlers with no detected HTTP method

| ID | URL | File |
| --- | --- | --- |
| — | — | — |

## Requirements that are missing

- No single functional specification covers all 385 pages.
- Posted-document correction rules exist in project guardrails (reversal, period lock, GST period lock) but were not mapped per screen.
- Button-level RBAC is not in the route table.
- COGS on invoice ledger posting is passed as 0 in `createInvoiceInTransaction`. Whether that is intentional was not confirmed.
- `POST /api/invoices` may differ from the offline replay helper (drafts, proforma, credit limits). The HTTP handler was not fully read.
- Purchase, payment, credit note, and journal side effects were not traced.
- External systems (WhatsApp, Razorpay, PayU, Easebuzz, Shiprocket, email, Google storage) cannot be verified offline.

## Risks

1. **Accounting drift.** Invoice posting touches invoices, lines, stock, payments, customer balance, and ledger in one transaction. UI-only tests will miss a broken ledger.
2. **Tenant isolation.** Client-supplied `business_id` must be ignored. Middleware strips spoofed identity headers; each handler still has to use the session. Coverage of all 947 handlers was not measured here.
3. **Plan vs role.** A path can be in the nav and still be plan-locked, or absent from `plan-path-gate.ts` and still checked inside the handler.
4. **Dynamic routes.** 73 page templates need real ids. Hitting the template path without an id is not a test of the detail page.
5. **False confidence from existing tests.** 367 test files and 24 Playwright specs exist. They were not executed, and most pages have no spec that opens them.
6. **Hidden actions.** 91 app pages yielded no action labels. Those screens are the most likely to be under-tested if a later suite only clicks detected labels.

## What Phase 2 should not assume

- Do not mark a route passed because this inventory lists it.
- Do not invent expected GST totals, stock quantities, or permission matrices.
- Do not run migrations against staging or production. Use `kh_phase2_test` when a scenario needs the database.
