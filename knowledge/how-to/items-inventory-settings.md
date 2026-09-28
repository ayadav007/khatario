---
title: Item and inventory settings (categories, variants, warehouses, labels, custom fields)
audience: [tenant_user]
locale: en
tags: [item categories, item defaults, product variants, out of stock, warehouse, godown, user warehouses, label templates, barcode label, custom fields, how to]
url: /settings/business#bp-features
---

# Item and inventory settings: how-to

## How do I create item categories?

Go to Settings > Inventory & items > Item categories and tap Add Category. Enter the Category Name (for example Grocery, Best Seller, Offers) and an optional Description, then tap Add Category. Pick the category on each item using the Category (optional) dropdown on the item form.

Categories are a single list (no sub-categories) and are also used to group products in your online store. Categories cannot be renamed yet; to change one, add the new name, move the items, then delete the old one. A category that still has items cannot be deleted.

## What are item defaults?

Settings > Inventory & items > Item defaults opens the Product Features section of Business profile. Each switch saves immediately:
- **Enable Product Variants**: for items sold in sizes or colours (garments, footwear, textiles). Each variant gets its own stock and price.
- **Default: allow sales when out of stock**: decides whether new items can be billed when stock is short. You can still override it on each item.
- **Enable Warehouse**: turns on multiple warehouses or godowns.
- **Auto-Assign Branch Warehouses**: users with access to a branch automatically get its linked warehouses.
- **POS Mode**: fast counter billing screen (see the POS mode guide).

There is no default unit or default GST rate setting; set those on each item.

## Can I sell an item when stock is zero?

Yes, if allowed. Set the business default in Settings > Inventory & items > Item defaults (Default: allow sales when out of stock), or override it on the item. If sales are blocked, the invoice will not save when stock is insufficient.

## How do I set up multiple warehouses or godowns?

1. Turn on Enable Warehouse in Settings > Inventory & items > Item defaults.
2. Go to Settings > Organization > Warehouses and tap Add Warehouse. Enter the Warehouse Name, an optional Warehouse Code, address, and Warehouse Type (Physical Warehouse, Virtual Warehouse for dropshipping, or Damaged Goods Holding). Tap Create Warehouse.
3. For your first warehouse, Khatario offers to move existing stock into it (Migrate Stock). Choose Migrate Stock unless you want to start fresh.
4. Edit the warehouse and use Manage branch links to link it to a branch. A warehouse that is not linked to any branch cannot be used on invoices.

Move stock between warehouses with Inventory > Stock Transfers. Multiple warehouses are part of higher plans; on other plans the switch is disabled with an upgrade message.

## How do I control which warehouses a staff member can use?

Settings > Users & access > User warehouses > Assign User: choose the user and the warehouse. Users can then bill, purchase and adjust stock only from their assigned warehouses. If Auto-Assign Branch Warehouses is on, users also get every warehouse linked to their branch automatically.

## How do I design barcode labels?

Go to Settings > Inventory & items > Label templates. Built-in (system) templates are read-only; tap Duplicate on one to make your own copy, or tap New Template.
1. Enter a Name and choose the Format: Continuous Roll / Thermal (label printers) or A4 Sticker Sheet (set Columns, Rows per page, margins and gaps).
2. Set Width and Height in mm to match your label.
3. Under Add Field, add what you want printed: product name, barcode, barcode text, selling price, MRP, HSN, batch, expiry date, business name and more.
4. Drag fields on the canvas and resize them from the corner; set font size, alignment, bold, and a prefix such as "MRP ".
5. Tap Save. Print labels from Inventory > Print Labels.

The Label Template Designer depends on your plan; if it is locked you will see an upgrade message.

## How do I add custom fields to items or invoices?

Go to Settings > Sales & billing > Custom fields and tap Add field under Item fields or Invoice fields. Enter the Field label (for example Batch No, Vehicle No, Manufacturing date), choose the Type (Text, Number, Date or Dropdown with comma-separated options), tick Required on forms if needed, and tap Save field.

To print a custom field, turn it on in Settings > Sales & billing > Templates & printing > Customize > Fields. Item fields print on invoice lines; invoice fields print below the invoice number and date. Custom fields are available for items and invoices only (not customers), up to 25 of each. Fields cannot be edited after saving; remove and add again instead.
