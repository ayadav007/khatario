# Move to Khatario import, plan 1: staging checklist

Apply migration 470 on staging (owner approval) before deploying the code.

Migration 470 creates `import_runs`, `import_run_records`, `import_column_matches` and `import_run_problems`, and adds `preview_ready`, `preview_problems` and `undo_cursor` to `import_runs`. It has been applied only to the disposable `kh_phase2_test` database. Nothing is pushed; the build is on `main` locally.

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
12. Import customers, invoice one of them, then Undo the run. Expected: the invoiced customer is kept, the others are removed, and the Done step says which record was kept and why. In history the run shows as Done (partly undone), not Undone. Known: the history's saved count stays at the original number, which can be higher than what remains.
13. Upload a file between 10 and 12 MB. Expected: the message "This file is larger than 10 MB." and no run is created. Optional: upload a file above 12 MB (nginx refuses it before the app) and record what appears.
14. Seed a customer whose phone is stored as 09876543210: the owner runs the insert directly in the staging database (the customer form may store the number differently, in which case note how it was stored). Then import a file with the same person as 9876543210 under another name. Expected: the row is shown as already existing (matched on phone), not created again.
15. Sign in as a staff user without create permission for customers, suppliers and items. Expected: no Import button on the three list pages. Open `/import/customers` directly: the page opens and refuses the import, either with the access-denied panel or, if the page lets the user through, with a refusal message on the Upload step after a file is chosen. Note the exact message shown. Then check with the owner that no import run and no customer was created.
16. Import the old item CSV file (the one the previous item import accepted, or the Template from `/items`) through `/import/items`. Expected: every column is matched (including category_name), the Done step shows the same saved count as the file's data rows, and one imported item's list entry shows the opening stock quantity from its row (for example the Template's first sample shows 10).
17. Import a customer file with phones and emails, Undo it, then import the same file again. Expected: every row is saved again (none fail with a duplicate phone or email). Then Undo once more and add one of those customers by hand from `/customers` with the same phone: it is created.
18. On the items import, upload a row whose HSN has more than 10 characters (for example 12345678901). Expected: the Preview shows it under Needs attention with ""HSN" is longer than 10 characters" (the column header from the file), not as Ready.
19. On the customers import, upload a row with GSTIN 27AAAPA1234A1ZT and State Karnataka. Expected: Needs attention with "This GSTIN is registered in Maharashtra (27). ..." at preview.
20. On the items import, upload rows with units "Nos", "Btl" and "Ctn". Expected: no unit choice is asked for; they import as NOS, BTL and CTN.
21. Import a file of more than 2,000 customers, then Undo it. Expected: while undoing, a line "Undoing… N removed" counts up; the undo finishes by itself and the run shows as Undone with every record removed.

## Known gaps

- App presets and the export instructions for Tally, Vyapar and Zoho Books are unverified against real exports; steps 2 to 4 are the first real test of them.
- The import page titles in `e2e/routes.json`, `lib/breadcrumb-utils.ts` and `lib/mobile-route-title.ts` are edited but uncommitted. Those files also hold another session's uncommitted Schedule III work, so they were not staged. Until they are committed, the staging build will show default titles and breadcrumbs on the import pages.
- Nothing was checked in a browser. Every step above is the first browser run of this feature.
- Undone customers and items still count against the plan limit until the owner decides on changing the shared limit count.
