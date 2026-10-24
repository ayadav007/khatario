# Phase 3M — live HTTP security verification

This phase called a running local Next.js server. It did not call route handlers from Jest and it did not call `middleware()` directly. Application code was not changed.

## Database and server

Command: `node tests/live/phase3m-http.mjs`

The script reads `.env`, refuses a database host other than loopback, and connects only to `kh_phase2_test`. Before any fixture write it ran `current_database()`, `inet_server_addr()`, and `inet_server_port()`.

Observed: `database kh_phase2_test loopback port 5433`.

The server was `next dev` on `127.0.0.1:3108` with `DATABASE_URL` set to that database before Next loaded env files, `DB_NAME=kh_phase2_test`, and `E2E_DISABLE_RATE_LIMIT=true` so the test logins were not rate-limited. The default dev server on port 3000 was not used. Readiness was `GET /api/auth/login` returning HTTP 200.

Proof the process used the test database: two users inserted only into `kh_phase2_test` logged in with HTTP 200. The cookie value, password, and database URL were not printed. Fixture businesses were named `P3M A` and `P3M B` and were deleted at the end. Port 3108 was closed after the run.

## Sessions

`POST /api/auth/login` with each user's phone and password. The client kept the `khatario_session` cookie from `Set-Cookie`. Spoofed `x-authenticated-user-id`, `x-authenticated-business-id`, and `x-authenticated-session-version` were sent as ordinary request headers. They were not treated as a session.

A stale session was the same cookie after `users.auth_session_version` was set to 2.

The client was Node `fetch`, not a browser.

## Result

Second run: `SUMMARY pass=109 fail=0`. Exit code 0.

An earlier run of the same file exited 1. That run's estimate list and top-products list had no distinguishing fixture rows, the estimate create body omitted `line_total`, and a successful create on business A was scored as a failure. Those checks were corrected in the script and rerun. The table below is the rerun.

Business B's row counts were customers, items, suppliers, estimates, sales orders, expenses, purchase orders, inventory adjustments, stock transfers, purchase returns, recurring invoices, stock movements, ledger lines, and the sum of supplier balances. Rejected writes left those counts unchanged. The forged customer update left business B's customer name unchanged.

| Route | No session | Forged identity with session A | Stale session | Own-business request | Isolation and side effects |
| --- | --- | --- | --- | --- | --- |
| `GET /api/invoices` | PASS 401 | PASS 200, same body as the clean session, no B marker | PASS 401 | PASS 200, B's own session returned B's marker | Verified |
| `GET /api/items` | PASS 401 | PASS | PASS 401 | PASS | Verified |
| `GET /api/purchases` | PASS 401 | PASS | PASS 401 | PASS | Verified |
| `GET /api/payments` | PASS 401 | PASS | PASS 401 | PASS | Verified |
| `GET /api/dashboard/today-sales` | PASS 401 | PASS | PASS 401 | PASS | Verified |
| `GET /api/dashboard/recent-invoices` | PASS 401 | PASS | PASS 401 | PASS | Verified |
| `GET /api/dashboard/top-customers` | PASS 401 | PASS | PASS 401 | PASS | Verified |
| `GET /api/dashboard/today-purchases` | PASS 401 | PASS | PASS 401 | PASS | Verified |
| `GET /api/dashboard/sales-summary` | PASS 401 | PASS. The body had no fixture name. B's JSON differed from A's, and the forged query matched A's clean body | PASS 401 | PASS | Verified |
| `GET /api/dashboard/charts` | PASS 401 | PASS, same shape as sales summary. Query included `start_date` and `end_date` | PASS 401 | PASS | Verified |
| `GET /api/dashboard/low-stock` | PASS 401 | PASS | PASS 401 | PASS | Verified |
| `GET /api/dashboard/top-products` | PASS 401 | PASS | PASS 401 | PASS | Verified |
| `GET /api/dashboard/receivables` | PASS 401 | PASS | PASS 401 | PASS | Verified |
| `GET /api/dashboard/cash-flow` | PASS 401 | PASS, same shape as sales summary. Query included `fiscal_year=2026` | PASS 401 | PASS | Verified |
| `GET /api/credit-notes` | PASS 401 | PASS | PASS 401 | PASS | Verified |
| `GET /api/expenses` | PASS 401 | PASS | PASS 401 | PASS | Verified |
| `GET /api/debit-notes` | PASS 401 | PASS | PASS 401 | PASS | Verified |
| `GET /api/estimates` | PASS 401 | PASS | PASS 401 | PASS | Verified. This GET reads proforma invoices. The fixture included one proforma per business |
| `GET /api/sales-orders` | PASS 401 | PASS | PASS 401 | PASS | Verified |
| `GET /api/customers` | PASS 401 | PASS | PASS 401 | PASS | Verified |
| `POST /api/customers` | PASS 401, B unchanged | PASS HTTP 201. The new customer belonged to A. B's count was unchanged | PASS 401 | PASS 201 on A, B unchanged | Verified |
| `POST /api/items` | PASS 401 | PASS HTTP 201 on A, B unchanged | PASS 401 | PASS 201 on A | Verified |
| `POST /api/suppliers` | PASS 401 | PASS HTTP 201 on A, B unchanged | PASS 401 | PASS 201 on A | Verified |
| `POST /api/estimates` | PASS 401 | PASS HTTP 400 `CUSTOMER_NOT_FOUND`, B unchanged | PASS 401 | PASS 201 on A | Verified |
| `POST /api/sales-orders` | PASS 401 | PASS HTTP 400, branch rejected, B unchanged | PASS 401 | PASS 201 on A | Verified |
| `POST /api/expenses` | PASS 401 | PASS HTTP 400, branch rejected, B unchanged | PASS 401 | PASS 201 on A | Verified |
| `POST /api/purchase-orders` | PASS 401 | PASS HTTP 400 `SUPPLIER_NOT_FOUND`, B unchanged | PASS 401 | PASS 201 on A | Verified |
| `POST /api/inventory-adjustments` | PASS 401 | PASS HTTP 400 `ITEM_NOT_FOUND`, B unchanged | PASS 401 | PASS 201 on A | Verified. B's adjustment, stock, and ledger counts stayed the same |
| `POST /api/stock-transfers` | PASS 401 | PASS HTTP 400 `WAREHOUSE_NOT_FOUND`, B unchanged | PASS 401 | PASS 201 on A | Verified. B's transfer and stock counts stayed the same |
| `POST /api/purchase-returns` | PASS 401 | PASS HTTP 400 `SUPPLIER_NOT_FOUND`, B unchanged | PASS 401 | PASS 201 on A | Verified. B's return, stock, ledger, and supplier-balance totals stayed the same |
| `POST /api/recurring-invoices` | PASS 401 | PASS HTTP 404, customer not found, B unchanged | PASS 401 | PASS 201 on A | Verified |
| `PUT /api/customers/[id]` | PASS 401, B's name unchanged | PASS HTTP 404, B's name unchanged | PASS 401, B's name unchanged | PASS 200, A's customer renamed and still on A | Verified |

No-session requests also sent business B's id in the query or body and the three spoofed identity headers. The responses were HTTP 401 and did not contain either business's fixture marker.

`POST /api/auth/login` for the two fixture users: PASS HTTP 200 with a session cookie. That is the session setup, not a full login-abuse test.

## Not tested through live HTTP

- A browser session. Pages were not opened.
- `GET` on purchase orders, stock transfers, purchase returns, recurring invoices, inventory adjustments, and suppliers.
- `POST /api/purchases`, `POST /api/payments`, and `POST /api/journal-entries`. Those remain the Phase 3K handler results.
- Stock-transfer dispatch and receipt, purchase-return cancellation, and recurring-invoice generation.
- Recurring lines that omit `item_id`.
- A staff user, a cancelled subscription, and a second revoked-session case beyond version 2 on the routes above.
- Every other API route.
