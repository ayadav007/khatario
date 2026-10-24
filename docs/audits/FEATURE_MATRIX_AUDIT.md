# Feature matrix audit

Date: 14 Oct 2026.

**What was compared.** The matrix is `platform_features` (73 features) and `subscription_plan_features` (302 plan rows), read from the local dev database. That database has 401 migrations applied, including 377–379, which add 8 features. The matrix was compared against every place the code names a feature: 753 references in the website, API and `lib/`, plus the phone app's navigation, dashboard and capability lists. Each key was resolved through the real `normalizeFeatureKey` and the server alias table in `resolveRegistryFeatureId`. Website keys were also resolved through the browser's own alias table in `hooks/useFeatureRegistry.ts`.

**How access is decided (relevant to every finding).**
- **Server** (`assertFeatureAccess`): a key that is **not** in the matrix is **denied for every business**. The exceptions are the four core billing keys (`customer_management`, `item_management`, `stock_tracking`, `payment_tracking`) and the two Connect add-ons (`integration_whatsapp_bot`, `integration_whatsapp_manual`).
- **Path gate** (`lib/subscription/plan-path-gate.ts`): applied inside `authorize()`, so only API routes that call `authorize()` get it. Its page prefixes (`/settings/automation` and so on) only lock the website screen, not the API behind it.
- **Product gate** (`MODULE_ROUTE_PREFIXES`): page prefixes only (Billing / HR / Connect). It does not cover `/api/*`.
- **Browser**: three different resolvers decide what is shown. `useFeatureRegistry().hasFeature` and `useSubscriptionCheck().hasFeature` each keep their own alias table, and `usePlanFeature` is a third.

---

## 1. In the matrix, but no action is attached

These rows can be switched on and off in Admin › Plans, but nothing in the app reads them, so the switch changes nothing.

| Feature | On plans | What happens today |
|---|---|---|
| `barcode_weight_embedded` | Growth, Business, Trial | Weight-embedded barcodes (`weight_barcode_mode` on items, used in Items and labels) work on **every** plan. Nothing checks the feature. |
| `profit_reports_advanced` | Business, Trial | No advanced profit report exists. Only `profit_reports_basic` (profit by invoice) is checked. |
| `reports_analytics` | Business, Trial | No screen or API checks it. |
| `sales_new_invoice` | Free, Growth, Business, Trial | Never checked. New invoices are governed by `sales_invoices`. Duplicate row. |
| `integration_api` | Business, Trial | Only appears in the alias table. There is no public API or API-key feature to gate. |

## 2. Attached only in the browser (the API is open)

The screen is hidden or locked on plans without the feature, but the API behind it accepts the request from any plan.

| Feature | Checked where | Not checked |
|---|---|---|
| `advanced_barcode` (Growth, Business) | `BarcodeScanner`, `ContinuousBarcodeScanner`, `useBarcodeScanner` on the website | Item search by barcode (`/api/items/search`) is open. **The phone bill screen's new Scan button does not check it.** |
| `settings_template_customization` (Growth, Business) | Page prefix `/settings/templates` | `/api/template-assignments`, `/api/templates/copy` and `/api/template-preview` have no plan check. |
| `workflow_automation` (Business) | Page prefix `/settings/automation` | The page calls `/api/workflows`, **which does not exist**, so the feature is broken on every plan. |
| `integration_whatsapp_manual` (Connect) | Page prefix `/whatsapp/send-message` | The page sends through `/api/whatsapp/send`, which the path gate maps to `settings_whatsapp` (on every plan), not to this add-on. Custom sends are therefore open to anyone with WhatsApp linked. |
| `settings_pos_mode`, `accessibility`, `mobile_enhancements` | Browser only | These are screen behaviours; there is no API to protect. |

## 3. Actions that check a key missing from the matrix

| Key in code | Where | Effect |
|---|---|---|
| `offers_percent_discount`, `offers_flat_discount`, `offers_buy_x_get_y`, `offers_bill_value_discount` | `lib/offer-feature-gate.ts`, used by `app/api/invoices/route.ts` | The four invoice offer types have **no matrix rows**. The offer gate treats an unknown row as "allowed", so every offer type is free on every plan, and Admin › Plans cannot control them. |
| `pos_mode` | `lib/settings-module-registry.ts:256` (`featureKey: 'pos_mode'`) | The browser maps it to `settings_pos_mode`, but the server alias table does not. A server check on `pos_mode` would deny everyone. Today only the browser uses it. |
| `debit_notes`, `sales_orders`-style canonical keys | Browser `useFeatureRegistry` alias table | The browser table is a hand-copied, shorter version of the server table. For example `debit_notes` maps on the server but not in the browser. The same key can then be allowed by the API and hidden in the UI. |

## 4. Actions with no feature at all (missing from the matrix)

Neither the path gate, nor `authorize()` with a gated path, nor any feature call covers these areas. They work on every plan. Some are free on purpose (customers, items, payments, dashboard). These need a decision:

| Area | API | Notes |
|---|---|---|
| Orders & delivery hub, returns, pick list, COD remittance, rider link, invoice defaults (built 14 Oct) | `/api/orders/*`, `/api/returns/*`, `/api/settings/invoice-defaults` | No matrix row exists. The store parts already require `advanced_online_store`; manual/WhatsApp fulfilment does not. |
| Fixed assets & depreciation | `/api/fixed-assets`, `/api/depreciation` | Accounting tools similar to `accounting_*`, which are gated. |
| Advances, contra, opening balances | `/api/advances`, `/api/contra`, `/api/opening-balances` | Accounting vouchers. |
| Stock requests | `/api/stock-requests` (8 routes) | Multi-location stock flow, close to `settings_multi_warehouse`. |
| AI assistant and in-app AI agent | `/api/assistant`, `/api/ai-agent` | The WhatsApp AI agent is under Connect; the in-app assistant has no feature. |
| HR APIs outside `/api/employees` | `/api/hr/*` (33 routes), `/api/shifts`, `/api/holidays`, `/api/leave-types`, `/api/commission-rules` | The path gate covers `/api/employees/*` only, and the product gate covers pages only. These APIs answer for Billing-only businesses too. |
| Custom fields, period locks, financial years | `/api/custom-fields`, `/api/period-locks`, `/api/financial-years` | Probably free on purpose; confirm. |
| Bookings | `/api/bookings` | No feature. |
| Tools (calculators) | `/api/tools/*` | `tools_todo` covers only the to-do list. |

## 5. Security issue found while checking (not a matrix problem)

`app/api/templates/copy/route.ts` takes `business_id` from the request body and writes `business_template_assignments` for it. It has no session check, no `requireTenantBusinessId` and no `authorize()`. Any signed-in user can overwrite another business's invoice-template settings. This breaks the project rule "never trust client-sent `business_id`". It needs `requireTenantBusinessId` plus a settings permission check.

## 6. Healthy

- **Server-enforced: 61 of the 73 features** (the other 12 are in sections 1–2). For example `accounting_*`, `sales_*`, `purchase_*`, `reports_*`, `settings_multi_*`, `advanced_online_store`, `eway_bill`, `e_invoice`, `soft_delete`, `party_pricing`, `profit_invoice`, `tools_todo`, `hr_*` via `/api/employees`, and `whatsapp_auto_reminders`.
- **No retired plans:** no feature is enabled only on retired plans (`professional`, `enterprise`).
- **Migrations:** the 8 newest features (accounting, document language, multi-business) come from migrations 377–379; staging must have those applied.
