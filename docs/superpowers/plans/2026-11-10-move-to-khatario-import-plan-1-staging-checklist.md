# Move to Khatario import, plan 1: staging checklist

Apply migration 470 on staging (owner approval) before deploying the code.

Migration 470 creates `import_runs`, `import_run_records`, `import_column_matches` and `import_run_problems`, and adds `preview_ready` and `preview_problems` to `import_runs`. It has been applied only to the disposable `kh_phase2_test` database. Nothing is pushed; the build is on `main` locally.

Steps run in a browser on `https://staging.khatario.com`. The import pages are `/import/customers`, `/import/suppliers` and `/import/items`. Use real export files supplied by the owner where a step says so.

## Steps

1. Open `/customers` as an owner. Expected: an Import button is visible; it opens `/import/customers`. Repeat on `/suppliers` and `/items` (`/import/suppliers`, `/import/items`).
2. Import a Tally ledger export (real file from the owner) on `/import/customers`. Expected: columns are matched with the Tally preset, the Preview step shows counts for ready, needs attention and already exists, and after Import the customers appear in the list with the right names, GSTIN, state and phone.
3. Import a Vyapar party export (real file) on `/import/suppliers`. Expected: columns matched with the Vyapar preset; suppliers appear in the list after import.
4. Import a Zoho Books item export (real file) on `/import/items`. Expected: columns matched with the Zoho Books preset; items appear in the list with the right rates and tax.
5. Upload a file with title lines above the header row. Expected: the header row is found automatically and the title lines are ignored; row numbers shown match the user's own sheet.
6. Upload a file with one bad GSTIN and one phone number repeated on two rows. Expected: the preview counts show the bad-GSTIN row under needs attention and the repeated phone row marked "Same as row N"; the counts add up to the data rows in the file.
7. On the items import, upload a file with a unit value Khatario does not know. Expected: the screen asks to choose a unit for that value once; after choosing, every row with that value uses it.
8. On the Preview step, click "Download problem rows". Expected: a file downloads with the full list of problem rows (every one, not a sample), each with its row number and reason.
9. Mark a column "Don't import", finish the import, then upload the same file again. Expected: that column is already set to "Don't import" (the saved choice is remembered).
10. Start an import of a large file (several hundred rows or more) and close the tab part-way. Reopen the import page and open history. Expected: the run shows as paused with a Resume option; Resume continues from where it stopped and finishes without duplicates.
11. Take an interrupted (paused) run and Undo it instead of resuming. Expected: the records saved so far are removed and the run shows as undone.
12. Import customers, invoice one of them, then Undo the run. Expected: the invoiced customer is kept, the others are removed, the run shows as partly undone and says which record was kept and why.
13. Upload a file larger than 10 MB. Expected: the message "This file is larger than 10 MB." and no run is created.
14. Add a customer with phone saved with a leading 0 (for example 09876543210), then import a file with the same person as 9876543210. Expected: the row is shown as already existing, not created again.
15. Sign in as a staff user without create permission for customers, suppliers and items. Expected: no Import button on the three list pages. Opening `/import/customers` directly does not allow an import (the API refuses).
16. Import the old item CSV file (the one the previous item import accepted) through `/import/items`. Expected: it imports through the new screen with the same results as before, including opening stock.

## Known gaps

- App presets and the export instructions for Tally, Vyapar and Zoho Books are unverified against real exports; steps 2 to 4 are the first real test of them.
- The import page titles in `e2e/routes.json`, `lib/breadcrumb-utils.ts` and `lib/mobile-route-title.ts` are edited but uncommitted. Those files also hold another session's uncommitted Schedule III work, so they were not staged. Until they are committed, the staging build will show default titles and breadcrumbs on the import pages.
- Nothing was checked in a browser. Every step above is the first browser run of this feature.
