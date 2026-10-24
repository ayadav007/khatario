# Phase 3D — seven dashboard isolation fixes

The Phase 3C baseline stays in `docs/qa/phase-3c-identity-audit-results.md`. This file records the fix and the rerun.

## Cause

Each of the seven GET handlers read `user_id` and `business_id` with `getUserIdFromRequest` and `getBusinessIdFromRequest`. Those helpers accept a query value, a body field, and `x-user-id` when the trusted session headers are missing. The handlers then called `authorize(userId, 'dashboard', 'read')` without a business id. A primary admin of business A passed that check, and the SQL used the caller-supplied business id. Pairing user A's trusted headers with business B's id did the same thing, because authorization never compared the two.

`accountOutstandingStoreOrders` on today's sales and the sales summary used that same business id. After the fix it receives the session business and the session user.

Middleware still returns 401 for these paths with no cookie. That was already true in Phase 3C. No live HTTP server was started in this phase, so a browser bypass was not demonstrated.

## What changed

GET only. Date range, limit, and the chart and total calculations are unchanged. Query `business_id` and `user_id` are ignored.

| Route | Change |
| --- | --- |
| `GET /api/dashboard/today-sales` | `requireStrictSession`, then `authorize(..., { businessId })`. Store-order catch-up uses that business. |
| `GET /api/dashboard/recent-invoices` | Same session rule. `limit` remains a filter. |
| `GET /api/dashboard/top-customers` | Same session rule. `limit` remains a filter. |
| `GET /api/dashboard/today-purchases` | Same session rule. |
| `GET /api/dashboard/sales-summary` | Same session rule. Store-order catch-up uses that business. |
| `GET /api/dashboard/charts` | Same session rule. `start_date` and `end_date` remain required filters. |
| `GET /api/dashboard/low-stock` | Same session rule. `limit` remains a filter. |

`requireStrictSession` reads only `x-authenticated-user-id`, `x-authenticated-business-id`, and the session version, and compares the version with `users.auth_session_version`. A missing or non-UUID session is HTTP 401 `UNAUTHENTICATED`. A stale version is HTTP 401 `SESSION_REVOKED`. `authorize` with the session business returns HTTP 403 `CROSS_TENANT_DENIED` when the user does not belong to that business.

The four Phase 3B list handlers were not edited.

## Commands

Database guard: the identity suite stops unless `current_database()` is `kh_phase2_test` on port 5433 and the server address is loopback.

`npx jest tests/db/phase3c-identity-fallback.db.test.ts --runInBand --forceExit`

Result: 1 suite, 8 passed. `authorize` and `requireStrictSession` were not stubbed.

`npx jest tests/db/phase3a-auth-isolation.db.test.ts tests/db/soft-delete-items-and-report.db.test.ts tests/security/middleware-identity-headers.test.ts --runInBand --forceExit`

Result: 3 suites, 19 passed. This reruns the Phase 3B invoice, item, purchase, and payment list checks, the soft-delete item checks, and the middleware header check.

## Endpoint results

| Route | No session, forged query and `x-user-id` | User A headers with business B | Stale version 999 | Valid session A with query business B | Status |
| --- | --- | --- | --- | --- | --- |
| `GET /api/dashboard/today-sales` | HTTP 401, marker absent | HTTP 403, marker absent | HTTP 401 `SESSION_REVOKED` | HTTP 200, A's customer only | PASS |
| `GET /api/dashboard/recent-invoices` | HTTP 401, marker absent | HTTP 403, marker absent | HTTP 401 `SESSION_REVOKED` | HTTP 200, A's customer only | PASS |
| `GET /api/dashboard/top-customers` | HTTP 401, marker absent | HTTP 403, marker absent | HTTP 401 `SESSION_REVOKED` | HTTP 200, A's customer only | PASS |
| `GET /api/dashboard/today-purchases` | HTTP 401, marker absent | HTTP 403, marker absent | HTTP 401 `SESSION_REVOKED` | HTTP 200, A's supplier only | PASS |
| `GET /api/dashboard/sales-summary` | HTTP 401, marker absent | HTTP 403, marker absent | HTTP 401 `SESSION_REVOKED` | HTTP 200, today and month sales 10 | PASS |
| `GET /api/dashboard/charts` | HTTP 401, marker absent | HTTP 403, marker absent | HTTP 401 `SESSION_REVOKED` | HTTP 200, sales 10 and purchases 4 | PASS |
| `GET /api/dashboard/low-stock` | HTTP 401, marker absent | HTTP 403, marker absent | HTTP 401 `SESSION_REVOKED` | HTTP 200, A's item only | PASS |

Business B's invoice total in the fixture is 77.13. That value was absent from the valid session responses. Failed requests left invoice count, item stock sum, purchase count, and `ledger_entry_lines` count unchanged for the two fixture businesses.

Middleware `()` in Jest still returns 401 for these paths with no cookie. A live Next.js server was not run.

## Remaining risks

Other dashboard routes were not changed in Phase 3D. Phase 3E later confirmed leaks on `GET /api/dashboard/top-products`, `GET /api/dashboard/receivables`, `GET /api/dashboard/cash-flow`, and the credit-note, expense, debit-note, estimate, sales-order, and customer lists. Phase 3F fixed those nine GETs. See `docs/qa/phase-3f-identity-fix-results.md`. The rest of the fallback pool is NOT TESTED.

The chart error logger still reads a query `business_id` for a console message after a failure. The successful query uses the session business.
