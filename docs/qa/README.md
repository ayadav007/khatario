# Khatario QA index

This is the entry point for the continuous QA project. The files below are the records. Do not replace them with a new inventory. Update the row or section that changed, and leave earlier results in place.

Statuses mean only what was executed: **NOT TESTED**, **PASS**, **FAIL**, **BLOCKED**. **Partial** means some named behavior ran and the rest did not. A loaded page is not a pass.

## Current phase

Phase 1 discovered routes and actions and did not run them. Phase 2A executed sales-invoice scenarios S01–S08. Phase 2B fixed S03, S04, and S05 and reran those scenarios. Soft-delete checks are recorded. Phase 3A ran one authentication and isolation batch. Phase 3B fixed the four list handlers that trusted a query identity when the session was missing. Phase 3C confirmed seven dashboard GET leaks. Phase 3D fixed those seven. Phase 3E confirmed nine more GET handlers still trusted a query identity. Phase 3F fixed those nine. Phase 3G audited six POST handlers and confirmed writes on estimates, sales orders, and customers. Phase 3H fixed those three plus expenses POST. Phase 3I audited five more write handlers and confirmed writes on suppliers, items, purchase orders, inventory adjustments, and customer update. Phase 3J fixed those five. Phase 3K audited six more write handlers. Stock transfers, purchase returns, and recurring-invoice item references failed. Phase 3L fixed those three. Phase 3M called those fixed routes through a local Next.js server and a real login cookie. Phase 3N called the remaining list GETs and the purchase, payment, and journal POSTs the same way. Two list GETs returned the other business's rows. Phase 3O fixed those four handlers. Phase 3P called the remaining live list, create, transfer, cancel, and recurring-generation workflows. The recurring run date was one calendar day early. Phase 3Q keeps that date as a calendar day. A later Phase 3P run checked stored purchase-order totals, purchase-return stock and ledger lines, transfer quantities, and the generated invoice date. A staging browser pass signed into Shalini Traders and generated one invoice. Purchase and purchase return were not opened. The rest of the API is not covered.

## Files

| File | Purpose |
| --- | --- |
| `route-inventory.md` | Every `page.tsx` and `route.ts` under `app/`, with module, session, plan feature, and test status. Phase 1 set every row to `not executed`. Only rows that a later run actually called are changed. |
| `action-inventory.md` | Verb labels found in page source and one component import. Those labels were not clicked. Invoice create was tested through the API, not through these labels. |
| `module-map.md` | Platform modules, navigation sources, and shared `components/` and `lib/` areas. Structural, not a test result. |
| `test-plan.md` | Scenarios, roles, and commands. S09–S12 and everything not listed as PASS or FAIL in the scenario table are still NOT TESTED. |
| `audit-gaps.md` | Phase 1 gaps: hidden actions, dynamic templates, middleware-public APIs, missing requirements. Still open unless a later result file closes a specific gap. |
| `phase-2a-invoice-results.md` | Authoritative invoice evidence: baseline failures, fixes, rerun, and the soft-delete regression check. |
| `sales-invoice-calculation-phase-1-closure.md` | Closure of the sales-invoice additional-charge calculation only. Separate from the route-scan Phase 1 above. Purchase, expense, RCM, and GTA are not included. |
| `phase-3a-security-results.md` | Phase 3A authentication, tenant isolation, role, and subscription evidence. The four list-handler failures are fixed in Phase 3B. |
| `phase-3b-security-fix-results.md` | Fix and regression for the four list handlers that trusted a query identity. |
| `phase-3c-identity-audit-results.md` | Phase 3C search and the first tested batch of other identity fallbacks. Seven dashboard GET handlers failed. The original FAIL stays here. |
| `phase-3d-dashboard-security-fix-results.md` | Fix and regression for the seven dashboard GET handlers. |
| `phase-3e-identity-audit-results.md` | Phase 3E check of the remaining suspicious dashboard and list GETs. Nine handlers failed. The original FAIL stays here. |
| `phase-3f-identity-fix-results.md` | Fix and regression for the nine GET handlers. |
| `phase-3g-write-identity-audit-results.md` | Phase 3G audit of six POST handlers. Estimates, sales orders, and customers failed. No fix was applied. |
| `phase-3h-write-identity-fix-results.md` | Fix and regression for POST estimates, sales orders, customers, and expenses. |
| `phase-3i-write-identity-audit-results.md` | Phase 3I audit of five more write handlers. Suppliers, items, purchase orders, inventory adjustments, and customer update failed. No fix was applied. |
| `phase-3j-write-identity-fix-results.md` | Fix and regression for those five write handlers. |
| `phase-3k-write-identity-audit-results.md` | Phase 3K audit of stock transfers, purchase returns, purchases, payments, journal entries, and recurring invoices. Three writes failed. No fix was applied. |
| `phase-3l-write-identity-fix-results.md` | Fix and regression for stock transfers, purchase returns, and recurring invoices. |
| `phase-3m-live-http-security-results.md` | Live HTTP check of the Phase 3B, 3D, 3F, 3H, 3J, and 3L routes on a local Next.js server. |
| `phase-3n-live-http-security-results.md` | Live HTTP check of the remaining list GETs and of POST purchases, payments, and journal entries. The original failures stay here. |
| `phase-3o-live-http-security-fix-results.md` | Fix and live HTTP regression for the four Phase 3N failures. |
| `phase-3p-live-workflow-results.md` | Live HTTP check of the remaining lists, creates, transfer dispatch and receipt, purchase-return cancellation, and recurring generation. The original date FAIL stays here. A later section records stored totals, stock, and ledger lines. |
| `phase-3q-recurring-date-fix-results.md` | Fix for the recurring run date, with the persisted invoice date. |
| `phase-3q-browser-functional-results.md` | Staging browser check of a sales invoice. Purchase and purchase return were blocked by the login limit. |
| `account-hierarchy-audit-results.md` | Chart of Accounts hierarchy, opening balances, and report totals. Separate from the identity series. |
| `security-live-regression-results.md` | Repeatable command for the security suites already verified. It does not pass the rest of the application. |

## Completed work

- Phase 1: 385 page templates, 947 route handlers, 827 action labels, 33 functional areas. Nothing in that pass was executed.
- Sales-invoice calculation Phase 1: the additional-charge contract in `sales-invoice-calculation-phase-1-closure.md`. 26 tests passed on `kh_phase2_test`. One browser bill matched ₹12,980.00 on screen. Conversion clicks and a visual PDF total stay NOT TESTED. This is not the route-scan Phase 1, and it does not start purchase, expense, RCM, or GTA work.
- Phase 2A: S01, S02, S06, S07, S08 passed. S03, S04, S05 failed on `kh_phase2_test`.
- Phase 2B: those three defects were fixed. S01–S08 passed again. Command and evidence are in the results file.
- Soft-delete check: a new invoice cannot use a soft-deleted item; an active item still can; an older invoice remains readable; the rejected resale does not clear `deleted_at`. Command: `npx jest tests/db/phase2a-invoice-s01-s08.db.test.ts --runInBand --forceExit` (11 passed).
- Remaining soft-delete checks: item list HTTP, item-delete permission, the items screen, and the deleted-records report. Commands and evidence are in the results file. Catalog item restore was not added.
- Phase 3A baseline: middleware, one cron route, and a two-business handler batch. One handler-level cross-tenant read failed. Evidence is in `phase-3a-security-results.md`.
- Phase 3B: those four list handlers now require the trusted session. Regression is in `phase-3b-security-fix-results.md`.
- Phase 3C: seven dashboard GET handlers still trusted a query identity. Evidence is in `phase-3c-identity-audit-results.md`.
- Phase 3D: those seven handlers now require the trusted session. Regression is in `phase-3d-dashboard-security-fix-results.md`.
- Phase 3E: nine more GET handlers returned another business's rows when that business's user id was supplied. Evidence is in `phase-3e-identity-audit-results.md`.
- Phase 3F: those nine GET handlers now require the trusted session. Regression is in `phase-3f-identity-fix-results.md`.
- Phase 3G: six POST handlers were audited. Estimates, sales orders, and customers can write another business's rows. Evidence is in `phase-3g-write-identity-audit-results.md`. No application change was made.
- Phase 3H: those three POST handlers, and expenses POST, now use the verified session. Regression is in `phase-3h-write-identity-fix-results.md`.
- Phase 3I: five more write handlers were audited. Items, purchase orders, inventory adjustments, suppliers, and customer update can change another business's records. Evidence is in `phase-3i-write-identity-audit-results.md`. No application change was made.
- Phase 3J: those five handlers now use the verified session. Regression is in `phase-3j-write-identity-fix-results.md`.
- Phase 3K: six more write handlers were audited. Stock transfers, purchase returns, and a recurring-invoice item reference can use another business's records. Evidence is in `phase-3k-write-identity-audit-results.md`. No application change was made.
- Phase 3L: those three POST handlers now use the verified session and reject the other business's warehouses, items, suppliers, and bills. Regression is in `phase-3l-write-identity-fix-results.md`.
- Phase 3M: the routes named in `phase-3m-live-http-security-results.md` were called over HTTP on local `kh_phase2_test`. 109 checks passed. A browser was not used.
- Phase 3N: the routes named in `phase-3n-live-http-security-results.md` were called over HTTP. 43 checks passed and 6 failed. Purchase-order and purchase-return lists returned the other business's rows.
- Phase 3O: those four handlers now check the verified session before business selection. Live regression is in `phase-3o-live-http-security-fix-results.md`.
- Phase 3P: the workflows named in `phase-3p-live-workflow-results.md` were called over HTTP. 44 checks passed. Purchase-order search and pagination are not on that GET handler. Recurring generation used the previous calendar day. A later run of `node tests/live/phase3p-functional.mjs` passed 14 checks of stored totals, stock, supplier balance, and ledger lines. Purchase-order search and pagination stay NOT TESTED.
- Phase 3Q: recurring generation now keeps the database calendar day. The persisted invoice date is in `phase-3q-recurring-date-fix-results.md`. The staging browser pass is in `phase-3q-browser-functional-results.md`. It generated INV-072 and then stopped when login was rate-limited.

## Defects

| Item | State |
| --- | --- |
| S03 closing-stock date shifted by `toISOString()` | Fixed in Phase 2B. Regression PASS. History remains in the results file. |
| S04 `POST /api/invoices` accepted another business's customer | Fixed in Phase 2B. Regression PASS. `authorize` was stubbed, so RBAC is still NOT TESTED. |
| S05 `POST /api/invoices` sold a soft-deleted item | Fixed in Phase 2B. Regression PASS. |
| Periodic-inventory COGS | NOT TESTED. Perpetual COGS was observed on S01. |
| Invoice edit, cancel, credit note, payment on an invoice | NOT TESTED. |
| Four list handlers trusted query `user_id` and `business_id` | Fixed in Phase 3B. Regression PASS. The Phase 3A failure remains recorded. |
| Seven dashboard GET handlers trusted query identity | Fixed in Phase 3D. Regression PASS. The Phase 3C failure remains recorded. |
| Nine GET handlers trusted a query user id of the target business | Fixed in Phase 3F. Regression PASS. The Phase 3E failure remains recorded. |
| POST estimates, sales orders, customers, and expenses trusted caller identity | Fixed in Phase 3H. Regression PASS. The Phase 3G failure remains recorded. |
| POST items, purchase orders, and inventory adjustments, plus supplier create and customer update, trusted caller identity | Fixed in Phase 3J. Regression PASS. The Phase 3I failure remains recorded. |
| POST stock transfers and purchase returns trusted caller identity, and recurring invoices stored another business's item id | Fixed in Phase 3L. Regression PASS. The Phase 3K failure remains recorded. |
| `GET /api/purchase-orders` and `GET /api/purchase-returns` return the business id from the query | Fixed in Phase 3O. Live regression PASS. The Phase 3N failure remains recorded. |
| Revoked session still accepted by `GET /api/recurring-invoices` and `POST /api/journal-entries` | Fixed in Phase 3O. A revoked cookie returns HTTP 401 `SESSION_REVOKED`. The Phase 3N failure remains recorded. |
| Recurring `run_now` run date is the previous calendar day | Fixed in Phase 3Q. A definition dated `2026-10-19` now stores `invoice_date` `2026-10-19`. The Phase 3P failure remains recorded. |

No open FAIL is recorded for S01–S08 after the Phase 2B rerun.

## Coverage that was actually run

| Route or action | Scenario | Test | Result |
| --- | --- | --- | --- |
| `POST /api/invoices` (A0403) create final, draft, lock date, other-business customer, soft-deleted item, intra-state, inter-state, cash sale | S01–S08 | `tests/db/phase2a-invoice-s01-s08.db.test.ts` | PASS after Phase 2B. GET on this route is NOT TESTED. |
| `GET /api/invoices/[id]` (A0404) one invoice after its item was soft-deleted | Soft-delete check | same file | PASS for that GET. PATCH is NOT TESTED. |
| `DELETE /api/items/[id]` (A0428) one soft delete | Soft-delete check | `tests/db/phase2a-invoice-s01-s08.db.test.ts` | PASS for that call. `authorize` was stubbed. Superseded for permission by the later file. GET and PATCH are NOT TESTED. |
| `GET /api/items` (A0427) list | Remaining soft-delete check | `tests/db/soft-delete-items-and-report.db.test.ts` | PASS. POST is NOT TESTED. |
| `DELETE /api/items/[id]` denied user and allowed user | Remaining soft-delete check | same file | PASS. Real `authorize`. GET and PATCH are NOT TESTED. |
| `GET /api/reports/deleted-items` (A0614) | Remaining soft-delete check | same file | PASS for a deleted invoice and supplier. Purchase and payment rows were not seeded. |
| `/items` (P141) list, confirmation, delete | Remaining soft-delete check | `e2e/soft-delete-items.spec.ts` | PASS for those actions. Other controls on the page are NOT TESTED. |
| Pages `/invoices`, `/invoices/new`, `/invoices/[id]` (P133, P138, P134) | — | — | NOT TESTED. Action labels on P133 were not clicked. |
| Closing-stock calendar day | S03 boundaries | `tests/lib/closing-stock-period-lock.test.ts` | PASS |
| Line GST math | Supports S06–S07 | `tests/lib/invoices/line-gst.test.ts` | PASS (8 tests). This does not by itself pass a posted invoice. |
| Middleware spoofed identity headers and eight list APIs | S12 and phase 3A | `tests/security/middleware-identity-headers.test.ts`, `tests/db/phase3a-auth-isolation.db.test.ts` | PASS for those paths. |
| List, open-by-id, customer update, item delete, invoice create across two businesses | Phase 3A, rerun in Phase 3B | `tests/db/phase3a-auth-isolation.db.test.ts` | Phase 3A: 10 passed, four list routes FAIL. Phase 3B rerun: 11 passed. |
| `POST /api/cron/process-campaigns` secret | Phase 3A | `tests/security/cron-auth.test.ts` | PASS for that route. Other middleware-public handlers are NOT TESTED. |
| Dashboard, credit-note, expense, estimate, sales-order, debit-note, journal, and two report GETs | Phase 3C, rerun in Phase 3D | `tests/db/phase3c-identity-fallback.db.test.ts` | Phase 3C: seven dashboard GETs FAIL. Phase 3D rerun: 8 passed. Other named GETs still did not return the other business's marker when the caller was user A. |
| Top products, receivables, cash flow, credit notes, expenses, debit notes, estimates, sales orders, customers | Phase 3E, rerun in Phase 3F | `tests/db/phase3e-identity-fallback.db.test.ts` | Phase 3E: 2 passed, 1 failed. Phase 3F rerun: 5 passed. |
| POST credit notes, expenses, debit notes, estimates, sales orders, customers | Phase 3G, rerun in Phase 3H | `tests/db/phase3g-write-identity.db.test.ts` | Phase 3G: 4 passed, 2 failed. Phase 3H rerun: 9 passed. |
| POST suppliers, items, purchase orders, inventory adjustments, and PUT customers | Phase 3I, rerun in Phase 3J | `tests/db/phase3i-write-identity.db.test.ts` | Phase 3I: 4 passed, 2 failed. Phase 3J rerun: 10 passed. |
| POST stock transfers, purchase returns, purchases, payments, journal entries, and recurring invoices | Phase 3K, rerun in Phase 3L | `tests/db/phase3k-write-identity.db.test.ts` | Phase 3K: 7 passed, 2 failed. Phase 3L rerun: 9 passed. |
| Live HTTP for the GET and write routes named in the Phase 3M file | Phase 3M | `node tests/live/phase3m-http.mjs` | PASS. 109 checks, exit 0. `kh_phase2_test` on loopback port 5433. Handlers were reached through HTTP. |
| Live HTTP for purchase orders, stock transfers, purchase returns, recurring invoices, inventory adjustments, suppliers, purchases, payments, and journal entries | Phase 3N, rerun in Phase 3O | `node tests/live/phase3n-http.mjs` | Phase 3N: 43 passed, 6 failed. Phase 3O rerun: 49 passed, exit 0. The original failures stay in `phase-3n-live-http-security-results.md`. |
| Live HTTP for the four Phase 3N failures | Phase 3O | `node tests/live/phase3o-http.mjs` | PASS. 19 checks, exit 0. `kh_phase2_test` on loopback port 5433. |
| POST stock transfers, purchase returns, purchases, payments, journal entries, and recurring invoices | Phase 3O rerun | `npx jest tests/db/phase3k-write-identity.db.test.ts --runInBand --forceExit` | 9 passed. Handlers were called from Jest. |
| Live lists, creates, transfer dispatch and receipt, purchase-return cancel, and recurring `run_now` | Phase 3P, rerun in Phase 3Q | `node tests/live/phase3p-http.mjs` | Phase 3P: 44 passed, 1 not tested, exit 0. The run date FAIL stays in that file. Phase 3Q rerun: 45 passed, exit 0. Persisted `invoice_date` was `2026-10-19`. |
| Stored purchase-order totals, purchase-return stock and ledger, transfer quantities, and generated invoice date | Phase 3P functional follow-up | `node tests/live/phase3p-functional.mjs` | PASS. 14 passed, 1 not tested, exit 0. `127.0.0.1:3112` on `kh_phase2_test`. The return location went from 0 to `-2` and back to 0. Purchase-order search and pagination stay NOT TESTED. |
| Account create, parent change, delete, opening balance, journal to a grandchild and a liability child | Chart of Accounts hierarchy audit | `tests/db/account-hierarchy-integrity.db.test.ts` | PASS. First run: 5 passed. Follow-up: 6 passed, including the trial-balance handler and a capital child. Dialog follow-up: 7 passed, including two creates of the same code (HTTP 201 and HTTP 409, one row). Dialog regression: 9 passed. My Accounts regression: the same file passed inside 6 suites, 46 passed. The two added tests reject a missing or blank code and a failed create with no leftover account or opening voucher, and a name-only edit leaves the opening voucher at two lines. Handlers were called from Jest, not through middleware. |
| `GET /api/reports/trial-balance` and `GET /api/reports/balance-sheet` | Same audit, live HTTP | `node tests/live/coa-reports-http.mjs` | PASS. First run: 30 checks. Rerun after session revocation: 32 checks, exit 0. `127.0.0.1:3121` on `kh_phase2_test`. No cookie and spoofed headers: HTTP 401. After `auth_session_version` was incremented, the same cookie got HTTP 401 `SESSION_REVOKED` on both reports. |
| Account hierarchy helpers, profit and loss, balance sheet assembly | Same audit | `tests/lib/accounting/account-hierarchy.test.ts`, `tests/lib/reports/profit-loss.test.ts`, `tests/lib/reports/balance-sheet.test.ts` | PASS. 7, 15, and 5 passed. Dialog regression rerun: the same 7, 15, and 5 passed. |
| Profit & Loss Excel rows and workbook | Same audit follow-up | `tests/lib/export/profit-loss-excel.test.ts` | PASS. 3 passed. Dialog regression rerun: 3 passed. GSTR Excel tests were not run. |
| Create account, nested sub-account, clear and reselect parent, tree search, 375px overflow | Same audit follow-up | `e2e/account-create-hierarchy.spec.ts` via `node tests/live/coa-hierarchy-e2e.mjs` | PASS on the earlier dialog run: 1 passed (1.6m), exit 0. Server `127.0.0.1:3119` on `kh_phase2_test`. `COA-E2E` businesses left: 0. My Accounts regression rerun of this spec together with `e2e/my-accounts.spec.ts`: FAIL. Two runs on 2026-10-20, both Playwright 2 failed, exit 1. Details in `account-hierarchy-audit-results.md`. |
| My Accounts visibility, pins, ancestor balance | Same audit | `tests/lib/accounting/my-accounts.test.ts` and the my-accounts case in `tests/db/account-hierarchy-integrity.db.test.ts` | PASS. 2026-10-20: 6 unit tests passed inside the 46-test Jest run above. Settled activity, ancestor with its own zero balance, manual pin, and removing one sibling while another account still needs the parent. |
| Security regressions already recorded for Phases 3A–3O and the report HTTP check | Repeatable command | `npm run test:qa:security-live` | PASS twice. First run exit 0 in 458 seconds. Second run exit 0 in 197 seconds. Fixture prefixes left at 0 both times. This does not pass the rest of the application. |
| `/login`, `/invoices/new`, `/customers/new`, `/items/new` on staging | Staging browser | `npx playwright test --config=playwright.staging.config.ts` after `STAGING_TEST_BUSINESS` is set | Partial. Empty invoice showed “Add items”. INV-072 showed CGST + SGST and 118.00. The list and side panel were not opened. Purchase and purchase return were BLOCKED after “Too many login attempts.” The corrected test was not run. |

All other routes and action labels stay NOT TESTED. Icon-only buttons, translated labels, and components deeper than one import were not in the Phase 1 scan (`audit-gaps.md`).

## Untested modules

The purchase, payment, stock-transfer, and recurring API calls named in `phase-3p-live-workflow-results.md` were executed. Their pages, credit and debit notes, inventory adjustments, GST reports, financial reports, HR, WhatsApp, store, admin, and partner portals still have no executed page scenarios in this project. Existing Jest and Playwright files on disk are not passes until a QA run records them.

## Security regression command

`npm run test:qa:security-live` runs `tests/live/run-security-regressions.mjs`. It refuses to start unless `current_database()` is `kh_phase2_test` on loopback port 5433. The suites run one after another. The runner prints each suite name, keeps that suite's output, and stops on the first non-zero exit. After each live suite it waits until that suite's port is free. At the end it counts leftover fixture businesses.

| Order | Suite | What it is |
| --- | --- | --- |
| 1 | `tests/security/middleware-identity-headers.test.ts` | Middleware strips spoofed identity headers. No database writes. |
| 2 | `tests/security/cron-auth.test.ts` | Cron secret check for one route. No database writes. |
| 3 | `tests/db/phase3a-auth-isolation.db.test.ts`, `phase3c-identity-fallback.db.test.ts`, `phase3e-identity-fallback.db.test.ts`, `phase3g-write-identity.db.test.ts`, `phase3i-write-identity.db.test.ts`, `phase3k-write-identity.db.test.ts` | Handler-level identity regressions. Each file checks the database before writes and deletes its fixtures. Jest runs them in one process, one file at a time. |
| 4 | `tests/live/phase3m-http.mjs` | Live HTTP on `127.0.0.1:3108`. Real login cookie. |
| 5 | `tests/live/phase3n-http.mjs` | Live HTTP on `127.0.0.1:3109`. |
| 6 | `tests/live/phase3o-http.mjs` | Live HTTP on `127.0.0.1:3110`. |
| 7 | `tests/live/coa-reports-http.mjs` | Trial balance and balance sheet live HTTP on `127.0.0.1:3121`. |

This command does not cover pages, a browser, staff users, a cancelled subscription, Phase 3P workflows, the rest of `tests/security`, or any route that those files do not call. A pass is not a pass of the application. Evidence for the runner is in `security-live-regression-results.md`.

## Next task

The Phase 3P functional follow-up is recorded in `phase-3p-live-workflow-results.md`. Purchase-order search and pagination stay NOT TESTED. Do not start another module until asked. The Chart of Accounts hierarchy audit in `account-hierarchy-audit-results.md` was a separate request and does not close this series.

| Remaining item | Status |
| --- | --- |
| Soft-delete list, permission, items screen, and deleted-records report | PASS for the checks in the invoice results file. Catalog item restore is NOT TESTED. |
| Phase 3A session isolation, read-only permission, and missing subscription | PASS for the operations named in `phase-3a-security-results.md`. |
| Phase 3A list handlers with query `user_id` and `business_id` and no session headers | Fixed in Phase 3B. Regression PASS. The original FAIL stays in the phase 3A file. |
| Phase 3C seven dashboard GET handlers | Fixed in Phase 3D. Regression PASS. The original FAIL stays in the phase 3C file. |
| Phase 3E nine GET handlers | Fixed in Phase 3F. Regression PASS. The original FAIL stays in the phase 3E file. |
| Phase 3G POST estimates, sales orders, customers, and expenses | Fixed in Phase 3H. Regression PASS. The original FAIL stays in the phase 3G file. |
| Phase 3G POST credit notes and debit notes | PASS for the requests in `phase-3g-write-identity-audit-results.md`. Those handlers were not changed in Phase 3H. |
| Phase 3I POST items, purchase orders, inventory adjustments, suppliers, and PUT customers | Fixed in Phase 3J. Regression PASS. The original FAIL stays in the phase 3I file. |
| Phase 3K POST stock transfers, purchase returns, and recurring item ids | Fixed in Phase 3L. Regression PASS. The original FAIL stays in the phase 3K file. |
| Phase 3K POST purchases, payments, and journal entries | PASS for the requests in `phase-3k-write-identity-audit-results.md`. Phase 3O live HTTP covers journal revocation. The original Phase 3K pass stays in that file. |
| Phase 3M live HTTP for the routes in `phase-3m-live-http-security-results.md` | PASS. 109 checks. Browser and the rest of the API stay NOT TESTED. |
| Phase 3N live HTTP | 43 passed, 6 failed. The failures stay in `phase-3n-live-http-security-results.md`. Phase 3O rerun: 49 passed. |
| Phase 3O live HTTP for the four handlers | PASS. 19 checks. Search text, pagination, and the unchanged methods on those routes stay NOT TESTED there. Phase 3P covers the ones that exist. |
| Phase 3P live workflows | 44 passed. Purchase-order search and pagination are NOT TESTED. The recurring run date FAIL stays in that file. Functional follow-up: 14 passed, 1 not tested. |
| Phase 3Q recurring calendar date | PASS. Persisted `invoice_date` is `2026-10-19`. `GET` and `PATCH` on the recurring id route, and the cron route, stay NOT TESTED. |
| Phase 3Q staging browser | Partial. Invoice generate reached INV-072. Reopen was not run. Purchase, stock, and purchase return stay BLOCKED until staging login is allowed again. INV-072 and `P3QB` parties and items are still on Shalini Traders. |
| Other middleware-public handlers | NOT TESTED, except `POST /api/cron/process-campaigns`. |

## Rules for the next edit

Read this file first. Mutating tests use only local `kh_phase2_test` after `current_database()` confirms it. Do not deploy. Do not treat this index as a test run.
