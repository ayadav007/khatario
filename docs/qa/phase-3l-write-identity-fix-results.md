# Phase 3L — write-isolation fix

The Phase 3K audit file is unchanged. This file records the fix for three handlers.

## What changed

Each POST calls `requireStrictSession`. The business and the acting user come from that session. Body and query `business_id`, `user_id`, and `created_by` are not used as identity.

| Route | Extra check before the write |
| --- | --- |
| `POST /api/stock-transfers` | Both warehouses belong to the session business. Every item belongs to that business and is not deleted. |
| `POST /api/purchase-returns` | The supplier, the original bill, and every item id belong to the session business. A missing item is HTTP 400 before the return is inserted. |
| `POST /api/recurring-invoices` | The customer check remains. Every `item_id` in the `items` JSON belongs to the session business and is not deleted. One foreign id rejects the whole definition. |

A missing session returns 401. A user paired with another business returns 403. A stale session version returns 401. None of those requests insert a row or change stock, a supplier balance, or a ledger line.

GET on these routes was not changed.

## Database

`tests/db/phase3k-write-identity.db.test.ts` stops unless `current_database()` is `kh_phase2_test`, the port is 5433, and the server address is loopback. The suite passed, so that guard passed.

## Commands

`npx jest tests/db/phase3k-write-identity.db.test.ts --runInBand --forceExit`

Result: 1 suite, 9 passed. `authorize` and `requireStrictSession` were not stubbed. Handlers were called from Jest. `middleware()` was called directly. A live Next.js server was not started.

Covered for stock transfers, purchase returns, and recurring invoices, together with the three routes from Phase 3K that already held:

- No cookie: middleware 401.
- No session, user A paired with business B, and a user header without a business header: HTTP 401 or 403. No transfer, return, purchase, payment, journal, or recurring row was added on B. Supplier balances and ledger counts on B did not change.
- Session version 999: HTTP 401. Counts unchanged.
- A real session for A, with the body naming B, did not write B.
- A real session for A was rejected for B's source warehouse, destination warehouse, and item on a transfer; for B's supplier, bill, and item on a return; and for B's item id inside a recurring definition whose customer belongs to A. Each rejection was HTTP 400 or 404, not HTTP 500.
- A real session for A created a transfer, a return, a purchase, a payment, a journal entry, and a recurring invoice on A. B's counts stayed the same.
- A user on A who is not a primary admin and has no role received HTTP 403. Counts did not change.
- A cancelled billing subscription received HTTP 403 for `POST /api/recurring-invoices`.

`npx jest tests/db/phase3i-write-identity.db.test.ts tests/db/phase3g-write-identity.db.test.ts tests/db/phase3e-identity-fallback.db.test.ts tests/db/phase3c-identity-fallback.db.test.ts tests/db/phase3a-auth-isolation.db.test.ts tests/lib/purchases/purchase-return-lines.test.ts tests/lib/invoices/recurring.test.ts tests/db/purchase-reports-zoho-scenario.db.test.ts --runInBand --forceExit`

Result: 7 suites passed, 58 tests passed. 1 suite skipped, 8 tests skipped.

`tests/db/purchase-reports-zoho-scenario.db.test.ts` did not run. It runs only when `PHASE2_TEST_DATABASE_URL` is set, and it stubs `authorize`. It is not the isolation proof.

`tests/lib/purchases/purchase-return-lines.test.ts` and `tests/lib/invoices/recurring.test.ts` do not call these POST handlers.

## Still not tested

Transfer dispatch and receipt. Purchase-return cancellation. Recurring-invoice generation. Lines in a recurring definition that have no `item_id`. The GET handlers. Pages were not opened. Live HTTP was not run.
