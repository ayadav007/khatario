---
title: Scan & Add, units, repacking and stock checks
audience: [tenant_user]
locale: en
tags: [scan and add, barcode, label photo, batch, expiry, opening stock, alternate unit, box, bag, repack, packets, merge duplicate, stock count, physical count, held stock, quarantine, goods in transit, returnable challan, how to]
url: /items
---

# Scan & Add, units, repacking and stock checks: how-to

## How do I add many items quickly by scanning?

Use **Scan & Add Items** in Inventory > Items (on the web and in the phone app). It is on every plan.

1. Scan the barcode with a scanner or the phone camera. Khatario first checks whether the shop already has it ("Already in your shop").
2. For a new product, Khatario looks the barcode up in product databases and fills what it finds. If they have nothing, take photos of the label: the front (name), the pack size, and the panel with MRP, batch and dates. Khatario reads them for you. Check the name and pack size against the pack before saving.
3. Enter the GST rate, HSN, purchase and selling price, and the stock you have now (with batch, mfg and expiry date if needed), then save. The front photo becomes the item's picture.
4. For a product you already have, tap **Add stock** to add quantity, or add a new size of it.

At the end, the review shows what each scanned item still lacks. An unfinished session stays on the device and is offered back when you reopen Scan & Add.

Barcode scan karke item kaise jode? Inventory > Items > Scan & Add Items kholo, barcode scan karo, details check karke stock daalo aur save karo.

## How do I sell in boxes or bags as well as pieces?

Give the item alternate units in Inventory > Units & Duplicates > **Alternate units**: for example BOX = 12 PCS or BAG = 50 KG, with an optional selling price for one unit and a box barcode. On invoices, sales orders, challans, POS and the phone bill you can then pick the unit on each line. Stock, returns, reports, GSTR-1 HSN and e-way bills always count it in the base unit (one box = 12 pieces). A box is priced at its own price if you set one, otherwise at the piece rate × 12. Scanning the box barcode at the counter adds one box. Stock counts can be entered in any of the units too.

## How do I turn a bulk bag into my own packets (repack)?

Open the bulk item and tap **Repack** (or Inventory > Adjustments > Repack). Choose the bulk item in **From** and your packet item in **Into**, enter how much you took out and how many packets you **Made**, and give a wastage reason if some was lost (spillage, drying or moisture, packet weight). The packets get their own stock and carry the whole cost of what was taken out. No voucher and no GST entry is made. A repack can be cancelled while the packets are still in stock.

Bori se packet kaise banaye? Item kholkar Repack dabao: kitna kilo nikala aur kitne packet bane, wo daalo. Packet ka stock aur cost apne aap ban jata hai.

## How do I merge an item entered twice?

Go to Inventory > Units & Duplicates > **Merge a duplicate**. Choose the duplicate and the item to keep. A preview shows what will move; then every bill, movement and stock quantity moves to the item you keep and the duplicate is removed. A merge cannot be undone. Khatario refuses merges that aren't safe, for example items with different units, variants or an open stock count.

## How do I do a physical stock count?

Go to Inventory > Stock Counts and choose the godown to count. While the count is open the godown is frozen, and counters don't see the book quantity. Enter or scan what you find (in any unit of the item). When counting is closed, review the differences, give a reason for each (damaged, expired, own use, lost in transit and so on; a note is needed for a large difference), and post it. Every difference is posted as a stock adjustment and the count is locked. The count also shows goods that are billed but still on the way, and goods held by others, so they aren't mistaken for missing stock.

## How do I keep damaged or quarantined stock out of sale?

Inventory > **Held & Others' Goods**. Put stock on hold (quarantine, damaged awaiting decision, a return awaiting inspection, sold but not collected). It stops being saleable but a stock count still expects it. Later **Release** it back to saleable stock or **Write off** it. The same page keeps a register of other people's goods in your godown (in for repair, job work for them, kept for them), which counts check against too.

## What if I have billed a purchase but the goods haven't arrived?

On the purchase bill tick **Goods not yet arrived**. The bill, its cost and input tax credit are booked now, but the goods count as in transit from the supplier, not in the godown. When they come, open the purchase and tap **Goods arrived** to receive them in full or in part.

## Where do I see our stock that is with other people?

Inventory > **Stock with Parties** lists stock held by others (sent on a returnable challan for repair, job work, approval, consignment, exhibition or demo), stock in transit between godowns and bills on the way from suppliers, with how many days each has been out.
