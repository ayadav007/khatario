# Phase 3I — remaining write-isolation audit

Baseline only. Application code was not changed. `authorize` was not stubbed.

Database: the suite stops unless `current_database()` is `kh_phase2_test` on port 5433 and the server address is loopback. The suite ran, so that guard passed.

Handlers were called from Jest. `middleware()` was called directly. A live Next.js server was not started. `next/headers` was backed by the same header bag as the request so the session-version check inside `authorize` saw those headers. `jwt`, `platform-jwt`, and credit alerts were stubbed. Those stubs do not decide tenant membership.

## Shortlist

These mutating handlers still take a business id from `getBusinessIdFromRequest` or from the body, and they do not call `requireStrictSession`.

Tested in this batch:

| Route | Why it was first |
| --- | --- |
| `POST /api/suppliers` | Body `created_by` is the actor. Body `business_id` is used when the business header is absent. |
| `POST /api/items` | Body `business_id` is the insert business. `authorize` is called without a business id. |
| `POST /api/purchase-orders` | The insert uses body `business_id`. There is no membership check. |
| `POST /api/inventory-adjustments` | Same identity pattern as items, and it changes stock. |
| `PUT /api/customers/[id]` | Body `user_id` can be the actor. The customer is loaded with the body or header business id. |

Inspected and left for a later batch. Not called:

| Route | Why it is still a candidate |
| --- | --- |
| `POST /api/stock-transfers` | Body `created_by` is the actor. Body `business_id` is the insert business. |
| `POST /api/purchase-returns` | Body user id is accepted, then checked against that same body business. |
| `POST /api/purchases` | Business comes from the session header. `authorize` has no business id, so a mismatched business header may still pass for a primary admin. |
| `POST /api/payments` | Session header business. Foreign customer or supplier references were not called. |
| `POST /api/journal-entries` | Uses `requireTenantBusinessId` (session business only). Not called. |
| `POST /api/recurring-invoices` | Same tenant helper. Not called. |

## Command

`npx jest tests/db/phase3i-write-identity.db.test.ts --runInBand --forceExit`

Result: 1 suite, 4 passed, 2 failed. The failures are the writes below. The assertions were not weakened.

## Confirmed writes

No session, body user and business of B:

| Route | Result |
| --- | --- |
| `POST /api/suppliers` | FAIL HTTP 201. Supplier row on B. |
| `PUT /api/customers/[id]` | FAIL HTTP 200. B's customer name changed. |
| `POST /api/items` | HTTP 400. No item row. The actor is the user header, which was absent. |
| `POST /api/inventory-adjustments` | HTTP 400. No adjustment row. |
| `POST /api/purchase-orders` | No order row. The handler threw `Release called on client which has already been released to the pool` after its early return, so Jest did not receive an HTTP status. |

User A's user and business headers pointed at business B:

| Route | Result |
| --- | --- |
| `POST /api/items` | FAIL HTTP 201. Item row on B. |
| `POST /api/purchase-orders` | FAIL HTTP 201. Order row on B. |
| `POST /api/inventory-adjustments` | FAIL HTTP 201. Adjustment row on B, and a stock movement was committed. Ledger line count stayed 0. |
| `POST /api/suppliers` | HTTP 403. No supplier row. |
| `PUT /api/customers/[id]` | HTTP 403. The name did not change on this call. It had already been changed by the no-session request above. |

User header only, no business header, body `business_id` of B:

| Route | User A header | User B header |
| --- | --- | --- |
| `POST /api/items` | FAIL HTTP 201 on B | FAIL HTTP 201 on B |
| `POST /api/purchase-orders` | FAIL HTTP 201 on B | FAIL HTTP 201 on B |
| `POST /api/inventory-adjustments` | FAIL HTTP 201 on B | FAIL HTTP 201 on B |
| `POST /api/suppliers` | HTTP 403, no row | FAIL HTTP 201 on B |
| `PUT /api/customers/[id]` | HTTP 403 | FAIL HTTP 200 |

A real session for A, with both headers, and a body naming B, did not add rows to B and did not change B's customer. The trusted business header won.

A session version of 999 did not return HTTP 201 for the four POSTs, and A and B counts stayed the same. `PUT /api/customers/[id]` was not in that stale-session loop.

A real session for A created a supplier and an item on A while the body named B. Both returned HTTP 201.

A real session for A, with B's supplier on a purchase order for A, returned HTTP 201. The order was accepted with the other business's supplier.

## Endpoint status

| Route | Status |
| --- | --- |
| `POST /api/suppliers` | FAIL. No session, or user B's header without a business header, created a supplier on B. |
| `POST /api/items` | FAIL. User A paired with business B, and a user header without a business header, created an item on B. |
| `POST /api/purchase-orders` | FAIL. The same header cases created an order on B. A session for A stored B's supplier on an order. |
| `POST /api/inventory-adjustments` | FAIL. The same header cases adjusted stock on B. |
| `PUT /api/customers/[id]` | FAIL. No session, and user B's header without a business header, renamed B's customer. |

Middleware returned HTTP 401 for these five paths with no cookie. That is `middleware()` in Jest, not a live server.

## What to fix first

`POST /api/items`, `POST /api/purchase-orders`, and `POST /api/inventory-adjustments`. A user from business A, with the business header set to B, writes B's item, order, and stock.

Then `POST /api/suppliers` and `PUT /api/customers/[id]`. They write when the body supplies B's user and business and the business header is missing.

Purchase orders should also reject a supplier that is not in the session business.

Do not start that fix in this phase.
