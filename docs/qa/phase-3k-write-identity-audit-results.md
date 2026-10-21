# Phase 3K — remaining write-isolation audit

Baseline only. Application code was not changed. `authorize` was not stubbed.

The six handlers are `POST` in these files:

- `app/api/stock-transfers/route.ts`
- `app/api/purchase-returns/route.ts`
- `app/api/purchases/route.ts`
- `app/api/payments/route.ts`
- `app/api/journal-entries/route.ts`
- `app/api/recurring-invoices/route.ts`

Database: the suite stops unless `current_database()` is `kh_phase2_test` on port 5433 and the server address is loopback. The suite ran, so that guard passed.

Handlers were called from Jest. `middleware()` was called directly. A live Next.js server was not started. `next/headers` was backed by the same header bag as the request. `jwt`, `platform-jwt`, and credit alerts were stubbed. Those stubs do not decide tenant membership.

## Command

`npx jest tests/db/phase3k-write-identity.db.test.ts --runInBand --forceExit`

Result: 1 suite, 7 passed, 2 failed. The failures are the writes below. The assertions were not weakened.

## Confirmed writes

No session, with business B and user B only in the body:

| Route | Result |
| --- | --- |
| `POST /api/stock-transfers` | FAIL HTTP 201. Transfer row and transfer item on B. An earlier snapshot of the same request had stock movements 0 and ledger lines 0. |
| `POST /api/purchase-returns` | FAIL HTTP 201. Return row on B. The handler posts the supplier balance change and the ledger entries before that response. |
| `POST /api/purchases` | HTTP 401 `UNAUTHENTICATED`. No purchase row. |
| `POST /api/payments` | HTTP 401 `UNAUTHENTICATED`. No payment row. |
| `POST /api/journal-entries` | HTTP 401. No journal row. |
| `POST /api/recurring-invoices` | HTTP 401. No definition row. |

User B's user header, no business header, body business B:

| Route | Result |
| --- | --- |
| `POST /api/stock-transfers` | FAIL HTTP 201. Transfer row on B. |
| `POST /api/purchase-returns` | FAIL HTTP 201. Return row on B. |
| Purchases, payments, journal entries, recurring invoices | HTTP 401. No row on B. |

A real session for A, using B's warehouses and B's item on a stock transfer, returned HTTP 201. The transfer is stored on A and points at B's warehouses and item.

A real session for A, with B's supplier and A's item on a purchase return, returned HTTP 201. The return is stored on A with B's supplier id. The supplier balance update uses that id.

A real session for A, with A's customer and B's item id inside the recurring-invoice `items` JSON, returned HTTP 201. The definition is stored on A. The customer check passed. The item id was not checked.

## Rejected without a committed row

User A's user and business headers pointed at business B:

| Route | Result |
| --- | --- |
| `POST /api/stock-transfers` | HTTP 403 `CROSS_TENANT_DENIED`. No transfer row. |
| `POST /api/purchase-returns` | HTTP 400 `INVALID_CREATED_BY`. No return row. |
| `POST /api/purchases` | HTTP 403 `BRANCH_ACCESS_DENIED`. No purchase row. `authorize` is called without a business id. The request stopped at the branch check. |
| `POST /api/payments` | HTTP 403 `BRANCH_ACCESS_DENIED`. No payment row. Same branch check. |
| `POST /api/journal-entries` | HTTP 403 `CROSS_TENANT_DENIED`. No journal row. |
| `POST /api/recurring-invoices` | HTTP 403 `CROSS_TENANT_DENIED`. No definition row. |

User A's header only, body business B: stock transfers HTTP 403 `CROSS_TENANT_DENIED`. Purchase returns HTTP 400 `INVALID_CREATED_BY`. The other four returned HTTP 401. None added a row on B.

A session version of 999 returned HTTP 401 for all six. A and B counts stayed the same.

A real session for A, with the body naming B, did not add rows to B. Purchases, payments, and purchase returns still created A's own records. Stock transfers, journal entries, and recurring invoices returned HTTP 403.

A real session for A:

| Reference | Result |
| --- | --- |
| B's supplier on a purchase | HTTP 400 `SUPPLIER_INVALID`. No purchase row. |
| B's customer on a payment | HTTP 404 `PAYMENT_PARTY_NOT_FOUND`. No payment row. |
| B's supplier on a payment | HTTP 404 `PAYMENT_PARTY_NOT_FOUND`. No payment row. |
| B's accounts on a journal | HTTP 403 `ACCOUNT_NOT_IN_BUSINESS`. No journal or ledger row. |
| B's customer on a recurring invoice | HTTP 404. No definition row. |
| B's item on a purchase return | HTTP 500. The database rejected the stock row and the transaction rolled back. No return, stock movement, balance change, or ledger row remained. This is not an authorization rejection. |

An unbalanced journal for A returned HTTP 400. Ledger counts did not change. A balanced journal for A returned HTTP 201 and its debit total equalled its credit total.

A user on A who is not a primary admin and has no role received HTTP 403 for all six. Counts did not change.

A cancelled billing subscription received HTTP 403 for `POST /api/recurring-invoices`. The definition count did not change.

A real session for A created its own transfer, purchase return, purchase, payment, journal entry, and recurring invoice. Each returned HTTP 201. B's counts stayed the same.

Middleware returned HTTP 401 for these six paths with no cookie. That is `middleware()` in Jest, not a live server.

## Endpoint status

| Route | Status |
| --- | --- |
| `POST /api/stock-transfers` | FAIL. No session, or user B's header without a business header, created a transfer on B. A session for A stored B's warehouses and item. |
| `POST /api/purchase-returns` | FAIL. The same header cases created a return on B, including the supplier balance and ledger posting. A session for A stored B's supplier. B's item was stopped by a database constraint after the handler had started the write. |
| `POST /api/purchases` | PASS for the requests in this file. A mismatched session was HTTP 403 `BRANCH_ACCESS_DENIED` and did not insert a bill. B's supplier was HTTP 400. |
| `POST /api/payments` | PASS for the requests in this file. A mismatched session was HTTP 403 `BRANCH_ACCESS_DENIED`. B's customer and supplier were HTTP 404. |
| `POST /api/journal-entries` | PASS for the requests in this file. Missing session, mismatch, stale version, another business's accounts, and an unbalanced entry did not post. |
| `POST /api/recurring-invoices` | FAIL for item ownership. A session for A saved a definition whose `items` JSON names B's item. Customer, session, and subscription checks held for the other requests. |

## What to fix first

`POST /api/stock-transfers` and `POST /api/purchase-returns`. They write when the body supplies B's user and business and the business header is missing.

Stock transfers should also reject warehouses and items that are not in the session business. Purchase returns should reject a supplier that is not in the session business before inserting. Recurring invoices should reject item ids that are not in the session business.

Do not start that fix in this phase.
