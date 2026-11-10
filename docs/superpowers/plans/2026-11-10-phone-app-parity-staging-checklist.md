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

## Known and separate
- The website's own item form sends batch tracking, serial tracking and valuation method, but the item save routes ignore them.
- The website's currency converter applies rates backwards, and its PAN validator reads the holder type from the wrong letters. The phone gives the correct answers.
- Several phone settings screens send `business_id` in request bodies (`phone/lib/screens/settings/settings_router.dart`), which the project rules forbid.
- The website's credit-note Edit link leads to a page that does not edit, and its payment reminders History tab calls a route that does not exist.
- Converting a work order on the phone creates the final invoice straight away; the website opens a pre-filled invoice form first.
