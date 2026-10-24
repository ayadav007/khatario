# Phase 3G — POST tenant-isolation audit

Baseline only. Application code was not changed. `authorize` was not stubbed.

Database: the suite stops unless `current_database()` is `kh_phase2_test` on port 5433 and the server address is loopback.

Handlers were called from Jest. `middleware()` was called directly. A live Next.js server was not started.

## Command

`npx jest tests/db/phase3g-write-identity.db.test.ts --runInBand --forceExit`

Result: 1 suite, 4 passed, 2 failed. The failures are the writes below. The assertions were not weakened.

## How each POST chooses the business

| Route | Business id | Actor | Authorize |
| --- | --- | --- | --- |
| `POST /api/credit-notes` | Session header only | Session header only | `authorize` with that business id |
| `POST /api/debit-notes` | Session header only | Session header only | `authorize` with that business id |
| `POST /api/expenses` | Session header, otherwise body `business_id` | Session header only | `authorize` without a business id |
| `POST /api/customers` | Session header, otherwise body `business_id` | Session header only | `authorize` without a business id |
| `POST /api/estimates` | Session header, otherwise body `business_id` | Body `created_by` first | No `authorize`. `enforceAccess` checks the feature, not membership |
| `POST /api/sales-orders` | Session header, otherwise body `business_id` | Body `created_by` | `authorize` without a business id |

When both session headers are present, `getBusinessIdFromRequest` uses the header and ignores the body. That path did not write business B for any of the six.

## Confirmed writes

No session, body `business_id` of B and body `created_by` of A or B:

| Route | User A in the body | User B in the body |
| --- | --- | --- |
| `POST /api/estimates` | FAIL HTTP 201, estimate row on B | FAIL HTTP 201, estimate row on B |
| `POST /api/sales-orders` | HTTP 403, no row | FAIL HTTP 201, order row on B |
| `POST /api/customers` | HTTP 400, no row | HTTP 400, no row |
| `POST /api/expenses` | HTTP 400, no row | HTTP 400, no row |
| `POST /api/credit-notes` | HTTP 401, no row | HTTP 401, no row |
| `POST /api/debit-notes` | HTTP 401, no row | HTTP 401, no row |

User A's session headers pointed at business B:

| Route | Result |
| --- | --- |
| `POST /api/customers` | FAIL HTTP 201, customer row on B |
| `POST /api/estimates` | FAIL HTTP 201, estimate row on B |
| `POST /api/credit-notes` | HTTP 403, no row |
| `POST /api/debit-notes` | HTTP 403, no row |
| `POST /api/expenses` | HTTP 403, no row |
| `POST /api/sales-orders` | HTTP 403, no row |

User header only, no business header, body `business_id` of B:

| Route | User A header | User B header |
| --- | --- | --- |
| `POST /api/estimates` | FAIL HTTP 201 on B | FAIL HTTP 201 on B |
| `POST /api/customers` | FAIL HTTP 201 on B | FAIL HTTP 201 on B |
| `POST /api/sales-orders` | HTTP 403, no row | FAIL HTTP 201 on B |
| `POST /api/expenses` | HTTP 403, no row | HTTP 500, no row left |
| `POST /api/credit-notes` | HTTP 401 | HTTP 401 |
| `POST /api/debit-notes` | HTTP 401 | HTTP 401 |

The expense HTTP 500 is `Administrative Expenses (5201) account not found`. The handler had already accepted user B's header plus body `business_id` B and started the voucher. The transaction rolled back, so the expense count stayed unchanged. Persistence of that expense is BLOCKED by the missing chart of accounts. The identity check itself was not a denial.

A real session for A, with the body naming B, did not add rows to B. The trusted business header won.

A session version of 999 did not return HTTP 201 and did not add rows for any of the six.

A real session for A created a customer named for A even though the body named B. HTTP 201. That customer belonged to A.

## Foreign references

A real session for A, with B's customer and B's invoice in the body:

| Route | Result |
| --- | --- |
| `POST /api/credit-notes` | Not HTTP 201. No credit note for that customer. |
| `POST /api/debit-notes` | Not HTTP 201. No debit note for that customer. |
| `POST /api/estimates` | FAIL HTTP 201. The estimate was created with B's customer. |
| `POST /api/sales-orders` | FAIL HTTP 201. The order was created with B's customer and item. |

## Endpoint status

| Route | Status |
| --- | --- |
| `POST /api/credit-notes` | PASS for the requests above. No cross-business row. |
| `POST /api/debit-notes` | PASS for the requests above. No cross-business row. |
| `POST /api/expenses` | FAIL. Body `business_id` is used when the business header is absent. With user B's header only, posting started and then rolled back. No expense row remained. |
| `POST /api/customers` | FAIL. User A with business B's header, and a user header without a business header, created a customer on B. |
| `POST /api/estimates` | FAIL. No session, and a mismatched session, created estimates on B. A session for A also stored B's customer on an estimate. |
| `POST /api/sales-orders` | FAIL. No session with B's user id in the body created an order on B. A session for A stored B's customer on an order. |

Middleware returned HTTP 401 for these six POSTs with no cookie. That is `middleware()` in Jest, not a live server.

## What to fix first

`POST /api/estimates`, `POST /api/sales-orders`, and `POST /api/customers`. They create another business's rows from caller-supplied identity. Estimates and sales orders also store another business's customer. Use the same strict session as the GET handlers, and reject customers, items, and invoices that are not in that business.

`POST /api/expenses` should stop reading `business_id` from the body. This fixture could not finish the voucher because the chart of accounts was missing.

Do not start that fix in this phase.
