# Khatario project log

Append only. Newest entry at the bottom. Format and rules: [brain.md](brain.md).

## 2026-10-28: Agent memory files
- **Asked:** set up a project log and a roadmap board so agents keep the reasons behind past work, with one front-door file linked from the agent instructions.
- **Decided:** `docs/brain.md` is the front door, linked from `AGENTS.md`. `docs/project.log.md` is append only. `docs/roadmap.md` uses headings as columns and bullets as cards. The existing `docs/BACKLOG.md` stays as the parked-feature detail, and `docs/IMPLEMENTATION-LOG.md` (last updated Aug 2026) becomes read-only history rather than being migrated. Roadmap cards were seeded from recent commits and plan docs, so their order is a first guess for the owner to correct.
- **Shipped:** `docs/brain.md`, `docs/project.log.md`, `docs/roadmap.md`, one line in `AGENTS.md`. Nothing committed.
- **Open:** owner to reorder the Now and Next columns.

## 2026-10-28: Short and damaged goods on a received Supplier Hub bill (F-008)
- **Asked:** staging QA found a damaged oil tin landing in sellable stock when a buyer received a hub bill. The owner chose to give each business a choice.
- **Decided:** two modes in `business_settings.settings.receipt_shortfall_mode` (jsonb, no migration). `keep` (default, unchanged): all billed goods go into stock and the receipt records short/damaged for a later purchase return. `auto_return`: receiving also raises debit note `DN-<bill no>` (dated today, or the bill date if later) for short + damaged. Holding goods out of stock without a return was rejected: a later manual return would take them out twice. The core of `POST /api/purchase-returns` moved into `lib/purchases/create-purchase-return.ts` (`createPurchaseReturnInTx`) and both routes call it, so stock, supplier and bill balance, ledger, GST readiness and the supplier's money notice all move the same way. If the debit note cannot be raised (period locked, GST filed), the whole receipt is refused rather than half-done.
- **Shipped:** setting at Settings → Supplier Hub (`/settings/suppliers-directory#receipt-shortfall`) via `GET/PATCH /api/settings/receipt-shortfall`; the receive-bill screen says which mode applies. Tests: `tests/db/supplier-bill-shortfall.db.test.ts` on `kh_phase2_test`.
- **Open:** a line received into a size/colour variant still has its return taken from item stock, as manual purchase returns already do. Not run on staging. `tests/db/purchase-reports-zoho-scenario.db.test.ts` fails on this DB with "Session revoked" before reaching changed code (test setup, not this change).

## 2026-10-28: Purchase returns move the size or colour's stock
- **Asked:** fix the gap left by F-008: goods bought into a size or colour (variant) were returned out of the item's own stock, by the new auto-return and by manual purchase returns.
- **Decided:** `purchase_return_items.variant_id` (migration 436, written; applied only to `kh_phase2_test` by the tests; numbered 436 because 433–435 already exist untracked in the main checkout). Return lines match the bill by item and variant. An item bought in one variant on the bill needs no variant in the request; one bought in several is refused with `RETURN_VARIANT_REQUIRED`. The returnable cap and the stock value taken off are per bill line, so each size is capped and valued at its own cost. Returns recorded earlier with no variant count against the item's only variant on that bill. Freight refund slices stay per item. Cancelling a return follows its stock movements, which now carry `variant_id`, so older returns cancel as before. The return form shows one line per size ("Kurti Floral (Blue / L)") and sends the variant; a receipt prefill is spread across the item's sizes rather than repeated on each.
- **Shipped:** see the commit after this entry. Tests: variant case in `tests/db/supplier-bill-shortfall.db.test.ts`, unit cases in `tests/lib/purchases/purchase-return-lines.test.ts`.
- **Open:** migration 436 must be applied before this code is deployed. The supplier's own receipt prefill (`return_qty` from the receive screen) is per item, not per size. Not checked in a browser.
