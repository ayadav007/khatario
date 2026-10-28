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
