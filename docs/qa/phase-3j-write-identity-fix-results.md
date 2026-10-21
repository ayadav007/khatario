# Phase 3J — write-isolation fix

The Phase 3I audit file is unchanged. This file records the fix for five handlers.

## What changed

Each handler calls `requireStrictSession`. The business and the acting user come from that session. Body and query `business_id`, `user_id`, and `created_by` are not used as identity.

| Route | Authorization | Related records |
| --- | --- | --- |
| `POST /api/items` | `authorize` on `items` create for the session business | Insert uses the session business |
| `POST /api/purchase-orders` | `authorize` on `purchases` create for the session business, then the existing feature check | Supplier, and any `item_id`, must belong to that business and not be deleted. Checked before insert |
| `POST /api/inventory-adjustments` | `authorize` on `items` create for the session business, then the existing feature check | Item must belong to that business and not be deleted. Checked before stock is changed |
| `POST /api/suppliers` | `authorize` on `suppliers` create for the session business, then the existing feature check | Insert uses the session business |
| `PUT /api/customers/[id]` | `authorize` on `customers` update for the session business | The customer is loaded with the session business |

A missing session returns 401. A user header without a business header returns 401. A user paired with another business returns 403. A stale session version returns 401. None of those requests insert or update a row.

GET on these routes was not changed.

## Database

`tests/db/phase3i-write-identity.db.test.ts` stops unless `current_database()` is `kh_phase2_test`, the port is 5433, and the server address is loopback. The suite passed, so that guard passed.

## Commands

`npx jest tests/db/phase3i-write-identity.db.test.ts --runInBand --forceExit`

Result: 1 suite, 10 passed. `authorize` and `requireStrictSession` were not stubbed. Handlers were called from Jest. `middleware()` was called directly. A live Next.js server was not started.

Covered:

- No cookie: middleware 401.
- No session, user A paired with business B, and a user header without a business header: HTTP 401 or 403. No supplier, item, purchase order, adjustment, stock movement, or ledger row was added on B. B's customer name did not change.
- Session version 999: HTTP 401. Counts unchanged.
- A real session for A, with the body naming B, did not write B. B's supplier was not stored on an order. B's item was not adjusted.
- A real session for A created a supplier, an item, a purchase order, and a stock adjustment on A, and renamed A's customer. B's customer name stayed the same.
- A user on A who is not a primary admin and has no role received HTTP 403. Counts did not change.
- A cancelled billing subscription received HTTP 403 for `POST /api/suppliers`. The supplier count did not change.

`npx jest tests/db/phase3g-write-identity.db.test.ts tests/db/phase3e-identity-fallback.db.test.ts tests/db/phase3c-identity-fallback.db.test.ts tests/db/phase3a-auth-isolation.db.test.ts tests/security/items-create-route.test.ts tests/security/inventory-adjustments-route.test.ts --runInBand --forceExit`

Result: 6 suites, 41 passed.

`tests/security/items-create-route.test.ts` and `tests/security/inventory-adjustments-route.test.ts` stub `authorize` and the database. They are not the tenant-isolation proof. The Phase 3I database suite is.

`npx jest tests/db/supplier-hub.db.test.ts --runInBand --forceExit`

Result: 1 suite skipped, 14 skipped. That file runs only when `SUPPLIER_HUB_DB_TEST=1` or `PHASE2_TEST_DATABASE_URL` is set. It was not run.

## Still not tested

Purchase-order quantity requests, numbering, and confirmation. Inventory value adjustments and GST. Item variants, barcodes, and opening stock. Supplier GSTIN and hub links. Customer fields other than the name. The GET handlers. Pages were not opened. Live HTTP was not run.
