# P0 Security Fix Report

**Date:** 2026-06-06  
**Scope:** P0 findings from subscription / cross-tenant security audits only.

---

## Summary

| Area | Status |
|------|--------|
| Cron authentication | Fixed |
| `POST /api/items/import` | Fixed |
| `/api/gst/gstr2b/*` | Fixed |
| `GET/PATCH /api/businesses/[id]` | Fixed |

---

## 1. Cron endpoints

### Files modified

- `lib/cron-auth.ts`
- `app/api/cron/process-campaigns/route.ts`
- `app/api/cron/check-low-stock/route.ts`
- `app/api/cron/refresh-profile-pictures/route.ts`
- `app/api/cron/process-reversing-entries/route.ts`
- `app/api/cron/process-scheduled-backups/route.ts`
- `app/api/cron/send-payment-reminders/route.ts`
- `app/api/cron/send-todo-reminders/route.ts`

(Routes already using `assertCronAuthorized` from `lib/cron-auth.ts` — `check-subscriptions`, `send-daily-invoice-summary` — inherit the hardened helper automatically.)

### Vulnerability fixed

- `process-campaigns` had cron auth **commented out** — anyone could trigger WhatsApp campaign processing.
- `assertCronAuthorized` returned `null` when `CRON_SECRET` was unset, allowing **all** cron jobs to run with no authentication.
- Several cron routes had **no** auth check or only checked the secret when it was configured (`if (cronSecret && …)`).

### Before behavior

- `GET/POST /api/cron/process-campaigns` → always executed `processAllCampaigns()`.
- With `CRON_SECRET` unset → cron routes accepted unauthenticated requests.
- With `CRON_SECRET` set but wrong/missing `Authorization` header → some routes still ran (when secret check was conditional).

### After behavior

- `assertCronAuthorized` **fails closed**:
  - Missing `CRON_SECRET` → **503** `{ error: 'Cron authentication is not configured (CRON_SECRET missing)' }`
  - Wrong/missing bearer → **401** `{ error: 'Unauthorized' }`
  - Valid `Authorization: Bearer <CRON_SECRET>` → handler runs.
- All listed cron routes call `assertCronAuthorized(request)` before doing work.

### Verification steps

```bash
# No secret configured → 503
curl -X POST https://staging.khatario.com/api/cron/process-campaigns

# Wrong bearer → 401
curl -X POST https://staging.khatario.com/api/cron/process-campaigns \
  -H "Authorization: Bearer wrong"

# Valid (set CRON_SECRET on server first) → 200
curl -X POST https://staging.khatario.com/api/cron/process-campaigns \
  -H "Authorization: Bearer $CRON_SECRET"
```

Repeat for `check-low-stock`, `process-scheduled-backups`, `send-payment-reminders`.

---

## 2. Items bulk import

### Files modified

- `app/api/items/import/route.ts`

### Vulnerability fixed

- Accepted `business_id` from JSON body with **no** session binding, RBAC, or subscription checks — cross-tenant item creation and plan limit bypass.

### Before behavior

- Any authenticated user (JWT for tenant A) could `POST` with `business_id` for tenant B and bulk-insert items.
- No `authorize`, `enforceAccess`, or `checkLimit`.

### After behavior

- `requireTenantBusinessId(request, body.business_id)` — **403** if body tenant ≠ session tenant.
- Requires authenticated user (`getUserIdFromRequest`).
- `authorize(userId, 'items', 'create')` — RBAC.
- `enforceAccess({ businessId, userId, limitType: 'items' })` — operational subscription + limit gate.
- Pre-import check: `current + items.length` must not exceed plan item limit.
- All SQL uses session-scoped `tenant.businessId`.

### Verification steps

```bash
# Cross-tenant body → 403
curl -b cookies.txt -X POST https://staging.khatario.com/api/items/import \
  -H "Content-Type: application/json" \
  -d '{"business_id":"<OTHER_BUSINESS_UUID>","items":[{"name":"Test"}]}'

# Own tenant, valid session → 200 (if permitted and under limit)
curl -b cookies.txt -X POST https://staging.khatario.com/api/items/import \
  -H "Content-Type: application/json" \
  -d '{"business_id":"<SESSION_BUSINESS_UUID>","items":[{"name":"Test"}]}'
```

---

## 3. GSTR-2B API routes

### Files modified

- `lib/gst/gstr2b-route-guard.ts` *(new)*
- `app/api/gst/gstr2b/decision/route.ts`
- `app/api/gst/gstr2b/import/route.ts`
- `app/api/gst/gstr2b/reconcile/route.ts`
- `app/api/gst/gstr2b/export/route.ts`

### Vulnerability fixed

- Routes used client `business_id` (query/body/form) with **no** tenant validation, authorization, or GST report subscription check.
- `decision` POST trusted `decided_by_user_id` from the body (identity spoofing).

### Before behavior

- Any logged-in user could read/write GSTR-2B data for arbitrary businesses.
- No `assertReportAccess(..., 'gst')` or `authorize(..., 'report.gst', ...)`.

### After behavior

Shared guard `assertGstr2bApiAccess(request, claimedBusinessId, action)` enforces:

1. `requireTenantBusinessId` — session tenant only; mismatch → **403**
2. Authenticated user required → **401**
3. `assertReportAccess(businessId, 'gst')` — subscription → **403** if not entitled
4. `authorize(userId, 'report.gst', action, { businessId })` — RBAC

Per route:

| Route | Action | Notes |
|-------|--------|-------|
| `POST /api/gst/gstr2b/decision` | create | Uses session `userId` as `decided_by_user_id` |
| `GET /api/gst/gstr2b/decision` | read | Eligible ITC for session tenant |
| `POST /api/gst/gstr2b/import` | create | `imported_by` = session user |
| `POST/GET /api/gst/gstr2b/reconcile` | create / read | SQL scoped to session tenant |
| `GET /api/gst/gstr2b/export` | read | Excel export for session tenant |

### Verification steps

```bash
# Cross-tenant query → 403
curl -b cookies.txt \
  "https://staging.khatario.com/api/gst/gstr2b/reconcile?business_id=<OTHER_UUID>&filing_period=2024-01"

# Free plan / no GST reports → 403 FEATURE_NOT_IN_PLAN
curl -b cookies.txt \
  "https://staging.khatario.com/api/gst/gstr2b/reconcile?business_id=<SESSION_UUID>&filing_period=2024-01"
```

---

## 4. Business profile by ID

### Files modified

- `app/api/businesses/[id]/route.ts`

### Vulnerability fixed

- `GET` and `PATCH` used path `params.id` directly with **no** auth — any user could read or update any business record (cross-tenant IDOR).

### Before behavior

- `GET /api/businesses/<any-uuid>` returned business PII (name, email, phone, GSTIN, address).
- `PATCH /api/businesses/<any-uuid>` updated any business row.

### After behavior

- `requireTenantBusinessId(request, params.id)` — path ID must match JWT business → **403** otherwise.
- Authenticated user required → **401**
- `authorize(userId, 'settings', 'read'|'update', { businessId })` — RBAC
- SQL uses `tenant.businessId` only.

### Verification steps

```bash
# Another business UUID → 403
curl -b cookies.txt https://staging.khatario.com/api/businesses/<OTHER_BUSINESS_UUID>

curl -b cookies.txt -X PATCH https://staging.khatario.com/api/businesses/<OTHER_BUSINESS_UUID> \
  -H "Content-Type: application/json" \
  -d '{"name":"Hacked"}'

# Own business → 200 (with settings permission)
curl -b cookies.txt https://staging.khatario.com/api/businesses/<SESSION_BUSINESS_UUID>
```

---

## Files changed (complete list)

| File | Change |
|------|--------|
| `lib/cron-auth.ts` | Fail closed when `CRON_SECRET` missing |
| `lib/gst/gstr2b-route-guard.ts` | New shared GSTR-2B access guard |
| `app/api/cron/process-campaigns/route.ts` | Enable cron auth |
| `app/api/cron/check-low-stock/route.ts` | Add cron auth |
| `app/api/cron/refresh-profile-pictures/route.ts` | Add cron auth |
| `app/api/cron/process-reversing-entries/route.ts` | Use shared cron auth |
| `app/api/cron/process-scheduled-backups/route.ts` | Use shared cron auth |
| `app/api/cron/send-payment-reminders/route.ts` | Use shared cron auth |
| `app/api/cron/send-todo-reminders/route.ts` | Use shared cron auth |
| `app/api/items/import/route.ts` | Tenant + RBAC + subscription |
| `app/api/gst/gstr2b/decision/route.ts` | GSTR-2B guard |
| `app/api/gst/gstr2b/import/route.ts` | GSTR-2B guard |
| `app/api/gst/gstr2b/reconcile/route.ts` | GSTR-2B guard |
| `app/api/gst/gstr2b/export/route.ts` | GSTR-2B guard |
| `app/api/businesses/[id]/route.ts` | Tenant + RBAC on GET/PATCH |

---

## Deployment note

Ensure **`CRON_SECRET`** is set in staging/production environment before deploy; otherwise all cron endpoints return **503** until configured. Scheduled jobs must send:

`Authorization: Bearer <CRON_SECRET>`
