# Customer receivable accounts: staging checklist

For the owner, after deploying to `https://staging.khatario.com`. Nothing here has been checked in a browser yet; the server side is covered by `tests/db/customer-receivable-accounts.db.test.ts`.

Spec: [design](../specs/2026-11-10-customer-receivable-accounts-design.md). Plan: [plan](2026-11-10-customer-receivable-accounts.md).

## Before you start

- [ ] Apply migration `468_customer_receivable_accounts.sql` on staging (needs your approval). The code also runs without it: until it is applied every customer keeps posting to Accounts Receivable and the new fields stay hidden.
- [ ] Deploy the code.
- [ ] Use a business that has a few customers with unpaid invoices.

## 1. The sub-account problem you reported

- [ ] Chart of accounts → New account → group Current Assets → tick "Make this a sub-account" → parent `1103 Accounts Receivable` → name "Domestic Debtors" → save.
- [ ] Create "Foreign Debtors" the same way.
- [ ] Create "USA" with parent "Foreign Debtors". This is the step you said did not work. If it fails, note the screen and the exact message; the server accepts three levels, so the cause is on the screen.

## 2. A new customer in a category

- [ ] Customers → New. A "Receivable account" field appears after Credit days (it only appears once step 1 is done).
- [ ] Pick "Domestic Debtors", enter an opening balance of 500, save.
- [ ] Accounts → Domestic Debtors ledger shows the opening balance of 500. Accounts Receivable does not.
- [ ] Raise a credit invoice for this customer, then record a part payment. Both appear in the Domestic Debtors ledger.

## 3. Moving an existing customer

- [ ] Open a customer who already owes money → Edit → change Receivable account to "Foreign Debtors" → Save.
- [ ] A notice shows the amount that will be transferred, from which account to which, dated today. Save again to confirm.
- [ ] The customer page shows "Receivable account: Foreign Debtors" and one line under "Receivable account changes".
- [ ] Accounts Receivable ledger: one credit line "Receivable account changed - <customer>". Foreign Debtors ledger: the matching debit.
- [ ] The customer's balance, statement and aging row are unchanged. The statement has no transfer line.
- [ ] Record a payment against one of the customer's old invoices. It appears in Foreign Debtors.

## 4. Correcting an old document after a move

- [ ] Edit an invoice of that customer dated before the move and change its amount. Accounts Receivable shows the reversal and an entry cancelling it on the invoice date; its balance for this customer stays nil. Foreign Debtors holds the new amount.
- [ ] Cancel another old invoice of that customer. Same check.
- [ ] Change the date of a third old invoice of that customer (Amend), twice. After each change Accounts Receivable is still nil for this customer and Foreign Debtors holds the invoice once.
- [ ] Trial balance still balances.

## 5. Many customers at once

- [ ] Customers list (desktop): a checkbox column appears. Tick five customers → "Set receivable account" → choose "Domestic Debtors" → Save.
- [ ] Save stays disabled until an account is chosen in the dialog; nothing is moved on a default.
- [ ] The dialog reports how many moved. Any that could not move are listed with the reason.
- [ ] Use the "All receivable accounts" filter on the list: "Domestic Debtors" shows only those customers; "1103 Accounts Receivable (no category)" shows customers with no category; "Foreign Debtors" includes customers under "USA".

## 6. Reports

- [ ] Balance sheet: Accounts Receivable, Domestic Debtors, Foreign Debtors and USA each on their own line; the receivables figure is their total and matches the aging report's ledger balance.
- [ ] Receivables aging: each customer shows their account under the name; a "Receivable account" filter narrows the rows and the total; a small "By receivable account" table adds up to the report total.
- [ ] Cash flow statement and the dashboard Cash Flow card: receipts from customers in category accounts still count as money from sales.

## 7. Safety checks

- [ ] Try to deactivate "Domestic Debtors" while customers use it: refused, with the number of customers.
- [ ] Try to edit "Domestic Debtors" and clear its parent: refused.
- [ ] Lock the period that contains today, then try to move a customer who owes money: refused with a message about the locked period; the customer is unchanged. Unlock afterwards.
- [ ] Move a customer back to "1103 Accounts Receivable (default)": the balance returns with one transfer.

## 8. Opening balances

- [ ] Create a customer (no category) with an opening balance of 5,000 "To Receive". The Accounts Receivable ledger shows it. Before this change it did not appear on a database with the voucher-balance check.
- [ ] Edit that customer and change the opening balance to 3,000. The ledger line now shows 3,000, the trial balance still balances, and aging shows 3,000 for the customer.
- [ ] Change it to "To Pay". The ledger line moves to the credit side.
- [ ] Create a customer with no opening balance, then enter one. It appears in the ledger.
- [ ] Raise an invoice for one of these customers, then try to change the opening balance: refused, as before.
- [ ] Edit a supplier's opening balance (a supplier with no bills or payments). The Accounts Payable ledger follows. This route could not be run on the test database, so check it here with care.
- [ ] Look at the balance shown for these customers in the customers list. This change does not touch that figure; note what it shows after an opening balance is created and after it is edited.
