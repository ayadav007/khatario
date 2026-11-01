# Distributor invoice template (FMCG / pharma)

Goal: a business can print the dense invoice that FMCG and pharma distributors use (the P&G
distributor bill from C G Marketing that the owner photographed, 28 Oct 2026), and choose which columns its item table shows and in
what order.

Status: **phase 1 built 28 Oct 2026** (not committed). Phases 2 and 3 not started.

Phase 1 as built: `lib/print/item-columns.ts` (column registry, cases/pieces, slab summary with margin),
`templates/distributor/`, `components/templates/ItemColumnChooser.tsx` (shown in the customise drawer's Fields
tab for this template), item master MRP/code and `item_units` case size read in `lib/pdf-generator.ts`. Owner
accepted the default answer to all four decisions below.

## What the photo's bill has

| Zone | Contents |
|---|---|
| 1. Header grid | Three boxed columns of small label/value pairs. **Supplier:** name, address, branch, CIN, GSTIN, PAN, drug licence 20B/21B with expiry, FSSAI no. with expiry. **Buyer:** name + customer code, address, phone, GSTIN, state + code, PAN, drug licence, FSSAI. **Invoice:** number, date, IRN, buyer pin code, salesman (DSE), route, visit day, channel, credit customer, PO no. and date |
| 2. GST slab summary (top) | One row per GST rate: pieces, gross, scheme discount, other discount, taxable, tax, retailer margin, margin %, net amount, credit note adjusted, net payable |
| 3. Item table | ~20 narrow columns: HSN, product code, description, MRP, cases, pieces, units per case, price per piece, gross, scheme discount, other discount, taxable, GST %, IGST/CGST, SGST, cess, TCS, net. Totals row |
| 4. Batch table | Product, batch, expiry, manufacturer (pharma / food) |
| 5. Scheme table | Scheme code + name, free product, qty, amount |
| 6. Footer | FSSAI food declaration, e-invoice exemption declaration, terms, digital signature, payment QR |

## What Khatario has today

| Needed | Today |
|---|---|
| HSN, item code (`items.code`), MRP (`items.mrp`), pack size | yes, on the item master |
| Cases / pieces / units per case | `item_units` (alternate units with `factor_to_base`), not used in print |
| Discount %, discount amount, cess amount per line | yes (`invoice_items`) |
| HSN/rate tax summary | yes (`buildHsnTaxSummary`, added 28 Oct) |
| Batch / expiry | `item_batches` exists; invoice lines do not record which batch was sold |
| Invoice custom fields | yes (text/number/date/dropdown on invoices and items) |
| Business CIN, drug licence, FSSAI | no columns (`business.cin` is referenced by templates but never filled) |
| Customer code, drug licence, FSSAI, route, visit day | no columns |
| Salesman on invoice | no |
| Scheme discount separate from discount, free goods on sales | no (`free_qty` exists on purchases only) |
| MRP frozen on the sold line | no (master MRP can change later) |
| IRN, payment QR on print | no (gaps from the 28 Oct review) |
| Template layouts | fixed HTML per template; show/hide toggles, colours, custom-field placement |

## Approach

### Column chooser: the item table becomes data, not markup

- New `lib/print/item-columns.ts`: a registry of item-table columns. Each column has an id, label, short label,
  alignment, relative width, a value function over the presented line, and whether it totals.
- Template setting `item_columns: string[]` (ordered ids). Empty means the template's default set.
- The presenter builds `invoice.item_table = { columns, rows: [[cell…]], totals }` from that list, so the
  template is one loop over columns. No per-column `ifSetting` blocks.
- Columns that need data the business lacks (for example MRP when no item has one) are skipped.
- Item custom fields appear in the registry as `cf:<key>` columns.
- Drawer: an "Item table columns" panel with a tick box and up/down arrows per column, a "Reset to default"
  link, and a warning above 16 columns on A4 portrait (suggests landscape, which print-config already supports).
- Statutory columns (HSN, qty, taxable, GST rate, tax amounts, net) are locked on through
  `lib/invoice-statutory.ts`, like the other mandatory fields.

Phase 1 columns: S.No, HSN, Product code, Description, MRP, Cases, Pieces, Units per case, Qty, Unit, Rate,
Gross, Discount %, Discount, Taxable, GST %, CGST, SGST, IGST, CGST+IGST (one column, as on the photo), Cess,
Net, plus item custom fields. Phase 2 adds Scheme discount, Free qty, Batch, Expiry.

**Cases and pieces.** For an item with a case unit in `item_units` (the largest factor, or a unit named CASE/
CS/BOX/CTN), qty 50 with 12 per case prints Cases 4, Pieces 2, Units per case 12. Items without one print the
whole qty under Pieces.

### The template

`templates/distributor/template.html`, id `distributor`, named "Distributor (FMCG / Pharma)", for tax invoices.
It is registered in `template-registry-real.ts`, the renderer path map, the preview paths, the defaults and the preview sample
data. It is built as bordered tables at 7.5–8px type, so a 20-line bill fits on one A4 page like the photo.

1. **Header grid**: three boxes. Fields with no value are left out, and boxes never show empty labels.
   Invoice custom fields placed in "invoice meta" print in the third box.
2. **Slab summary**: by GST rate: pieces, gross, discount, taxable, tax, net. Margin and margin % appear
   when the lines have MRP (margin = Σ MRP × qty − net amount; % of net amount, as on the photo).
3. **Item table**: driven by the column chooser, with a totals row.
4. **Batch table**: only when any line has a batch (phase 2).
5. **Scheme table**: only when any line has a scheme or free qty (phase 2).
6. **Footer**: amount in words, terms, FSSAI declaration (when the business has an FSSAI number), signatory,
   copy label. A payment QR and IRN print when those features exist; this plan does not build them.

### Data (phase 2, migration 435, written but not applied)

- `businesses`: `cin`, `drug_licence_no` (20B/21B as typed), `drug_licence_expiry`, `fssai_licence_no`, `fssai_expiry`.
- `customers`: `customer_code`, `pan` (if missing), `drug_licence_no`, `drug_licence_expiry`, `fssai_licence_no`,
  `fssai_expiry`, `route`, `visit_day`.
- `invoices`: `salesperson_user_id` (a staff member of this business; the server checks it belongs to the business).
- `invoice_items`: `mrp` (copied from the item when the line is saved), `scheme_name`, `scheme_discount_amount`,
  `free_qty`, `batch_id`, `batch_number`, `expiry_date`.
- Forms: business profile (licences), customer form (code, licences, route, visit day), invoice editor
  (salesman picker; per line scheme discount, free qty, batch picker for batch-tracked items).
- Maths: scheme discount is a discount shown on the invoice, so it reduces taxable value
  (CGST Act s.15(3)(a)). It goes into `lib/invoice-engine/calculateRow.ts` and the server recompute.
  Free qty leaves stock at zero value. Expiry-date warnings on batches come later.

## Phases

| Phase | Delivers | Needs migration | Size |
|---|---|---|---|
| 1 | Distributor template; column chooser in the drawer; cases/pieces from `item_units`; slab summary with margin from master MRP; salesman/route as invoice custom fields until phase 2 | no | medium |
| 2 | Licences on business and customer, customer code, route/visit day, salesman on invoice, MRP/scheme/free qty/batch on lines, batch and scheme tables | yes (435) | large |
| 3 | Column chooser opened to the other A4 templates | no | small |
| Later, separate | Automatic scheme engine ("buy 2 get 3%"), credit-note adjustment printed on the bill, e-invoice IRN, dynamic UPI QR | — | — |

## Tests

- Unit: column registry (values, totals, cases/pieces split, locked columns, unknown ids ignored).
- Render through the real pipeline with a fixture copied from the photo's bill (11 P&G lines, three GST
  slabs): every zone present, totals match, chosen column order respected, statutory columns cannot be
  removed, blank header fields leave no empty labels.
- Sample PDFs for default columns, a pharma column set and a 20-line bill, checked for a one-page fit.
- Phase 2: migration on `kh_phase2_test` only; invoice maths with scheme discount and free qty; GSTR-1
  taxable value matches the printed taxable value.

## Decisions for the owner

1. Build phase 1 first, with no database change, and ship it before phase 2?
2. The column chooser is per business and per template (stored with the template settings). Same columns
   for every customer is assumed.
3. MRP on the line: phase 1 prints the item master's current MRP; phase 2 freezes it on the line. Accept the
   phase 1 limitation?
4. Schemes in phase 2 are entered by hand per line (name + discount, or free qty). Automatic scheme rules
   are a separate project. Agree?
