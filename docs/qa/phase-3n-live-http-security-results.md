# Phase 3N — remaining live HTTP security checks

This phase called a running local Next.js server. It did not call route handlers from Jest and it did not call `middleware()` directly. The Phase 3M script and its 109-check report were not changed. Application code was not changed.

Every method below is exported by the route file.

## Database and server

Command: `node tests/live/phase3n-http.mjs`

The script reads `.env`, refuses a database host other than loopback, and connects only to `kh_phase2_test`. Before fixture writes it ran `current_database()`, `inet_server_addr()`, and `inet_server_port()`.

Observed: `database kh_phase2_test loopback port 5433`.

The server was `next dev` on `127.0.0.1:3109` with `DATABASE_URL` set to that database before Next loaded env files, `DB_NAME=kh_phase2_test`, and `E2E_DISABLE_RATE_LIMIT=true`. Port 3000 was not used. Readiness was `GET /api/auth/login` returning HTTP 200.

Proof the process used the test database: two users inserted only into `kh_phase2_test` logged in with HTTP 200. Cookies, passwords, and the database URL were not printed. Fixture businesses were named `P3N A` and `P3N B` and were deleted at the end.

## Sessions

`POST /api/auth/login` returned a `khatario_session` cookie for each business. Spoofed `x-authenticated-user-id`, `x-authenticated-business-id`, and `x-authenticated-session-version` were ordinary request headers. A stale session was that cookie after `users.auth_session_version` was set to 2.

The client was Node `fetch`, not a browser.

## Result

`SUMMARY pass=43 fail=6 blocked=0`. Exit code 1.

Each list had a different fixture marker for business A and business B. A list passed only when A's session returned A's marker, B's session returned B's marker, and A's forged request did not return B's marker.

Rejected writes were checked against purchases, payments, journal entries, ledger lines, stock movements, and the customer and supplier balances for the named party. Those values on B did not change.

| Route | No session | Forged identity with session A | Own records | Stale session | Side effects |
| --- | --- | --- | --- | --- | --- |
| `GET /api/purchase-orders` | PASS 401 | FAIL HTTP 200. The response contained B's order marker. The handler reads `business_id` from the query | PASS HTTP 200 for A and for B | FAIL HTTP 200. The revoked cookie still returned B's marker when the query named B | Read only |
| `GET /api/stock-transfers` | PASS 401 | PASS HTTP 200. Same body as A's clean request. B's marker absent | PASS | PASS 401 | Read only |
| `GET /api/purchase-returns` | PASS 401 | FAIL HTTP 200. The response contained B's return marker. The handler reads `business_id` from the query | PASS HTTP 200 for A and for B | FAIL HTTP 200. The revoked cookie still returned B's marker | Read only |
| `GET /api/recurring-invoices` | PASS 401 | PASS HTTP 403. Body said the business id does not match the session. B's marker absent | PASS | FAIL HTTP 403. B's marker was absent. The 403 is the same tenant mismatch a live session returns, so the revoked cookie was still accepted | Read only |
| `GET /api/inventory-adjustments` | PASS 401 | PASS HTTP 200. Same body as A's clean request. B's marker absent | PASS | PASS 401 | Read only |
| `GET /api/suppliers` | PASS 401 | PASS HTTP 200. Same body as A's clean request. B's marker absent | PASS | PASS 401 | Read only |
| `POST /api/purchases` | PASS 401. B unchanged | PASS HTTP 201 for a body that named B while the supplier and item belonged to A. The bill was stored on A. B's supplier was HTTP 400 `SUPPLIER_INVALID` and created no bill | PASS HTTP 201 on A | PASS 401 | B's purchase, payment, journal, ledger, stock, and party balances stayed the same |
| `POST /api/payments` | PASS 401. B unchanged | PASS HTTP 201 for a body that named B while the customer belonged to A. The payment was stored on A. B's customer and B's supplier were HTTP 404 `PAYMENT_PARTY_NOT_FOUND` | PASS HTTP 201 on A | PASS 401 | B unchanged, including the named customer and supplier balances |
| `POST /api/journal-entries` | PASS 401. B unchanged | PASS HTTP 403 when the body named B. B's accounts were HTTP 403 `ACCOUNT_NOT_IN_BUSINESS` | PASS HTTP 201. Debit equalled credit on A's journal voucher. B unchanged | FAIL HTTP 403. No journal row and B unchanged. The 403 is the body business mismatch, so the revoked cookie was still accepted | Unbalanced entry HTTP 400. No journal row. Ledger counts unchanged |

No-session requests also sent B's id and the three spoofed identity headers. They returned HTTP 401 and did not contain either marker.

## Not tested

- A browser session.
- Stock-transfer dispatch and receipt, purchase-return cancellation, and recurring-invoice generation.
- `GET /api/journal-entries`, `GET /api/purchases`, and `GET /api/payments` were not part of this batch. Their earlier results stay in the Phase 3M and Phase 3K files.
- A staff user and a cancelled subscription.
- Every other API route.
