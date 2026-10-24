# FIFO inventory costing (perpetual) — plan

Status: approved for build (Oct 2026). Reference model: Zoho Books FIFO cost lots.

## 1. Problem

`business_settings.stock_valuation_method` defaults to `fifo` and reports print "FIFO", but every
perpetual posting uses `weightedAverageCosts()` in `lib/inventory/cogs-posting.ts`: one blended rate of
(opening stock + all purchases to date) ÷ quantity. Consequences seen in the Zoho comparison (Oct 2026):
COGS ₹4,070 in Khatario vs ₹4,700 in Zoho for the same documents, and the stock valuation report values
closing stock at the same blended rate.

## 2. How Zoho does it (verified in the QA org)

- Each inward transaction creates a cost lot at its actual cost: opening stock, bill, customer credit note.
- Each outward transaction consumes the oldest open lots: invoice, vendor credit, quantity adjustment.
- Selling with no stock is allowed; the unmatched quantity is matched to the next inward lot when it
  arrives (lot report shows "Qty remaining −5").
- Backdated documents re-run the matching from that date and correct the COGS of later documents.
- "FIFO Cost Lot Tracking" report: lots with date, document, party, qty, cost/unit, remaining qty, and the
  outward documents that consumed each lot.

## 3. Decisions

| Topic | Decision | Why |
|---|---|---|
| Method scope | Business-wide (`business_settings.stock_valuation_method`). `items.valuation_method` stays ignored for posting. | Migration 167 already defines the business setting as the override; the per-item column defaults to `simple` on every item, so honouring it would silently switch everything to purchase-price costing. |
| Methods | `fifo` uses the new lot engine. `weighted_avg` / `simple` keep today's `weightedAverageCosts()` unchanged. | Limits blast radius; non-FIFO businesses see no change. |
| Cost pool | One pool per item per business (all branches/warehouses). | Same-GSTIN stock transfers move no value today; branch pools would need transfer lots and are a later phase. |
| Source of truth | Lots are computed on demand by replaying source documents, not stored. | No second ledger to drift; edits/cancellations are reflected automatically. |
| Negative stock | Allowed (as today). Unmatched quantity is costed from the next inward lot (Zoho behaviour); if none exists yet, at a fallback rate (last inward cost, else opening rate, else item purchase price). | Matches Zoho; never posts ₹0 COGS. |
| History | Cut-over. A new column `business_settings.fifo_recost_from` is set to the migration date for existing businesses; automatic recosting never touches vouchers dated before it. A manual recost (preview first) can restate earlier unlocked periods. New businesses get NULL = no limit. | Avoids silently restating closed months on deploy; restatement is a deliberate action. |
| Locked periods | Recost never posts into a locked period (`isPeriodLocked`); such vouchers are reported as skipped. | Period locks are a control. |
| Corrections | Recost posts a delta line pair inside the original voucher, on its original date, narration `FIFO cost recalculation - <ref>`. Never edits or deletes lines. | The ledger is append-only (reversal table, delete guard). |

## 4. Movements replayed per item (ordered by date, then created_at, then id)

| Movement | Source | Included when | Lot effect | Unit cost |
|---|---|---|---|---|
| Opening stock | `items.opening_stock` + variants' `opening_stock` | qty > 0 | inward, first | same value as the opening-stock voucher |
| Purchase | `purchase_items` (goods, not service line, not HSN 99*, not capital goods) | purchase status not draft/cancelled, not deleted | inward | `taxable_value / quantity` (what 1104 is debited) |
| Invoice | `invoice_items` (bundles expanded to components) | invoice voucher has an active ledger posting, or it is the document being posted | outward (consume) | FIFO result |
| Inter-branch invoice | invoice referenced by `stock_transfers.inter_branch_invoice_id` | as invoice | **peek** (cost without consuming; goods stay in the business pool) | FIFO result |
| Credit note | `credit_note_items` (bundles expanded) | credit-note voucher active, or being posted | inward | linked invoice's FIFO unit cost for that item; else last outward unit cost; else fallback |
| Purchase return | `purchase_return_items` | return not cancelled | outward; consumes the linked bill's lot first, then FIFO | FIFO result (posting unchanged: Cr 1104 at returned taxable value) |
| Quantity adjustment − | `inventory_adjustments` QUANTITY/DECREASE | not reversed | outward | FIFO result |
| Quantity adjustment + | QUANTITY/INCREASE | not reversed | inward | posted `value_change / qty`, else last inward cost |
| Value adjustment | VALUE | not reversed | spreads `value_change` over open lots pro rata | — |

Same-GSTIN stock transfers are ignored (no business-level quantity change).

## 5. Components

1. `lib/inventory/fifo-engine.ts` — pure, DB-free. Input: ordered movements. Output: per-movement cost and
   allocations (which lot, qty, unit cost), open lots, unsettled deficits. Supports `asOf` cut-off.
2. `lib/inventory/fifo-costing.ts` — loads movements for a set of items, runs the engine, exposes:
   - `getValuationMethod(client, businessId)`
   - `lockCostItems(client, businessId, itemIds)` — `pg_advisory_xact_lock` per item, sorted.
   - `fifoCostForDocument(client, businessId, itemIds, target)` — cost of one document's goods.
   - `fifoIssueUnitCosts(client, businessId, itemIds, date)` — unit cost of the next unit out (peek).
   - `fifoOpenLots(client, businessId, itemIds, asOf)` — for valuation and the lot report.
3. `lib/inventory/fifo-recost.ts`
   - `recostItems(client, businessId, itemIds, { fromDate, dryRun })` — replays the items (plus every other
     item on the affected vouchers), compares each voucher's expected cost with its net 1104 posting, posts
     deltas, returns a report (posted / skipped-locked / unchanged).
   - `recostAfterStockChange(client, businessId, itemIds)` — wrapper used by posting code: FIFO only,
     uses `fifo_recost_from`, runs inside a SAVEPOINT so a recost failure never blocks the document.
   - Vouchers recosted: `invoice` (5104/1104), `credit_note` (1104/5104), `stock_adjustment` quantity
     decreases (counter account/1104), `inter_branch_receipt` (1104/inter-branch purchases).
4. `lib/inventory/cogs-posting.ts`
   - `computeGoodsCost(..., target?)` — FIFO businesses use `fifoCostForDocument` (or peek when no target).
   - `currentUnitCosts(...)` — FIFO peek or WAC; replaces direct `weightedAverageCosts` use in stock
     transfers, inter-branch invoice pricing, quantity adjustments and the valuation report.
5. Posting hooks (`recostAfterStockChange`): invoice, credit note, purchase (goods > 0), purchase return
   (goods > 0), quantity adjustment, opening stock sync; and in invoice cancel, credit-note cancel,
   purchase-return cancel and purchase cancel (after the status update, because purchases and returns are
   selected by status). Inter-branch transfer cancel needs none: those invoices only peek at lots.
6. Migration `333_fifo_costing.sql`: `fifo_recost_from` column + backfill, item_id indexes on line tables.
7. API
   - `GET /api/reports/stock/fifo-lots?item_id=&as_on_date=` — lots, consumption, deficits, and a
     reconciliation of open-lot value vs the 1104 ledger balance.
   - `POST /api/inventory/fifo-recost` `{ from_date?, item_ids?, dry_run }` — preview (report.inventory read)
     or apply (settings update).
8. UI: `app/(app)/reports/stock/fifo-lots/page.tsx` (Zoho-style lot table, preview + apply recost).
   Stock valuation report uses FIFO open lots when the business method is FIFO.

## 6. Concurrency and safety

- Cost is computed after the document's rows are inserted, under per-item advisory locks taken in sorted
  order, so two concurrent sales of the same item cannot consume the same lot.
- Recost runs inside a SAVEPOINT; on any error it rolls back to the savepoint and logs. The document
  itself still commits with its own correctly computed cost.
- Deltas below ₹0.01 are ignored; repeated recosts are idempotent because expected cost is compared with
  the ledger's current net.

## 7. Known limitations (documented, not in this phase)

- Purchase-return inventory credit stays at the returned taxable value; if the linked lot was already sold
  the difference stays in 1104 until a stock-take adjustment.
- ITC reversal on loss adjustments keeps the amount computed at posting time.
- Per-branch cost pools and landed-cost allocation are out of scope.
- Weighted average remains the existing period-blind average, not Zoho's moving average.

## 8. Verification of the plan against the code

| Assumption | Evidence |
|---|---|
| Purchases debit 1104 with goods-line `taxable_value` only (not services, HSN 99*, capital goods) | `app/api/purchases/[id]/finalize/route.ts` inventory query; `purchase-create-service.ts` |
| Sales COGS is posted only in `createInvoiceLedgerEntries`, `createCreditNoteLedgerEntries` and `createInterBranchInvoice` | grep of `postCostOfGoods` |
| Invoice/credit-note COGS lines are the only 1104 lines on those vouchers | `ledger-utils.ts` invoice and credit-note posting |
| Cancellations post mirror lines linked in `ledger_entry_reversals`; deletes are blocked by trigger | `lib/ledger-reversal.ts`, migrations 323/324 |
| Locked periods: DB function `is_period_locked(business, branch, date)` is available inside the transaction | migrations 123/189 |
| Vouchers must balance at commit (deferred trigger) — delta pairs balance | `validate_voucher_balance` |
| `items.valuation_method` defaults to `simple`; migration 167 says the business setting overrides it | migrations 077, 167 |
| Purchases and purchase returns are selected by status, so cancel hooks go after `status = 'cancelled'` | `cancel-purchase.ts` line ~210, purchase-return cancel route |
| Quantity adjustments block negative stock; invoices do not | `inventory-adjustment-service.ts` |
| Inter-branch receipt is dated on the invoice date and capitalises the invoice's 1104 credit | `stock-transfers/[id]/receive/route.ts` |
| Existing unit tests that drive `createPurchaseLedgerEntries` pass no `inventoryAmount`, so the purchase hook (goods > 0) does not change them; `reverseVoucherLedgerEntries` is not modified | `tests/lib/accounting/purchase-ledger-scheme.test.ts`, `tests/lib/gst/return-helpers.test.ts` |

## 9. Tests

- Engine unit tests: Zoho doc example (20@10 + 10@12, sell 25 → 260); the QA org scenario from Zoho's lot
  report (INV-000004 = 10×100 + 2×150 = 1,300); negative stock settled by a later lot; fallback when never
  settled; credit note at the invoice's cost; purchase return consuming its own bill's lot; value adjustment;
  peek; `asOf`.
- Recost unit tests with a fake client: delta direction for invoice and credit note, locked period skipped,
  cut-over respected, dry run posts nothing.
- `tsc` clean; existing ledger tests unchanged.
