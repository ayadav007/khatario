# Sales Reports (by Customer, by Item, Summary, Invoice Details): Zoho Books vs Khatario

Run: 01-Oct-2026. Period: 01-Sep-2026 to 30-Sep-2026.
Zoho: Tandoor Studio (org 910361617), documents with reference `QA-SR-*`, items `QA-SR Widget` / `QA-SR Gadget`, customers `QA-SR Cust KA` / `QA-SR Cust MH`.
Khatario: the same scenario in `tests/db/sales-reports-zoho-scenario.db.test.ts`, created through the real invoice, cancel and credit-note routes on a disposable test database (the local dev database is behind on migrations).

## Scenario

Business in Karnataka. Widget ₹1,000 at 18%, Gadget ₹500 at 5%.

| Doc | Date | Customer | Lines | Taxable | GST | Total | Status |
|---|---|---|---|---:|---:|---:|---|
| S1 | 05-Sep | KA (intra-state) | Widget 3 @ 1,000 less 10%, Gadget 4 @ 500 | 4,700 | 586 | 5,286 | issued |
| S2 | 12-Sep | MH (inter-state) | Widget 2 @ 1,000 | 2,000 | 360 IGST | 2,360 | issued |
| S3 | 20-Sep | KA | Widget 5 | 5,000 | 900 | 5,900 | **draft** |
| S4 | 22-Sep | KA | Gadget 10 | 5,000 | | | **void / cancelled** |
| S5 | 25-Aug | MH | Widget 1 | 1,000 | 180 | 1,180 | outside the period |
| CN1 | 25-Sep | KA, against S1 | Widget 1 returned @ 900 | 900 | 162 | 1,062 | active |

Zoho first accepted Gadget at 12%. Khatario refused it (`INVALID_GST_RATE`: the 12% slab was abolished from 22-Sep-2025), so S1 was edited in Zoho to 5% for parity. Zoho does not validate GST slabs.

Zoho report endpoints: `/api/v3/reports/salesbycustomer | salesbyitem | salessummary | salesbysalesperson` with `filter_by=TransactionDate.CustomDate`, and `invoicedetails` with `filter_by=InvoiceDate.CustomDate`.

## Results (QA-SR documents, September)

| Report | Zoho | Khatario (before) | Khatario (after) |
|---|---|---|---|
| By customer — KA | 1 invoice, sales 3,800, with tax 4,224 | **500 error** on every request | 1 invoice, 3,800 / 4,224 (invoice 4,700 less credit note 900) |
| By customer — MH | 1 invoice, 2,000 / 2,360 | 500 error | 2,000 / 2,360 |
| By item — Widget | qty 4, amount 3,800, avg 950 | **500 error** | qty 4 (5 invoiced − 1 returned), 3,800, avg 950 |
| By item — Gadget | qty 4, 2,000, avg 500 | 500 error | qty 4, 2,000, avg 500 |
| Summary — total | sales 5,800, tax 784, with tax 6,584 | gross 7,646, credit note ignored, default branch only | 5,800 / 784 / 6,584 |
| Summary — 25-Sep | credit note −900 / −162 / −1,062 | (no row) | −900 / −162 / −1,062 |
| Invoice details | lists S1–S4 with status; total 21,506 includes draft and void | lists drafts; totals include drafts | lists S1–S4 with status; totals 6,700 / 946 / 7,646 cover posted invoices only |
| Sales by salesperson | invoice 6,700 − credit notes 900 = 5,800 (all under "Others") | no such report | not built (see gaps) |

Khatario's net sales (5,800) equal the September movement on the Sales account (4101) for the branch, which the test asserts. The sales reports now reconcile to the P&L.

## Findings and fixes

1. **Party-wise and item-wise reports always failed.** `COALESCE(c.id, 'cash_sale')` casts `'cash_sale'` to UUID, and `COALESCE(ii.item_id, ii.id::text)` mixes UUID and text. Postgres rejects both before reading any rows, so both reports returned HTTP 500 for every business.
2. **Credit notes were ignored.** Zoho nets credit notes in Sales by Customer, Sales by Item and Sales Summary, and so does the ledger. Khatario's reports showed gross invoicing. All three now subtract active credit notes by credit-note date. Item quantities subtract returned quantities, and cancelled credit notes are excluded.
3. **"Sales" included GST.** Item-wise "Total Amount" summed `line_total`, which includes tax, and the customer and summary reports used `grand_total`. Zoho's "Sales" excludes tax. Khatario now reports Sales (excl. GST, i.e. `grand_total − tax_total`, the amount the ledger credits to Sales), Tax, and Sales with tax.
4. **Item-wise counted drafts and proformas.** It filtered only `status != 'cancelled'`. All sales reports now share one definition of a posted invoice: `status = 'final'`, not a proforma, not deleted.
5. **Branch handling.** Party-wise, item-wise and invoice-wise resolved a branch but never filtered by it. Summary always filtered by the *default* branch, so multi-branch businesses saw a partial total. Now no `branch_id` (or `ALL`) means all branches, and `branch_id` narrows to that branch.
6. **Free-text lines.** Item-wise grouped every non-catalogue line separately (by line id). They now group by name, case-insensitive.
7. **Deleted customers became "Cash Sale".** The join filtered `c.deleted_at IS NULL`, so a soft-deleted customer's sales were relabelled. The name is now kept, and only invoices with no customer show as "Walk-in / Cash Sale".
8. **Invoice-wise totals included drafts.** Every invoice is still listed with its status (like Zoho), and there is a status filter, but the totals cover posted invoices only. Draft and cancelled counts are shown separately.
9. **Page.** The Export button had no handler; it now downloads a CSV of the current report. The default "from" date was the last day of the previous month for Indian users (`toISOString()` on local midnight), and is now the 1st. Columns follow Zoho (invoice sales, credit notes, net, net with tax, average price, returned quantity), negatives show in brackets, and each table has a totals row.
10. **Also found: final invoices for stocked goods failed (500).** `lib/inventory/fifo-costing.ts` read `purchases.purchase_number`, a column that does not exist. Every FIFO recost, which runs when an invoice for goods is finalised, threw `column pu.purchase_number does not exist`. This shipped in commit 51ac4af; it now falls back to `purchases.invoice_number`. Creating the scenario through the real invoice route is what surfaced it.

## Open gaps

- **Sales by salesperson:** Khatario has no salesperson field on invoices, so there is nothing to report on. Adding it needs a column, invoice form and API changes, and a report.
- `/reports/sales-summary` (the top-10 customer / payment-status overview, separate from `/reports/sales/summary`) still shows gross invoice totals without credit notes.
- The other sales reports (payment mode, discount, credit, cancelled, returns, tax-wise, B2B/B2C) were not compared in this pass. They have no direct Zoho equivalent, and GST views are covered in Group 6.
- Pre-existing test failure, unrelated to these changes: `tests/db/phase3-3-draft-payment.db.test.ts` expects ₹500 of purchase ledger lines for a ₹500 goods bill. Since commit 2e8b2b8 the purchase voucher also carries the Inventory/Purchases transfer pair, so it posts ₹1,000 each side. The assertion needs updating.

## Tests

- `tests/db/sales-reports-zoho-scenario.db.test.ts`: 7 tests covering document totals, each report against the Zoho numbers, the ledger reconciliation, the branch filter and parameter validation.
- Regression: phase3-7, phase3-4, ageing, P&L/TB/BS agreement suites pass. Inventory and report unit tests pass. `tsc --noEmit` is clean.

## Zoho test data left in place

Items `QA-SR Widget`, `QA-SR Gadget`. Contacts `QA-SR Cust KA`, `QA-SR Cust MH`. Invoices INV-000012 to INV-000016 (INV-000014 draft, INV-000015 void). Credit note CN-00003.
