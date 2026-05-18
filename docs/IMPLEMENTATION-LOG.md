# Khatario implementation log (agent-maintained)

This file tracks **decisions**, **suggested improvements**, and **what was actually implemented** so work is not lost between sessions. Update it whenever scope changes or a milestone ships.

## Principles (owner intent)

- Prioritize **security**, **data correctness** (tax/accounting), then **search/matching UX**, then polish.
- Prefer **small, testable** changes over large refactors.
- **Note:** `x-admin-id` + `platform_admins` is the current platform-admin transport; a future JWT/httpOnly cookie for admin APIs is recommended.

---

## Expert roadmap (suggested, not all done)

| Area | Suggestion | Status |
|------|------------|--------|
| Platform `/api/admin/*` | Require authenticated platform admin (`requirePlatformRequest` + `x-admin-id`) on sensitive routes | Mostly done; see changelog (public exceptions: plans GET, reports GET) |
| Global search | Postgres `pg_trgm` or `tsvector` for ranked, typo-tolerant search | Not started |
| Item / line matching | Levenshtein (or Jaro) + existing HSN rules, unit tests | Partial (similarity lib + matcher) |
| Tax / GSTR-1 / reports | Golden tests for amounts, rounding, export shape | Not started (PBAC tests exist) |
| Ops | Structured logs, correlation IDs, queue metrics | Not started |
| Code TODOs | Credit approvals, WhatsApp lead assignment, balance sheet gaps, email logs, etc. | Tracked in codebase |

---

## Implemented (changelog)

### 2026-04-22 — Suppliers Hub (MVP)

- **Plan:** `docs/SUPPLIERS-HUB-PLAN.md` (roadmap + phases).
- **DB:** `database/migrations/178_suppliers_hub_discovery.sql` — `business_discovery`, `supplier_connection_requests`, `supplier_published_listings`; notification types `hub_connection_request`, `hub_connection_accepted`, `hub_connection_declined`.
- **APIs:** `app/api/suppliers/hub/` — discovery (GET/PATCH), directory (GET), profile (GET), connection-requests (GET/POST, PATCH by id), published-listings (GET/POST, PATCH/DELETE by id).
- **UI:** `app/(app)/suppliers/hub/page.tsx`, `app/(app)/suppliers/hub/[businessId]/page.tsx`; settings `app/(app)/settings/suppliers-directory/page.tsx`; Sidebar links under Purchases and Settings.
- **Types:** `types/database.ts` — `BusinessDiscovery`, `SupplierConnectionRequest`, `SupplierPublishedListing`, etc.
- **Ops:** Apply migrations **178** then **179** on each environment. If **178** failed on `chk_notification_type` (23514), **179** repairs the constraint; **178** was updated to include types from migration **130** (`invoice_nearing_due`, `invoice_overdue`, `todo_reminder`).

### 2026-04-22 (later) — Remaining `/api/admin/*` hardening

- **Secured (header + `requirePlatformRequest`):** `GET /api/admin/subscriptions`; `POST /api/admin/subscriptions/plans`; `POST /api/admin/reports`; `GET /api/admin/logs` (optional `filter_admin_id` / legacy `admin_id`); `GET /api/admin/features`; `GET /api/admin/limits`; `GET/POST` `/api/admin/plans/[planId]/features` and `/limits`; `GET/POST` `/api/admin/hsn-codes/stats` and `/upload`; `GET/PATCH` `/api/admin/bookings`, `/bookings/[id]`, `/bookings/stats`, `/bookings/time-slots` (+ `POST/PATCH/DELETE` on time-slots); `POST` `/api/admin/bookings/[id]/activities`; `GET/POST` `/api/admin/promotions`, `GET/PATCH/DELETE` `/api/admin/promotions/[id]`, `GET` `.../analytics`; `GET` `/api/admin/auth/me`; `GET/POST` `/api/admin/platform-users` (super_admin + `can_manage_admins`).
- **Intentionally public reads:** `GET /api/admin/subscriptions/plans` (landing, upgrade modal, subscription settings); `GET /api/admin/reports` (app Sidebar report route map).
- **Clients:** `x-admin-id` wired for subscriptions, logs, reports POST, plan save + feature/limit matrices, bookings + time-slots + promotions, HSN admin page.
- **Removed:** debug `_debug` payload from subscriptions list API; noisy console logging there.

### 2026-04-22 — Platform admin API protection + item similarity

- **Auth helper:** `lib/platform-request-auth.ts` — `getPlatformAdminIdFromRequest`, `requirePlatformRequest` (wraps `requirePlatformAdmin`).
- **Secured routes:** `GET /api/admin/metrics`, `GET/DELETE` `/api/admin/businesses`, `GET/DELETE` `/api/admin/businesses/[id]` require `x-admin-id` and valid platform admin; metrics use `can_view_metrics`; business operations use `can_manage_businesses`.
- **Client:** `lib/admin-client-headers.ts` — `platformAdminAuthHeaders(adminId)`; wired on admin dashboard, businesses list, business detail (fetch + delete).
- **Matching:** `lib/string-similarity.ts` — Levenshtein + percent score; `item-matcher.ts` uses **max(legacy word heuristic, Levenshtein score)** for fuzzy matches.
- **Tests:** `tests/lib/string-similarity.test.ts` — basic coverage for the new helper.
- **Note:** Platform role `support` has `can_manage_businesses: false` — they will get 403 on businesses APIs (metrics still allowed). Add a read-only permission + route if support should browse businesses.

### Earlier (from prior sessions — summary)

- Journal entries filter: search field aligned with date fields (`Input` + label + icon).
- GSTR-1: stored tax amounts, multi-rate, exports/JSON, CDNs, B2CL threshold hints, etc.
- Items API: `gst_included` on PATCH.
- Journal new entry: account dropdown closes on outside click.

---

### 2026-04-22 — Settings hub (Zoho-style)

- **`/settings`:** Full **All settings** hub (`components/settings/SettingsHub.tsx`): sticky header, business name, pill search (focus with `/`), **Close settings** → dashboard, two sections (organization + module) in large cards and a responsive multi-column link grid. Permissions/features aligned with Sidebar rules via `useCapabilityCheck` + `warehousesEnabled`.
- **Drill-in `/settings/*`:** Sidebar uses the **settings tree only** on sub-routes (`Sidebar.tsx`: `isSettingsPage` excludes `/settings`).
- **Data:** `lib/settings-hub-data.ts` — keep in sync when adding settings routes.

## Next up (recommended order)

1. Optional: split **public** reads onto `/api/public/...` (plans, report definitions) so `/api/admin/*` is uniformly authenticated.
2. Add **Jest** golden tests for one GSTR-1 or invoice tax scenario.
3. **pg_trgm** migration + search API for items/customers (DB-side).
4. Optional: **httpOnly** session cookie for platform admin instead of header-only (CSRF, XSS footprint).

---

## How to use this file

- Before a large feature: add a row under **roadmap** or **next up**.
- When merging work: append to **Implemented** with date and bullets.
- Do not delete historical rows; mark **superseded** if replaced.
