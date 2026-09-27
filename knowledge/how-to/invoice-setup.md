---
title: How to set up your invoice (number, logo, bank details, terms, printing)
audience: [tenant_user]
locale: en
tags: [invoice setup, invoice number, prefix, number series, logo, signature, bank details, upi, qr code, terms and conditions, template, thermal, print, how to]
url: /settings/templates
---

# Invoice setup: how-to

## How do I change the invoice number format or prefix?

Go to Settings > Sales & billing > Transaction number series. Each document type (Tax Invoice, Bill of Supply, Proforma Invoice, Credit Note, Delivery Challan, Purchase Order and others) has its own row:
- **Prefix**: up to 10 letters or numbers, for example INV or MUM.
- **Starting Number**: the number the next invoice should use, for example 1 or 501 if you are continuing from another software.
- **Preview** shows how the number will look, for example INV-00001.

Tap Save. If you have more than one branch, tick the branches the setting applies to; each branch can have its own series.

The number is given automatically when you create an invoice and cannot be typed in by hand on a single invoice. Numbering does not restart automatically each financial year; to start a new series (for example INV26-), change the prefix or starting number here at the start of the year.

## Invoice number kaise change kare? Invoice prefix kaha set hota hai?

Settings > Sales & billing > Transaction number series mein jao. Tax Invoice wali line mein Prefix (jaise INV) aur Starting Number (jaise 1 ya 501) daalo aur Save karo. Har naye bill ka number apne aap isi series se aayega.

## How do I add my logo and signature on the invoice?

1. Settings > Business profile: use Upload Logo in the Business Logo section and Upload Signature in the Authorized Signature section (JPEG, PNG, GIF or WebP, up to 2 MB).
2. The logo prints on invoices by default.
3. The signature is off by default. Turn it on in Settings > Sales & billing > Templates & printing > Customize > Branding: tick "Show signature on invoice" and, if you want, "Show Authorized Signatory text". Save.

## How do I show my bank details on the invoice?

1. Settings > Business profile > Bank Accounts > Add Bank Account. Enter Account Name, Account Number, Bank Name and IFSC Code, and keep "Active (will appear on invoices)" ticked.
2. Bank details are hidden on the invoice by default. Turn them on in Settings > Sales & billing > Templates & printing > Customize > Fields > Bank & Payment (Bank Details Section, Bank Name, Account Number, IFSC Code). Save.

If you have several active accounts, the first one you added is printed.

## Can I print a UPI QR code on the invoice?

Not yet. A payable UPI QR code on printed invoices is not available today. What you can do:
- Add your UPI ID in Settings > Integrations > Payment providers (Payment Methods) to collect payments through payment links sent on WhatsApp.
- Connect a payment gateway such as Razorpay in Settings > Payment providers to add a pay-online link to invoices.
- Mention your UPI ID in the invoice's Terms & Conditions or Payment Terms text.

## How do I add terms and conditions to my invoices?

- For every invoice: Settings > Sales & billing > Templates & printing > Customize > Content. Fill in Terms & Conditions (new line for each point), Notes, Payment Terms and Footer Text, then Save. The Content tab depends on your plan; if it is locked you will see an upgrade prompt.
- For one invoice: type in the Notes / Terms box on the invoice screen before saving.

## How do I change the invoice design or template?

Go to Settings > Sales & billing > Templates & printing. Choose the document type on the left (Tax Invoice, Bill of Supply, and so on), preview a template and tap Activate (on mobile: Use this template). The active template is marked ACTIVE and is used for all new prints.

Use Customize to change colours, show or hide fields (logo, HSN, bank details, signature), and set paper size (A4, A5, Letter or Legal) and orientation in the Layout tab.

## How do I print small bills on a thermal printer?

In Settings > Sales & billing > Templates & printing, choose Tax Invoice (or Bill of Supply) and activate Thermal 58mm or Thermal 80mm to match your paper roll. For a Bluetooth printer, also pair it in Settings > Sales & billing > Print & devices.
