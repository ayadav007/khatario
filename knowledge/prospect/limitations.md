---
title: What Khatario does not do (yet)
audience: [prospect, tenant_user]
locale: en
tags: [limitations, not supported, e-invoice, e-way bill, e-way bill json, tally, ios, iphone, usb printer, kot, restaurant, api]
url: /book-demo
---

# What Khatario does not do yet

These are honest answers to common questions. If one of these is essential for you, book a demo and tell the team.

## Does Khatario generate e-invoices (IRN)?

No. Khatario does not create e-invoices (IRN / QR code) with the government e-invoice portal.

## Does Khatario generate e-way bills?

Not directly. Khatario does not connect to the e-way bill portal, so the e-way bill itself is generated there. Khatario helps on both sides:

- On a delivery challan, **E-way bill JSON** downloads Part A for the portal's bulk upload, so you don't type it again.
- Record the e-way bill number, date and validity on the invoice or challan so it prints, and see every recorded e-way bill in **E-way Bills**.
- In E-way Bills, import the CSV of e-way bills that suppliers generated against your GSTIN; matching ones are attached to their purchase bills.

E-way bills start on the Starter plan, with a monthly limit on Starter and Growth (see the plans document).

## Can I make a bill without an internet connection?

No. Saving a bill needs an internet connection. Reconnect, then save the bill.

## Does Khatario file GST returns directly on the GST portal?

No. Khatario prepares GSTR-1 and GSTR-3B and exports them (Excel, offline-tool Excel or JSON) for you or your CA to upload on the GST portal. After filing you can mark the return as filed in Khatario to lock the period.

## Is there an iPhone app?

No separate iOS app; the Khatario phone app is on Android only. On a paid plan, use Khatario in Safari on iPhone or iPad and add it to the home screen. The Free plan works only in the Android app, so on an iPhone you need Starter or above.

## Can I print to a USB or network (Wi-Fi) thermal printer?

Not directly yet. Direct thermal printing works over Bluetooth. For USB or network printers, print the PDF through your computer's printer driver.

## Does Khatario have KOT (kitchen order tickets) for restaurants?

No. Khatario does not have a restaurant KOT or table-management module. Restaurants and cafés can still bill and keep accounts: choose the Restaurant / food service business type at sign-up so the books don't claim input tax credit on expenses, as standalone restaurants paying 5% GST can't.

## Can I export data to Tally?

No. There is no Tally export. Reports can be exported to Excel for your accountant.

## Is there a public API I can use?

There is no self-service API key system for customers today. If you need an integration, book a demo and discuss it with the team.

## Can I bulk-import customers from a file?

Not today. Items can be imported from CSV; customers are added from the Customers screen or while billing.
