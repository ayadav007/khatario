# Phone app parity: staging checklist

Install the owner app built from `phone/` (it points at `https://staging.khatario.com`), sign in with a staging owner account, and work down each stage. Each line says what to tap and what should happen. Note anything that differs, with a screenshot, against the line number.

## Stage 1: repair what is built (commits 3a709779 to 185326a3)

### Broken menu links (Task 6)
1. More › Inventory › Price List → a customer picker opens; pick a customer → each item shows the rate, discount, source, MRP and GST basis the server gives that customer. No "Could not load this page".
2. Price List › "Edit party prices" → the website Party Pricing page opens inside the app.
3. More › Inventory › Units & Duplicates › Merge → pick the item to keep, add one duplicate → the server preview shows what moves. Tap Merge → the sheet names the kept item and "1 item"; confirm → the duplicate disappears from the item list.
4. Units & Duplicates › Alternate units → pick an item, add a unit (BOX = 12), save → reopen the item: the unit is still there.

### Supplier form and edit (Task 7)
5. Parties › Suppliers › New → State starts at the shop's own state (not Karnataka). Type a valid GSTIN and tap "Fetch GSTIN details" → name, address, city, state, pincode and PAN fill in.
6. Save the supplier → it appears in the list. Open it › Edit → every field is filled in.
7. In Edit, clear the phone number and save → "Phone can't be removed once saved"; nothing is saved.
8. In Edit, change only the opening balance and save → saved; the supplier's ledger shows the new opening balance (or the server's refusal if the period is locked).
9. In Edit, change nothing and tap Save → the form closes and nothing is sent.
10. Create a supplier with a GSTIN that already exists → "A supplier with this GSTIN already exists."; the form stays open.

### Expenses (Task 8)
11. More › Purchases › Expenses → a list grouped by day (not the plain record list). Tap + → the form has category, expense item, amount, GST rate, "Amount includes GST", payment and account.
12. Enter ₹1,180 at 18% with "includes GST" on → the totals under the form show the server's taxable amount and GST; save → it appears in the list.
13. Open that expense › Edit, change nothing, Save → nothing is sent. Change the amount, Save → the list shows the new amount.
14. Open an old expense paid by bank (made before this release) › Edit → Payment shows "Bank transfer"; saving without changes sends nothing and the account is unchanged.
15. Open an expense › Delete → asks for a reason; confirm → it leaves the list.
16. Expense categories → add one, rename it.

### Journal entries (Task 9)
17. More › Accounting › Journal Entries › New → line cards with account, Debit/Credit and amount. Post stays off until debits equal credits.
18. Enter 0.10 + 0.20 debit against 0.30 credit → it balances and posts.
19. Pick a date 40 days ago → "Reason for back-dating" appears; Post without it shows an error; fill it and post → saved.
20. "Use a template" → pick one → lines fill in with account names; if lines were already filled, it asks first.

### Item form (Task 10)
21. Items › + → new sections Identify (barcode with scan, category, brand, MRP), Stock (default supplier, pack size) and Photos.
22. Tap the scan button → the camera opens; scan a barcode → it fills the field. Deny camera permission → a message and a field to type the code.
23. Add a photo, pick a category and supplier, save → reopen the item: all are kept.
24. Edit that item, change only the name, save → barcode, category, brand, MRP, supplier and photo are all unchanged.

### Tools (Task 11)
25. More › Tools › All Tools → a grid of tools. Each opens its own screen with labelled fields.
26. EMI: 1,00,000 at 12% for 12 months → ₹8,884.88.
27. GST: 118 at 18% with "includes GST" → taxable 100, GST 18.
28. PAN validator: `ABCPE1234F` → Individual. `ABCXE1234F` → not valid (4th letter).
29. Currency: 1 USD → 83 INR; 1 INR → 0.012048 USD.
30. Discount: price 100, discount 150% → "Discount cannot be more than the price".
31. HSN finder: type "rice" → results from the server.

### New look everywhere (Task 12)
32. Open a purchase bill, a purchase return, an order, a chat thread, a deal, Supplier Hub › My catalog and Settings › Users. No old grey title bars, filled buttons or floating labels; fields have labels above them and space between them.
33. New purchase bill › due date → the picker opens on the bill date.
34. Settings › Users › add user → the Password field does not capitalise the first letter.
35. A deal in Chats › tap Done on a follow-up twice quickly → only one follow-up is closed; the buttons dim while saving.

## Stage 2: sales documents (commits 4212e474 to f974ead5)

Credit approvals now need the website build that includes f974ead5 on staging (the approve and reject routes take the business from the login). Deploy before testing items 66 and 67.

### Quotations (Task 14)
36. More › Sales › Quotations → a list with chips All, Draft, Sent, Accepted, Rejected, Expired, Converted. + opens a new quotation.
37. Open a draft quotation → its status shows as a pill; no Payments tab, no Collect. "Convert to invoice" asks first, naming the number and amount; confirm → the new invoice opens.
38. Back → the quotation list shows it as Converted with "Open invoice" (not Convert).

### Sales orders (Task 15)
39. More › Sales › Sales Orders → list; + opens a new sales order and its number is already filled in (SO-…).
40. Open an order → lines and the payment summary (advance, invoiced, balance) as the server gives them.
41. Edit an order without discount or charges → change a quantity, save → the list shows the new total. An order with a discount or extra charge shows why it can't be edited here and "Open on website".
42. Convert to invoice → asks, then opens the invoice; back on the list the order no longer offers Convert.
43. Record advance → the payment form opens for that customer with a note naming the order.

### Delivery challans and work orders (Task 16)
44. More › Sales › Delivery Challans → list; open one → status changes the website offers (e.g. dispatch, deliver) each ask once and update the status.
45. A returnable challan → "Record return" → enter returned quantities → saved; a closed challan no longer offers it.
46. Edit a challan, change one quantity, save → the e-way bill number, vehicle and addresses are unchanged afterwards.
47. More › Sales › Work Orders → list; + creates a work order with its number filled in.
48. Mark a work order completed (enter actual hours) → "Create invoice" warns that it creates a final invoice; confirm → the invoice opens.
49. Edit a work order, change the description, save → scheduled dates and hours are unchanged.

### Credit and debit notes (Task 17)
50. More › Sales › Credit Notes → list with Show more; + opens a new credit note with the number already filled in.
51. Open a note → lines and totals; there is no Edit (the server refuses edits).
52. Cancel → asks for a reason; blank reason shows an error; with a reason → the note shows Cancelled and offers only Share.
53. Cancel a note in a GST-filed month → the server's message is shown and the note is unchanged.
54. Debit Notes → the same list, detail and cancel; + opens with the next number filled in.

### Credit approvals, recurring, reminders, reconciliation (Task 18)
55. More › Sales › Credit approvals → pending requests as cards with Approve and Reject.
56. Reject without a reason → error; with a reason → the card leaves the list.
57. Approve → the card leaves the list; the invoice it was holding goes through.
58. More › Accounting › Recurring invoices → list; open one → Pause, then Resume; Run now asks first, then raises today's invoices.
59. New recurring invoice → pick a customer and items, frequency, start date → saved and listed.
60. More › Sales › Payment Reminders with WhatsApp not linked → a banner and "Connect WhatsApp"; no Send button.
61. With WhatsApp linked → tick two overdue invoices → Send → the sheet lists both customers, invoices and balances and says 2; confirm → sent once; the customers get one message each.
62. Untick everything → Send is not available.
63. More › Accounting › Payments › Reconciliation → each action asks first, naming the amount; confirm → the row updates.
64. Tap an action twice quickly → only one is recorded.
65. Payments Out from More still opens the payments list.
66. On staging after deploy: approve from the website still works (it sends the business id, which must match).
67. On staging after deploy: approve and reject from the phone work.

## Stage 3: stock (commits 00be7df1 to 16b556ed)

### Pricing (Task 20)
68. More › Inventory › Party Pricing → pick a customer → their item and category prices and their price level.
69. Add an item price → saved and listed; open History → the server's earlier prices.
70. Remove a price → asks first, naming the item → it leaves the list.
71. Price Levels → create one, rename it, pause it; open it → add a rate (item, minimum quantity, price) → saved.
72. Schemes → create, edit, pause; edit the paused scheme and save → it stays paused.
73. Price List › Edit party prices → opens the phone party-pricing screen, not the website.

### Adjustments and repacks (Task 21)
74. More › Inventory › Adjustments → list; switch to Repacks → repack list.
75. New adjustment → add two items, one added and one reduced, with a reason → save → each line shows "Saved" and the stock after.
76. Make the second line fail (e.g. reduce more than in stock) → the first stays saved, the second shows the server's message; fix it and save → only the second goes out.
77. A serial-tracked item → "Adjust this item on the website"; Save is off until it is removed.
78. Items › a variant item › Adjust → opens the new adjustment form.
79. New repack → pick the source item → quantities fill from the server → save. Open it › Cancel → asks first → cancelled.

### Stock transfers (Task 22)
80. More › Inventory › Stock Transfers → list with status chips; + creates a transfer between two warehouses with the number filled in.
81. Open a draft → Approve → Dispatch (asks first) → status In transit.
82. Receive → enter received quantities; more than was sent is refused before sending → save → status Received.
83. A transfer with a shortfall → Close shortfall → asks first → closed.
84. Cancel a pending transfer → asks first → cancelled.

### Stock counts, held goods, manufacturing, claims (Task 23)
85. More › Inventory › Stock Counts → start a count for a warehouse → lines listed.
86. Scan a barcode on the count → the matching line's count goes up; an unknown barcode says "Not on this count".
87. Type quantities, leave the screen and come back → they are kept.
88. Clear a counted box and tap Finish → "Enter a quantity for … or leave it as it was"; nothing submitted.
89. Finish → asks first, naming uncounted items → review; Post → asks first → stock adjusted.
90. Held goods → release one and write off one (with a reason) → both ask first.
91. Manufacturing › Recipes → create one; Production → run one batch → asks first → finished goods added.
92. Insurance claims → raise one; admit, then settle → each names its ledger effect first.

### Categories, labels, stock reports (Task 24)
93. More › Inventory › Item categories → add one, set a size chart, delete an unused one; deleting a used one shows the server's message.
94. Print Labels → pick a template, two items and copies → prints on the paired label printer.
95. Each stock report opens with a period picker and the server's totals: Stock Summary (by item), Closing Stock, Stock with Parties, Valuation, Quantity details, Bank stock statement, Job work, FIFO lots.
96. Closing Stock for a year with more than 200 items → Show more loads the rest; a year with no closing stock says so and offers the website.

## Stage 4: books (commits 8efa1d6f to 0e40017e)

### Chart of accounts and ledger (Task 26)
97. More › Accounting › Chart of Accounts → accounts grouped, with the balances the server reports.
98. Add an account → saved and listed. Edit one, change its name only → its group and Schedule III line are unchanged on the website afterwards.
99. Deactivate an account → asks first → it shows as inactive. A system account offers no edit or deactivate.
100. Open an account → its ledger for this financial year with opening, running and closing figures labelled Dr or Cr; change the period → the figures change; Statement PDF opens.
101. Tap a ledger row for an invoice → the invoice opens; for a journal → the journal opens on the phone.
102. More › Accounting › Ledger → all entries; Show more loads older ones.
103. Check one account's closing balance against the website for the same dates, and check one date near midnight shows the right day.

### Journal entries, contra, advances (Task 27)
104. Journal Entries → list; open one → lines and totals; there is no Delete.
105. Edit a journal → change an amount on both sides, save → updated. A locked or reversed entry explains why it can't be edited.
106. Reverse → asks for a reason, naming the entry and amount → reversed.
107. Lock, then unlock an entry.
108. Contra → move money from cash to a bank account → saved; only cash and bank accounts are offered.
109. Advances → record a customer advance and a supplier advance; adjust one against an invoice; refund part of another (asks first) → the remaining amount the server reports goes down.

### Fixed assets, provisions, TDS (Task 28)
110. Fixed assets → add one; Depreciate → asks first with its book value → the toast shows the amount posted.
111. Dispose of an asset with "Charge depreciation" on → the question says depreciation is posted first → the gain or loss the server reports is shown.
112. Provisions → add, edit, delete; add an entry and a utilisation.
113. TDS → tabs for Transactions, Payments, Certificates, Categories; pick a quarter → summary tiles appear.
114. Record a TDS payment → asks first, quoting the pending amount → saved; the same challan again is refused.
115. Create a certificate, then open its PDF (the server route may fail; note what happens).

### Bank reconciliation and activity log (Task 29)
116. More › Accounting › Bank reconciliation → pick a bank account → statement lines with suggestions and the server's balances.
117. Match a line to its suggestion; match another with "Match to other entries" by ticking two entries; ignore one; undo one.
118. Create an entry from a line → asks, naming amount, date and accounts → posted.
119. Match automatically → asks → toast says how many lines matched. Complete → asks → reconciliation closed.
120. An account with no statement → "Import a statement on the website".
121. More › Activity Logs → filter by a person and by dates (the last day of the range is included) → Show more; open an entry → details.

## Known and separate
- The website's own item form sends batch tracking, serial tracking and valuation method, but the item save routes ignore them.
- The website's currency converter applies rates backwards, and its PAN validator reads the holder type from the wrong letters. The phone gives the correct answers.
- Several phone settings screens send `business_id` in request bodies (`phone/lib/screens/settings/settings_router.dart`), which the project rules forbid.
- The website's credit-note Edit link leads to a page that does not edit, and its payment reminders History tab calls a route that does not exist.
- Converting a work order on the phone creates the final invoice straight away; the website opens a pre-filled invoice form first.
- Editing a paused scheme on the website makes it active again (the route treats a missing setting as active).
- Creating a stock transfer has no protection against a repeated save, on the website and the phone.
- The website's stock dashboard page (reorder, ageing, velocity) is not on the phone.
- Editing a journal on any device drops each line's own reference number (the server writes the entry's reference to every line).
- The website's TDS pages send a year that matches no saved financial year; the TDS certificate PDF route asks for columns that may not exist; the TDS summary returns only the first quarter's figures.
- The website's activity log leaves out the last day of a date range.
- Depreciation cannot be previewed before it is posted.
