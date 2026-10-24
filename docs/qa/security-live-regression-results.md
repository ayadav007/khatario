# Security live regression runner

`npm run test:qa:security-live`

The command is `node tests/live/run-security-regressions.mjs`. It checks `current_database()`, the loopback address, and port 5433 before any suite. Suites run one at a time. A non-zero exit stops the runner. Cookies, passwords, and the database URL are not printed.

## Suites

| Suite | Result of each run |
| --- | --- |
| Phase 3A middleware identity headers | 4 passed, exit 0 |
| Phase 3A cron authorization | 4 passed, exit 0 |
| Phase 3A, 3C, 3E, 3G, 3I, and 3K database files | 6 suites, 52 passed, exit 0 |
| `tests/live/phase3m-http.mjs` on `127.0.0.1:3108` | SUMMARY pass=109 fail=0, exit 0 |
| `tests/live/phase3n-http.mjs` on `127.0.0.1:3109` | SUMMARY pass=49 fail=0 blocked=0, exit 0 |
| `tests/live/phase3o-http.mjs` on `127.0.0.1:3110` | SUMMARY pass=19 fail=0, exit 0 |
| `tests/live/coa-reports-http.mjs` on `127.0.0.1:3121` | SUMMARY pass=32 fail=0, exit 0 |

## Repeat runs

| Run | Exit | Duration | Fixture businesses left |
| --- | --- | --- | --- |
| First | 0 | 458 seconds | P3A, P3C, P3E, P3G, P3I, P3K, P3M, P3N, P3O, and COA-RPT were all 0 |
| Second | 0 | 197 seconds | The same prefixes were all 0 |

The second run used the same command immediately after the first. No port was still open when the next live suite started. The chart-of-accounts script also printed `leftover COA-RPT businesses 0` and `leftover fixture ledger lines 0` on both runs.

## 2026-10-23 run (Scan & Add regression)

`npm run test:qa:security-live` on `kh_phase2_test`, loopback port 5433: **FAIL, stopped early.** Middleware 4 passed, cron 4 passed, database identity files 6 suites and 52 passed, Phase 3M `SUMMARY pass=108 fail=1`. The failure is `POST /api/expenses session A own records HTTP 400 IDEMPOTENCY_KEY_REQUIRED`: expenses have needed a retry key since `8468a49e`, and the script does not send one. The runner stopped there, so 3N, 3O and the report check did not run inside it.

Run separately afterwards, not as the runner: `node tests/live/phase3n-http.mjs` pass=49 fail=0, `node tests/live/phase3o-http.mjs` pass=19 fail=0, `node tests/live/coa-reports-http.mjs` pass=32 fail=0 with leftover COA-RPT businesses 0 and leftover ledger lines 0. The script fix is still open. Details in `scan-add-items-results.md`.

## 2026-10-24 run (after the item PATCH and app layout changes)

Same command, `kh_phase2_test`, port 5433: **FAIL, stopped early** at the same place. Middleware 4, cron 4, database identity files 52 passed; Phase 3M `pass=108 fail=1`, the expense script without a retry key. Run separately afterwards: 3N pass=49 fail=0, 3O pass=19 fail=0, reports pass=32 fail=0 with no leftovers. The script fix is still open.

## Not in this command

Pages, a browser, staff users, a cancelled subscription, and Phase 3P workflows are not in this command. The other files under `tests/security` are not in it. Suites that stub `authorize` are not in it. The account-hierarchy database test and the account-create browser test are not in it. A pass of this command does not pass the rest of the application.
