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

## Stage 5: reports (commits 12bba76e to 5825b3df)

Deploy e9bd4db4 to staging first: the GSTR-2B decision and reconcile routes now take the business from the login, and saving a decision checks the reconciliation belongs to that business.

### Reports home (Task 31)
122. More › Reports › Overview → a period bar and four figures (sales, purchases, expenses, profit) matching the website's overview for the same dates; change the period → they change.
123. Report groups list every report; a report your plan lacks shows Upgrade and opens the upgrade sheet.

### Sales, purchase and other reports (Task 32)
124. Each sales report (summary, invoice-wise, item-wise, party-wise, tax-wise, payment mode, discount, credit, cancelled, returns, B2B vs B2C) opens with the server's totals; compare two against the website for the same dates.
125. Sales summary → group by Week, then Month → rows regroup. Sales invoice-wise → filter Draft, then channel WhatsApp → the list narrows; the unbilled-orders note shows when there are any.
126. Tap an invoice row → the invoice opens; a party row → the customer; an item row → the item.
127. Each purchase report opens the same way; purchase invoice-wise filters by status; a supplier row opens the supplier.
128. Profit by invoice → rows open invoices. Credit risk → a customer row opens the customer, a supplier row the supplier.
129. Deleted items → filter by type, choose dates → Restore asks first → the record returns (on a plan without restore, the upgrade sheet shows instead).
130. Label print log → choose a period and purpose → rows include today's jobs.

### GST and e-way bills (Task 33)
131. GSTR-1 for last month → sections with the server's totals; Share Excel; Mark as filed → warns it locks the month's invoices → filed.
132. GSTR-3B → tables 3.1, 3.2, 4 and 5 for the month.
133. GSTR-2B reconciliation → Run reconciliation (asks, naming the period) → matched and missing lines; open a line → choose a decision → asks, naming the invoice and amount → saved.
134. GSTR-1 vs 3B and GST alerts → dismiss an alert with a reason, then restore it.
135. GST cash ledger with several branches → "Select a branch before posting" until one is picked; deposit, utilise and reverse each ask first.
136. E-way bills → add one; extend, close and cancel each ask first.
137. On staging after deploy: the website's GSTR-2B reconciliation page still runs and records decisions.

### Statements (Task 34)
138. Profit & Loss, Balance Sheet, Trial Balance and Cash Flow → Share PDF opens the PDF for the chosen period.
139. Profit & Loss → tap an expense account → its entries; tap Cost of goods sold → its parts including opening stock, purchases and closing stock; tap Purchases → the purchase items; tap Net profit → its parts.
140. An account statement PDF from the ledger still opens with the same name.

## Stage 6: HR (commits be77c385 to 4aaae3c1)

Deploy these to staging first: they change server routes for adding employees, shift roster and bulk assignment, salary payments, advances, commissions, exits, recruitment interviews and conversion, and tasks.

### Employees (Task 35)
141. More › HR › Employees › + → the phone form with personal, job, pay, bank and login sections → save → the new employee opens.
142. Edit an employee and change only the phone number → saved; their PAN, bank and pay are unchanged on the website.
143. On a Staff Lite plan, the reporting manager, PAN, Aadhaar and PF/ESI fields are hidden.
144. Deactivate from the profile → asks first → the employee can no longer sign in.
145. Org chart → expand and collapse; tap a person → their profile.

### Attendance, shifts, leaves (Task 36)
146. Attendance › History → a month grid; tap a day → its status.
147. Attendance › Reviews → approve one check-in and reject one with a reason; approve an attendance correction.
148. Shift roster → change one person's day → saved; next week → loads.
149. Bulk assign → pick a shift, dates and three people → asks naming 3 → done.
150. Leaves › Apply on behalf → pick dates → the server's day count and balance show → submitted.
151. Leaves → cancel an approved leave and delete a pending one, each asking first.
152. Leave balances and the leave calendar load.

### Pay (Task 37)
153. Pay salary → pick an employee and month → amounts fill from the server → asks with the form total → paid; the toast shows the server's net.
154. Pay salary into a locked month → refused before anything is saved.
155. Open a payslip PDF → share it.
156. Advances → new, approve, reject. Expenses → new with a bill photo, approve, reject with a reason, reimburse, voucher PDF.
157. Commissions → approve, then pay. Targets → set one.

### Manager, hiring, exits (Task 38a)
158. HR dashboard → each tile opens its screen.
159. Manager → pending approvals: approve a leave, hold an overtime request with a reason, approve an expense.
160. Recruitment → add a job → add a candidate → schedule an interview → mark it passed.
161. Create an offer → Submit for approval with one approver per level → approve it → open the offer PDF.
162. Convert the candidate → their new employee profile opens.
163. Exits → start one → tick off checklist items → approve.

### Engagement, documents, reports, tasks (Task 38b)
164. Engagement → add an announcement, a poll and an article; archive the announcement and unpublish the article.
165. HR documents → generate a document for an employee → the PDF opens.
166. HR reports → download a payroll register and the ECR → the share sheet opens with a CSV.
167. Tasks → add one assigned to an employee, mark it done, delete another.
168. Performance → the summary loads.

## Stage 7: WhatsApp (commits 0c6cf6d3 to 51721411)

No server change in this stage; the APK alone is enough.

### Dashboard, leads, lead sources, pipeline (Task 40)
169. More › WhatsApp › Dashboard → "WhatsApp CRM dashboard" with status, bot vs human, agents, campaigns and pipeline tiles.
170. Conversations, Campaigns and Pipeline in the More menu open their phone screens, not a plain list.
171. Leads → filter by stage and source → add a lead → open it → add a comment, change its stage and owner.
172. Convert a lead whose phone matches a customer → it links to that customer and the customer opens. Convert one with a new phone → the customer is added and linked.
173. New enquiry on a closed lead → a fresh open lead.
174. Lead sources → switch new numbers on and off, add a tracked link, IndiaMART sync, pause then resume IndiaMART (asks first), add a webhook → its URL shows once.
175. Pipeline → search, filter by source and label, change the won/lost window → each card shows phone, temperature and "Existing customer" where true.
176. Pipeline → tap Move on a card → pick a stage → the card moves and the counts update; tap a card → the lead opens.
177. Pipeline → Show more on a long stage → more cards; Stages → add, rename, recolour, reorder and delete one (moving its leads).

### Contacts, sending, campaigns (Task 41a)
178. The Contacts tab → the new contacts list → search, filter by group → add, edit, delete a contact → open its chat.
179. Contact groups → add a group → add three contacts → remove one.
180. Unsubscribes → add a number → resubscribe it (asks first).
181. Send message › Single → Text to one number → asks naming the number → sent.
182. Send message › Single → Image → pick a photo from the phone → caption → sent; the picture arrives on WhatsApp.
183. Send message › Bulk campaign → pick a group → Buttons with a picture from the media library → schedule for tomorrow → asks with the count and message → the campaign shows Scheduled.
184. Who to message → tick people in a list → pick a saved reply → continue → the campaign tab is filled in.
185. Campaigns → search and status filter → start, pause and resume (each ask quotes the message) → delete a finished one → View report: overview, recipients, analytics.

### Flows, saved replies, orders (Task 41b)
186. Flows → New flow › Shop starter → the editor opens on the website inside the app → back → the flow is listed; publish, unpublish, delete (each asks).
187. Bot rules in the More menu → opens Flows with the import note → Import old rules.
188. More › Settings › Messaging › Saved replies → add, edit, delete; in a chat, the saved-replies sheet lists them and its Manage link opens this screen.
189. Order verification → a WhatsApp order with a payment screenshot → the screenshot shows and opens full size → Verify & Create Invoice; reject another with a reason. No "Open on website" button.

## Stage 8: remaining pages (commits 5c6ed962 to adb5c57c)

Deploy first: the supplier dashboard reads changed on the server (they no longer need a business id from the client).

### Supplier dashboard, to-do, settings (Task 43)
190. As a supplier with a linked customer who shares low stock: More › Supplier dashboard → "Customers with Low Stock" cards and "Low Stock Alerts".
191. Propose order on a customer card → quantities filled to the shortage → Send order asks first → sent; the order shows under View Requests.
192. Dismiss a low-stock alert → it goes away. Contact on an alert opens WhatsApp.
193. Analytics → period and ranking load. Thresholds → delete one (asks first); the screen says new thresholds are no longer added.
194. More › Tools › To Do List → stats and views → add one assigned to a team member → edit it → snooze until tomorrow → mark complete → reopen.
195. More › Settings → the restore-backup row says why it opens the website. Workflow automation still opens the website.

### Website pages by design (Task 44)
196. More menu → Report builder, GSTR-9, Schedule III and Bank import rows show a small globe and "Opens the website"; Help, Support and Privacy rows do not (they open phone screens).
197. Tools → Image Reducer, BG Remover and WhatsApp Group Extractor cards → each opens the website inside the app.
198. Open GSTR-9 → a loading bar runs along the top while it loads.
199. Inside a website page, follow a link, then press Back → you return to the first page; Back again leaves the screen.
200. Turn on airplane mode and open a website page → the offline message with Try again; turn it off and tap Try again → the page loads.

## Stage 9: close-out walk (the automatic list is gone)

Stage 9 removes the plain read-only list that used to catch any More link without a screen. Every link now opens its phone screen, a bottom-bar tab, or the website inside the app (the ones kept there by design show a small globe and "Opens the website"). A link with no screen, such as an old push notification, opens the website too.

Walk every More section twice: first with a staging **owner** account, then with a **restricted staff** account (give it only a few permissions, for example sales and payments but no reports, HR or settings). The sections come from the server's More menu, in this order: Supplier (supplier businesses only), Sales, Purchases, Inventory, Accounting, Reports, HR & Employees (or Staff on a small plan), Connect (or WhatsApp on a billing-only plan), Tools, Settings & data, Support. Tap every row in each section. For each row, note what opened: a phone screen, a tab, or the website. Nothing should show a plain list of records with raw field names, "Overview" cards of raw keys, or "Could not load this page".

### Owner account
201. Supplier: sign in as a supplier business. Supplier Hub, Supplier Dashboard, My Catalog and Orders from Buyers each open a phone screen.
202. Sales: every row opens a phone screen or a tab (Invoices, Customers). Open a few to the end: Quotations, Sales Orders, Delivery Challans, Credit Notes, Orders, Recurring invoices, Payment reminders.
203. Purchases: Suppliers opens its tab; Supplier Hub, Incoming Bills, Supplier Orders, New Arrivals, All Purchases, Order List, Purchase Orders, Purchase Returns and Expenses each open a phone screen.
204. Inventory: Items opens its tab; Party Pricing, Price Levels, Schemes, Price List, Print Labels, Warehouses, Stock Transfers, Adjustments, Stock Counts, Held & Others' Goods, Manufacturing, Insurance Claims, Units & Duplicates, Stock with Parties, Stock Summary and Closing Stock each open a phone screen.
205. Accounting: Chart of Accounts, Journal Entries, Contra, Inter-branch balances, Advances, Recurring invoices, Fixed assets, Bank reconciliation, Ledger, Payments In, Payments Out, Reconciliation, Provisions and TDS/TCS each open a phone screen. Bank import shows the globe and opens the website.
206. Reports: Overview and every sales, purchase, stock and GST report open a phone screen. Custom Report Builder and GSTR-9 show the globe and open the website; each loads with the bar along the top.
207. HR & Employees: the HR dashboard, All Employees, Attendance, Leaves, Salary, Advances, Expenses, Commissions, Tasks, Recruitment, Exits, Documents and Reports each open a phone screen. Leave year-end and leave balance import open the website.
208. Connect: Dashboard, Conversations, Leads, Pipeline, Lead sources, Campaigns, Contacts, Send message, Who to message, Flows, Saved replies and Order verification each open a phone screen. Bot rules opens Flows.
209. Tools: All Tools shows the grid; every calculator and checker opens its screen; To Do List opens the to-do screen; Image Reducer, BG Remover and Group Extractor show the globe and open the website.
210. Settings & data: Settings opens the hub; open one row in every group (Account, Team & permissions, Plan, Sales & billing, Online store, Inventory, People, WhatsApp, Integrations, System, Help). Rows kept on the website (Store design studio, Templates designer, Workflow automation, Restore from a backup) say so.
211. Support: Documentation, Contact Support and Privacy Policy each open a phone screen.
212. Open a notification in the bell list whose link has no phone screen, or search for a record type with no screen → the website page opens inside the app, signed in. No plain list.
213. Write down any row that opened a plain list, an empty screen or an error. Each is a new task, not part of this one.

### Restricted staff account
214. Sign in as the staff account. The More menu shows only the sections the account may use; sections with no allowed rows (Reports, HR & Employees, Settings & data, say) are missing, not empty.
215. Supplier section: not shown for a customer-side business.
216. Sales: only the rows the role allows. Rows the plan locks show a lock; they still open, and saving there asks you to upgrade.
217. Purchases and Inventory: rows outside the role are missing. Open each row that is left → its phone screen loads, and any action the role cannot do (delete, approve, adjust stock) is hidden or refused with the server's message, not a crash.
218. Accounting and Reports: if the role has no reports permission, no report row appears. If it has some, each opens its phone screen.
219. HR & Employees: a staff account sees only its own tools (own attendance, leave, payslips), never the pay run, recruitment or exits.
220. Connect and Tools: Connect rows follow the role; Tools rows (calculators) always open. Locked rows (To Do List, Group Extractor on a lower plan) show the lock.
221. Settings & data: if the role has no settings permission, the row is missing. If it has, the hub opens but only the groups the role may use.
222. Support: Documentation, Contact Support and Privacy Policy are shown to every account and open.
223. From the staff account, if a push notification links outside the role → the screen opens but the server refuses its data with a message; nothing crashes and no other business's data shows.
224. Compare the two walks: every row the owner saw and the staff did not is explained by a missing permission or a locked plan. Note any row where it is not.

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
- `recordDecision` in `lib/gst/gstr2b-reconciliation.ts` still has no business check of its own; the decision route now checks first, but any other caller would not.
- Profit & Loss earnings rows (PBT, EBIT, EBITDA) and the Schedule III layout are website-only.
- The employee routes do not check the HR plan for the reporting manager, PAN, Aadhaar and PF/ESI fields; only the forms hide them.
- A salary payment is still not saved in one step: a failure other than a locked month after it is saved can leave it without a journal entry (the phone says so).
- Starting a termination is not limited to HR on the server.
- The task routes have no permission check: any signed-in user of the business can create, edit or delete tasks.
- Owner-side poll voting and closing, template delete, onboarding tasks, candidate document checks and portal invites are website-only.
- Campaign button clicks always show 0: the server never records which button a customer tapped (`whatsapp_campaign_recipients.button_clicked_id`), and the website page reads a field the API never sends.
- Approving a WhatsApp order by id accepts any not-yet-invoiced order of the business, not only a draft WhatsApp order (the phone only offers WhatsApp drafts).
- A lead opened from a link shows Delete only on your own comments, because no reply says who is a supervisor (the server still lets supervisors delete).
- The website's Workflow automation page saves nothing: there is no workflows backend (`/api/workflows` does not exist).
- Supply-order proposals check only the approved supplier link, not whether the customer shares low stock (`allow_low_stock_access`); the buyer still confirms.
