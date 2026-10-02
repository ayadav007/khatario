# Purchase Reports (by Vendor, by Item, Summary, Bill Details): Zoho Books vs Khatario

Run: 02-Oct-2026. Period: 01-Sep-2026 to 30-Sep-2026.
Zoho: Tandoor Studio (org 910361617), bills numbered `QA-PR-*`, items `QA-PR Widget` / `QA-PR Gadget`, vendors `QA-PR Vendor KA` (GSTIN 29AAACQ1234P1Z5) / `QA-PR Vendor MH` (27AAACQ5678R1ZH).
Khatario: the same scenario in `tests/db/purchase-reports-zoho-scenario.db.test.ts`, created through the real purchase, cancel and purchase-return routes on a disposable test database (the local dev database is behind on migrations; it lacks `purchase_returns.status` from migration 316).

## Scenario

Business in Karnataka. Widget ₹600 at 18%, Gadget ₹300 at 5%.

| Doc | Date | Vendor | Lines | Taxable | GST | Total | Status |
|---|---|---|---|---:|---:|---:|---|
| P1 | 04-Sep | KA (intra-state) | Widget 5 @ 600 less 10%, Gadget 10 @ 300 | 5,700 | 636 | 6,336 | open |
| P2 | 10-Sep | MH (inter-state) | Widget 3 @ 600 | 1,800 | 324 IGST | 2,124 | open, ₹1,000 paid 15-Sep |
| P3 | 18-Sep | KA | Widget 2 | 1,200 | 216 | 1,416 | open |
| P4 | 21-Sep | KA | Gadget 4 | 1,200 | 60 | 1,260 | **void / cancelled** |
| P5 | 28-Aug | MH | Widget 1 | 600 | 108 | 708 | outside the period |
| VC1 | 24-Sep | KA, against P1 | Widget 1 returned @ 540 | 540 | 97.20 | 637.20 | active |
| P6 | 19-Sep | KA | Widget 7 | 4,200 | 756 | 4,956 | **draft** (Khatario only) |

Notes on the Zoho side:

- Zoho rejects taxed bills from unregistered vendors ("Reverse charge should be applied…"), so both vendors were given checksum-valid test GSTINs.
- Zoho's API creates bills as open and refuses to move them back to draft (`This bill cannot be marked as draft`). P3 was meant to be a draft and stayed open, so it counts in both systems. The draft case is covered in Khatario only (P6).
- Report endpoints: `/api/v3/reports/purchasesbyvendors` and `purchasesbyitem` with `filter_by=TransactionDate.CustomDate`, `billdetails` with `BillDate.CustomDate`, `vendorcreditdetails` with `VendorCreditDate.CustomDate`.

## Results (QA-PR documents, September)

| Report | Zoho | Khatario (before) | Khatario (after) |
|---|---|---|---|
| By vendor — KA | 2 bills, 1 vendor credit, amount 6,360, with tax 7,114.80 | **500 error** on every request | 2 bills, 1 return, 6,360 / 7,114.80 (bills 6,900 less return 540) |
| By vendor — MH | 1 bill, 1,800 / 2,124 | 500 error | 1,800 / 2,124, paid 1,000, balance 1,124 |
| By item — Widget | qty 9, amount 5,160, avg 573.33 | no such report | qty 9 (10 billed − 1 returned), 5,160, avg 573.33 |
| By item — Gadget | qty 10, 3,000, avg 300 | no such report | qty 10, 3,000, avg 300 |
| Summary — total | (Zoho has no purchase summary; derived) 8,160 / 1,078.80 / 9,238.80 | gross 9,876 incl. GST, return ignored, draft counted | 8,160 / 1,078.80 / 9,238.80 |
| Summary — 24-Sep | vendor credit −540 / −97.20 / −637.20 | (no row) | −540 / −97.20 / −637.20 |
| Bill details | lists P1–P4 with status; void P4 listed with its total | drafts listed and counted in totals | lists every bill with status; totals 8,700 / 1,176 / 9,876 cover posted bills only |
| Tax-wise 18% | (GST views in Group 6) | included drafts, ignored returns, default branch only | taxable 5,160, IGST 324, total tax 928.80 |

Khatario's net purchases (8,160) equal the September net debit to the Inventory account for the branch, which the test asserts: goods bills capitalise their taxable value to stock and returns credit it back. The purchase reports reconcile to the ledger.

**Balance due differs in where it sits, not in amount.** Khatario applies a return against a bill straight to that bill (P1 balance 6,336 → 5,698.80). Zoho records the vendor credit as an open credit (637.20) and leaves P1 at 6,336 until it is applied. The vendor's net payable is 7,114.80 in both.

## Findings and fixes

1. **Supplier-wise report always failed.** `COALESCE(s.id, 'unknown')` casts `'unknown'` to UUID; Postgres rejects it before reading any rows (`invalid input syntax for type uuid: "unknown"`, reproduced on an empty result). Every request returned HTTP 500.
2. **Drafts counted as purchases.** Every purchase report filtered only `status != 'cancelled'`, so draft bills, which post nothing to the ledger, were included. All reports now share one definition of a posted bill: `status = 'final'`, not deleted.
3. **Purchase returns were ignored.** Zoho nets vendor credits in Purchases by Vendor and by Item, and so does the ledger. Vendor, item, summary and tax-wise reports now subtract active purchase returns by return date; item quantities subtract returned quantities; cancelled returns are excluded.
4. **"Purchases" included GST.** Supplier-wise and summary used `grand_total`. Zoho's "Amount" excludes tax. Khatario now reports Purchases (the bill's taxable value, `subtotal`, which is what the ledger capitalises or expenses), Tax (GST plus cess), and Purchases with tax.
5. **No Purchases by Item report.** Added `/api/reports/purchase/item-wise` and the page, grouping catalogue lines by item and free-text lines by name. Shows billed, returned and net quantity, amount, average cost, tax and discount received.
6. **Branch handling.** Routes resolved a branch but never filtered by it (all branches were always summed, and the resolved default branch was only used for the permission check). Now no `branch_id` (or `ALL`) means all branches and `branch_id` narrows to that branch, the same as the sales reports.
7. **Credit purchases report.** It used `grand_total − paid_amount`, which is wrong for reverse-charge bills (the supplier is owed the bill without GST) and after returns; it now uses `balance_amount`. "Overdue" meant "bill older than 30 days"; it now means past the due date (bill date if none), with days overdue. Drafts are excluded.
8. **Bill details totals included drafts.** Every bill is still listed with its status and there is a status filter, but totals cover posted bills only, with draft and cancelled counts shown separately. Due date, purchases excl. tax and tax are now columns.
9. **Page.** Export had no handler; it now downloads a CSV. The default "from" date had the same `toISOString()` bug fixed for sales in Group 3 (last day of the previous month for Indian users). Totals rows and Zoho-style columns were added; negatives show in brackets. The table, card, badge and export helpers now live in `components/reports/RegisterReportUi.tsx`, shared with the sales report page, and request handling (dates, branch, access) in `lib/reports/report-context.ts`, shared with `lib/reports/sales-reports.ts`.

## Open gaps

- `/reports/purchase-summary` (separate overview page, like `/reports/sales-summary`) still shows gross bill totals without returns.
- Zoho also has Purchases by Vendor including expenses and journals (`expense_count`, `journal_count`). Khatario's report covers bills and purchase returns only; expenses are reported separately.
- Zoho's API cannot create a draft bill, so the draft case is verified against Khatario's own rules only.
- On the local dev database, all purchase reports return 500 until migration 316 (`purchase_returns.status`) is applied. Staging should already have it; check before re-testing there.

## Tests

- `tests/db/purchase-reports-zoho-scenario.db.test.ts`: 8 tests covering document totals and balances, each report against the Zoho numbers, the Inventory ledger reconciliation, returns / credit / tax-wise reports, the branch filter and parameter validation.
- Regression: `tests/db/sales-reports-zoho-scenario.db.test.ts` (7 tests) still passes after the shared-module refactor. `tsc --noEmit` is clean.
- Page check on the local dev server with the API responses replaced by scenario-shaped fixtures (the local database lacks migration 316): Supplier-wise, Item-wise, Summary, Tax-wise and Bill Details render with matching totals, the status filter sends `status=draft`, and Export downloads a CSV.

## Zoho test data left in place

Items `QA-PR Widget`, `QA-PR Gadget`. Vendors `QA-PR Vendor KA`, `QA-PR Vendor MH`. Bills QA-PR-P1, P2, P3-DRAFT (open; Zoho would not draft it), P4-VOID (void), P5-AUG. Vendor credit QA-PR-VC1. Vendor payment ₹1,000 against P2.
