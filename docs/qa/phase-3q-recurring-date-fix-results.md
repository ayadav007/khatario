# Phase 3Q — recurring invoice calendar date

The Phase 3P file is unchanged as the record of the defect. This file records the fix.

## Original defect

A recurring definition with `start_date` and `next_run_date` of `2026-10-19` produced a run date of `2026-10-18`. The handler's "today" was also `2026-10-19`. The successful invoice's `invoice_date` was not read in that run.

## Root cause

`start_date`, `next_run_date`, `end_date`, `last_run_date`, and `invoice_date` are PostgreSQL `DATE` columns. node-pg returns a `DATE` as a JavaScript `Date` at local midnight. `runRecurringInvoices` turned that value into a day with `toISOString()`. In a timezone ahead of UTC, local midnight is the previous UTC day. Recurrence math in `recurring-schedule.ts` already uses UTC calendar dates built from `YYYY-MM-DD` strings, so it was left as it is. Invoice creation stores the `invoice_date` string it is given.

## Fix

`runRecurringInvoices` now reads those dates with `calendarDateOnly` from `lib/closing-stock-period-lock.ts`. That helper keeps a `YYYY-MM-DD` string and uses the local year, month, and day of a `Date`. It does not pass a database `DATE` through UTC. Invoice numbering, GST, frequency, stock, ledger posting, and tenant checks were not changed.

## Unit tests

`npx jest tests/lib/invoices/recurring.test.ts tests/lib/invoices/calendar-date-tz.test.ts tests/lib/closing-stock-period-lock.test.ts --runInBand --forceExit`

3 suites passed, 15 tests passed, exit 0.

A node-pg-style local date of `2026-10-19` stays `2026-10-19`. The same check covers `2026-10-01`, `2026-01-01`, `2025-12-31`, and leap day `2024-02-29`, plus a date-only string. A definition due on `2026-10-19` produces that run date and a next run of `2026-11-19`. A second due check on the same day is empty. The timezone file was also run under `TZ=UTC` and `TZ=Asia/Kolkata`. Under UTC, `toISOString()` stays `2026-10-19`. Under Asia/Kolkata it becomes `2026-10-18`, and `calendarDateOnly` stays `2026-10-19` in both.

## Invoice creation regression

`npx jest tests/db/phase2a-invoice-s01-s08.db.test.ts --runInBand --forceExit`

11 passed, exit 0, on `kh_phase2_test`. One GET logged `Error calculating credit metrics` because a credit helper was undefined. That test still passed. It is not part of this date fix.

## Live HTTP

`node tests/live/phase3p-http.mjs`

Before fixture writes: `database kh_phase2_test loopback port 5433`. Server `next dev` on `127.0.0.1:3111`. Session from `POST /api/auth/login`. The business day was `2026-10-19`.

`SUMMARY pass=45 fail=0 blocked=0 not_tested=1`, exit 0. Fixture businesses were deleted and the server was stopped.

The date checks:

| Check | Result |
| --- | --- |
| Response `run_date` | `2026-10-19` |
| `invoices.invoice_date` read with `to_char` for that invoice id | `2026-10-19` |
| Definition `last_run_date` | `2026-10-19` |
| Definition `next_run_date` | `2026-11-19` |
| Second `run_now` | HTTP 200, `created` length 0, next run unchanged, the same invoice row still present |
| Other business's item | HTTP 400 prefixed `2026-10-19`, no invoice added |

Purchase-order search and pagination remain **NOT TESTED**. `GET` and `PATCH` on `/api/recurring-invoices/[id]`, and the cron route, were not called.
