# Sales-invoice calculation — Phase 1 closure

Recorded on 2026-10-21. This note closes the sales-invoice additional-charge calculation contract only. It does not close the accounting system, the rest of the sales workflows, or the route-scan Phase 1 in this QA index.

No application code, database rows, migrations, configuration, or environment variables were changed while writing this note. Nothing was deployed. Purchase, expense, RCM, and GTA work was not started.

Database evidence below was taken on disposable `kh_phase2_test` at `::1`, port 5433. `current_database()` was `kh_phase2_test` before writes. The application `.env` database name is `khatario`. These runs did not use it. Production was not contacted.

## Status

The reported Phase 1 sales-invoice calculation contract passed the tests and reconciliations listed here, subject to the browser limits and the open items below.

| Area | Status |
| --- | --- |
| Authoritative calculator, both charge classifications, draft re-save, conversions, credit note, recurring, parcels, print templates, offline replay, historical documents | PASS for the commands in this note |
| Browser: new invoice, draft save, draft re-open, second save, on-screen total | PASS for that disposable business |
| Browser: sales-order, estimate, and proforma conversion clicks | NOT TESTED |
| Printed PDF grand total read from the page or from the file | NOT TESTED |
| Migrations 401 and 402 on a disposable schema clone, then a second run | PASS. Not deployed |
| Empty database through the full migration runner | FAIL at `001`. Pre-existing. Recorded under open items |
| Purchase, expense, RCM, GTA | Out of scope. Not started |

## 1. Calculator and charge contract

`authoritativeInvoiceTotals` in `lib/invoices/invoice-charges.ts` is the calculation used for preview, API validation, the saved invoice, the ledger, the customer balance, and GSTR-1. Quantity and unit price on goods lines are not rewritten.

A header amount with no `charges[]` classification is rejected (`CHARGE_UNCLASSIFIED`). It is not taxed and it is not dropped while the source is marked converted.

| Classification | Contract |
| --- | --- |
| `follows_goods` | The charge is split across goods lines by each line’s taxable value. The last positive-weight line takes the paise remainder. Tax uses that line’s rate. The charge’s taxable value is inside the invoice subtotal. `additional_charges` stores the base and is not added again when `charges_included` is true. |
| `separate_supply` | An explicit supply with its own HSN/SAC and rate. It is stored as an invoice line with `charge_line` true, quantity 1, unit NOS, and no item id. It is not stock, not a parcel line, and not a physical quantity. The amount stays visible on the sales report with quantity sold 0. |

Heading `9987` at 5% on a separate-supply charge is rejected (`INVALID_GST_RATE`). The message records that ordinary installation under heading 9987 is 18%, and that 5% is limited to notified concessions a charge cannot evidence. That check does not certify any other SAC/rate pair. Other codes are checked only against the dated slabs in `lib/gst/rates.ts`. The 5% installation case is not used as a legal-rate fixture.

Sales-order and estimate conversion call `chargeFromSourceHeader` before the source status changes. An unclassified charge returns 400 and leaves `converted_invoice_id` null. A classified charge is one input to invoice creation. Proforma conversion copies `invoice_charges` and omits `charge_line` rows so a separate supply is not inserted twice. Work-order labour was inspected and left as a source line (default SAC 9987 at 18%). It is not also sent as a header charge.

Draft GET returns `invoice_charges`. Re-opening a draft keeps `follows_goods` distinct from `separate_supply`. A re-save of unrelated fields keeps one charge and the same totals. Recurring definitions store the charge inputs and each generated invoice is recalculated. Template item copies omit `charge_line`.

New credit notes that reference an invoice item take taxable value and tax from the stored invoice line, including apportioned freight, in proportion to quantity. The last quantity that closes the open balance takes the remaining paise. Unlinked lines still use quantity times unit price. Already-posted credit notes are not recalculated.

Printed templates show the extra “Additional Charges” row only when `charges_included` is false. A classified charge that is already inside the subtotal is printed once. A historical untaxed header charge still prints.

## 2. Tests, browser, and reconciliation

Final command, executed on 2026-10-21:

`npx jest tests/db/phase1-sales-freight.db.test.ts tests/lib/invoice-charge-print.test.ts tests/lib/offline-sync/sales-replay.test.ts --runInBand --forceExit`

Result: 3 suites, 26 tests, all passed. `current_database()` was `kh_phase2_test` on port 5433.

That run covers draft re-save, B2B and B2CS with mixed rates, export without payment of tax, bill of supply, inclusive GST, a credit note that reverses apportioned freight, proforma, sales-order, and estimate conversion, recurring generation, both print classifications, parcel quantity, a valid classified offline replay, an unclassified offline replay rejected, heading 9987 at 5% rejected, and an already-posted invoice plus a historical credit note left unchanged.

`npx jest tests/db/phase2a-invoice-s01-s08.db.test.ts --runInBand --forceExit` passed earlier the same day (11 tests) before the desktop composer classification fields were added. It was not repeated after that UI edit. It does not cover the composer.

Browser, after the automated run. A new `next dev` process listened on `http://127.0.0.1:3011` with `DB_NAME=kh_phase2_test` and no `DATABASE_URL`. `.env` was not edited. Login for a phone that exists only in `kh_phase2_test` returned HTTP 200 for business `Phase1 UI 64f08ef8`.

On `/invoices/new` the disposable bill showed Cotton ₹10,000, freight classified “Part of the goods” ₹1,000, taxable ₹11,000, CGST ₹990, SGST ₹990, and total ₹12,980.00. Generate draft succeeded. Reopening the draft showed `follows_goods`. A second save left one charge. GET returned subtotal 11000, tax 1980, grand 12980. `GET /api/invoices/13e4c988-3895-464e-bbaf-f6fea1267d6f/pdf` returned HTTP 200, `application/pdf`, 67,097 bytes. The process was then stopped.

That business and draft remain in `kh_phase2_test` only.

Intra-state, prices exclusive, goods ₹10,000 at 18% plus freight ₹1,000 `follows_goods`, invoice date 2026-10-09:

| Check | Amount |
| --- | ---: |
| Subtotal and GSTR-1 18% taxable | 11,000 |
| Output CGST 2150 | 990 |
| Output SGST 2151 | 990 |
| Tax | 1,980 |
| Grand total, AR 1103, customer balance increase | 12,980 |
| Sales 4101 | 11,000 |

A full credit note of that invoice posts AR credit 12,980, sales debit 11,000, output CGST debit 990, output SGST debit 990. The customer balance returns to the amount before the invoice. GSTR-1 at 18% nets to zero. Stock quantity returns to the quantity before the sale.

Also asserted in the same suite: mixed ₹5,000 at 5% and ₹5,000 at 18% plus ₹1,000 freight gives taxable 5,500 at each rate. Export without payment of tax and bill of supply give tax 0, subtotal 11,000, grand 11,000. Separate supply SAC 9987 at 18% gives grand 12,980. Parcel contents are the goods line only. The service row has quantity sold 0 and a non-zero amount.

## 3. Migrations 401 and 402

| File | What it adds | Applied where |
| --- | --- | --- |
| `database/migrations/401_invoice_charge_classification.sql` | `invoices.charges_included` default false, and `invoice_charges` with classification `follows_goods` or `separate_supply` | `kh_phase2_test` only, recorded in `schema_migrations` with `success` true. Not deployed |
| `database/migrations/402_sales_charge_contract.sql` | `invoice_items.charge_line` default false, `recurring_invoices.charges` default `[]`, and sales-order and estimate classification, HSN/SAC, and rate columns | Same database, same ledger result. Not deployed |

Neither file backfills or retaxes existing documents.

A later check created disposable `kh_phase1_migcheck` on the same local port from a schema-only copy of `kh_phase2_test`, then ran `scripts/run-pending-migrations.js --mark-below 401 --from 401 --stop-on-error`. The printed target was that database. The first run applied `401_invoice_charge_classification.sql`, `401_supplier_note_original_bill.sql`, and `402_sales_charge_contract.sql`, each with success. The second run reported pending 0. The database was dropped.

An empty database, with no schema loaded, stopped on `001_phase1_invoice_items_gst_breakdown.sql` because `invoice_items` does not exist. That run is the fresh-bootstrap limitation below. It was not pointed at `khatario` or production.

`database/schema.sql` includes `charges_included`, `invoice_charges`, `charge_line`, recurring `charges`, and the estimate classification columns. It has no `sales_orders` table, so the sales-order columns exist only in migration 402.

## 4. Historical documents

Posted invoices stay as posted. `charges_included` stays false unless the invoice was saved under this contract, so a historical `additional_charges` amount is not taxed again. The print template still shows that old header amount once, because it is outside the subtotal.

The regression inserted a historical credit note at grand 11,800 and left it at 11,800 after a new freight invoice was credited. No blanket recalculation of credit notes was run.

## 5. Browser limits

| Check | Status |
| --- | --- |
| New tax invoice, classify freight as part of the goods, on-screen total ₹12,980.00, save draft, reopen, second save, GET totals and one `follows_goods` charge | PASS |
| Sales-order conversion clicked in the browser | NOT TESTED. The route passed in `tests/db/phase1-sales-freight.db.test.ts` |
| Estimate conversion clicked in the browser | NOT TESTED. The route passed in the same file |
| Proforma conversion clicked in the browser | NOT TESTED. The route passed in the same file |
| PDF grand total read on screen or extracted as text | NOT TESTED. The response was HTTP 200. The file uses custom glyph encoding, so a byte search did not show 12,980. `tests/lib/invoice-charge-print.test.ts` asserts the HTML template for `templates/gst_standard/template.html`: classified subtotal `11,000.00` and grand `12,980.00` with no second Additional Charges row, and a historical untaxed charge still prints |

## 6. Open items

These are not closed by this note.

| Item | State |
| --- | --- |
| Store delivery and coupon amounts | Still fail closed. They are not classified as `follows_goods` or `separate_supply` |
| SAC and rate catalogue | Only heading 9987 at 5% is rejected on a separate-supply charge. Other SAC/rate pairs are not validated against a service schedule |
| Separate-supply credit note | A goods return does not reverse a separate-supply line. That line has no item id |
| Sales-by-item amount | Goods amount includes apportioned freight. Quantity does not. That meaning is not a separate product decision beyond this contract |
| `schema.sql` sales orders | The table is absent. Classification columns for sales orders are only in migration 402 |
| Fresh-database bootstrap | `scripts/run-pending-migrations.js` on an empty database stops at migration 001. Idempotent apply of 401 and 402 was shown on a schema clone, not on an empty database |

## 7. Scope boundary

Phase 1 is the sales-invoice additional-charge calculation: classification, totals, tax, ledger, customer balance, GSTR-1 for the cases above, draft edit, conversion of a classified or unclassified sales order, estimate, and proforma, recurring generation, print templates, parcels, and physical quantity.

Purchase freight, expense GST rates, reverse-charge posting, and GTA are not part of this closure. They were not changed and were not tested for this note.

## What this closure does not say

A pass of the 26 tests and the one browser bill does not pass every sales screen, every template’s rendered PDF, store checkout, WhatsApp orders, or any purchase, expense, RCM, or GTA path. Phase 2 of that work is not started.
