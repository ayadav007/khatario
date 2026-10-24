# Receivables & Payables Aging, Customer & Vendor Balances: Zoho Books vs Khatario

Run: 01-Oct-2026. As-of date: 30-Sep-2026.
Zoho: Tandoor Studio (org 910361617), contacts `QA-AG Customer A`, `QA-AG Customer B`, `QA-AG Supplier X`.
Khatario: the same scenario in `tests/db/ageing-zoho-scenario.db.test.ts` (disposable test database with every migration applied; the local dev database is behind on migrations 304–336).

## Scenario

All lines at 0% GST so only document totals matter.

| Party | Document | Date | Due | Amount | Settled by |
|---|---|---|---|---:|---|
| Customer A | Invoice A1 | 01-Jun | 16-Jun | 11,800 | Receipt 5,000 on 01-Jul (linked); receipt 1,000 on **01-Oct** (after the as-of date) |
| Customer A | Invoice A2 | 15-Aug | 30-Aug | 5,900 | Credit note 1,180 on 01-Sep (linked) |
| Customer A | Invoice A3 | 25-Sep | 10-Oct | 2,360 | — (not yet due) |
| Customer A | Receipt (no invoice) | 20-Sep | | 3,000 | — (advance / unapplied) |
| Customer B | Invoice B1 | 10-Apr | 10-Apr | 23,600 | — |
| Supplier X | Bill X1 | 05-Jun | 05-Jul | 17,700 | Payment 7,700 on 10-Jul (linked); vendor credit 590 on 01-Aug (linked) |
| Supplier X | Bill X2 | 10-Sep | 10-Oct | 4,720 | — (not yet due) |
| Supplier X | Payment (no bill) | 15-Sep | | 1,500 | — (advance / excess) |

Zoho report endpoints only honour the date when `filter_by` is set, and the prefix decides how Zoho ages: `filter_by=InvoiceDueDate.CustomDate` / `BillDueDate.CustomDate` (by due date, Zoho's default), `InvoiceDate` / `BillDate` (by document date). Without it the reports silently use today.

## Results (as of 30-Sep, aged by due date)

| | Zoho | Khatario (before) | Khatario (after) |
|---|---|---|---|
| A — not yet due | 2,360 | (no column) | 2,360 |
| A — 31-45 / 31-60 days | 4,720 | | 4,720 |
| A — over 45 / 90+ days | 6,800 | | 3,800 |
| A — unapplied receipt | 3,000 shown as a separate credit | ignored | set off against A1 (oldest) |
| A — balance | 10,880 (13,880 invoices − 3,000 credit) | 13,880 (credit not deducted, late receipt counted if dated ≤ today) | **10,880** |
| B | 23,600 (over 45) | 23,600 | 23,600 (90+) |
| X — not yet due | 4,720 | (no column) | 4,720 |
| X — over 45 / 61-90 days | 9,410 | aged from bill date | 7,910 (9,410 − 1,500 advance) |
| X — balance | 12,630 (14,130 bills − 1,500 excess payment) | 14,130 | **12,630** |

Totals agree with Zoho's customer/vendor balance. Bucket edges differ by design: Zoho uses Current / 1-15 / 16-30 / 31-45 / >45, Khatario uses Not due / 1-30 / 31-60 / 61-90 / 90+.

## Findings and fixes

1. **The aging pages did not use the ledger.** `/api/reports/aging/receivables` and `/payables` summed invoice/bill totals minus payments that reference that document. As a result:
   - Credit notes, purchase returns, TDS, on-account receipts/payments and advance adjustments were ignored, so outstanding was overstated (A showed 13,880 instead of 10,880; X 14,130 instead of 12,630).
   - Payments were not limited to the as-of date: a receipt dated after the date still reduced the balance.
   - Opening balances were read from the customer/supplier master and always dropped into 90+.
   - The branch was resolved but never filtered.
   - Fixed: both routes now use the ledger-based engine (`fetchPartyLedgerDocs` + `buildAgeing`, shared handler `lib/reports/aging-report-route.ts`). The total always equals the Accounts Receivable (1103) / Payable (2101) balance on the date (shown under the table), branch filtering works, and no `branch_id` means all branches.
2. **Aged from document date, no "not due" column.** Fixed: items are aged by days past due date (document date when there is none). Anything due on or after the as-of date is "Not due", Zoho's "Current". Each party row expands to show the open documents with date, due date, "Due in n d" / "n d overdue", amount and balance.
3. **Bills had no due date.** `purchases` had no `due_date` column, so payables could only be aged from the bill date. Fixed: migration `336_purchase_due_date.sql` (nullable column; check `due_date >= bill_date`), the purchase form has a "Due Date" field (blank = due on the bill date), `POST /api/purchases` validates and stores it (`INVALID_DUE_DATE`), the bill page shows it, and the purchases list "days overdue" uses it.
4. **Advance adjustments were "Unallocated".** Adjusting a GST advance (Advances module) against an invoice or bill posts an `advance_adjustment` voucher to 1103 / 2101. The party-ledger query did not recognise that voucher, so the invoice stayed fully open under the customer and a negative line appeared under "Unallocated (journals / other)". Fixed in `lib/reports/party-ledger-docs.ts`: the adjustment is attributed to the advance's party and settles the linked invoice/bill. This also corrects the party statement (`/api/reports/party/statement`), which uses the same query.
5. **Unapplied receipts / payments (intentional difference).** Zoho keeps an unapplied receipt as a separate credit, so the invoice stays overdue until the user applies the credit. Khatario has no "apply later" step for on-account receipts, so the aging sets them off against the oldest open documents (FIFO); any excess stays in "Unapplied credits". The party total equals Zoho's balance; only the bucket in which the reduction shows differs (A1 3,800 vs Zoho 6,800 + 3,000 credit).
6. **Zoho quirk, no action.** Zoho's Customer Balances report with a custom date still nets the 01-Oct receipt (Customer A 9,880 on 30-Sep). The Zoho aging reports and Khatario both give 10,880 as of 30-Sep.

## Open gaps (not fixed in this pass)

- **Journal lines carry no customer/supplier.** A manual journal to Accounts Receivable/Payable shows under "Unallocated (journals / other)" in aging and statements. Zoho lets you pick a contact on such journal lines. Needs a party column on journal / ledger lines plus UI; larger change.
- **Supplier payment terms.** Suppliers have no credit-days field (customers have `credit_days`), so the bill due date is entered by hand rather than defaulted from terms.
- **Purchase "Edit" button** on the bill page links to `/purchases/[id]/edit`, which does not exist (pre-existing).

## Tests

- `tests/lib/reports/ageing.test.ts`: not-due bucket (due today counts as not due), signed days overdue, advance adjustment settles its linked invoice.
- `tests/db/ageing-zoho-scenario.db.test.ts` (real DB): the scenario above against the receivables/payables routes. Checks Zoho's balances, per-document balances and days overdue, exclusion of the receipt dated after the as-of date, advance adjustment attribution, customer and branch filters, report total = GL balance, and due-date validation in the purchase API and the database constraint.
- `tests/db/phase4-4-payment-reversal.db.test.ts`: its aging check now posts the invoice's ledger lines, since aging reads the ledger.

## Test data left in place

Zoho (Tandoor Studio): contacts QA-AG Customer A/B, QA-AG Supplier X (GSTIN 29AAGCQ4321A1ZS); invoices INV-000008…000011; customer payments QA-AG-RA1, QA-AG-RA-ADV, QA-AG-RA1-LATE; credit note on INV-000009; bills QA-AG-X1, QA-AG-X2; vendor payments QA-AG-PX1, QA-AG-PX-ADV; vendor credit QA-AG-VC1.
