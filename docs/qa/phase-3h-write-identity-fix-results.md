# Phase 3H — POST tenant-isolation fix

The Phase 3G audit file is unchanged. This file records the fix for four POST handlers.

`POST /api/credit-notes` and `POST /api/debit-notes` were not changed.

## What changed

Each of the four handlers now calls `requireStrictSession`. The business and the acting user come from that session. Body and query `business_id`, `user_id`, and `created_by` are not used as identity.

| Route | Authorization | Referenced records |
| --- | --- | --- |
| `POST /api/estimates` | `authorize` on `invoices` create for the session business, then the existing estimate feature check | Customer and any `item_id` must belong to that business and not be deleted |
| `POST /api/sales-orders` | `authorize` on `sales_orders` create for the session business and branch, then the existing feature check | Same customer and item rule, before insert |
| `POST /api/customers` | `authorize` on `customers` create for the session business, then the existing access and feature checks | No foreign record |
| `POST /api/expenses` | `authorize` on `expenses` create for the session business and branch, then the existing feature check | Supplier and category were already limited to the business id. That id is now the session business |

A missing session returns 401. A user paired with another business returns 403. A stale session version returns 401. None of those requests insert a row.

## Database

`tests/db/phase3g-write-identity.db.test.ts` stops unless `current_database()` is `kh_phase2_test`, the port is 5433, and the server address is loopback. The suite passed, so that guard passed.

Both businesses were given Cash (`1101`) and Administrative Expenses (`5201`) so an expense rejection is not confused with a missing ledger account. A valid cash expense for business A posted ledger lines.

## Commands

`npx jest tests/db/phase3g-write-identity.db.test.ts --runInBand --forceExit`

Result: 1 suite, 9 passed. `authorize` and `requireStrictSession` were not stubbed. Handlers were called from Jest. `middleware()` was called directly. A live Next.js server was not started.

Covered for the six POST handlers still in that file:

- No cookie: middleware 401.
- No session, a user header without a business header, and user A paired with business B: no row on business B. The request URL also sent B's `business_id` and `user_id`.
- A real session for A with a body and query naming B did not write B.
- Session version 999 did not write.
- A real session for A created a customer, an estimate, a sales order, and a cash expense on A. The estimate's `created_by` is user A.
- B's customer, item, invoice, and on-account supplier were not stored on A. The supplier balance did not change.
- A user on A who is not a primary admin and has no role received 403 for all four routes. Counts did not change.
- A cancelled billing subscription received 403 for `POST /api/estimates`. The estimate count did not change.

`npx jest tests/db/phase3e-identity-fallback.db.test.ts tests/db/phase3c-identity-fallback.db.test.ts tests/db/phase3a-auth-isolation.db.test.ts tests/db/soft-delete-items-and-report.db.test.ts tests/security/middleware-identity-headers.test.ts --runInBand --forceExit`

Result: 5 suites, 32 passed.

`npx jest tests/security/customers-create-route.test.ts --runInBand --forceExit`

Result: 1 suite, 4 passed. This file stubs `authorize`, `enforceAccess`, and the database. It is not the tenant-isolation proof. The database suite above is.

## Still not tested

Credit-note and debit-note POST fields other than the identity requests in the Phase 3G file. Estimate tax, numbering, and status changes. Sales-order confirmation and stock reservation. Expense GST, categories, and on-account posting for the same business. Pages were not opened. Live HTTP was not run.
