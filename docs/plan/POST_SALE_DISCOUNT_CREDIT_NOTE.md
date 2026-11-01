# Post-sale discount credit note (consolidated, no single-invoice link)

Status: **built 2026-10-29** (migration 443 applied to `kh_phase2_test` only; nothing committed). Owner approved the design choice "no invoice link; the note becomes customer credit" in chat. Built as designed, with two departures noted under "What shipped".

## Why

Finance Act 2026 substitutes s.15(3)(b) CGST Act: a discount given after supply comes off the
taxable value when the supplier issues a GST credit note and the recipient reverses the ITC. The
old conditions (agreement before the supply, discount tied to specific invoices) go. Effective on
Gazette notification; the owner has heard 1 November 2026 but no source confirms the date.

Khatario's credit note is a **sales return**: lines are items with quantities, stock comes back,
and a note to a GSTIN customer must link one invoice and stay within what is left on it
(`lib/credit-notes/create-credit-note.ts`). A quarter-end volume or scheme discount spans many
invoices, so today the user must split it into one note per invoice. The GST portal has accepted
CDNR rows without an original invoice since 2020, so the restriction is ours, not the law's.

Two smaller problems ride along: the screen says "Sales return — customer returns goods", so no
one will look for discounts there, and a line without an item prints as "Adjustment" because the
form has no description box (`app/(app)/credit-notes/new/page.tsx`, server default in
`create-credit-note.ts`).

## Goal

A seller records one GST credit note for a post-sale discount to a customer over a period of
supplies. It carries taxable value and GST per rate, no items, no stock, no single invoice. It
reduces the customer's balance, reverses output GST in the ledger, lands in GSTR-1 (CDNR for
registered buyers, netted into B2CS otherwise) and reduces GSTR-3B 3.1(a), exactly like a return
note. Its value is customer credit that the existing credit-application flow spends on later
invoices or refunds.

Sales-return notes keep every rule they have today.

Not in scope: the buyer side (supplier credit notes already reverse ITC and reconcile with
GSTR-2B), IMS accept/reject on the portal, the phone app (it only lists credit notes), a
multi-invoice allocation table (rejected: more UI and a migration for a link the portal no longer
needs).

## Design

### Migration `443_credit_note_post_sale_discount.sql` (write only; run on `kh_phase2_test`)

```sql
ALTER TABLE credit_notes
  ADD COLUMN IF NOT EXISTS note_type VARCHAR(20) NOT NULL DEFAULT 'sales_return'
    CHECK (note_type IN ('sales_return', 'post_sale_discount')),
  ADD COLUMN IF NOT EXISTS supply_period_from DATE,
  ADD COLUMN IF NOT EXISTS supply_period_to DATE,
  ADD CONSTRAINT credit_notes_discount_period CHECK (
    note_type <> 'post_sale_discount'
    OR (supply_period_from IS NOT NULL AND supply_period_to IS NOT NULL AND supply_period_from <= supply_period_to)
  );
COMMENT ON COLUMN credit_notes.note_type IS 'sales_return: goods back, linked invoice. post_sale_discount: s.15(3)(b) discount over a supply period, no invoice link.';
```

Constant default, so no table rewrite. Existing rows read as `sales_return` and behave exactly as
before. `database/schema.sql` gets the same columns.

### Server: `createCreditNoteInTransaction`

`CreateCreditNoteInput` gains `noteType?: 'sales_return' | 'post_sale_discount'` (default
`sales_return`), `supplyPeriodFrom?`, `supplyPeriodTo?`. The POST route passes `note_type`,
`supply_period_from`, `supply_period_to` from the body. Rules when `noteType === 'post_sale_discount'`:

1. **No invoice.** `invoiceId` must be null, else 400 `DISCOUNT_NOTE_HAS_INVOICE`. The
   `ORIGINAL_INVOICE_REQUIRED` check for GSTIN customers applies to `sales_return` only. A discount
   on a single bill is a discount note whose period is that bill's date.
2. **Period.** Both dates required, `from <= to <= credit_note_date`, else 400
   `DISCOUNT_PERIOD_INVALID`. `original_invoice_date` is stored as `supply_period_from` so GSTR-1
   (`COALESCE(cn.original_invoice_date, i.invoice_date)`) and GSTR-9 keep working unchanged.
3. **Time bar.** `isCreditNoteTaxReductionTimeBarred(supply_period_from, credit_note_date)`: the
   earliest supply in the period sets the s.34(2) deadline, the strictest reading. Same error code
   `CREDIT_NOTE_TIME_BARRED`, message names the period.
4. **Lines.** Each line: `description` required (400 `DESCRIPTION_REQUIRED`), `item_id` must be
   null (400 `DISCOUNT_LINE_HAS_ITEM`), `qty` forced to 1, `unit_price` = taxable amount of the
   discount, `tax_rate` validated by `gstRateError` as today. One line per GST rate; two lines at
   the same rate are allowed (they just split). `discount_percent` / `discount_amount` ignored.
   No stock movement, no `location_id`, COGS 0. `restocked` stored false.
5. **Cap.** Per rate, the note's taxable value may not exceed the customer's taxable value on
   final, non-cancelled invoices at that rate dated inside the period (this branch registration's
   place of supply), minus taxable value already on active `post_sale_discount` notes to the
   customer at that rate whose period overlaps. Else 400 `DISCOUNT_EXCEEDS_SALES` with both
   figures in the message. Overlap counting is conservative on purpose: a note that fails it is
   a note the GST officer would also question. If it bites a legitimate case in use, downgrade
   to a warning in the response (`warnings: [...]`) rather than widening the rule.
6. **Everything after the lines is unchanged**: header totals, customer balance down,
   `refreshCreditNoteRefundStatus`, `createCreditNoteLedgerEntries` (Debit Sales, Debit output
   GST, Credit receivables) with `cogsAmount: 0`, `markGstReadinessStale`. Add an optional
   narration prefix parameter to `createCreditNoteLedgerEntries` so the voucher reads
   "Post-sale discount - Credit Note CN-007" instead of "Sales return".

`unusedCreditAmount` already treats a note with no source invoice as fully spendable
(`settledOnSourceInvoice` 0), so `applyCustomerCredit` on the next invoice works without change.
Cancel (`app/api/credit-notes/[id]/cancel/route.ts`) has nothing to undo for stock and
recomputes no invoice; verify, do not change.

Sales-return lines without an item keep working; the server default `'Adjustment'` goes away and
an empty description on an item-less line is a 400 (`DESCRIPTION_REQUIRED`) for both note types.
Lines with an item keep `item.description || item.item_name`.

### GSTR-1 and readiness

`lib/gst/gstr1.ts` already emits CDNR rows with `original_invoice_number: null` and takes the
rate from the lines. Nothing to change there. Check `lib/gst/return-readiness.ts`,
`gstr13b-alerts.ts` and `tests/lib/gst/readiness-amendments.test.ts` for a "registered customer
note without invoice" alert; if one exists it must skip `post_sale_discount` notes. For an
unregistered customer the note nets into B2CS as today (`deriveCdnurTyp` with no linked invoice).

### Web UI: `app/(app)/credit-notes/new/page.tsx`

- A **Type** choice at the top of the form: "Sales return — goods come back" (default) and
  "Post-sale discount — scheme, volume or rate difference, no goods back".
- Discount mode hides the invoice selector and shows **Supplies covered from / to** (defaults:
  first and last day of the previous month). The lines grid becomes
  Description | Taxable amount | GST % | Total; Qty and Item are hidden and the client sends
  `qty: 1`, `item_id: null`. Reason label stays, placeholder "Q2 volume scheme 2%".
- Sales-return mode: unchanged, except a line whose Item is blank now shows a Description input
  (this is the "Adjustment" fix).
- The client-side GSTIN check ("Select the original invoice") applies to sales-return mode only.
- Page heading copy: "Credit note" with the description "Sales return, or a post-sale discount
  under s.15(3)(b)." `lib/navigation/sales-nav-items.ts` and `MobileCreateSheet` labels stay
  "Credit Notes".

List page `app/(app)/credit-notes/page.tsx`: a small type badge, and for discount notes the
period ("Apr–Jun 2026") in the invoice column. Detail page and print: where the original invoice
shows (`templates/credit_note/standard`, `show_original_invoice`), a discount note shows
"Supplies covered: 01 Apr 2026 – 30 Jun 2026". `lib/pdf-generator.ts` already prints
`description` for item-less lines.

GET `/api/credit-notes` returns `cn.*`, so `note_type` and the period reach the client without a
query change.

### Buyer side (verify only)

`app/(app)/purchases/new/page.tsx` shows "Original supplier invoice" for a supplier credit note.
Confirm the server does not require it (`lib/purchases/purchase-create-service.ts`); a
consolidated discount note from a supplier has none. If it is required, make it optional with
the same reasoning. No other buyer-side change: the supplier credit note already credits input
GST (the ITC reversal) and nets into GSTR-3B 4A(5) per Circular 170/02/2022, and
`lib/gst/gstr2b-reconciliation.ts` matches it to the CDNR row by note number.

## What shipped (2026-10-29)

- Migration `database/migrations/443_credit_note_post_sale_discount.sql` + `database/schema.sql`.
- `lib/credit-notes/create-credit-note.ts`: rules 1–6; `noteType`, `supplyPeriodFrom`, `supplyPeriodTo` on the input; the `'Adjustment'` default is gone (`DESCRIPTION_REQUIRED`). `lib/ledger-utils.ts` narrates "Post-sale discount" for discount notes. `app/api/credit-notes/route.ts` passes the fields.
- `tests/db/post-sale-discount-credit-note.db.test.ts`: 7 tests, all pass on `kh_phase2_test`.
- Web: Type choice, supply period, discount lines and the item-less Description input on `app/(app)/credit-notes/new/page.tsx`; Discount badge + period on the list; "Supplies covered" on `templates/partials/custom-invoice-meta.html` (every template that includes it) and on `templates/credit_note/standard/template.html` with an ITC-reversal notice; `lib/invoice-presenter.ts` exposes `is_post_sale_discount`, `supply_period_from/to`.
- Departures from the plan: the preview/PDF uses the business's default invoice template (`gst_standard` for Map Test Shop), not `credit_note/standard`, so the period went into the shared partial too. No readiness alert existed for notes without an invoice, so nothing changed there. The buyer side needed no change: `original_bill_number` is already optional.
- Checked in the browser on localhost (`kh_phase2_test`, Map Test Shop made GST-registered for the check): a 2% discount note on ₹1,200 of October soap sales → CN-001, ₹28.32, "Discount · Oct 2026" on the list, preview shows "Supplies covered: 29 October 2026 to 29 October 2026" and the described line.

## Tasks (in order)

1. Migration 443 + `database/schema.sql`. Run on `kh_phase2_test` only.
2. `create-credit-note.ts`: input fields, rules 1–6 above, remove the `'Adjustment'` default,
   narration prefix. POST route passes the new fields. TDD: write the DB test first.
3. `tests/db/post-sale-discount-credit-note.db.test.ts` (pattern:
   `tests/db/sell-in-alternate-units.db.test.ts`): a GSTIN customer with two final invoices at
   18% in Apr–Jun; a 2% discount note for the quarter →
   - row saved with `note_type`, period, `original_invoice_date = from`, no `stock_movements`,
     customer balance down by the grand total;
   - ledger has Debit Sales, Debit output CGST/SGST, Credit receivables with the discount narration;
   - GSTR-1 for the note's month has one CDNR row, `original_invoice_number` null, rate 18;
   - refusals: invoice linked, missing period, period after the note date, note dated after
     30 Nov following the period's FY, line with an item, blank description, taxable above sales
     at that rate, and a `sales_return` note to the same GSTIN customer without an invoice still
     fails `ORIGINAL_INVOICE_REQUIRED`;
   - next invoice to the customer: `applyCustomerCredit` spends the note.
4. Readiness/alerts grep and fix (section "GSTR-1 and readiness"); extend
   `tests/lib/gst/readiness-amendments.test.ts` if an alert changes.
5. Web form, list, detail, print copy. Check in the browser on localhost: create one discount
   note and one sales-return note with an item-less described line; open the PDF of each.
6. Buyer-side verify (section above).
7. `tsc`, the credit-note and GST unit suites, the new DB test. Log entry, roadmap card to Done.

Estimated size: one migration, ~200 lines server, ~250 lines UI, one DB test file.

## Risks

- **Cap too strict**: see rule 5; the fallback is a warning, decided after real use, not now.
- **Period before the customer existed in Khatario** (sales were billed elsewhere): the cap
  finds no sales and refuses. Acceptable; the user records those as financial credit notes
  outside GST as today.
- **Reports that group credit notes as returns** (`lib/reports/sales-reports.ts`,
  `stock-audit-reports.ts`): discount notes have no stock lines so stock reports are unaffected;
  sales reports keep showing them as credit notes, which is right for revenue.
