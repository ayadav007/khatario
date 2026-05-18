# Khatario User Guide

This guide explains the main options available in Khatario and the day-to-day workflows most teams use: creating invoices, recording purchases, managing items, receiving and making payments, using reports, and sending WhatsApp messages.

Menu names can vary slightly by plan, permissions, mobile layout, and business settings. If you do not see an option, check your role permissions, subscription, branch access, and whether the feature is enabled in Settings.

## 1. Getting started

Before entering transactions, set up the business basics.

### Business profile

1. Go to **Settings > Organization** or **Settings > Business**.
2. Add legal name, address, phone, email, GSTIN, state, logo, and bank details.
3. Save the profile.

These details are used on invoices, PDFs, statements, and reports.

### Financial year

1. Go to **Settings > Financial years**.
2. Create or confirm the active financial year.
3. Use the correct year when reviewing reports or closing stock.

### Branches and warehouses

Use branches if your business operates from more than one location. Use warehouses if stock is stored or received at different locations.

1. Go to **Settings > Branches** to add branches.
2. Go to **Settings > Warehouses** to add storage locations.
3. Link users to branches or warehouses from **Settings > User branches** and **Settings > User warehouses** if required.

### Number series

1. Go to **Settings > Transaction number series**.
2. Set prefixes and running numbers for invoices and other documents.
3. Confirm the correct branch or document type before creating final documents.

## 2. Dashboard

The dashboard gives a quick view of the business.

Common cards include:

- Today sales
- Today purchases
- Receivables
- Payables
- Recent invoices
- Low stock alerts
- Cash flow

Use dashboard action buttons when available to quickly create invoices, purchases, customers, and items.

## 3. Customers

Use customers for sales, receivables, statements, reminders, and WhatsApp follow-ups.

### Create a customer

1. Go to **Customers**.
2. Click **Add Customer** or **New Customer**.
3. Enter customer name, phone, address, GSTIN, state, and payment terms if used.
4. Save.

### View customer details

1. Open **Customers**.
2. Search by name, phone, or company.
3. Open a customer record.
4. Review summary, invoices, payments, ledger, balance, and statement options.

### Send a payment reminder to a customer

1. Open the customer record.
2. Use the reminder or WhatsApp action if available.
3. Check the message content and phone number.
4. Send the reminder.

## 4. Items and inventory

Items are used in invoices, purchases, stock reports, labels, and valuation.

### Create an item

1. Go to **Items**.
2. Click **New Item**.
3. Choose whether the item is goods or service.
4. Enter item name, unit, category, HSN/SAC, tax rate, selling price, and purchase price.
5. For stock items, enter opening stock or enable batch/serial tracking if required.
6. Save.

### Manage item categories

1. Go to **Items > Categories**.
2. Add or edit categories.
3. Use categories to filter item lists and reports.

### Print barcodes or labels

1. Go to **Items > Print Labels** or **Items > Barcodes**.
2. Select items and quantities.
3. Choose the label template.
4. Print or download.

This option may require the barcode label printing feature.

### Adjust stock

1. Go to **Inventory adjustments**.
2. Create a new adjustment.
3. Select item, warehouse if applicable, quantity change, date, and reason.
4. Save or finalize.

Use adjustments for corrections, recounts, damage, or shrinkage. Use purchases and invoices for normal buying and selling.

## 5. How to create an invoice

Use invoices to bill customers and post sales, tax, receivables, and stock movement.

### Create a tax invoice

1. Go to **Invoices** or **Sales > All Invoices**.
2. Click **New Invoice**.
3. Select the correct branch if your business uses branches.
4. Wait for the invoice number to load from the number series.
5. Choose the document type, usually **Tax Invoice** for regular taxable sales.
6. Select the customer. If the customer does not exist, add the customer from the invoice screen or from **Customers**.
7. Confirm invoice date, due date, billing address, shipping address, GSTIN, and place of supply.
8. Select the warehouse if stock is tracked by warehouse.
9. Add line items:
   - Select an item from the item master.
   - Enter quantity.
   - Confirm unit, price, discount, HSN/SAC, and tax rate.
   - Add more rows as needed.
10. Review subtotal, discount, tax, additional charges, round-off, and grand total.
11. Add notes, terms, transport details, e-way details, attachments, or reference numbers if required.
12. If payment is received immediately, record the payment amount and mode.
13. Use **Preview** if available.
14. Click **Save as Draft** if you are not ready to issue it.
15. Click **Save & Finalize**, **Generate**, or the final save action to issue the invoice.

### After creating an invoice

From the invoice detail or view page, you can usually:

- Download PDF
- Print
- Share by WhatsApp
- Record payment
- View payment status
- View history
- Cancel if allowed
- Convert proforma to tax invoice when applicable

### Common invoice blockers

- **Branch required**: select a specific branch, not "All".
- **Invoice number not ready**: wait for the series to load or check number series settings.
- **No line items**: add at least one real item row.
- **Warehouse required**: select a receiving or issuing warehouse if stock is warehouse-based.
- **Permission denied**: ask an admin to grant invoice create/edit/finalize permission.

### Proforma invoice, quotation, and sales order

Use **Quotations** or **Proforma invoices** when you are giving a price before the sale is confirmed. Use **Sales orders** after the customer accepts the order. Convert or copy them into a tax invoice when the sale is finalized according to your process.

## 6. How to create a purchase

Use purchases to record supplier bills, input tax, payable balance, and stock received.

### Create a purchase bill

1. Go to **Purchases** or **Purchases > All Purchases**.
2. Click **New Purchase**.
3. Select the supplier from the dropdown. Typing a supplier name is not enough; click the supplier row so the record is linked.
4. If the supplier does not exist, choose **Add new supplier** and save the supplier.
5. Enter bill number and bill date.
6. Select document type:
   - **Tax Invoice** for regular taxable supplier bills.
   - **Bill of Supply** for applicable non-tax or composition scenarios.
   - **Bill of Entry** for import of goods when applicable.
7. Confirm place of supply and reverse charge if applicable.
8. If warehouses are enabled, select the receiving warehouse.
9. Add line items:
   - Choose an existing item.
   - Enter quantity, unit price, discount, HSN/SAC, and tax rate.
   - Add batch, expiry, or serial details if the item requires them.
10. Add service lines for non-stock services if required.
11. Review the amount summary.
12. In payment and notes, enter paid amount if you are paying at the same time, or leave it unpaid/on account if the supplier will be paid later.
13. Click **Save as Draft** to keep it editable.
14. Click **Save & Finalize** or **Finalize Purchase** to post the purchase and receive stock.

### Upload a supplier bill for extraction

If invoice extraction is enabled:

1. Open **New Purchase**.
2. Use the upload area.
3. Upload the supplier bill.
4. Review extracted supplier, bill, and item details.
5. Correct any matches before saving.

Always review extracted data before finalizing.

### After creating a purchase

From the purchase list or detail page, you can usually:

- View purchase detail
- Download or print PDF
- Record payment
- View history
- Print labels for received goods
- Finalize a draft

### Common purchase blockers

- **Supplier not linked**: choose the supplier from the dropdown row.
- **No items added**: add at least one item or service line.
- **Warehouse required**: select a receiving warehouse before finalizing goods.
- **Offline**: finalization may require sync or online status.
- **Permission denied**: ask an admin to grant purchase create/finalize permission.

## 7. Suppliers

Use suppliers for purchases, payables, supplier statements, and purchase reports.

### Create a supplier

1. Go to **Suppliers**.
2. Click **New Supplier**.
3. Add legal name, phone, GSTIN, address, state, and payment details.
4. Save.

### Supplier dashboard and requests

Depending on your setup, Khatario may show:

- Supplier dashboard
- Requests to fulfill
- Suppliers hub
- Supplier thresholds
- Supplier analytics

These help manage supplier relationships, discovery, and requested purchases.

## 8. Purchase orders and purchase returns

### Create a purchase order

1. Go to **Purchase Orders**.
2. Click **New Purchase Order**.
3. Select supplier, items, quantities, rates, dates, and terms.
4. Save or issue the PO.
5. Convert to purchase when the supplier bill or goods receipt arrives, if your workflow supports it.

### Create a purchase return

1. Go to **Purchase Returns**.
2. Click **New Purchase Return**.
3. Select supplier and original purchase if available.
4. Add returned items and quantities.
5. Save/finalize.

Purchase returns reduce stock and reverse the relevant purchase/tax amounts according to the original purchase.

## 9. Payments

Use payments to record cash, bank, UPI, card, and other money movement.

### Record payment received from customer

1. Go to **Payments > Payments In**.
2. Select customer.
3. Enter amount, date, payment mode, and reference number.
4. Link to invoice if required.
5. Save.

This reduces customer receivable.

### Record payment made to supplier

1. Go to **Payments > Payments Out**.
2. Select supplier or party.
3. Enter amount, date, payment mode, and reference number.
4. Link to purchase or payable if required.
5. Save.

This reduces supplier payable.

### Configure payment modes and providers

1. Go to **Settings > Payment providers** for gateways such as Razorpay, PhonePe, PayU, Cashfree, Instamojo, or mock/testing providers.
2. Go to **Settings > Account mappings** to map payment modes to the correct cash or bank ledger.
3. Go to **Settings > Payments** or manual payment settings to manage custom methods where available.

## 10. Expenses

Use expenses for business costs that are not stock purchases.

### Record a paid expense

1. Go to **Expenses**.
2. Click **Add Expense**.
3. Choose category, date, amount, tax if applicable, and payment mode.
4. Save.

### Record a bill not paid yet

1. Go to **Expenses**.
2. Add the expense details.
3. In payment, choose the option for bill received but not paid/on account if available.
4. Select the supplier or vendor.
5. Save.
6. Later, go to **Payments Out** to pay the vendor.

## 11. Accounting

### Chart of accounts

1. Go to **Accounts** or **Chart of Accounts**.
2. Review default accounts.
3. Add bank, cash, loan, income, expense, asset, or liability accounts as needed.

### Ledger

1. Go to **Ledger**.
2. Select account or party.
3. Choose date range.
4. Review debit, credit, and balance.

### Journal entries

1. Go to **Journal Entries**.
2. Create a new journal.
3. Add debit and credit lines.
4. Confirm total debit equals total credit.
5. Save/post.

Use journals for adjustments, accruals, openings, and reclassification entries that do not fit invoice, purchase, payment, or expense screens.

### Opening balances

Use **Opening Balances** when migrating from another system or starting mid-year. Enter opening balances before posting new transactions so reports start correctly.

## 12. Reports

Open **Reports** for accounting, sales, purchase, GST, stock, and custom reports.

Common reports include:

- Profit & Loss
- Balance Sheet
- Cash Flow
- Trial Balance
- Receivables Aging
- Payables Aging
- Sales Summary
- Sales Invoice-wise
- Sales Item-wise
- Sales Party-wise
- Sales Tax-wise
- Purchase Summary
- Purchase Supplier-wise
- Purchase Tax-wise
- Stock Summary
- Stock Valuation
- Closing Stock
- Inter-branch reconciliation
- Deleted items
- Credit risk
- Profit by invoice
- Custom report builder

When comparing reports, use the same financial year, date range, branch, and warehouse filters.

## 13. GST reports

GST reports are available under **Reports > GST**.

Common options:

- **GSTR-1**: outward supplies/sales.
- **GSTR-2B**: supplier-reported inward supplies.
- **GSTR-2B Reconciliation**: compares purchase books with 2B data.
- **GSTR-3B**: tax summary.
- **GSTR-9**: annual return view.
- **GST Reconciliation**: alerts and matching workflows where enabled.

Before filing:

1. Check invoice and purchase dates.
2. Check GSTINs and place of supply.
3. Review tax-wise sales and purchase reports.
4. Reconcile 2B against purchase books.
5. Lock the period after review if your process requires it.

## 14. How to send a WhatsApp message

WhatsApp features may require the WhatsApp add-on. Invoice sharing may be available even when the wider WhatsApp bot add-on is not enabled.

### Connect WhatsApp

1. Go to **WhatsApp** or **Settings > WhatsApp / Integrations > WhatsApp**.
2. Open the **Connection** tab.
3. Scan the QR code with WhatsApp on the phone.
4. Wait until status shows connected.

If disconnected, reconnect from the same screen.

### Send a single WhatsApp text message

1. Go to **WhatsApp > Send Message**.
2. Choose **Text**.
3. Enter phone number with country code, for example `919876543210`.
4. Type the message.
5. Click **Send Message**.

### Send an image message

1. Go to **WhatsApp > Send Message**.
2. Choose **Image**.
3. Enter phone number with country code.
4. Upload a PNG, JPG, or GIF image up to 5 MB.
5. Enter a caption.
6. Click **Send Message**.

### Send a message with buttons

1. Go to **WhatsApp > Send Message**.
2. Choose **Buttons**.
3. Enter phone number with country code.
4. Type the message.
5. Add up to 3 quick replies.
6. Optionally add a phone call button and a URL button.
7. Keep button titles short, up to 20 characters.
8. Add optional footer text.
9. Click **Send Message**.

### Send an invoice on WhatsApp

1. Open the invoice.
2. Use the WhatsApp/share action.
3. Confirm the customer phone number.
4. Send the invoice message.

When an invoice is shared this way, Khatario can generate or attach the invoice PDF internally.

### Send payment reminders

1. Go to **WhatsApp**.
2. Open **Send Reminders** or **Auto Reminders**.
3. Choose reminder type, customer/invoice filters, and message settings.
4. Send manually or enable automatic reminders.
5. Review **Logs** for delivery status and errors.

### Manage conversations

Use **WhatsApp > Conversations** to view chats, notes, labels, linked orders, and timelines if enabled.

### Campaigns and contact groups

1. Go to **WhatsApp > Contacts** to add or import contacts.
2. Create groups under **WhatsApp > Contacts > Groups** if needed.
3. Go to **WhatsApp > Campaigns**.
4. Build the message, choose recipients, review anti-ban settings, and send.

Use campaigns carefully and only message customers who have consented.

### Bot rules

Use **WhatsApp > Bot Rules** to configure automated replies, order handling, or routing. Test rules with a small set of messages before relying on them for live customers.

## 15. Settings overview

Important settings areas:

- **Organization / Business**: company profile and document details.
- **Financial years**: accounting year setup.
- **Branches**: locations.
- **Warehouses**: stock locations.
- **Users and roles**: access control.
- **Tax & GST**: tax defaults and filing settings.
- **Account mappings**: cash, bank, payment mode, and ledger mapping.
- **Period locks**: prevent changes in closed periods.
- **Plan & billing**: subscription and add-ons.
- **UI features**: enable or disable app features.
- **Backup & restore**: data safety options.
- **Templates & printing**: document templates.
- **Invoice design**: invoice layout and fields.
- **Label templates**: barcode/label layouts.
- **Bluetooth printer**: printer configuration.
- **Transaction number series**: prefixes and counters.
- **Integrations**: WhatsApp, payment providers, AI, HR, SMS, CRM, and other connected apps.
- **Help & support**: product tour and how-to guides.

## 16. HR and payroll

Depending on plan and permissions, Khatario may include:

- Employees
- Attendance
- Leave requests
- Salary payments
- Advances
- Payslips
- Commissions
- Performance
- Activity logs

Set holidays, leave types, shifts, and commission rules in Settings before running HR workflows.

## 17. Tools

Tools may include:

- HSN/SAC finder
- GST calculator
- TDS calculator
- EMI calculator
- Discount and price calculators
- PAN/GSTIN validators
- Lead extractor
- Invoice number generator
- WhatsApp group extractor
- To-do list

Some tools are plan-gated.

## 18. Search

Use global search to quickly find customers, invoices, items, documents, and settings. Search by name, phone, invoice number, or item code depending on the record type.

## 19. Access and permission notes

If an action is blocked:

1. Confirm you are logged into the correct business.
2. Confirm branch access.
3. Confirm warehouse access.
4. Confirm your role has permission for the module and action.
5. Confirm the feature is included in the subscription or add-on.
6. Ask an admin to adjust roles, plan, branch, or warehouse settings.

## 20. Safe operating checklist

Use this checklist before month-end or GST review:

1. Confirm all invoices and purchases are entered with correct dates.
2. Confirm payments in and out are recorded.
3. Reconcile supplier purchases with GSTR-2B.
4. Check receivables and payables aging.
5. Review stock summary and closing stock.
6. Run trial balance.
7. Run profit and loss and balance sheet.
8. Lock the reviewed period if your team uses period locks.

