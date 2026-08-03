# Final Route Sign-Off

**Date:** 2026-06-06  
**Source:** `audit-business-id-classify.js` → `rawQueryOnly` bucket (75 routes)  
**Method:** Handler source inspection per route. Middleware JWT alone does not count as tenant validation when the handler uses client `searchParams.get('business_id')` in SQL without `requireTenantBusinessId` or session comparison.

---

## Summary

| Classification | Count |
|----------------|------:|
| **SAFE** | 3 |
| **FALSE POSITIVE** | 3 |
| **VULNERABLE** | 69 |
| **Total** | **75** |

---

## Classification Key

| Label | Meaning |
|-------|---------|
| **SAFE** | System/admin/cron scoped, or tenant not cross-boundary |
| **FALSE POSITIVE** | Audit misses validation in wrapper/guard |
| **VULNERABLE** | Client `business_id` query can drive cross-tenant data access without session binding |

---

## Route Sign-Off Table

| # | Route | Classification | Reason |
|---|-------|----------------|--------|
| 1 | `/api/admin/billing/events` | **SAFE** | `requirePlatformRequest` platform-admin auth; optional `business_id` is an admin filter only |
| 2 | `/api/backup/history` | **VULNERABLE** | Query `business_id` in SQL; only `assertFeatureAccess`, no tenant/session bind |
| 3 | `/api/backup/history/[id]/download` | **VULNERABLE** | Query `business_id` drives backup download; no tenant/session bind |
| 4 | `/api/backup/history/[id]` | **VULNERABLE** | Query `business_id` in backup lookup; no tenant/session bind |
| 5 | `/api/backup/schedule` | **VULNERABLE** | Query `business_id` in schedule CRUD; no tenant/session bind |
| 6 | `/api/badges/counts` | **VULNERABLE** | Query `business_id` in invoice/item count SQL; no auth or tenant bind in handler |
| 7 | `/api/cloud-storage/google/auth` | **VULNERABLE** | Query `business_id` loads OAuth credentials for arbitrary tenant |
| 8 | `/api/cloud-storage/google/credentials` | **VULNERABLE** | Query `business_id` reads cloud credentials; no tenant bind |
| 9 | `/api/cloud-storage/google/list` | **VULNERABLE** | Query `business_id` lists cloud files; no tenant bind |
| 10 | `/api/commission-rules/[id]` | **VULNERABLE** | Query `business_id` in PATCH/DELETE; parent route fixed, `[id]` was not |
| 11 | `/api/cron/process-reversing-entries` | **SAFE** | Cron route; `assertCronAuthorized` before work; no user tenant |
| 12 | `/api/cron/refresh-profile-pictures` | **SAFE** | Cron route; `assertCronAuthorized` before work; no user tenant |
| 13 | `/api/currencies` | **VULNERABLE** | Query/body `business_id` in currency SQL; no tenant bind |
| 14 | `/api/debug/template-assignment` | **VULNERABLE** | Debug handler; query `business_id` without tenant bind |
| 15 | `/api/delivery-challans` | **VULNERABLE** | Query `business_id` in challan list SQL; no tenant bind |
| 16 | `/api/depreciation/calculate` | **VULNERABLE** | Query `business_id` in calculation queries; no tenant bind |
| 17 | `/api/document-attachments/[id]` | **VULNERABLE** | Query `business_id` in attachment access; no tenant bind |
| 18 | `/api/employees/face-enrollment` | **VULNERABLE** | Query `business_id` in HR enrollment SQL; no tenant bind |
| 19 | `/api/employees/performance` | **VULNERABLE** | Query `business_id` in performance SQL; no tenant bind |
| 20 | `/api/employees/salary/advances/balance` | **VULNERABLE** | Query `business_id` in advance balance SQL; no tenant bind |
| 21 | `/api/employees/salary/advances/[id]/approve` | **VULNERABLE** | Query `business_id` in approve flow; `authorize` does not bind query tenant to session |
| 22 | `/api/employees/targets` | **VULNERABLE** | Query `business_id` in targets SQL; no tenant bind |
| 23 | `/api/employees/targets/[id]` | **VULNERABLE** | Query `business_id` in target CRUD; no tenant bind |
| 24 | `/api/exchange-rates` | **VULNERABLE** | Query/body `business_id` in rate SQL; no tenant bind |
| 25 | `/api/expense-categories` | **VULNERABLE** | Query `business_id` in category SQL; feature gate only |
| 26 | `/api/filters/presets` | **VULNERABLE** | Query `business_id` in preset SQL; feature gate only |
| 27 | `/api/financial-years` | **VULNERABLE** | Query `business_id` in financial year SQL; no tenant bind |
| 28 | `/api/financial-years/[id]/close` | **VULNERABLE** | Query `business_id` in close action; no tenant bind |
| 29 | `/api/fixed-assets/depreciation-schedule` | **VULNERABLE** | Query `business_id` in schedule SQL; no tenant bind |
| 30 | `/api/fixed-assets` | **VULNERABLE** | Query `business_id` in asset SQL; no tenant bind |
| 31 | `/api/gst/gstr2b/decision` | **FALSE POSITIVE** | `assertGstr2bApiAccess` → `requireTenantBusinessId` before handler |
| 32 | `/api/gst/gstr2b/export` | **FALSE POSITIVE** | `assertGstr2bApiAccess` → `requireTenantBusinessId` before handler |
| 33 | `/api/gst/gstr2b/reconcile` | **FALSE POSITIVE** | `assertGstr2bApiAccess` → `requireTenantBusinessId` before handler |
| 34 | `/api/holidays` | **VULNERABLE** | Query `business_id` in holiday SQL; no tenant bind |
| 35 | `/api/holidays/[id]` | **VULNERABLE** | Query `business_id` in holiday CRUD; no tenant bind |
| 36 | `/api/inventory-adjustments/[id]` | **VULNERABLE** | Query `business_id` in adjustment access; `enforceAccess` does not bind tenant |
| 37 | `/api/invoice-template-settings` | **VULNERABLE** | Query `business_id` in settings SQL; no tenant bind |
| 38 | `/api/invoices/next-number` | **VULNERABLE** | Query `business_id` in counter read/update; no tenant bind |
| 39 | `/api/items/[id]/batches` | **VULNERABLE** | Query/body `business_id` in batch SQL; no tenant bind |
| 40 | `/api/items/[id]/batches/[batchId]` | **VULNERABLE** | Query `business_id` in batch CRUD; no tenant bind |
| 41 | `/api/items/[id]/serials` | **VULNERABLE** | Query `business_id` in serial SQL; no tenant bind |
| 42 | `/api/items/[id]/serials/[serialId]` | **VULNERABLE** | Query `business_id` in serial CRUD; no tenant bind |
| 43 | `/api/items/[id]/valuation` | **VULNERABLE** | Query `business_id` in valuation SQL; no tenant bind |
| 44 | `/api/journal-entries/templates` | **VULNERABLE** | Query `business_id` in template SQL; no tenant bind |
| 45 | `/api/journal-entries/templates/[id]` | **VULNERABLE** | Query `business_id` in template CRUD; no tenant bind |
| 46 | `/api/leave-types` | **VULNERABLE** | Query `business_id` in leave type SQL; no tenant bind |
| 47 | `/api/leave-types/[id]` | **VULNERABLE** | Query `business_id` in leave type CRUD; no tenant bind |
| 48 | `/api/locations` | **VULNERABLE** | Query `business_id` in location SQL; feature gate only |
| 49 | `/api/notifications/read-all` | **VULNERABLE** | Authenticated; query/body `business_id` in UPDATE without `requireTenantBusinessId` |
| 50 | `/api/opening-balances` | **VULNERABLE** | Query `business_id` in opening balance SQL; no tenant bind |
| 51 | `/api/payment-methods` | **VULNERABLE** | Query `business_id` in payment method SQL; no tenant bind |
| 52 | `/api/promotions/active` | **VULNERABLE** | Query `business_id` reads `business_subscriptions.plan_id` and promotion targeting for arbitrary tenant |
| 53 | `/api/provisions` | **VULNERABLE** | Query `business_id` in provision SQL; no tenant bind |
| 54 | `/api/provisions/[id]/entries` | **VULNERABLE** | Query `business_id` in provision entry SQL; no tenant bind |
| 55 | `/api/provisions/[id]` | **VULNERABLE** | Query `business_id` in provision CRUD; no tenant bind |
| 56 | `/api/settings/account-mappings` | **VULNERABLE** | Query `business_id` in settings SQL; no tenant bind |
| 57 | `/api/settings/ai-config` | **VULNERABLE** | Query `business_id` in AI config SQL; no tenant bind |
| 58 | `/api/settings/item-sales-stock` | **VULNERABLE** | Query `business_id` in settings SQL; no tenant bind |
| 59 | `/api/settings/product-variants` | **VULNERABLE** | Query `business_id` in settings SQL; no tenant bind |
| 60 | `/api/settings/warehouses` | **VULNERABLE** | Query `business_id` in settings SQL; no tenant bind |
| 61 | `/api/settings/whatsapp-bot` | **VULNERABLE** | Query `business_id` in bot settings SQL; no tenant bind |
| 62 | `/api/shifts` | **VULNERABLE** | Query `business_id` in shift SQL; no tenant bind |
| 63 | `/api/shifts/[id]` | **VULNERABLE** | Query `business_id` in shift CRUD; no tenant bind |
| 64 | `/api/suppliers/check-duplicate` | **VULNERABLE** | Query `business_id` in duplicate check SQL; no tenant bind |
| 65 | `/api/suppliers/requests` | **VULNERABLE** | Query `business_id` in supplier request SQL; no tenant bind |
| 66 | `/api/suppliers/[id]/approve` | **VULNERABLE** | Query `business_id` in approve action; feature gate only |
| 67 | `/api/tasks` | **VULNERABLE** | Query `business_id` in task SQL; no tenant bind |
| 68 | `/api/tasks/[id]` | **VULNERABLE** | Query `business_id` in task CRUD; no tenant bind |
| 69 | `/api/tax-provisions` | **VULNERABLE** | Query `business_id` in tax provision SQL; no tenant bind |
| 70 | `/api/template-assignments` | **VULNERABLE** | Query `business_id` in assignment SQL; no tenant bind |
| 71 | `/api/template-preview` | **VULNERABLE** | Query `business_id` in preview SQL; no tenant bind |
| 72 | `/api/todos/check-reminders` | **VULNERABLE** | With `?business_id=` runs cross-tenant todo reminder side effects; no tenant bind |
| 73 | `/api/todos/users` | **VULNERABLE** | Query `business_id` in user list SQL; no tenant bind |
| 74 | `/api/tools/whatsapp-groups` | **VULNERABLE** | Query `business_id` drives WhatsApp socket/group export; addon check only |
| 75 | `/api/warehouses/[id]/stock-availability` | **VULNERABLE** | Query `business_id` in stock SQL; `enforceAccess` does not bind tenant |

---

## Notes

- **Middleware JWT** sets `x-authenticated-business-id` from the token payload, not from the query string. Handlers that read `searchParams.get('business_id')` directly do not use session-derived tenant unless they also call `requireTenantBusinessId` or equivalent.
- **`assertFeatureAccess` / `enforceAccess` / `hasWhatsAppBotAddon`** validate subscription or branch permissions for the supplied `businessId`; they do not prove the caller's session owns that tenant.
- **GSTR-2B routes** appear in the raw-query bucket because `requireTenantBusinessId` lives inside `assertGstr2bApiAccess`, not in the route file.

---

*Classification complete for all 75 routes.*
