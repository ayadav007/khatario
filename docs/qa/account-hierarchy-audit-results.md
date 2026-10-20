# Chart of Accounts hierarchy audit

User-requested accounting check of account creation, parent links, opening balances, and report totals. The identity-audit series is unchanged. No application code, schema, or UI was changed.

## Database

`tests/db/account-hierarchy-integrity.db.test.ts` stops unless `current_database()` is `kh_phase2_test`, the port is 5433, and the server address is loopback. The suite passed, so that guard passed. After the run, businesses named `COA-H %` on that database: 0. The suite deletes only the two businesses it inserts, including their ledger lines, through `withLedgerDelete`.

## Commands

`npx jest tests/db/account-hierarchy-integrity.db.test.ts tests/lib/accounting/account-hierarchy.test.ts tests/lib/reports/profit-loss.test.ts tests/lib/reports/balance-sheet.test.ts --runInBand --forceExit`

Result: 4 suites, 32 passed. `authorize` was not stubbed. Account, journal, and delete handlers were called from Jest. A live Next.js server was not started. `middleware()` was not called.

`tests/db/account-hierarchy-integrity.db.test.ts`: 5 passed.

- An expense with nature `credit`, and an expense placed in asset group `1100`, both returned HTTP 400 (`INVALID_NATURE`, `ACCOUNT_TYPE_GROUP_MISMATCH`). Business A's account count did not change. Seeded account `1202` remained nature `credit`.
- Expense parent, child, and grandchild. A journal of 100 posted only to the grandchild. The parent and child had no journal line. Ledger debits equalled credits. Profit & Loss operating expense was 100, the grandchild's own amount was 100, the parent's own amount was 0, and the parent's display total was 100. Net profit was -100. The balance sheet assembled from those ledger rows was balanced. An income account then received 40; operating income was 40, operating expense stayed 100, and net profit was -60.
- Setting the parent's parent to the grandchild while the child still hung under the parent returned HTTP 400 `PARENT_CYCLE`. The parent stayed a root. A liability parent and child, with 30 posted only to the child, left the balance sheet balanced. Moving the expense child to another expense account returned HTTP 200. Self-parent returned HTTP 400 `PARENT_SELF`. Pointing the new parent back at the grandchild returned HTTP 400 `PARENT_CYCLE`. An asset under the expense parent returned HTTP 400 `PARENT_TYPE_MISMATCH`. Clearing the grandchild's parent returned HTTP 200, the parent id became null, and the grandchild still had its one ledger line. Patching nature returned HTTP 400 `FIELD_NOT_EDITABLE`.
- A zero opening balance created no `opening_balance` lines. A debit opening balance of 50 created two lines (the account debit 50 and the contra credit 50). Saving the same values again left two lines. Changing it to a credit of 25 replaced those lines: the account line was credit 25 and debit 0, still two lines. Business-wide ledger debits equalled credits.
- Deleting a parent that has a child and no ledger lines returned HTTP 400 `ACCOUNT_HAS_CHILDREN`. The child still pointed at the parent. After a 15 journal on that parent, delete returned HTTP 200, the parent was inactive, the child still pointed at it, and the parent's ledger line remained.
- Session for business A with body `business_id` and `created_by` of business B returned HTTP 401 or 403. B's account count did not change. A parent id from B returned HTTP 400 `PARENT_NOT_FOUND` and A's count did not change. Patch and delete of B's cash account `1101` returned HTTP 404. The name stayed unchanged and the account still existed.

`tests/lib/accounting/account-hierarchy.test.ts`: 7 passed. Code suggestion, display path, parent type, cycles, nature, and opening-balance parsing.

`tests/lib/reports/profit-loss.test.ts`: 15 passed. Includes nesting a child under its parent and refusing to nest a child whose section differs.

`tests/lib/reports/balance-sheet.test.ts`: 5 passed.

## Follow-up verification

`npx jest tests/db/account-hierarchy-integrity.db.test.ts tests/lib/export/profit-loss-excel.test.ts --runInBand --forceExit`

Result: 2 suites, 9 passed. Database: `kh_phase2_test`, port 5433, loopback. The suite still deletes only the two `COA-H` businesses it creates.

`tests/db/account-hierarchy-integrity.db.test.ts`: 6 passed. The new test calls `GET` from `app/api/reports/trial-balance/route.ts` with the session headers. It does not go through `middleware()` or a running Next.js server.

Observed on that response:

- HTTP 200. Body has `accounts`, `totals.total_debit`, `totals.total_credit`, and `is_balanced`.
- `is_balanced` was true. Debit and credit totals matched.
- The expense child appeared once, debit 80, credit 0. Its parent appeared once, debit 0, credit 0.
- The capital child appeared once, credit 70, debit 0. Its parent appeared once, debit 0, credit 0. The parent had no journal line. The child had one credit of 70. The journal was Dr cash 70, Cr the capital child 70.
- An asset opening debit of 20 appeared once as debit 20. The response field `opening_balance` was 0, which is how this route reports opening vouchers: the amount is inside the debit and credit columns.
- A query `business_id` for business B, while the session headers were business A, returned HTTP 200 and A's child code. B's marker code was absent. The handler uses the session business when that header is present. An unauthenticated live request was not sent. Middleware rejects those with HTTP 401 before this handler.
- A capital account with nature `debit` returned HTTP 400 `INVALID_NATURE`.
- `assembleBalanceSheet` showed the capital child at 70, the capital parent at 0, and `is_balanced` true. `GET /api/reports/balance-sheet` was not called.

`tests/lib/export/profit-loss-excel.test.ts`: 3 passed. The row order includes Operating Income, Sales, Gross Profit, Operating Expense, Rent, Godown rent at indent 2, Total for Rent 1500, inactive Old, Operating Profit, and Net Profit/Loss. The periodic schedule amounts are 1000, 4000, and -1500. The workbook sheet `Profit and Loss` has business name Shalini Traders, Net Profit/Loss 4250, and Old (Inactive) 50. No export code was changed.

`node tests/live/coa-hierarchy-e2e.mjs`

The script refuses any database other than `kh_phase2_test` on loopback port 5433. It starts `next dev` on `127.0.0.1:3119` with that database and creates one `COA-E2E` business and user. Playwright is pointed at that URL only for this command. `playwright.config.ts` was not changed. `.env` still has the staging base URL, and that value was not used.

Final result: 1 passed (1.5m). Playwright exit 0. After the run, businesses named `COA-E2E %`: 0.

The passing run created a top-level expense, created a nested child, showed the parent path with the parent name and an arrow, cleared the parent, selected it again, and showed the child in the tree search with the Sub-account label. The 375px check found no horizontal overflow. The spec deletes the two accounts it creates. The script then deletes the business.

Earlier attempts of the same command exited 1. One stayed on the create form while the dev server was still compiling. One reached the second edit and could not click the parent field because the schedule rail covered it. One did not get past the login button. Those are not passes. The spec now hides the schedule rail when that button is visible, then continues with the same assertions. No account, report, or posting code was changed.

## Live HTTP

`node tests/live/coa-reports-http.mjs`

The script confirmed `current_database()` is `kh_phase2_test` on loopback port 5433 before inserting anything. It started `next dev` on `127.0.0.1:3121` with that database. Requests were `fetch` to that origin. No route handler was imported. `playwright.config.ts` was not changed.

Result: `SUMMARY pass=30 fail=0`. Exit code 0.

Middleware evidence: a request with no cookie returned HTTP 401 `UNAUTHENTICATED` for both reports. The same request with `x-authenticated-user-id`, `x-authenticated-business-id`, and `x-authenticated-session-version` set to business B also returned HTTP 401. Those codes are produced by middleware before the handler.

Signed-in session for business A, with `business_id` of business B in the query and a spoofed business header:

- `GET /api/reports/trial-balance` HTTP 200. `accounts`, `totals.total_debit`, `totals.total_credit`, and `is_balanced` were present. Totals were debit 100 and credit 100. `is_balanced` was true.
- The expense child appeared once at debit 80. Its parent appeared once at 0.
- The capital child appeared once at credit 70. Its parent appeared once at 0.
- The opening-balance asset appeared once at debit 20, and its `opening_balance` field was 0.
- Business B's marker code was absent. The same figures were on `ledger_entry_lines` for business A.
- `GET /api/reports/balance-sheet` HTTP 200. The body had `assets`, `liabilities`, `equity.capital`, and `is_balanced`. Difference was 0. The capital child balance was 70. The capital parent was not given that balance again. The capital section total equalled the sum of its account lines. The opening asset was present. Business B's marker was absent.

A journal whose body named business B returned HTTP 403 and wrote no ledger line. The accepted journals named no other business.

After the run, businesses named `COA-RPT %`: 0. Ledger lines for the two fixture business ids: 0.

## Session revocation

The same command was run again after the script incremented `users.auth_session_version` for the signed-in user and repeated both GETs with the original cookie. No new server port and no application change.

Result: `SUMMARY pass=32 fail=0`. Exit code 0. Database and server were the same: `kh_phase2_test`, loopback port 5433, `http://127.0.0.1:3121`.

Before the increment, both reports returned HTTP 200 for that cookie. After it:

- `GET /api/reports/trial-balance` returned HTTP 401 `SESSION_REVOKED`.
- `GET /api/reports/balance-sheet` returned HTTP 401 `SESSION_REVOKED`.

Neither body contained the fixture account codes or a report payload. `authorize` calls `assertSessionValidForCookieAuth`, which compares the session generation on the middleware header with `users.auth_session_version`. The report queries run only after that check.

Cleanup on that run: businesses named `COA-RPT %`: 0. Ledger lines for the fixture business ids: 0.

## Simplified account dialog

The create and edit screens now use one searchable group tree. Nature and the Profit & Loss section are derived and are not fields on the form. The parent picker appears only when "Make this a sub-account" is checked. A blank account code sends the existing suggestion. Opening-balance posting was not rewritten. No migration.

`npx jest tests/db/account-hierarchy-integrity.db.test.ts tests/lib/accounting/account-hierarchy.test.ts --runInBand --forceExit`

Result: 2 suites, 14 passed. Database guard: `kh_phase2_test`, port 5433, loopback. The database suite is now 7 tests. The added test sends two creates with the same code at once. One returned HTTP 201 and the other HTTP 409 from unique constraint `accounts_business_id_account_code_key`. One row remained. The earlier six tests in that file, including trial balance, nested capital, and balance-sheet assembly, passed again. Profit & Loss and balance-sheet unit files were not rerun; those modules were not edited.

`node tests/live/coa-hierarchy-e2e.mjs`

A first run exited before Playwright because `app/(app)/accounts/page.tsx` did not parse, so the account POST returned HTTP 500. After that syntax fix, one run failed on `waitForURL` while the chart was already visible. The next run waited with `toHaveURL` and passed (1.7m) from `/accounts/new`. The create step was then moved into the Add Account dialog.

Result of that dialog run: Playwright 1 passed (1.6m), exit 0. Server `http://127.0.0.1:3119`. Database `kh_phase2_test`, loopback port 5433. The test opened Add Account on the chart, searched Indirect Expenses, saved a top-level expense with a typed code, then created a sub-account from `/accounts/new`, cleared the parent, set it again, and found "Sub-account" in the tree. The 375px page did not overflow. `COA-E2E` businesses left: 0.

## Dialog regression

No application code was changed. Two tests were added to `tests/db/account-hierarchy-integrity.db.test.ts`.

`npx jest tests/db/account-hierarchy-integrity.db.test.ts tests/lib/accounting/account-hierarchy.test.ts tests/lib/reports/profit-loss.test.ts tests/lib/reports/balance-sheet.test.ts tests/lib/export/profit-loss-excel.test.ts --runInBand --forceExit`

Result: 5 suites, 39 passed. Exit code 0. The database suite stops unless `current_database()` is `kh_phase2_test` on loopback port 5433, and that suite passed, so the guard passed. Handlers were called from Jest. `middleware()` was not called. A Next.js server was not started. The concurrent-code case logged unique constraint `accounts_business_id_account_code_key` and still returned HTTP 409 with one row.

`tests/db/account-hierarchy-integrity.db.test.ts`: 9 passed.

- Opening balance: zero created no `opening_balance` lines. A debit of 50 created two lines. Saving 50 again left two lines. Changing to a credit of 25 replaced those lines. A later name-only patch left those two lines and the stored opening amount at 40 on a separate account.
- Empty or missing `account_code`, with opening amount 40, returned HTTP 400. An expense in asset group `1100` with opening 40 returned HTTP 400 `ACCOUNT_TYPE_GROUP_MISMATCH`. A parent from the other business with opening 40 returned HTTP 400 `PARENT_NOT_FOUND`. Account count was unchanged. No account row used the rejected codes. The opening-line count was unchanged.
- Seeded `1202` stayed nature `credit`. A capital account with nature `debit` returned HTTP 400 `INVALID_NATURE`. Cycles, self-parent, and a parent of another type returned HTTP 400.
- Two creates of the same code returned HTTP 201 and HTTP 409. One row remained.
- Trial-balance handler: child expense once, child capital once, parent amounts 0. `assembleBalanceSheet` stayed balanced. This call did not go through middleware.

`tests/lib/accounting/account-hierarchy.test.ts`: 7 passed.

`tests/lib/reports/profit-loss.test.ts`: 15 passed.

`tests/lib/reports/balance-sheet.test.ts`: 5 passed.

`tests/lib/export/profit-loss-excel.test.ts`: 3 passed.

Not executed in this regression: `node tests/live/coa-hierarchy-e2e.mjs`, `node tests/live/coa-reports-http.mjs`, and the GSTR Excel suites. Their earlier results stay in the sections above. A blank code is rejected by the API; the dialog fills a suggested code before save, and that browser path was not rerun here.

## My Accounts regression

No migration. Manual pins are stored in the existing `business_settings.settings` key `my_account_ids`. Opening My Accounts does not update `accounts` or `ledger_entry_lines`. Report modules were not edited in this pass.

`npx jest tests/db/account-hierarchy-integrity.db.test.ts tests/lib/accounting/account-hierarchy.test.ts tests/lib/accounting/my-accounts.test.ts tests/lib/reports/profit-loss.test.ts tests/lib/reports/balance-sheet.test.ts tests/lib/export/profit-loss-excel.test.ts --runInBand --forceExit`

Result: 6 suites, 46 passed. Exit code 0. The database suite stops unless `current_database()` is `kh_phase2_test` on loopback port 5433, and that suite passed, so the guard passed. Handlers were called from Jest. `middleware()` was not called. A Next.js server was not started. The concurrent-code case logged unique constraint `accounts_business_id_account_code_key` and still passed.

Verified in that run:

- A child with two posted journals that net to zero stays visible with reason `activity` and balance 0. Its parent stays visible as `ancestor` with balance 0 and `has_activity` false. The parent's debit and credit are not the child's.
- An account whose `opening_balance` column was set to 99, with zero ledger lines, is absent.
- Pinning that idle account shows it as `manual` with zero ledger lines. Clearing the pin hides it. The child with lines remains. Another JSON key on `business_settings` stays. A foreign business account id returns HTTP 400 `ACCOUNT_NOT_FOUND`.
- Ancestor groups `5200` and `5000` are included.
- The pure resolver keeps a parent when one unused sibling is removed from the manual list and another account under that parent still has lines. The remaining account's balance stays its own.

`tests/lib/accounting/my-accounts.test.ts`: 6 passed, including that sibling case.

`tests/lib/accounting/account-hierarchy.test.ts`: 7 passed. `tests/lib/reports/profit-loss.test.ts`: 15 passed. `tests/lib/reports/balance-sheet.test.ts`: 5 passed. `tests/lib/export/profit-loss-excel.test.ts`: 3 passed. `tests/db/account-hierarchy-integrity.db.test.ts` passed as part of the 46.

Draft invoices return before stock and voucher posting (`lib/invoices/invoice-create-service.ts`). That path was read, not executed. A cancelled voucher deletes its ledger lines through the existing delete path; this regression did not post a draft invoice or cancel a voucher and then reload My Accounts. An account with no lines is what the tests treat as not posted.

`node tests/live/coa-hierarchy-e2e.mjs`

Database `kh_phase2_test`, loopback port 5433. Server `http://127.0.0.1:3119`. Two runs on 2026-10-20. Both exited 1. `COA-E2E` businesses left: 0. Playwright: 2 failed, 0 passed, each run.

First run: the hierarchy spec stayed on `http://127.0.0.1:3119/accounts/new` for 30 seconds while the failure snapshot already showed Chart of Accounts. The My Accounts spec showed the child `Dr ₹15.00`, the parent with no posted entries, and collapse/expand of that parent. The Add Accounts dialog was not in the snapshot when "Already shown" was asserted.

Second run: the hierarchy spec's Save click left the Add account form up, and the snapshot said "Choose an account type to see the next free code." The My Accounts spec passed the "Already shown" disabled checkbox, then the next Add Accounts dialog did not contain the idle-account checkbox when the check timed out. The failure snapshot showed the chart and no dialog.

These two runs do not confirm a ledger or report defect. They also do not pass the browser checklist. `node tests/live/coa-reports-http.mjs` was not rerun. GSTR Excel suites were not run.
