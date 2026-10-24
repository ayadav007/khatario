# Orders & delivery: closing the gaps with Shopify-style fulfilment

Started 14 Oct 2026. Source: the audit of `lib/fulfilment/*`, `app/api/orders/*`, `app/(app)/orders`, the store checkout and the Shiprocket integration.

Rules for this work:
- Migrations are written under `database/migrations/` and tested only on the disposable DB `kh_phase2_test`. They are **not** applied to staging or production by this work.
- Tax, stock and ledger maths stay on the server; returns reuse the existing credit-note logic.
- `business_id` and the acting user always come from the session.
- Website and phone (Flutter) get the UI for each change.

## Phases

| # | Gap | Phase | Status |
|---|---|---|---|
| 1 | Online store checkout does not check or reserve stock | A | done: `lib/store/checkout-stock.ts`, hold on order, released on invoice or cancel; storefront "Update my cart" |
| 2 | "Returned" on WhatsApp / manual / sales orders does nothing to the bill, stock or money | A | done: "returned" delivery opens a return (`lib/returns/service.ts`); credit note via `lib/credit-notes/create-credit-note.ts`; web Returns tab and drawer |
| 3 | Online store order returned after delivery is not reversed | A | done: store order returned after delivery goes through the same return; RTO still cancels the bill |
| 4 | No return request (customer or merchant), restock vs damaged, refund or credit | A | done: `order_returns` (migration 380); buyer "Return items" in store account; approve / reject / receive (restock vs damaged) / refund cash-UPI-bank (`credit_note_refunds` voucher) or keep as credit |
| 5 | Parcels do not record which items they carry | B | done: `order_fulfilment_items` (migration 381), `lib/fulfilment/parcel-items.ts`, drawer "Send only some items", per-parcel slip and Shiprocket items |
| 6 | No bulk actions on the order list | B | done: select orders, Confirm / Mark packed / Packing slips in one go |
| 7 | No pick list across orders | B | done: `/api/orders/pick-list`, printable A4 pick list (selected or all to pack) |
| 8 | Own rider / Porter gets no pickup details or way to update status | C | done: rider link `/r/<token>` (no login) with Start / Delivered / Could not deliver / cash collected; "Send drop to rider" WhatsApp from the drawer |
| 9 | No failed-delivery (NDR) follow-up with Shiprocket | C | done: What next? Try again (date, phone) / New address / Bring it back; Shiprocket NDR API for Shiprocket parcels |
| 10 | No COD remittance reconciliation | C | done: "COD cash" on the orders page matches courier or rider payouts to delivered COD parcels (`cod_remittances`), shortfall kept as charges |
| 11 | Parcel dimensions not sent to Shiprocket | C | done: L x B x H on the parcel, sent to Shiprocket |
| 12 | Manual bills that need delivery start untracked | D | done: manual final bills with a shipping address start tracking (setting "Track bills that have a shipping address", on by default) |
| 13 | No order edit before packing | D | done: "Edit order (before packing)": remove items (credit note, stock back, parcel/pick list/slip leave them out), add items as a new bill; unbilled sales orders open their editor |
| 14 | No customer notice when a parcel is stuck | D | done: `/api/cron/stuck-parcels` sends one "taking longer" WhatsApp (`order_delayed` event) after N days; "Late in transit" card on the hub |
| UI | Phone app has no Orders & delivery screen (generic list only) | all | done: phone `lib/screens/orders/` (list with needs-action cards and Returns, order detail with next step, dispatch, rider, failed delivery, returns); web Returns tab, bulk bar, pick list, COD cash, edit order |

Each phase ends with: migration tested on `kh_phase2_test`, Jest tests, website UI, Flutter UI, and a note here.

## Notes (14 Oct 2026)
- Migrations 380 and 381 are tested on `kh_phase2_test` only (applied twice, idempotent). Apply them to staging before deploying this code.
- New cron: `/api/cron/stuck-parcels` (every 3 hours), added to `docs/SERVER_INFRASTRUCTURE.md`.
- COD remittance is tracking only: it does not post a bank receipt. Store COD cash collected by staff or rider still posts its receipt as before.
- Pre-existing failures not caused by this work: phase3-5/6a/6b route permission tests, store-order-safety, phase3-3 draft payment, sales-reports-zoho (same failures on the committed code).
