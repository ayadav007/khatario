# Phase 3E — remaining identity and tenant-isolation checks

The nine failures below are the original baseline. They were fixed in Phase 3F. The fix and the rerun are in `docs/qa/phase-3f-identity-fix-results.md`. This file keeps the original FAIL.

Baseline only. Application code was not changed in Phase 3E. Phase 3B and Phase 3D fixes were left in place. The Phase 3C empty-list notes stay as history. This run seeded rows that each owning session can actually see, then repeated the identity attacks.

Database: the suite stops unless `current_database()` is `kh_phase2_test` on port 5433 and the server address is loopback.

Handlers were called from Jest. `middleware()` was called directly. A live Next.js server was not started, so cookie and handler were not proven on one HTTP request. `authorize` was not stubbed.

## What the code does

All nine GET handlers still take the business id from `getBusinessIdFromRequest` and the user id from `getUserIdFromRequest`. Those helpers use the trusted session headers when they are present, and otherwise accept a query `user_id` / `business_id` or `x-user-id`.

`authorize` is called without a business id on every handler in this batch. A primary admin therefore passes even when the business id belongs to another company.

Branch filtering then differs:

| Route | After authorize | Branch behavior |
| --- | --- | --- |
| `GET /api/dashboard/top-products` | SQL on the supplied business id | No branch filter |
| `GET /api/dashboard/cash-flow` | Payments and expenses for the supplied business id. `fiscal_year` is a date filter. | No branch filter |
| `GET /api/dashboard/receivables` | Outstanding invoices for the supplied business id | Restricted to the caller's branches |
| `GET /api/credit-notes` | List, or next number | Branch filter skipped when the user is primary admin of that business |
| `GET /api/expenses` | List | Same admin skip |
| `GET /api/debit-notes` | List | Same admin skip |
| `GET /api/estimates` | Proforma invoices | Always limited to the caller's branches |
| `GET /api/sales-orders` | List. `status` and `customer_id` are filters. | Limited to the caller's branches |
| `GET /api/customers` | List. `search` and `filter` are filters. | Branch filter skipped when the user is primary admin of that business |

`limit`, `page`, `search`, `status`, `customer_id`, and `fiscal_year` are filters. `user_id` and `business_id` are used as identity.

## Command

`npx jest tests/db/phase3e-identity-fallback.db.test.ts --runInBand --forceExit`

Result: 1 suite, 2 passed, 1 failed. The failure is the cross-tenant read below. Invoice count for the two fixture businesses was unchanged.

The owning-session test passed: each business's own session returned its own marker (or, for cash flow, its own receipt amount). An empty list is not what this fixture produces for a real session.

Middleware returned HTTP 401 for these nine paths with no cookie, including spoofed `x-authenticated-*` headers.

## Confirmed defects

No trusted session. Query `user_id` is business B's primary admin and query `business_id` is B, with `x-user-id` for B. Every handler returned HTTP 200 containing B's marker or the 88.88 receipt.

| Route | Result |
| --- | --- |
| `GET /api/dashboard/top-products` | FAIL HTTP 200, B's item name |
| `GET /api/dashboard/receivables` | FAIL HTTP 200, B's customer |
| `GET /api/dashboard/cash-flow` | FAIL HTTP 200, 88.88 |
| `GET /api/credit-notes` | FAIL HTTP 200, B's credit note |
| `GET /api/expenses` | FAIL HTTP 200, B's expense |
| `GET /api/debit-notes` | FAIL HTTP 200, B's debit note |
| `GET /api/estimates` | FAIL HTTP 200, B's proforma |
| `GET /api/sales-orders` | FAIL HTTP 200, B's order |
| `GET /api/customers` | FAIL HTTP 200, B's customer |

The same two dashboard routes also returned B's data when the caller was user A with no session, and when the headers were user A plus business B:

| Route | User A query, no session | User A headers, business B |
| --- | --- | --- |
| `GET /api/dashboard/top-products` | FAIL HTTP 200 | FAIL HTTP 200 |
| `GET /api/dashboard/cash-flow` | FAIL HTTP 200 | FAIL HTTP 200 |

Those two have no branch filter, so user A's identity is enough. The other seven did not include B's marker in those two shapes: HTTP 200 with an empty list, because user A is not primary admin of B and A's branches do not include B's branch. That empty list is not a denial. Supplying B's own user id removes the filter and the rows appear.

A real session for A, with query `business_id` and `user_id` set to B, returned A's own marker and did not return B's. The trusted business header wins over the query in `getBusinessIdFromRequest`. That path is PASS for these nine GETs.

## What to fix first

The nine GET handlers were fixed in Phase 3F with `requireStrictSession` and `authorize` on the session business. The original FAIL above stays as history.

## Not tested

POST, PUT, and DELETE on these routes. Other dashboard routes. The rest of the 223-file fallback pool. A live application server.
