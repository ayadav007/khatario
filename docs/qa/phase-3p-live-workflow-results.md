# Phase 3P — live transaction workflows

Verification only. Application code was not changed. The Phase 3K through 3O files stay as they were.

## Command

`node tests/live/phase3p-http.mjs`

Before fixture writes: `database kh_phase2_test loopback port 5433`.

The server was `next dev` on `127.0.0.1:3111` with `DATABASE_URL` set to that database before Next loaded env files. Sessions came from `POST /api/auth/login`. The client was Node `fetch`. Cookies, passwords, and the database URL were not printed. Fixture businesses were deleted at the end and the server was stopped.

Authoritative run: `SUMMARY pass=44 fail=0 blocked=0 not_tested=1`, exit 0.

Two earlier runs of the same script are not the result. The first stopped during seeding because one SQL parameter was used for both a varchar and a text column. The second reached HTTP and failed generation because the recurring line used `name` instead of `item_name`. The invoice create path requires `item_name`. The authoritative run used that field.

## Routes and methods that exist

| Route | Methods exported | What this phase called |
| --- | --- | --- |
| `/api/journal-entries` | GET, POST | GET list. POST only to create a narration the list could show. |
| `/api/purchases` | GET, POST | GET list. |
| `/api/payments` | GET, POST | GET list. The accounting list, not `order_id` or `reconciliation=1`. |
| `/api/purchase-orders` | GET, POST | GET with `status`. POST create. |
| `/api/purchase-returns` | GET, POST | GET with `search`, `page`, and `limit`. POST create. |
| `/api/purchase-returns/[id]/cancel` | POST | POST with a reason. |
| `/api/stock-transfers/[id]/dispatch` | PATCH | PATCH of a pending transfer. |
| `/api/stock-transfers/[id]/receive` | POST | POST after dispatch. |
| `/api/recurring-invoices` | GET, POST | POST create. |
| `/api/recurring-invoices/[id]` | GET, POST, PATCH | POST `{ action: 'run_now' }` only. |

`GET /api/purchase-orders` reads `status` and returns every matching row. It does not read `search`, `page`, or `limit`. Search and pagination on that list are **NOT TESTED** because those parameters are not part of the handler.

## Security

Two businesses, each with its own user. Missing session: HTTP 401 and no fixture marker. Spoofed `x-authenticated-*` headers did not choose the business. A forged `business_id` on the three lists returned HTTP 200 with the caller's own rows and did not include the other business's marker. A revoked cookie (`auth_session_version` moved from 1 to 2) returned HTTP 401 `SESSION_REVOKED` on the lists, the three creates, dispatch of the caller's own pending transfer, cancel of the caller's own return, and `run_now` on the caller's own definition. Those rejected calls left no new purchase order, left the pending transfer pending, and left the return uncancelled.

| Workflow | Other business | Same business |
| --- | --- | --- |
| GET journal entries, purchases, payments | Caller's rows only | HTTP 200, own marker present |
| POST purchase orders | HTTP 400 `SUPPLIER_NOT_FOUND`, no row | HTTP 201, row stored on the caller |
| POST purchase returns | HTTP 400 `SUPPLIER_NOT_FOUND`, no row | HTTP 201, row stored on the caller |
| POST recurring invoices | HTTP 400 `ITEM_NOT_FOUND`, no new definition | HTTP 201, definition stored on the caller |
| PATCH dispatch | HTTP 404 `Transfer not found`, other transfer stayed `pending`, source stock unchanged | HTTP 200 |
| POST receive | HTTP 403 `Business ID does not match your session`, other transfer stayed `pending` | HTTP 200 |
| POST cancel | HTTP 404 `Purchase return not found`, other status and supplier balance unchanged | HTTP 200 |
| POST `run_now` with the other business id | HTTP 403, invoice count unchanged | — |
| POST `run_now` on the caller's definition | — | HTTP 200, one invoice, stored on the caller |

## Database side effects

Purchase return create: supplier balance `40.00` to `30.00`, one `purchase_return` stock movement out. Cancel of that return: status `cancelled`, one `purchase_return_cancel` movement, supplier balance back to `40.00`. The rejected cross-business create and cancel did not change the other supplier.

Dispatch of one unit from a source warehouse holding `5.000`: status `pending` to `in_transit`, source stock `5.000` to `4.000`, one stock movement `out`. Receive of that transfer: status `completed`, destination stock `0` to `1.000`, one stock movement `in`. The other business's pending transfer and source stock did not change.

`run_now` on a definition whose line used the caller's item created one invoice on that business. A definition saved with the other business's item id returned HTTP 400 and added no invoice on either business. The message was the product-no-longer-exists path inside invoice create, and the transaction rolled back.

## Invoice date

The definition's `start_date` and `next_run_date` were `2026-10-19`, the same IST calendar day the handler uses for "today". The cross-business item run returned an error prefixed `2026-10-18`. `lib/invoices/recurring.ts` turns a node-pg `Date` into a day with `toISOString()`. A date at local midnight becomes the previous UTC day. The live script did not read the successful invoice's `invoice_date`, so that row's date is **NOT TESTED**. The run date in the error is a **FAIL** for the calendar day. No application change was made in this phase.

Phase 3Q later changed that conversion. This FAIL stays here. The persisted invoice date is recorded in `phase-3q-recurring-date-fix-results.md`.

## Still not tested

- Purchase-order search and pagination. The GET handler has no such parameters.
- Pages, staff users, and a cancelled subscription.
- Dispatch with insufficient stock, receive before dispatch, and a partial receipt.
- Cancel without a reason, and a line count of the purchase-return ledger reversal.
- `GET` and `PATCH` on `/api/recurring-invoices/[id]`, and `POST /api/cron/recurring-invoices`.
- Payment views selected by `order_id` or `reconciliation=1`.
- The successful recurring invoice's `invoice_date`. Phase 3Q read it back. The Phase 3P run did not.

## Functional follow-up

A later run checked stored totals, stock, supplier balances, and ledger lines. Application code was not changed. The checks above stay as they were, including the invoice-date FAIL.

Command: `node tests/live/phase3p-functional.mjs`

Before fixture writes: `database kh_phase2_test loopback port 5433`. The server was `next dev` on `127.0.0.1:3112` with `DATABASE_URL` set to that database before Next loaded env files. The session came from `POST /api/auth/login`. Fixture businesses were deleted at the end and the server was stopped. Leftover `P3PF` businesses: 0.

Authoritative run: `SUMMARY pass=14 fail=0 not_tested=1`, exit 0. Two earlier runs of this script are not the result. One stopped on a `branch_item_stock` column name. One compared stock at a warehouse the return did not move.

| Workflow | Status | Expected from the handlers | Observed |
| --- | --- | --- | --- |
| GET journal entries, purchases, payments | PASS | HTTP 200 and the caller's own marker | HTTP 200. Each list contained the fixture marker. |
| POST purchase order | PASS | The handler stores the submitted header and line amounts. It does not recompute them. | HTTP 201. Header `100.00` / `18.00` / `118.00`. Line qty `2.00`, unit price `50.00`, line total `118.00`. Status `draft`. |
| Purchase-order status filter | PASS | `status=draft` includes the order. `status=confirmed` does not. | Both HTTP 200. Draft included the order number. Confirmed did not. |
| Purchase-order search and pagination | NOT TESTED | `GET /api/purchase-orders` reads `status` only. | Those parameters were not sent. |
| Rejected purchase return | PASS | A supplier from the other business is HTTP 400 and writes nothing. | HTTP 400 `SUPPLIER_NOT_FOUND`. No return row. Ledger line count on the caller unchanged. The other supplier balance unchanged. |
| POST purchase return | PASS | Qty 2 at unit price 15 and tax 0 stores grand total 30. Supplier balance falls by 30. Stock at the resolved warehouse falls by 2. Zero-tax supplier return posts four ledger lines, debit equal to credit, total 60. | HTTP 201. Grand `30.00`, subtotal `30.00`, tax `0.00`. Supplier `40.00` to `10.00`. Movement `out` quantity 2. The movement location had no stock row, so `location_stock` went from 0 to `-2`. Ledger `60` / `60`, 4 lines. |
| Purchase-return search and page | PASS | Search matches the return number. `page=1` and `limit=1` return one row. | Search HTTP 200 and included the return number. Page HTTP 200, 1 row, total 1. |
| Cancel purchase return | PASS | Status becomes `cancelled`. Supplier balance returns by the grand total. Stock returns by the same quantity. Reversal lines leave no active lines, and debit still equals credit. | HTTP 200. Status `cancelled`. Supplier `40.00`. That location's stock back to 0. Movement `in` quantity 2. Ledger `120` / `120`, active lines 0. |
| Dispatch stock transfer | PASS | A pending transfer of 1 leaves the source warehouse and becomes `in_transit`, with one `stock_transfer` movement out. | HTTP 200. Source `5.000` to `4.000`. Status `in_transit`. Movement quantity 1. |
| Receive stock transfer | PASS | Receipt adds 1 at the destination and completes the transfer, with one `stock_transfer` movement in. | HTTP 200. Destination `8.000` to `9.000`. Status `completed`. Movement quantity 1. |
| Recurring definition and `run_now` | PASS | The generated invoice date is the business calendar day. One unit at 25 with tax 0 stores grand total 25. The next run moves one month. | HTTP 200. Response `run_date` and stored `invoice_date` both `2026-10-19`. Grand total `25.00` on the caller. `last_run` `2026-10-19`. `next_run` `2026-11-19`. |

`movePurchaseReturnStock` inserts the signed quantity even when that warehouse has no stock row. This return used that warehouse, so the stored quantity was `-2` until cancel. The seeded warehouse that already held 8 was the transfer destination, and the return did not change it.

Still not covered by this follow-up: purchase-order search and pagination, pages, staff users, a cancelled subscription, dispatch with insufficient stock, receive before dispatch, a partial receipt, cancel without a reason, `GET` and `PATCH` on `/api/recurring-invoices/[id]`, `POST /api/cron/recurring-invoices`, and payment views selected by `order_id` or `reconciliation=1`.
