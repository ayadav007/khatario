# Repack: bulk in, own packs out

Status: **built** (approved 2026-10-17). Migration 439 (written as 398, renumbered when merged on 2026-10-28), `lib/repack-service.ts`, APIs under
`/api/inventory-adjustments/repacks`, web screens at `/inventory-adjustments/repacks`, DB test
`tests/db/repack.db.test.ts`. Not yet built: see "Left for later" at the end.

## Problem

A shop buys rice in 26 kg bags and sells it loose by the kg and in 1 kg packets. Today the
packet is a bundle item (`bundle_items`: "Rice 1 kg pack" = 1 KG of "Rice"), so stock lives only
in KG of Rice. Two things go wrong:

1. **Packing loss.** Filling 26 packets from a 26 kg bag usually gives 25 (spillage, drying,
   the packet's own weight). The books say 26 kg became 26 packets' worth; the shelf disagrees.
   Only a manual Damage adjustment fixes it, which reverses ITC and books an expense that is really
   part of the packet's cost.
2. **No packed stock.** A shop that packs ahead cannot see "40 packets ready, 12 kg loose".

## The action (one screen)

**Repack**: take N of a bulk item out, put M of a packed item in. The difference is wastage,
with a reason.

```
Repack                                            [branch / warehouse]
  From      Rice                      in stock 52 kg
  Take out  [ 26 ] kg        ( 1 bag = 26 kg )  ← chip from the Supplier Hub item map
  Into      Rice 1 kg pack            1 kg each, in stock 4
  Made      [ 25 ] packets
  ----------------------------------------------------------
  Wastage   1 kg (3.8%)   Reason [ Spillage ▾ ]   (only shown when > 0)
  Cost      ₹1,040 → ₹41.60 per packet  (was ₹40.00 a kg)
                                                     [ Repack ]
```

- Four inputs, all prefilled after the first time: the packed item remembers its source and
  content ("packed from Rice, 1 kg each"), and the last quantities are suggested.
- Wastage = N − M × content, shown in the source unit and as a percent. Reasons: Spillage,
  Drying / moisture, Packet weight, Other (free text). Wastage below zero (more packed than taken
  out) is refused with "Packed more than you took out; check the numbers".
- Date defaults to today; one optional note.
- Reachable from: the item page of either item ("Repack" button; on the packed item it opens with
  both items filled), and Inventory → Adjustments ("New ▾ → Repack").
- Undo: a repack can be cancelled while the packets are still in stock (both legs reversed).

### First-time setup

On the packed item: a "Packed from" field (source item + content per unit, e.g. Rice, 1 kg). The
Repack screen can set it inline the first time, so no separate settings visit is needed.

Rules: both items are goods, not services, not bundles, without variants (v1). Source and packed
item must differ. Both legs happen at the same branch (branch mode) or warehouse (warehouse mode).

## Data

Migration `439_stock_repacks.sql`:

```sql
ALTER TABLE items
  ADD COLUMN pack_source_item_id UUID REFERENCES items(id) ON DELETE SET NULL,
  ADD COLUMN pack_source_qty NUMERIC(14,4) CHECK (pack_source_qty > 0);  -- source units per packed unit

CREATE TABLE stock_repacks (
  id UUID PK, business_id UUID NOT NULL, repack_number VARCHAR(50) (RPK-0001, unique per business),
  repack_date DATE NOT NULL, branch_id UUID, location_id UUID (warehouses),
  source_item_id UUID NOT NULL, source_qty NUMERIC(15,3) NOT NULL CHECK (> 0),
  packed_item_id UUID NOT NULL, packed_qty NUMERIC(15,3) NOT NULL CHECK (> 0),
  content_per_unit NUMERIC(14,4) NOT NULL,          -- snapshot of pack_source_qty
  wastage_qty NUMERIC(15,3) NOT NULL CHECK (>= 0),  -- in source units
  wastage_reason VARCHAR(20) CHECK (IN ('SPILLAGE','MOISTURE','PACKAGING','OTHER')),
  wastage_notes TEXT, notes TEXT,
  total_cost NUMERIC(15,2) NOT NULL,                -- cost taken out of source = cost put into packed
  status VARCHAR(10) NOT NULL DEFAULT 'posted' CHECK (IN ('posted','cancelled')),
  out_adjustment_id UUID, in_adjustment_id UUID,    -- the two legs below
  created_by UUID, created_at, cancelled_by, cancelled_at
);

ALTER TABLE inventory_adjustments ADD COLUMN repack_id UUID REFERENCES stock_repacks(id);
-- reason_code CHECK gains 'REPACK_OUT', 'REPACK_IN'
```

`business_id`, `created_by`, branch and location all come from the session, never the request body.

## Stock movements

One repack writes **two inventory adjustments** (both with `repack_id`), in one transaction:

| Leg | Item | Direction | Qty | `value_change` | Reason |
|---|---|---|---|---|---|
| out | Rice | DECREASE | 26 kg | −₹1,040 (FIFO/WA cost of 26 kg) | `REPACK_OUT` |
| in | Rice 1 kg pack | INCREASE | 25 | +₹1,040 | `REPACK_IN` |

Why reuse adjustments instead of a new movement type: everything that already reads adjustments
keeps working with no change — stock-as-of (`lib/inventory/stock-as-of.ts` dates movements by
their adjustment), the FIFO replay (`loadCostMovements` already turns a DECREASE into
`adjustment_out` and an INCREASE with `value_change` into a lot at `value_change / qty`), the
adjustments list and its filters, and branch access checks.

Each leg writes its `stock_movements` row the way `createQuantityAdjustment` does
(`reference_type = 'adjustment'`). The stock code is shared: the quantity part of
`createQuantityAdjustment` moves into a helper that takes a client, so repack runs both legs on one
transaction.

**Movement history** (`lib/stock-movement-label.ts`): `REPACK_OUT` → "Repacked into Rice 1 kg pack",
`REPACK_IN` → "Repacked from Rice"; document number is the RPK number and the link goes to
`/inventory-adjustments/repacks/{id}`. `app/api/items/[id]/movements` passes the repack id and the
other item's name. Opening a repack leg from the Adjustments list goes to the repack page.

**FIFO recost** treats a DECREASE adjustment as a voucher to correct. Repack legs have no voucher by
design, so the FIFO loader tags them (`Movement.repack`) and `recostItems` skips them; otherwise
every recost would post a spurious Inventory/expense pair.

**Branch / warehouse** (`lib/branch-stock.ts`): branch mode moves `branch_item_stock` for both items
at the same branch, then `refreshItemGlobalStockFromBranches` for each. Warehouse mode moves
`location_stock` at one warehouse. Both rows are locked in item-id order to avoid deadlocks with a
concurrent sale. Not enough source stock → refused (same rule as a decrease adjustment).

**Cancel**: marks the repack `cancelled`, puts the stock back (packed −M, source +N) and records
two movements labelled "Repack cancelled". The FIFO loader skips adjustments whose repack is
cancelled. Refused if the packed item no longer has M in stock.

## Cost

- Cost out of the source = what a sale of N would cost today: FIFO lots consumed
  (`fifoCostForDocument` with `adjustment_out`), or the weighted average for WA/simple shops.
- **All of it goes into the packed item**, wastage included: ₹1,040 / 25 = ₹41.60 a packet.
  Normal packing loss is part of the cost of the good units (AS 2 / Ind AS 2), not an expense.
- The packet's `purchase_price` is updated to the new weighted cost of what is on the shelf
  (only for WA/simple shops; FIFO reads lots).
- **No ledger voucher**: Inventory goes down and up by the same amount, so there is nothing to
  post. Trial balance and stock value stay equal.
- Abnormal loss (a torn bag, rats) is not wastage; the screen links "Spoiled stock? Record a
  damage adjustment" so that keeps its expense and ITC treatment.
- Known limit: the packed lot's cost is fixed when the repack is posted. A back-dated bill for the
  bulk item re-costs Rice but not packets already made. Acceptable for v1; a FIFO recost can
  re-link later if needed.

## GST

No tax event. Repacking own stock is not a supply, so no invoice, no output tax and no e-way bill.
Normal packing loss is not "lost or destroyed" under s.17(5)(h), so no ITC reversal (unlike a
Damage adjustment). Both legs carry `gst_impact = 0` and are kept out of GSTR reports, same as
other quantity adjustments that don't reverse ITC. HSN of the packed item is the shop's own
setting; a pre-packaged, labelled packet may carry a different GST rate from loose goods, which
is set on the item as today.

## Bundles and adjustments

- **Bundle packets keep working** unchanged. Bundles suit shops that pack on demand; Repack suits
  shops that pack ahead. The item page of a bundle packet shows "Count packets separately?" with
  one line on what changes.
- **Switching a bundle to counted packets** is only allowed while the bundle has no posted sales:
  the FIFO replay and COGS expand bundles by the item's *current* `is_bundle` flag, so flipping an
  item with history would re-cost old invoices. With history, the switch makes a counted copy
  ("Rice 1 kg pack", same price/barcode/HSN) and archives the bundle, so old invoices stay
  expanded. **Open question 1 below.**
- **Inventory adjustments** stay for stock takes, damage, theft etc. Repack legs show in the
  Adjustments list with a "Repack" tag and open the repack page; they cannot be edited or
  reversed one leg at a time.

## Supplier Hub

`SOLD_LINES_SQL` (moved to `lib/supplier-sold-lines.ts` so it can be tested on its own) gets a third branch: an invoice
line whose item has `pack_source_item_id` is credited to that source item for the full line value,
so a wholesaler who sold the bags still sees the packets sold onward. A packed item the supplier
supplies itself is not credited twice. Bundle crediting stays.

Low-stock alerts to the supplier read the bulk item's stock only; packed stock is not counted
back as bags. **Open question 2.**

## Left for later

- **Bundle packets with sales history → counted packets.** Repack refuses bundle items today. The
  proposed "make a counted copy and archive the bundle" switch is not built; for now the shop
  creates the counted packet item and repacks into it.
- **Packed stock in the supplier's low-stock view** (40 packets of 1 kg counted as 40 kg of rice).
- **Phone app** screen.
- Variants, and repacking across branches/warehouses in one step.

## Deploy note

The FIFO loader now reads `stock_repacks`, so migration 439 must be applied before this code runs
anywhere (it is applied only to `kh_phase2_test` so far).
