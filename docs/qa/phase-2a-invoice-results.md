# Phase 2A — sales invoice results (S01–S08)

Executed on 2026-10-19 against disposable database `kh_phase2_test` on localhost port 5433. `SELECT current_database()` returned `kh_phase2_test` and `inet_server_addr()` was `::1` before any fixture was inserted. The application `.env` default database name is `khatario`. These tests did not use it. Credentials are not recorded here.

The sections through S08 record the Phase 2A baseline. Phase 2B, at the end of this file, fixed S03, S04 and S05 and reran the suite.

## How the scenarios were run

`POST /api/invoices` is the user-facing create path. Subscription enforcement, feature checks, and `authorize()` were stubbed so a fixture business without a plan could reach stock, GST, and ledger code. Those stubs are not a pass for permissions or plan limits.

`createInvoiceInTransaction` was also called for S04 and S05, inside a transaction that was rolled back. That is the offline, store, and WhatsApp path. It is not what the invoice screen posts.

Playwright was not run. These checks are database outcomes.

Tax on each line is `computeLineGst` for quantity 2, unit price 100, rate 18 (a notified slab in `lib/gst/rates.ts`), prices exclusive of GST:

| Supply | Taxable | CGST | SGST | IGST | Grand |
| --- | ---: | ---: | ---: | ---: | ---: |
| Intra-state (business state 27, place of supply 27) | 200 | 18 | 18 | 0 | 236 |
| Inter-state (place of supply 29) | 200 | 0 | 0 | 36 | 236 |

The business was set to GST registration type `regular` with a GSTIN, so `outwardTaxPolicy` collects tax. Inventory model was set to `perpetual`. Warehouses were off, so stock moves in `branch_item_stock`. Purchase price on the item was 40. `weightedAverageCosts` therefore uses 40, and perpetual COGS for quantity 2 is 80.

## Commands

Final command, executed:

`npx jest tests/db/phase2a-invoice-s01-s08.db.test.ts tests/lib/invoices/line-gst.test.ts --runInBand --forceExit`

Result: 3 failed, 13 passed (5 invoice scenarios passed, 8 existing line-GST unit tests passed).

An earlier run of only the database file, with the lock snapshot on 2026-09-30, returned HTTP 422 for S03 before the response code was asserted. That date is in an earlier GST month than the run date, and `getClosingStockLockedCutoffDate` turns the stored date 2026-09-30 into the string `2026-09-29` (`Date.toISOString()` on a `date` column at IST midnight). The closing-stock check therefore did not see 2026-09-30 as locked, and a later check in `POST /api/invoices` returned 422. The recorded S03 result below uses snapshot calendar date 2026-10-15, which is inside the current GST month, so that 422 path is not what failed.

`tests/db/phase3-7-final-documents.db.test.ts` was not run. It stays skipped unless `PHASE2_TEST_DATABASE_URL` is set, and that variable was unset in the shell.

## Score

| Status | Scenarios |
| --- | --- |
| PASS | 5 (S01, S02, S06, S07, S08) |
| FAIL | 3 (S03, S04, S05) |
| BLOCKED | 0 |
| NOT TESTED | 0 |

## S01 — PASS

Final invoice, no payments, customer in the same business, place of supply 27.

- Expected: invoice and lines saved, stock movement `out`, customer balance up by the grand total, ledger posted and balanced.
- Actual: HTTP 201. Header status `final`, `paid_amount` 0, `balance_amount` 236, subtotal 200, CGST 18, SGST 18, IGST 0. One line, quantity 2. One `stock_movements` row, type `out`, quantity 2, reference `invoice`. Branch stock fell by 2. This customer's balance rose by 236. The other business's customer balance did not change. No payment row.
- Ledger for that voucher: debit 1103 (receivable) 236, credit 4101 (sales) 200, credit 2150 (output CGST) 18, credit 2151 (output SGST) 18, debit 5104 (COGS) 80, credit 1104 (inventory) 80. Debits equal credits.
- Command: the Jest command above. Executed.

## S02 — PASS

Draft tax invoice through `POST /api/invoices` (`status: 'draft'`). The HTTP route allows drafts. The offline helper allows a draft only when `allowDraft` is set; that helper was not used here.

- Expected: draft saved; stock, customer balance, and ledger unchanged.
- Actual: HTTP 201, invoice status `draft`. Stock, customer balance, stock-movement count, ledger count, and payment count were unchanged. The draft voucher has no ledger lines.
- Command: executed.

## S03 — FAIL

Locked `closing_stock_snapshot_headers.snapshot_date` = 2026-10-15, `is_locked` true. Invoice date 2026-10-15.

- Expected: HTTP 409, code `CLOSING_STOCK_PERIOD_LOCKED`, no invoice, stock, balance, or ledger change. Source: `assertDocumentDateNotBeforeLockedClosingStock` and the comment in `lib/closing-stock-period-lock.ts` that a document on or before the locked snapshot date is blocked.
- Actual: HTTP 201, `code` null. One invoice inserted. Branch stock decreased by 2. Customer balance increased by 236. Six ledger lines were inserted.
- Cause: `getClosingStockLockedCutoffDate` formats a `date` with `toISOString()`, which moves 2026-10-15 to `2026-10-14` in IST. The invoice date is after that string, so the lock does not throw. This is an application defect, not a bad total. A separate probe on `kh_phase2_test` printed `cutoff: "2026-09-29"` for a snapshot dated 2026-09-30, then deleted that probe business.
- Severity: high. A locked closing-stock day still accepts a final invoice, stock issue, and ledger posting.
- Classification: application defect. Not fixed in this phase.

## S04 — FAIL

Customer id belongs to a second business. It is not a customer of the business in the session.

- Expected: `CUSTOMER_NOT_FOUND` and no persisted invoice, stock, balance, or ledger change. The offline helper returns that code with status 400 (`lib/invoices/invoice-create-service.ts`).
- Actual HTTP: 201, no error code. One invoice. Stock decreased by 2. Ledger lines increased by 5. The other business's customer balance increased by 236 (100 to 336). The session business's customer balance did not change.
- Actual service helper, rolled back: `CUSTOMER_NOT_FOUND`, status 400.
- Severity: high. `POST /api/invoices` will post a sale against another tenant's customer and change that customer's balance. The offline helper already rejects this.
- Classification: application defect on the HTTP route. Not fixed in this phase.

## S05 — FAIL

Line item has `deleted_at` set.

- Expected: HTTP 409, code `PRODUCT_DELETED`, no stock, balance, or ledger change. The offline helper throws that code with status 409.
- Actual HTTP: 201, no error code. One invoice. Deleted-item branch stock decreased by 2. One stock movement. Customer balance increased by 236. Ledger lines increased by 6.
- Actual service helper, rolled back: `PRODUCT_DELETED`, status 409.
- Severity: high. A soft-deleted goods item is sold, stock is reduced, and the ledger is posted.
- Classification: application defect on the HTTP route. Not fixed in this phase.

## S06 — PASS

Same fixture as S01, place of supply 27, customer state 27.

- Expected: CGST and SGST from `computeLineGst` intra-state branch; IGST zero.
- Actual: HTTP 201. Invoice CGST 18, SGST 18, IGST 0, grand total 236. Ledger credits 2150 and 2151 for 18 each. No 2152 line.
- Command: executed.

## S07 — PASS

Customer state and place of supply set to 29. Business state remains 27. No customer GSTIN, so the GSTIN/place-of-supply match rule does not apply.

- Expected: IGST from `computeLineGst` inter-state branch; CGST and SGST zero.
- Actual: HTTP 201. CGST 0, SGST 0, IGST 36, grand total 236. Ledger credit 2152 for 36. No 2150 or 2151 line.
- Command: executed.

## S08 — PASS

Final invoice with no `customer_id` and no payment rows. Place of supply 27, so tax is intra-state.

- Expected: cash-sale ledger (debit cash, not receivable) and no customer balance change. Source: `isCashSale = !customer_id` in `POST /api/invoices`, and `createInvoiceLedgerEntries` debits account 1101 when there is no payment split (`cashSaleDebitLines` returns null when the payment list is empty).
- Actual: HTTP 201. `customer_id` null. Session customer balance unchanged. Other business's customer balance unchanged. No payment row. Ledger debit 1101 for 236. No 1103 line. Sales credit 200.
- Command: executed.

## COGS

`createInvoiceInTransaction` and `POST /api/invoices` both pass a COGS amount into `createInvoiceLedgerEntries`. In `lib/ledger-utils.ts` that argument is discarded (`void cogsAmount`). When `business_settings.inventory_model` is not `periodic`, `getInventoryModel` returns `perpetual` and the helper computes cost from the saved invoice lines (`computeGoodsCost`) and posts debit 5104 / credit 1104 via `postCostOfGoods`.

S01 observed that posting: 80 debit on 5104 and 80 credit on 1104, which is quantity 2 times purchase price 40 from `weightedAverageCosts`. The passed-in zero is not a missing cost entry on a perpetual book.

Periodic books were not executed. Period-end COGS for `inventory_model = 'periodic'` is not established by this run.

## What this does not cover

Eight scenarios, one HTTP route, one fixture business. Edit, cancel, credit notes, payments on an invoice, proforma, composition dealers, warehouse stock, RBAC, and plan limits were not executed in Phase 2A. The invoice module is not fully tested.

## Phase 2B — fixes and rerun

Phase 2B changed only the three failing paths. Authorization, plan checks, and `authorize()` stay stubbed in `tests/db/phase2a-invoice-s01-s08.db.test.ts`. That file does not prove middleware, authentication, or RBAC.

### Root causes

- **S03.** `snapshot_date` is a PostgreSQL `date`. node-pg turns it into a `Date` at local midnight, and `toISOString()` then takes the UTC day. In Asia/Kolkata, 2026-10-15 became 2026-10-14, so an invoice on the locked day was after the cutoff. The cutoff is now `to_char(..., 'YYYY-MM-DD')` from Postgres. `calendarDateOnly` uses the local calendar fields if a `Date` is still passed, and does not add a day offset.
- **S04.** `POST /api/invoices` already takes the business id from `x-authenticated-business-id` only (`getSessionScopedBusinessId`). It never checked that `customer_id` belonged to that business, then added the invoice balance onto `customers` by id alone. A customer of another business was updated. The route now uses the same lookup as `createInvoiceInTransaction` (`id` + session `business_id` + `deleted_at IS NULL`) before the transaction starts, and the balance update also requires `business_id`. The error is `Customer not found` / `CUSTOMER_NOT_FOUND` for a missing id and for another business's id.
- **S05.** The stock lookup selected the item without `deleted_at IS NULL`, so a soft-deleted goods row was still sold. The route now rejects any line `item_id` that is not an active item of the session business, with HTTP 409 and `PRODUCT_DELETED`, before `BEGIN`.

### Files

- `lib/closing-stock-period-lock.ts`
- `app/api/invoices/route.ts`
- `tests/db/phase2a-invoice-s01-s08.db.test.ts`
- `tests/lib/closing-stock-period-lock.test.ts`

### Command

Executed:

`npx jest tests/db/phase2a-invoice-s01-s08.db.test.ts tests/lib/invoices/line-gst.test.ts tests/lib/closing-stock-period-lock.test.ts --runInBand --forceExit`

The database test again refused to continue unless `current_database()` was `kh_phase2_test` on the local server. Result: 3 suites passed, 21 tests passed, 0 failed.

### Post-fix scenario status

| Scenario | Status | Evidence |
| --- | --- | --- |
| S01 | PASS | Final invoice, stock movement, balance +236, balanced ledger including COGS 80. Unchanged assertion. |
| S02 | PASS | Draft leaves stock, balance, movements, ledger, and payments unchanged. |
| S03 | PASS | Locked snapshot 2026-10-15. Cutoff string is `2026-10-15`. Invoice on that day and on 2026-10-14: HTTP 409 `CLOSING_STOCK_PERIOD_LOCKED`, invoice/stock/movement/ledger/balance/payment deltas all 0. Invoice on 2026-10-16: HTTP 201, one invoice, stock −2, balance +236, one movement. |
| S04 | PASS | Body `business_id` set to the other business and query `business_id=spoof` are ignored. HTTP 400 `CUSTOMER_NOT_FOUND`, error `Customer not found`, response body does not contain the other customer id. Invoice, stock, ledger, both customer balances unchanged. Service helper still returns the same code. |
| S05 | PASS | HTTP 409 `PRODUCT_DELETED`. No invoice, stock movement, ledger line, or balance change. Deleted-item quantity unchanged. Service helper still returns 409. |
| S06 | PASS | CGST 18, SGST 18, IGST 0. |
| S07 | PASS | IGST 36, CGST 0, SGST 0. |
| S08 | PASS | No customer, cash debit 1101, customer balances unchanged. |

`tests/lib/closing-stock-period-lock.test.ts` passed, including the case where a local midnight `Date` would become the previous UTC day under a timezone ahead of UTC, and the Asia/Kolkata midnight instant `2026-10-15T00:00:00+05:30` whose `toISOString()` day is 2026-10-14. `tests/lib/invoices/line-gst.test.ts` passed (8 tests).

### Still not covered

These tests still stub `authorize`, `enforceAccess`, and `assertFeatureAccess`. They do not verify middleware or role permissions. Purchases, edits, cancellations, and periodic inventory were not part of this rerun. The invoice module is not fully tested.

## Soft-delete regression check

The S05 check is only the new item lookup in `POST /api/invoices`, before `BEGIN`. It selects active items for the session business and returns 409 `PRODUCT_DELETED` when a line `item_id` is missing or soft-deleted. It does not change `GET /api/invoices/[id]`, item delete, item list SQL, or report SQL. Those still use their previous `deleted_at` filters. Invoice lines keep `item_name`, HSN, quantity, and totals on `invoice_items`. The invoice read joins `items` without requiring `deleted_at IS NULL`, so a later soft delete does not drop the line.

There is no catalog-item restore route. `UPDATE items ... deleted_at` appears only as the soft-delete write in `DELETE /api/items/[id]`. `app/api/invoices/restore/route.ts` restores a soft-deleted invoice, not an item. Backup restore is a different feature and was not run.

Command, executed on `kh_phase2_test`:

`npx jest tests/db/phase2a-invoice-s01-s08.db.test.ts --runInBand --forceExit`

11 passed, 0 failed. `authorize` is still stubbed, so this does not prove item-delete permission checks.

| Check | Status | Evidence |
| --- | --- | --- |
| Soft-deleted item cannot be invoiced | PASS | S05 and the history test: HTTP 409 `PRODUCT_DELETED`, no new invoice, movement, or ledger line. |
| Active item can be invoiced | PASS | S01, S06, S07, S08, and the history test's first post of the item while `deleted_at` was null. HTTP 201. |
| Invoice created before the item was soft-deleted stays viewable | PASS | `DELETE /api/items/[id]` returned 200 and set `deleted_at`. `GET /api/invoices/[id]` still returned the stored item name, HSN, quantity, and line total. |
| Historical sales line remains in the report join | PASS | The tax-wise report join (`invoice_items` to `invoices`, no filter on `items.deleted_at`) still returned that line. The deleted-items report HTTP route was not called. That report lists deleted invoices, purchases, payments, and suppliers, not catalog items. |
| Rejected resale does not delete the item or clear `deleted_at` | PASS | After 409, the same row existed, with the same name and the same `deleted_at` text. |
| Item list filter | PASS for the established SQL (`deleted_at IS NULL`). The active fixture item was included and the soft-deleted item was not. `GET /api/items` was not called because that route also requires a billing module subscription this fixture does not have. |
| Item restore | NOT TESTED | No item-restore workflow exists in the application routes. |
| Item-delete RBAC and the items screen | NOT TESTED | Delete was called with `authorize` stubbed. No browser pass. |

`GET /api/invoices/[id]` logged an existing credit-metrics error (`checkAndSendCreditAlerts` is stubbed and the call expects `.catch`). The response was still 200 and the historical line was intact. That log is not a soft-delete failure.

## Remaining soft-delete checks

These calls do not stub `authorize`, `requirePlatformModule`, or `assertReportAccess`. The fixture business has an enabled billing module and an active `business_module_subscriptions` row on a plan that includes `reports_basic`. Session headers carry the user id, business id, and `auth_session_version` 1, and the test feeds those same headers to `next/headers`, so the session-version check inside `authorize` runs. The Jest calls do not present a login cookie. The browser run logs in through `POST /api/auth/login`.

Database for both commands: `kh_phase2_test` on localhost port 5433. `current_database()` was checked before inserts.

### API and permission

Command:

`npx jest tests/db/soft-delete-items-and-report.db.test.ts --runInBand --forceExit`

4 passed, 0 failed.

| Check | Status | Evidence |
| --- | --- | --- |
| `GET /api/items` hides a soft-deleted item and returns an active item | PASS | HTTP 200. The active id was in `items`. The soft-deleted id was not. An `is_active = false` item was also omitted. That is the existing list filter (`deleted_at IS NULL` and active). POST on this route was not called. |
| User without `items` delete | PASS | HTTP 403 `PERMISSION_DENIED`. Name, `deleted_at`, and `is_active` were unchanged. The request body sent another user's id. The handler used the session user. |
| User with `items` delete | PASS | HTTP 200. The row remained, with the same name and a non-null `deleted_at`. A following list GET did not include it. |
| `GET /api/reports/deleted-items?type=all` | PASS for the rows that were seeded | HTTP 200. The soft-deleted invoice and supplier were returned. The catalog item ids were not. Every returned `type` was `invoice`, `purchase`, `payment`, or `supplier`. No purchase or payment row was seeded, so those two branches were not executed. |

The list route also requires the billing module. The fixture supplied that subscription. It was not stubbed.

### Items screen

Command, against `http://127.0.0.1:3107`. The server was started with `DB_NAME=kh_phase2_test` so `.env` could not switch it back to `khatario`. `PLAYWRIGHT_SKIP_WEBSERVER=1`.

`npx playwright test e2e/soft-delete-items.spec.ts --workers=1 --project=chromium --retries=0`

2 passed, 0 failed.

| Check | Status | Evidence |
| --- | --- | --- |
| Active item visible, soft-deleted item not | PASS | The table showed the active name. The hidden name was absent. |
| Confirmation, then the row leaves the list | PASS | The Delete confirmation dialog included the item name. `DELETE /api/items/[id]` returned 200. The next `GET /api/items` body did not include that name. The table row count for that name became 0. The database row still existed with `deleted_at` set. |
| User without delete permission | PASS | The Delete control was disabled with the existing tooltip. `deleted_at` on the active item did not change. |

This browser pass does not cover Edit, filters, import, barcodes, or categories on `/items`.

### Not in this run

Catalog item restore remains NOT TESTED. No item-restore route was found, and none was added.
