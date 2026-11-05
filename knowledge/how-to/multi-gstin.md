---
title: Branches, godowns and more than one GSTIN
audience: [tenant_user]
locale: en
tags: [multiple gstin, multi gstin, branch, godown, warehouse, other state, additional place of business, apob, gstr-1 per gstin, stock transfer, delivery challan, e-way bill, how to]
url: /settings/branches
required_feature: settings_multi_branch
---

# Branches, godowns and more than one GSTIN: how-to

## Can I have a branch in another state?

Yes, but GST registration is per state, so a branch in another state needs its own GSTIN for that state. When you add or edit a branch in Settings > Organization > Branches, Khatario refuses a branch in another state that has no GSTIN or uses the head office's GSTIN, and a GSTIN that doesn't match the branch's state. Branches in the same state can share the head office's GSTIN; they print their own address with the head office's GSTIN. Branches are on the Business plan (see the plans document).

Branches or godowns saved before this check show a red note on the settings list if they break the rule. Fix the state or GSTIN there.

Dusre state mein branch kaise banaye? Us state ka alag GSTIN chahiye. Settings > Organization > Branches mein branch banate waqt us state ka GSTIN daalo.

## Can my godown be in another state?

A godown must be in the same state as the GSTIN it belongs to: its branch's GSTIN, or the head office's if it has no branch. A godown in another state needs a branch registered in that state. Khatario also blocks an invoice or challan whose godown is in a different state from its branch's GSTIN.

## How does GSTR-1 work with more than one GSTIN?

Each GSTIN files its own GSTR-1. Pick a branch under that GSTIN with the branch selector in the top bar, then prepare and download GSTR-1 in Reports > GST Reports > GSTR-1; the JSON carries that branch's GSTIN. Mark each registration's return filed separately; marking one filed locks only the branches under that GSTIN. Each GSTIN also keeps its own invoice number series, so two registrations never share a prefix.

## What paperwork does a stock transfer between godowns need?

- Between godowns under the **same GSTIN**: when the transfer is dispatched, Khatario makes a delivery challan for it (no tax, valued at cost), numbered from the sending branch's challan series. Print it and make its e-way bill JSON from the challan if the goods need an e-way bill. The challan follows the transfer: cancelling the transfer cancels it, and receiving everything marks it delivered.
- Between **different GSTINs**: this is a supply, so the transfer is billed with an inter-branch invoice as before.

The e-way bill JSON takes the GSTIN and state from the registration and the dispatch address from the godown, so godowns need an address and PIN code.
