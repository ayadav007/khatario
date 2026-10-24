---
title: How to add customers, suppliers and opening balances
audience: [tenant_user]
locale: en
tags: [opening balance, customer, supplier, party, import, financial year, branch, low stock, how to]
url: /customers/new
---

# Customers, suppliers and opening balances: how-to

## How do I add a customer?

Go to Sales > Customers and tap + New (or choose "+ Add New Customer" while making an invoice). Enter the name and phone. For business customers, type their GSTIN and Khatario fills in the name and address; select their State, because it decides CGST + SGST or IGST on invoices. Tap Save Customer.

You can also bill without a customer: leave the customer empty on the invoice and it is saved as a cash sale.

## How do I enter the old balance (opening balance) of a customer?

When adding the customer, fill in **Opening Balance** in the Financial details section and choose **To Receive** (they owe you) or **To Pay** (you owe them). You can also set a Credit Limit and Credit days there. The balance shows in their statement and in Reports > Receivables Aging.

## Purane customer ka baki (udhaar) kaise daale?

Sales > Customers > + New mein customer banate waqt Financial details mein Opening Balance daalo aur "To Receive" chuno (agar customer ko aapko paise dene hain). Save Customer karo. Ye baki customer ke statement mein dikhega.

## How do I add a supplier and what I owe them?

Go to Purchases > Suppliers and tap + New. Enter Supplier Name, phone, State and GSTIN. Enter the Opening Balance and choose Balance type: "You Owe (Credit)" if you have to pay them, or "They Owe (Debit)" if they owe you. Tap Create Supplier.

## How do I enter opening stock?

When adding an item in Inventory > Items > + New, enter **Opening Stock** in the Stock section (and a Low Stock Alert quantity if you want). After the item is saved, opening stock cannot be edited; change stock with Inventory > Adjustments instead. When importing items from a CSV file, fill the opening_stock column.

## How do I enter opening cash and bank balances?

Go to Accounting > Chart of Accounts, open or create the cash or bank account, and enter the Opening Balance and Opening Balance Type (debit or credit). Your CA can check these against your last balance sheet.

## Can I import customers or suppliers from Excel?

Not yet. Customers and suppliers are added one by one (or while billing). Items can be imported: in Inventory > Items, tap Template to download the CSV format, fill it in and tap Import.

## How do I set the financial year?

Go to Settings > Organization > Financial years. Tap "Use current Indian FY (Apr–Mar)" or Add financial year, check the Year label, Start date and End date, and Save. Reports such as GST and closing stock use these periods. Invoice numbering does not restart on its own; change the prefix or starting number in Settings > Sales & billing > Transaction number series if you want a new series each year.

## How do I add another branch?

Go to Settings > Organization > Branches and create a branch with its name, GSTIN, State Code, address and an Invoice Prefix (for example MUM or DEL). Having more than one branch needs the Multi-Branch feature, available on the Enterprise plan; on other plans the page shows an upgrade prompt.

## How do I know which items are running low?

Set **Low Stock Alert (Qty)** on each item. Items at or below that quantity appear in the Low Stock Items card on the dashboard and under Inventory > Items with the Stock Level filter set to Low Stock. There are no WhatsApp or SMS low-stock alerts to yourself yet.
