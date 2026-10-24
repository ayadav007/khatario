---
title: How to set up GST in Khatario
audience: [tenant_user, prospect]
locale: en
tags: [gst, gstin, gst setup, gst registration, composition, unregistered, hsn, tax rate, igst, cgst, sgst, place of supply, how to]
url: /settings/business#bp-gst
---

# Setting up GST in Khatario

## How do I set up GST in Khatario? (GST setup for owners)

Setup takes about five minutes and is done once:

1. Go to Settings > Business profile. Fill in the business name, address and **State**. The state decides whether a sale is charged CGST + SGST or IGST, so it must match your GST registration.
2. In the same page, scroll to **GST & Tax Information**:
   - **GST Registration Type**: choose Regular (Normal GST), Composition Scheme or Unregistered (No GSTIN).
   - **GSTIN**: enter your 15-character GSTIN (for example 27ABCDE1234F1Z5). It is not needed if you chose Unregistered.
   - **PAN**: optional, printed on documents.
   - Tap Save.
3. Set a GST rate on every item: Inventory > Items > New Item (or edit an item). Search the **HSN/SAC Code** by product name; picking a code fills the **Tax Rate (%)** automatically. Tick **GST Included in Selling Price** if your price already includes GST, and Khatario calculates the tax backwards.
4. Add your customers' GSTIN and state: Sales > Customers > New customer. Enter the GSTIN and Khatario looks up the business details and fills them in. The customer's state becomes the invoice's place of supply.
5. Optional: Settings > Transaction number series to set the invoice prefix and starting number for the financial year.

After this, every invoice calculates GST on its own. No separate tax master needs to be set up.

## GST number kaha dalna hai? GST kaise setup kare?

Settings > Business profile kholo, neeche **GST & Tax Information** section mein GST Registration Type (Regular / Composition / Unregistered) chuno aur apna 15 digit GSTIN daalo, phir Save karo. Uske baad har item mein HSN code aur GST rate (Tax Rate %) set karo, aur customer banate waqt unka GSTIN aur state daalo. Bas, ab har bill par GST apne aap lagega.

## Which GST registration type should I choose?

- **Regular (Normal GST)**: you charge GST and issue Tax Invoices. Most businesses choose this.
- **Composition Scheme**: all invoices are automatically created as a Bill of Supply without GST, as the law requires for composition dealers (Section 10 of the CGST Act).
- **Unregistered (No GSTIN)**: for businesses below the GST threshold. You can bill without a GSTIN and no GST is charged.

If you are not sure which one applies to you, check your GST registration certificate or ask your CA.

## I am under the composition scheme. How do I bill?

Set GST Registration Type to Composition Scheme in Settings > Business profile > GST & Tax Information and enter your GSTIN. After that, create bills normally from Sales > All Invoices: Khatario automatically makes every bill a Bill of Supply with no GST charged, so you cannot issue a Tax Invoice by mistake. Choose a Bill of Supply template in Settings > Sales & billing > Templates & printing if you want to change its design.

## How does Khatario decide CGST + SGST or IGST?

Automatically. Khatario compares your business state with the invoice's place of supply (the customer's state):
- Same state: CGST + SGST, each half the item's rate.
- Different state: IGST at the full rate.
- Export invoices use IGST. Exports under LUT (without payment of tax) are billed at 0% IGST.

You can change the place of supply on the invoice screen if the goods go to a different state.

## I have branches in different states. How do I add a GSTIN for each?

Go to Settings > Branches and add or edit a branch. Each branch can have its own GSTIN, state, address and invoice numbering, and invoices from that branch use its details.

## I don't know my item's HSN code or GST rate. What do I do?

Type the product name in the HSN/SAC Code search on the item form (for example "biscuit" or "software"). Pick the best match and the GST rate fills in. Codes starting with 99 are service (SAC) codes, and the item is switched to a service automatically. You can also use More > Tools > HSN/SAC Finder.

## Can I change GST settings later?

Yes. Edit Settings > Business profile or the item any time. Changes apply to new invoices; invoices already created keep the tax they were saved with.
