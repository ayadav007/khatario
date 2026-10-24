# Action inventory

Generated from page source and one level of `@/components` or relative imports on 2026-10-19.

## Limits of this inventory

Visible labels were kept only when they start with an action verb (Save, Delete, Export, and similar). Icon-only buttons, actions built from translated strings, and actions inside components imported deeper than one level are missing. A label in source is not proof the control is shown for every role.

**Source-identified action labels:** 827 across 257 of 385 pages.
**Pages with a detected shell** (tabs, dialog, sheet, drawer, upload, pagination, sort, or bulk selection): 85.
Every action label below was **not executed** in Phase 1. Invoice create was later tested through `POST /api/invoices`, not by clicking these labels. Phase 3C called API handlers only and did not click these labels. Do not mark a label PASS from an API run. See `docs/qa/README.md`.

## Critical workflows traced in code

These are code paths, not executed scenarios. Expected effects below are what the cited functions do. UI labels and error copy are not fully specified here.

### Final sales invoice (`POST /api/invoices` and `createInvoiceInTransaction`)

Source: `lib/invoices/invoice-create-service.ts`, `app/api/invoices/route.ts`.

For a non-draft final invoice the service, inside one database transaction:

1. Requires business, invoice date, at least one line, and `created_by`.
2. Rejects dates on or before a locked closing-stock cutoff (`CLOSING_STOCK_PERIOD_LOCKED`).
3. Resolves branch, then enforces feature and limit access for invoice creation.
4. Loads the customer for the same business. Missing customer returns `CUSTOMER_NOT_FOUND`.
5. Rejects lines whose item was soft-deleted (`PRODUCT_DELETED`).
6. Applies GST scheme policy (composition / unregistered can change document type and whether tax is collected). Intra-state vs inter-state chooses CGST+SGST vs IGST via `computeLineGst`.
7. Allocates a branch invoice number and inserts `invoices` plus `invoice_items` (taxable value, CGST, SGST, IGST, line total).
8. Deducts stock per goods line (branch stock, variant stock, or `location_stock` when warehouse mode and a location are set) and inserts `stock_movements` type `out`, reference `invoice`. Bundle lines have a separate insufficient-stock path.
9. Inserts `payments` rows when the payload includes payment entries, updates `customers.current_balance` by the unpaid balance, and posts ledger entries through `createInvoiceLedgerEntries`. Customer payments also call `createPaymentLedgerEntries`.
10. Drafts (only when the caller allows draft) insert the invoice and lines, skip stock, customer balance, and ledger, and return early.

COGS passed into the ledger call in this function is `0`. Whether cost of goods is posted elsewhere was not confirmed in this pass.

Cash sale is the path with no `customer_id`.

Proforma documents are rejected by the offline replay helper. The HTTP `POST /api/invoices` handler was not line-audited beyond confirming it exports GET and POST. Do not treat this workflow as a complete specification of edit, cancel, credit note, or e-invoice.

### Other document flows

Purchase bills, credit notes, debit notes, payments, stock transfers, and journal entries each have their own API trees (see route inventory). Their side effects were not traced line by line in this phase. Do not copy the invoice side-effect list onto them.

## Actions by page

| Page | URL | Shells detected | Action labels detected in source | Test status |
| --- | --- | --- | --- | --- |
| P001 | `/[slug]/candidates` | — | — none detected | not executed |
| P002 | `/[slug]/candidates/tasks/[taskId]` | — | — none detected | not executed |
| P003 | `/[slug]/employees` | — | Reset password; Apply for leave | not executed |
| P004 | `/[slug]/employees/attendance` | — | — none detected | not executed |
| P005 | `/[slug]/employees/engagement` | — | Reset password | not executed |
| P006 | `/[slug]/employees/expenses` | — | New expense | not executed |
| P007 | `/[slug]/employees/kiosk` | — | — none detected | not executed |
| P008 | `/[slug]/employees/leaves` | — | Reset password; Approved; Rejected; Cancelled; Approver: {r.approver_name} | not executed |
| P009 | `/[slug]/employees/leaves/new` | — | Apply for leave | not executed |
| P010 | `/[slug]/employees/overtime/new` | — | Apply for overtime | not executed |
| P011 | `/[slug]/employees/payslips` | — | — none detected | not executed |
| P012 | `/[slug]/employees/profile` | — | Reset password | not executed |
| P013 | `/[slug]/employees/team` | — | Reset password | not executed |
| P014 | `/[slug]/employees/team/approvals` | — | Reset password | not executed |
| P015 | `/[slug]/employees/todo` | — | Reset password; Created by: | not executed |
| P016 | `/accounts` | pagination | void \| Promise | not executed |
| P017 | `/accounts/[id]` | — | void \| Promise | not executed |
| P018 | `/accounts/[id]/edit` | — | Edit account | not executed |
| P019 | `/accounts/[id]/reconciliation` | — | — none detected | not executed |
| P020 | `/accounts/new` | — | Create new account | not executed |
| P021 | `/activity-logs` | — | Create; Update; Delete; Approve; Reject | not executed |
| P022 | `/admin` | — | — none detected | not executed |
| P023 | `/admin/assistant` | pagination | Close | not executed |
| P024 | `/admin/billing` | — | — none detected | not executed |
| P025 | `/admin/blog` | pagination | New article; Published; Search; Edit; Preview; Unpublish; Publish; Confirm delete; Cancel; Delete | not executed |
| P026 | `/admin/blog/[id]` | — | Publish; Unpublish; editor.chain().focus().undo().run()}>Undo; editor.chain().focus().redo().run()}>Redo; applyImage({ wrap: 'none' })}>No wrap; Delete this article permanently?; Delete; Cancel; Delete article | not executed |
| P027 | `/admin/blog/[id]/preview` | — | — none detected | not executed |
| P028 | `/admin/blog/new` | — | Publish; Unpublish; editor.chain().focus().undo().run()}>Undo; editor.chain().focus().redo().run()}>Redo; applyImage({ wrap: 'none' })}>No wrap; Delete this article permanently?; Delete; Cancel; Delete article | not executed |
| P029 | `/admin/bookings` | — | Converted; Cancelled | not executed |
| P030 | `/admin/bookings/[id]` | — | Add Activity | not executed |
| P031 | `/admin/bookings/time-slots` | — | — none detected | not executed |
| P032 | `/admin/businesses` | pagination | Delete; Delete tenant permanently | not executed |
| P033 | `/admin/businesses/[id]` | — | Record payment (manual) | not executed |
| P034 | `/admin/hsn-codes` | file-upload | Upload and manage HSN/SAC codes for product lookup; Upload HSN/SAC Codes; Download Template; Uploading...; Upload & Import; Imported; Updated | not executed |
| P035 | `/admin/login` | — | — none detected | not executed |
| P036 | `/admin/partners` | file-upload | Create payout (with TDS); Approved | not executed |
| P037 | `/admin/partners/[id]` | — | — none detected | not executed |
| P038 | `/admin/plans` | — | Create Plan; Edit Plan; Enable or disable features for this plan; Save Changes | not executed |
| P039 | `/admin/policies` | — | — none detected | not executed |
| P040 | `/admin/releases` | — | Ship to production | not executed |
| P041 | `/admin/reports` | — | — none detected | not executed |
| P042 | `/admin/sales-flow` | file-upload, pagination | Send test to my number; Editing draft v{data.draft.version}; Saved {when(data.draft.updated_at)}; Upload image or video; uploaded | not executed |
| P043 | `/admin/settings` | file-upload | PostgreSQL 15; Saved here; Preview; Edit; Delete; create; Enable alerts | not executed |
| P044 | `/admin/site-builder` | — | — none detected | not executed |
| P045 | `/admin/site-builder/preview` | — | — none detected | not executed |
| P046 | `/admin/social` | — | Marketing; Connection; Save caption; Approve; Save; Create paused; void run(() => load())}>Refresh; Create a paused ad before there is anything to measure. | not executed |
| P047 | `/admin/subscriptions` | — | — none detected | not executed |
| P048 | `/admin/users` | — | Add Admin; Created; Add Platform Admin | not executed |
| P049 | `/admin/videos` | — | new Promise; Download; Delete from server; Saved videos | not executed |
| P050 | `/advances` | — | Close; Refund paid from / received into | not executed |
| P051 | `/attendance/kiosk` | — | — none detected | not executed |
| P052 | `/attendance/login` | — | — none detected | not executed |
| P053 | `/auth/impersonate` | — | — none detected | not executed |
| P054 | `/bank/import` | file-upload | Delete row | not executed |
| P055 | `/bank/reconciliation` | bulk-selection | Duplicate warning; Refreshing…; Post missing ledger entry | not executed |
| P056 | `/blog` | pagination | Search | not executed |
| P057 | `/blog/[slug]` | — | — none detected | not executed |
| P058 | `/blog/category/[slug]` | pagination | Search | not executed |
| P059 | `/book-demo` | — | Confirming your booking…; Close menu; New conversation; Close assistant; Send | not executed |
| P060 | `/connect/whatsapp` | — | — none detected | not executed |
| P061 | `/contra` | — | — none detected | not executed |
| P062 | `/credit-approvals` | tabs | Reject Credit Approval | not executed |
| P063 | `/credit-notes` | pagination | New Credit Note | not executed |
| P064 | `/credit-notes/[id]` | — | Print preview unavailable | not executed |
| P065 | `/credit-notes/new` | — | New credit note | not executed |
| P066 | `/customers` | sheet, pagination | Edit; Send WhatsApp Reminder; Filters; Locked | not executed |
| P067 | `/customers/[id]` | tabs, file-upload | Create Invoice; Receive Payment; Download; Delete; Uploaded by {doc.uploaded_by_name}; Enable customer portal | not executed |
| P068 | `/customers/[id]/edit` | — | Edit customer; Shipping address | not executed |
| P069 | `/customers/[id]/statement` | — | — none detected | not executed |
| P070 | `/customers/new` | — | Add new customer; Shipping address; Add {trialConfig.label} free; Confirm upgrade to {selectedPlan.display_name} | not executed |
| P071 | `/dashboard` | — | Close; Close create menu; Create; Close restock options; Create purchase order; Record purchase | not executed |
| P072 | `/debit-notes` | — | New Debit Note | not executed |
| P073 | `/debit-notes/[id]` | — | Print preview unavailable | not executed |
| P074 | `/debit-notes/new` | — | New debit note; Save debit note | not executed |
| P075 | `/debug/dashboard-refresh` | — | Refresh key bumps: {stats.refreshKeyBumps} | not executed |
| P076 | `/debug/sqlite` | — | — none detected | not executed |
| P077 | `/debug/webview` | — | — none detected | not executed |
| P078 | `/delivery-challans` | — | New Delivery Challan | not executed |
| P079 | `/delivery-challans/[id]` | — | Print preview unavailable | not executed |
| P080 | `/delivery-challans/edit/[id]` | — | Create a shipping document for goods delivery; Export; Addresses; Shipping Address; Dispatch From Address; Additional Information | not executed |
| P081 | `/delivery-challans/new` | — | Create a shipping document for goods delivery; Export; Addresses; Shipping Address; Dispatch From Address; Additional Information | not executed |
| P082 | `/employees` | pagination | Filters; Close filters; Add Employee; void \| Promise; Send portal invite; Reset password only (no message sent) | not executed |
| P083 | `/employees/[id]` | tabs | Uploaded Documents:; Upload Document; void \| Promise; Send via; Send portal invite; Reset portal password | not executed |
| P084 | `/employees/[id]/edit` | — | Edit employee; Pay type | not executed |
| P085 | `/employees/attendance` | — | — none detected | not executed |
| P086 | `/employees/attendance/mark` | — | — none detected | not executed |
| P087 | `/employees/attendance/mark/advanced` | — | — none detected | not executed |
| P088 | `/employees/commissions` | — | Approved; Cancelled | not executed |
| P089 | `/employees/expenses` | — | Print Voucher; Download Voucher; Approved; Rejected; Cancelled; void \| Promise | not executed |
| P090 | `/employees/expenses/new` | file-upload | Submit expense; Cancel | not executed |
| P091 | `/employees/leaves` | — | Approved; Rejected; Cancelled; void \| Promise | not executed |
| P092 | `/employees/leaves/calendar` | — | Approved/pending leave and attendance (absent, half day) in one view | not executed |
| P093 | `/employees/leaves/new` | — | Cancel | not executed |
| P094 | `/employees/manager` | — | — none detected | not executed |
| P095 | `/employees/manager/approvals` | — | — none detected | not executed |
| P096 | `/employees/manager/attendance` | — | — none detected | not executed |
| P097 | `/employees/manager/team` | — | — none detected | not executed |
| P098 | `/employees/new` | — | New employee; Add {trialConfig.label} free; Confirm upgrade to {selectedPlan.display_name}; Send via; Send portal invite; Reset portal password | not executed |
| P099 | `/employees/org-chart` | — | — none detected | not executed |
| P100 | `/employees/performance` | — | — none detected | not executed |
| P101 | `/employees/recruitment` | — | New job; Add candidates from a job page. | not executed |
| P102 | `/employees/recruitment/candidates/[id]` | — | updateInterview(String(i.id), 'passed')}>Pass; updateInterview(String(i.id), 'failed')}>Fail; Additional terms; Save draft; Send to candidate; Submit offer for approval; Approver | not executed |
| P103 | `/employees/recruitment/candidates/[id]/tasks/[taskId]` | file-upload | Upload file; Add file; Upload at least one document after saving details.; Upload document | not executed |
| P104 | `/employees/recruitment/jobs/[id]` | — | Add candidate; Save | not executed |
| P105 | `/employees/recruitment/jobs/new` | — | New job; Add round; Cancel | not executed |
| P106 | `/employees/salary/advances` | — | Approved; Rejected | not executed |
| P107 | `/employees/salary/advances/new` | — | Cancel | not executed |
| P108 | `/employees/salary/payments` | — | Cancelled; Payment Date | not executed |
| P109 | `/employees/salary/payments/new` | — | Payment Details; Cancel | not executed |
| P110 | `/employees/salary/payslips/[id]` | — | Payslip preview | not executed |
| P111 | `/employees/targets` | — | Save Target | not executed |
| P112 | `/employees/tasks` | — | Cancelled; Assigned to:; void \| Promise | not executed |
| P113 | `/employees/tasks/new` | — | Create task; Cancel | not executed |
| P114 | `/estimates` | pagination | New Estimate; Convert to Invoice; Convert to Sales Order; Rejected; Share Invoice; Share with apps; Send via Email; Send from my connected WhatsApp number; Copy Link; Download PDF; Save to your device; Create Another Invoice | not executed |
| P115 | `/expenses` | — | Add Expense; Filter by Category; Payment Mode; Reverse charge (RCM); Payment; Close | not executed |
| P116 | `/expenses/categories` | — | Add Category; Create categories to group your expenses.; Add a category to organize your expenses | not executed |
| P117 | `/expenses/new` | — | — none detected | not executed |
| P118 | `/fixed-assets` | — | Close; Additions (180+ days); Additions (&lt;180 days) | not executed |
| P119 | `/guides` | — | Close menu; Search how-to guides | not executed |
| P120 | `/hr/dashboard` | — | New joiners (month) | not executed |
| P121 | `/hr/documents` | — | Save template; Create or select a template; void generate('pdf')}>Download PDF | not executed |
| P122 | `/hr/engagement` | — | New announcement; New poll; New article; Add departments in HR settings first. | not executed |
| P123 | `/hr/exits` | — | — none detected | not executed |
| P124 | `/hr/leaves/import-balances` | bulk-selection | Import leave balances | not executed |
| P125 | `/hr/leaves/year-end` | — | — none detected | not executed |
| P126 | `/hr/reports` | — | — none detected | not executed |
| P127 | `/hr/shifts/bulk-assign` | bulk-selection | Bulk shift assignment | not executed |
| P128 | `/hr/shifts/roster` | bulk-selection | — none detected | not executed |
| P129 | `/i/[token]` | — | — none detected | not executed |
| P130 | `/inventory-adjustments` | pagination | Adjustments; Search; Adjustment #; Created By | not executed |
| P131 | `/inventory-adjustments/[id]` | — | Adjustment not found; Adjustment Details; Adjustment Type; Created By; Adjustment Number | not executed |
| P132 | `/inventory-adjustments/new` | — | New adjustment; Confirm Adjustment; New Stock:; New Total Value:; Scan barcode with camera | not executed |
| P133 | `/invoices` | pagination | Record Payment; Share Invoice; Create Return; Cancelled; Share with apps; Send via Email; Send from my connected WhatsApp number; Copy Link; Download PDF; Save to your device; Create Another Invoice; Close; Synced; Sync failed; Locked | not executed |
| P134 | `/invoices/[id]` | file-upload | Preview Error; Approve; Finalize; Pay; Share; Convert; Payment Information {isDraft && '(Draft)'}; Payment History; Close; Send To; Share Invoice; Share with apps; Send via Email; Send from my connected WhatsApp number; Copy Link; Download PDF; Save to your device; Create Another Invoice; Record Payment; Cancel Invoice; Reverse stock movements for all items; Lock the invoice from further edits; Download | not executed |
| P135 | `/invoices/[id]/edit` | — | — none detected | not executed |
| P136 | `/invoices/[id]/view` | — | Edit invoice; Share Invoice; Share with apps; Send via Email; Send from my connected WhatsApp number; Copy Link; Download PDF; Save to your device; Create Another Invoice; Saved. Print the bill to see the number. | not executed |
| P137 | `/invoices/mock` | — | Ship to; Shipping address fills in after you pick a customer; Payment terms; Remove (Ctrl + Delete); Add items; Add items to bill; Close; Printed on invoice; Add one; Remove payment; Remove; Export &amp; shipping; Export type | not executed |
| P138 | `/invoices/new` | file-upload | Save draft; Close preview; Searching...; Edit Customer Address; Cancel; Save; Ship To; Additional Information; Dispatched through; Remove; Uploading...; Upload Attachments; Export Type; Shipping Bill No.; Shipping Bill Date; Export details; Export type; Shipping bill no.; Shipping bill date; Save Draft & Switch; Preview; Close scanner; Share Invoice; Share with apps | not executed |
| P139 | `/invoices/recurring` | — | New Recurring Invoice | not executed |
| P140 | `/invoices/whatsapp` | tabs | Connect WhatsApp and configure automated reminders; Save Templates; Reminder | not executed |
| P141 | `/items` | sheet, file-upload, pagination | Edit; Filter by category; Print Barcodes; Filters; Close; Close settings menu; void \| Promise | partial — the icon-only Delete button and its confirmation were used; these labels were not clicked |
| P142 | `/items/[id]` | tabs, bulk-selection | Record damage; Edit; Delete; Newline; Close | not executed |
| P143 | `/items/barcodes` | bulk-selection | Print labels; Printer: {printer.printer.name} | not executed |
| P144 | `/items/categories` | — | Delete category; New Category; Add a category to organize your items | not executed |
| P145 | `/items/new` | file-upload | Scan barcode with camera; Generate unique barcode; Print barcode label; Remove photo; Remove component; Generate barcode; Print barcode; Add; Add sizes or colors above to generate variants.; Add {trialConfig.label} free; Confirm upgrade to {selectedPlan.display_name}; Close scanner; Scan Barcode | not executed |
| P146 | `/journal-entries` | pagination | Close | not executed |
| P147 | `/journal-entries/[id]` | file-upload | Locked by: {entry.locked_by_name \|\| 'Unknown'}; Download; Delete; Uploaded by {doc.uploaded_by_name} | not executed |
| P148 | `/journal-entries/new` | — | New journal entry; Create Reversing Entry; Cancel | not executed |
| P149 | `/journal-entries/templates` | — | Create reusable templates for recurring entries | not executed |
| P150 | `/ledger` | pagination | Payment | not executed |
| P151 | `/ledger/account/[id]` | — | — none detected | not executed |
| P152 | `/login` | — | — none detected | not executed |
| P153 | `/more` | — | Locked | not executed |
| P154 | `/notifications` | tabs | — none detected | not executed |
| P155 | `/offline` | — | — none detected | not executed |
| P156 | `/opening-balances/setup` | — | — none detected | not executed |
| P157 | `/orders` | pagination, bulk-selection | Payment; Close; Shiprocket could not book this parcel:; collected; void move('confirmed')}>Confirm; Mark delivered; void move('returned')}>Returned; void act({ action: 'cod_collected' })}>Cash collected; void removeParcel()}>Remove parcel; Send rest as another parcel; Dispatch within (hours); Cancel | not executed |
| P158 | `/page.tsx` | — | — none detected | not executed |
| P159 | `/partners` | — | — none detected | not executed |
| P160 | `/partners/deals` | — | Add lead | not executed |
| P161 | `/partners/earnings` | — | — none detected | not executed |
| P162 | `/partners/kit` | — | — none detected | not executed |
| P163 | `/partners/link` | — | — none detected | not executed |
| P164 | `/partners/login` | — | — none detected | not executed |
| P165 | `/partners/payouts` | — | Payouts | not executed |
| P166 | `/partners/profile` | — | Payout profile | not executed |
| P167 | `/partners/team` | — | — none detected | not executed |
| P168 | `/pay/complete` | — | — none detected | not executed |
| P169 | `/pay/upi/[token]` | — | Paying; Scan with any UPI app on your phone | not executed |
| P170 | `/payments/in` | — | Payment in; Print receipt; Download PDF; Print Receipt; Download Receipt; Record Payment; Search and split this receipt across open sales invoices.; Payment not found; Reversed; Close; Search invoices; Received | not executed |
| P171 | `/payments/out` | — | Print voucher; Download PDF; Payment out; Record Payment Out; Payment Mode *; Payment Date *; Record Payment; Payment not found; Reversed | not executed |
| P172 | `/payments/reconciliation` | — | Payment Reconciliation; Search | not executed |
| P173 | `/portal/[slug]` | — | — none detected | not executed |
| P174 | `/pricing/party-item` | bulk-selection | Search items | not executed |
| P175 | `/print/document` | — | new Promise | not executed |
| P176 | `/privacy` | — | — none detected | not executed |
| P177 | `/provisions` | — | — none detected | not executed |
| P178 | `/purchase-orders` | — | Filter by status; New purchase order; Filters; Close; Print preview unavailable | not executed |
| P179 | `/purchase-orders/[id]` | — | — none detected | not executed |
| P180 | `/purchase-orders/new` | — | New purchase order; Save Draft; Confirm Order; Confirm; Shipping Address; Scan barcode with camera | not executed |
| P181 | `/purchase-returns` | pagination | New Purchase Return | not executed |
| P182 | `/purchase-returns/[id]` | — | Cancellation reason; Refund from supplier; Refunded — money received; Adjusted — netted against purchase due | not executed |
| P183 | `/purchase-returns/new` | — | New purchase return | not executed |
| P184 | `/purchases` | sheet, pagination | Edit Purchase; Record Payment; Create Return; Cancelled; New Purchase; Filters | not executed |
| P185 | `/purchases/[id]` | file-upload | Download; Delete; Uploaded by {doc.uploaded_by_name}; Record Payment; Close | not executed |
| P186 | `/purchases/categories` | — | — none detected | not executed |
| P187 | `/purchases/incoming` | — | — none detected | not executed |
| P188 | `/purchases/incoming/[invoiceId]` | — | New item from this line | not executed |
| P189 | `/purchases/new` | file-upload | Scan and record bills; Scan &amp; record bills; Search in the name box to link this line to a catalogue item; Remove line; Payments recorded here go to cash. Record bank or UPI payments after saving.; New Purchase; New purchase; New party — not in your supplier list.; Import of services; Payment &amp; notes; Scan barcode with camera; Close; void \| Promise; Import of Services; Add new supplier; Scan barcode; Adjust quantities above, then confirm here. | not executed |
| P190 | `/purchases/new-arrivals` | — | New arrivals | not executed |
| P191 | `/purchases/new/select-item` | — | Scan barcode | not executed |
| P192 | `/purchases/requests` | — | New Request; Confirmed/Partial; Confirm Full; Confirm Partial; Create Purchase Document: | not executed |
| P193 | `/purchases/scan-record` | file-upload | — none detected | not executed |
| P194 | `/r/[token]` | — | Collect ₹{drop.codDue.toLocaleString('en-IN')} cash | not executed |
| P195 | `/recurring-invoices` | — | Copy lines from invoice | not executed |
| P196 | `/reports` | tabs, sheet | Export PDF; Collected | not executed |
| P197 | `/reports/aging/payables` | — | — none detected | not executed |
| P198 | `/reports/aging/receivables` | — | — none detected | not executed |
| P199 | `/reports/balance-sheet` | sheet | — none detected | not executed |
| P200 | `/reports/builder` | dialog | Save Report Template | not executed |
| P201 | `/reports/cash-flow` | — | Add: Depreciation; Adjustments for Changes in Working Capital: | not executed |
| P202 | `/reports/credit-risk` | tabs, sort | — none detected | not executed |
| P203 | `/reports/deleted` | — | Payments; Deleted at | not executed |
| P204 | `/reports/gst/cash-ledger` | — | — none detected | not executed |
| P205 | `/reports/gst/compliance` | — | Approved rules: {rcmCoverage.approvedRules}.; Close | not executed |
| P206 | `/reports/gst/gstr1` | tabs | — none detected | not executed |
| P207 | `/reports/gst/gstr2b` | tabs | — none detected | not executed |
| P208 | `/reports/gst/gstr2b-reconciliation` | tabs, file-upload | Reconcile purchase register with GSTR-2B data from GST portal; Import GSTR-2B File; Record Decision | not executed |
| P209 | `/reports/gst/gstr3b` | — | Close | not executed |
| P210 | `/reports/gst/gstr9` | — | — none detected | not executed |
| P211 | `/reports/gst/reconciliation` | — | Save for; Copy mismatches: id \| reason \| amount [\| GSTIN]; Search document / key; Filter by exception type | not executed |
| P212 | `/reports/inter-branch-reconciliation` | — | Refresh; Payables by Branch | not executed |
| P213 | `/reports/label-print-log` | — | — none detected | not executed |
| P214 | `/reports/profit-by-invoice` | sort | — none detected | not executed |
| P215 | `/reports/profit-loss` | — | Add: Purchases (net of returns); Print; Export Excel; Download PDF | not executed |
| P216 | `/reports/profit-loss/validation` | — | — none detected | not executed |
| P217 | `/reports/purchase/[reportType]` | — | Cancelled; Export | not executed |
| P218 | `/reports/sales/[reportType]` | — | Cancelled; Payment Mode; Cancellation Reason; Cancelled At; Refund Status; Export | not executed |
| P219 | `/reports/stock/closing-stock` | pagination | Lock inventory value for financial reporting, audit, and period control. | not executed |
| P220 | `/reports/stock/fifo-lots` | — | Posted cost | not executed |
| P221 | `/reports/stock/summary` | pagination | — none detected | not executed |
| P222 | `/reports/stock/valuation` | — | — none detected | not executed |
| P223 | `/reports/trial-balance` | — | — none detected | not executed |
| P224 | `/sales-orders` | bulk-selection | Bulk Convert; Bulk; New Sales Order; Payment; Close | not executed |
| P225 | `/sales-orders/[id]` | — | Edit sales order; Payment; Close; Send To | not executed |
| P226 | `/sales-orders/new` | — | Scan barcode with camera | not executed |
| P227 | `/search` | — | Search; Search Results; Searching for: "{query}"; Searching... | not executed |
| P228 | `/settings` | — | Search settings | not executed |
| P229 | `/settings/account-mappings` | — | — none detected | not executed |
| P230 | `/settings/activity` | — | Payments | not executed |
| P231 | `/settings/ai-agent` | — | — none detected | not executed |
| P232 | `/settings/ai-assistant` | — | — none detected | not executed |
| P233 | `/settings/ai-config` | — | — none detected | not executed |
| P234 | `/settings/attendance-policy` | — | — none detected | not executed |
| P235 | `/settings/attendance-regularization` | — | — none detected | not executed |
| P236 | `/settings/automation` | — | Save Workflow | not executed |
| P237 | `/settings/backup` | file-upload | Create Backup Now; Restore Backup; Create a new project or select existing; Enable; Add Authorized redirect URI:; Copy Client ID and Client Secret below; Copy this URL and add it to your Google Cloud Console; Restore Preview; Restore Mode; Preview; Cancel; Disconnect; Save Schedule | not executed |
| P238 | `/settings/bluetooth-printer` | — | Print & devices; Add a printer; Connected; Printer settings; Remove; Printers on this device; Close; Save | not executed |
| P239 | `/settings/bluetooth-printer/diagnostics` | — | Printer diagnostics; Printer | not executed |
| P240 | `/settings/branches` | — | Add Branch; Create your first branch to get started; Address; Edit; Delete | not executed |
| P241 | `/settings/branches/[id]/edit` | — | Edit branch; Address | not executed |
| P242 | `/settings/branches/new` | — | Create branch; Address | not executed |
| P243 | `/settings/business` | file-upload | Address; Exporter details; Export; Add {gaps.map((g) => g.label.toLowerCase()).join(', ')}; Editing branch: {branch?.name}.; Print language is not on your plan; Print language | not executed |
| P244 | `/settings/commission-rules` | — | Save | not executed |
| P245 | `/settings/custom-fields` | — | — none detected | not executed |
| P246 | `/settings/departments` | — | — none detected | not executed |
| P247 | `/settings/email` | — | Enable outbound email for this business | not executed |
| P248 | `/settings/employee-portal` | — | — none detected | not executed |
| P249 | `/settings/export` | — | — none detected | not executed |
| P250 | `/settings/features` | — | — none detected | not executed |
| P251 | `/settings/financial-years` | — | New financial year | not executed |
| P252 | `/settings/gst-config` | — | — none detected | not executed |
| P253 | `/settings/help` | — | — none detected | not executed |
| P254 | `/settings/help/how-to` | — | Search how-to guides | not executed |
| P255 | `/settings/hiring` | — | — none detected | not executed |
| P256 | `/settings/holiday-lists` | bulk-selection | Create list for branch; Add holiday; Import CSV | not executed |
| P257 | `/settings/holidays` | — | Save | not executed |
| P258 | `/settings/hr-approval` | — | — none detected | not executed |
| P259 | `/settings/hr-employee` | — | — none detected | not executed |
| P260 | `/settings/hr-exit` | — | — none detected | not executed |
| P261 | `/settings/integrations` | — | Search integrations | not executed |
| P262 | `/settings/invoice` | — | — none detected | not executed |
| P263 | `/settings/label-templates` | bulk-selection | Delete | not executed |
| P264 | `/settings/label-templates/[id]` | sheet | Duplicate; Remove | not executed |
| P265 | `/settings/label-templates/new` | sheet | Remove | not executed |
| P266 | `/settings/leave-plan` | — | updateTypeRule({ [key]: e.target.checked } as Partial | not executed |
| P267 | `/settings/leave-types` | — | Save | not executed |
| P268 | `/settings/number-series` | — | Preview | not executed |
| P269 | `/settings/offer-letter` | — | — none detected | not executed |
| P270 | `/settings/offline-sync` | — | Connectivity; Duplicates prevented: {metrics.totalDuplicatesPrevented} | not executed |
| P271 | `/settings/onboarding-templates` | — | Edit — {editing.task_key}; Invite email template; Preview | not executed |
| P272 | `/settings/online-store` | file-upload | Shiprocket; Save | not executed |
| P273 | `/settings/online-store/enquiries` | pagination | — none detected | not executed |
| P274 | `/settings/online-store/orders` | pagination | Close scanner; Scan Barcode | not executed |
| P275 | `/settings/online-store/studio` | pagination | Editing | not executed |
| P276 | `/settings/ot-policy` | — | Pay rules by scenario; Pay mode | not executed |
| P277 | `/settings/payments` | — | Payments; Payment providers; Edit; Delete; Paytm; Add a payment method to send payment links via WhatsApp | not executed |
| P278 | `/settings/payroll` | — | Payroll settings; Pay schedule | not executed |
| P279 | `/settings/period-locks` | — | Lock Period; Locked By; Locked; Unlocked | not executed |
| P280 | `/settings/products` | — | Add {trialConfig.label} free; Confirm upgrade to {selectedPlan.display_name} | not executed |
| P281 | `/settings/roles` | — | Create New Role | not executed |
| P282 | `/settings/salary-components` | — | — none detected | not executed |
| P283 | `/settings/shifts` | bulk-selection | Bulk assign; Save | not executed |
| P284 | `/settings/signature` | — | — none detected | not executed |
| P285 | `/settings/subscription` | dialog | Apply Coupon; Cancel Subscription; Cancel Subscription? | not executed |
| P286 | `/settings/suppliers-directory` | — | Remove; Published listings (public preview) | not executed |
| P287 | `/settings/tax` | — | — none detected | not executed |
| P288 | `/settings/templates` | dialog, drawer, tabs, file-upload | Copy template settings to other document types; Preview; Preview generated from template:; Copy Template Settings; Remove logo; Export Invoice Fields; Cancel; Add {trialConfig.label} free; Confirm upgrade to {selectedPlan.display_name} | not executed |
| P289 | `/settings/templates/customize` | tabs | Refresh preview manually; Preview may take a moment to load | not executed |
| P290 | `/settings/user-branches` | — | Assign User; Assign User to Branch | not executed |
| P291 | `/settings/user-management` | — | — none detected | not executed |
| P292 | `/settings/user-warehouses` | — | Assign User; Assign User to Warehouse | not executed |
| P293 | `/settings/users` | — | Edit user; Delete user; Add New User; Edit User; Edit; Create; Add {trialConfig.label} free; Confirm upgrade to {selectedPlan.display_name} | not executed |
| P294 | `/settings/warehouses` | — | Add Warehouse | not executed |
| P295 | `/settings/warehouses/[id]/edit` | — | Edit warehouse; Address | not executed |
| P296 | `/settings/warehouses/new` | — | Add new warehouse; Address | not executed |
| P297 | `/settings/weekly-off` | — | — none detected | not executed |
| P298 | `/settings/whatsapp` | bulk-selection | Refresh status; Payment reminders; Disconnect WhatsApp?; Scan with the phone that has this number | not executed |
| P299 | `/settings/whatsapp/ai-agent` | — | void load()}>Try again | not executed |
| P300 | `/settings/whatsapp/inbox` | — | Shared inbox; Saved replies | not executed |
| P301 | `/settings/whatsapp/notifications` | — | Payment reminders; Send now and history; Updates for you | not executed |
| P302 | `/settings/whatsapp/shop` | — | Connect a payment gateway; Save first, then sync. | not executed |
| P303 | `/settings/whatsapp/team` | — | — none detected | not executed |
| P304 | `/settings/whatsapp/templates` | — | Marketing (offers) | not executed |
| P305 | `/signup` | — | Connect; Export; New conversation; Close assistant; Send | not executed |
| P306 | `/solution/accounting` | — | Close menu | not executed |
| P307 | `/solution/inventory` | — | Close menu | not executed |
| P308 | `/stock-transfers` | — | Transfer inventory between warehouses; New Transfer | not executed |
| P309 | `/stock-transfers/[id]` | — | Transfer Not Found; Transfer Details; Transfer Number; Transfer Date; Approved By; Approved At; Dispatched; Received | not executed |
| P310 | `/stock-transfers/[id]/receive` | — | Receive transfer; Received quantities; Transfer Not Found | not executed |
| P311 | `/stock-transfers/new` | — | New stock transfer; Transfer details; Add Item; Scan barcode with camera | not executed |
| P312 | `/store` | pagination | — none detected | not executed |
| P313 | `/store/about` | — | Refunds | not executed |
| P314 | `/store/account` | — | Refunds; Close | not executed |
| P315 | `/store/cart` | — | Refunds | not executed |
| P316 | `/store/checkout` | — | Refunds; Pay {store.name}; Payment | not executed |
| P317 | `/store/contact` | — | Refunds; Preview only. No message was sent. | not executed |
| P318 | `/store/privacy` | — | — none detected | not executed |
| P319 | `/store/products/[id]` | — | Refunds; Close zoom | not executed |
| P320 | `/store/refund` | — | Refund policy | not executed |
| P321 | `/store/terms` | — | — none detected | not executed |
| P322 | `/store/wishlist` | — | Refunds | not executed |
| P323 | `/suppliers` | pagination | Edit; Filters; Add Supplier; void \| Promise | not executed |
| P324 | `/suppliers/[id]` | tabs, file-upload | New order; Share stock and sales with this supplier; Create Purchase; Payment Mode; Download; Delete; Uploaded by {doc.uploaded_by_name}; void \| Promise | not executed |
| P325 | `/suppliers/[id]/item-links` | — | — none detected | not executed |
| P326 | `/suppliers/[id]/items` | — | — none detected | not executed |
| P327 | `/suppliers/catalog` | — | Collections; Scan barcode with camera | not executed |
| P328 | `/suppliers/dashboard` | — | — none detected | not executed |
| P329 | `/suppliers/dashboard/analytics` | — | — none detected | not executed |
| P330 | `/suppliers/dashboard/thresholds` | — | Delete threshold; New Threshold; Add a threshold to start monitoring your customers' inventory | not executed |
| P331 | `/suppliers/hub` | — | New bills, orders and requests will show up here.; Publish your catalog so your buyers can order from you here.; New order | not executed |
| P332 | `/suppliers/hub/[businessId]` | — | — none detected | not executed |
| P333 | `/suppliers/hub/find` | pagination | — none detected | not executed |
| P334 | `/suppliers/new` | — | Add new supplier; Address | not executed |
| P335 | `/suppliers/requests` | — | Confirmed/Partial; Confirm full; Confirmed Qty; Create Sales Document: | not executed |
| P336 | `/supply-orders` | — | New order | not executed |
| P337 | `/supply-orders/[id]` | — | Create bill; Receive bill; Scan barcode with camera | not executed |
| P338 | `/supply-orders/new` | — | Scan barcode with camera | not executed |
| P339 | `/tds` | — | Record deposits | not executed |
| P340 | `/tds/categories` | — | Edit category; Delete category; Add a category to manage TDS sections | not executed |
| P341 | `/tds/certificates` | — | Generate Form 16A certificates; Generate TDS Certificate; Filters; Generate a certificate to get started | not executed |
| P342 | `/tds/payments` | — | Record TDS deposits to government; Record TDS Payment; Filters; Record a payment to get started | not executed |
| P343 | `/tds/transactions` | — | Filters | not executed |
| P344 | `/terms` | — | — none detected | not executed |
| P345 | `/tools` | — | — none detected | not executed |
| P346 | `/tools/currency-converter` | — | Convert between Indian Rupee and other currencies | not executed |
| P347 | `/tools/discount-calculator` | — | — none detected | not executed |
| P348 | `/tools/emi-calculator` | — | — none detected | not executed |
| P349 | `/tools/google-lead-extractor` | — | — none detected | not executed |
| P350 | `/tools/gst-calculator` | — | — none detected | not executed |
| P351 | `/tools/gstin-validator` | — | Important: | not executed |
| P352 | `/tools/hsn-finder` | — | — none detected | not executed |
| P353 | `/tools/image-background-remover` | file-upload | Upload Portrait or Product Photo | not executed |
| P354 | `/tools/image-size-reducer` | file-upload | — none detected | not executed |
| P355 | `/tools/interest-calculator` | — | — none detected | not executed |
| P356 | `/tools/invoice-number-generator` | — | Generate sequential invoice numbers with custom formatting; Copy; Preview Format | not executed |
| P357 | `/tools/pan-validator` | — | Important: | not executed |
| P358 | `/tools/price-margin-calculator` | — | Markup; Markup: | not executed |
| P359 | `/tools/tds-calculator` | — | Important Notes about TDS: | not executed |
| P360 | `/tools/todo` | tabs | Add Todo; Reminder:; Assign To; Reminder; Cancel; Create Todo; New Due Date *; Confirm Reschedule | not executed |
| P361 | `/tools/whatsapp-group-extractor` | — | — none detected | not executed |
| P362 | `/track/[token]` | — | Pay {inr(t.codDue)} on delivery. | not executed |
| P363 | `/upgrade` | — | — none detected | not executed |
| P364 | `/wa-shop/[token]` | — | Add to cart; Remove one; Add one more; Close | not executed |
| P365 | `/whatsapp` | — | — none detected | not executed |
| P366 | `/whatsapp/bot-rules` | — | — none detected | not executed |
| P367 | `/whatsapp/campaigns` | pagination | Create, manage, and track your WhatsApp marketing campaigns; Created | not executed |
| P368 | `/whatsapp/campaigns/[id]` | tabs | Created | not executed |
| P369 | `/whatsapp/contacts` | pagination, bulk-selection, file-upload | Filter by source; Add contact; Retry; Add Contact; Import Contacts; Imported: {result.results.imported} | not executed |
| P370 | `/whatsapp/contacts/groups` | — | — none detected | not executed |
| P371 | `/whatsapp/conversations` | pagination | — none detected | not executed |
| P372 | `/whatsapp/dashboard` | — | Retry; Closed | not executed |
| P373 | `/whatsapp/flows` | — | Generate flow with AI; void generate()} disabled={busy \|\| prompt.trim().length | not executed |
| P374 | `/whatsapp/flows/[id]` | — | Preview this draft without publishing; Reset preview; Close preview; Generate flow with AI; void generate()} disabled={busy \|\| prompt.trim().length | not executed |
| P375 | `/whatsapp/group-extractor` | — | — none detected | not executed |
| P376 | `/whatsapp/orders` | pagination | Receiver UPI:; payment link | not executed |
| P377 | `/whatsapp/reminders` | bulk-selection | Payment reminders; Reminder views; Filter Invoices; Payment Status; Search; Reminder History | not executed |
| P378 | `/whatsapp/saved-replies` | — | Edit; Delete; Saved Replies require the WhatsApp Bot addon.; Saved Replies | not executed |
| P379 | `/whatsapp/send-message` | bulk-selection | Send WhatsApp Message | not executed |
| P380 | `/whatsapp/unsubscribes` | pagination | Retry | not executed |
| P381 | `/whatsapp/who-to-message` | — | — none detected | not executed |
| P382 | `/work-orders` | — | New Work Order; Assigned To | not executed |
| P383 | `/work-orders/[id]` | — | Print preview unavailable | not executed |
| P384 | `/work-orders/edit/[id]` | — | Assigned To; Additional Information | not executed |
| P385 | `/work-orders/new` | — | Assigned To; Additional Information | not executed |
