# Premium Module Migration Report

**Date:** 2026-06-06  
**Scope:** Migrate premium API modules to `withPremiumSubscriptionApi` / `withWhatsAppPremiumApi` (both use `requireOperationalSubscription` + `withBusinessApi`).

---

## Summary

| Module | Route files | HTTP handlers | Wrapper |
|--------|-------------|---------------|---------|
| Work Orders | 1 | 2 | `withPremiumSubscriptionApi` |
| Ledger | 5 | 5 | `withPremiumSubscriptionApi` |
| Accounts | 6 | 10 | `withPremiumSubscriptionApi` |
| Budgets | 2 | 3 | `withPremiumSubscriptionApi` |
| TDS | 8 | 14 | `withPremiumSubscriptionApi` |
| Bank Statements | 4 | 5 | `withPremiumSubscriptionApi` |
| GST Utilities | 9 + 4 (gstr2b) | 13 | `withPremiumSubscriptionApi` / `assertGstr2bApiAccess` |
| WhatsApp Premium | 31 | ~60 | `withWhatsAppPremiumApi` |
| **Total** | **66** | **~112** | |

**Infrastructure updated:** `lib/security/with-business-api.ts`, `lib/security/premium-module-api.ts`, `lib/gst/gstr2b-route-guard.ts`

---

## New security pipeline (all migrated routes)

```
Request
  → requireTenantBusinessId (JWT tenant; 403 if business_id mismatch)
  → getUserIdFromRequest (401 if missing)
  → assertSessionValidForCookieAuth
  → requireOperationalSubscription (403 if expired / cancelled / suspended / trial expired)
  → [WhatsApp only] hasWhatsAppBotAddon via afterSubscription (403 if no addon)
  → [Optional] authorize / assertFeatureAccess (unchanged in handler where present)
  → Route business logic
```

**Expired subscription:** all migrated routes return **403** with `code` such as `NO_SUBSCRIPTION`, `SUBSCRIPTION_EXPIRED`, `TRIAL_EXPIRED`, or `BUSINESS_SUSPENDED`.

---

## Module details

### 1. Work Orders

| Route | Methods | Old security | New security | RBAC preserved |
|-------|---------|--------------|--------------|----------------|
| `/api/work-orders` | GET, POST | JWT + `authorize(work_orders)` | Wrapper + same `authorize` in handler | Yes |

**Compatibility risks:** POST still authorizes `created_by` from body via `resolveActingUserId` (unchanged semantics). Cross-tenant `business_id` in body now rejected.

---

### 2. Ledger

| Route | Methods | Old security | New security | RBAC preserved |
|-------|---------|--------------|--------------|----------------|
| `/api/ledger` | GET | JWT + `authorize(reports, read)` | Wrapper + same in handler | Yes |
| `/api/ledger/account/[accountId]` | GET | `requirePortalSession` + query `business_id` | Wrapper + `requirePortalSession` in handler | N/A (no RBAC) |
| `/api/ledger/account/[accountId]/statement` | GET | Query `business_id` only | Wrapper (401 + subscription) | N/A |
| `/api/ledger/account/[accountId]/statement/pdf` | GET | Query `business_id` only | Wrapper (401 + subscription) | N/A |
| `/api/ledger/balance/[accountId]` | GET | Query `business_id` only | Wrapper (401 + subscription) | N/A |

**Compatibility risks:** Statement/balance routes previously allowed unauthenticated access with only `business_id`; now require login + operational subscription.

---

### 3. Accounts

| Route | Methods | Old security | New security | RBAC preserved |
|-------|---------|--------------|--------------|----------------|
| `/api/accounts` | GET, POST | JWT + `authorize(settings)` | Wrapper + same in handler | Yes |
| `/api/accounts/[id]` | GET, PATCH, DELETE | JWT + `authorize(settings)` | Wrapper + same in handler | Yes |
| `/api/accounts/groups` | GET, POST | Query/body `business_id` only | Wrapper (401 + subscription) | N/A |
| `/api/accounts/reconciliation` | GET | Query `business_id` only | Wrapper (401 + subscription) | N/A |
| `/api/accounts/initialize` | POST | Body `business_id` only | Wrapper (401 + subscription) | N/A |
| `/api/accounts/close-year` | POST | Body `business_id` only | Wrapper (401 + subscription) | N/A |

**Compatibility risks:** Groups, reconciliation, initialize, and close-year gained authentication requirement (previously open with `business_id`).

---

### 4. Budgets

| Route | Methods | Old security | New security | RBAC preserved |
|-------|---------|--------------|--------------|----------------|
| `/api/budgets` | GET, POST | Query/body `business_id` only | Wrapper (401 + subscription) | N/A |
| `/api/budgets/[id]/variance` | GET | Query `business_id` only | Wrapper (401 + subscription) | N/A |

**Compatibility risks:** No prior auth; clients must send valid session cookie. Expired subscriptions blocked.

---

### 5. TDS

| Route | Methods | Old security | New security | RBAC preserved |
|-------|---------|--------------|--------------|----------------|
| `/api/tds/categories` | GET, POST | Query/body `business_id` | Wrapper | N/A |
| `/api/tds/categories/[id]` | GET, PUT, DELETE | Query/body `business_id` | Wrapper | N/A |
| `/api/tds/certificates` | GET, POST | Query/body `business_id` | Wrapper | N/A |
| `/api/tds/certificates/[id]/pdf` | GET | Id-only lookup | Wrapper + SQL scoped to tenant | N/A |
| `/api/tds/deduct` | POST | Body `business_id` | Wrapper | N/A |
| `/api/tds/payments` | GET, POST | Query/body `business_id` | Wrapper | N/A |
| `/api/tds/reports/summary` | GET | Query `business_id` | Wrapper | N/A |
| `/api/tds/transactions` | GET | Query `business_id` | Wrapper | N/A |

**Compatibility risks:** Certificate PDF previously fetchable by id without tenant check; now requires session + matching tenant.

---

### 6. Bank Statements

| Route | Methods | Old security | New security | RBAC preserved |
|-------|---------|--------------|--------------|----------------|
| `/api/bank-statements/import` | POST | Body `business_id` | Wrapper | N/A |
| `/api/bank-statements/reconcile` | POST | Body `business_id` | Wrapper | N/A |
| `/api/bank-statements/reconciliation-report` | GET | Query `business_id` | Wrapper | N/A |
| `/api/bank-statements/unreconciled` | GET | Query `business_id` | Wrapper | N/A |

**Compatibility risks:** No prior auth or subscription gate.

---

### 7. GST Utilities

#### Routes wrapped with `withPremiumSubscriptionApi`

| Route | Methods | Old security | New security | Feature check preserved |
|-------|---------|--------------|--------------|-------------------------|
| `/api/gst/charges` | GET | JWT + `authorize(journal)` + `enforceAccess(LEDGER_ACCOUNTING)` | Wrapper + same in handler | Yes |
| `/api/gst/revise` | POST | Same + feature | Wrapper + same in handler | Yes |
| `/api/gst/gstr3b/export` | GET | Same + feature | Wrapper + same in handler | Yes |
| `/api/gst/setoff` | POST | Same + feature | Wrapper + same in handler | Yes |
| `/api/gst/status` | GET | Same + feature | Wrapper + same in handler | Yes |
| `/api/gst/audit-comparison` | GET | Same + feature | Wrapper + same in handler | Yes |
| `/api/gst/outstanding` | GET | JWT + `authorize(journal)` only | Wrapper + same in handler | N/A (none before) |
| `/api/gst/file` | POST | JWT + authorize + feature | Wrapper + same in handler | Yes |
| `/api/gst/payment` | POST | JWT + authorize + feature | Wrapper + same in handler | Yes |

#### GSTR-2B (guard updated, not re-wrapped)

| Route | Methods | Old security | New security | Feature check preserved |
|-------|---------|--------------|--------------|-------------------------|
| `/api/gst/gstr2b/decision` | GET, POST | `assertGstr2bApiAccess` | Guard + **`requireOperationalSubscription`** | Yes (`assertReportAccess` gst) |
| `/api/gst/gstr2b/import` | POST | Same | Same | Yes |
| `/api/gst/gstr2b/reconcile` | GET, POST | Same | Same | Yes |
| `/api/gst/gstr2b/export` | GET | Same | Same | Yes |

**Compatibility risks:** Expired subscription now fails at wrapper/guard before branch resolution. `enforceAccess` + `assertFeatureAccess` still run in handler for utility routes (duplicate subscription read is intentional for identical behavior).

---

### 8. WhatsApp Premium Features

**Wrapper:** `withWhatsAppPremiumApi` = operational subscription + tenant + **`hasWhatsAppBotAddon`** (preserved, not plan registry).

#### Migrated (31 files)

- `/api/whatsapp/users`
- `/api/whatsapp/sync`
- `/api/whatsapp/auto-assign`
- `/api/whatsapp/lead-profiles`
- `/api/whatsapp/dashboard/campaigns`
- `/api/whatsapp/bot-rules`, `/api/whatsapp/bot-rules/[id]`
- `/api/whatsapp/saved-replies`, `/api/whatsapp/saved-replies/[id]`
- `/api/whatsapp/campaigns`, `/api/whatsapp/campaigns/[id]`
- `/api/whatsapp/contacts`, `/api/whatsapp/contacts/import`, `/api/whatsapp/contacts/[phone]`
- `/api/whatsapp/contact-groups`, `/api/whatsapp/contact-groups/[id]/members`
- `/api/whatsapp/unsubscribes`
- `/api/whatsapp/conversations` (+ summary, export, stream, live, live/[jid]/messages)
- `/api/whatsapp/conversations/[id]` (+ messages, notes, labels, timeline, export, custom-fields, custom-fields/[key])

#### Intentionally not migrated

| Route | Reason |
|-------|--------|
| `/api/whatsapp/webhook` | HMAC verification, not user session |
| `/api/whatsapp/qr`, `/status`, `/disconnect` | Connection lifecycle |
| `/api/whatsapp/reminders`, `/reminders/[type]` | Basic reminders (non-addon) |
| `/api/whatsapp/send` | Invoice messages allowed without addon |
| `/api/whatsapp/dashboard/agents`, `/dashboard/overview` | No addon gate in handler |
| `/api/whatsapp/labels`, `/labels/[id]`, `/media` | No addon gate |
| `/api/whatsapp/orders`, `/orders/[id]/*` | Order approval flow |
| `/api/whatsapp/bot-rules/[id]/chains` | Not in premium addon list |
| `/api/whatsapp/send-bulk-reminders` | Separate product path |

**Compatibility risks:**

- **`/api/whatsapp/dashboard/campaigns`:** Previously returned empty stats without addon; now **403** (consistent with other premium routes).
- **SSE `/conversations/stream`:** Still returns `Response`; wrapper cast to satisfy types.
- **Campaign POST (multipart):** Does not use `parseJsonBody`; tenant from JWT session only.

---

## Verification steps

### 1. Expired subscription → 403 (success criterion)

With a valid JWT for a business whose subscription is expired/cancelled/suspended:

```bash
# Example: work orders
curl -b cookies.txt "https://staging.khatario.com/api/work-orders?business_id=<SESSION_UUID>"
# Expected: 403 { "code": "NO_SUBSCRIPTION" | "SUBSCRIPTION_EXPIRED" | ... }

# Example: WhatsApp premium
curl -b cookies.txt "https://staging.khatario.com/api/whatsapp/campaigns?business_id=<SESSION_UUID>"
# Expected: 403 (subscription or addon depending on state)

# Example: GST utility
curl -b cookies.txt "https://staging.khatario.com/api/gst/outstanding?business_id=<SESSION_UUID>&as_on_date=2024-01-31"
# Expected: 403 if subscription not operational
```

### 2. Active / trial subscription → 200 (or existing 403 for RBAC/feature)

Repeat calls with an operational tenant; behavior should match pre-migration except cross-tenant `business_id` returns **403**.

### 3. Cross-tenant IDOR

```bash
curl -b cookies.txt "https://staging.khatario.com/api/budgets?business_id=<OTHER_BUSINESS_UUID>"
# Expected: 403 Business ID does not match your session
```

### 4. Compile

```bash
npx tsc --noEmit
```

---

## Files modified (by area)

### Security infrastructure

- `lib/security/types.ts` — optional RBAC, `afterSubscription`, `resolveActingUserId`
- `lib/security/with-business-api.ts` — session validation, hooks
- `lib/security/premium-module-api.ts` — **new**
- `lib/security/index.ts` — exports
- `lib/gst/gstr2b-route-guard.ts` — `requireOperationalSubscription`

### Application routes

See grep: `withPremiumSubscriptionApi|withWhatsAppPremiumApi` under `app/api/` (66 route files).

---

## Rollback note

Revert wrapper exports to `export async function GET/POST` and restore manual auth blocks from git history. Subscription enforcement is entirely in the wrapper layer for migrated routes.
