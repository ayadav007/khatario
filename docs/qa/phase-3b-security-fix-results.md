# Phase 3B — four list-handler authentication fixes

Phase 3A found that four GET list handlers returned another business's rows when the session headers were absent and the query supplied a primary-admin user id plus the other business id. Middleware still returned 401 for those paths. This phase changes the handlers. It does not claim the rest of the API is secure.

## Original finding

`GET /api/invoices`, `GET /api/items`, `GET /api/purchases`, and `GET /api/payments` returned HTTP 200 with business B's records. The caller sent no `x-authenticated-*` session headers, `user_id` for business A's primary admin, and `business_id` for business B. Evidence is in `docs/qa/phase-3a-security-results.md`.

## Root cause

Each GET took the business id from `getBusinessIdFromRequest` and the user id from `getUserIdFromRequest`. Those helpers use the session headers when they are present, and otherwise accept the query string, the body, or `x-user-id`. The list permission check then called `authorize` without the target business id. A primary admin short-circuits role checks, so the query business id became the SQL scope.

Search, filter, and pagination parameters were not the problem. POST on these routes was not the failing path and was not changed.

## Fix

The four GET handlers now call `requireStrictSession`. The user id, business id, and session version come only from `x-authenticated-user-id`, `x-authenticated-business-id`, and `x-authenticated-session-version`. The version is checked against `users.auth_session_version`. A missing or non-matching session returns 401. `authorize` is called with that session business id, so a user id paired with another business id is denied. Query `business_id`, query `user_id`, and `x-user-id` are not used as identity. Search, status, date, branch, page, and limit parameters are unchanged.

Files:

- `app/api/invoices/route.ts` (GET only)
- `app/api/items/route.ts` (GET only)
- `app/api/purchases/route.ts` (GET only)
- `app/api/payments/route.ts` (GET only, including the order and reconciliation branches of that GET)

## Commands

Database for the mutating suites: `kh_phase2_test` on localhost port 5433, confirmed with `current_database()` inside those tests.

`npx jest tests/db/phase3a-auth-isolation.db.test.ts tests/db/soft-delete-items-and-report.db.test.ts tests/security/middleware-identity-headers.test.ts --runInBand --forceExit`

3 suites, 19 passed, 0 failed.

`node` runner that set `PHASE2_TEST_DATABASE_URL` to local `kh_phase2_test` and ran `npx jest tests/db/purchases-list-cancelled.db.test.ts --runInBand --forceExit`

1 suite, 7 passed, 0 failed. That file stubs `authorize` and the billing-module gate. It proves the purchase list filters, not permission enforcement.

## Results

| Check | Endpoint | Status |
| --- | --- | --- |
| No session, query user of A and business of B, plus `x-user-id` | invoices, items, purchases, payments | PASS. HTTP 401. B's marker was absent. |
| Session headers for user A and business B, with a matching session version | same four | PASS. HTTP 403. B's marker was absent. `authorize` received the session business id. |
| Valid session for A, query `business_id` of B | eight lists, including the four | PASS. B's marker was absent. A's own customer, item, invoice, and supplier markers were still returned. |
| Item search, type, page, and limit with a read-only session | `GET /api/items` | PASS. HTTP 200. A's item was present. B's item was absent. |
| Read-only user cannot list invoices, rename a customer, or create an invoice | existing phase 3A cases | PASS. Counts of invoices, ledger lines, and stock movements did not change. |
| Primary admin with no billing subscription | `GET /api/items` | PASS. Not HTTP 200. |
| Middleware, no cookie, spoofed `x-authenticated-*` headers | eight list paths, including the four | PASS. HTTP 401 before the handler. This is the middleware function, not a live browser request. |
| Purchase list filters, including cancelled bills and a spoofed query `business_id` | `GET /api/purchases` | PASS for the SQL filters. Authorization was stubbed in that file. |
| Item list after the session change | `tests/db/soft-delete-items-and-report.db.test.ts` | PASS. 4 tests. |

Authentication, tenant isolation, role permission, and subscription were asserted as separate cases in `tests/db/phase3a-auth-isolation.db.test.ts`. A pass in one case is not a pass for the others.

## Remaining risks

- POST, PATCH, and DELETE on these four routes were not part of the defect and were not changed.
- Other list handlers that still use `getUserIdFromRequest` or `getBusinessIdFromRequest` were not reviewed in this task.
- The purchases-list suite does not prove role or subscription enforcement.
- Middleware was verified by calling `middleware()` in Jest. A live HTTP server was not started.
- The other middleware-public routes remain NOT TESTED.
