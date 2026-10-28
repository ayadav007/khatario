# Selling in alternate units (BOX of 12, BAG of 50 kg)

Status: **built 2026-10-28** (approved as written, all five defaults). Migration renumbered 435 → 437: main took 435 (item schemes) and another branch has 436.

## Goal

A sales line can be sold in one of the item's alternate units from `item_units` (migration 417).
"5 BOX" bills 5 boxes at the box rate, prints "5 BOX", and moves 60 PCS of stock. Cancelling,
crediting or returning it puts the right base quantity back.

Covers: sales invoice (web composer and POST/PATCH/finalize), sales order, delivery challan,
POS, and the phone invoice form. Purchases, estimates and stock transfers stay in the base unit
for now.

## Storage: the line keeps what was sold, plus a factor

Two shapes were possible.

| | A. `quantity` stays in base units | B. `quantity` is in the sold unit (chosen) |
| --- | --- | --- |
| Line reads | 60 PCS @ 8.3333 | 5 BOX @ 100.00 |
| Money | `invoice_items.unit_price` is `DECIMAL(12,2)`, so 100/12 rounds to 8.33 and 1000 boxes bill 99,960 instead of 1,00,000. Would need widening price columns everywhere. | Exact. `quantity × unit_price` stays the line's money, as today. |
| Stock readers | Untouched | Each one switches to `quantity × unit_factor` |
| Print / edit / reports showing qty | Every one needs the sold qty from a side column | Already show `quantity` + `unit` |

**B is chosen** because money must stay exact and GST math (`computeLineGst`, credit-note pools,
taxable value) runs on `quantity × unit_price`. The cost is that every place that treats line
quantity as *stock* must multiply by the factor. That list is below and each one gets a test or a
grep check.

### Migration `437_sell_in_alternate_units.sql` (written, run only on `kh_phase2_test`)

```sql
ALTER TABLE invoice_items          ADD COLUMN IF NOT EXISTS unit_factor NUMERIC(15,4) NOT NULL DEFAULT 1 CHECK (unit_factor > 0);
ALTER TABLE credit_note_items      ADD COLUMN IF NOT EXISTS unit_factor NUMERIC(15,4) NOT NULL DEFAULT 1 CHECK (unit_factor > 0);
ALTER TABLE sales_order_items      ADD COLUMN IF NOT EXISTS unit_factor NUMERIC(15,4) NOT NULL DEFAULT 1 CHECK (unit_factor > 0);
ALTER TABLE delivery_challan_items ADD COLUMN IF NOT EXISTS unit_factor NUMERIC(15,4) NOT NULL DEFAULT 1 CHECK (unit_factor > 0);
ALTER TABLE order_return_items     ADD COLUMN IF NOT EXISTS unit_factor NUMERIC(15,4) NOT NULL DEFAULT 1 CHECK (unit_factor > 0);
-- A box can have its own selling price instead of base price × factor.
ALTER TABLE item_units ADD COLUMN IF NOT EXISTS selling_price NUMERIC(12,2);
```

- A constant default is a metadata-only change in PostgreSQL 11+: no table rewrite on large
  `invoice_items`. A generated `base_quantity` column was rejected for that reason (it rewrites
  the table and locks it).
- Existing rows get factor 1, so every old document reads exactly as before. A reader that is
  missed only misbehaves on new alternate-unit lines, and the tests below target those.
- The factor is a **snapshot**. `saveItemUnits` deletes and re-creates `item_units` on every
  edit, and a box might change from 12 to 10 later; old bills must still return 12.

### One server-side resolver

`lib/items/item-units.ts` gets `resolveSaleUnits(db, businessId, lines)`:

- For each line with an `item_id`: if `unit` matches one of the item's `item_units` rows
  (case-insensitive), set `unit = that unit`, `unit_factor = factor_to_base`. Otherwise
  `unit_factor = 1` and the unit is left as sent (today's behaviour, so old clients and the
  offline queue keep working).
- **A client-sent `unit_factor` is ignored.** Same rule as `business_id`: never trust the client.
- Refused with a clear 400: an alternate unit on a **bundle** item or a **serial-tracked** item
  (serial count would no longer equal quantity). Both can come later.
- Batch-tracked items are fine: FIFO batch allocation simply runs on the base quantity.

Plus `baseQty(row) = round3(quantity × unit_factor)` in TS, and the SQL form
`(ii.quantity * COALESCE(ii.unit_factor, 1))` for queries.

## Every place that reads sales line quantity, and what it does

Legend: **Stock** = must use base qty. **Money** = stays on sold qty (no change).
**Show** = displays qty with its own unit (no change beyond the new picker). **Agg** = sums qty
across lines of one item, so must use base qty and the item's own unit.

### Stock moves (must convert)

| Where | Today | Change |
| --- | --- | --- |
| `app/api/invoices/route.ts` POST: stock pre-check (~L670–915), deduction incl. batches/FIFO (~L1950–2310), bundle COGS (~L2339) | `item.quantity` | Resolve units once after parsing the body; pass `baseQty` to the pre-check, `location_stock`, branch stock, batch allocation and `stock_movements`. Insert `unit_factor`. |
| `lib/invoices/invoice-create-service.ts` (`deductGoodsStockForLine`, insert ~L574) used by offline replay and sales-order convert | `item.quantity` | Same: resolve, insert `unit_factor`, deduct `baseQty`. |
| `app/api/invoices/[id]/finalize/route.ts` (draft → final; pre-check L127, deduction L311–580) | `row.quantity` | Read `unit_factor` from the saved line; use `baseQty`. |
| `app/api/invoices/[id]/route.ts` PATCH (draft line edits) | stores lines | Resolve units on save. Gross-profit helper (L22–53) uses `cost × baseQty`. |
| `lib/invoices/cancel-final-invoice.ts` (L169–259) | `row.quantity` | `baseQty(row)` for location/branch stock and the `stock_movements` row. Batch restore already reads the original movement's quantity (base). |
| `lib/credit-notes/create-credit-note.ts` | per-item pool `SUM(quantity)` vs `SUM(cni.qty)`; restock `qty` | Pool both sides in base: `SUM(quantity * unit_factor)` and `SUM(qty * unit_factor)`. A credit line's factor comes from the invoice's own line with the same item + unit (snapshot), else `item_units`, else 1. Insert `unit_factor`; restock and `stock_movements` use base. `unitPrice` stays per sold unit. |
| `app/api/credit-notes/[id]/cancel/route.ts` (L97–120) | `cni.qty` | `qty × unit_factor`. |
| `lib/returns/service.ts` (returnable lines, `order_return_items`) | `ii.quantity` | Returnable qty stays in the invoice line's unit (you return 2 of the 5 boxes); copy `unit` and `unit_factor` onto `order_return_items`; the credit note it creates carries them. |
| `lib/ledger-utils.ts` L931 perpetual COGS lines | `quantity` | `quantity * unit_factor`. |
| `lib/inventory/fifo-costing.ts` `goodsLinesSql` (invoice and credit-note lines) | `l.quantity` / `l.qty` | Pass the expression `l.qty * COALESCE(l.unit_factor,1)`; bundle child rows multiply the same. |
| `lib/inventory/fifo-recost.ts`, `stockItemsForDocument` | item ids only | No change (checked). |
| `lib/stock-custody/custody.ts` (returnable challan dispatch, return, invoice-against-challan) | `qty`, `qty_returned`, `qty_invoiced` | Keep counters in the challan's unit; stock posts use `qty × unit_factor`. |
| `lib/delivery-challans/challan.ts` (insert L202) | `qty, unit` | Resolve units, insert `unit_factor`. |
| `app/api/delivery-challans/[id]/route.ts` (`qty_open`) | challan unit | Show only, no change. |
| `app/api/sales-orders/route.ts` + `[id]/route.ts` (insert/edit lines) | `qty, unit` | Resolve units, insert `unit_factor`. Sales orders do not move stock. |
| `app/api/sales-orders/[id]/convert/route.ts` | `fulfilled_qty` in SO unit | Counters stay in the SO unit; the invoice line inherits the SO line's `unit` and `unit_factor`. |
| `lib/invoices/recurring.ts` | copies `invoice_items` into new bills | Carries `unit`; factor is re-resolved through the create service at run time. |
| `app/api/whatsapp/orders/...`, `lib/whatsapp/paid-order.ts`, `lib/whatsapp-crm.ts`, `lib/supply-orders.ts`, `lib/fulfilment/hub.ts` | build sales orders / invoices from store or hub orders | Always base unit today; they go through the create paths, so factor = 1. Verify only. |
| `lib/inter-branch-utils.ts` | inter-branch invoices from transfers | Base unit only; verify factor = 1. |

### Reports, dashboards, GST (Agg: convert to base)

| Where | Change |
| --- | --- |
| `lib/reports/sales-reports.ts` item-wise sales (L169 union with credit notes) | `quantity * unit_factor`, unit shown = item's own unit. |
| `app/api/dashboard/overview/route.ts` COGS `SUM(ii.quantity * purchase_price)` | base qty. |
| `app/api/dashboard/top-products`, `dead-stock`, `reports/stock/profit-margin`, `reports/stock/purchase-vs-sales`, `reports/profit-by-invoice`, `items/[id]/transactions`, `suppliers/dashboard/analytics`, `suppliers/[id]/item-links` | base qty wherever qty is summed or multiplied by a per-unit cost. Item transactions list shows "5 BOX (60 PCS)". |
| `lib/reports/stockSummaryDashboard.ts` | reads `stock_movements` (already base); verify. |
| `lib/gst/gstr1.ts` HSN summary (L413–504, credit notes L999) | Report in the item's base UQC with base qty, so one HSN keeps one row. (BOX is a valid UQC, but splitting one HSN across BOX and PCS rows confuses the return.) |
| `lib/gst/gstr9.ts`, `lib/gst/eway-json.ts` | HSN qty in base UQC; e-way bill item qty + unit in base (transport documents use the GST UQC). |
| `app/api/reports/sales/tax-wise` | money only, no change. |
| `lib/gst/compliance/engine.ts`, `profit-loss/validation` page | no quantity use; no change. |
| `app/api/backup/create`, `preview`, `restore`, scheduled backups | `SELECT *`-style row copy, so the new column comes along; restore must accept old backups without it (default 1). Check and test. |
| `app/api/admin/diagnostics/purge-invoices`, `app/api/documents/[table]/[id]` | delete / generic read; no change. |

### Money (no change)

`computeLineGst`, invoice totals, `invoice-charges.ts`, credit-note GST pools (money side),
`convert-to-tax-invoice` (copies lines; must copy `unit_factor` too), `taxable_value`,
`line_total`. All run on sold qty × sold-unit price, which is exact.

### Show / print

| Where | Change |
| --- | --- |
| `app/api/print/render/route.ts`, `lib/pdf-generator.ts`, invoice / challan / sales-order templates | Already print `quantity` and `unit`, so "5 BOX" comes for free. Add a small "= 60 PCS" under the item name when `unit_factor ≠ 1` (all templates share the line renderer). |
| `lib/fulfilment/parcel-items.ts` (packing) | Packs in the sold unit (you pack 5 boxes). No change. |

## Pricing (`lib/pricing/resolve-price.ts`, `/api/pricing/resolve`)

`PriceLineInput` gets `unit?: string`. The resolver loads the item's units and, for a line in an
alternate unit with factor F:

1. Price typed by hand: unchanged.
2. Customer's own price / price-level rate: these are per base unit, so **× F**.
3. Catalog: the unit's own `item_units.selling_price` if set, else item (or variant) price **× F**.
4. Quantity slabs (`min_qty`) compare against **base qty** (`qty × F`): 3 boxes of 12 meets a
   36-piece slab.
5. Discount % (party, category, level): unchanged, it is a percentage.
6. `costPrice` and `mrp` come back **× F** so the below-cost warning and the MRP cap work per box.
7. Last rate to this customer: prefer the last line sold in the same unit; else convert the last
   base-unit rate × F.

The result adds `unit` and `unitFactor` so screens can show "1 BOX = 12 PCS".

The server never re-prices: like today, the price on the bill is what the user saw and accepted.
The resolver only fills the screen.

## Screens

- **Web invoice composer** (`components/invoices/composer/ComposerItemsTable.tsx`): the unit cell
  becomes a small select when the item has alternate units (base first). Changing it re-asks
  `/api/pricing/resolve` with the unit and updates the rate. Item search results carry the item's
  units (one extra `item_units` read for the result ids).
- **Sales order composer**, **delivery challan form**: same select.
- **POS** (`components/pos/POSLayout.tsx`): unit select on the cart line; scanning a box barcode
  (`item_units.barcode`) adds 1 BOX directly.
- **Phone invoice form** (`phone/lib/screens/invoices/invoice_form_logic.dart`, `_screen.dart`):
  `InvoiceLineDraft.unit` becomes editable via a chip row of units; the item API returns `units`.
  Phone already sends `unit`, so older APKs keep working at factor 1.
- **Stock warning on screen** compares base qty with stock.

## Tests (`kh_phase2_test` only)

New `tests/db/sell-in-alternate-units.db.test.ts`:

1. Item PCS with BOX = 12. Final invoice: 5 BOX @ 100. Line stores quantity 5, unit BOX,
   factor 12, line total 500; branch stock −60; `stock_movements` out 60.
2. Insufficient stock refused in base (stock 50, sell 5 BOX → refused).
3. Draft with a BOX line, then finalize: stock −60.
4. Cancel that invoice: stock back +60.
5. Credit note for 2 BOX: stock +24; the pool refuses a further 4 BOX (only 3 left); 36 PCS on a
   separate credit line is accepted against the same pool.
6. Cancel the credit note: stock −24.
7. Change the box to 10 after billing: cancelling the old invoice still returns 60.
8. Client-sent `unit_factor: 1000` is ignored.
9. Unknown unit → treated as base (factor 1). Alternate unit on a bundle / serial item → 400.
10. Resolver: box price = base × 12; unit's own price wins; party price × 12; slab of 36 PCS met
    by 3 BOX; MRP and cost × 12.
11. Sales order 5 BOX → convert → invoice line BOX × 12, stock −60.
12. Perpetual COGS posts 60 units of cost; item-wise sales report shows 60 PCS.
13. GSTR-1 HSN summary: 5 BOX + 10 PCS of one HSN → one row, 70 PCS.

Plus a unit test for `resolveSaleUnits` / `baseQty`, a Playwright pass on `localhost` (sell a BOX,
print shows it), and `flutter analyze` + the form-logic test on the phone side.

## Order of work

1. Migration 437 + `resolveSaleUnits` / `baseQty` + DB tests 1–9 against the invoice, cancel and
   credit-note paths (the "done" bar).
2. Finalize, PATCH, returns, challans, sales orders, convert, recurring, COGS / FIFO.
3. Pricing resolver + API.
4. Reports, dashboards, GSTR-1/9, e-way, backups.
5. Web composer, sales order, challan, POS; print sub-line.
6. Phone form.

## Open questions for the owner

1. Store sold qty + factor (B above): agreed?
2. A unit's own selling price on `item_units` (new column): wanted, or always base × factor?
3. GSTR-1 HSN summary and e-way bill in the item's base UQC: agreed?
4. Bundles and serial-tracked items refused in alternate units for now: fine?
5. Print adds "= 60 PCS" under the item when sold in a box: wanted?
