# Route inventory

Generated from the filesystem on 2026-10-19. This is a source inventory, not a test run.

## How to read this

- A **page** is a Next.js `page.tsx` under `app/`. A **route handler** is a `route.ts`.
- **dynamic-template** means the URL contains a `[param]` segment. One template covers many records. Individual customer or invoice IDs are not listed.
- **Plan feature** comes from the longest prefix in `lib/subscription/plan-path-gate.ts`. Empty means that file does not plan-gate the path. The handler may still check a feature.
- **Session class** mirrors `middleware.ts` at a high level. It is not proof that the page or handler authorizes the acting user.
- **Test status** started as `not executed` for every row. That Phase 1 value stays unless a later run actually exercises the route. A later value of `partial` means only the behavior named in `docs/qa/README.md` was executed. It does not mean the page or the whole handler passed.
- **Nav** is whether the path, or a parent path, appears in the desktop sidebar, mobile bottom nav, More menu, sales nav, or HR admin nav. Settings hub links and in-page links are not fully included.

## Counts

| Kind | Count |
| --- | ---: |
| Page templates (`page.tsx`) | 385 |
| Static page templates | 312 |
| Dynamic page templates | 73 |
| Route handlers (`route.ts`) | 947 |
| Dynamic route-handler templates | 293 |
| Pages in the `(app)` group | 298 |
| `(app)` pages absent from primary nav | 12 |

No parallel-route slots (`@folder`) were found under `app/`.

## Pages by module

| Module | Pages |
| --- | ---: |
| Settings | 78 |
| HR | 41 |
| Purchases | 35 |
| Platform admin | 28 |
| Reports | 28 |
| Sales | 28 |
| Accounting | 25 |
| Connect | 18 |
| Tools | 17 |
| Public business portal | 15 |
| Inventory | 13 |
| Online store | 11 |
| Other | 10 |
| Marketing | 9 |
| Partner portal | 9 |
| Parties | 5 |
| Attendance kiosk | 2 |
| Auth | 2 |
| Public payment | 2 |
| App shell | 1 |
| Customer invoice link | 1 |
| Customer portal | 1 |
| Dashboard | 1 |
| Navigation | 1 |
| Notifications | 1 |
| Rider link | 1 |
| Shipment tracking | 1 |
| WhatsApp shop | 1 |

## Pages

| ID | URL | Kind | Module | Route group | Session | Plan feature | Nav | Dynamic params | Query params seen in source | Test status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P001 | `/[slug]/candidates` | dynamic-template | Public business portal | public-business | business user session | — | not-in-primary-nav | slug | — | not executed |
| P002 | `/[slug]/candidates/tasks/[taskId]` | dynamic-template | Public business portal | public-business | business user session | — | not-in-primary-nav | slug, taskId | — | not executed |
| P003 | `/[slug]/employees` | dynamic-template | Public business portal | public-business | employee self-service (portal cookie) | — | not-in-primary-nav | slug | — | not executed |
| P004 | `/[slug]/employees/attendance` | dynamic-template | Public business portal | public-business | employee self-service (portal cookie) | — | not-in-primary-nav | slug | — | not executed |
| P005 | `/[slug]/employees/engagement` | dynamic-template | Public business portal | public-business | employee self-service (portal cookie) | — | not-in-primary-nav | slug | — | not executed |
| P006 | `/[slug]/employees/expenses` | dynamic-template | Public business portal | public-business | employee self-service (portal cookie) | — | not-in-primary-nav | slug | — | not executed |
| P007 | `/[slug]/employees/kiosk` | dynamic-template | Public business portal | public-business | employee self-service (portal cookie) | — | not-in-primary-nav | slug | — | not executed |
| P008 | `/[slug]/employees/leaves` | dynamic-template | Public business portal | public-business | employee self-service (portal cookie) | — | not-in-primary-nav | slug | tab | not executed |
| P009 | `/[slug]/employees/leaves/new` | dynamic-template | Public business portal | public-business | employee self-service (portal cookie) | — | not-in-primary-nav | slug | — | not executed |
| P010 | `/[slug]/employees/overtime/new` | dynamic-template | Public business portal | public-business | employee self-service (portal cookie) | — | not-in-primary-nav | slug | — | not executed |
| P011 | `/[slug]/employees/payslips` | dynamic-template | Public business portal | public-business | employee self-service (portal cookie) | — | not-in-primary-nav | slug | — | not executed |
| P012 | `/[slug]/employees/profile` | dynamic-template | Public business portal | public-business | employee self-service (portal cookie) | — | not-in-primary-nav | slug | — | not executed |
| P013 | `/[slug]/employees/team` | dynamic-template | Public business portal | public-business | employee self-service (portal cookie) | — | not-in-primary-nav | slug | — | not executed |
| P014 | `/[slug]/employees/team/approvals` | dynamic-template | Public business portal | public-business | employee self-service (portal cookie) | — | not-in-primary-nav | slug | — | not executed |
| P015 | `/[slug]/employees/todo` | dynamic-template | Public business portal | public-business | employee self-service (portal cookie) | — | not-in-primary-nav | slug | — | not executed |
| P016 | `/accounts` | static | Accounting | app | business user session | accounting_chart | primary-nav | — | — | not executed |
| P017 | `/accounts/[id]` | dynamic-template | Accounting | app | business user session | accounting_chart | child-of-nav | id | — | not executed |
| P018 | `/accounts/[id]/edit` | dynamic-template | Accounting | app | business user session | accounting_chart | child-of-nav | id | — | not executed |
| P019 | `/accounts/[id]/reconciliation` | dynamic-template | Accounting | app | business user session | accounting_chart | child-of-nav | id | — | not executed |
| P020 | `/accounts/new` | static | Accounting | app | business user session | accounting_chart | child-of-nav | — | — | not executed |
| P021 | `/activity-logs` | static | Settings | app | business user session | — | primary-nav | — | — | not executed |
| P022 | `/admin` | static | Platform admin | root | platform-admin session | — | not-in-primary-nav | — | — | not executed |
| P023 | `/admin/assistant` | static | Platform admin | root | platform-admin session | — | not-in-primary-nav | — | — | not executed |
| P024 | `/admin/billing` | static | Platform admin | root | platform-admin session | — | not-in-primary-nav | — | — | not executed |
| P025 | `/admin/blog` | static | Platform admin | root | platform-admin session | — | not-in-primary-nav | — | — | not executed |
| P026 | `/admin/blog/[id]` | dynamic-template | Platform admin | root | platform-admin session | — | not-in-primary-nav | id | — | not executed |
| P027 | `/admin/blog/[id]/preview` | dynamic-template | Platform admin | root | platform-admin session | — | not-in-primary-nav | id | — | not executed |
| P028 | `/admin/blog/new` | static | Platform admin | root | platform-admin session | — | not-in-primary-nav | — | — | not executed |
| P029 | `/admin/bookings` | static | Platform admin | root | platform-admin session | — | not-in-primary-nav | — | — | not executed |
| P030 | `/admin/bookings/[id]` | dynamic-template | Platform admin | root | platform-admin session | — | not-in-primary-nav | id | — | not executed |
| P031 | `/admin/bookings/time-slots` | static | Platform admin | root | platform-admin session | — | not-in-primary-nav | — | — | not executed |
| P032 | `/admin/businesses` | static | Platform admin | root | platform-admin session | — | not-in-primary-nav | — | — | not executed |
| P033 | `/admin/businesses/[id]` | dynamic-template | Platform admin | root | platform-admin session | — | not-in-primary-nav | id | — | not executed |
| P034 | `/admin/hsn-codes` | static | Platform admin | root | platform-admin session | — | not-in-primary-nav | — | — | not executed |
| P035 | `/admin/login` | static | Platform admin | root | platform-admin session | — | not-in-primary-nav | — | — | not executed |
| P036 | `/admin/partners` | static | Platform admin | root | platform-admin session | — | not-in-primary-nav | — | — | not executed |
| P037 | `/admin/partners/[id]` | dynamic-template | Platform admin | root | platform-admin session | — | not-in-primary-nav | id | — | not executed |
| P038 | `/admin/plans` | static | Platform admin | root | platform-admin session | — | not-in-primary-nav | — | — | not executed |
| P039 | `/admin/policies` | static | Platform admin | root | platform-admin session | — | not-in-primary-nav | — | — | not executed |
| P040 | `/admin/releases` | static | Platform admin | root | platform-admin session | — | not-in-primary-nav | — | — | not executed |
| P041 | `/admin/reports` | static | Platform admin | root | platform-admin session | — | not-in-primary-nav | — | — | not executed |
| P042 | `/admin/sales-flow` | static | Platform admin | root | platform-admin session | — | not-in-primary-nav | — | — | not executed |
| P043 | `/admin/settings` | static | Platform admin | root | platform-admin session | — | not-in-primary-nav | — | — | not executed |
| P044 | `/admin/site-builder` | static | Platform admin | root | platform-admin session | — | not-in-primary-nav | — | — | not executed |
| P045 | `/admin/site-builder/preview` | static | Platform admin | root | platform-admin session | — | not-in-primary-nav | — | product | not executed |
| P046 | `/admin/social` | static | Platform admin | root | platform-admin session | — | not-in-primary-nav | — | — | not executed |
| P047 | `/admin/subscriptions` | static | Platform admin | root | platform-admin session | — | not-in-primary-nav | — | — | not executed |
| P048 | `/admin/users` | static | Platform admin | root | platform-admin session | — | not-in-primary-nav | — | — | not executed |
| P049 | `/admin/videos` | static | Platform admin | root | platform-admin session | — | not-in-primary-nav | — | — | not executed |
| P050 | `/advances` | static | Other | app | business user session | — | primary-nav | — | — | not executed |
| P051 | `/attendance/kiosk` | static | Attendance kiosk | root | public | — | not-in-primary-nav | — | — | not executed |
| P052 | `/attendance/login` | static | Attendance kiosk | root | public | — | not-in-primary-nav | — | — | not executed |
| P053 | `/auth/impersonate` | static | Other | root | public | — | not-in-primary-nav | — | token | not executed |
| P054 | `/bank/import` | static | Accounting | app | business user session | accounting_bank | primary-nav | — | — | not executed |
| P055 | `/bank/reconciliation` | static | Accounting | app | business user session | accounting_bank | primary-nav | — | bank_statement_id | not executed |
| P056 | `/blog` | static | Marketing | root | public | — | not-in-primary-nav | — | — | not executed |
| P057 | `/blog/[slug]` | dynamic-template | Marketing | root | public | — | not-in-primary-nav | slug | — | not executed |
| P058 | `/blog/category/[slug]` | dynamic-template | Marketing | root | public | — | not-in-primary-nav | slug | — | not executed |
| P059 | `/book-demo` | static | Marketing | root | public | — | not-in-primary-nav | — | — | not executed |
| P060 | `/connect/whatsapp` | static | Connect | app | business user session | — | not-in-primary-nav | — | — | not executed |
| P061 | `/contra` | static | Accounting | app | business user session | — | primary-nav | — | — | not executed |
| P062 | `/credit-approvals` | static | Accounting | app | business user session | accounting_credit_approvals | not-in-primary-nav | — | — | not executed |
| P063 | `/credit-notes` | static | Sales | app | business user session | sales_credit_notes | primary-nav | — | — | not executed |
| P064 | `/credit-notes/[id]` | dynamic-template | Sales | app | business user session | sales_credit_notes | child-of-nav | id | — | not executed |
| P065 | `/credit-notes/new` | static | Sales | app | business user session | sales_credit_notes | child-of-nav | — | — | not executed |
| P066 | `/customers` | static | Parties | app | business user session | — | primary-nav | — | tab | not executed |
| P067 | `/customers/[id]` | dynamic-template | Parties | app | business user session | — | child-of-nav | id | — | not executed |
| P068 | `/customers/[id]/edit` | dynamic-template | Parties | app | business user session | — | child-of-nav | id | — | not executed |
| P069 | `/customers/[id]/statement` | dynamic-template | Parties | app | business user session | — | child-of-nav | id | — | not executed |
| P070 | `/customers/new` | static | Parties | app | business user session | — | child-of-nav | — | — | partial — staging browser saved one Karnataka customer whose name starts with `P3QB`. Other fields on the form were not checked. See `phase-3q-browser-functional-results.md` |
| P071 | `/dashboard` | static | Dashboard | app | business user session | — | not-in-primary-nav | — | — | not executed |
| P072 | `/debit-notes` | static | Sales | app | business user session | sales_debit_notes | primary-nav | — | — | not executed |
| P073 | `/debit-notes/[id]` | dynamic-template | Sales | app | business user session | sales_debit_notes | child-of-nav | id | — | not executed |
| P074 | `/debit-notes/new` | static | Sales | app | business user session | sales_debit_notes | child-of-nav | — | — | not executed |
| P075 | `/debug/dashboard-refresh` | static | Other | app | business user session | — | not-in-primary-nav | — | — | not executed |
| P076 | `/debug/sqlite` | static | Other | app | business user session | — | not-in-primary-nav | — | — | not executed |
| P077 | `/debug/webview` | static | Other | app | business user session | — | not-in-primary-nav | — | — | not executed |
| P078 | `/delivery-challans` | static | Sales | app | business user session | sales_delivery_challans | primary-nav | — | — | not executed |
| P079 | `/delivery-challans/[id]` | dynamic-template | Sales | app | business user session | sales_delivery_challans | child-of-nav | id | — | not executed |
| P080 | `/delivery-challans/edit/[id]` | dynamic-template | Sales | app | business user session | sales_delivery_challans | child-of-nav | id | — | not executed |
| P081 | `/delivery-challans/new` | static | Sales | app | business user session | sales_delivery_challans | child-of-nav | — | — | not executed |
| P082 | `/employees` | static | HR | app | business user session | hr_employees | primary-nav | — | — | not executed |
| P083 | `/employees/[id]` | dynamic-template | HR | app | business user session | hr_employees | child-of-nav | id | — | not executed |
| P084 | `/employees/[id]/edit` | dynamic-template | HR | app | business user session | hr_employees | child-of-nav | id | — | not executed |
| P085 | `/employees/attendance` | static | HR | app | business user session | hr_attendance | primary-nav | — | — | not executed |
| P086 | `/employees/attendance/mark` | static | HR | app | business user session | hr_attendance | child-of-nav | — | — | not executed |
| P087 | `/employees/attendance/mark/advanced` | static | HR | app | business user session | hr_attendance | child-of-nav | — | — | not executed |
| P088 | `/employees/commissions` | static | HR | app | business user session | hr_commissions | primary-nav | — | — | not executed |
| P089 | `/employees/expenses` | static | HR | app | business user session | hr_commissions | primary-nav | — | — | not executed |
| P090 | `/employees/expenses/new` | static | HR | app | business user session | hr_commissions | child-of-nav | — | — | not executed |
| P091 | `/employees/leaves` | static | HR | app | business user session | hr_leaves | primary-nav | — | — | not executed |
| P092 | `/employees/leaves/calendar` | static | HR | app | business user session | hr_leaves | primary-nav | — | — | not executed |
| P093 | `/employees/leaves/new` | static | HR | app | business user session | hr_leaves | child-of-nav | — | — | not executed |
| P094 | `/employees/manager` | static | HR | app | business user session | hr_leaves | primary-nav | — | — | not executed |
| P095 | `/employees/manager/approvals` | static | HR | app | business user session | hr_leaves | child-of-nav | — | — | not executed |
| P096 | `/employees/manager/attendance` | static | HR | app | business user session | hr_leaves | child-of-nav | — | — | not executed |
| P097 | `/employees/manager/team` | static | HR | app | business user session | hr_leaves | child-of-nav | — | — | not executed |
| P098 | `/employees/new` | static | HR | app | business user session | hr_employees | primary-nav | — | — | not executed |
| P099 | `/employees/org-chart` | static | HR | app | business user session | hr_advanced | primary-nav | — | — | not executed |
| P100 | `/employees/performance` | static | HR | app | business user session | hr_advanced | primary-nav | — | — | not executed |
| P101 | `/employees/recruitment` | static | HR | app | business user session | hr_recruitment | primary-nav | — | — | not executed |
| P102 | `/employees/recruitment/candidates/[id]` | dynamic-template | HR | app | business user session | hr_recruitment | child-of-nav | id | — | not executed |
| P103 | `/employees/recruitment/candidates/[id]/tasks/[taskId]` | dynamic-template | HR | app | business user session | hr_recruitment | child-of-nav | id, taskId | — | not executed |
| P104 | `/employees/recruitment/jobs/[id]` | dynamic-template | HR | app | business user session | hr_recruitment | child-of-nav | id | — | not executed |
| P105 | `/employees/recruitment/jobs/new` | static | HR | app | business user session | hr_recruitment | child-of-nav | — | — | not executed |
| P106 | `/employees/salary/advances` | static | HR | app | business user session | hr_payroll | primary-nav | — | — | not executed |
| P107 | `/employees/salary/advances/new` | static | HR | app | business user session | hr_payroll | child-of-nav | — | — | not executed |
| P108 | `/employees/salary/payments` | static | HR | app | business user session | hr_payroll | primary-nav | — | — | not executed |
| P109 | `/employees/salary/payments/new` | static | HR | app | business user session | hr_payroll | child-of-nav | — | — | not executed |
| P110 | `/employees/salary/payslips/[id]` | dynamic-template | HR | app | business user session | hr_payroll | child-of-nav | id | — | not executed |
| P111 | `/employees/targets` | static | HR | app | business user session | hr_advanced | child-of-nav | — | — | not executed |
| P112 | `/employees/tasks` | static | HR | app | business user session | hr_advanced | primary-nav | — | — | not executed |
| P113 | `/employees/tasks/new` | static | HR | app | business user session | hr_advanced | child-of-nav | — | — | not executed |
| P114 | `/estimates` | static | Sales | app | business user session | sales_estimates | primary-nav | — | select | not executed |
| P115 | `/expenses` | static | Purchases | app | business user session | purchase_expenses | primary-nav | — | — | not executed |
| P116 | `/expenses/categories` | static | Purchases | app | business user session | purchase_expenses | child-of-nav | — | — | not executed |
| P117 | `/expenses/new` | static | Purchases | app | business user session | purchase_expenses | child-of-nav | — | — | not executed |
| P118 | `/fixed-assets` | static | Accounting | app | business user session | — | primary-nav | — | — | not executed |
| P119 | `/guides` | static | Marketing | root | public | — | not-in-primary-nav | — | — | not executed |
| P120 | `/hr/dashboard` | static | HR | app | business user session | hr_advanced | primary-nav | — | — | not executed |
| P121 | `/hr/documents` | static | HR | app | business user session | hr_advanced | primary-nav | — | — | not executed |
| P122 | `/hr/engagement` | static | HR | app | business user session | hr_advanced | primary-nav | — | — | not executed |
| P123 | `/hr/exits` | static | HR | app | business user session | hr_advanced | primary-nav | — | — | not executed |
| P124 | `/hr/leaves/import-balances` | static | HR | app | business user session | hr_leaves | primary-nav | — | — | not executed |
| P125 | `/hr/leaves/year-end` | static | HR | app | business user session | hr_leaves | primary-nav | — | — | not executed |
| P126 | `/hr/reports` | static | HR | app | business user session | hr_advanced | primary-nav | — | — | not executed |
| P127 | `/hr/shifts/bulk-assign` | static | HR | app | business user session | hr_shifts | primary-nav | — | — | not executed |
| P128 | `/hr/shifts/roster` | static | HR | app | business user session | hr_shifts | primary-nav | — | — | not executed |
| P129 | `/i/[token]` | dynamic-template | Customer invoice link | customer | public customer surface (token or portal session) | — | not-in-primary-nav | token | — | not executed |
| P130 | `/inventory-adjustments` | static | Inventory | app | business user session | purchase_inventory_adjustments | primary-nav | — | — | not executed |
| P131 | `/inventory-adjustments/[id]` | dynamic-template | Inventory | app | business user session | purchase_inventory_adjustments | child-of-nav | id | — | not executed |
| P132 | `/inventory-adjustments/new` | static | Inventory | app | business user session | purchase_inventory_adjustments | child-of-nav | — | item_id | not executed |
| P133 | `/invoices` | static | Sales | app | business user session | sales_invoices | primary-nav | — | status, channel, branch_id | not executed |
| P134 | `/invoices/[id]` | dynamic-template | Sales | app | business user session | sales_invoices | child-of-nav | id | — | not executed |
| P135 | `/invoices/[id]/edit` | dynamic-template | Sales | app | business user session | sales_invoices | child-of-nav | id | — | not executed |
| P136 | `/invoices/[id]/view` | dynamic-template | Sales | app | business user session | sales_invoices | child-of-nav | id | from, supply_order_id | not executed |
| P137 | `/invoices/mock` | static | Sales | app | business user session | sales_invoices | child-of-nav | — | — | not executed |
| P138 | `/invoices/new` | static | Sales | app | business user session | sales_invoices | child-of-nav | — | type, work_order_id, supply_order_id, edit, customer_id, item_id, qty, convert_from | partial — staging browser: empty Generate showed “Add items”; one final invoice INV-072 showed CGST + SGST and 118.00. The list and a reopen from the list were not opened. See `phase-3q-browser-functional-results.md` |
| P139 | `/invoices/recurring` | static | Sales | app | business user session | sales_recurring_invoices | child-of-nav | — | — | not executed |
| P140 | `/invoices/whatsapp` | static | Sales | app | business user session | sales_invoices | child-of-nav | — | — | not executed |
| P141 | `/items` | static | Inventory | app | business user session | — | primary-nav | — | stock, filter | partial — list and one confirmed delete on kh_phase2_test; other controls not executed |
| P142 | `/items/[id]` | dynamic-template | Inventory | app | business user session | — | child-of-nav | id | — | not executed |
| P143 | `/items/barcodes` | static | Inventory | app | business user session | — | primary-nav | — | — | not executed |
| P144 | `/items/categories` | static | Inventory | app | business user session | — | child-of-nav | — | — | not executed |
| P145 | `/items/new` | static | Inventory | app | business user session | — | child-of-nav | — | edit | partial — staging browser saved service `P3QB202610200040 Service` at price 100 and tax 18. Other item fields were not checked. See `phase-3q-browser-functional-results.md` |
| P146 | `/journal-entries` | static | Accounting | app | business user session | advanced_ledger | primary-nav | — | — | not executed |
| P147 | `/journal-entries/[id]` | dynamic-template | Accounting | app | business user session | advanced_ledger | child-of-nav | id | — | not executed |
| P148 | `/journal-entries/new` | static | Accounting | app | business user session | advanced_ledger | child-of-nav | — | — | not executed |
| P149 | `/journal-entries/templates` | static | Accounting | app | business user session | advanced_ledger | child-of-nav | — | — | not executed |
| P150 | `/ledger` | static | Accounting | app | business user session | advanced_ledger | primary-nav | — | — | not executed |
| P151 | `/ledger/account/[id]` | dynamic-template | Accounting | app | business user session | advanced_ledger | child-of-nav | id | — | not executed |
| P152 | `/login` | static | Auth | root | public | — | not-in-primary-nav | — | redirect | partial — staging sign-in reached the dashboard for Shalini Traders. A later attempt showed “Too many login attempts.” See `phase-3q-browser-functional-results.md` |
| P153 | `/more` | static | Navigation | app | business user session | — | primary-nav | — | — | not executed |
| P154 | `/notifications` | static | Notifications | app | business user session | — | not-in-primary-nav | — | — | not executed |
| P155 | `/offline` | static | App shell | root | public | — | not-in-primary-nav | — | — | not executed |
| P156 | `/opening-balances/setup` | static | Other | app | business user session | — | not-in-primary-nav | — | — | not executed |
| P157 | `/orders` | static | Sales | app | business user session | — | primary-nav | — | — | not executed |
| P158 | `/page.tsx` | static | Other | root | business user session | — | not-in-primary-nav | — | product | not executed |
| P159 | `/partners` | static | Partner portal | root | partner session | — | not-in-primary-nav | — | — | not executed |
| P160 | `/partners/deals` | static | Partner portal | root | partner session | — | not-in-primary-nav | — | — | not executed |
| P161 | `/partners/earnings` | static | Partner portal | root | partner session | — | not-in-primary-nav | — | — | not executed |
| P162 | `/partners/kit` | static | Partner portal | root | partner session | — | not-in-primary-nav | — | — | not executed |
| P163 | `/partners/link` | static | Partner portal | root | partner session | — | not-in-primary-nav | — | — | not executed |
| P164 | `/partners/login` | static | Partner portal | root | partner session | — | not-in-primary-nav | — | — | not executed |
| P165 | `/partners/payouts` | static | Partner portal | root | partner session | — | not-in-primary-nav | — | — | not executed |
| P166 | `/partners/profile` | static | Partner portal | root | partner session | — | not-in-primary-nav | — | — | not executed |
| P167 | `/partners/team` | static | Partner portal | root | partner session | — | not-in-primary-nav | — | — | not executed |
| P168 | `/pay/complete` | static | Public payment | root | public | — | not-in-primary-nav | — | — | not executed |
| P169 | `/pay/upi/[token]` | dynamic-template | Public payment | root | public token or payment | — | not-in-primary-nav | token | — | not executed |
| P170 | `/payments/in` | static | Accounting | app | business user session | — | primary-nav | — | — | not executed |
| P171 | `/payments/out` | static | Accounting | app | business user session | — | primary-nav | — | — | not executed |
| P172 | `/payments/reconciliation` | static | Accounting | app | business user session | — | primary-nav | — | — | not executed |
| P173 | `/portal/[slug]` | dynamic-template | Customer portal | customer | public customer surface (token or portal session) | — | not-in-primary-nav | slug | — | not executed |
| P174 | `/pricing/party-item` | static | Inventory | app | business user session | party_pricing | primary-nav | — | — | not executed |
| P175 | `/print/document` | static | Other | root | business user session | — | not-in-primary-nav | — | — | not executed |
| P176 | `/privacy` | static | Marketing | root | public | — | primary-nav | — | — | not executed |
| P177 | `/provisions` | static | Accounting | app | business user session | accounting_provisions | primary-nav | — | — | not executed |
| P178 | `/purchase-orders` | static | Purchases | app | business user session | purchase_orders | primary-nav | — | id | not executed |
| P179 | `/purchase-orders/[id]` | dynamic-template | Purchases | app | business user session | purchase_orders | child-of-nav | id | — | not executed |
| P180 | `/purchase-orders/new` | static | Purchases | app | business user session | purchase_orders | child-of-nav | — | supplier_id, item_id, qty | not executed |
| P181 | `/purchase-returns` | static | Purchases | app | business user session | purchase_management | primary-nav | — | — | not executed |
| P182 | `/purchase-returns/[id]` | dynamic-template | Purchases | app | business user session | purchase_management | child-of-nav | id | — | not executed |
| P183 | `/purchase-returns/new` | static | Purchases | app | business user session | purchase_management | child-of-nav | — | — | not executed |
| P184 | `/purchases` | static | Purchases | app | business user session | purchase_management | primary-nav | — | — | not executed |
| P185 | `/purchases/[id]` | dynamic-template | Purchases | app | business user session | purchase_management | child-of-nav | id | — | not executed |
| P186 | `/purchases/categories` | static | Purchases | app | business user session | purchase_management | child-of-nav | — | — | not executed |
| P187 | `/purchases/incoming` | static | Purchases | app | business user session | purchase_management | primary-nav | — | — | not executed |
| P188 | `/purchases/incoming/[invoiceId]` | dynamic-template | Purchases | app | business user session | purchase_management | child-of-nav | invoiceId | — | not executed |
| P189 | `/purchases/new` | static | Purchases | app | business user session | purchase_management | child-of-nav | — | — | not executed |
| P190 | `/purchases/new-arrivals` | static | Purchases | app | business user session | purchase_management | primary-nav | — | — | not executed |
| P191 | `/purchases/new/select-item` | static | Purchases | app | business user session | purchase_management | child-of-nav | — | kind, returnTo, warehouse_id | not executed |
| P192 | `/purchases/requests` | static | Purchases | app | business user session | purchase_management | primary-nav | — | — | not executed |
| P193 | `/purchases/scan-record` | static | Purchases | app | business user session | purchase_management | child-of-nav | — | returnTo | not executed |
| P194 | `/r/[token]` | dynamic-template | Rider link | customer | public customer surface (token or portal session) | — | not-in-primary-nav | token | — | not executed |
| P195 | `/recurring-invoices` | static | Sales | app | business user session | sales_recurring_invoices | primary-nav | — | — | not executed |
| P196 | `/reports` | static | Reports | app | business user session | reports_basic | primary-nav | — | — | not executed |
| P197 | `/reports/aging/payables` | static | Reports | app | business user session | reports_advanced | primary-nav | — | — | not executed |
| P198 | `/reports/aging/receivables` | static | Reports | app | business user session | reports_advanced | primary-nav | — | — | not executed |
| P199 | `/reports/balance-sheet` | static | Reports | app | business user session | reports_advanced | primary-nav | — | — | not executed |
| P200 | `/reports/builder` | static | Reports | app | business user session | reports_basic | primary-nav | — | — | not executed |
| P201 | `/reports/cash-flow` | static | Reports | app | business user session | reports_advanced | primary-nav | — | — | not executed |
| P202 | `/reports/credit-risk` | static | Reports | app | business user session | reports_basic | primary-nav | — | — | not executed |
| P203 | `/reports/deleted` | static | Reports | app | business user session | reports_basic | primary-nav | — | — | not executed |
| P204 | `/reports/gst/cash-ledger` | static | Reports | app | business user session | reports_gst | primary-nav | — | — | not executed |
| P205 | `/reports/gst/compliance` | static | Reports | app | business user session | reports_gst | primary-nav | — | — | not executed |
| P206 | `/reports/gst/gstr1` | static | Reports | app | business user session | reports_gst | primary-nav | — | — | not executed |
| P207 | `/reports/gst/gstr2b` | static | Reports | app | business user session | reports_gst | primary-nav | — | — | not executed |
| P208 | `/reports/gst/gstr2b-reconciliation` | static | Reports | app | business user session | reports_gst | primary-nav | — | — | not executed |
| P209 | `/reports/gst/gstr3b` | static | Reports | app | business user session | reports_gst | primary-nav | — | — | not executed |
| P210 | `/reports/gst/gstr9` | static | Reports | app | business user session | reports_gst | primary-nav | — | — | not executed |
| P211 | `/reports/gst/reconciliation` | static | Reports | app | business user session | reports_gst | primary-nav | — | period, mode, branch_id, view | not executed |
| P212 | `/reports/inter-branch-reconciliation` | static | Reports | app | business user session | reports_basic | child-of-nav | — | — | not executed |
| P213 | `/reports/label-print-log` | static | Reports | app | business user session | reports_basic | primary-nav | — | — | not executed |
| P214 | `/reports/profit-by-invoice` | static | Reports | app | business user session | reports_basic | child-of-nav | — | — | not executed |
| P215 | `/reports/profit-loss` | static | Reports | app | business user session | reports_advanced | primary-nav | — | — | not executed |
| P216 | `/reports/profit-loss/validation` | static | Reports | app | business user session | reports_advanced | child-of-nav | — | — | not executed |
| P217 | `/reports/purchase/[reportType]` | dynamic-template | Reports | app | business user session | reports_basic | child-of-nav | reportType | — | not executed |
| P218 | `/reports/sales/[reportType]` | dynamic-template | Reports | app | business user session | reports_basic | child-of-nav | reportType | — | not executed |
| P219 | `/reports/stock/closing-stock` | static | Reports | app | business user session | reports_basic | primary-nav | — | — | not executed |
| P220 | `/reports/stock/fifo-lots` | static | Reports | app | business user session | reports_basic | child-of-nav | — | — | not executed |
| P221 | `/reports/stock/summary` | static | Reports | app | business user session | reports_basic | primary-nav | — | — | not executed |
| P222 | `/reports/stock/valuation` | static | Reports | app | business user session | reports_basic | primary-nav | — | warehouse_id, location_id | not executed |
| P223 | `/reports/trial-balance` | static | Reports | app | business user session | reports_advanced | primary-nav | — | — | not executed |
| P224 | `/sales-orders` | static | Sales | app | business user session | sales_sales_orders | primary-nav | — | — | not executed |
| P225 | `/sales-orders/[id]` | dynamic-template | Sales | app | business user session | sales_sales_orders | child-of-nav | id | — | not executed |
| P226 | `/sales-orders/new` | static | Sales | app | business user session | sales_sales_orders | child-of-nav | — | edit, convert_from, customer_id, item_id, qty | not executed |
| P227 | `/search` | static | Other | app | business user session | — | primary-nav | — | q | not executed |
| P228 | `/settings` | static | Settings | app | business user session | — | primary-nav | — | — | not executed |
| P229 | `/settings/account-mappings` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P230 | `/settings/activity` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P231 | `/settings/ai-agent` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P232 | `/settings/ai-assistant` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P233 | `/settings/ai-config` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P234 | `/settings/attendance-policy` | static | Settings | app | business user session | hr_staff_app | child-of-nav | — | — | not executed |
| P235 | `/settings/attendance-regularization` | static | Settings | app | business user session | hr_shifts | child-of-nav | — | — | not executed |
| P236 | `/settings/automation` | static | Settings | app | business user session | workflow_automation | child-of-nav | — | — | not executed |
| P237 | `/settings/backup` | static | Settings | app | business user session | settings_backup | child-of-nav | — | — | not executed |
| P238 | `/settings/bluetooth-printer` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P239 | `/settings/bluetooth-printer/diagnostics` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P240 | `/settings/branches` | static | Settings | app | business user session | settings_multi_branch | child-of-nav | — | — | not executed |
| P241 | `/settings/branches/[id]/edit` | dynamic-template | Settings | app | business user session | settings_multi_branch | child-of-nav | id | — | not executed |
| P242 | `/settings/branches/new` | static | Settings | app | business user session | settings_multi_branch | child-of-nav | — | — | not executed |
| P243 | `/settings/business` | static | Settings | app | business user session | — | child-of-nav | — | highlight, business_profile_tour | not executed |
| P244 | `/settings/commission-rules` | static | Settings | app | business user session | hr_commissions | child-of-nav | — | — | not executed |
| P245 | `/settings/custom-fields` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P246 | `/settings/departments` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P247 | `/settings/email` | static | Settings | app | business user session | integration_email | child-of-nav | — | — | not executed |
| P248 | `/settings/employee-portal` | static | Settings | app | business user session | hr_employee_portal | child-of-nav | — | — | not executed |
| P249 | `/settings/export` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P250 | `/settings/features` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P251 | `/settings/financial-years` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P252 | `/settings/gst-config` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P253 | `/settings/help` | static | Settings | app | business user session | — | primary-nav | — | — | not executed |
| P254 | `/settings/help/how-to` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P255 | `/settings/hiring` | static | Settings | app | business user session | hr_recruitment | child-of-nav | — | — | not executed |
| P256 | `/settings/holiday-lists` | static | Settings | app | business user session | hr_shifts | child-of-nav | — | — | not executed |
| P257 | `/settings/holidays` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P258 | `/settings/hr-approval` | static | Settings | app | business user session | hr_leaves | child-of-nav | — | — | not executed |
| P259 | `/settings/hr-employee` | static | Settings | app | business user session | hr_advanced | child-of-nav | — | — | not executed |
| P260 | `/settings/hr-exit` | static | Settings | app | business user session | hr_advanced | child-of-nav | — | — | not executed |
| P261 | `/settings/integrations` | static | Settings | app | business user session | — | child-of-nav | — | category | not executed |
| P262 | `/settings/invoice` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P263 | `/settings/label-templates` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P264 | `/settings/label-templates/[id]` | dynamic-template | Settings | app | business user session | — | child-of-nav | id | — | not executed |
| P265 | `/settings/label-templates/new` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P266 | `/settings/leave-plan` | static | Settings | app | business user session | hr_leaves | child-of-nav | — | — | not executed |
| P267 | `/settings/leave-types` | static | Settings | app | business user session | hr_leaves | child-of-nav | — | — | not executed |
| P268 | `/settings/number-series` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P269 | `/settings/offer-letter` | static | Settings | app | business user session | hr_recruitment | child-of-nav | — | — | not executed |
| P270 | `/settings/offline-sync` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P271 | `/settings/onboarding-templates` | static | Settings | app | business user session | hr_recruitment | child-of-nav | — | tab | not executed |
| P272 | `/settings/online-store` | static | Settings | app | business user session | advanced_online_store | child-of-nav | — | — | not executed |
| P273 | `/settings/online-store/enquiries` | static | Settings | app | business user session | advanced_online_store | child-of-nav | — | — | not executed |
| P274 | `/settings/online-store/orders` | static | Settings | app | business user session | advanced_online_store | child-of-nav | — | — | not executed |
| P275 | `/settings/online-store/studio` | static | Settings | app | business user session | advanced_online_store | child-of-nav | — | — | not executed |
| P276 | `/settings/ot-policy` | static | Settings | app | business user session | hr_shifts | child-of-nav | — | — | not executed |
| P277 | `/settings/payments` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P278 | `/settings/payroll` | static | Settings | app | business user session | hr_payroll_setup | child-of-nav | — | — | not executed |
| P279 | `/settings/period-locks` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P280 | `/settings/products` | static | Settings | app | business user session | — | child-of-nav | — | upsell | not executed |
| P281 | `/settings/roles` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P282 | `/settings/salary-components` | static | Settings | app | business user session | hr_payroll_setup | child-of-nav | — | — | not executed |
| P283 | `/settings/shifts` | static | Settings | app | business user session | hr_shifts | child-of-nav | — | — | not executed |
| P284 | `/settings/signature` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P285 | `/settings/subscription` | static | Settings | app | business user session | — | child-of-nav | — | payment, plan | not executed |
| P286 | `/settings/suppliers-directory` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P287 | `/settings/tax` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P288 | `/settings/templates` | static | Settings | app | business user session | settings_template_customization | child-of-nav | — | — | not executed |
| P289 | `/settings/templates/customize` | static | Settings | app | business user session | settings_template_customization | child-of-nav | — | template_id, template_name, document_type | not executed |
| P290 | `/settings/user-branches` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P291 | `/settings/user-management` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P292 | `/settings/user-warehouses` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P293 | `/settings/users` | static | Settings | app | business user session | settings_multi_user | child-of-nav | — | — | not executed |
| P294 | `/settings/warehouses` | static | Settings | app | business user session | settings_multi_warehouse | primary-nav | — | — | not executed |
| P295 | `/settings/warehouses/[id]/edit` | dynamic-template | Settings | app | business user session | settings_multi_warehouse | child-of-nav | id | — | not executed |
| P296 | `/settings/warehouses/new` | static | Settings | app | business user session | settings_multi_warehouse | child-of-nav | — | — | not executed |
| P297 | `/settings/weekly-off` | static | Settings | app | business user session | — | child-of-nav | — | — | not executed |
| P298 | `/settings/whatsapp` | static | Settings | app | business user session | settings_whatsapp | primary-nav | — | — | not executed |
| P299 | `/settings/whatsapp/ai-agent` | static | Settings | app | business user session | settings_whatsapp | child-of-nav | — | — | not executed |
| P300 | `/settings/whatsapp/inbox` | static | Settings | app | business user session | settings_whatsapp | child-of-nav | — | — | not executed |
| P301 | `/settings/whatsapp/notifications` | static | Settings | app | business user session | whatsapp_auto_reminders | child-of-nav | — | — | not executed |
| P302 | `/settings/whatsapp/shop` | static | Settings | app | business user session | settings_whatsapp | child-of-nav | — | — | not executed |
| P303 | `/settings/whatsapp/team` | static | Settings | app | business user session | settings_whatsapp | child-of-nav | — | — | not executed |
| P304 | `/settings/whatsapp/templates` | static | Settings | app | business user session | settings_whatsapp | child-of-nav | — | — | not executed |
| P305 | `/signup` | static | Auth | root | public | — | not-in-primary-nav | — | product, lead, ref | not executed |
| P306 | `/solution/accounting` | static | Marketing | root | public | — | not-in-primary-nav | — | — | not executed |
| P307 | `/solution/inventory` | static | Marketing | root | public | — | not-in-primary-nav | — | — | not executed |
| P308 | `/stock-transfers` | static | Inventory | app | business user session | settings_multi_warehouse | primary-nav | — | — | not executed |
| P309 | `/stock-transfers/[id]` | dynamic-template | Inventory | app | business user session | settings_multi_warehouse | child-of-nav | id | — | not executed |
| P310 | `/stock-transfers/[id]/receive` | dynamic-template | Inventory | app | business user session | settings_multi_warehouse | child-of-nav | id | — | not executed |
| P311 | `/stock-transfers/new` | static | Inventory | app | business user session | settings_multi_warehouse | child-of-nav | — | — | not executed |
| P312 | `/store` | static | Online store | root | public storefront | — | not-in-primary-nav | — | — | not executed |
| P313 | `/store/about` | static | Online store | root | public storefront | — | not-in-primary-nav | — | — | not executed |
| P314 | `/store/account` | static | Online store | root | public storefront | — | not-in-primary-nav | — | — | not executed |
| P315 | `/store/cart` | static | Online store | root | public storefront | — | not-in-primary-nav | — | — | not executed |
| P316 | `/store/checkout` | static | Online store | root | public storefront | — | not-in-primary-nav | — | — | not executed |
| P317 | `/store/contact` | static | Online store | root | public storefront | — | not-in-primary-nav | — | — | not executed |
| P318 | `/store/privacy` | static | Online store | root | public storefront | — | not-in-primary-nav | — | — | not executed |
| P319 | `/store/products/[id]` | dynamic-template | Online store | root | public storefront | — | not-in-primary-nav | id | — | not executed |
| P320 | `/store/refund` | static | Online store | root | public storefront | — | not-in-primary-nav | — | — | not executed |
| P321 | `/store/terms` | static | Online store | root | public storefront | — | not-in-primary-nav | — | — | not executed |
| P322 | `/store/wishlist` | static | Online store | root | public storefront | — | not-in-primary-nav | — | — | not executed |
| P323 | `/suppliers` | static | Purchases | app | business user session | purchase_suppliers | primary-nav | — | — | not executed |
| P324 | `/suppliers/[id]` | dynamic-template | Purchases | app | business user session | purchase_suppliers | child-of-nav | id | — | not executed |
| P325 | `/suppliers/[id]/item-links` | dynamic-template | Purchases | app | business user session | purchase_suppliers | child-of-nav | id | — | not executed |
| P326 | `/suppliers/[id]/items` | dynamic-template | Purchases | app | business user session | purchase_suppliers | child-of-nav | id | — | not executed |
| P327 | `/suppliers/catalog` | static | Purchases | app | business user session | purchase_suppliers | primary-nav | — | — | not executed |
| P328 | `/suppliers/dashboard` | static | Purchases | app | business user session | purchase_suppliers | primary-nav | — | — | not executed |
| P329 | `/suppliers/dashboard/analytics` | static | Purchases | app | business user session | purchase_suppliers | child-of-nav | — | — | not executed |
| P330 | `/suppliers/dashboard/thresholds` | static | Purchases | app | business user session | purchase_suppliers | child-of-nav | — | — | not executed |
| P331 | `/suppliers/hub` | static | Purchases | app | business user session | purchase_suppliers | primary-nav | — | — | not executed |
| P332 | `/suppliers/hub/[businessId]` | dynamic-template | Purchases | app | business user session | purchase_suppliers | child-of-nav | businessId | — | not executed |
| P333 | `/suppliers/hub/find` | static | Purchases | app | business user session | purchase_suppliers | child-of-nav | — | — | not executed |
| P334 | `/suppliers/new` | static | Purchases | app | business user session | purchase_suppliers | child-of-nav | — | — | not executed |
| P335 | `/suppliers/requests` | static | Purchases | app | business user session | purchase_suppliers | primary-nav | — | — | not executed |
| P336 | `/supply-orders` | static | Purchases | app | business user session | — | primary-nav | — | — | not executed |
| P337 | `/supply-orders/[id]` | dynamic-template | Purchases | app | business user session | — | child-of-nav | id | — | not executed |
| P338 | `/supply-orders/new` | static | Purchases | app | business user session | — | child-of-nav | — | — | not executed |
| P339 | `/tds` | static | Accounting | app | business user session | accounting_tds | primary-nav | — | — | not executed |
| P340 | `/tds/categories` | static | Accounting | app | business user session | accounting_tds | child-of-nav | — | — | not executed |
| P341 | `/tds/certificates` | static | Accounting | app | business user session | accounting_tds | child-of-nav | — | — | not executed |
| P342 | `/tds/payments` | static | Accounting | app | business user session | accounting_tds | child-of-nav | — | — | not executed |
| P343 | `/tds/transactions` | static | Accounting | app | business user session | accounting_tds | child-of-nav | — | — | not executed |
| P344 | `/terms` | static | Marketing | root | public | — | not-in-primary-nav | — | — | not executed |
| P345 | `/tools` | static | Tools | app | business user session | — | primary-nav | — | — | not executed |
| P346 | `/tools/currency-converter` | static | Tools | app | business user session | — | primary-nav | — | — | not executed |
| P347 | `/tools/discount-calculator` | static | Tools | app | business user session | — | primary-nav | — | — | not executed |
| P348 | `/tools/emi-calculator` | static | Tools | app | business user session | — | primary-nav | — | — | not executed |
| P349 | `/tools/google-lead-extractor` | static | Tools | app | business user session | — | primary-nav | — | — | not executed |
| P350 | `/tools/gst-calculator` | static | Tools | app | business user session | — | primary-nav | — | — | not executed |
| P351 | `/tools/gstin-validator` | static | Tools | app | business user session | — | primary-nav | — | — | not executed |
| P352 | `/tools/hsn-finder` | static | Tools | app | business user session | — | primary-nav | — | — | not executed |
| P353 | `/tools/image-background-remover` | static | Tools | app | business user session | — | primary-nav | — | — | not executed |
| P354 | `/tools/image-size-reducer` | static | Tools | app | business user session | — | primary-nav | — | — | not executed |
| P355 | `/tools/interest-calculator` | static | Tools | app | business user session | — | primary-nav | — | — | not executed |
| P356 | `/tools/invoice-number-generator` | static | Tools | app | business user session | — | primary-nav | — | — | not executed |
| P357 | `/tools/pan-validator` | static | Tools | app | business user session | — | primary-nav | — | — | not executed |
| P358 | `/tools/price-margin-calculator` | static | Tools | app | business user session | — | primary-nav | — | — | not executed |
| P359 | `/tools/tds-calculator` | static | Tools | app | business user session | — | primary-nav | — | — | not executed |
| P360 | `/tools/todo` | static | Tools | app | business user session | tools_todo | primary-nav | — | — | not executed |
| P361 | `/tools/whatsapp-group-extractor` | static | Tools | app | business user session | — | child-of-nav | — | — | not executed |
| P362 | `/track/[token]` | dynamic-template | Shipment tracking | customer | public customer surface (token or portal session) | — | not-in-primary-nav | token | — | not executed |
| P363 | `/upgrade` | static | Other | app | business user session | — | not-in-primary-nav | — | — | not executed |
| P364 | `/wa-shop/[token]` | dynamic-template | WhatsApp shop | root | public token or payment | — | not-in-primary-nav | token | — | not executed |
| P365 | `/whatsapp` | static | Connect | app | business user session | — | not-in-primary-nav | — | — | not executed |
| P366 | `/whatsapp/bot-rules` | static | Connect | app | business user session | integration_whatsapp_bot | not-in-primary-nav | — | — | not executed |
| P367 | `/whatsapp/campaigns` | static | Connect | app | business user session | integration_whatsapp_bot | primary-nav | — | — | not executed |
| P368 | `/whatsapp/campaigns/[id]` | dynamic-template | Connect | app | business user session | integration_whatsapp_bot | child-of-nav | id | — | not executed |
| P369 | `/whatsapp/contacts` | static | Connect | app | business user session | — | primary-nav | — | — | not executed |
| P370 | `/whatsapp/contacts/groups` | static | Connect | app | business user session | — | primary-nav | — | — | not executed |
| P371 | `/whatsapp/conversations` | static | Connect | app | business user session | integration_whatsapp_bot | primary-nav | — | phone, c | not executed |
| P372 | `/whatsapp/dashboard` | static | Connect | app | business user session | — | primary-nav | — | — | not executed |
| P373 | `/whatsapp/flows` | static | Connect | app | business user session | integration_whatsapp_bot | primary-nav | — | — | not executed |
| P374 | `/whatsapp/flows/[id]` | dynamic-template | Connect | app | business user session | integration_whatsapp_bot | child-of-nav | id | — | not executed |
| P375 | `/whatsapp/group-extractor` | static | Connect | app | business user session | — | primary-nav | — | — | not executed |
| P376 | `/whatsapp/orders` | static | Connect | app | business user session | — | primary-nav | — | — | not executed |
| P377 | `/whatsapp/reminders` | static | Connect | app | business user session | whatsapp_auto_reminders | primary-nav | — | tab | not executed |
| P378 | `/whatsapp/saved-replies` | static | Connect | app | business user session | — | not-in-primary-nav | — | — | not executed |
| P379 | `/whatsapp/send-message` | static | Connect | app | business user session | integration_whatsapp_manual | primary-nav | — | tab | not executed |
| P380 | `/whatsapp/unsubscribes` | static | Connect | app | business user session | — | primary-nav | — | — | not executed |
| P381 | `/whatsapp/who-to-message` | static | Connect | app | business user session | — | primary-nav | — | — | not executed |
| P382 | `/work-orders` | static | Sales | app | business user session | sales_work_orders | primary-nav | — | — | not executed |
| P383 | `/work-orders/[id]` | dynamic-template | Sales | app | business user session | sales_work_orders | child-of-nav | id | — | not executed |
| P384 | `/work-orders/edit/[id]` | dynamic-template | Sales | app | business user session | sales_work_orders | child-of-nav | id | — | not executed |
| P385 | `/work-orders/new` | static | Sales | app | business user session | sales_work_orders | child-of-nav | — | — | not executed |

## Route handlers by module

| Module | Handlers |
| --- | ---: |
| Other API | 236 |
| Platform admin | 100 |
| HR | 87 |
| Reports | 81 |
| Connect | 65 |
| Settings | 60 |
| Purchases | 57 |
| Public API | 55 |
| Sales | 51 |
| Accounting | 43 |
| Inventory | 26 |
| Cron | 25 |
| GST | 23 |
| Partner portal | 13 |
| Auth | 8 |
| Parties | 7 |
| Webhooks | 6 |
| Online store | 2 |
| Other | 2 |

## Route handlers

Methods are those exported from the handler file. `UNKNOWN` means no `GET`/`POST`/`PUT`/`PATCH`/`DELETE` export was detected.

| ID | Methods | URL | Kind | Module | Session | Plan feature | Test status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A0001 | GET | `/admin/pwa-manifest` | static | Platform admin | platform-admin session | — | not executed |
| A0002 | GET,POST | `/api/accounts` | static | Accounting | business user session (middleware); handler must authorize | accounting_chart | not executed |
| A0003 | GET,PATCH,DELETE | `/api/accounts/[id]` | dynamic-template | Accounting | business user session (middleware); handler must authorize | accounting_chart | not executed |
| A0004 | POST | `/api/accounts/close-year` | static | Accounting | business user session (middleware); handler must authorize | accounting_chart | not executed |
| A0005 | GET,POST | `/api/accounts/groups` | static | Accounting | business user session (middleware); handler must authorize | accounting_chart | not executed |
| A0006 | GET,POST | `/api/accounts/industry-pack` | static | Accounting | business user session (middleware); handler must authorize | accounting_chart | not executed |
| A0007 | POST | `/api/accounts/initialize` | static | Accounting | business user session (middleware); handler must authorize | accounting_chart | not executed |
| A0008 | GET | `/api/accounts/reconciliation` | static | Accounting | business user session (middleware); handler must authorize | accounting_chart | not executed |
| A0009 | GET | `/api/activity-logs` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0010 | GET | `/api/admin/assistant` | static | Platform admin | platform-admin session | — | not executed |
| A0011 | GET | `/api/admin/assistant/conversations/[id]` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0012 | PATCH | `/api/admin/assistant/leads/[id]` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0013 | POST | `/api/admin/assistant/reindex` | static | Platform admin | platform-admin session | — | not executed |
| A0014 | PUT | `/api/admin/assistant/settings` | static | Platform admin | platform-admin session | — | not executed |
| A0015 | POST | `/api/admin/auth/login` | static | Platform admin | platform-admin session | — | not executed |
| A0016 | POST | `/api/admin/auth/logout` | static | Platform admin | platform-admin session | — | not executed |
| A0017 | GET | `/api/admin/auth/me` | static | Platform admin | platform-admin session | — | not executed |
| A0018 | GET | `/api/admin/billing/events` | static | Platform admin | platform-admin session | — | not executed |
| A0019 | GET,POST | `/api/admin/blog` | static | Platform admin | platform-admin session | — | not executed |
| A0020 | GET,PATCH,DELETE | `/api/admin/blog/[id]` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0021 | GET | `/api/admin/blog/categories` | static | Platform admin | platform-admin session | — | not executed |
| A0022 | GET,POST,PATCH | `/api/admin/blog/media` | static | Platform admin | platform-admin session | — | not executed |
| A0023 | GET,POST | `/api/admin/blog/media/suggest` | static | Platform admin | platform-admin session | — | not executed |
| A0024 | GET | `/api/admin/blog/slug` | static | Platform admin | platform-admin session | — | not executed |
| A0025 | GET | `/api/admin/bookings` | static | Platform admin | platform-admin session | — | not executed |
| A0026 | GET,PATCH | `/api/admin/bookings/[id]` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0027 | POST | `/api/admin/bookings/[id]/activities` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0028 | GET | `/api/admin/bookings/stats` | static | Platform admin | platform-admin session | — | not executed |
| A0029 | GET,POST | `/api/admin/bookings/time-slots` | static | Platform admin | platform-admin session | — | not executed |
| A0030 | PATCH,DELETE | `/api/admin/bookings/time-slots/[id]` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0031 | GET | `/api/admin/businesses` | static | Platform admin | platform-admin session | — | not executed |
| A0032 | GET,DELETE | `/api/admin/businesses/[id]` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0033 | GET | `/api/admin/businesses/[id]/billing` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0034 | POST | `/api/admin/businesses/[id]/billing/[txId]/refund` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0035 | POST | `/api/admin/businesses/[id]/billing/record` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0036 | POST | `/api/admin/businesses/[id]/impersonate` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0037 | GET,PATCH | `/api/admin/businesses/[id]/subscription` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0038 | GET | `/api/admin/businesses/[id]/subscription-history` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0039 | PATCH | `/api/admin/businesses/[id]/suspend` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0040 | GET | `/api/admin/businesses/[id]/users` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0041 | PATCH | `/api/admin/businesses/[id]/users/[userId]` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0042 | GET,POST | `/api/admin/diagnostics/migrate-legacy-gst` | static | Platform admin | platform-admin session | — | not executed |
| A0043 | GET | `/api/admin/diagnostics/pl-validation` | static | Platform admin | platform-admin session | — | not executed |
| A0044 | GET,DELETE | `/api/admin/diagnostics/purge-invoices` | static | Platform admin | platform-admin session | — | not executed |
| A0045 | GET,POST,DELETE | `/api/admin/diagnostics/seed-pl-demo` | static | Platform admin | platform-admin session | — | not executed |
| A0046 | GET | `/api/admin/email-logs` | static | Platform admin | platform-admin session | — | not executed |
| A0047 | GET | `/api/admin/features` | static | Platform admin | platform-admin session | — | not executed |
| A0048 | GET | `/api/admin/hsn-codes/stats` | static | Platform admin | platform-admin session | — | not executed |
| A0049 | POST | `/api/admin/hsn-codes/upload` | static | Platform admin | platform-admin session | — | not executed |
| A0050 | GET | `/api/admin/limits` | static | Platform admin | platform-admin session | — | not executed |
| A0051 | GET | `/api/admin/marketing/desk/ads` | static | Platform admin | platform-admin session | — | not executed |
| A0052 | PATCH | `/api/admin/marketing/desk/ads/[id]` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0053 | POST | `/api/admin/marketing/desk/ads/[id]/create-paused` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0054 | POST | `/api/admin/marketing/desk/ads/[id]/launch` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0055 | POST | `/api/admin/marketing/desk/ads/[id]/pause` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0056 | POST | `/api/admin/marketing/desk/ads/generate` | static | Platform admin | platform-admin session | — | not executed |
| A0057 | GET | `/api/admin/marketing/desk/performance` | static | Platform admin | platform-admin session | — | not executed |
| A0058 | GET | `/api/admin/marketing/desk/posts` | static | Platform admin | platform-admin session | — | not executed |
| A0059 | PATCH | `/api/admin/marketing/desk/posts/[id]` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0060 | POST | `/api/admin/marketing/desk/posts/generate` | static | Platform admin | platform-admin session | — | not executed |
| A0061 | GET,PUT | `/api/admin/marketing/desk/settings` | static | Platform admin | platform-admin session | — | not executed |
| A0062 | POST | `/api/admin/marketing/desk/test-connection` | static | Platform admin | platform-admin session | — | not executed |
| A0063 | GET,POST | `/api/admin/marketing/media` | static | Platform admin | platform-admin session | — | not executed |
| A0064 | GET,PUT,DELETE | `/api/admin/marketing/pages/[slug]` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0065 | POST | `/api/admin/marketing/pages/[slug]/publish` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0066 | GET | `/api/admin/marketing/pages/[slug]/versions` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0067 | POST | `/api/admin/marketing/pages/[slug]/versions/[id]/restore` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0068 | GET | `/api/admin/metrics` | static | Platform admin | platform-admin session | — | not executed |
| A0069 | GET,POST | `/api/admin/partners` | static | Platform admin | platform-admin session | — | not executed |
| A0070 | GET,PATCH | `/api/admin/partners/[id]` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0071 | GET,POST,PATCH,DELETE | `/api/admin/partners/kit` | static | Platform admin | platform-admin session | — | not executed |
| A0072 | GET,POST | `/api/admin/partners/payouts` | static | Platform admin | platform-admin session | — | not executed |
| A0073 | GET | `/api/admin/partners/reports` | static | Platform admin | platform-admin session | — | not executed |
| A0074 | GET,PUT | `/api/admin/partners/settings` | static | Platform admin | platform-admin session | — | not executed |
| A0075 | GET,POST | `/api/admin/plans/[planId]/features` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0076 | GET,POST | `/api/admin/plans/[planId]/limits` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0077 | GET,PUT | `/api/admin/platform-payments` | static | Platform admin | platform-admin session | — | not executed |
| A0078 | GET,POST | `/api/admin/platform-users` | static | Platform admin | platform-admin session | — | not executed |
| A0079 | GET,PUT | `/api/admin/pricing-display` | static | Platform admin | platform-admin session | — | not executed |
| A0080 | GET,POST | `/api/admin/promotions` | static | Platform admin | platform-admin session | — | not executed |
| A0081 | GET,PATCH,DELETE | `/api/admin/promotions/[id]` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0082 | GET | `/api/admin/promotions/[id]/analytics` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0083 | POST,DELETE | `/api/admin/push/subscribe` | static | Platform admin | platform-admin session | — | not executed |
| A0084 | POST | `/api/admin/push/test` | static | Platform admin | platform-admin session | — | not executed |
| A0085 | GET | `/api/admin/push/vapid` | static | Platform admin | platform-admin session | — | not executed |
| A0086 | GET | `/api/admin/release-diff` | static | Platform admin | platform-admin session | — | not executed |
| A0087 | GET,POST | `/api/admin/reports` | static | Platform admin | platform-admin session | — | not executed |
| A0088 | GET,PUT,DELETE | `/api/admin/sales-flow/ads` | static | Platform admin | platform-admin session | — | not executed |
| A0089 | GET,POST,PUT | `/api/admin/sales-flow/flow` | static | Platform admin | platform-admin session | — | not executed |
| A0090 | GET | `/api/admin/sales-flow/leads` | static | Platform admin | platform-admin session | — | not executed |
| A0091 | GET,POST,PATCH | `/api/admin/sales-flow/leads/[id]` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0092 | GET,POST | `/api/admin/sales-flow/media` | static | Platform admin | platform-admin session | — | not executed |
| A0093 | GET,DELETE | `/api/admin/sales-flow/media/[key]` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0094 | GET | `/api/admin/sales-flow/metrics` | static | Platform admin | platform-admin session | — | not executed |
| A0095 | GET,POST | `/api/admin/sales-flow/templates` | static | Platform admin | platform-admin session | — | not executed |
| A0096 | POST,PATCH | `/api/admin/sales-flow/templates/[id]` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0097 | GET,PATCH | `/api/admin/settings/email-templates` | static | Platform admin | platform-admin session | — | not executed |
| A0098 | GET,PATCH | `/api/admin/settings/notifications` | static | Platform admin | platform-admin session | — | not executed |
| A0099 | GET | `/api/admin/subscriptions` | static | Platform admin | platform-admin session | — | not executed |
| A0100 | GET,POST | `/api/admin/subscriptions/plans` | static | Platform admin | platform-admin session | — | not executed |
| A0101 | GET,POST | `/api/admin/videos` | static | Platform admin | platform-admin session | — | not executed |
| A0102 | GET,DELETE | `/api/admin/videos/file/[stamp]` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0103 | GET | `/api/admin/videos/shots/[name]` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0104 | GET,PUT | `/api/admin/whatsapp-credentials` | static | Platform admin | platform-admin session | — | not executed |
| A0105 | GET,POST,PUT | `/api/admin/whatsapp-templates` | static | Platform admin | platform-admin session | — | not executed |
| A0106 | GET,PATCH,DELETE | `/api/admin/whatsapp-templates/[id]` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0107 | POST | `/api/admin/whatsapp-templates/[id]/submit` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0108 | POST | `/api/admin/whatsapp-templates/[id]/test-send` | dynamic-template | Platform admin | platform-admin session | — | not executed |
| A0109 | GET,POST | `/api/advances` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0110 | GET | `/api/advances/[id]` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0111 | POST | `/api/advances/[id]/adjust` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0112 | POST | `/api/advances/[id]/refund` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0113 | GET,PUT | `/api/ai-agent` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0114 | GET,POST | `/api/ai-agent/knowledge` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0115 | GET,PATCH,DELETE | `/api/ai-agent/knowledge/[id]` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0116 | POST | `/api/ai-agent/knowledge/generate-faqs` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0117 | POST | `/api/ai-agent/knowledge/reindex` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0118 | GET | `/api/ai-agent/knowledge/sources` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0119 | POST | `/api/ai-agent/knowledge/upload` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0120 | POST | `/api/ai-agent/lead-questions/suggest` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0121 | POST,PUT | `/api/ai-agent/provider` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0122 | POST | `/api/ai-agent/test` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0123 | GET | `/api/ai-agent/usage` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0124 | GET | `/api/app/shell-compatibility` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0125 | POST | `/api/assistant/action` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0126 | GET,POST | `/api/assistant/chat` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0127 | GET | `/api/assistant/conversation/[id]` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0128 | POST | `/api/assistant/feedback` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0129 | POST | `/api/attendance/logout` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0130 | POST | `/api/attendance/send-otp` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0131 | POST | `/api/attendance/verify-otp` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0132 | POST | `/api/attendance/verify-session` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0133 | POST | `/api/auth/forgot-password` | static | Auth | middleware-public | — | not executed |
| A0134 | POST | `/api/auth/impersonate/consume` | static | Auth | middleware-public | — | not executed |
| A0135 | GET,POST | `/api/auth/login` | static | Auth | middleware-public | — | partial — Phase 3M GET readiness and POST login for two disposable users returned HTTP 200. Other login cases NOT TESTED |
| A0136 | POST | `/api/auth/logout` | static | Auth | middleware-public | — | not executed |
| A0137 | GET | `/api/auth/me` | static | Auth | middleware-public | — | not executed |
| A0138 | POST | `/api/auth/refresh` | static | Auth | middleware-public | — | not executed |
| A0139 | POST | `/api/auth/reset-password` | static | Auth | middleware-public | — | not executed |
| A0140 | GET | `/api/auth/session` | static | Auth | middleware-public | — | not executed |
| A0141 | GET | `/api/authorization/preview` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0142 | POST | `/api/backup/create` | static | Other API | business user session (middleware); handler must authorize | settings_backup | not executed |
| A0143 | GET,DELETE | `/api/backup/history` | static | Other API | business user session (middleware); handler must authorize | settings_backup | not executed |
| A0144 | GET | `/api/backup/history/[id]` | dynamic-template | Other API | business user session (middleware); handler must authorize | settings_backup | not executed |
| A0145 | GET | `/api/backup/history/[id]/download` | dynamic-template | Other API | business user session (middleware); handler must authorize | settings_backup | not executed |
| A0146 | POST | `/api/backup/preview` | static | Other API | business user session (middleware); handler must authorize | settings_backup | not executed |
| A0147 | POST | `/api/backup/restore` | static | Other API | business user session (middleware); handler must authorize | settings_backup | not executed |
| A0148 | GET,POST,DELETE | `/api/backup/schedule` | static | Other API | business user session (middleware); handler must authorize | settings_backup | not executed |
| A0149 | GET | `/api/badges/counts` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0150 | GET,POST,PUT,DELETE | `/api/bank-accounts` | static | Other API | business user session (middleware); handler must authorize | accounting_bank | not executed |
| A0151 | POST | `/api/bank-statements/import` | static | Other API | business user session (middleware); handler must authorize | accounting_bank | not executed |
| A0152 | POST | `/api/bank-statements/reconcile` | static | Other API | business user session (middleware); handler must authorize | accounting_bank | not executed |
| A0153 | GET | `/api/bank-statements/reconciliation-report` | static | Other API | business user session (middleware); handler must authorize | accounting_bank | not executed |
| A0154 | GET | `/api/bank-statements/unreconciled` | static | Other API | business user session (middleware); handler must authorize | accounting_bank | not executed |
| A0155 | GET | `/api/bank/brs` | static | Accounting | business user session (middleware); handler must authorize | accounting_bank | not executed |
| A0156 | POST | `/api/bank/import` | static | Accounting | business user session (middleware); handler must authorize | accounting_bank | not executed |
| A0157 | POST | `/api/bank/import/confirm` | static | Accounting | business user session (middleware); handler must authorize | accounting_bank | not executed |
| A0158 | GET | `/api/bank/reconciliation` | static | Accounting | business user session (middleware); handler must authorize | accounting_bank | not executed |
| A0159 | POST | `/api/bank/reconciliation/auto-match` | static | Accounting | business user session (middleware); handler must authorize | accounting_bank | not executed |
| A0160 | POST | `/api/bank/reconciliation/complete` | static | Accounting | business user session (middleware); handler must authorize | accounting_bank | not executed |
| A0161 | POST | `/api/bank/reconciliation/create-entry` | static | Accounting | business user session (middleware); handler must authorize | accounting_bank | not executed |
| A0162 | POST | `/api/bank/reconciliation/ignore` | static | Accounting | business user session (middleware); handler must authorize | accounting_bank | not executed |
| A0163 | POST | `/api/bank/reconciliation/match` | static | Accounting | business user session (middleware); handler must authorize | accounting_bank | not executed |
| A0164 | POST | `/api/bank/reconciliation/undo` | static | Accounting | business user session (middleware); handler must authorize | accounting_bank | not executed |
| A0165 | GET | `/api/bookings/available-slots` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0166 | POST | `/api/bookings/create` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0167 | GET,POST | `/api/branches` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0168 | GET,PATCH,DELETE | `/api/branches/[id]` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0169 | GET,POST | `/api/budgets` | static | Other API | business user session (middleware); handler must authorize | accounting_budgets | not executed |
| A0170 | GET | `/api/budgets/[id]/variance` | dynamic-template | Other API | business user session (middleware); handler must authorize | accounting_budgets | not executed |
| A0171 | POST | `/api/bulk/[entity]` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0172 | PATCH | `/api/business/[id]` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0173 | POST | `/api/businesses` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0174 | GET,PATCH | `/api/businesses/[id]` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0175 | GET | `/api/businesses/my` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0176 | POST | `/api/businesses/switch` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0177 | GET,POST,DELETE | `/api/categories` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0178 | GET | `/api/cloud-storage/google/auth` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0179 | GET | `/api/cloud-storage/google/callback` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0180 | GET,POST,DELETE | `/api/cloud-storage/google/credentials` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0181 | POST | `/api/cloud-storage/google/disconnect` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0182 | GET | `/api/cloud-storage/google/list` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0183 | POST | `/api/cloud-storage/google/upload` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0184 | GET,POST | `/api/commission-rules` | static | Other API | business user session (middleware); handler must authorize | hr_commissions | not executed |
| A0185 | PATCH,DELETE | `/api/commission-rules/[id]` | dynamic-template | Other API | business user session (middleware); handler must authorize | hr_commissions | not executed |
| A0186 | GET,POST | `/api/contra` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0187 | POST | `/api/credit-approvals/approve` | static | Other API | business user session (middleware); handler must authorize | accounting_credit_approvals | not executed |
| A0188 | GET | `/api/credit-approvals/pending` | static | Other API | business user session (middleware); handler must authorize | accounting_credit_approvals | not executed |
| A0189 | POST | `/api/credit-approvals/reject` | static | Other API | business user session (middleware); handler must authorize | accounting_credit_approvals | not executed |
| A0190 | POST | `/api/credit-approvals/request` | static | Other API | business user session (middleware); handler must authorize | accounting_credit_approvals | not executed |
| A0191 | GET,POST | `/api/credit-notes` | static | Sales | business user session (middleware); handler must authorize | sales_credit_notes | partial — phase 3F GET PASS. Phase 3G POST did not write another business. Other POST fields not executed. Phase 3M live GET PASS. POST not called live |
| A0192 | PUT,PATCH | `/api/credit-notes/[id]` | dynamic-template | Sales | business user session (middleware); handler must authorize | sales_credit_notes | not executed |
| A0193 | PATCH | `/api/credit-notes/[id]/cancel` | dynamic-template | Sales | business user session (middleware); handler must authorize | sales_credit_notes | not executed |
| A0194 | POST | `/api/cron/assistant-maintenance` | static | Cron | middleware-public (cron secret expected in handler) | — | not executed |
| A0195 | GET,POST | `/api/cron/check-low-stock` | static | Cron | middleware-public (cron secret expected in handler) | — | not executed |
| A0196 | GET,POST | `/api/cron/check-subscriptions` | static | Cron | middleware-public (cron secret expected in handler) | — | not executed |
| A0197 | GET | `/api/cron/expire-sales-order-reservations` | static | Cron | middleware-public (cron secret expected in handler) | — | not executed |
| A0198 | GET,POST | `/api/cron/gst-compliance-alerts` | static | Cron | middleware-public (cron secret expected in handler) | — | not executed |
| A0199 | GET,POST | `/api/cron/hr-probation-confirm` | static | Cron | middleware-public (cron secret expected in handler) | — | not executed |
| A0200 | GET,POST | `/api/cron/leave-accrual` | static | Cron | middleware-public (cron secret expected in handler) | — | not executed |
| A0201 | GET,POST | `/api/cron/leave-year-end` | static | Cron | middleware-public (cron secret expected in handler) | — | not executed |
| A0202 | GET | `/api/cron/marketing-draft` | static | Cron | middleware-public (cron secret expected in handler) | — | not executed |
| A0203 | GET | `/api/cron/marketing-insights` | static | Cron | middleware-public (cron secret expected in handler) | — | not executed |
| A0204 | GET | `/api/cron/marketing-publish` | static | Cron | middleware-public (cron secret expected in handler) | — | not executed |
| A0205 | GET,POST | `/api/cron/order-dispatch-alerts` | static | Cron | middleware-public (cron secret expected in handler) | — | not executed |
| A0206 | GET,POST | `/api/cron/owner-daily-summary` | static | Cron | middleware-public (cron secret expected in handler) | — | not executed |
| A0207 | GET,POST | `/api/cron/process-campaigns` | static | Cron | middleware-public (cron secret expected in handler) | — | not executed |
| A0208 | GET,POST | `/api/cron/process-reversing-entries` | static | Cron | middleware-public (cron secret expected in handler) | — | not executed |
| A0209 | GET | `/api/cron/process-scheduled-backups` | static | Cron | middleware-public (cron secret expected in handler) | — | not executed |
| A0210 | GET,POST | `/api/cron/recurring-invoices` | static | Cron | middleware-public (cron secret expected in handler) | — | not executed |
| A0211 | GET | `/api/cron/refresh-profile-pictures` | static | Cron | middleware-public (cron secret expected in handler) | — | not executed |
| A0212 | GET,POST | `/api/cron/sales-funnel` | static | Cron | middleware-public (cron secret expected in handler) | — | not executed |
| A0213 | GET,POST | `/api/cron/send-daily-invoice-summary` | static | Cron | middleware-public (cron secret expected in handler) | — | not executed |
| A0214 | GET,POST | `/api/cron/send-payment-reminders` | static | Cron | middleware-public (cron secret expected in handler) | — | not executed |
| A0215 | GET,POST | `/api/cron/send-todo-reminders` | static | Cron | middleware-public (cron secret expected in handler) | — | not executed |
| A0216 | GET,POST | `/api/cron/shift-roster-absent` | static | Cron | middleware-public (cron secret expected in handler) | — | not executed |
| A0217 | GET,POST | `/api/cron/stuck-parcels` | static | Cron | middleware-public (cron secret expected in handler) | — | not executed |
| A0218 | GET | `/api/cron/whatsapp-auto-resolve` | static | Cron | middleware-public (cron secret expected in handler) | — | not executed |
| A0219 | GET,POST | `/api/currencies` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0220 | GET,POST | `/api/custom-fields` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0221 | PATCH,DELETE | `/api/custom-fields/[id]` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0222 | GET,POST | `/api/customers` | static | Parties | business user session (middleware); handler must authorize | — | partial — phase 3F GET PASS. Phase 3G POST FAIL stays in that file. Phase 3H POST regression PASS for the requests in `phase-3h-write-identity-fix-results.md`. Phase 3M live GET and POST PASS |
| A0223 | GET,PUT | `/api/customers/[id]` | dynamic-template | Parties | business user session (middleware); handler must authorize | — | partial — phase 3A GET and one PUT. Phase 3I PUT FAIL stays in that file. Phase 3J PUT regression PASS for the requests in `phase-3j-write-identity-fix-results.md`. Phase 3M live PUT PASS in `phase-3m-live-http-security-results.md`. GET not called live |
| A0224 | GET | `/api/customers/[id]/credits` | dynamic-template | Parties | business user session (middleware); handler must authorize | — | not executed |
| A0225 | GET | `/api/customers/[id]/history` | dynamic-template | Parties | business user session (middleware); handler must authorize | — | not executed |
| A0226 | PATCH | `/api/customers/[id]/portal` | dynamic-template | Parties | business user session (middleware); handler must authorize | — | not executed |
| A0227 | POST | `/api/customers/[id]/send-reminder` | dynamic-template | Parties | business user session (middleware); handler must authorize | — | not executed |
| A0228 | GET | `/api/customers/balances` | static | Parties | business user session (middleware); handler must authorize | — | not executed |
| A0229 | GET | `/api/dashboard` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0230 | GET | `/api/dashboard/cash-flow` | static | Other API | business user session (middleware); handler must authorize | — | PASS — phase 3F session scope. Phase 3E FAIL stays in the results file. fiscal_year remains a filter. Phase 3M live GET PASS |
| A0231 | GET | `/api/dashboard/charts` | static | Other API | business user session (middleware); handler must authorize | — | PASS — phase 3D session scope. Phase 3C FAIL remains in the results file. Date filters still apply. Phase 3M live GET PASS |
| A0232 | GET | `/api/dashboard/collection` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0233 | GET | `/api/dashboard/dead-stock` | static | Other API | business user session (middleware); handler must authorize | dead_stock_widget | not executed |
| A0234 | GET | `/api/dashboard/dead-stock/suggestions` | static | Other API | business user session (middleware); handler must authorize | dead_stock_widget | not executed |
| A0235 | GET | `/api/dashboard/low-stock` | static | Other API | business user session (middleware); handler must authorize | — | PASS — phase 3D session scope. Phase 3C FAIL remains in the results file. Phase 3M live GET PASS |
| A0236 | GET | `/api/dashboard/overview` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0237 | GET | `/api/dashboard/payables` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0238 | GET | `/api/dashboard/receivables` | static | Other API | business user session (middleware); handler must authorize | — | PASS — phase 3F session scope. Phase 3E FAIL stays in the results file. Branch filter still applies. Phase 3M live GET PASS |
| A0239 | GET | `/api/dashboard/recent-invoices` | static | Other API | business user session (middleware); handler must authorize | — | PASS — phase 3D session scope. Phase 3C FAIL remains in the results file. Limit filter still applies. Phase 3M live GET PASS |
| A0240 | GET | `/api/dashboard/recent-transactions` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0241 | GET | `/api/dashboard/sales-summary` | static | Other API | business user session (middleware); handler must authorize | — | PASS — phase 3D session scope. Phase 3C FAIL remains in the results file. Phase 3M live GET PASS |
| A0242 | GET | `/api/dashboard/sales-trend` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0243 | GET | `/api/dashboard/today-purchases` | static | Other API | business user session (middleware); handler must authorize | — | PASS — phase 3D session scope. Phase 3C FAIL remains in the results file. Phase 3M live GET PASS |
| A0244 | GET | `/api/dashboard/today-sales` | static | Other API | business user session (middleware); handler must authorize | — | PASS — phase 3D session scope. Phase 3C FAIL remains in the results file. Phase 3M live GET PASS |
| A0245 | GET | `/api/dashboard/top-customers` | static | Other API | business user session (middleware); handler must authorize | — | PASS — phase 3D session scope. Phase 3C FAIL remains in the results file. Limit filter still applies. Phase 3M live GET PASS |
| A0246 | GET | `/api/dashboard/top-products` | static | Other API | business user session (middleware); handler must authorize | — | PASS — phase 3F session scope. Phase 3E FAIL stays in the results file. Limit filter still applies. Phase 3M live GET PASS |
| A0247 | GET,POST | `/api/dashboard/widgets` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0248 | GET,POST | `/api/debit-notes` | static | Sales | business user session (middleware); handler must authorize | sales_debit_notes | partial — phase 3F GET PASS. Phase 3G POST did not write another business. Other POST fields not executed. Phase 3M live GET PASS. POST not called live |
| A0249 | PUT,PATCH | `/api/debit-notes/[id]` | dynamic-template | Sales | business user session (middleware); handler must authorize | sales_debit_notes | not executed |
| A0250 | PATCH | `/api/debit-notes/[id]/cancel` | dynamic-template | Sales | business user session (middleware); handler must authorize | sales_debit_notes | not executed |
| A0251 | POST | `/api/debug/fix-user` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0252 | GET | `/api/debug/template-assignment` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0253 | GET | `/api/debug/user-state` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0254 | GET,POST | `/api/delivery-challans` | static | Sales | business user session (middleware); handler must authorize | sales_delivery_challans | not executed |
| A0255 | GET,PUT,PATCH | `/api/delivery-challans/[id]` | dynamic-template | Sales | business user session (middleware); handler must authorize | sales_delivery_challans | not executed |
| A0256 | GET | `/api/delivery-challans/next-number` | static | Sales | business user session (middleware); handler must authorize | sales_delivery_challans | not executed |
| A0257 | GET,POST | `/api/depreciation/calculate` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0258 | GET,PATCH,DELETE | `/api/document-attachments/[id]` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0259 | GET,POST,DELETE | `/api/documents` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0260 | GET | `/api/documents/[table]/[id]` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0261 | POST | `/api/documents/[table]/[id]/email` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0262 | GET | `/api/documents/[table]/[id]/pdf` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0263 | GET | `/api/documents/[table]/[id]/preview` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0264 | GET | `/api/email/test` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0265 | GET,POST | `/api/employees` | static | HR | business user session (middleware); handler must authorize | hr_employees | not executed |
| A0266 | GET,PATCH,DELETE | `/api/employees/[id]` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_employees | not executed |
| A0267 | POST | `/api/employees/[id]/portal-invite` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_employees | not executed |
| A0268 | GET,POST | `/api/employees/[id]/salary-structure` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_employees | not executed |
| A0269 | GET,POST,PATCH,DELETE | `/api/employees/[id]/staff-app` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_employees | not executed |
| A0270 | GET,POST,DELETE | `/api/employees/[id]/staff-app/face` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_employees | not executed |
| A0271 | GET,POST | `/api/employees/attendance` | static | HR | business user session (middleware); handler must authorize | hr_attendance | not executed |
| A0272 | GET,POST | `/api/employees/attendance-regularization` | static | HR | business user session (middleware); handler must authorize | hr_shifts | not executed |
| A0273 | POST | `/api/employees/attendance/check-in` | static | HR | business user session (middleware); handler must authorize | hr_attendance | not executed |
| A0274 | POST | `/api/employees/attendance/check-out` | static | HR | business user session (middleware); handler must authorize | hr_attendance | not executed |
| A0275 | POST | `/api/employees/attendance/face-recognition` | static | HR | business user session (middleware); handler must authorize | hr_staff_app | not executed |
| A0276 | GET | `/api/employees/attendance/matrix` | static | HR | business user session (middleware); handler must authorize | hr_attendance | not executed |
| A0277 | GET,POST | `/api/employees/attendance/reviews` | static | HR | business user session (middleware); handler must authorize | hr_staff_app | not executed |
| A0278 | GET,POST | `/api/employees/attendance/sites` | static | HR | business user session (middleware); handler must authorize | hr_staff_app | not executed |
| A0279 | PATCH,DELETE | `/api/employees/attendance/sites/[siteId]` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_staff_app | not executed |
| A0280 | GET,POST | `/api/employees/commissions` | static | HR | business user session (middleware); handler must authorize | hr_commissions | not executed |
| A0281 | GET,POST | `/api/employees/expenses` | static | HR | business user session (middleware); handler must authorize | hr_commissions | not executed |
| A0282 | PATCH,DELETE | `/api/employees/expenses/[id]` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_commissions | not executed |
| A0283 | GET,POST | `/api/employees/expenses/[id]/attachments` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_commissions | not executed |
| A0284 | GET | `/api/employees/expenses/[id]/voucher` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_commissions | not executed |
| A0285 | GET | `/api/employees/expenses/[id]/voucher/pdf` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_commissions | not executed |
| A0286 | GET,POST | `/api/employees/face-enrollment` | static | HR | business user session (middleware); handler must authorize | hr_staff_app | not executed |
| A0287 | GET,POST | `/api/employees/leave-balances` | static | HR | business user session (middleware); handler must authorize | hr_leaves | not executed |
| A0288 | GET | `/api/employees/leave-calendar` | static | HR | business user session (middleware); handler must authorize | hr_leaves | not executed |
| A0289 | GET,POST | `/api/employees/leave-requests` | static | HR | business user session (middleware); handler must authorize | hr_leaves | not executed |
| A0290 | PATCH,DELETE | `/api/employees/leave-requests/[id]` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_leaves | not executed |
| A0291 | GET | `/api/employees/login-options` | static | HR | business user session (middleware); handler must authorize | hr_employees | not executed |
| A0292 | GET,POST,PUT | `/api/employees/manager/attendance` | static | HR | business user session (middleware); handler must authorize | hr_leaves | not executed |
| A0293 | PATCH | `/api/employees/manager/attendance-regularization/[id]` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_leaves | not executed |
| A0294 | GET | `/api/employees/manager/context` | static | HR | business user session (middleware); handler must authorize | hr_leaves | not executed |
| A0295 | GET | `/api/employees/manager/dashboard` | static | HR | business user session (middleware); handler must authorize | hr_leaves | not executed |
| A0296 | PATCH | `/api/employees/manager/exit-approvals/[exitId]` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_leaves | not executed |
| A0297 | PATCH | `/api/employees/manager/leave-approvals/[leaveRequestId]` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_leaves | not executed |
| A0298 | PATCH | `/api/employees/manager/ot-approvals/[overtimeRequestId]` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_leaves | not executed |
| A0299 | GET | `/api/employees/manager/pending-approvals` | static | HR | business user session (middleware); handler must authorize | hr_leaves | not executed |
| A0300 | POST | `/api/employees/manager/shift-assign` | static | HR | business user session (middleware); handler must authorize | hr_leaves | not executed |
| A0301 | GET | `/api/employees/manager/team` | static | HR | business user session (middleware); handler must authorize | hr_leaves | not executed |
| A0302 | GET | `/api/employees/org-chart` | static | HR | business user session (middleware); handler must authorize | hr_advanced | not executed |
| A0303 | GET,POST | `/api/employees/overtime-requests` | static | HR | business user session (middleware); handler must authorize | hr_shifts | not executed |
| A0304 | PATCH | `/api/employees/overtime-requests/[id]` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_shifts | not executed |
| A0305 | GET | `/api/employees/performance` | static | HR | business user session (middleware); handler must authorize | hr_advanced | not executed |
| A0306 | GET,POST | `/api/employees/salary/advances` | static | HR | business user session (middleware); handler must authorize | hr_payroll | not executed |
| A0307 | PATCH | `/api/employees/salary/advances/[id]/approve` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_payroll | not executed |
| A0308 | GET | `/api/employees/salary/advances/balance` | static | HR | business user session (middleware); handler must authorize | hr_payroll | not executed |
| A0309 | GET,POST | `/api/employees/salary/payments` | static | HR | business user session (middleware); handler must authorize | hr_payroll | not executed |
| A0310 | GET | `/api/employees/salary/payments/prefill` | static | HR | business user session (middleware); handler must authorize | hr_payroll | not executed |
| A0311 | GET | `/api/employees/salary/payslips` | static | HR | business user session (middleware); handler must authorize | hr_payroll | not executed |
| A0312 | GET | `/api/employees/salary/payslips/[id]/html` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_payroll | not executed |
| A0313 | GET | `/api/employees/salary/payslips/[id]/pdf` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_payroll | not executed |
| A0314 | GET | `/api/employees/staff-wages` | static | HR | business user session (middleware); handler must authorize | hr_employees | not executed |
| A0315 | POST | `/api/employees/staff-wages/close` | static | HR | business user session (middleware); handler must authorize | hr_employees | not executed |
| A0316 | POST | `/api/employees/staff-wages/pay` | static | HR | business user session (middleware); handler must authorize | hr_employees | not executed |
| A0317 | GET,POST | `/api/employees/targets` | static | HR | business user session (middleware); handler must authorize | hr_advanced | not executed |
| A0318 | DELETE | `/api/employees/targets/[id]` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_advanced | not executed |
| A0319 | GET,POST | `/api/estimates` | static | Sales | business user session (middleware); handler must authorize | sales_estimates | partial — phase 3F GET PASS. Phase 3G POST FAIL stays in that file. Phase 3H POST regression PASS for the requests in `phase-3h-write-identity-fix-results.md`. Phase 3M live GET and POST PASS |
| A0320 | POST | `/api/estimates/[id]/convert` | dynamic-template | Sales | business user session (middleware); handler must authorize | sales_estimates | not executed |
| A0321 | GET,POST | `/api/exchange-rates` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0322 | GET,POST | `/api/expense-categories` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0323 | PATCH | `/api/expense-categories/[id]` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0324 | GET,POST | `/api/expenses` | static | Purchases | business user session (middleware); handler must authorize | purchase_expenses | partial — phase 3F GET PASS. Phase 3G POST FAIL stays in that file. Phase 3H POST regression PASS for the requests in `phase-3h-write-identity-fix-results.md`. Phase 3M live GET and POST PASS |
| A0325 | GET,PUT,DELETE | `/api/expenses/[id]` | dynamic-template | Purchases | business user session (middleware); handler must authorize | purchase_expenses | not executed |
| A0326 | GET | `/api/features/enabled` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0327 | GET,POST | `/api/filters/presets` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0328 | PUT,DELETE | `/api/filters/presets/[id]` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0329 | GET,POST | `/api/financial-years` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0330 | GET,POST | `/api/financial-years/[id]/close` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0331 | GET,POST | `/api/fixed-assets` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0332 | POST | `/api/fixed-assets/[id]/depreciate` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0333 | POST | `/api/fixed-assets/[id]/dispose` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0334 | GET | `/api/fixed-assets/depreciation-schedule` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0335 | GET | `/api/fixed-assets/it-depreciation` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0336 | GET | `/api/gst/audit-comparison` | static | GST | business user session (middleware); handler must authorize | — | not executed |
| A0337 | GET | `/api/gst/cash-ledger` | static | GST | business user session (middleware); handler must authorize | — | not executed |
| A0338 | POST | `/api/gst/cash-ledger/deposit` | static | GST | business user session (middleware); handler must authorize | — | not executed |
| A0339 | POST | `/api/gst/cash-ledger/reverse` | static | GST | business user session (middleware); handler must authorize | — | not executed |
| A0340 | POST | `/api/gst/cash-ledger/utilize` | static | GST | business user session (middleware); handler must authorize | — | not executed |
| A0341 | GET | `/api/gst/charges` | static | GST | business user session (middleware); handler must authorize | — | not executed |
| A0342 | GET,POST | `/api/gst/compliance-alerts` | static | GST | business user session (middleware); handler must authorize | — | not executed |
| A0343 | POST | `/api/gst/file` | static | GST | business user session (middleware); handler must authorize | — | not executed |
| A0344 | GET,POST | `/api/gst/gstr2b/decision` | static | GST | business user session (middleware); handler must authorize | — | not executed |
| A0345 | GET | `/api/gst/gstr2b/export` | static | GST | business user session (middleware); handler must authorize | — | not executed |
| A0346 | POST | `/api/gst/gstr2b/import` | static | GST | business user session (middleware); handler must authorize | — | not executed |
| A0347 | GET,POST | `/api/gst/gstr2b/reconcile` | static | GST | business user session (middleware); handler must authorize | — | not executed |
| A0348 | GET | `/api/gst/gstr3b/export` | static | GST | business user session (middleware); handler must authorize | — | not executed |
| A0349 | GET | `/api/gst/itc-decisions/pending` | static | GST | business user session (middleware); handler must authorize | — | not executed |
| A0350 | GET | `/api/gst/outstanding` | static | GST | business user session (middleware); handler must authorize | — | not executed |
| A0351 | POST | `/api/gst/payment` | static | GST | business user session (middleware); handler must authorize | — | not executed |
| A0352 | GET | `/api/gst/rcm-coverage` | static | GST | business user session (middleware); handler must authorize | — | not executed |
| A0353 | GET,POST,DELETE | `/api/gst/return-marks` | static | GST | business user session (middleware); handler must authorize | — | not executed |
| A0354 | GET,POST | `/api/gst/return-readiness` | static | GST | business user session (middleware); handler must authorize | — | not executed |
| A0355 | POST | `/api/gst/revise` | static | GST | business user session (middleware); handler must authorize | — | not executed |
| A0356 | GET,POST | `/api/gst/rule37` | static | GST | business user session (middleware); handler must authorize | — | not executed |
| A0357 | POST | `/api/gst/setoff` | static | GST | business user session (middleware); handler must authorize | — | not executed |
| A0358 | GET | `/api/gst/status` | static | GST | business user session (middleware); handler must authorize | — | not executed |
| A0359 | GET | `/api/gstin/lookup` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0360 | GET | `/api/gstin/verify` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0361 | GET,POST | `/api/holidays` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0362 | PATCH,DELETE | `/api/holidays/[id]` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0363 | GET,POST,PATCH | `/api/hr/announcements` | static | HR | business user session (middleware); handler must authorize | hr_advanced | not executed |
| A0364 | GET | `/api/hr/dashboard/overview` | static | HR | business user session (middleware); handler must authorize | hr_advanced | not executed |
| A0365 | GET,POST,PATCH | `/api/hr/document-templates` | static | HR | business user session (middleware); handler must authorize | hr_advanced | not executed |
| A0366 | POST | `/api/hr/document-templates/[id]/generate` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_advanced | not executed |
| A0367 | GET,POST,PATCH | `/api/hr/engagement/articles` | static | HR | business user session (middleware); handler must authorize | hr_advanced | not executed |
| A0368 | GET,POST | `/api/hr/engagement/polls` | static | HR | business user session (middleware); handler must authorize | hr_advanced | not executed |
| A0369 | GET,POST | `/api/hr/exits` | static | HR | business user session (middleware); handler must authorize | hr_advanced | not executed |
| A0370 | GET,PATCH | `/api/hr/exits/[id]` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_advanced | not executed |
| A0371 | GET | `/api/hr/exits/pending-approvals` | static | HR | business user session (middleware); handler must authorize | hr_advanced | not executed |
| A0372 | POST | `/api/hr/leave/balances/import` | static | HR | business user session (middleware); handler must authorize | hr_leaves | not executed |
| A0373 | GET | `/api/hr/leave/preview-days` | static | HR | business user session (middleware); handler must authorize | hr_leaves | not executed |
| A0374 | POST | `/api/hr/leave/year-end` | static | HR | business user session (middleware); handler must authorize | hr_leaves | not executed |
| A0375 | GET,PATCH | `/api/hr/onboarding-invite-email` | static | HR | business user session (middleware); handler must authorize | hr_recruitment | not executed |
| A0376 | GET,POST | `/api/hr/onboarding-templates` | static | HR | business user session (middleware); handler must authorize | hr_recruitment | not executed |
| A0377 | PATCH | `/api/hr/onboarding-templates/[id]` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_recruitment | not executed |
| A0378 | GET,POST | `/api/hr/recruitment/candidates` | static | HR | business user session (middleware); handler must authorize | hr_recruitment | not executed |
| A0379 | GET,PATCH | `/api/hr/recruitment/candidates/[id]` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_recruitment | not executed |
| A0380 | POST | `/api/hr/recruitment/candidates/[id]/convert` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_recruitment | not executed |
| A0381 | GET,PATCH | `/api/hr/recruitment/candidates/[id]/documents` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_recruitment | not executed |
| A0382 | GET,POST | `/api/hr/recruitment/candidates/[id]/interviews` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_recruitment | not executed |
| A0383 | PATCH | `/api/hr/recruitment/candidates/[id]/interviews/[interviewId]` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_recruitment | not executed |
| A0384 | POST | `/api/hr/recruitment/candidates/[id]/invite-portal` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_recruitment | not executed |
| A0385 | GET,POST,PATCH | `/api/hr/recruitment/candidates/[id]/offer` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_recruitment | not executed |
| A0386 | GET | `/api/hr/recruitment/candidates/[id]/offer/pdf` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_recruitment | not executed |
| A0387 | GET | `/api/hr/recruitment/candidates/[id]/tasks/[taskId]` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_recruitment | not executed |
| A0388 | POST | `/api/hr/recruitment/candidates/[id]/tasks/[taskId]/review` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_recruitment | not executed |
| A0389 | GET,POST | `/api/hr/recruitment/jobs` | static | HR | business user session (middleware); handler must authorize | hr_recruitment | not executed |
| A0390 | GET,PATCH | `/api/hr/recruitment/jobs/[id]` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_recruitment | not executed |
| A0391 | GET | `/api/hr/recruitment/offer-approvals/pending` | static | HR | business user session (middleware); handler must authorize | hr_recruitment | not executed |
| A0392 | GET | `/api/hr/reports/[type]` | dynamic-template | HR | business user session (middleware); handler must authorize | hr_advanced | not executed |
| A0393 | GET | `/api/hr/reports/statutory-ecr` | static | HR | business user session (middleware); handler must authorize | hr_advanced | not executed |
| A0394 | POST | `/api/hr/shifts/bulk-assign` | static | HR | business user session (middleware); handler must authorize | hr_shifts | not executed |
| A0395 | GET,PATCH | `/api/hr/shifts/roster` | static | HR | business user session (middleware); handler must authorize | hr_shifts | not executed |
| A0396 | GET | `/api/hsn/lookup` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0397 | POST | `/api/hsn/validate` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0398 | GET,POST | `/api/inventory-adjustments` | static | Inventory | business user session (middleware); handler must authorize | purchase_inventory_adjustments | partial — phase 3A GET list only. Phase 3I POST FAIL stays in that file. Phase 3J POST regression PASS for the requests in `phase-3j-write-identity-fix-results.md`. Phase 3M live POST PASS. Phase 3N live GET PASS |
| A0399 | GET | `/api/inventory-adjustments/[id]` | dynamic-template | Inventory | business user session (middleware); handler must authorize | purchase_inventory_adjustments | partial — phase 3A one GET with a foreign business_id; no adjustment row was seeded |
| A0400 | POST | `/api/inventory/fifo-recost` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0401 | GET,POST | `/api/invoice-template-settings` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0402 | GET,POST,PATCH,DELETE | `/api/invoice-templates` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0403 | GET,POST | `/api/invoices` | static | Sales | business user session (middleware); handler must authorize | sales_invoices | partial — POST create in phase 2; phase 3B GET list session check PASS. Other invoice actions remain partial. Phase 3M live GET PASS. POST not called live |
| A0404 | GET,PATCH | `/api/invoices/[id]` | dynamic-template | Sales | business user session (middleware); handler must authorize | sales_invoices | partial — one GET after item soft-delete, and one cross-tenant GET in phase 3A; PATCH not executed |
| A0405 | PATCH | `/api/invoices/[id]/cancel` | dynamic-template | Sales | business user session (middleware); handler must authorize | sales_invoices | not executed |
| A0406 | POST | `/api/invoices/[id]/convert-to-purchase` | dynamic-template | Sales | business user session (middleware); handler must authorize | sales_invoices | not executed |
| A0407 | POST | `/api/invoices/[id]/convert-to-tax-invoice` | dynamic-template | Sales | business user session (middleware); handler must authorize | sales_invoices | not executed |
| A0408 | POST | `/api/invoices/[id]/email` | dynamic-template | Sales | business user session (middleware); handler must authorize | sales_invoices | not executed |
| A0409 | PATCH | `/api/invoices/[id]/eway` | dynamic-template | Sales | business user session (middleware); handler must authorize | sales_invoices | not executed |
| A0410 | PATCH | `/api/invoices/[id]/finalize` | dynamic-template | Sales | business user session (middleware); handler must authorize | sales_invoices | not executed |
| A0411 | GET | `/api/invoices/[id]/gstr1-status` | dynamic-template | Sales | business user session (middleware); handler must authorize | sales_invoices | not executed |
| A0412 | GET | `/api/invoices/[id]/history` | dynamic-template | Sales | business user session (middleware); handler must authorize | sales_invoices | not executed |
| A0413 | GET | `/api/invoices/[id]/image` | dynamic-template | Sales | business user session (middleware); handler must authorize | sales_invoices | not executed |
| A0414 | PATCH | `/api/invoices/[id]/payments` | dynamic-template | Sales | business user session (middleware); handler must authorize | sales_invoices | not executed |
| A0415 | GET | `/api/invoices/[id]/pdf` | dynamic-template | Sales | business user session (middleware); handler must authorize | sales_invoices | not executed |
| A0416 | GET | `/api/invoices/[id]/preview` | dynamic-template | Sales | business user session (middleware); handler must authorize | sales_invoices | not executed |
| A0417 | GET,POST | `/api/invoices/[id]/proforma-lifecycle` | dynamic-template | Sales | business user session (middleware); handler must authorize | sales_invoices | not executed |
| A0418 | GET | `/api/invoices/[id]/public-link` | dynamic-template | Sales | business user session (middleware); handler must authorize | sales_invoices | not executed |
| A0419 | POST | `/api/invoices/[id]/whatsapp` | dynamic-template | Sales | business user session (middleware); handler must authorize | sales_invoices | not executed |
| A0420 | GET,POST | `/api/invoices/extract` | static | Sales | business user session (middleware); handler must authorize | sales_invoices | not executed |
| A0421 | GET | `/api/invoices/extract/jobs` | static | Sales | business user session (middleware); handler must authorize | sales_invoices | not executed |
| A0422 | POST | `/api/invoices/extract/learning` | static | Sales | business user session (middleware); handler must authorize | sales_invoices | not executed |
| A0423 | GET | `/api/invoices/for-reminders` | static | Sales | business user session (middleware); handler must authorize | sales_invoices | not executed |
| A0424 | GET | `/api/invoices/next-number` | static | Sales | business user session (middleware); handler must authorize | sales_invoices | not executed |
| A0425 | POST | `/api/invoices/preview` | static | Sales | business user session (middleware); handler must authorize | sales_invoices | not executed |
| A0426 | POST | `/api/invoices/restore` | static | Sales | business user session (middleware); handler must authorize | sales_invoices | not executed |
| A0427 | GET,POST | `/api/items` | static | Inventory | business user session (middleware); handler must authorize | — | partial — GET list session check PASS in phase 3B. Phase 3I POST FAIL stays in that file. Phase 3J POST regression PASS for the requests in `phase-3j-write-identity-fix-results.md`. Phase 3M live GET and POST PASS |
| A0428 | GET,PATCH,DELETE | `/api/items/[id]` | dynamic-template | Inventory | business user session (middleware); handler must authorize | — | partial — permission DELETE, plus phase 3A foreign GET and foreign DELETE; PATCH not executed |
| A0429 | GET,POST | `/api/items/[id]/batches` | dynamic-template | Inventory | business user session (middleware); handler must authorize | — | not executed |
| A0430 | PATCH,DELETE | `/api/items/[id]/batches/[batchId]` | dynamic-template | Inventory | business user session (middleware); handler must authorize | — | not executed |
| A0431 | GET | `/api/items/[id]/bundle` | dynamic-template | Inventory | business user session (middleware); handler must authorize | — | not executed |
| A0432 | GET | `/api/items/[id]/history` | dynamic-template | Inventory | business user session (middleware); handler must authorize | — | not executed |
| A0433 | GET | `/api/items/[id]/movements` | dynamic-template | Inventory | business user session (middleware); handler must authorize | — | not executed |
| A0434 | GET,POST | `/api/items/[id]/serials` | dynamic-template | Inventory | business user session (middleware); handler must authorize | — | not executed |
| A0435 | PATCH,DELETE | `/api/items/[id]/serials/[serialId]` | dynamic-template | Inventory | business user session (middleware); handler must authorize | — | not executed |
| A0436 | POST | `/api/items/[id]/serials/bulk-import` | dynamic-template | Inventory | business user session (middleware); handler must authorize | — | not executed |
| A0437 | GET | `/api/items/[id]/transactions` | dynamic-template | Inventory | business user session (middleware); handler must authorize | — | not executed |
| A0438 | GET | `/api/items/[id]/valuation` | dynamic-template | Inventory | business user session (middleware); handler must authorize | — | not executed |
| A0439 | POST | `/api/items/bundle` | static | Inventory | business user session (middleware); handler must authorize | — | not executed |
| A0440 | POST | `/api/items/import` | static | Inventory | business user session (middleware); handler must authorize | — | not executed |
| A0441 | GET | `/api/items/labelable` | static | Inventory | business user session (middleware); handler must authorize | — | not executed |
| A0442 | POST | `/api/items/match` | static | Inventory | business user session (middleware); handler must authorize | — | not executed |
| A0443 | GET | `/api/items/search` | static | Inventory | business user session (middleware); handler must authorize | — | not executed |
| A0444 | POST | `/api/items/seo-suggest` | static | Inventory | business user session (middleware); handler must authorize | — | not executed |
| A0445 | GET,POST | `/api/journal-entries` | static | Accounting | business user session (middleware); handler must authorize | advanced_ledger | partial — phase 3C GET with the other business's id returned HTTP 403. Phase 3K POST PASS for the requests in `phase-3k-write-identity-audit-results.md`. Phase 3N live POST: identity and own entry PASS. Stale session FAIL. Phase 3O live POST PASS. The Phase 3N stale failure stays in that file. Phase 3P live GET PASS for the caller's rows, a forged business id, and a revoked cookie. Functional follow-up GET PASS for the caller's journal marker |
| A0446 | GET,PATCH,DELETE | `/api/journal-entries/[id]` | dynamic-template | Accounting | business user session (middleware); handler must authorize | advanced_ledger | not executed |
| A0447 | POST,DELETE | `/api/journal-entries/[id]/lock` | dynamic-template | Accounting | business user session (middleware); handler must authorize | advanced_ledger | not executed |
| A0448 | POST | `/api/journal-entries/[id]/reverse` | dynamic-template | Accounting | business user session (middleware); handler must authorize | advanced_ledger | not executed |
| A0449 | GET,POST | `/api/journal-entries/templates` | static | Accounting | business user session (middleware); handler must authorize | advanced_ledger | not executed |
| A0450 | GET,PATCH,DELETE | `/api/journal-entries/templates/[id]` | dynamic-template | Accounting | business user session (middleware); handler must authorize | advanced_ledger | not executed |
| A0451 | GET,POST | `/api/label-templates` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0452 | GET,PUT,DELETE | `/api/label-templates/[id]` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0453 | POST | `/api/label-templates/[id]/duplicate` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0454 | POST | `/api/labels/print` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0455 | GET,POST | `/api/leave-types` | static | Other API | business user session (middleware); handler must authorize | hr_leaves | not executed |
| A0456 | PATCH,DELETE | `/api/leave-types/[id]` | dynamic-template | Other API | business user session (middleware); handler must authorize | hr_leaves | not executed |
| A0457 | GET | `/api/ledger` | static | Accounting | business user session (middleware); handler must authorize | advanced_ledger | not executed |
| A0458 | GET | `/api/ledger/account/[accountId]` | dynamic-template | Accounting | business user session (middleware); handler must authorize | advanced_ledger | not executed |
| A0459 | GET | `/api/ledger/account/[accountId]/statement` | dynamic-template | Accounting | business user session (middleware); handler must authorize | advanced_ledger | not executed |
| A0460 | GET | `/api/ledger/account/[accountId]/statement/pdf` | dynamic-template | Accounting | business user session (middleware); handler must authorize | advanced_ledger | not executed |
| A0461 | GET | `/api/ledger/balance/[accountId]` | dynamic-template | Accounting | business user session (middleware); handler must authorize | advanced_ledger | not executed |
| A0462 | GET,POST | `/api/locations` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0463 | PATCH | `/api/locations/[id]/deactivate` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0464 | POST | `/api/locations/[id]/merge` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0465 | POST | `/api/locations/migrate-stock` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0466 | GET,POST | `/api/modules` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0467 | POST | `/api/modules/disable` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0468 | GET,PATCH | `/api/modules/primary` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0469 | GET | `/api/navigation/more` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0470 | GET | `/api/notifications` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0471 | PATCH | `/api/notifications/[id]/read` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0472 | POST | `/api/notifications/mark-all-read` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0473 | POST | `/api/notifications/popups/dismiss` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0474 | POST,PATCH | `/api/notifications/read-all` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0475 | GET | `/api/notifications/stream` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0476 | GET | `/api/offline-sync/catalog/customers` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0477 | GET | `/api/offline-sync/catalog/items` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0478 | GET | `/api/offline-sync/history` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0479 | GET | `/api/offline-sync/invoices` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0480 | POST | `/api/offline-sync/replay` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0481 | GET,POST | `/api/opening-balances` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0482 | PUT | `/api/opening-balances/validate` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0483 | GET | `/api/orders` | static | Sales | business user session (middleware); handler must authorize | — | not executed |
| A0484 | GET,POST | `/api/orders/[source]/[id]` | dynamic-template | Sales | business user session (middleware); handler must authorize | — | not executed |
| A0485 | GET,POST | `/api/orders/cod-remittances` | static | Sales | business user session (middleware); handler must authorize | — | not executed |
| A0486 | POST | `/api/orders/pick-list` | static | Sales | business user session (middleware); handler must authorize | — | not executed |
| A0487 | GET,PUT | `/api/orders/settings` | static | Sales | business user session (middleware); handler must authorize | — | not executed |
| A0488 | GET,POST | `/api/orders/shiprocket/manifest` | static | Sales | business user session (middleware); handler must authorize | — | not executed |
| A0489 | GET | `/api/partners/attributions` | static | Partner portal | partner session | — | not executed |
| A0490 | POST | `/api/partners/auth/login` | static | Partner portal | partner session | — | not executed |
| A0491 | POST | `/api/partners/auth/logout` | static | Partner portal | partner session | — | not executed |
| A0492 | POST | `/api/partners/claim` | static | Partner portal | partner session | — | not executed |
| A0493 | GET | `/api/partners/commissions` | static | Partner portal | partner session | — | not executed |
| A0494 | GET,POST | `/api/partners/deals` | static | Partner portal | partner session | — | not executed |
| A0495 | PATCH | `/api/partners/deals/[id]` | dynamic-template | Partner portal | partner session | — | not executed |
| A0496 | GET | `/api/partners/kit` | static | Partner portal | partner session | — | not executed |
| A0497 | GET | `/api/partners/kit/[id]/file` | dynamic-template | Partner portal | partner session | — | not executed |
| A0498 | GET | `/api/partners/me` | static | Partner portal | partner session | — | not executed |
| A0499 | GET | `/api/partners/payouts` | static | Partner portal | partner session | — | not executed |
| A0500 | GET,PATCH | `/api/partners/profile` | static | Partner portal | partner session | — | not executed |
| A0501 | GET,POST,PATCH | `/api/partners/team` | static | Partner portal | partner session | — | not executed |
| A0502 | GET,POST,PUT,DELETE | `/api/payment-methods` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0503 | GET,POST | `/api/payments` | static | Accounting | business user session (middleware); handler must authorize | — | partial — phase 3B GET list session check PASS. Phase 3K POST PASS for the requests in `phase-3k-write-identity-audit-results.md`. Phase 3M live GET PASS. Phase 3N live POST PASS. Phase 3P live GET PASS for the caller's rows, a forged business id, and a revoked cookie. Functional follow-up GET PASS for the caller's payment marker |
| A0504 | GET | `/api/payments/[id]` | dynamic-template | Accounting | business user session (middleware); handler must authorize | — | partial — phase 3A one cross-tenant GET |
| A0505 | GET | `/api/payments/[id]/history` | dynamic-template | Accounting | business user session (middleware); handler must authorize | — | not executed |
| A0506 | GET | `/api/payments/[id]/receipt` | dynamic-template | Accounting | business user session (middleware); handler must authorize | — | not executed |
| A0507 | GET | `/api/payments/[id]/receipt/pdf` | dynamic-template | Accounting | business user session (middleware); handler must authorize | — | not executed |
| A0508 | POST | `/api/payments/[id]/reverse` | dynamic-template | Accounting | business user session (middleware); handler must authorize | — | not executed |
| A0509 | POST | `/api/payments/manual-action` | static | Accounting | business user session (middleware); handler must authorize | — | not executed |
| A0510 | POST | `/api/payments/restore` | static | Accounting | business user session (middleware); handler must authorize | — | not executed |
| A0511 | GET,POST | `/api/payments/return/easebuzz` | static | Accounting | middleware-public (provider signature expected in handler) | — | not executed |
| A0512 | POST | `/api/payments/upi-collect` | static | Accounting | business user session (middleware); handler must authorize | — | not executed |
| A0513 | POST | `/api/payments/webhook/[provider]` | dynamic-template | Accounting | middleware-public (provider signature expected in handler) | — | not executed |
| A0514 | POST | `/api/payments/webhook/easebuzz` | static | Accounting | middleware-public (provider signature expected in handler) | — | not executed |
| A0515 | POST | `/api/payments/webhook/instamojo` | static | Accounting | middleware-public (provider signature expected in handler) | — | not executed |
| A0516 | POST | `/api/payments/webhook/payu` | static | Accounting | middleware-public (provider signature expected in handler) | — | not executed |
| A0517 | POST | `/api/payments/webhook/phonepe` | static | Accounting | middleware-public (provider signature expected in handler) | — | not executed |
| A0518 | GET,POST,DELETE | `/api/period-locks` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0519 | GET | `/api/permissions` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0520 | GET | `/api/permissions/modules` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0521 | GET | `/api/policies` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0522 | GET,POST | `/api/pricing/party-item` | static | Other API | business user session (middleware); handler must authorize | party_pricing | not executed |
| A0523 | POST | `/api/print/render` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0524 | GET | `/api/promotions/active` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0525 | POST | `/api/promotions/track` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0526 | GET,POST | `/api/provisions` | static | Other API | business user session (middleware); handler must authorize | accounting_provisions | not executed |
| A0527 | GET,PATCH,DELETE | `/api/provisions/[id]` | dynamic-template | Other API | business user session (middleware); handler must authorize | accounting_provisions | not executed |
| A0528 | GET,POST | `/api/provisions/[id]/entries` | dynamic-template | Other API | business user session (middleware); handler must authorize | accounting_provisions | not executed |
| A0529 | POST | `/api/public/assistant/action` | static | Public API | middleware-public (own auth in handler) | — | not executed |
| A0530 | GET,POST | `/api/public/assistant/chat` | static | Public API | middleware-public (own auth in handler) | — | not executed |
| A0531 | GET | `/api/public/assistant/conversation/[id]` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0532 | POST | `/api/public/assistant/feedback` | static | Public API | middleware-public (own auth in handler) | — | not executed |
| A0533 | GET | `/api/public/candidate/[slug]` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0534 | POST | `/api/public/candidate/[slug]/request-otp` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0535 | POST | `/api/public/candidate/[slug]/verify-otp` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0536 | GET,POST | `/api/public/candidate/session/documents` | static | Public API | middleware-public (own auth in handler) | — | not executed |
| A0537 | POST | `/api/public/candidate/session/logout` | static | Public API | middleware-public (own auth in handler) | — | not executed |
| A0538 | GET | `/api/public/candidate/session/me` | static | Public API | middleware-public (own auth in handler) | — | not executed |
| A0539 | GET,PATCH | `/api/public/candidate/session/offer` | static | Public API | middleware-public (own auth in handler) | — | not executed |
| A0540 | GET | `/api/public/candidate/session/offer/pdf` | static | Public API | middleware-public (own auth in handler) | — | not executed |
| A0541 | GET | `/api/public/candidate/session/tasks` | static | Public API | middleware-public (own auth in handler) | — | not executed |
| A0542 | GET,PATCH | `/api/public/candidate/session/tasks/[taskId]` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0543 | POST,PATCH | `/api/public/candidate/session/tasks/[taskId]/files` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0544 | POST | `/api/public/candidate/session/tasks/[taskId]/identity/[docKey]` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0545 | GET | `/api/public/employee/[slug]` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0546 | POST | `/api/public/employee/[slug]/forgot-password` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0547 | POST | `/api/public/employee/[slug]/login` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0548 | POST | `/api/public/employee/[slug]/reset-password` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0549 | GET | `/api/public/employee/portal/dashboard` | static | Public API | middleware-public (own auth in handler) | — | not executed |
| A0550 | GET,POST | `/api/public/employee/portal/engagement` | static | Public API | middleware-public (own auth in handler) | — | not executed |
| A0551 | GET | `/api/public/employee/portal/leave-insights` | static | Public API | middleware-public (own auth in handler) | — | not executed |
| A0552 | GET | `/api/public/employee/portal/profile` | static | Public API | middleware-public (own auth in handler) | — | not executed |
| A0553 | GET,POST,DELETE | `/api/public/employee/portal/resignation` | static | Public API | middleware-public (own auth in handler) | — | not executed |
| A0554 | GET,POST,PATCH | `/api/public/employee/portal/tasks` | static | Public API | middleware-public (own auth in handler) | — | not executed |
| A0555 | POST | `/api/public/employee/session/change-password` | static | Public API | middleware-public (own auth in handler) | — | not executed |
| A0556 | POST | `/api/public/employee/session/logout` | static | Public API | middleware-public (own auth in handler) | — | not executed |
| A0557 | GET | `/api/public/employee/session/me` | static | Public API | middleware-public (own auth in handler) | — | not executed |
| A0558 | GET | `/api/public/i/[token]` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0559 | GET | `/api/public/i/[token]/pdf` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0560 | POST | `/api/public/i/[token]/view` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0561 | GET | `/api/public/meta-pixel` | static | Public API | middleware-public (own auth in handler) | — | not executed |
| A0562 | POST | `/api/public/platform-otp` | static | Public API | middleware-public (own auth in handler) | — | not executed |
| A0563 | GET | `/api/public/portal/[slug]` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0564 | POST | `/api/public/portal/[slug]/request-otp` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0565 | POST | `/api/public/portal/[slug]/verify-otp` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0566 | GET | `/api/public/portal/session/invoices` | static | Public API | middleware-public (own auth in handler) | — | not executed |
| A0567 | POST | `/api/public/portal/session/logout` | static | Public API | middleware-public (own auth in handler) | — | not executed |
| A0568 | GET | `/api/public/pricing` | static | Public API | middleware-public (own auth in handler) | — | not executed |
| A0569 | GET,POST | `/api/public/rider/[token]` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0570 | GET | `/api/public/sales-funnel/lead-prefill` | static | Public API | middleware-public (own auth in handler) | — | not executed |
| A0571 | GET | `/api/public/store/[subdomain]` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0572 | GET,POST | `/api/public/store/[subdomain]/account` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0573 | POST | `/api/public/store/[subdomain]/enquiries` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0574 | GET,POST,DELETE | `/api/public/store/[subdomain]/favorites` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0575 | GET | `/api/public/store/[subdomain]/items` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0576 | GET | `/api/public/store/[subdomain]/items/[id]` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0577 | POST | `/api/public/store/[subdomain]/orders` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0578 | GET,POST | `/api/public/store/[subdomain]/orders/[id]/return` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0579 | POST | `/api/public/store/[subdomain]/otp` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0580 | POST | `/api/public/store/[subdomain]/quote` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0581 | POST | `/api/public/store/[subdomain]/ratings` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0582 | GET,POST | `/api/public/wa-shop/[token]` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0583 | GET | `/api/public/wa-shop/image/[itemId]` | dynamic-template | Public API | middleware-public (own auth in handler) | — | not executed |
| A0584 | GET,POST | `/api/purchase-orders` | static | Purchases | business user session (middleware); handler must authorize | purchase_orders | partial — Phase 3I POST FAIL stays in that file. Phase 3J POST regression PASS for the requests in `phase-3j-write-identity-fix-results.md`. Phase 3M live POST PASS. Phase 3N live GET FAIL for a forged query and a stale session. Phase 3O live GET PASS in `phase-3o-live-http-security-fix-results.md`. The Phase 3N failure stays in that file. Phase 3P live POST PASS and live GET status filter PASS. Search and pagination are not parameters of this GET. Functional follow-up stored the submitted header `100.00` / `18.00` / `118.00` and line total `118.00` |
| A0585 | GET | `/api/purchase-orders/[id]` | dynamic-template | Purchases | business user session (middleware); handler must authorize | purchase_orders | not executed |
| A0586 | POST | `/api/purchase-orders/[id]/comments` | dynamic-template | Purchases | business user session (middleware); handler must authorize | purchase_orders | not executed |
| A0587 | POST | `/api/purchase-orders/[id]/convert` | dynamic-template | Purchases | business user session (middleware); handler must authorize | purchase_orders | not executed |
| A0588 | GET | `/api/purchase-orders/[id]/history` | dynamic-template | Purchases | business user session (middleware); handler must authorize | purchase_orders | not executed |
| A0589 | GET,POST | `/api/purchase-returns` | static | Purchases | business user session (middleware); handler must authorize | purchase_management | partial — Phase 3K POST FAIL stays in that file. Phase 3L POST regression PASS for the requests in `phase-3l-write-identity-fix-results.md`. Phase 3M live POST PASS. Phase 3N live GET FAIL for a forged query and a stale session. Phase 3O live GET PASS in `phase-3o-live-http-security-fix-results.md`. The Phase 3N failure stays in that file. Phase 3P live POST PASS. Live GET search and page/limit PASS. Functional follow-up: grand total `30.00`, supplier `40.00` to `10.00`, movement location `0` to `-2`, ledger `60` / `60` on 4 lines. Search and page/limit PASS again |
| A0590 | GET,PATCH | `/api/purchase-returns/[id]` | dynamic-template | Purchases | business user session (middleware); handler must authorize | purchase_management | not executed |
| A0591 | POST | `/api/purchase-returns/[id]/cancel` | dynamic-template | Purchases | business user session (middleware); handler must authorize | purchase_management | partial — Phase 3P live POST PASS for the caller's return and for the other business's id. Missing reason was not sent. Functional follow-up restored supplier to `40.00`, stock to `0`, and left ledger `120` / `120` with 0 active lines |
| A0592 | GET,POST | `/api/purchases` | static | Purchases | business user session (middleware); handler must authorize | purchase_management | partial — phase 3B GET list session check PASS. Phase 3K POST PASS for the requests in `phase-3k-write-identity-audit-results.md`. Cancelled-bill filters PASS with authorize stubbed. Phase 3M live GET PASS. Phase 3N live POST PASS. Phase 3P live GET PASS for the caller's rows, a forged business id, and a revoked cookie. Functional follow-up GET PASS for the caller's purchase marker |
| A0593 | GET,PUT,PATCH,DELETE | `/api/purchases/[id]` | dynamic-template | Purchases | business user session (middleware); handler must authorize | purchase_management | partial — phase 3A one cross-tenant GET; PUT, PATCH, and DELETE not executed |
| A0594 | POST | `/api/purchases/[id]/cancel` | dynamic-template | Purchases | business user session (middleware); handler must authorize | purchase_management | not executed |
| A0595 | PATCH | `/api/purchases/[id]/finalize` | dynamic-template | Purchases | business user session (middleware); handler must authorize | purchase_management | not executed |
| A0596 | GET | `/api/purchases/[id]/history` | dynamic-template | Purchases | business user session (middleware); handler must authorize | purchase_management | not executed |
| A0597 | GET | `/api/purchases/[id]/labels` | dynamic-template | Purchases | business user session (middleware); handler must authorize | purchase_management | not executed |
| A0598 | PATCH | `/api/purchases/[id]/payments` | dynamic-template | Purchases | business user session (middleware); handler must authorize | purchase_management | not executed |
| A0599 | GET | `/api/purchases/[id]/pdf` | dynamic-template | Purchases | business user session (middleware); handler must authorize | purchase_management | not executed |
| A0600 | GET | `/api/purchases/incoming-bills` | static | Purchases | business user session (middleware); handler must authorize | purchase_management | not executed |
| A0601 | GET | `/api/purchases/incoming-bills/[invoiceId]` | dynamic-template | Purchases | business user session (middleware); handler must authorize | purchase_management | not executed |
| A0602 | POST | `/api/purchases/incoming-bills/[invoiceId]/create-item` | dynamic-template | Purchases | business user session (middleware); handler must authorize | purchase_management | not executed |
| A0603 | POST | `/api/purchases/restore` | static | Purchases | business user session (middleware); handler must authorize | purchase_management | not executed |
| A0604 | GET,POST | `/api/recurring-invoices` | static | Sales | business user session (middleware); handler must authorize | sales_recurring_invoices | partial — Phase 3K POST FAIL stays in that file. Phase 3L POST regression PASS for the requests in `phase-3l-write-identity-fix-results.md`. Phase 3M live POST PASS. Phase 3N live GET: forged business id PASS. Stale session FAIL. Phase 3O live GET PASS. The Phase 3N stale failure stays in that file. Phase 3P live POST PASS for the caller's definition and for the other business's item. Functional follow-up POST PASS, then `run_now` stored `invoice_date` `2026-10-19` and grand total `25.00` |
| A0605 | GET,POST,PATCH | `/api/recurring-invoices/[id]` | dynamic-template | Sales | business user session (middleware); handler must authorize | sales_recurring_invoices | partial — Phase 3P live POST `run_now` created one invoice on the caller and rejected the other business's item with no invoice. The run date was the previous calendar day. That FAIL stays in `phase-3p-live-workflow-results.md`. Phase 3Q live POST PASS: persisted `invoice_date` `2026-10-19`. GET and PATCH were not called. Functional follow-up POST `run_now` PASS with the same stored date and grand total `25.00` |
| A0606 | GET | `/api/reports/aging/payables` | static | Reports | business user session (middleware); handler must authorize | reports_advanced | not executed |
| A0607 | GET | `/api/reports/aging/receivables` | static | Reports | business user session (middleware); handler must authorize | reports_advanced | not executed |
| A0608 | GET | `/api/reports/balance-sheet` | static | Reports | business user session (middleware); handler must authorize | reports_advanced | not executed |
| A0609 | GET | `/api/reports/balance-sheet/pdf` | static | Reports | business user session (middleware); handler must authorize | reports_advanced | not executed |
| A0610 | GET | `/api/reports/cash-flow` | static | Reports | business user session (middleware); handler must authorize | reports_advanced | not executed |
| A0611 | GET | `/api/reports/cash-flow/pdf` | static | Reports | business user session (middleware); handler must authorize | reports_advanced | not executed |
| A0612 | GET | `/api/reports/credit-risk` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0613 | GET,POST | `/api/reports/custom` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0614 | GET | `/api/reports/deleted-items` | static | Reports | business user session (middleware); handler must authorize | reports_basic | partial — GET type=all for a deleted invoice and supplier; purchase and payment rows not seeded |
| A0615 | GET | `/api/reports/expense/category-wise` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0616 | GET | `/api/reports/expense/cost-center` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0617 | GET | `/api/reports/expense/expense-vs-sales` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0618 | GET | `/api/reports/expense/monthly-profit` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0619 | GET | `/api/reports/expense/profit-loss` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0620 | GET | `/api/reports/expense/summary` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0621 | POST | `/api/reports/generate` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0622 | GET | `/api/reports/gst/gstr1` | static | Reports | business user session (middleware); handler must authorize | reports_gst | not executed |
| A0623 | POST | `/api/reports/gst/gstr1/[filingId]/mark-filed` | dynamic-template | Reports | business user session (middleware); handler must authorize | reports_gst | not executed |
| A0624 | GET | `/api/reports/gst/gstr1/export/excel` | static | Reports | business user session (middleware); handler must authorize | reports_gst | not executed |
| A0625 | GET | `/api/reports/gst/gstr1/filings` | static | Reports | business user session (middleware); handler must authorize | reports_gst | not executed |
| A0626 | GET | `/api/reports/gst/gstr2b` | static | Reports | business user session (middleware); handler must authorize | reports_gst | not executed |
| A0627 | GET | `/api/reports/gst/gstr3b` | static | Reports | business user session (middleware); handler must authorize | reports_gst | not executed |
| A0628 | GET | `/api/reports/gst/gstr9` | static | Reports | business user session (middleware); handler must authorize | reports_gst | not executed |
| A0629 | GET | `/api/reports/gst/reconciliation` | static | Reports | business user session (middleware); handler must authorize | reports_gst | not executed |
| A0630 | GET | `/api/reports/gst/reconciliation/alerts` | static | Reports | business user session (middleware); handler must authorize | reports_gst | not executed |
| A0631 | POST | `/api/reports/gst/reconciliation/alerts/[id]/notify` | dynamic-template | Reports | business user session (middleware); handler must authorize | reports_gst | not executed |
| A0632 | POST | `/api/reports/gst/reconciliation/alerts/[id]/resolve` | dynamic-template | Reports | business user session (middleware); handler must authorize | reports_gst | not executed |
| A0633 | POST | `/api/reports/gst/reconciliation/alerts/generate` | static | Reports | business user session (middleware); handler must authorize | reports_gst | not executed |
| A0634 | GET | `/api/reports/gst/reconciliation/alerts/history` | static | Reports | business user session (middleware); handler must authorize | reports_gst | not executed |
| A0635 | GET,POST | `/api/reports/gst/reconciliation/alerts/prefs` | static | Reports | business user session (middleware); handler must authorize | reports_gst | not executed |
| A0636 | GET | `/api/reports/inter-branch-reconciliation` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0637 | GET | `/api/reports/label-print-log` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0638 | GET | `/api/reports/party/advances` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0639 | GET | `/api/reports/party/ageing` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0640 | GET | `/api/reports/party/ledger` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0641 | GET | `/api/reports/party/payables` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0642 | GET | `/api/reports/party/receivables` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0643 | GET | `/api/reports/party/statement` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0644 | GET | `/api/reports/party/statement/pdf` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0645 | GET | `/api/reports/profit-by-invoice` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0646 | GET | `/api/reports/profit-loss` | static | Reports | business user session (middleware); handler must authorize | reports_advanced | partial — phase 3C GET with the other business's id returned HTTP 403 |
| A0647 | GET | `/api/reports/profit-loss/drilldown` | static | Reports | business user session (middleware); handler must authorize | reports_advanced | not executed |
| A0648 | GET | `/api/reports/profit-loss/excel` | static | Reports | business user session (middleware); handler must authorize | reports_advanced | not executed |
| A0649 | GET | `/api/reports/profit-loss/pdf` | static | Reports | business user session (middleware); handler must authorize | reports_advanced | not executed |
| A0650 | GET | `/api/reports/purchase-summary` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0651 | GET | `/api/reports/purchase/credit` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0652 | GET | `/api/reports/purchase/invoice-wise` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0653 | GET | `/api/reports/purchase/item-wise` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0654 | GET | `/api/reports/purchase/returns` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0655 | GET | `/api/reports/purchase/summary` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0656 | GET | `/api/reports/purchase/supplier-wise` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0657 | GET | `/api/reports/purchase/tax-wise` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0658 | GET | `/api/reports/sales-summary` | static | Reports | business user session (middleware); handler must authorize | reports_basic | partial — phase 3C GET with the other business's id returned HTTP 403 |
| A0659 | GET | `/api/reports/sales/b2b-b2c` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0660 | GET | `/api/reports/sales/cancelled` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0661 | GET | `/api/reports/sales/credit` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0662 | GET | `/api/reports/sales/discount` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0663 | GET | `/api/reports/sales/invoice-wise` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0664 | GET | `/api/reports/sales/item-wise` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0665 | GET | `/api/reports/sales/party-wise` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0666 | GET | `/api/reports/sales/payment-mode` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0667 | GET | `/api/reports/sales/returns` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0668 | GET | `/api/reports/sales/summary` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0669 | GET | `/api/reports/sales/tax-wise` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0670 | GET | `/api/reports/stock-summary` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0671 | GET,POST | `/api/reports/stock/closing-stock` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0672 | POST | `/api/reports/stock/closing-stock/audit` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0673 | POST | `/api/reports/stock/closing-stock/finalize` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0674 | GET | `/api/reports/stock/damaged` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0675 | GET | `/api/reports/stock/expired` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0676 | GET | `/api/reports/stock/expiry` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0677 | GET | `/api/reports/stock/fifo-lots` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0678 | GET | `/api/reports/stock/low-stock` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0679 | GET | `/api/reports/stock/low-stock-warehouse` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0680 | GET | `/api/reports/stock/movement` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0681 | GET | `/api/reports/stock/profit-margin` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0682 | GET | `/api/reports/stock/purchase-vs-sales` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0683 | GET | `/api/reports/stock/summary` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0684 | GET | `/api/reports/stock/valuation` | static | Reports | business user session (middleware); handler must authorize | reports_basic | not executed |
| A0685 | GET | `/api/reports/trial-balance` | static | Reports | business user session (middleware); handler must authorize | reports_advanced | not executed |
| A0686 | GET | `/api/reports/trial-balance/pdf` | static | Reports | business user session (middleware); handler must authorize | reports_advanced | not executed |
| A0687 | GET,POST | `/api/returns` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0688 | GET,PATCH | `/api/returns/[id]` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0689 | GET,POST | `/api/roles/[id]/permissions` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0690 | GET,POST | `/api/sales-orders` | static | Sales | business user session (middleware); handler must authorize | sales_sales_orders | partial — phase 3F GET PASS. Phase 3G POST FAIL stays in that file. Phase 3H POST regression PASS for the requests in `phase-3h-write-identity-fix-results.md`. Phase 3M live GET and POST PASS |
| A0691 | GET,PUT | `/api/sales-orders/[id]` | dynamic-template | Sales | business user session (middleware); handler must authorize | sales_sales_orders | not executed |
| A0692 | POST | `/api/sales-orders/[id]/convert` | dynamic-template | Sales | business user session (middleware); handler must authorize | sales_sales_orders | not executed |
| A0693 | GET | `/api/sales-orders/[id]/payment-summary` | dynamic-template | Sales | business user session (middleware); handler must authorize | sales_sales_orders | not executed |
| A0694 | GET | `/api/search` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0695 | GET,PATCH | `/api/settings/account-mappings` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0696 | POST | `/api/settings/account-mappings/auto-detect` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0697 | GET | `/api/settings/activity-logs` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0698 | GET,POST | `/api/settings/ai-config` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0699 | GET,PATCH | `/api/settings/attendance-policy` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0700 | GET,PATCH | `/api/settings/attendance-regularization` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0701 | GET,PATCH | `/api/settings/customer-surface` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0702 | GET,PATCH | `/api/settings/document-language` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0703 | GET,POST,PUT | `/api/settings/email` | static | Settings | business user session (middleware); handler must authorize | integration_email | not executed |
| A0704 | GET,PATCH | `/api/settings/gst-filing` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0705 | GET,POST | `/api/settings/holiday-lists` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0706 | PATCH,DELETE | `/api/settings/holiday-lists/[id]` | dynamic-template | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0707 | GET,PATCH | `/api/settings/hr-approval` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0708 | GET,PATCH | `/api/settings/hr-employee` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0709 | GET,PATCH | `/api/settings/hr-exit` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0710 | GET,PATCH | `/api/settings/hr-hiring` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0711 | GET,PATCH | `/api/settings/hr-org-catalog` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0712 | GET,PATCH | `/api/settings/hr-payroll` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0713 | GET,PATCH | `/api/settings/hr-portal` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0714 | GET,PUT | `/api/settings/invoice-defaults` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0715 | GET,PATCH | `/api/settings/item-sales-stock` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0716 | GET,PATCH | `/api/settings/leave-plan` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0717 | GET,PUT | `/api/settings/number-series` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0718 | GET,PATCH | `/api/settings/offer-letter-template` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0719 | GET,POST | `/api/settings/offer-letter-template/preview` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0720 | GET,PATCH | `/api/settings/online-store` | static | Settings | business user session (middleware); handler must authorize | advanced_online_store | not executed |
| A0721 | GET,POST,DELETE | `/api/settings/online-store/coupons` | static | Settings | business user session (middleware); handler must authorize | advanced_online_store | not executed |
| A0722 | GET,PUT | `/api/settings/online-store/delivery` | static | Settings | business user session (middleware); handler must authorize | advanced_online_store | not executed |
| A0723 | GET,PATCH | `/api/settings/online-store/enquiries` | static | Settings | business user session (middleware); handler must authorize | advanced_online_store | not executed |
| A0724 | GET,PATCH | `/api/settings/online-store/orders` | static | Settings | business user session (middleware); handler must authorize | advanced_online_store | not executed |
| A0725 | POST | `/api/settings/online-store/preview-draft` | static | Settings | business user session (middleware); handler must authorize | advanced_online_store | not executed |
| A0726 | GET,PUT,DELETE | `/api/settings/online-store/studio-draft` | static | Settings | business user session (middleware); handler must authorize | advanced_online_store | not executed |
| A0727 | GET,PATCH | `/api/settings/ot-policy` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0728 | GET,POST | `/api/settings/payment-providers` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0729 | GET,PATCH | `/api/settings/payments` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0730 | GET | `/api/settings/permissions` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0731 | GET,PATCH | `/api/settings/portal-theme` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0732 | GET,PATCH | `/api/settings/product-variants` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0733 | GET,POST | `/api/settings/roles` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0734 | DELETE | `/api/settings/roles/[id]` | dynamic-template | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0735 | GET,PATCH | `/api/settings/roles/[id]/permissions` | dynamic-template | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0736 | POST | `/api/settings/roles/ensure-primary-admin-permissions` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0737 | POST | `/api/settings/roles/initialize` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0738 | GET,POST | `/api/settings/salary-components` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0739 | PATCH | `/api/settings/salary-components/[id]` | dynamic-template | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0740 | GET,PATCH | `/api/settings/user-management` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0741 | GET,POST | `/api/settings/users` | static | Settings | business user session (middleware); handler must authorize | settings_multi_user | not executed |
| A0742 | GET,PATCH,DELETE | `/api/settings/users/[id]` | dynamic-template | Settings | business user session (middleware); handler must authorize | settings_multi_user | not executed |
| A0743 | GET,PATCH | `/api/settings/users/[id]/warehouses` | dynamic-template | Settings | business user session (middleware); handler must authorize | settings_multi_user | not executed |
| A0744 | POST | `/api/settings/users/fix-roles` | static | Settings | business user session (middleware); handler must authorize | settings_multi_user | not executed |
| A0745 | GET,PATCH | `/api/settings/warehouses` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0746 | GET,PATCH | `/api/settings/weekly-off` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0747 | GET,PATCH | `/api/settings/whatsapp-bot` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0748 | GET,PUT | `/api/settings/whatsapp-cloud` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0749 | GET,POST | `/api/settings/whatsapp-templates` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0750 | PATCH,DELETE | `/api/settings/whatsapp-templates/[id]` | dynamic-template | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0751 | POST | `/api/settings/whatsapp-templates/[id]/submit` | dynamic-template | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0752 | GET,PUT | `/api/settings/whatsapp-templates/events` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0753 | POST | `/api/settings/whatsapp-templates/events/[key]/suggest` | dynamic-template | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0754 | POST | `/api/settings/whatsapp-templates/sync` | static | Settings | business user session (middleware); handler must authorize | — | not executed |
| A0755 | GET,POST | `/api/shifts` | static | Other API | business user session (middleware); handler must authorize | hr_shifts | not executed |
| A0756 | PATCH,DELETE | `/api/shifts/[id]` | dynamic-template | Other API | business user session (middleware); handler must authorize | hr_shifts | not executed |
| A0757 | POST | `/api/signup` | static | Other API | middleware-public | — | not executed |
| A0758 | GET | `/api/socket.io` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0759 | POST | `/api/staff-app/challenge` | static | Other API | middleware-public (own auth in handler) | — | not executed |
| A0760 | POST | `/api/staff-app/face/enroll` | static | Other API | middleware-public (own auth in handler) | — | not executed |
| A0761 | POST | `/api/staff-app/pair` | static | Other API | middleware-public (own auth in handler) | — | not executed |
| A0762 | POST | `/api/staff-app/punch` | static | Other API | middleware-public (own auth in handler) | — | not executed |
| A0763 | GET | `/api/staff-app/status` | static | Other API | middleware-public (own auth in handler) | — | not executed |
| A0764 | GET,POST | `/api/stock-requests` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0765 | PATCH | `/api/stock-requests/[id]` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0766 | GET | `/api/stock-requests/[id]/events` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0767 | POST | `/api/stock-requests/[id]/link` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0768 | POST | `/api/stock-requests/[id]/respond` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0769 | POST | `/api/stock-requests/[id]/spawn-upstream` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0770 | GET | `/api/stock-requests/reorder-suggestions` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0771 | GET | `/api/stock-requests/summary` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0772 | GET,POST | `/api/stock-transfers` | static | Inventory | business user session (middleware); handler must authorize | settings_multi_warehouse | partial — phase 3A GET list only. Phase 3K POST FAIL stays in that file. Phase 3L POST regression PASS for the requests in `phase-3l-write-identity-fix-results.md`. Phase 3M live POST PASS. Phase 3N live GET PASS |
| A0773 | POST | `/api/stock-transfers/[id]/approve` | dynamic-template | Inventory | business user session (middleware); handler must authorize | settings_multi_warehouse | not executed |
| A0774 | PATCH | `/api/stock-transfers/[id]/cancel` | dynamic-template | Inventory | business user session (middleware); handler must authorize | settings_multi_warehouse | not executed |
| A0775 | PATCH | `/api/stock-transfers/[id]/dispatch` | dynamic-template | Inventory | business user session (middleware); handler must authorize | settings_multi_warehouse | partial — Phase 3P live PATCH PASS for the caller's pending transfer and for the other business's id. Insufficient stock was not sent. Functional follow-up: source `5.000` to `4.000`, status `in_transit`, movement out quantity 1 |
| A0776 | GET | `/api/stock-transfers/[id]/items` | dynamic-template | Inventory | business user session (middleware); handler must authorize | settings_multi_warehouse | not executed |
| A0777 | POST | `/api/stock-transfers/[id]/receive` | dynamic-template | Inventory | business user session (middleware); handler must authorize | settings_multi_warehouse | partial — Phase 3P live POST PASS for the caller's in-transit transfer and for the other business's id. A partial receipt was not sent. Functional follow-up: destination `8.000` to `9.000`, status `completed`, movement in quantity 1 |
| A0778 | GET | `/api/subscriptions/addons` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0779 | POST | `/api/subscriptions/addons/[type]/purchase` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0780 | GET | `/api/subscriptions/addons/current` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0781 | GET | `/api/subscriptions/addons/debug` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0782 | GET | `/api/subscriptions/billing-history` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0783 | POST | `/api/subscriptions/cancel` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0784 | POST | `/api/subscriptions/cancel-downgrade` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0785 | GET | `/api/subscriptions/check-limit` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0786 | POST | `/api/subscriptions/checkout` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0787 | POST | `/api/subscriptions/coupons/validate` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0788 | GET,POST | `/api/subscriptions/current` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0789 | GET | `/api/subscriptions/debug` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0790 | POST | `/api/subscriptions/downgrade` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0791 | POST | `/api/subscriptions/ensure-subscription` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0792 | GET | `/api/subscriptions/feature-plan` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0793 | GET | `/api/subscriptions/limit-plan` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0794 | GET | `/api/subscriptions/modules/current` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0795 | GET | `/api/subscriptions/plans` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0796 | GET,POST | `/api/subscriptions/trial-extension` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0797 | POST | `/api/subscriptions/upgrade` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0798 | GET | `/api/subscriptions/web-access` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0799 | GET,POST | `/api/suppliers` | static | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | partial — phase 3A and phase 3C GET returned HTTP 403 for the other business. Phase 3I POST FAIL stays in that file. Phase 3J POST regression PASS for the requests in `phase-3j-write-identity-fix-results.md`. Phase 3M live POST PASS. Phase 3N live GET PASS |
| A0800 | GET,PUT,DELETE | `/api/suppliers/[id]` | dynamic-template | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | partial — phase 3A one cross-tenant GET; PUT and DELETE not executed |
| A0801 | GET,POST,DELETE | `/api/suppliers/[id]/aliases` | dynamic-template | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0802 | POST | `/api/suppliers/[id]/approve` | dynamic-template | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0803 | GET | `/api/suppliers/[id]/history` | dynamic-template | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0804 | GET,POST,DELETE | `/api/suppliers/[id]/item-links` | dynamic-template | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0805 | GET,POST | `/api/suppliers/[id]/items` | dynamic-template | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0806 | GET | `/api/suppliers/check-duplicate` | static | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0807 | GET | `/api/suppliers/dashboard` | static | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0808 | GET | `/api/suppliers/dashboard/analytics` | static | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0809 | POST | `/api/suppliers/dashboard/dismiss-alert` | static | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0810 | GET,POST | `/api/suppliers/hub/collections` | static | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0811 | PATCH,DELETE | `/api/suppliers/hub/collections/[id]` | dynamic-template | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0812 | GET,POST | `/api/suppliers/hub/connection-requests` | static | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0813 | PATCH | `/api/suppliers/hub/connection-requests/[id]` | dynamic-template | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0814 | GET | `/api/suppliers/hub/directory` | static | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0815 | GET,PATCH | `/api/suppliers/hub/discovery` | static | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0816 | GET | `/api/suppliers/hub/home` | static | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0817 | GET,DELETE | `/api/suppliers/hub/link` | static | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0818 | POST | `/api/suppliers/hub/linked-customer` | static | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0819 | POST | `/api/suppliers/hub/mute` | static | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0820 | GET | `/api/suppliers/hub/new-arrivals` | static | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0821 | GET | `/api/suppliers/hub/profile/[businessId]` | dynamic-template | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0822 | GET,POST | `/api/suppliers/hub/published-listings` | static | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0823 | PATCH,DELETE | `/api/suppliers/hub/published-listings/[id]` | dynamic-template | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0824 | GET | `/api/suppliers/lookup-customer` | static | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0825 | POST | `/api/suppliers/match` | static | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0826 | GET | `/api/suppliers/requests` | static | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0827 | POST | `/api/suppliers/restore` | static | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0828 | GET | `/api/suppliers/search-business` | static | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0829 | GET,POST,DELETE | `/api/suppliers/thresholds` | static | Purchases | business user session (middleware); handler must authorize | purchase_suppliers | not executed |
| A0830 | GET,POST | `/api/supply-orders` | static | Purchases | business user session (middleware); handler must authorize | — | not executed |
| A0831 | GET,PATCH | `/api/supply-orders/[id]` | dynamic-template | Purchases | business user session (middleware); handler must authorize | — | not executed |
| A0832 | GET | `/api/supply-orders/[id]/invoice-draft` | dynamic-template | Purchases | business user session (middleware); handler must authorize | — | not executed |
| A0833 | POST | `/api/supply-orders/suggest` | static | Purchases | business user session (middleware); handler must authorize | — | not executed |
| A0834 | GET,POST | `/api/tasks` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0835 | PATCH,DELETE | `/api/tasks/[id]` | dynamic-template | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0836 | GET,POST | `/api/tax-provisions` | static | Other API | business user session (middleware); handler must authorize | accounting_provisions | not executed |
| A0837 | GET,POST | `/api/tax-provisions/[id]/payments` | dynamic-template | Other API | business user session (middleware); handler must authorize | accounting_provisions | not executed |
| A0838 | GET,POST | `/api/tds/categories` | static | Other API | business user session (middleware); handler must authorize | accounting_tds | not executed |
| A0839 | GET,PUT,DELETE | `/api/tds/categories/[id]` | dynamic-template | Other API | business user session (middleware); handler must authorize | accounting_tds | not executed |
| A0840 | GET,POST | `/api/tds/certificates` | static | Other API | business user session (middleware); handler must authorize | accounting_tds | not executed |
| A0841 | GET | `/api/tds/certificates/[id]/pdf` | dynamic-template | Other API | business user session (middleware); handler must authorize | accounting_tds | not executed |
| A0842 | POST | `/api/tds/deduct` | static | Other API | business user session (middleware); handler must authorize | accounting_tds | not executed |
| A0843 | GET,POST | `/api/tds/payments` | static | Other API | business user session (middleware); handler must authorize | accounting_tds | not executed |
| A0844 | GET | `/api/tds/reports/summary` | static | Other API | business user session (middleware); handler must authorize | accounting_tds | not executed |
| A0845 | GET | `/api/tds/transactions` | static | Other API | business user session (middleware); handler must authorize | accounting_tds | not executed |
| A0846 | GET,POST,PUT | `/api/template-assignments` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0847 | GET | `/api/template-catalog` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0848 | GET,POST | `/api/template-preview` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0849 | GET | `/api/template-preview-image` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0850 | POST | `/api/templates/copy` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0851 | GET,POST | `/api/todos` | static | Other API | business user session (middleware); handler must authorize | tools_todo | not executed |
| A0852 | GET,PATCH,DELETE | `/api/todos/[id]` | dynamic-template | Other API | business user session (middleware); handler must authorize | tools_todo | not executed |
| A0853 | POST | `/api/todos/[id]/snooze` | dynamic-template | Other API | business user session (middleware); handler must authorize | tools_todo | not executed |
| A0854 | GET | `/api/todos/check-reminders` | static | Other API | business user session (middleware); handler must authorize | tools_todo | not executed |
| A0855 | GET | `/api/todos/stats` | static | Other API | business user session (middleware); handler must authorize | tools_todo | not executed |
| A0856 | GET | `/api/todos/users` | static | Other API | business user session (middleware); handler must authorize | tools_todo | not executed |
| A0857 | POST | `/api/tools/google-leads/export` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0858 | POST | `/api/tools/google-leads/search` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0859 | GET,POST | `/api/tools/whatsapp-groups` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0860 | POST | `/api/upload/attachments` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0861 | POST | `/api/upload/image` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0862 | GET,POST,DELETE | `/api/user-branches` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0863 | GET,POST,DELETE | `/api/user-warehouses` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0864 | PATCH | `/api/user/product-tour` | static | Other API | business user session (middleware); handler must authorize | — | not executed |
| A0865 | GET,POST | `/api/warehouses` | static | Other API | business user session (middleware); handler must authorize | settings_multi_warehouse | not executed |
| A0866 | GET,PATCH,DELETE | `/api/warehouses/[id]` | dynamic-template | Other API | business user session (middleware); handler must authorize | settings_multi_warehouse | not executed |
| A0867 | GET,PATCH | `/api/warehouses/[id]/branches` | dynamic-template | Other API | business user session (middleware); handler must authorize | settings_multi_warehouse | not executed |
| A0868 | GET,POST | `/api/warehouses/[id]/stock-availability` | dynamic-template | Other API | business user session (middleware); handler must authorize | settings_multi_warehouse | not executed |
| A0869 | GET,POST | `/api/webhooks/meta-whatsapp` | static | Webhooks | middleware-public (provider signature expected in handler) | — | not executed |
| A0870 | GET,POST | `/api/webhooks/platform-billing/easebuzz` | static | Webhooks | middleware-public (provider signature expected in handler) | — | not executed |
| A0871 | GET,POST | `/api/webhooks/platform-billing/razorpay` | static | Webhooks | middleware-public (provider signature expected in handler) | — | not executed |
| A0872 | POST | `/api/webhooks/store/easebuzz` | static | Webhooks | middleware-public (provider signature expected in handler) | — | not executed |
| A0873 | POST | `/api/webhooks/store/razorpay` | static | Webhooks | middleware-public (provider signature expected in handler) | — | not executed |
| A0874 | POST | `/api/webhooks/store/shiprocket` | static | Webhooks | middleware-public (provider signature expected in handler) | — | not executed |
| A0875 | GET,PATCH | `/api/whatsapp/auto-assign` | static | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0876 | GET,POST | `/api/whatsapp/bot-rules` | static | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0877 | GET,PATCH,DELETE | `/api/whatsapp/bot-rules/[id]` | dynamic-template | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0878 | POST,DELETE | `/api/whatsapp/bot-rules/[id]/chains` | dynamic-template | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0879 | GET,POST | `/api/whatsapp/campaigns` | static | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0880 | GET,PATCH,DELETE | `/api/whatsapp/campaigns/[id]` | dynamic-template | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0881 | GET,POST,PUT,DELETE | `/api/whatsapp/contact-groups` | static | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0882 | GET,POST,DELETE | `/api/whatsapp/contact-groups/[id]/members` | dynamic-template | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0883 | GET,POST,PUT,DELETE | `/api/whatsapp/contacts` | static | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0884 | GET | `/api/whatsapp/contacts/[phone]` | dynamic-template | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0885 | POST | `/api/whatsapp/contacts/import` | static | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0886 | GET | `/api/whatsapp/conversations` | static | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0887 | GET,PATCH,DELETE | `/api/whatsapp/conversations/[id]` | dynamic-template | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0888 | POST | `/api/whatsapp/conversations/[id]/bot` | dynamic-template | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0889 | GET,PUT | `/api/whatsapp/conversations/[id]/custom-fields` | dynamic-template | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0890 | DELETE | `/api/whatsapp/conversations/[id]/custom-fields/[key]` | dynamic-template | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0891 | POST | `/api/whatsapp/conversations/[id]/export` | dynamic-template | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0892 | GET,POST,DELETE | `/api/whatsapp/conversations/[id]/labels` | dynamic-template | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0893 | GET | `/api/whatsapp/conversations/[id]/linked-orders` | dynamic-template | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0894 | GET,POST | `/api/whatsapp/conversations/[id]/messages` | dynamic-template | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0895 | GET,POST,DELETE | `/api/whatsapp/conversations/[id]/notes` | dynamic-template | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0896 | POST | `/api/whatsapp/conversations/[id]/ownership` | dynamic-template | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0897 | POST | `/api/whatsapp/conversations/[id]/template` | dynamic-template | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0898 | GET | `/api/whatsapp/conversations/[id]/timeline` | dynamic-template | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0899 | POST | `/api/whatsapp/conversations/export` | static | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0900 | GET | `/api/whatsapp/conversations/live` | static | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0901 | GET,POST | `/api/whatsapp/conversations/live/[jid]/messages` | dynamic-template | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0902 | GET | `/api/whatsapp/conversations/stream` | static | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0903 | GET | `/api/whatsapp/conversations/summary` | static | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0904 | GET | `/api/whatsapp/dashboard/agents` | static | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0905 | GET | `/api/whatsapp/dashboard/campaigns` | static | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0906 | GET | `/api/whatsapp/dashboard/overview` | static | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0907 | POST | `/api/whatsapp/disconnect` | static | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0908 | GET,POST | `/api/whatsapp/flows` | static | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0909 | GET,PATCH,DELETE | `/api/whatsapp/flows/[id]` | dynamic-template | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0910 | POST | `/api/whatsapp/flows/[id]/publish` | dynamic-template | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0911 | POST | `/api/whatsapp/flows/[id]/unpublish` | dynamic-template | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0912 | POST | `/api/whatsapp/flows/generate` | static | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0913 | POST | `/api/whatsapp/flows/import-bot-rules` | static | Connect | business user session (middleware); handler must authorize | integration_whatsapp_bot | not executed |
| A0914 | GET,PUT | `/api/whatsapp/inbox-settings` | static | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0915 | GET,POST | `/api/whatsapp/inbox-templates` | static | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0916 | GET,POST | `/api/whatsapp/labels` | static | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0917 | PATCH,DELETE | `/api/whatsapp/labels/[id]` | dynamic-template | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0918 | GET | `/api/whatsapp/lead-profiles` | static | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0919 | GET,POST,DELETE | `/api/whatsapp/media` | static | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0920 | GET | `/api/whatsapp/media/[name]` | dynamic-template | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0921 | GET | `/api/whatsapp/orders` | static | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0922 | POST | `/api/whatsapp/orders/[id]/approve` | dynamic-template | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0923 | POST | `/api/whatsapp/orders/[id]/reject` | dynamic-template | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0924 | GET,POST,PATCH | `/api/whatsapp/owner-link` | static | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0925 | POST | `/api/whatsapp/qr` | static | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0926 | GET,POST | `/api/whatsapp/reminders` | static | Connect | business user session (middleware); handler must authorize | whatsapp_auto_reminders | not executed |
| A0927 | PATCH,DELETE | `/api/whatsapp/reminders/[type]` | dynamic-template | Connect | business user session (middleware); handler must authorize | whatsapp_auto_reminders | not executed |
| A0928 | GET,POST | `/api/whatsapp/saved-replies` | static | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0929 | PATCH,DELETE | `/api/whatsapp/saved-replies/[id]` | dynamic-template | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0930 | POST | `/api/whatsapp/send` | static | Connect | business user session (middleware); handler must authorize | integration_whatsapp_manual | not executed |
| A0931 | POST | `/api/whatsapp/send-bulk-reminders` | static | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0932 | GET,PUT | `/api/whatsapp/shop` | static | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0933 | POST | `/api/whatsapp/shop/sync` | static | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0934 | GET | `/api/whatsapp/status` | static | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0935 | POST | `/api/whatsapp/sync` | static | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0936 | GET,POST,DELETE | `/api/whatsapp/unsubscribes` | static | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0937 | GET | `/api/whatsapp/users` | static | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0938 | POST | `/api/whatsapp/webhook` | static | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0939 | GET | `/api/whatsapp/who-to-message` | static | Connect | business user session (middleware); handler must authorize | — | not executed |
| A0940 | GET,POST | `/api/work-orders` | static | Sales | business user session (middleware); handler must authorize | sales_work_orders | not executed |
| A0941 | GET,PUT,PATCH | `/api/work-orders/[id]` | dynamic-template | Sales | business user session (middleware); handler must authorize | sales_work_orders | not executed |
| A0942 | POST | `/api/work-orders/[id]/convert` | dynamic-template | Sales | business user session (middleware); handler must authorize | sales_work_orders | not executed |
| A0943 | GET | `/api/work-orders/next-number` | static | Sales | business user session (middleware); handler must authorize | sales_work_orders | not executed |
| A0944 | GET | `/media/marketing-creatives/[file]` | dynamic-template | Other | business user session | — | not executed |
| A0945 | GET | `/media/marketing/[file]` | dynamic-template | Other | business user session | — | not executed |
| A0946 | GET | `/store/pwa-icon/[size]` | dynamic-template | Online store | public storefront | — | not executed |
| A0947 | GET | `/store/site.webmanifest` | static | Online store | public storefront | — | not executed |
