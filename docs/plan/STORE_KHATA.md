# Store khata: order now, pay on the customer's settlement day

Status: built and committed 2026-10-29. Migration 444 applied to `kh_phase2_test` only. Owner decisions taken 2026-10-29.

## As built

- **Code:** `lib/khata/` (cycle, rules, service, approval, settle, statements, online-pay, store-view, notify). Checkout in `app/api/public/store/[subdomain]/orders/route.ts`; staff API `app/api/customers/[id]/khata`; rules API `app/api/settings/khata`; store API `app/api/public/store/[subdomain]/khata`; cron `app/api/cron/khata-statements`.
- **Screens:** customer page "Store khata" card (open, change, close, receive payment, send statement); customers list "Khata" and "Khata requests" filters; store settings "Khata" rules; store orders "Khata to approve" filter with Approve and Reject; store checkout "Add to my khata"; store account khata card with "Request khata"; store `/khata` page (live khata when signed in, or one statement from the WhatsApp link `?s=`).
- **Khata orders** are `payment_status = 'cod'` with `payment_provider = 'khata'`. The orders hub view reports them as `khata` (or `khata_pending` while waiting for approval), so no screen offers to collect cash.
- **Statement link:** the WhatsApp statement links to `/khata?s=<token>`, which shows that statement and what is open today without signing in. Paying from it uses the same gateway flow.
- **Online payment:** a `khata_payments` row per attempt; Razorpay notices that match no store order are checked against it, Easebuzz uses the `KH-` transaction prefix. A paid amount above the open bills becomes a customer advance (gateway only; at the counter it is refused).
- **Tests:** `tests/lib/khata/` (cycle, rules) and `tests/db/store-khata.db.test.ts` (22 cases, `STORE_KHATA_DB_TEST=1`).
- **Dashboard:** `components/dashboard/KhataDashboardCard.tsx` (owed, due this week, overdue, orders to approve, requests) from `app/api/khata/summary`; hidden for businesses without khata.
- **Browser check (2026-10-29, test DB, port 3015):** done end to end on Map Test Shop with store `ganesh` (seeded: two items, customer Sharma ji 9968598167). Opened the khata, the store login linked by number, ordered on khata (invoice due 5 Nov, nothing to pay at pickup), an over-limit order waited, was approved, confirmed and marked ready for pickup, a ₹300 counter payment settled the oldest bill first, the statement link and "My khata" read correctly (also at phone width), a second shopper's request showed under Khata requests, and the dashboard card and settings section rendered. Fixed during the check: a statement sent mid-cycle was due today with the wrong period (now covers the cycle so far, due on the next settlement day), "sent on WhatsApp" was claimed when WhatsApp was not connected, bill lists sorted same-day bills newest first, the payment form's Cancel overflowed the card, and the customer page's amount box did not refresh after a khata payment.

## The story

Ganesh Traders runs a Khatario online store. Sharma ji is a regular who keeps a khata (running credit account). Sharma ji orders from home through the store, does not pay per order, and settles everything on his day of the month. Ganesh needs to see what Sharma ji owes, stop or approve orders when he is over the limit or late, and get paid in one go.

## Owner decisions

| Question | Decision |
| --- | --- |
| Who can order on khata | Opt-in per customer. Ganesh opens the khata account from the customer page. Nobody gets khata by default. |
| Over limit or overdue | Ganesh decides. A business-level rule for each case: block, warn and allow, or send to Ganesh for approval. A customer can override the business rule. |
| Where Sharma ji pays | Store has an online gateway (Razorpay or Easebuzz): "My khata" in the store with a Pay button, and the WhatsApp statement links there. No gateway: WhatsApp statement with a UPI link (when a UPI ID is set) or pay at the shop. |
| "My khata" without a gateway | Always shown, read-only: balance, statement, orders and payments, with no Pay button. |
| Settlement cycle | Per customer: a settlement day of the month, set by Ganesh when opening the account. |

## What already exists

- Store orders paid on delivery or by UPI already post a final invoice to a `customers` row matched by phone, and the invoice stays unpaid until a receipt is recorded (`lib/store/fulfill-paid-order.ts`). The khata debit therefore already happens for COD orders.
- `customers.credit_limit` and `opening_balance` exist. `lib/credit-utils.ts` computes utilization, including projected balance after a new sale. `lib/credit-alerts.ts` sends 70/90/100% alerts to the business.
- Credit approvals screen (`app/(app)/credit-approvals`).
- Store login is phone OTP (`store_customers`, `app/api/public/store/[subdomain]/otp`).
- Customer portal renders invoices with balances (`lib/customer-surface`).
- Invoice-level WhatsApp reminders: `payment_due` and `overdue` (`lib/payment-reminder-checker.ts`).
- Store online payment is per business through Razorpay or Easebuzz; direct UPI uses the business UPI ID (`getBusinessUpiVpa`).
- Gap: receipts settle one invoice at a time. An amount above the invoice balance has to be recorded as an advance. A lump-sum khata payment needs allocation across invoices.

## Design

### 1. Opening a khata (Ganesh)

On the customer page, "Open khata" sets:
- **Settlement day**: 1 to 28, or "last day of month".
- **Credit limit**: reuses `customers.credit_limit`. Zero means no limit, as today.
- **Rule overrides** (optional): over-limit rule and overdue rule, otherwise the business default.
- **Store login link**: the store phone number allowed to order on this khata. Opening the khata writes an explicit link from `store_customers` to `customers`, so eligibility never depends on the "oldest customer with this phone" match used for COD posting.
- **Old paper khata**: carried in through the existing opening balance.

Closing the khata turns off new khata orders. What is owed stays on the ledger.

### 2. Cycle and due date

Credit-card style. With settlement day D:
- The cycle runs from D of last month to the day before D this month.
- On D a statement is made for everything unpaid, payable by D plus the business grace days (default 0).
- Each khata invoice gets `due_date` = the statement date of the cycle it falls in, so existing due-date reports and ageing work unchanged.

Example: D = 5. Orders from 5 Oct to 4 Nov are on the 5 Nov statement. With 3 grace days they become overdue on 9 Nov.

### 3. Checkout (Sharma ji)

"Add to khata" appears as a payment option only when the logged-in store customer is linked to a customer with khata open. Eligibility comes from the OTP session on the server, never from a client-sent customer id. The option shows the due date: "Pay by 5 Nov".

The server then checks, in the order transaction:
- **Overdue**: any khata invoice past due date plus grace.
- **Over limit**: projected balance (`calculateProjectedCreditMetrics`) above the limit.

For each check that fails, the customer's rule (or the business default) applies:

| Rule | What Sharma ji sees | What happens |
| --- | --- | --- |
| Block | "Khata is paused. Please pay ₹X or choose another way to pay." Other payment options stay available. | No order on khata. |
| Warn and allow | "You are ₹X over your khata limit. Ganesh Traders has been told." | Order placed and invoiced as normal. Ganesh gets an alert. |
| Approval | "Ganesh Traders will confirm your order shortly." | Order saved as awaiting approval, with no invoice and the normal COD stock hold. It appears in credit approvals. Approve posts the invoice. Reject tells Sharma ji on WhatsApp, and the order can be paid another way or cancelled. |

When both checks fail, the stricter rule wins: block, then approval, then warn.

### 4. After the order

- The invoice posts the same way as COD today, labelled "Khata" in notes and on the bill, with the due date set.
- The packing slip and delivery screen say "Khata: do not collect". Khata orders are excluded from COD remittance expectations (`app/api/orders/cod-remittances`).
- Cancellations and returns reuse the existing invoice reversal and credit note paths, so the khata balance adjusts on its own.

### 4a. Pickup instead of delivery

When Ganesh is not delivering, Sharma ji picks "Pickup" at checkout (the store's existing `allow_pickup` option) and comes to the shop when the order is packed.

What already exists:
- Pickup orders at checkout (`store_orders.delivery_mode = 'pickup'`), with "Self pickup" on the packing slip.
- Marking an order "Ready" sets it as a pickup order (`lib/store/apply-store-status.ts`).
- A "ready to collect" WhatsApp message with the shop address and a pickup code to show at the counter (`lib/fulfilment/notify.ts`), switched on in the fulfilment notification settings.

What khata needs:
- **Allow "Ready" for khata orders.** Today an order can only be marked ready once it is paid or cash on delivery (`canBookShipment` in `lib/store/fulfillment-rules.ts`). A khata order must pass too, or it can never be packed or handed over.
- **Khata wording in the message.** The ready message says "Nothing to pay at pickup, ₹X is added to your khata, due 5 Nov" instead of implying payment at the counter.
- **Handover.** Ganesh checks the pickup code, hands over the bag and marks the order collected. The bill is already on the khata from when the order was confirmed, so no payment step appears at the counter.
- **Order in approval.** A khata order still waiting for Ganesh's approval cannot be marked ready.
- **Store account page.** The store's account page (`app/store/account/page.tsx`) already shows each order's status ("Ready for pickup"), the pickup code and a timeline. It prints the raw payment status next to it, so a khata order reads "Ready for pickup · khata". Show "On khata, due 5 Nov" instead. The page loads once when opened and there is no push to store customers, so the WhatsApp message stays the alert.
- Invoice-level `payment_due` and `overdue` reminders skip khata invoices. The customer-level statement replaces them.

### 5. Statement and reminders

On the settlement day, a scheduled job builds a statement per khata customer with a balance: opening due, each order, payments, closing due, pay-by date. The statement is stored, so reminders are not sent twice and Sharma ji's link always shows the same figures.

WhatsApp messages go through the business's existing transport:
- **Statement day**: total due, pay-by date, link.
- **Overdue**: after the grace days, then every N days (business setting). Stops when paid.

The link depends on the store:
- **Gateway configured**: opens "My khata" in the store for online payment.
- **No gateway, UPI ID set**: UPI intent link for the exact amount, plus a link to the read-only "My khata". Ganesh confirms the receipt by hand, because there is no payment webhook.
- **Neither**: link to the read-only "My khata", with "pay at the shop".

### 6. "My khata" in the store

Shown to every khata customer behind the store OTP login, whether or not the store has a gateway: balance, pay-by date, open statement, khata orders with their bills, payment history.

What changes with the store's setup:
- **Gateway configured**: "Pay ₹X" for the full amount, or another amount if Ganesh allows part payments (business setting, default on).
- **No gateway, UPI ID set**: read-only, plus a "Pay by UPI" button that opens the UPI app for the exact amount and the note "Ganesh Traders will confirm your payment".
- **Neither**: read-only, with "Please pay at the shop".

A payment Ganesh records at the counter shows up here as soon as it is saved.

### 7. Recording the payment

A new settlement helper takes one amount for a customer and allocates it oldest due date first across open khata invoices. It writes one receipt per invoice in one transaction under a shared reference. Any amount left over becomes a customer advance, as today. It is used by:
- the gateway webhook for a khata payment,
- a "Receive khata payment" action on the customer page for cash, UPI or bank at the counter.

### 8. Ganesh's view

- Customers list filter "Khata" with columns: due now, overdue, limit used, settlement day.
- Dashboard card: khata due this week and overdue.
- Existing credit alerts keep working off the same balance.

## Gaps found before building (2026-10-29)

Checked against the code before the build. Each has the default taken in the build.

1. **Counter sales on credit.** Ganesh also bills Sharma ji at the counter. The khata is the customer's whole balance, not only store orders: the statement uses the customer balance, the overdue check looks at every unpaid bill, and a counter bill for a khata customer with no due date gets the settlement date (server default and the new-invoice screen).
2. **Which customer gets the bill.** COD posting matches the oldest customer with the phone. A khata order carries the khata customer on the order and the invoice uses it.
3. **Approvals screen.** The credit approvals screen is for staff-raised invoices, needs a staff requester and is a paid-plan feature. Khata approvals live on the store orders screen instead: an "Awaiting khata approval" badge with Approve and Reject. Reject cancels the order (stock released) and tells Sharma ji on WhatsApp to order again with another payment option.
4. **Treat khata like COD, minus the cash.** Direct UPI already uses payment status `cod` with provider `upi` meaning "settled like COD, nothing to collect". Khata uses status `cod` with provider `khata`, so confirm, ready, the invoice sweep and the hub keep working. Places that collect cash skip khata: cash to collect on the delivery record (so COD remittance skips it), Shiprocket books it prepaid, the shipping label says "Khata, do not collect", and "Mark cash collected" is hidden and refused.
5. **Two orders at once.** The limit check locks the customer row, and the projected balance includes khata orders not yet invoiced.
6. **WhatsApp on Cloud API.** Statement and overdue messages are new business events. Without an approved template they go as plain text over the QR session, like the other store messages.
7. **Online khata payment.** Store gateway webhooks only know store orders. A khata payment gets its own row, found by the payment link or transaction id, and Easebuzz gets a new transaction prefix `KH`.
8. **First visit and khata requests.** Store sign-up only creates a store shopper; Ganesh's customer record appears at the first billed order, and Ganesh has no list of sign-ups. Added: a "Request khata" button on the store account page. It creates or links Sharma ji's customer record, marks the request and alerts Ganesh (WhatsApp and in-app). Ganesh sees it on the customer page and under a "Khata requests" filter and opens or ignores it. When Ganesh opens a khata first, Sharma ji's verified sign-in with the same number links automatically, only when exactly one khata customer has that number. Sign-ups without a request or order still do not become customers, so browsers do not fill the list.
9. **Scheduling.** Statements need a daily cron call on the VPS (`/api/cron/khata-statements`), added at deploy.

## Data model (migration 444)

- `customers`: `khata_enabled`, `khata_settlement_day` (1 to 28, or 0 for last day), `khata_over_limit_rule` and `khata_overdue_rule` (nullable overrides: `block`, `warn`, `approval`).
- Business khata settings: default over-limit rule, default overdue rule, grace days, overdue reminder interval, allow part payment.
- `store_customers.customer_id`: explicit link set when the khata is opened.
- `store_orders.payment_status` gains `khata`. A nullable `khata_approval` (`pending`, `approved`, `rejected`) for orders sent for approval.
- `khata_statements`: customer, period start and end, statement date, due date, opening due, charges, payments, closing due, sent and reminder timestamps.

## Tasks

1. Migration 444 and the business khata settings screen.
2. "Open khata" on the customer page, with the store phone link.
3. Due-date calculation from the settlement day, with tests for month ends and grace days.
4. Checkout: khata option, server-side eligibility, the overdue and limit checks, the three rules.
5. Approval path through credit approvals, and the reject message.
6. Invoice label, delivery "do not collect", COD remittance exclusion, skip invoice-level reminders. Let khata orders be marked ready, and use the khata wording in the ready-for-pickup message.
7. Settlement allocation helper and "Receive khata payment" on the customer page.
8. Read-only "My khata" in the store for every khata customer.
9. Statement job and the WhatsApp statement and overdue messages.
10. Gateway payment from "My khata" through the settlement helper, and the UPI button when there is no gateway.
11. Khata filter on customers and the dashboard card.

Tasks 1 to 8 are a usable first release: Ganesh collects at the shop and Sharma ji can check his khata from home. Tasks 9 and 10 add statements and payment from home.

## Open questions

- One household, several phones: is linking more than one store phone to one khata needed in the first release?
- Interest or late fees: assumed none.
