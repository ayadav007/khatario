# Move to Khatario: import by section

Date: 2026-11-10
Status: design, awaiting owner review. Nothing built.

## 1. Purpose

A business leaving another accounting app (Tally, Vyapar, Zoho Books, Busy, any other) can start in Khatario without retyping its books. It brings in its accounts, customers, suppliers, items, opening balances, opening stock and unpaid bills, and its new invoices carry on from the old number series.

Success means: after the last step, Khatario's opening trial balance equals the old app's closing trial balance on the cut-over date, receivables and payables are listed bill by bill, and no sales, GST or stock report shows anything for the period before the cut-over.

## 2. Decisions the owner made

| Question | Decision |
| --- | --- |
| How much to bring in | Masters and opening figures only. No past invoices, purchases, receipts or payments. |
| Cut-over date | Any date, not only the start of a financial year. |
| Who runs it | The business itself, in guided screens, with a preview before anything is saved. |
| Which businesses may import opening figures | Only a business with no transactions yet. |
| One feature per source app, or one import | One import, organised per section (Import button on each list page). No per-app code. |
| How files from different apps are read | The user uploads the app's own Excel or CSV export and matches columns; app choices are saved column matches. |
| How unpaid bills arrive | As opening bills with their own records, one per bill. |
| Invoice numbers | Old bills keep their numbers; new invoices continue the old series or start a new prefix; duplicates are refused. |

## 3. Not included

- Past vouchers of any kind (a possible later section).
- A Tally XML reader (possible later, for the Accounts section, if Tally's Excel exports lose too much).
- Custom fields for unmatched columns. Khatario's custom fields accept only `item` and `invoice` (`app/api/custom-fields/route.ts`), so unmatched customer and supplier columns are not imported.
- E-invoice, GST portal or bank connections.
- The phone app. Import is a website feature.

## 4. What the business sees

### 4.1 Sections

| Section | Where the Import button is | Opening figure it can carry |
| --- | --- | --- |
| Accounts | Accounts list | Opening balance per account |
| Customers | Customers list | On-account opening balance |
| Suppliers | Suppliers list | On-account opening balance |
| Items | Items list (replaces today's import) | Opening stock quantity and rate |
| Unpaid sales bills | Invoices list | The bills themselves |
| Unpaid purchase bills | Purchases list | The bills themselves |

### 4.2 The four steps, the same for every section

1. **Upload.** Excel (`.xlsx`) or CSV, up to 10,000 data rows. A "Coming from" choice (Tally, Vyapar, Zoho Books, Other) preloads column matches and shows how to export this list from that app.
2. **Match columns.** One row per column in the file: the column name, the first three values, and a dropdown of Khatario fields. Matches are guessed (section 6.2). Unmatched columns default to "Don't import".
3. **Preview.** Counts of rows that are ready, need attention, or already exist. Values that could not be matched to a Khatario list (unit, state, tax rate, account group) are listed once each with a dropdown; the choice applies to every row. Problem rows can be downloaded as a sheet with a Reason column.
4. **Import.** Ready rows are saved with a progress bar. The result appears in Import history with an Undo button.

### 4.3 Move to Khatario page

Under Settings. It holds:

- the cut-over date (asked once, editable until the first opening figure is imported);
- the sections in working order with a tick and counts for each: Accounts, Customers and Suppliers, Items, Unpaid bills;
- the invoice numbering step (section 8);
- the trial balance check (section 9);
- Import history, with Undo.

The page is a guide. Every section can also be reached from its own list page.

## 5. Rules

1. **Existing records are never overwritten.** A row that matches an existing record is reported as "already exists" and skipped. Match keys, first hit wins:
   - customers and suppliers: GSTIN, then phone, then name (case and spacing ignored);
   - items: code, then barcode, then name;
   - accounts: account code, then name;
   - opening bills: party plus bill number.
2. **Opening figures need a fresh business.** A business is fresh while `ledger_entry_lines` holds no line for it other than voucher types `opening_balance`, `opening_bill` and the item opening-stock voucher. Once it is not fresh, columns matched to opening balance or opening stock are refused at the preview, and the two unpaid-bill sections are closed. Importing customers, suppliers, items and accounts without opening figures stays available.
3. **Cut-over date.** All opening entries are dated the day before the cut-over date. Opening bills keep their own bill date and due date for ageing.
4. **Control accounts are fed by their own sections, never by the Accounts import.** The Accounts import refuses an opening balance on:
   - Accounts Receivable and every account under it (comes from customers and unpaid sales bills);
   - Accounts Payable (comes from suppliers and unpaid purchase bills);
   - the inventory account (comes from item opening stock);
   - bank ledgers linked to a bank account (comes from the bank account's own opening balance);
   - Opening Balance Adjustment (the balancing account).
   The preview names the section to use instead.
5. **A party's opening position is its opening bills plus its on-account figure.** If a customer sheet gives a balance and bills are later imported for that customer, the preview of the bills shows the stated balance, the bill total and the difference, and asks: keep the difference as on-account, or drop it.
6. **Undo** deletes what one import created and reverses its ledger entries. It is refused, per record, when the record has been used since (a party with an invoice, an item on a document, an opening bill with a receipt). The screen lists what was removed and what was kept, with the reason.
7. **Plan limits.** An import that would exceed the plan's item or customer limit stops at the preview (as `app/api/items/import/route.ts` does today).
8. **Permissions.** A section's import needs that module's `create` permission. Opening figures, cut-over date, numbering and Undo need the `settings` `update` permission as well.

## 6. Shared import engine

### 6.1 Pieces

| Unit | Does | Depends on |
| --- | --- | --- |
| `lib/import/read-file.ts` | Turns an uploaded `.xlsx` or CSV into a header row and string rows. Formula cells are read as their text; nothing is evaluated. | `exceljs`, `csv-parse` (both already installed) |
| `lib/import/match-columns.ts` | Guesses the Khatario field for each column. Pure function. | section definitions, presets |
| `lib/import/parse-values.ts` | Reads amounts, dates, phone numbers, GSTINs, and matches list values (state, unit, tax rate). Pure functions. | none |
| `lib/import/sections/<name>.ts` | One file per section: its fields (label, required, type, default), known column names, row checks, duplicate key, `saveRow`, `undoRow`. | the record services in 6.4 |
| `lib/import/presets.ts` | Per source app and section: column-name lists and export instructions. Data only. | none |
| `lib/import/run.ts` | Creates a draft run, builds the preview, commits in batches of 200, records what was created, undoes. | all of the above, `import_runs` |
| `app/api/import/[section]/…` | `upload`, `preview`, `commit`, `undo`, `history`, `problem-rows` routes. Business and user always from the session. | `run.ts` |
| `components/import/ImportWizard.tsx` | The four steps, driven by a section definition sent from the server. | the routes |

A new section later is one file in `lib/import/sections/` plus an Import button.

### 6.2 Column guessing, in order

1. The business's saved match for this section and this exact header text (`import_column_matches`).
2. The chosen app's preset, then the general list of known names for each field ("Party Name", "Customer", "Ledger Name", "Name" → name).
3. The values: a column where at least 80% of non-empty values pass the GSTIN check is the GSTIN; the same for phone, PIN code, email and date.
4. Otherwise "Don't import".

Two columns may be matched to one amount field (separate Debit and Credit columns).

### 6.3 Reading values

- **Amounts:** "80,000.00 Dr", "80000 Cr", "-80000", "(80,000)", and separate debit/credit columns. Result: an amount and a side. A blank is zero.
- **Dates:** `DD-MM-YYYY`, `D/M/YY`, `D-Mon-YYYY`, `YYYY-MM-DD`, and Excel date cells. If any value in a column is ambiguous between day-first and month-first and none settles it, the preview asks once; the default is day-first.
- **List values:** matched ignoring case, spacing and punctuation, with aliases (state by name, two-letter code or GST state number; common unit spellings). Unmatched values go to the "choose once" list in the preview.
- **Defaults when no column is matched:** unit `PCS`, item type goods, state from the first two digits of a valid GSTIN, account type from the account group.
- **Required fields:** only the name for accounts, customers, suppliers and items; party, bill number, bill date and pending amount for opening bills. If a required field has no column, the import cannot leave step 2.

### 6.4 Saving through one code path

Creating a customer, supplier or item is written inside the route handlers today (`app/api/customers/route.ts`, the suppliers route, `app/api/items/import/route.ts`). Each is moved into a service function (`lib/customers/create-customer.ts`, `lib/suppliers/create-supplier.ts`, `lib/items/create-item.ts`) that both the existing route and the import call. Behaviour of the existing routes must not change; their current tests are the check.

Opening figures use the functions that exist: `setAccountOpeningBalance` and `setPartyOpeningBalance` (`lib/accounting/account-rules.ts`), `seedOpeningStockLayers` and `syncItemOpeningStockLedger` for stock. Each gains an optional entry date so the import can date entries the day before the cut-over; without it they behave as today.

### 6.5 Tables (one migration, next free number)

- `import_runs`: `id`, `business_id`, `section`, `source_app`, `file_name`, `status` (`draft`, `committing`, `done`, `undone`, `failed`), `column_matches` (JSON), `value_matches` (JSON), `draft_rows` (JSON, cleared when the run finishes), `counts` (JSON), `created_by`, timestamps.
- `import_run_records`: `run_id`, `business_id`, `record_table`, `record_id`, `row_number`. Undo reads this.
- `import_column_matches`: `business_id`, `section`, `header_text`, `field_key`; unique on the first three.
- `opening_bills`: section 7.
- `businesses.cutover_date` (nullable date).

The uploaded file itself is not stored. A draft older than 24 hours is deleted when the next import for that business starts, so no new cron job is needed.

## 7. Opening bills

### 7.1 Why a separate table

179 files read `invoices` and 89 read `purchases`. Storing old dues there with a marker would need a filter in each, and one miss would count old dues as sales or put them in GSTR-1. With a separate table, a screen that has not been taught about opening bills leaves them out, which is the safe failure.

### 7.2 Record

`opening_bills`: `id`, `business_id`, `kind` (`sales` or `purchase`), `customer_id` or `supplier_id`, `bill_number`, `bill_date`, `due_date` (nullable), `original_amount` (nullable), `pending_amount` (as at cut-over), `settled_amount`, `written_off_amount`, `notes`, `import_run_id`, `created_by`, timestamps. Unique on business, kind, party and bill number. No items, no tax, no stock.

### 7.3 Ledger

Each opening bill posts its own voucher, type `opening_bill`, voucher id the bill's id, dated the day before cut-over:

- sales: Dr the customer's receivable account, Cr Opening Balance Adjustment;
- purchase: Dr Opening Balance Adjustment, Cr Accounts Payable.

The party's existing `opening_balance` voucher then carries only the on-account part. This differs from what was described in conversation ("the bills post nothing; the party opening balance is their total"): the effect on the trial balance is identical, but ageing and statements in Khatario are built from ledger vouchers (`lib/reports/party-ledger-docs.ts`), so one voucher per bill makes each bill appear there with almost no new logic.

`customers.opening_balance` and `suppliers.opening_balance` keep holding the on-account figure only. Screens that show a party's "opening balance" show on-account plus opening bills.

### 7.4 Where they appear

| Screen | Change |
| --- | --- |
| Receivables and payables ageing | `fetchPartyLedgerDocs` joins `opening_bills` for voucher type `opening_bill`: party, bill number as reference, bill date, due date. Aged from the bill's due date, else its bill date. |
| Customer and supplier statement (`app/api/reports/party/statement`, `lib/khata/statements.ts`) | Opening bills listed individually before the first transaction. |
| Recording a receipt or payment | Opening bills offered for settlement beside invoices. The payment row uses `reference_type = 'opening_bill'`; `payments` already points to what it settles by type and id (see 14.3). `settled_amount` is updated in the same transaction. |
| Payment reminders (`lib/payment-reminder-checker.ts`) | Overdue opening sales bills are included, with bill number, date and pending amount. |
| Customer portal and store khata | Show opening bills in the dues list. View only; no invoice PDF. |
| Invoices and Purchases lists | A separate "Opening bills" tab. They are never mixed into the main list. |

### 7.5 Where they must not appear

Sales and purchase reports, profit and loss, balance-sheet income, GSTR-1, GSTR-3B, GSTR-2B matching, HSN summary, stock reports, dashboard sales and purchase figures, e-way bills, commission calculations. None of these read `opening_bills`; tests prove their output is unchanged by an import.

### 7.6 Actions on an opening bill

View; settle through a receipt or payment; write off or correct the pending amount with a required reason (posts the difference against Opening Balance Adjustment while the business is fresh, and as a normal write-off after that; logged in the activity log). No edit into an invoice, no tax-invoice print, no cancel.

## 8. Invoice numbering after the move

- Opening bills keep their original numbers and use no Khatario counter.
- The Move to Khatario page asks, per numbered series the business issues (tax invoice, retail invoice, credit note, others in `COUNTER_SERIES`), for the last number issued in the old app, and offers:
  - **continue the series** (default): the prefix is set from the old number and the counter to the next number, through `setNextDocumentNumber` in `lib/invoices/document-counter.ts`;
  - **start a new prefix**, counter at 1.
- The step is skipped when the cut-over date is the first day of a financial year.
- The duplicate-number check on saving an invoice also checks `opening_bills` of kind `sales`. The duplicate supplier-bill warning on a purchase also checks kind `purchase` for the same supplier.

## 9. Trial balance check

The last step shows Khatario's trial balance as at the day before cut-over. The business uploads the old app's trial balance through the same upload and column-matching steps (fields: account name, debit, credit), or types figures. Accounts are paired by the same matching used for the Accounts import; unpaired lines are listed on each side. The page shows the difference per account and the balance left in Opening Balance Adjustment, which is zero when everything has been brought in. The check stores nothing in the ledger; it is a comparison only.

## 10. Errors

- A file that cannot be read, has no header row, or exceeds 10,000 rows is refused at upload with the reason.
- A row that fails a check is never saved; ready rows are saved regardless.
- A batch that fails while saving rolls back that batch only; the run is marked `failed` with the last saved row, and can be resumed or undone.
- Two imports for the same business and section cannot commit at the same time (a lock on the run's business and section).
- All messages name the row number and column as they appear in the user's file.

## 11. Security

- `business_id` and the acting user come from the session on every route. No id from the file or the request body is trusted.
- Cell text beginning with `=`, `+`, `-` or `@` is stored as text, and the problem-rows download escapes it (`lib/csv-safe.ts`).
- Upload size limit 10 MB; only `.xlsx` and `.csv`.
- Import history is visible only to users with the section's read permission.

## 12. Testing

- **Unit (Jest):** column guessing against sample headers for each app; amount, date and list-value reading; duplicate keys; section row checks.
- **Database (`kh_phase2_test` only):** for each section, import, duplicate skip, undo, and refused undo after use; fresh-business rule; control-account refusal; opening bill vouchers; settlement of an opening bill; number continuation; duplicate invoice number refused against an opening bill.
- **Unchanged-figures tests:** sales report, profit and loss, GSTR-1 and stock summary return identical output before and after an opening-bill import.
- **Balance tests:** the trial balance is balanced after every section commit and after every undo.
- **Staging checklist:** the full journey with one real export file per app, written at the end of each plan.

## 13. Build order

Three plans, each usable when finished:

1. **Engine, with Customers, Suppliers and Items, no opening figures.** Service extraction (6.4), engine, wizard, presets, import history and undo. The existing item import moves onto it.
2. **Accounts and opening figures.** Accounts section, cut-over date, opening balances and opening stock dated the day before cut-over, control-account rule, invoice numbering step.
3. **Opening bills and the Move to Khatario page.** The `opening_bills` table, the two sections, the screens in 7.4, the trial balance check.

## 14. To verify while planning

These were not read in full during design. Each is checked at the start of the plan that depends on it, and the owner is told if one changes the design.

1. Plan 2: whether profit and loss counts an `opening_balance` voucher on an income or expense account dated inside the financial year as that year's movement. A mid-year cut-over depends on it; if not, the opening figures for income and expense accounts need their own voucher type that the report includes.
2. Plan 2: how the item opening-stock ledger entry is dated, and that it can take the cut-over date.
3. Plan 3: that `payments.reference_type` has no check constraint limiting its values, and how the receipt screen builds its list of bills to settle.
4. Plan 3: how `lib/khata/statements.ts` and the customer portal build their dues lists (ledger-based or from `invoices`).
5. Plan 1: the supplier create route, and whether supplier and customer create share checks that should be one service.
6. All plans: the app presets are written from each app's documented export layout and must be checked against real export files supplied by the owner.
