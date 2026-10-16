# Supplier Hub — build plan

Status: Phase 0 (B1–B6) built and tested on `kh_phase2_test` (`tests/db/supplier-hub.db.test.ts`). Migration 389 is applied only to the test DB. Written 2026-10-16 from a review of the current code.

## The target flow

1. **Connect.** Retailer A finds wholesaler B in the hub and sends a connection request. B accepts. Only then is B a linked supplier of A.
2. **Default supplier.** A marks B as the default supplier for some items, and can change this later.
3. **Low-stock signal.** When one of those items falls to A's reorder level, B gets an alert. A must have turned on stock sharing with B.
4. **Order.** B proposes quantities, or A asks for them, and A confirms. The order covers many lines, not one item.
5. **Fulfil.** B raises one sales invoice to A from the confirmed order. Stock leaves B's books and B's sale is recorded.
6. **Receive.** The invoice reaches A's "incoming bills". A records what actually arrived. That creates **A's purchase**: stock in, money owed to B, input tax credit. Any short or damaged quantity turns into a debit note.

A second way into step 4: **A orders from B's published catalog** (new arrivals, or anything B lists with price and MOQ). Catalog orders and low-stock orders are the same kind of order and follow the same steps 5–6.

## Which industries it fits

The hub has two halves. **Connected books** (steps 1, 5, 6: B's invoice becomes A's purchase) fit almost any business that buys goods. **Automatic reordering** (steps 2–4) only fits products bought again and again as the same item.

| Fit for auto-reordering | Industries | Extra they need |
|---|---|---|
| Strong | Kirana/FMCG, pharmacy, hardware, electricals, auto spares, stationery, mobile accessories, paints, agri inputs | Pharmacy: batch and expiry carried from B's invoice. Agri: seasonal reorder levels |
| Strong, daily | Dairy, bakery, eggs, water cans, newspapers | Standing orders ("same 40 every morning") |
| Medium | Electronics, footwear, cosmetics, appliances | New-arrival push, create item on receive, size runs (footwear) |
| Connected books only | Fashion designs, furniture, handicrafts, books | New-arrival push, create item on receive, sale-or-return |
| Weak | Jewellery, mandi produce, scrap, made-to-order or job work | Daily price swings, unique pieces or no fixed supplier |

So reordering is switched on **per item** (default supplier + reorder level), never per business. A clothing shop uses it for basics (innerwear, socks, uniforms) and the catalog for fashion.

## What already exists

| Area | Where | State |
|---|---|---|
| Hub directory, business profile, published catalog | `business_discovery`, `supplier_published_listings`, `app/api/suppliers/hub/*`, `app/(app)/suppliers/hub/*` | Works. A listing shows name, MOQ, lead time and price (hidden / on request / "from ₹X"). **View only**: no order button, no images, no sizes/colours, max 20 public listings. Listing writes now use the session tenant (B6, fixed) |
| Connection request → accept → linked supplier | `supplier_connection_requests`, `app/api/suppliers/hub/connection-requests/[id]/route.ts` | Works, but can be bypassed (B3) |
| Buyer lets supplier see low stock | `suppliers.allow_low_stock_access` | Works |
| Default supplier per item | `items.default_supplier_id` | Column and item form exist; no bulk setup |
| Supplier's low-stock dashboard | `app/api/suppliers/dashboard/route.ts` (uses A's `min_stock`) | Works, but nothing notifies B |
| Supplier-set thresholds and alerts | `supplier_item_thresholds`, `low_stock_alerts`, `lib/low-stock-checker.ts`, cron | **Broken** (B2) |
| Quantity requests: create, respond (confirm/partial/backorder/decline), event history, pass up to B's own supplier | `quantity_requests`, `quantity_request_events`, `app/api/stock-requests/*` | Works, one item per request |
| Link a request to a PO, sales order, invoice or purchase | `stock-requests/[id]/link`, invoice and PO create routes | Works |
| B's invoice → A's purchase | `app/api/invoices/[id]/convert-to-purchase/route.ts` | **Broken for A** (B1) |
| Map A's item to B's item | `quantity_requests.responder_item_id` | Picked again on every request; not saved for reuse |
| Phone app | `phone/lib/screens/purchases/purchase_section.dart`, `purchase_tools.dart` | Can create, respond and link requests; can't convert or receive |

## Phase 0 — Fix what's broken (do first)

**B1. A can't convert B's invoice. (Blocker)**
`convert-to-purchase` loads the invoice with `i.business_id = <caller's business>`. The invoice belongs to B, so when A calls it the lookup returns 404. The access checks after that lookup never run. As written, it only succeeds when B calls it, and then it books the purchase into **B's** books.
- Fix: load the invoice by id alone. Allow it only if (a) it's linked to a quantity request where A is the requester, or (b) its customer is A's linked customer record (see 1.2). Book the purchase into A only.
- Add `purchases.source_invoice_id` (unique where not null) and `source_business_id`. Use these to detect a repeat import, replacing the current `bill_number` match. Two suppliers can issue the same invoice number, and the current check would wrongly block the second one.

**B2. Supplier thresholds watch the wrong stock.**
The thresholds page lists **B's own items** (`/api/items?business_id=<B>`), so `supplier_item_thresholds.item_id` points at B's item. The checker then compares B's stock and fires only when A's sale touches that same item id, which never happens. As a result, B gets no low-stock notifications. The dashboard only works because it falls back to A's `min_stock`.
- Fix: the reorder level belongs to A, so take it from A's item (`min_stock`, plus a reorder quantity, see 3.1). Retire the supplier-set thresholds, or keep them as an optional override that must point at A's item and is checked against the connection.
- Merge the two copies of the check (`lib/low-stock-checker.ts` and the cron route) into one function.

**B3. A can link B without B's permission.**
`POST /api/suppliers` and `PUT /api/suppliers/[id]` accept `linked_business_id` from the client and auto-approve it (migration 099 removed the approval step). Any business can make itself "linked" to any other. That unlocks quantity requests to B and the supplier-relationship route into convert.
- Fix: ignore client-sent `linked_business_id` on create and update. Only an accepted hub connection may set it. Unlinking is allowed from either side.

**B4. Threshold write doesn't check access.**
`POST /api/suppliers/thresholds` doesn't check that `customer_business_id` has linked B and granted low-stock access, or that the item belongs to that customer. This becomes moot if B2 retires the table. If the table is kept, add both checks.

**B5. Smaller issues in convert**
- Items are matched by exact name only. Unmatched lines are saved without an item and get no stock. Fix: use the item map (Phase 2) and stop if lines are still unmapped.
- The unit is hardcoded to `'PCS'`.
- Request notifications show the raw item UUID instead of the item name.

**B6. Listing writes trust client-sent ids.**
`app/api/suppliers/hub/published-listings/route.ts` (and `[id]`) take `business_id` from the body/query fallback and authorise with `created_by_user_id` from the body. That breaks the rule "never trust client-sent `business_id`, `user_id` or `created_by`". Fix: use the session tenant (`requireAuthenticatedTenant`) like the stock-request routes.

## Phase 1 — Relationship, both directions

1.1 **One relationship record, both sides.** Accepting a connection currently creates only A's supplier row. It should also create or link **B's customer row for A**: add `customers.linked_business_id`. B's screens currently find A by **name** (`lookup-customer`, the requests page). Replace that with the link.

1.2 **Stock-sharing switch** on A's side (`allow_low_stock_access`), shown on the supplier page with a clear note about what B will see. It should be on by default only if A agrees during the accept flow.

1.3 **Disconnect** from either side. It ends sharing and stops new requests; past documents stay.

1.4 **Default supplier setup.** Add a bulk screen: "Set B as the default supplier for these items", with filters by category and by past purchases from B. The server checks that the chosen supplier is A's own linked supplier. Optionally, add a backup supplier per item.

## Phase 2 — Item map (core of the feature)

2.1 New table `supplier_item_links`: `buyer_business_id`, `vendor_business_id`, `buyer_item_id`, `vendor_item_id`, `buyer_units_per_vendor_unit` (B sells a carton of 24 and A stocks single pieces), `last_rate`, `is_active`. It's unique per buyer item and vendor.

2.2 **Matching suggestions** by barcode, then HSN plus name similarity (`pg_trgm` is already installed), then B's published listings. Either side can confirm a match. B is usually better at this.

2.3 **The map fills itself over time.** Save it when B picks `responder_item_id` on a request and when A maps a line during receiving. Requests and invoices then fill in the vendor item and unit automatically.

2.4 **Item tables don't have unit conversion yet.** The link's own conversion factor is enough for this feature, so there's no need to change the item tables now.

## Phase 3 — Low stock → suggested order

3.1 **Reorder settings on A's items.** Use the existing `min_stock`, and add `reorder_qty`, or `max_stock` so the suggestion is "max minus current". If neither is set, fall back to average daily sales × lead time.

3.2 **Check on every way stock goes out, not just invoices.** Today the check runs only from `app/api/invoices/route.ts`. It also needs to run for POS, stock adjustments, transfers and returns to supplier. Simplest: one helper called from the shared stock-change functions, plus the cron as a safety net.

3.3 **One alert per pair per day.** For each buyer–supplier pair, build a single draft order listing every low item. Notify B, or A as well if configured. Don't send one notification per item.

3.4 **Orders with many lines.** Today each `quantity_requests` row is one item, and the invoice and purchase are linked per row. Add a `supply_orders` header (`buyer_business_id`, `vendor_business_id`, status, `need_by`, `invoice_id`, `purchase_id`) and make `quantity_requests` its lines (`supply_order_id`). Keep the respond endpoint per line, and add a respond-all endpoint for the whole order.

3.4a **Catalog orders use the same order.** A `supply_orders` line can name B's item (`vendor_item_id`) with A's item still empty. That is what an order from B's catalog looks like: A has never stocked the design. A's item is chosen or created when receiving (5.2a).

3.4b **Variants.** Clothing and footwear run low per size/colour, not per item. Check and order at variant level (`item_variants`). The current reorder suggestions skip items with variants entirely.

3.4c **Standing orders** (dairy, bakery): a repeating order of fixed quantities on fixed days, created automatically and confirmed by default.

3.5 **Who starts the order.** Add a `proposed` status:
- B drafts the quantities and the order waits for A to confirm.
- If A drafts it, it goes straight to `pending` for B.
- Nothing can be invoiced until A has confirmed.

## Phase 4 — B fulfils

4.1 **"Create invoice from order."** The invoice is prefilled with B's mapped items, the confirmed quantities, B's linked customer record for A, and B's prices for A. It links back to the order.

4.2 **Credit check.** Reuse the existing customer credit limit and approval flow (`app/api/credit-approvals/*`) when B invoices A.

4.3 **Partial and backorder lines.** The confirmed quantity goes on the invoice. The rest stays open as a backorder line on the same order, or B can pass it to their own supplier (that pass-up already exists).

4.4 **Optional dispatch status** (packed / dispatched), with a delivery challan link. The `delivery-challans` module already exists.

## Phase 5 — A receives (B's invoice becomes A's purchase)

5.1 **Incoming bills inbox** for A. It lists every final invoice from a linked supplier whose customer is A's linked record, whether or not it came from a request. This also covers ordinary sales between two Khatario users.

5.2 **Receive screen.** For each line it shows the mapped A item (map it here if missing), the invoiced quantity converted to A's unit, and the quantity accepted. Short and damaged quantities are entered separately.

5.2a **Create item from the supplier's line.** For a line with no match (a new design, a new model), A taps "Create as new item". The form is pre-filled from B's item: name, HSN, tax rate, unit, sizes/colours, photo, and cost = B's price. The selling price is suggested from A's markup. Saving creates A's item and the item map entry together, so a later reorder of the same design matches automatically.

5.2b **Batch and expiry carry-over** (pharmacy, FMCG): B's invoice lines carry batch number and expiry date into A's stock batches.

5.3 **On confirm, in one transaction:**
- Create A's purchase from B's tax figures, keeping the existing GST place-of-supply logic.
- Add stock for the accepted quantity.
- Post ledger entries and update A's balance owed to B.
- Set `source_invoice_id`.
- If anything was short, create a **draft debit note** to B (the `debit-notes` module exists) and notify B so they can issue a credit note.

5.4 **Mark the order received** and notify B. B's side needs no new accounting: the sale was recorded when B raised the invoice.

5.5 **Payments.** Optionally, when A records a payment to B against this purchase, suggest the matching receipt on B's side. This can wait for a later phase.

## Phase 6 — Catalog ordering and new-arrival push

Builds on the published catalog that already exists.

6.1 **Richer listings.** Add photos (reuse the online store's image storage), sizes/colours with a price each, MOQ per design, and **sets** (for example 1 each of S/M/L/XL as one pack). Keep `public_preview` for the directory teaser. Linked-only listings have no count limit.

6.2 **Collections.** New table `supplier_collections` (name, season, status draft/published, `published_at`, audience). B groups new designs into a collection and publishes it in one go.

6.3 **The push.** When B publishes a collection to linked customers:
- Every retailer with an **approved** link to B gets **one** notification for the whole collection ("B launched Summer 2027: 24 new designs"), not one per item. Optionally a WhatsApp message through the existing business WhatsApp templates.
- A retailer can **mute** a supplier's launches or follow only some categories (for example "kurtis", not "menswear").
- Retailers who are not linked yet see the collection in the directory only if B marks it public; ordering still needs a connection.

6.4 **New arrivals feed for A.** One screen listing the latest collections from all of A's suppliers: photos, A's price, MOQ, sets, lead time. A fills a cart per supplier and taps **Order**.

6.5 **Order from the catalog.** The cart becomes a `supply_order` (3.4a) with B's items and A's quantities, checked against MOQ and set sizes. If A isn't linked to B yet, the order goes along with the connection request, and B accepts both together. From there it's the normal flow: B confirms → B invoices (Phase 4) → A receives and creates the new items (5.2a).

6.6 **What B learns.** Per collection: which retailers viewed, ordered and reordered each design. A design that gets reordered is a candidate to keep as a running line (and A's reorder alerts then apply to it).

## Phase 6b — Other hub extras (after the core loop works)

- **Price lists per buyer.** Today the hub shows only `from_amount` or "on request". Catalog orders (6.5) use the buyer's price when one is set.
- **Sale-or-return** (apparel, books): at season end A returns unsold stock against the hub invoice; this creates A's purchase return and B's credit note together.
- **Backup supplier** when the default supplier declines or is out of stock.
- **Supplier not on Khatario:** send the draft order as a WhatsApp/PDF link that also invites them to join.
- **Insights for B:** demand forecast across connected retailers, built from the supplier analytics that already exist.
- **Plan gating.** Decide which plans get hub connections, auto-alerts and the inbox. The plan feature list already exists in `lib/featureKeys.ts`.

## Phase 7 — Phone app

Catalog browsing and the new-arrivals feed matter most on the phone: retailers look at new designs on the phone, not on a desktop.

The phone app can already list, create, respond to and link requests. It still needs:
- the incoming bills inbox and receive screen
- order (multi-line) view
- default-supplier picker on items
- connect / accept / disconnect
- the stock-sharing switch

## Phase 8 — Tests

- **API tests** against `kh_phase2_test` only:
  - Tenant isolation: A can't read B's invoice except through a link; B can't read A's stock without sharing on.
  - Repeat import is blocked.
  - Unit conversion is correct.
  - A short delivery creates a debit note.
  - Linking without B accepting is rejected.
- **End-to-end on localhost:** connect, set default supplier, sell down to trigger an alert, B proposes, A confirms, B invoices, A receives with a short line, then check stock, ledgers and both GST registers.

## Decisions (agreed 2026-10-16)

1. **Who starts the order:** B proposes and A confirms. A can also start an order; nothing is invoiced until A has confirmed.
2. **Supplier-set thresholds:** retired. Alerts come from A's own reorder levels (`min_stock`, later `reorder_qty` / `max_stock`).
3. **Inbox scope:** every final invoice from a linked supplier addressed to A, not only invoices from hub orders.
4. **Plans:** still open; decide before Phase 3 ships.

## Suggested order and rough size

| Step | Size |
|---|---|
| Phase 0 (B1–B6) | Done |
| Phase 1 | S–M |
| Phase 2 | M |
| Phase 5 (receive, incl. create item on receive) | M–L — do this before Phase 3, because it pays off even without alerts |
| Phase 3 + 4 (incl. catalog-order lines, variants) | L |
| Phase 6 (catalog ordering, new-arrival push) | L — right after Phase 5 for apparel and electronics customers |
| Phases 6b–7 | L, can come later |
