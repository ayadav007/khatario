# Phase 3A — authentication, permissions, and business isolation

The four list-handler failures below were fixed in Phase 3B. This file keeps the original baseline. The fix and the rerun are in `docs/qa/phase-3b-security-fix-results.md`.

Initial baseline only. Two businesses, plus a third with no billing subscription, on disposable `kh_phase2_test` (localhost port 5433). `current_database()` was checked before inserts. `authorize` and module access were not stubbed. Application code was not changed.

This batch does not cover the other route handlers. A pass here is not a pass for the API surface.

## Commands

`npx jest tests/security/middleware-identity-headers.test.ts tests/security/cron-auth.test.ts --runInBand --forceExit`

2 suites, 8 passed. These do not use the database. The middleware file mocks the JWT verifier so there is no cookie. The cron file checks `assertCronAuthorized` on `POST /api/cron/process-campaigns`.

`npx jest tests/db/phase3a-auth-isolation.db.test.ts --runInBand --forceExit`

1 suite, 10 passed, 1 failed. Database: `kh_phase2_test`.

## What was exercised

List GET, with and without a session, for:

- `/api/invoices`
- `/api/customers`
- `/api/items`
- `/api/suppliers`
- `/api/purchases`
- `/api/payments`
- `/api/inventory-adjustments`
- `/api/stock-transfers`

Open-by-id GET for an invoice, customer, item, supplier, purchase, and payment belonging to the other business.

One `PUT /api/customers/[id]`, one `DELETE /api/items/[id]`, and two `POST /api/invoices` calls that were expected to be rejected.

Roles: business A primary admin, business A read-only user (`items` and `customers` view only), business B primary admin, business C primary admin with no billing module subscription.

No browser run in this batch. The earlier items-screen delete check is not repeated here.

## Authentication

| Check | Role | Expected from the current code | Actual | Database effect | Status |
| --- | --- | --- | --- | --- | --- |
| Middleware, no cookie, spoofed `x-authenticated-*` headers, eight list paths | none | 401 | 401. Body did not contain the other business's marker. | none | PASS |
| Same eight handlers called with no session headers and no query identity | none | not 200 | not 200. No business marker in the body. | none | PASS |
| `GET /api/customers/[id]` with session version 999 | primary admin A | 401 `SESSION_REVOKED` | 401 `SESSION_REVOKED` | customer name unchanged | PASS |
| `POST /api/cron/process-campaigns` missing or wrong bearer, via the existing cron test | none | 503 when `CRON_SECRET` is unset, 401 when the bearer is wrong | as asserted by that test | processor was mocked, so no campaign run | PASS for that one cron route |

Handlers without a session returned 400 in this run when neither a user nor a business was supplied. That is the handler contract. Middleware, which sits in front of these paths in the app, returns 401.

## Tenant isolation

A session for business A, with `business_id` and `user_id` for business B in the query, did not return B's marker. Invoice, ledger, and stock-movement counts for both businesses stayed the same. **PASS.**

Opening B's invoice, customer, item, supplier, purchase, or payment by id with A's session did not return 200 and did not include B's marker. A's own customer GET returned 200. **PASS.**

`PUT` of B's customer, with B's `business_id` in the body, did not change the name. **PASS.**

`DELETE` of B's item, with B's `business_id` in the body, did not set `deleted_at`. **PASS.**

`POST /api/invoices` as A, with B's customer, B's item, and B's `business_id` in the body, was not 201. Invoice, ledger, and stock-movement counts did not change. The body also sent `created_by` for B's user. **PASS.**

### Failed handler fallback

`GET` with no session headers, `user_id` set to A's primary admin, and `business_id` set to B:

| Endpoint | Actual | Status |
| --- | --- | --- |
| `/api/invoices` | HTTP 200, body included B's invoice number and customer name | FAIL |
| `/api/items` | HTTP 200, body included B's item | FAIL |
| `/api/purchases` | HTTP 200, body included B's purchase | FAIL |
| `/api/payments` | HTTP 200, body included B's payment | FAIL |
| `/api/customers`, `/api/suppliers`, `/api/inventory-adjustments`, `/api/stock-transfers` | response did not include B's marker | PASS for that marker check |

These four failures are reads. The test did not see a write. Middleware still returns 401 for those paths when the cookie is missing, including when the client sends the identity headers. A normal browser request does not reach the handler. The handlers themselves trust `user_id` and `business_id` from the query when the session headers are absent, and `authorize` on those four list routes does not receive the target business id, so a primary admin short-circuit allows the read.

Severity: medium as a defense-in-depth defect. It is a cross-tenant read if a request reaches the handler without middleware. It was not demonstrated through middleware.

## Role permissions

| Check | Role | Actual | Database effect | Status |
| --- | --- | --- | --- | --- |
| `GET /api/items` search of A's item | read-only user on A | 200, A's item present, B's item absent | none | PASS |
| `GET /api/invoices` | same user, no invoices permission | 403 | none | PASS |
| `PUT /api/customers/[id]` rename | same user | 403 | name unchanged | PASS |
| `POST /api/invoices` for A's customer | same user | not 201 (`PERMISSION_DENIED` in the handler log) | invoice, ledger, and stock counts unchanged | PASS |

The read-only user was not given purchase, payment, supplier, adjustment, or transfer permissions, and those denied cases were not each called. UI permission checks were not opened in a browser in this batch.

## Subscription

| Check | Role | Actual | Status |
| --- | --- | --- | --- |
| `GET /api/items` | primary admin of business C, no billing module row and no subscription | not 200. Neither business marker was present. | PASS |
| `GET /api/inventory-adjustments` and `GET /api/stock-transfers` | primary admin of A, on the plan chosen because it has `reports_basic` | status matched whether that plan had `purchase_inventory_adjustments` and `settings_multi_warehouse`. Neither body contained B's marker. | PASS for that plan check |

No adjustment or transfer row was seeded, so open-by-id isolation for a real row is NOT TESTED. `GET /api/inventory-adjustments/[id]` was called with an unused id and B's `business_id` in the query; the body did not contain B's marker.

## Middleware-public handlers

Reviewed against `docs/qa/audit-gaps.md`. Only `POST /api/cron/process-campaigns` was executed, through the existing test. Its handler checks `CRON_SECRET` before the processor. The other cron, webhook, public, signup, and staff-app routes in that list were not called. They stay NOT TESTED. Skipping middleware is not, by itself, a finding.

## Not tested

- Create, update, and cancel for purchases, payments, adjustments, and transfers.
- Search beyond the item-list search used for the read-only user.
- A real stock-transfer cancel.
- Browser screens for these permission checks.
- Login with a wrong password, an expired cookie, or a refresh token. Session version 999 was the expired-session case that the handler supports.
- The other 105 middleware-public handlers.
- Every remaining route handler. This is one batch.
