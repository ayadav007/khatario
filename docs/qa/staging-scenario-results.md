# Staging scenario results

Scenario testing on `https://staging.khatario.com` with the QA personas in `staging-personas.md`. Started 2026-10-27. Staging code at start: `42141927`. Staging database: `khatario` (not `khatario_prod`).

Statuses: **PASS**, **FAIL**, **BLOCKED**, **NOT TESTED**. A loaded page is not a pass. Every row names how it was run: **UI** (built-in browser, clicks), or **API** (the same endpoint the page calls, with that persona's own login cookie).

## Setup done for this run

| Step | Result |
| --- | --- |
| Push `main` and staging deploy, migrations 420–431 | PASS. `Applied: 12`, `Failed: 0`. The user overrode the AGENTS.md migration rule for this deploy only. |
| `QA_TEST_PHONES=9000011001…9000011060`, `E2E_DISABLE_RATE_LIMIT=true` in staging `.env.production` | Done. Backup `.env.production.bak-20261027-qa`. Remove `E2E_DISABLE_RATE_LIMIT` after testing. |
| Signup OTP for a test phone | PASS. The response carries the code, the screen shows "Staging code", and the log shows `[qa-test-phone] cloud-template to 919000011060 not sent`. |
| Push `8d133937` (merged branches: damaged-goods choice, size-wise returns, alternate units, repack; migration 440) and deploy, migrations 436, 438, 439, 440 (owner approved) | 436, 438, 440 applied. 439 FAILED: `inventory_adjustments_reason_code_check … is violated by some row`; the deploy stopped before the build, staging kept serving `d1089fbf` (F-029). |
| Corrected 439 committed as `198f1498` and redeployed | PASS. `439_stock_repacks.sql ✅`, `Applied: 1`; deploy finished, staging on `198f1498`. |
| Staging deploy of `d1089fbf` (security review `a520b44a`, template designer `8bb24cdf`, migration 437; owner approved) | PASS. `Applied: 1`. Build about 65 minutes (F-020). |
| Push `main` to `d01aa0fb` with seven commits from other sessions and staging deploy, migrations 433–435 (owner approved, 2026-10-28) | Migrations PASS: 433_party_item_price_variants, 434_price_levels_and_party_pricing, 435_item_schemes applied. Deploy finished, staging on `d01aa0fb`. |

## Scenarios

| # | Area | Scenario | How | Result | Evidence / notes |
| --- | --- | --- | --- | --- | --- |
| ST-001 | Signup | Retailer signs up: form, OTP screen, verify, lands on dashboard | UI | PASS | QA Retailer Andheri, dashboard "Welcome back, QA Retail Owner A", all totals ₹0 |
| ST-002 | Signup | Four more signups through OTP request, verify, `POST /api/signup` | API | PASS | 201 each: Retailer Bengaluru, Wholesale Bhiwandi, Composition Pune, Unregistered Nashik |
| ST-003 | Settings | Registered address save | UI | PASS | Toast "Saved"; banner changed to "Ready to print bills" |
| ST-004 | Settings | GST registration: Regular, GSTIN entry fills PAN, save | UI | PASS | PAN `AQAPA1001A` filled from GSTIN; GSTIN shown after save |
| ST-005 | Settings | GST type regular / composition / unregistered with state from GSTIN | API | PASS | State code 29 for Karnataka GSTIN, 27 for Maharashtra; unregistered saved with no GSTIN |
| ST-006 | Login | Phone, then password, lands on the business home | UI | PASS | Wholesaler login |
| ST-007 | Users | Settings → Manage users has no add button and points to Employees | UI | PASS | Copy: "Add someone new from Employees, then give them a role there." |
| ST-008 | HR | Add employee with Accountant sign-in role and password | UI | PASS | QA Accountant Meera, EMP001, Full Access, Active. Phone stored as `919000011011`. |
| ST-009 | Roles | Owner creates custom role with default view-only permissions | API | PASS | Role "QA Read only" |
| ST-010 | HR / Users | Owner adds staff with Sales, Inventory Manager and the read-only role, with a password | API | PASS | EMP002–EMP004 |
| ST-011 | HR | Owner adds eight attendance-only employees (daily and monthly pay) | API | PASS | EMP005–EMP012 |
| ST-012 | Login | Each of the four staff logins signs in to the wholesaler business | API | PASS | 9000011011–014 |
| ST-020 | Items | Items with HSN, GST rate, purchase and selling price, opening stock (4 wholesaler, 2 retailer, 1 each composition and unregistered) | API | PASS |  |
| ST-021 | Customers | Customers with GSTIN and state (Retailer A 27, Retailer B 29), walk-in buyers | API | PASS |  |
| ST-022 | Stock | Opening stock equals the entered quantity | API | PASS | Rice 100, soap 40 |
| ST-030–033 | Sales | Wholesaler → Retailer A intra-state credit invoice: 10 rice @1800 (5%) + 5 soap @1100 (18%) | API | PASS | INV-001: CGST 945, SGST 945, IGST 0, total 25,390; rice stock 100 → 90 |
| ST-034–035 | Sales | Wholesaler → Retailer B inter-state invoice: 4 oil @2200 (5%) + 10 biscuits @500 (18%) | API | PASS | INV-002: IGST 1,340, CGST/SGST 0 |
| ST-036 | Receivables | Credit sale shows in the customer balance | API | PASS | 25,390 |
| ST-037 | Sales | Cash sale without a customer, paid in full | API | PASS | Total 1,180, balance 0 |
| ST-038 | Stock | Invoice for more than stock is refused | API | PASS | HTTP 400 with available quantity for the branch |
| ST-040 | GST | Composition and unregistered businesses: invoice becomes a bill of supply with no GST | API | PASS | document_type bill_of_supply, tax 0, total 1,200 each |
| ST-050–054 | Purchases | Retailer A records the wholesaler bill as a final purchase | API | PASS | Input CGST 945 + SGST 945, total 25,390 matches INV-001; rice stock 0 → 10 |
| ST-055–056 | Payments | Retailer A pays 10,000 against the bill by bank transfer | API | PASS | Bill balance 15,390. Needs a bank account chosen (F-003). |
| ST-057–058 | Purchase return | Retailer A returns 1 soap box | API | PASS | Stock 5 → 4 |
| ST-059 | Expenses | Expense with CGST+SGST in category Telephone & Internet, with retry key | API | PASS | Category is required; a missing category gives a clear message |
| ST-060 | Expenses | Expense with both IGST and CGST+SGST is refused | API | PASS | "Enter either IGST (inter-state) or CGST+SGST (intra-state), not both." |
| ST-061–063 | Receipts | Wholesaler receives 10,000 by UPI against INV-001 | API | PASS | Invoice partially_paid, balance 15,390; customer balance 15,390 |
| ST-064–067 | Credit note | Sales-return credit note for 1 soap box against INV-001 | API | PASS | CN-001 total 1,298 (CGST 99 + SGST 99); stock 35 → 36; customer balance 14,092 |
| ST-068 | Accounts | Trial balance debits equal credits for Retailer A and the wholesaler | API | PASS | Dr = Cr after every step above |
| ST-070 | Supplier Hub | Wholesaler lists itself in the directory (`visibility: directory`) | API | PASS | `directory_approved` was already true right after listing; no review step was seen |
| ST-071 | Supplier Hub | Publish rice and oil to the public catalogue with MOQ 2; publishing again is refused | API | PASS | Second publish HTTP 409 "already in your published listings" |
| ST-072 | Supplier Hub | Retailer B finds the wholesaler by searching "Bhiwandi" | API | PASS | 1 result with city, GSTIN, summary |
| ST-073–076 | Supplier Hub | Connection request with low-stock sharing; wholesaler sees it, the accept step suggests the existing customer with the same GSTIN/phone, accept and link | API | PASS | 1 suggestion = QA Retailer Bengaluru |
| ST-077 | Supplier Hub | Buyer gets a supplier record linked to the wholesaler | API | PASS | approval approved |
| ST-078 | Supplier Hub | Catalogue order below MOQ is refused | API | PASS | "Order at least 2 of QA Basmati Rice 25kg" |
| ST-079–080 | Supplier Hub | Retailer B sends a catalogue order (4 rice, 2 oil); it appears in the wholesaler's action list | API | PASS |  |
| ST-081 | Supplier Hub | Wholesaler confirms 3 of 4 rice and all oil; buyer sees `partial` with one backorder | API | PASS |  |
| ST-082 | Supplier Hub | Dispatch before billing is refused | API | PASS | HTTP 409 |
| ST-083–085 | Supplier Hub | Invoice draft from the order has confirmed quantities; billing it gives an inter-state invoice and moves the order to invoiced | API | PASS | INV-004 total 10,290, IGST 490 (3 rice, not 4) |
| ST-086–087 | Supplier Hub | Wholesaler dispatches with a lorry note; buyer sees dispatched and the note | API | PASS |  |
| ST-088 | Supplier Hub | Buyer sees the bill under incoming bills | API | PASS | INV-004 and the earlier INV-002 |
| ST-089–091 | Supplier Hub | Buyer converts the bill to a purchase with an item map (oil 1 TIN = 15 LTR) and 1 damaged tin; order becomes received | API | PASS | Purchase total 10,290, IGST 490. Without the map the API answers 422 with suggested matches. |
| ST-092 | Supplier Hub | Converting the same bill twice is refused | API | PASS | HTTP 400 "Purchase already exists for this invoice" |
| ST-093 | Stock | Buyer stock after receipt in buyer units | API | PASS (see F-008) | Rice 3 bags; oil 30 L |
| ST-100 | Roles | Accountant, Sales and read-only can open the invoice list; Inventory Manager gets 403 | API | PASS | Inventory Manager has no invoice access in its default role. Treated as role design. |
| ST-101–104 | Roles | Read-only role: create customer, create invoice, edit item price, delete item are all refused | API | PASS | HTTP 403 PERMISSION_DENIED each |
| ST-105 | Roles | Sales: create a draft invoice | API | PASS |  |
| ST-106–108 | Roles | Sales: add employee, create role, open the employee list (salaries) are refused | API | PASS | HTTP 403 |
| ST-109 | Roles | Accountant: record a cash receipt against INV-002 | API | PASS | Two receipts of 500 were posted (first run and rerun) |
| ST-110 | Roles | Accountant: add employee is refused | API | PASS | HTTP 403 |
| ST-111 | Roles / Stock | Inventory Manager: stock adjustment, reason DAMAGE, −1 carton | API | PASS | Stock 48 → 47. Reason `DAMAGED` (not in the list) gave HTTP 500 (F-011). |
| ST-112 | Roles | Inventory Manager: record a receipt is refused | API | PASS | HTTP 403 |
| ST-113 | Login | Attendance-only employee cannot log in to the console | API | PASS | HTTP 401 |
| ST-120 | HR | Owner sees all 12 employees | API | PASS |  |
| ST-121–122 | HR | Owner marks 10 days of attendance for a daily-wage worker | API | BLOCKED | HTTP 403 "You've reached your attendance limit (0/0)" on the trial plan (F-012) |
| ST-123, ST-126 | HR / Payroll | Salary prefill for a daily worker and a monthly employee | API | FAIL | HTTP 500 "Failed to compute prefill". Log: `TypeError: l?.trim is not a function` (F-013). Fixed locally, not deployed. |
| ST-123 (rerun 2026-10-28) | HR / Payroll | Daily-wage worker prefill, 1–10 Oct, after the fix | API | PASS | HTTP 200. Basic 700, PF 84, 0 present days (attendance BLOCKED by F-012). See F-015. |
| ST-126 (rerun 2026-10-28) | HR / Payroll | Monthly employee who joined 1 Oct, full October | API | PASS | Basic 16,000, PF 1,800 (12% of the 15,000 ceiling), no pro-rata, joining day `2026-10-01` not shifted |
| ST-126b | HR / Payroll | Joining date changed to 11 Oct on 14,000/month, October prefill | API | PASS | Pro-rata 21/31 days = 9,483.87, PF 1,138.06, joining day `2026-10-11` |
| ST-124–125 | HR / Payroll | Pay the monthly employee for October; paying the same period twice is refused | API | BLOCKED | HTTP 403 "You've reached your payroll limit (0/0)" on the trial plan (F-012). The duplicate check was never reached. |
| ST-127 | Accounts | Wholesaler trial balance still balances after every step | API | PASS | Dr 355,702 = Cr 355,702 |
| ST-130 | GST | Wholesaler GSTR-1 October 2026 | API | PASS | Taxable 48,100 and tax 3,900 match INV-001 + INV-002 + INV-003 + INV-004 by hand; B2B 3, B2CS 1; draft invoice left out; CN-001 under `cdn`; per-rate rows (5% and 18%) for INV-001 |
| ST-131 | GST | Wholesaler GSTR-3B October 2026, 3.1(a) | API | PASS | Taxable 47,000 (48,100 − CN 1,100); IGST 1,830; CGST 936; SGST 936 |
| ST-132 | GST | Retailer B GSTR-3B ITC from the hub purchase | API | PASS | IGST 490 |
| ST-133 | GST | Retailer A GSTR-3B ITC | API | PASS (see F-014) | Other ITC CGST 1,026 = 945 − 99 (return) + 180 (expense); reversed 180 because the expense category is ITC-blocked; net 846 |
| ST-140–142 | Security (F-001) | Sales staff naming the owner as `created_by_user_id` / `updated_by_user_id` cannot add or edit an employee; the owner edits without sending an actor | API | PASS | HTTP 403, 403, 200 after `3e8e6be0` |
| ST-143 | Payments (F-004) | Cash accounts list no GST electronic ledgers | API | PASS | Only 1101 Cash |
| ST-144–145 | Payments (F-003) | UPI defaults to 1102 Bank Account; a UPI receipt without choosing an account posts | API | PASS | `selection_required: false`; HTTP 201 |
| ST-146 | Errors (F-005) | Expense with a broken id | API | PASS | HTTP 404 |
| ST-147 | Errors (F-009) | Invoice line with no price | API | PASS | HTTP 400 `LINE_PRICE_REQUIRED` naming the item |
| ST-148 | Errors (F-011) | Unknown stock reason | API | PASS | HTTP 400 `REASON_CODE_INVALID` |
| ST-149 | Payroll (F-015) | Daily-wage prefill with no attendance | API | PASS | `source: daily_wage`, basic 0, 0 payable days |
| ST-150–151 | Signup (F-014) | Sign up QA Restaurant Thane (restaurant + food) and QA Kirana Dadar (retail + food) | API | PASS | Restaurant: 18/18 categories ITC-blocked with kitchen categories. Kirana: 1/17 blocked (Food & Refreshments), no kitchen categories. |
| ST-160–163 | Estimates | Estimate for 2 biscuit cartons → convert to invoice; converting again is refused | API | PASS | INV-007 final, total 1,180, CGST 90; stock 47 → 45; second convert HTTP 400 |
| ST-164–165 | Sales orders | Confirmed sales order for 3 oil tins → convert to invoice | API | PASS (see F-016) | INV-008 total 6,930. The sales order itself stored total 0.00 (F-016). |
| ST-166 | Invoices | Owner finalises the draft the Sales staff made | API | PASS | INV-006 final; stock 45 → 44 |
| ST-167 | Invoices | Cancel a final invoice | API | PASS | INV-009 cancelled; stock back to 44; Retailer A balance 22,792 = 14,092 + 1,180 + 6,930 + 590, without INV-009 |
| ST-168–169 | Invoices | Cancel again is refused; cancelling INV-001 with a credit note is refused | API | PASS | HTTP 409; HTTP 409 `INVOICE_HAS_NOTES` |
| ST-170 | Invoices | Amend the billing name on final INV-002 (October GSTR-1 not filed) | API | FAIL (F-017) | HTTP 403 `GSTR1_LOCKED` "included in a GSTR-1 filing". Every final invoice INV-001–INV-008 has `is_editable = false`; the October filing is `draft`. |
| ST-171 | Invoices | Invoice PDF | API | PASS | HTTP 200 `application/pdf`, 70,814 bytes, starts `%PDF` |
| ST-172 | Accounts | Wholesaler trial balance after documents | API | PASS | Dr 364,402 = Cr 364,402 |
| ST-180–182 | Warehouses | Composition shop: add godown and main store, switch on warehouse mode, switch on again | API | PASS | Before both warehouses existed: HTTP 409 `BRANCH_WITHOUT_WAREHOUSE`. Stock 28 moved into the first warehouse; a second switch moved nothing. |
| ST-183–186 | Stock transfer | Transfer 5 kurtas godown → main store, dispatch, receive 4 | API | PASS | Status pending → in_transit; godown 23, main store 4 |
| ST-187 | Stock transfer | Close the transfer short by 1 (transit loss) | API | PASS | HTTP 200, status completed. Needs `date` and `lines`; a missing date returns code `GODOWN_STOCK` with "Date is required". |
| ST-188 | Stock | Business-wide stock after the transit loss | API | FAIL (F-018) | Warehouses 23 + 4 = 27 and movements sum to 27, but `items.current_stock` and `branch_item_stock` stay 28 |
| ST-220–223 | Delivery challans | Supply challan for 2 soap boxes: draft → sent → delivered; sent → draft refused | API | PASS | DC-001 total 2,596; stock unchanged on send (the invoice moves stock); back to draft HTTP 409 |
| ST-224–225 | Delivery challans | Returnable challan, 5 soap boxes on approval, sent | API | PASS | DC-002; stock 36 → 31 |
| ST-226 | Delivery challans | Settling 7 of 5 is refused | API | PASS | HTTP 409 |
| ST-227 | Delivery challans | Settle: 2 returned, 2 kept for an invoice, 1 written off as damage | API | PASS | Stock 31 → 35; challan delivered and closed |
| ST-230–231 | Online store | Retailer A opens store `qa-andheri-kirana` and publishes rice and soap | API | PASS |  |
| ST-232 | Online store | Shopper sees both items | API | PASS |  |
| ST-233–234 | Online store | Shopper OTP on QA phone 9000011031: code shown, verify gives a session | API | PASS | No WhatsApp sent (QA test phone) |
| ST-235 | Online store | COD pickup order: 1 rice @2,100 (5%) + 1 soap @1,300 (18%) | API | PASS | SO-0001 total 3,739 = 2,205 + 1,534 |
| ST-236–238 | Online store | Shop: pending → confirmed → ready → delivered, then cash collected | API | PASS |  |
| ST-239 | Online store | Order invoice | API | PASS | INV-001 (Retailer A) final, 3,739 paid, balance 0, CGST 169.50 |
| ST-240 | Online store | Stock after the online sale | API | PASS | Rice 10 → 9 |
| ST-241 | Online store | Cancelling a delivered order is refused | API | PASS | HTTP 409 `INVALID_TRANSITION` |
| ST-242 | Accounts | Retailer A trial balance after the online sale | API | PASS | Dr 27,831 = Cr 27,831 |
| ST-170 (rerun 2026-10-28) | Invoices | Amend the billing name on final INV-002 after `49005880` | API | PASS | HTTP 200; billing name changed; total 15,140 and IGST 1,340 unchanged |
| ST-200–201 | Plans (F-012) | Attendance and payroll limits on the trial after migration 432 | API | PASS | Both `limit -1` (unlimited) |
| ST-202–204 | Attendance | Owner marks 1–10 Oct for the daily-wage worker: 7 present, 1 half day, 2 absent; marking a day twice | API | PASS | 10 rows; second mark HTTP 400 "Attendance already marked for this date" |
| ST-205 | Payroll (F-015) | Daily-wage prefill for 1–10 Oct | API | PASS | 7.5 days × 700 = 5,250; PF 630; no absence deduction |
| ST-206–207 | Payroll | Pay the daily worker; pay the same dates again | API | PASS | Net 4,620 of 5,250; second payment HTTP 409 |
| ST-208 | Payroll | Pay the monthly employee for October | API | PASS | Net 14,200 = 16,000 − PF 1,800 |
| ST-209–211 | Payslips | Payslip list, HTML and PDF for the monthly employee | API | PASS | HTML shows name, 16,000 and 1,800; PDF 80,609 bytes `%PDF` |
| ST-212 | Roles | Sales staff opening payslips | API | PASS | HTTP 403 |
| ST-213 | Accounts | Trial balance after salaries | API | PASS | Dr 383,472 = Cr 383,472 |
| ST-214 | Payroll | Pay the daily worker again for 11–20 Oct (3 days marked) | API | FAIL (F-022) | Prefill 2,100 for 3 days is right; payment HTTP 409 "Salary payment already exists for this month" |
| ST-250–251b | Leave | Leave types on a new business; owner adds "QA Casual Leave" and sets 12 days a year | API | PASS (observation) | A new business starts with no leave types; HR has to add them before any leave can be taken |
| ST-251c | Leave | Owner sets an opening leave balance of 6 days | API | FAIL (F-024) | HTTP 500 "operator is not unique: unknown + unknown". Fixed in `d01aa0fb`, not yet deployed. |
| ST-252–255 | Leave | 2-day leave, approve, reject after approve, balance used | API | BLOCKED | No balance could be set (F-024) |
| ST-257 | Leave | Leave that ends before it starts | API | FAIL (F-023) | HTTP 500 with the right message. Fixed in `d01aa0fb` (400 `LEAVE_DATES_INVALID`), not yet deployed. |
| ST-258–259 | Salary advance | Owner records a 3,000 advance over 3 months and approves it | API | PASS | Without `requested_by` the API returned 403 `ACTOR_MISMATCH` (the screen sends it); fixed in `d01aa0fb` to use the session user |
| ST-260 | Payroll | November prefill for the employee with the advance | API | PASS (observe) | Basic 14,000; the prefill shows no advance recovery line. Whether recovery is applied at payment time was not checked. |
| ST-261 | Roles | Sales staff recording a salary advance | API | PASS | HTTP 403 |
| ST-270 | Pages (browser) | 81 main pages opened signed in as the wholesaler after the deploy (hidden iframes, 4.5 s each): dashboard, every sales, purchase, stock, accounts, reports, HR and key settings page | UI | PASS for 75 | No error screen, no uncaught error, page content present. Flagged 6, checked one by one below. |
| ST-271 | Pages (browser) | `/settings/branches`, `/settings/invoice`, `/settings/tax`, `/settings/gst-config` | UI | PASS | Branches shows the branch and GSTIN outside `<main>`; the other three redirect to Templates or Business profile |
| ST-272 | Pages (browser) | `/pricing/levels` | UI | NOT TESTED | 404 on staging: the page and its menu link are in local commits that are not pushed (`f7ece140`, `26925bb0`). Not a defect of staging. |
| ST-273 | Pages (browser) | `/items/barcodes` | UI | FAIL (F-025) | Content renders, but the page throws React errors #418 and #423 (server and client HTML differ) ten times on load |
| ST-280 | Recurring invoices | Monthly recurring invoice, 2 biscuit cartons to Retailer A, starting 28 Oct, auto-finalise | API | PASS | Next run 2026-10-28 |
| ST-281 | Recurring invoices | Run now | API | PASS | One invoice: INV-010 final, 1,180, dated 2026-10-28 |
| ST-282 | Recurring invoices | Run now again the same day | API | PASS | No second invoice |
| ST-283 | Recurring invoices | Pause | API | PASS |  |
| ST-251c (rerun 2026-10-28) | Leave (F-024) | Opening leave balance of 6 days after `d01aa0fb` | API | PASS | HTTP 200 |
| ST-257 (rerun 2026-10-28) | Leave (F-023) | Leave that ends before it starts | API | PASS | HTTP 400 `LEAVE_DATES_INVALID` |
| ST-258 (rerun 2026-10-28) | Salary advance | Advance recorded without `requested_by`, acting as the signed-in owner | API | PASS | HTTP 201; Sales staff now get 403 `PERMISSION_DENIED` (was `ACTOR_MISMATCH`) |
| ST-252–256 | Leave | 2-day leave, approve, reject after approve, balance used, overlap | API | BLOCKED (F-026) | HTTP 403 "You've reached your leave_requests limit (0/0)" on the trial |
| ST-272 (rerun) | Pages (browser) | `/pricing/levels` after the deploy | UI | PASS | Page loads: "Price levels … No price levels yet." |
| ST-252 (rerun, `d1089fbf`) | Leave (F-026) | Owner files a 2-day casual leave after migration 437 | API | PASS | HTTP 201; total_days 2.00 |
| ST-256 (rerun) | Leave | Overlapping leave | API | PASS | HTTP 400 "You already have a leave request for this period" |
| ST-253–255 | Leave | Approve the leave; reject after approve; balance 6 → 4 | API | FAIL (F-027) | Approve HTTP 500 `leave_requests_approved_by_fkey`; balance stays 6 |
| ST-300 | Security | No session: invoices, customers, employees, trial balance naming the wholesaler | API | PASS | HTTP 401 each (after `a520b44a`) |
| ST-301–303 | Security | Retailer A naming the wholesaler: customer list, INV-001 by id, employee list | API | PASS | Own rows only; 404; 0 rows |
| ST-304 | Security | Retailer A creates a customer with `business_id` = wholesaler | API | PASS | Saved in Retailer A |
| ST-305–306 | Security | Retailer A edits the wholesaler's item price | API | PASS | 404; price still 1,800 |
| ST-307–308 | Security | Sales staff naming the owner as `requested_by` / `created_by` | API | PASS | HTTP 403 |
| ST-309–310 | Security | Owner's invoice list and trial balance after the security change | API | PASS | Dr 393,652 = Cr 393,652 |
| ST-253–255 (rerun, `198f1498`) | Leave (F-027) | Owner approves the 2-day leave; reject after approve; balance | API | PASS | HTTP 200; reject refused "Only pending requests can be rejected"; used 2, balance 6 → 4 |
| ST-256b | Leave | Owner rejects a pending 1-day leave | API | PASS | HTTP 200 |
| ST-320–322 | Damaged goods (F-008) | Retailer B's receipt shortfall setting: default, switch to auto return, unknown mode | API | PASS | `keep` → `auto_return`; `throw_away` HTTP 400 |
| ST-323–325 | Damaged goods | New hub order for 2 oil tins, billed INV-011 (4,620), received with damage noted | API | PASS |  |
| ST-326–327 (first run) | Damaged goods | `damaged_qty: 1` on the oil line | API | PASS (observation) | The quantity is in the buyer's unit (litres): 1 L returned. Stock 30 → 59 (30 in − 1); DN-INV-011 for 146.67 + IGST raised automatically |
| ST-326–327 | Damaged goods | Received 2 tins with `damaged_qty: 15` (one whole tin) | API | PASS | Stock 59 → 74 (+15 L); DN-INV-013 total 2,310 with IGST raised automatically |
| ST-330 | Repack | Prefill for rice bag → 1 kg pack | API | PASS | Takes `item_id` of the pack |
| ST-331–332 | Repack | 1 bag (25 kg) into 24 packs of 0.04 bag each, 1 kg spillage | API | PASS | Rice 87 → 86; packs 0 → 24. `content_per_unit` is in the source item's unit. |
| ST-333 | Repack | Repacking 1,000 bags with 87 in stock | API | PASS | HTTP 400 `INSUFFICIENT_STOCK` "Only 87 BAG … in stock here" |
| ST-334 | Repack | Cancel the repack | API | PASS | Rice back to 87, packs back to 0 |
| ST-340 | Alternate units | Add 1 CASE = 10 BOX on the soap item | API | PASS |  |
| ST-341–342 | Alternate units | Sell 1 CASE at 10,500 + 18% with a forged `unit_factor: 99` | API | PASS | INV-012 total 12,390; stock 35 → 25 (10 boxes); forged factor ignored |
| ST-343 | Alternate units | Sell 100 cases with 25 boxes in stock | API | PASS | HTTP 400, requested 1,000 boxes |
| ST-344 | Accounts | Wholesaler trial balance after all of the above | API | PASS | Dr 415,282 = Cr 415,282 |

## Findings

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| F-001 | High (suspected) | `POST /api/employees` reads `business_id` from the body, and `resolveCreatedByUserId` (`lib/auth-helpers.ts:56`) prefers body `created_by_user_id` over the session user. `authorize` is then called with those values. Same pattern the Phase 3 series fixed on other routes. On 2026-10-28 two more HR writes were seen asking for the acting user in the body: `PATCH /api/employees/[id]` ("updated_by_user_id is required for authorization") and `POST /api/employees/salary/payments` ("processed_by (user_id) is required for authorization"). Could let one business's user create a staff login with a role in another business. | FIXED in `3e8e6be0` (2026-10-28). `actingUserId` in `lib/auth-helpers.ts` uses the session user; `resolveCreatedByUserId` (17 routes) and nine routes that read the actor from the body now use it. `tests/security/acting-user-id.test.ts` added; `npx jest tests/lib tests/security`: 289 suites passed, 8 failed (6 already listed in the QA index, `branch-update-route` fails the same way on `e93ac7f1`, `inventory-adjustments-route` fixed before commit). Staging rerun: ST-140–142. |
| F-002 | Low | Staging `todo-reminder-worker` had restarted 419+ times at deploy time and restarted again during this run. | Observed in `pm2 ls`. Cause not checked. |
| F-003 | Medium (usability) | On a new business, every UPI or bank-transfer payment or receipt has no default bank account. `settlement-accounts` returns 1102 Bank Account and 2112 Bank OD / Cash Credit with `selection_required: true`, so the API refuses the payment until one is chosen. | FIXED in `b72a28d0`. With one real bank beside the seeded 2112 Bank OD, bank-mode payments default to that bank. Staging rerun: ST-144–145. |
| F-004 | Medium (accounting) | The cash-mode account list offers 1130–1133 "Electronic Cash Ledger — IGST/CGST/SGST/Cess" next to 1101 Cash. Those are GST portal ledgers, not a till, so a customer receipt or supplier payment could be posted to them. | FIXED in `b72a28d0`. Ledgers named Electronic Cash/Credit Ledger are not settlement accounts. Staging rerun: ST-143. |
| F-005 | Low | `GET /api/expenses/not-a-uuid` returns HTTP 500 with an empty body, not 404. | FIXED in `acfffaf1`. A non-id expense is 404. Staging rerun: ST-146. |
| F-006 | Low (usability) | A food & beverages retail kirana gets restaurant expense categories ("Kitchen Gas & Fuel", "Kitchen Consumables", "Delivery Platform Commission"). | Same cause as F-014. FIXED for new signups in `b72a28d0`. |
| F-007 | Note | Test-script errors, not app defects: payments without `settlement_account_id`, an expense without a retry key or category, a credit note without `credit_note_number`. Reruns with those fields passed. | Recorded so the first FAIL lines in the console log are not read as app failures. |
| F-008 | Decision needed | Receiving a hub bill with `damaged_qty: 1` on the oil line still adds both tins to sellable stock (30 L, not 15 L). It may be meant to feed a later return or claim, but nothing kept the damaged tin out of stock. | BUILT on branch `claude/dreamy-faraday-16bebb` (`b4caf994`), merged and deployed in `8d133937`. Staging ST-320–327 PASS. Note: short and damaged quantities are entered in the buyer's own unit. |
| F-009 | Low | `POST /api/invoices` with a line whose `unit_price` is missing returns HTTP 500 with the database text `null value in column "unit_price" of relation "invoice_items" violates not-null constraint`, not a 400 naming the line. | FIXED in `acfffaf1`. HTTP 400 `LINE_PRICE_REQUIRED` naming the item. Staging rerun: ST-147. |
| F-010 | Low (usability) | A supplier who tries `confirm` on a buyer's pending order gets "Only the buyer can confirm a proposed order". The supplier's action is `respond`; the message does not say that. | Observed via API. The order screen was not opened. |
| F-011 | Low | `POST /api/inventory-adjustments` with a reason code outside the list (`DAMAGED`) returns HTTP 500 with the database text `violates check constraint "inventory_adjustments_reason_code_check"`, not a 400 listing the allowed reasons. | FIXED in `acfffaf1`. HTTP 400 `REASON_CODE_INVALID` listing reasons (`lib/inventory/adjustment-reason-codes.ts`). Staging rerun: ST-148. |
| F-012 | Medium (product) | On the trial plan the wholesaler may add 200 employees and the add form offers "Attendance only", but marking attendance is refused with "attendance limit (0/0)" and paying salary with "payroll limit (0/0)". Salary prefill still works, so the screen can be filled and then cannot be saved. | FIXED: migration 432 committed as `1a0eb72e` and applied on staging 2026-10-28 with the owner's approval (`Applied: 1, Failed: 0`). Pro and Trial unlimited; Starter 1600/100/100/200/200. Staging rerun ST-200–213 PASS. |
| F-013 | High | Salary prefill (`GET /api/employees/salary/payments/prefill`) returns HTTP 500 for every employee with a joining date. `computeProRataMonthlySalary` calls `.trim()` on `joining_date`, which node-postgres returns as a `Date`. The add-employee form always sends a joining date. | FIXED and deployed to staging in `e93ac7f1` (2026-10-28). `lib/hr/salary-payroll-helpers.ts` reads the value as a calendar day (`toDateOnly`, local date parts, no UTC shift); 2 regression tests; `npx jest tests/lib/hr` 18 suites, 118 passed. Staging rerun ST-123, ST-126, ST-126b PASS. |
| F-014 | High (GST) | `isRestaurant` (`lib/accounting/industry-coa.ts:178`) is `food_beverages` and type `retail` or `service`. Every grocery or kirana store that signs up as Retail + Food & Beverages gets the restaurant pack with `blocksItcByDefault: true`, so all 20 expense categories (rent, telephone, repairs, professional fees…) are ITC-blocked and their GST is reversed in GSTR-3B. Signup has no way to say "restaurant" versus "grocery shop". | FIXED for new signups in `b72a28d0` (owner decision: add "Restaurant / food service"). Only `businessType: restaurant`, or food & beverages + service, gets the restaurant pack. Businesses already signed up as retail + food keep their blocked categories until a data fix (not written). Staging rerun: ST-150–151. |
| F-015 | Decision needed | Salary prefill for a daily-wage worker returns one day's wage as basic (700 for 1–10 Oct) when no attendance is marked. Whether it multiplies by present days could not be checked while attendance is blocked (F-012). | FIXED in `acfffaf1` (owner decision: rate × days present). `computeDailyWage`: present days plus half for half days; no absence deduction on top. Staging rerun: ST-149 (no attendance yet, so 0). |
| F-016 | Low | `POST /api/sales-orders` stores the subtotal, tax and grand total the client sends; with none sent, a 6,600 + tax order was saved with total 0.00. Converting it to an invoice recomputed 6,930 correctly. | Observed. Not fixed. |
| F-017 | High | Every finalized invoice is saved with `is_editable = false`, and `PATCH /api/invoices/[id]/amend` refused all of them with `GSTR1_LOCKED` "included in a GSTR-1 filing", so no final invoice could be amended even with no GSTR-1 filed. | FIXED in `49005880`; staging rerun ST-170 PASS. |
| F-018 | Medium (stock) | In warehouse mode, closing a stock transfer short (transit loss) lowers warehouse stock but not `items.current_stock` or `branch_item_stock` (27 in warehouses, 28 on the item). | Observed on QA Composition Pune with read-only SQL. Not fixed. |
| F-019 | Low | `GET /api/stock-transfers/[id]` has no route and returns the HTML app page; the transfer can only be read from the list. | Observed. |
| F-020 | Medium (deploy) | `scripts/deploy-vps.sh` runs `npm run build` inside the live app folder, so while `next build` rewrites `.next` the running server cannot render pages it has not cached: on 2026-10-28 during the migration-432 deploy every page swept in the browser (19 sales pages) returned "Internal Server Error" and `/signup` returned HTTP 500, while API routes kept answering. The same script deploys production. A deploy that also lost its SSH session left `.next` without `BUILD_ID`. | Observed on staging. Not fixed: building into a separate folder and switching it in after a good build would remove the gap. |
| F-021 | Note | QA browser page sweep (hidden iframes, signed in as the wholesaler) was run during that build, so its 19 "Internal Server Error" results are the deploy gap above, not page defects. The sweep is repeated after the deploy. | — |
| F-022 | Decision needed | Salary can be paid once per employee per month: `salary_payments` has `UNIQUE(business_id, employee_id, salary_month)` (migration 062) and the API checks the same. A daily or weekly wage worker paid for 1–10 Oct cannot be paid for 11–20 Oct, although the prefill computes it. | Observed (ST-214). Needs a decision on part-month pay (payslip per period, PF/ESI monthly totals) and a migration. |
| F-023 | Low | `POST /api/employees/leave-requests` with an end date before the start date returned HTTP 500 (the day calculator threw). | FIXED in `d01aa0fb`; staging rerun ST-257 PASS. |
| F-024 | High (HR) | `POST /api/employees/leave-balances` failed with HTTP 500 "operator is not unique: unknown + unknown" whenever a balance row already existed (one is created when balances are first read), so an opening balance could never be set. | FIXED in `d01aa0fb`; staging rerun ST-251c PASS. |
| F-025 | Low | `/items/barcodes` logs React hydration errors #418/#423 on every load (server-rendered text differs from the client). The page still shows its content. | Observed in the browser sweep. Source not found in the page file; needs a non-minified local build to find the component. |
| F-026 | High (plans) | Same cause as F-012 for three more limits: `max_leave_requests_per_month`, `max_employee_tasks_per_month` and `max_performance_reviews_per_month` have no `subscription_plan_limits` row on any HR plan (read-only SQL on staging), so the default 0 refuses leave, tasks and reviews on HR Pro and HR Trial, the plans that include them. | FIXED: migration renumbered to `437_hr_pro_leave_task_review_limits.sql` (branch `claude/dreamy-faraday-16bebb` has a 436), committed `d1089fbf`, applied on staging 2026-10-28 with the owner's approval. Staging rerun ST-252 PASS. |
| F-027 | High (HR) | `leave_requests.approved_by` references `employees(id)` (migration 057) but both approve paths store the approver's `users.id`, so approving or rejecting any leave fails with HTTP 500 `leave_requests_approved_by_fkey`. | FIXED: migration `440_leave_approved_by_user.sql` (`8d133937`) applied on staging with the owner's approval. Staging rerun ST-253–256b PASS. |
| F-028 | Medium | `employee_commissions` and `employee_expenses` approve/reject store `approved_by` from the request body (not the session) into a column that references `employees(id)`. The recorded approver can be set by the caller, and an owner approving may hit the same foreign key error as F-027. | Code reading only. Not tested. |
| F-029 | High (stock) | Migration `439_stock_repacks.sql` (merged from `claude/quirky-kalam-9b9235`) redefined `inventory_adjustments_reason_code_check` from an older list, dropping `PROCESS_LOSS`, `TRANSIT_LOSS`, `OWN_CONSUMPTION`, `CUSTODY_LOSS`, `PRODUCTION_ISSUE`, `PRODUCTION_RECEIPT` and `BY_PRODUCT`. It failed on staging (a `TRANSIT_LOSS` row from ST-187) and stopped the deploy; where it passed (local `kh_phase2_test`) transit-loss and challan write-offs and production would fail. | FIXED in `198f1498`; applied on staging on the redeploy. Staging transfer and repack tests PASS afterwards. |

## Not covered in this run

NOT TESTED: plan personas (free, trial expiry, paid upgrade), online payment (Razorpay) and delivery-partner orders in the store, WhatsApp / Connect, CRM, platform admin and partner portals, e-invoice and e-way bill, invoice print layouts beyond one PDF, leave requests and leave balances, salary advances, the Flutter phone app, and clicking the buttons inside pages. Browser clicks were used for signup, business profile, login and add employee (ST-001–ST-008); 81 pages were opened in the browser for load errors (ST-270). Everything else called the same APIs the pages call, with each persona's own login.

## Scripts

All in `tmp-qa/` (not committed): `staging-lib.mjs` (login and call helper), `staging-create-personas.mjs`, `staging-persona-profiles.mjs`, `staging-staff.mjs`, `staging-sales.mjs`, `staging-purchases.mjs`, `staging-hub.mjs`, `staging-hub-receive.mjs`, `staging-roles.mjs`, `staging-hr.mjs`, `staging-hr-salary.mjs`, `staging-fixes-rerun.mjs`, `staging-docs.mjs`, `staging-transfers.mjs`, `staging-challans.mjs`, `staging-store.mjs`, `staging-payroll.mjs`, `staging-leave-advance.mjs`, `staging-recurring.mjs`. Record ids are in `tmp-qa/staging-ids.json`. The scripts skip steps that already ran, so a rerun does not post the same sale or payment twice; the receipt in ST-109 is the exception.
