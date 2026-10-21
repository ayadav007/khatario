# Phase 3O — live HTTP security fix

The Phase 3N file is unchanged. This file records the fix for the six failures in that file.

## What changed

Only these four handlers changed.

| Handler | Change |
| --- | --- |
| `GET /api/purchase-orders` | `requireStrictSession` runs first. The list uses the session business. Query `business_id` and `user_id` are not used to choose the business. The status filter remains. |
| `GET /api/purchase-returns` | Same session rule. Search, page, and limit remain. |
| `GET /api/recurring-invoices` | `requireStrictSession` runs before the business-id comparison. A revoked session returns HTTP 401 `SESSION_REVOKED` before that comparison can return HTTP 403. A live session that names another business is still HTTP 403. |
| `POST /api/journal-entries` | `requireStrictSession` runs before the body is treated as a business and before a database connection is taken. The acting user is the session user. Account ownership, the debit/credit check, permissions, and ledger posting are unchanged. |

POST on the first three routes, and GET on journal entries, were not changed.

## Why the revoked session returned HTTP 403

Recurring invoices and journal entries compared the request's business id with the session before they compared the session version with `users.auth_session_version`. Middleware still accepted the unexpired cookie, so the mismatch check ran and returned HTTP 403. The version check now runs first.

## Database and server

`node tests/live/phase3o-http.mjs`

Before fixture writes: `database kh_phase2_test loopback port 5433`.

The server was `next dev` on `127.0.0.1:3110` with `DATABASE_URL` set to that database before Next loaded env files. Sessions came from `POST /api/auth/login`. The client was Node `fetch`. Cookies, passwords, and the database URL were not printed. Fixture businesses were deleted at the end.

## Commands

`node tests/live/phase3o-http.mjs`

Result: `SUMMARY pass=19 fail=0`. Exit code 0.

For purchase orders, purchase returns, and recurring invoices:

- No cookie: HTTP 401. Neither marker was returned.
- A session for A with B's id in the query, plus spoofed identity headers, did not return B's marker. Purchase orders and purchase returns returned A's own list. Recurring invoices returned HTTP 403 and did not return B's marker.
- A's session returned A's marker. B's session returned B's marker.
- After `auth_session_version` was set to 2, each GET returned HTTP 401 `SESSION_REVOKED` even though the query named B. Neither marker was returned.

For journal entries:

- No cookie: HTTP 401. B's journal and ledger counts were unchanged.
- A session for A with the body naming B: HTTP 403. No journal row.
- A's session with B's accounts: HTTP 403 `ACCOUNT_NOT_IN_BUSINESS`. A's ledger count was unchanged.
- An unbalanced entry: HTTP 400. No journal row.
- A's own balanced entry: HTTP 201. Debit equalled credit on A's voucher.
- The revoked cookie, with the body naming B: HTTP 401 `SESSION_REVOKED`. No journal row. B's journal and ledger counts were unchanged.

`node tests/live/phase3n-http.mjs`

Result: `SUMMARY pass=49 fail=0 blocked=0`. Exit code 0. The six Phase 3N failures passed on this rerun. The Phase 3N script and its original report were not changed.

`npx jest tests/db/phase3k-write-identity.db.test.ts --runInBand --forceExit`

Result: 1 suite, 9 passed. `authorize` and `requireStrictSession` were not stubbed. Handlers were called from Jest. This does not replace the live HTTP result.

## Still not tested

Search text and pagination on the two list routes were not given their own requests. Purchase-order POST, purchase-return POST, recurring-invoice POST, and journal GET were not part of this fix. Stock-transfer dispatch and receipt, purchase-return cancellation, and recurring-invoice generation were not run. Pages were not opened. A staff user and a cancelled subscription were not part of the live rerun. The Phase 3K Jest file still covers the staff user and the cancelled subscription for the write handlers it already called.
