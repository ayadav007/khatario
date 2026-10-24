# Module map

Generated 2026-10-19 from `app/`, `components/`, `lib/`, and navigation sources. Dependency arrows are structural, not a runtime call graph.

## Product modules

Platform modules in `lib/platform-modules.ts`: **billing**, **hr**, **connect**, **crm**. Signup enables one. Tools and some settings are outside those four. A path with no entry in `MODULE_ROUTE_PREFIXES` is not blocked by that module map alone.

| Platform module | Default home | Route prefixes in `MODULE_ROUTE_PREFIXES` |
| --- | --- | --- |
| billing | `/dashboard` | `/dashboard`, `/invoices`, `/customers`, `/items`, `/purchases`, `/suppliers`, `/reports`, `/payments`, `/accounts`, `/ledger`, `/estimates`, `/sales-orders`, `/credit-notes`, `/debit-notes`, `/delivery-challans`, `/expenses`, `/stock-transfers`, `/inventory-adjustments`, `/pricing` |
| hr | `/hr/dashboard` | `/employees`, `/hr` |
| connect | `/whatsapp/dashboard` | `/whatsapp`, `/connect` |
| crm | `/dashboard` | `/crm` |

RBAC assignable actions (`lib/rbac-permission-catalog.ts`): read, create, update, delete, export. Those flags are `can_view`, `can_add`, `can_modify`, `can_delete`, `can_share`. Module keys include invoices, credit notes, debit notes, customers, purchases, items, payments, warehouses, reports, journal, accounting period, employees, attendance, leaves, payroll, recruitment, commissions, WhatsApp inbox. Primary admin bypasses role checks in the More menu helper; confirm that in `authorize()` before treating it as universal.

Plan gating is a second layer: `featureIdForPath` in `lib/subscription/plan-path-gate.ts`. A role grant can still be denied with `FEATURE_NOT_IN_PLAN`.

## Functional modules (page count)

| Module | Pages | Route handlers |
| --- | ---: | ---: |
| Accounting | 25 | 43 |
| App shell | 1 | 0 |
| Attendance kiosk | 2 | 0 |
| Auth | 2 | 8 |
| Connect | 18 | 65 |
| Cron | 0 | 25 |
| Customer invoice link | 1 | 0 |
| Customer portal | 1 | 0 |
| Dashboard | 1 | 0 |
| GST | 0 | 23 |
| HR | 41 | 87 |
| Inventory | 13 | 26 |
| Marketing | 9 | 0 |
| Navigation | 1 | 0 |
| Notifications | 1 | 0 |
| Online store | 11 | 2 |
| Other | 10 | 2 |
| Other API | 0 | 236 |
| Parties | 5 | 7 |
| Partner portal | 9 | 13 |
| Platform admin | 28 | 100 |
| Public API | 0 | 55 |
| Public business portal | 15 | 0 |
| Public payment | 2 | 0 |
| Purchases | 35 | 57 |
| Reports | 28 | 81 |
| Rider link | 1 | 0 |
| Sales | 28 | 51 |
| Settings | 78 | 60 |
| Shipment tracking | 1 | 0 |
| Tools | 17 | 0 |
| Webhooks | 0 | 6 |
| WhatsApp shop | 1 | 0 |

## Shared UI areas

| Folder | Role |
| --- | --- |
| `components/ui` | Buttons, inputs, dialogs, sheets, selects used across modules |
| `components/layout` | App shell, sidebar, bottom nav, access gates |
| `components/invoices` | Invoice composer, share, print, extraction debug |
| `components/documents` | Shared sales-document detail and payment sections |
| `components/sales-orders` | Sales-order composer and convert-to-invoice |
| `components/purchases` | Purchase hub, scan flow, label print |
| `components/items` | Item detail, stock adjust sheet, flags |
| `components/inventory` | Batch and serial managers |
| `components/customers` | Customer search, portal access, lead profile |
| `components/reports` | Report builder, aging, register, deleted-items report |
| `components/gst` | Return review dialog |
| `components/accounts` | P&L section select |
| `components/settings` | Settings shells and HR settings panels |
| `components/hr` | Attendance, recruitment, engagement, salary structure |
| `components/employee-portal` | Employee self-service screens |
| `components/whatsapp` | Inbox, campaigns, flows, reminders |
| `components/store` | Storefront and store admin |
| `components/subscription` | Plan change and add-on dialogs |
| `components/auth` | Login and OTP |
| `components/admin` | Platform admin shell |

### Component folder sizes

| Folder | TS/TSX files |
| --- | ---: |
| `components/whatsapp` | 71 |
| `components/marketing` | 61 |
| `components/invoices` | 36 |
| `components/store` | 36 |
| `components/settings` | 35 |
| `components/hr` | 31 |
| `components/ui` | 27 |
| `components/layout` | 24 |
| `components/admin` | 22 |
| `components/ai-agent` | 21 |
| `components/dashboard` | 18 |
| `components/employee-portal` | 12 |
| `components/orders` | 12 |
| `components/purchases` | 12 |
| `components/suppliers` | 10 |
| `components/gst` | 9 |
| `components/modals` | 9 |
| `components/printer` | 9 |
| `components/subscription` | 9 |
| `components/candidate-portal` | 8 |
| `components/documents` | 7 |
| `components/assistant` | 6 |
| `components/items` | 6 |
| `components/onboarding` | 6 |
| `components/reports` | 6 |
| `components/customer-surface` | 5 |
| `components/customers` | 5 |
| `components/promotions` | 5 |
| `components/system` | 5 |
| `components/help` | 4 |
| `components/notifications` | 4 |
| `components/pos` | 4 |
| `components/purchase-orders` | 4 |
| `components/sales-orders` | 4 |
| `components/tables` | 4 |
| `components/templates` | 4 |
| `components/blog` | 3 |
| `components/common` | 3 |
| `components/custom-fields` | 3 |
| `components/email` | 3 |
| `components/payments` | 3 |
| `components/debug` | 2 |
| `components/desktop` | 2 |
| `components/filters` | 2 |
| `components/inventory` | 2 |
| `components/labels` | 2 |
| `components/portal` | 2 |
| `components/accessibility` | 1 |
| `components/accounts` | 1 |
| `components/auth` | 1 |
| `components/automation` | 1 |
| `components/bank` | 1 |
| `components/credit` | 1 |
| `components/delivery-challans` | 1 |
| `components/guards` | 1 |
| `components/navigation` | 1 |
| `components/partners` | 1 |
| `components/profile` | 1 |
| `components/search` | 1 |
| `components/theme` | 1 |
| `components/todo` | 1 |
| `components/wa-shop` | 1 |
| `components/work-orders` | 1 |

## Server areas that pages depend on

| Folder | TS/TSX files | Why it matters for tests |
| --- | ---: | --- |
| `lib/services` | 116 | Shared by the APIs in that area |
| `lib/hr` | 102 | Shared by the APIs in that area |
| `lib/gst` | 62 | Shared by the APIs in that area |
| `lib/store` | 41 | Shared by the APIs in that area |
| `lib/subscription` | 41 | Shared by the APIs in that area |
| `lib/whatsapp` | 38 | Shared by the APIs in that area |
| `lib/offline` | 37 | Shared by the APIs in that area |
| `lib/rag` | 32 | Shared by the APIs in that area |
| `lib/accounting` | 27 | Shared by the APIs in that area |
| `lib/policies` | 24 | Shared by the APIs in that area |
| `lib/bluetooth` | 22 | Shared by the APIs in that area |
| `lib/fulfilment` | 18 | Shared by the APIs in that area |
| `lib/purchases` | 17 | Shared by the APIs in that area |
| `lib/employee-portal` | 16 | Shared by the APIs in that area |
| `lib/payments` | 16 | Shared by the APIs in that area |
| `lib/notifications` | 15 | Shared by the APIs in that area |
| `lib/sales-funnel` | 15 | Shared by the APIs in that area |
| `lib/ai-agent` | 14 | Shared by the APIs in that area |
| `lib/invoices` | 14 | Shared by the APIs in that area |
| `lib/partners` | 13 | Shared by the APIs in that area |
| `lib/reports` | 12 | Shared by the APIs in that area |
| `lib/bank` | 11 | Shared by the APIs in that area |
| `lib/security` | 11 | Shared by the APIs in that area |
| `lib/blog` | 10 | Shared by the APIs in that area |
| `lib/customer-surface` | 10 | Shared by the APIs in that area |
| `lib/marketing` | 10 | Shared by the APIs in that area |
| `lib/inventory` | 9 | Shared by the APIs in that area |
| `lib/marketing-builder` | 9 | Shared by the APIs in that area |
| `lib/whatsapp-shop` | 9 | Shared by the APIs in that area |
| `lib/export` | 7 | Shared by the APIs in that area |
| `lib/invoice-extract` | 7 | Shared by the APIs in that area |
| `lib/matching` | 7 | Shared by the APIs in that area |
| `lib/print-language` | 7 | Shared by the APIs in that area |
| `lib/printer` | 7 | Shared by the APIs in that area |
| `lib/auth` | 6 | Shared by the APIs in that area |
| `lib/debug` | 6 | Shared by the APIs in that area |
| `lib/invoice-engine` | 6 | Shared by the APIs in that area |
| `lib/navigation` | 6 | Shared by the APIs in that area |
| `lib/offline-sync` | 6 | Shared by the APIs in that area |
| `lib/print` | 6 | Shared by the APIs in that area |

## Invoice create dependencies (code-backed)

`createInvoiceInTransaction` calls branch resolution, subscription enforcement, GST scheme policy, line GST math, invoice numbering, stock adjustment, payment insert, customer balance, and ledger helpers. Tests that only render the invoice page do not prove stock or ledger rows.

## Navigation sources

Keep these in sync when a new primary page is added:

- `components/layout/Sidebar.tsx`
- `components/layout/BottomNav.tsx`
- `lib/more-navigation.ts` (also served to the phone app)
- `lib/navigation/sales-nav-items.ts`
- `lib/hr/hr-admin-nav.ts`
- `lib/platform-modules.ts` settings hub maps

Primary nav hrefs collected: 142.
