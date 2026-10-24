# Phase 3F — nine GET identity fixes

The Phase 3E baseline stays in `docs/qa/phase-3e-identity-audit-results.md`. This file records the fix and the rerun.

## Cause

Each GET handler read the user and business with `getUserIdFromRequest` and `getBusinessIdFromRequest`. When the trusted session headers are missing, those helpers accept a query `user_id`, a query `business_id`, and `x-user-id`. The handlers then called `authorize` without a business id. A primary admin passed that check for any business id the caller sent. Supplying business B's own primary-admin id made the branch filter treat the caller as B's admin, so credit notes, expenses, debit notes, estimates, sales orders, customers, and receivables returned B's rows. Top products and cash flow have no branch filter, so user A's id was enough.

## What changed

GET only. Search, status, customer id, date range, fiscal year, limit, page, and branch filters are unchanged. Query `user_id` and `business_id` are ignored.

| Route | Change |
| --- | --- |
| `GET /api/dashboard/top-products` | `requireStrictSession`, then `authorize(..., { businessId })`. `limit` remains a filter. |
| `GET /api/dashboard/receivables` | Same session rule. Branch filter still uses the session user. |
| `GET /api/dashboard/cash-flow` | Same session rule. `fiscal_year` remains a filter. Totals use the session business. |
| `GET /api/credit-notes` | Same session rule. Search, page, and limit remain filters. |
| `GET /api/expenses` | Same session rule. Category and date filters remain. POST was not changed. |
| `GET /api/debit-notes` | Same session rule. |
| `GET /api/estimates` | Same session rule, still authorizing `invoices` read. |
| `GET /api/sales-orders` | Same session rule. `status` and `customer_id` remain filters. |
| `GET /api/customers` | Same session rule. Search, filter, and page remain. Billing module check uses the session business. |

A missing session is HTTP 401 `UNAUTHENTICATED`. A stale version is HTTP 401 `SESSION_REVOKED`. User A with business B's session business is HTTP 403 `CROSS_TENANT_DENIED`.

## Commands

Database guard: the identity suite stops unless `current_database()` is `kh_phase2_test` on port 5433 and the server address is loopback. The related-document run checked the same database name and port before Jest started.

`npx jest tests/db/phase3e-identity-fallback.db.test.ts tests/db/phase3c-identity-fallback.db.test.ts tests/db/phase3a-auth-isolation.db.test.ts tests/db/soft-delete-items-and-report.db.test.ts tests/security/middleware-identity-headers.test.ts --runInBand --forceExit`

Result: 5 suites, 32 passed. `authorize` and `requireStrictSession` were not stubbed in the Phase 3E file.

The Phase 3E file now also requires HTTP 401 or 403 on the forged calls, rejects session version 999, and checks customer search, sales-order status, and an expense date range. Invoice count and ledger-line count for the fixture businesses did not change on the rejected calls.

Related tests, with `PHASE2_TEST_DATABASE_URL` pointed at `kh_phase2_test`:

`npx jest tests/db/phase3-7-final-documents.db.test.ts tests/db/phase4-4-payment-reversal.db.test.ts -t "debit note from another business|reports exclude reversed payments" --runInBand --forceExit`

Result: 2 passed, 62 skipped. The debit-note list test still stubs `authorize`, so it does not prove the new tenant check. It does show the list for the session business includes that business's note and the other request does not. The cash-flow report test still returns HTTP 200 for a session whose user belongs to that business, and reversed payments stay out of the active total.

## Endpoint results

| Route | No session, including B's own user id | User A headers with business B | Stale version | Valid session A with query business B | Filters | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `GET /api/dashboard/top-products` | HTTP 401, marker absent | HTTP 403, marker absent | HTTP 401 `SESSION_REVOKED` | HTTP 200, A's item only | `limit` still read | PASS |
| `GET /api/dashboard/receivables` | HTTP 401, marker absent | HTTP 403, marker absent | HTTP 401 `SESSION_REVOKED` | HTTP 200, A's invoice only | branch filter kept | PASS |
| `GET /api/dashboard/cash-flow` | HTTP 401, 88.88 absent | HTTP 403, 88.88 absent | HTTP 401 `SESSION_REVOKED` | HTTP 200, A's 11.11 only | `fiscal_year` kept | PASS |
| `GET /api/credit-notes` | HTTP 401, marker absent | HTTP 403, marker absent | HTTP 401 `SESSION_REVOKED` | HTTP 200, A's note only | search kept | PASS |
| `GET /api/expenses` | HTTP 401, marker absent | HTTP 403, marker absent | HTTP 401 `SESSION_REVOKED` | HTTP 200, A's expense only | date range excluded 2099 | PASS |
| `GET /api/debit-notes` | HTTP 401, marker absent | HTTP 403, marker absent | HTTP 401 `SESSION_REVOKED` | HTTP 200, A's note only | — | PASS |
| `GET /api/estimates` | HTTP 401, marker absent | HTTP 403, marker absent | HTTP 401 `SESSION_REVOKED` | HTTP 200, A's proforma only | — | PASS |
| `GET /api/sales-orders` | HTTP 401, marker absent | HTTP 403, marker absent | HTTP 401 `SESSION_REVOKED` | HTTP 200, A's order only | `status=confirmed` kept | PASS |
| `GET /api/customers` | HTTP 401, marker absent | HTTP 403, marker absent | HTTP 401 `SESSION_REVOKED` | HTTP 200, A's customer only | `search` kept | PASS |

Middleware `()` in Jest still returns 401 for these paths with no cookie. A live Next.js server was not run.

## Remaining risks

POST on credit notes, expenses, debit notes, estimates, sales orders, and customers was not changed. Expenses POST still reads `business_id` from the request body. Those methods are NOT TESTED in this phase.

Other handlers in the fallback pool, and the middleware-public routes, were not changed. The debit-note list test in `phase3-7-final-documents` stubs `authorize`, so it is not proof of the tenant check.
