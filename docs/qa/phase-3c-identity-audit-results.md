# Phase 3C — other API identity-trust checks

The seven dashboard failures in this file are the original baseline. They were fixed in Phase 3D. The fix and the rerun are in `docs/qa/phase-3d-dashboard-security-fix-results.md`. This file keeps the original FAIL.

Baseline only. Application code was not changed in Phase 3C. The Phase 3B session checks on `GET /api/invoices`, `GET /api/items`, `GET /api/purchases`, and `GET /api/payments` were left in place.

Database: the suite stops unless `current_database()` is `kh_phase2_test` on port 5433 and the server address is loopback. The assertions below ran only after that check passed.

This batch calls handlers from Jest. It also calls `middleware()` directly. It does not prove a live Next.js server, cookie, and handler together.

## How the search was done

A file scan of `app/api/**/route.ts` (942 files) counted handlers that still call `getUserIdFromRequest` or `getBusinessIdFromRequest`.

| Scan | Count |
| --- | --- |
| Route files | 942 |
| Files that call either fallback helper | 308 |
| Of those, files that do not also call `requireStrictSession`, `requireTenantBusinessId`, or `getSessionScopedBusinessId` | 223 |

223 is a candidate pool, not a vulnerability count. A `user_id` or `business_id` field can be a filter, a resource id, or a platform-admin argument. Only the handlers below were executed.

## Ranked candidates that were inspected in code

Priority 1 for this batch: dashboard lists that copy the Phase 3A pattern (`getBusinessIdFromRequest` / `getUserIdFromRequest`, then `authorize(userId, 'dashboard', 'read')` with no `businessId`, then SQL on that business id).

| Route | Methods | Pattern | Expected auth | Code |
| --- | --- | --- | --- | --- |
| `/api/dashboard/today-sales` | GET | Query identity, authorize without business id, invoices for that business, no branch filter. Also calls `accountOutstandingStoreOrders`. | Trusted session business only | `app/api/dashboard/today-sales/route.ts` |
| `/api/dashboard/recent-invoices` | GET | Same authorize shape; recent invoices and customer names | Trusted session business only | `app/api/dashboard/recent-invoices/route.ts` |
| `/api/dashboard/top-customers` | GET | Same; customer names and sales totals | Trusted session business only | `app/api/dashboard/top-customers/route.ts` |
| `/api/dashboard/today-purchases` | GET | Same; today's purchases and supplier names | Trusted session business only | `app/api/dashboard/today-purchases/route.ts` |
| `/api/dashboard/sales-summary` | GET | Same; today's and month sales totals. Also calls `accountOutstandingStoreOrders`. | Trusted session business only | `app/api/dashboard/sales-summary/route.ts` |
| `/api/dashboard/charts` | GET | Same; daily sales and purchase totals for a date range | Trusted session business only | `app/api/dashboard/charts/route.ts` |
| `/api/dashboard/low-stock` | GET | Same; item names at or below minimum stock | Trusted session business only | `app/api/dashboard/low-stock/route.ts` |
| `/api/dashboard/top-products` | GET | Same shape; needs invoice lines | Trusted session business only | `app/api/dashboard/top-products/route.ts` |
| `/api/dashboard/receivables` | GET | Same identity fallback, then the caller's branch list | Trusted session business only | `app/api/dashboard/receivables/route.ts` |
| `/api/credit-notes` | GET | Query identity; `authorize` without business id; branch filter unless the user is primary admin of that business | Trusted session business only | `app/api/credit-notes/route.ts` |
| `/api/expenses` | GET, POST | GET matches credit notes. POST reads the user from `getAuthenticatedUserId` (session header only). | Trusted session | `app/api/expenses/route.ts` |
| `/api/debit-notes` | GET | Same as credit notes | Trusted session business only | `app/api/debit-notes/route.ts` |
| `/api/estimates` | GET | `authorize(userId, 'invoices', 'read')` without business id, then branch access | Trusted session business only | `app/api/estimates/route.ts` |
| `/api/sales-orders` | GET | `authorize` without business id, then branch access | Trusted session business only | `app/api/sales-orders/route.ts` |
| `/api/customers` | GET | Already in Phase 3A. Re-checked here. | Trusted session business only | `app/api/customers/route.ts` |
| `/api/journal-entries` | GET | Query business id is passed into `authorize` | Deny when the user is not a member of that business | `app/api/journal-entries/route.ts` |
| `/api/reports/profit-loss` | GET | Query business id is passed into `authorize` | Deny when the user is not a member | `app/api/reports/profit-loss/route.ts` |
| `/api/reports/sales-summary` | GET | Report access, then authorize with the business id | Deny when the user is not a member | `app/api/reports/sales-summary/route.ts` |
| `/api/suppliers` | GET | Already in Phase 3A. Re-checked here. | Deny when the user is not a member | `app/api/suppliers/route.ts` |

## Command

`npx jest tests/db/phase3c-identity-fallback.db.test.ts --runInBand --forceExit`

Result: 1 suite, 3 passed, 2 failed. The two failures are the cross-tenant reads below. `authorize` was not stubbed.

Fixture: two businesses, each with a billing subscription that includes `reports_basic`, a primary admin, a customer, and a final invoice dated today. Business B also has a supplier, a purchase, a credit note, an expense, a debit note, and a low-stock item. Business B's invoice total is 77.13. Markers are unique per run.

## Confirmed defects

These seven GET handlers returned HTTP 200 containing Business B's marker or the 77.13 total.

Both of these requests did it:

1. No session headers. Query `user_id` is Business A's primary admin, query `business_id` is Business B, plus `x-user-id` for A.
2. Headers `x-authenticated-user-id` for A, `x-authenticated-business-id` for B, and `x-authenticated-session-version` 1. The handler treats that pair as the business to query because `authorize` is called without a business id, so the primary-admin short-circuit does not compare businesses.

| Route | Query identity, no session | User A headers with business B |
| --- | --- | --- |
| `GET /api/dashboard/today-sales` | FAIL HTTP 200 | FAIL HTTP 200 |
| `GET /api/dashboard/recent-invoices` | FAIL HTTP 200 | FAIL HTTP 200 |
| `GET /api/dashboard/top-customers` | FAIL HTTP 200 | FAIL HTTP 200 |
| `GET /api/dashboard/today-purchases` | FAIL HTTP 200 | FAIL HTTP 200 |
| `GET /api/dashboard/sales-summary` | FAIL HTTP 200 | FAIL HTTP 200 |
| `GET /api/dashboard/charts` | FAIL HTTP 200 | FAIL HTTP 200 |
| `GET /api/dashboard/low-stock` | FAIL HTTP 200 | FAIL HTTP 200 |

What leaked: customer names, invoice rows, supplier names, purchase rows, sales totals, chart totals, and item names. Charts logged Business B's id and `total: '77.13'` during the run.

Middleware still returns 401 for these paths when there is no cookie, including when the request sends `x-authenticated-user-id` and `x-authenticated-business-id`. That check is `middleware()` in Jest, not a live server. Same limit as Phase 3A: a browser request does not reach the handler. The defect is the handler if a request arrives without middleware.

Invoice count for Business B was unchanged after these reads. The store-order side effect on today-sales and sales-summary did not create an invoice, because this fixture has no store orders.

## Not vulnerable on the tested path

| Route | Query identity, no session | What was observed |
| --- | --- | --- |
| `GET /api/dashboard/receivables` | HTTP 200, marker absent | Branch list for user A does not include Business B's branch, so the list is empty. |
| `GET /api/credit-notes` | HTTP 200, marker absent | User A is not primary admin of Business B, so the branch filter hides B's credit note. |
| `GET /api/expenses` | HTTP 200, marker absent | Same branch filter. |
| `GET /api/debit-notes` | HTTP 200, marker absent | Same branch filter. |
| `GET /api/estimates` | HTTP 200, marker absent | Branch access returned no Business B rows. |
| `GET /api/sales-orders` | HTTP 200, marker absent | Branch access returned no Business B rows. |
| `GET /api/customers` | HTTP 200, marker absent | Same outcome as Phase 3A. |
| `GET /api/journal-entries` | HTTP 403, marker absent | `authorize` received the business id. |
| `GET /api/reports/profit-loss` | HTTP 403, marker absent | `authorize` received the business id. |
| `GET /api/reports/sales-summary` | HTTP 403, marker absent | `authorize` received the business id. |
| `GET /api/suppliers` | HTTP 403, marker absent | Same outcome as Phase 3A. |
| `POST /api/expenses` | not HTTP 201 | Body `business_id`, `user_id`, and `created_by` did not insert a row. Expense count for Business B was unchanged. POST reads the actor from the session header only. |
| `GET /api/dashboard/today-sales` with a real session for A | HTTP 200 | Response contained A's customer and did not contain B's marker or 77.13. |

The header-pair request (user A, business B) was also sent to the routes in the table above. Their responses did not contain B's marker or 77.13. Status codes for that second request were not recorded one by one, except that the seven failing dashboard routes were HTTP 200.

## Suspicious, not confirmed

These still accept a query identity and call `authorize` without a business id. On this fixture the branch filter, or an empty product list, stopped the marker from appearing. That is not a proof they are safe for every user. Phase 3E retested them with the target business's own user id and confirmed the leaks. See `docs/qa/phase-3e-identity-audit-results.md`.

- `GET /api/dashboard/receivables`, `GET /api/credit-notes`, `GET /api/expenses`, `GET /api/debit-notes`, `GET /api/estimates`, `GET /api/sales-orders`, `GET /api/customers`. HTTP 200 with an empty result is a successful authorization of the wrong business, hidden by branch membership.
- `GET /api/dashboard/top-products` uses the same authorize shape and queries items for the supplied business id. No invoice line was seeded, so the response had no marker. Not confirmed.

`GET /api/dashboard/cash-flow` has the same authorize shape and was not called.

## Not tested

- The other files in the 223-file pool, including HR, settings, reports, employees, and admin diagnostics.
- Dashboard routes that do apply a branch filter and were not called: overview, payables, collection, sales-trend, recent-transactions, dead-stock, dead-stock suggestions.
- POST/PUT/PATCH/DELETE on credit notes, debit notes, estimates, sales orders, journals, and customers.
- A live application server. Middleware and handlers were not proven on one HTTP request.

## What to fix first

The seven confirmed dashboard GET handlers were fixed in Phase 3D with `requireStrictSession` and `authorize` on the session business. The original FAIL above stays as history.

Leave the HTTP 200 empty-list routes until those seven are fixed. They did not return Business B's rows in this run.
