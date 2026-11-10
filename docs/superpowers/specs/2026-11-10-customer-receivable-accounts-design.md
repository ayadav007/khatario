# Customer receivable accounts by category (Domestic, Foreign, ...): design

Date: 2026-11-10
Status: written from the chat decisions, awaiting the owner's review
Source: the owner's request of 10 Nov 2026 (`docs/project.log.md`): classify customers as domestic, foreign and so on, and have their accounts updated accordingly; plus a report that sub-accounts cannot be nested further.

## 1. Goal

A business can split what customers owe into separate ledger accounts, such as Domestic Debtors and Foreign Debtors, the way Tally's groups under Sundry Debtors do. Each customer belongs to one of those accounts, and that customer's invoices, receipts and notes post there. The trial balance and balance sheet then show each category on its own line, while customer statements and aging keep working as they do today.

### Decisions taken with the owner

| Topic | Decision |
|---|---|
| How categories show in the books | Each category has its own receivable account, and the customer's documents post to it. Rejected: a report-only category (the books would not split), and one ledger account per customer as in Tally (every posting and report assumes one control account; the chart would grow by one account per customer). |
| Moving a customer who already has entries | Transfer the balance on the day of the move. Past entries are not re-posted, so earlier balance sheets and locked periods stay untouched. |
| Shape | The category is the account itself: a sub-account of Accounts Receivable, chosen on the customer. No separate Categories list. |

### Assumptions (decided here, not by the owner; correct any of them in review)

1. **Categories are the owner's own.** Any account under Accounts Receivable can be used, at any depth (Foreign → USA).
2. **A customer with no account chosen posts to Accounts Receivable**, exactly as today. Nothing changes for a business that never creates a sub-account.
3. **Customers only.** Suppliers (domestic and import creditors under 2101) follow the same pattern in a later piece.
4. **No foreign currency.** A foreign customer is invoiced in rupees as today; exchange gain or loss is not handled.
5. **A bulk action on the customers list** sets the account for many customers at once, since existing customers have to be classified.
6. **A parent account shows only its own entries** in the chart of accounts and My Accounts, which is the existing rule (`lib/accounting/my-accounts.ts`). The combined receivables figure is on the balance sheet and the aging report.

### Changed since the chat design

The chat design said the transfer amount would be recalculated when an old document is edited, and that the new account would apply from the next day. Reading the reversal code showed a simpler rule that needs no recalculation (section 4): **every entry written after the move goes to the customer's current account, including the reversal of an old document.** The old account is settled once, by the transfer, and never touched again for that customer. While building, one more detail changed: the reversal of an old document is not written straight to the new account, because the database refuses a reversal on a different account than its original. It is written to the old account and carried across by a correction entry the same day. The balances are the same.

### Out of scope

Supplier categories (domestic and import creditors); foreign currency; the Flutter phone app; choosing the account automatically from the customer's country or GSTIN; a separate category field for pricing or tax.

## 2. What exists today

- **One control account.** Every customer posting uses the account mapped as `accounts_receivable_account_id`, falling back to code `1103` (`getDefaultAccounts` in `lib/ledger-utils.ts`). A customer has no link to a ledger account (`Customer` in `types/database.ts`).
- **Posting sites that use it:** customer opening balance, invoice, receipt, credit note and debit note (`lib/ledger-utils.ts`), advance adjustment (`lib/accounting/advances.ts`), credit-note refund (`lib/credit-notes/refund.ts`). Provision utilisation (`lib/services/provisions-manager.ts`) credits `1103` with no customer.
- **Corrections reverse, never delete.** `reverseVoucherLedgerEntries` (`lib/ledger-reversal.ts`) posts a mirror line on the same account under the same voucher, then the document is re-posted. A customer's opening balance is posted once and never regenerated.
- **Reports find the customer from the document, not the account.** `lib/reports/party-ledger-docs.ts` nets receivable lines per voucher and joins the voucher to its invoice, payment or note. It selects receivable lines with `account_code LIKE '1103%'`; the party statement route does the same.
- **Exact-code readers:** the balance sheet's receivables figure (`byCode(ca, '1103')` in `lib/reports/balance-sheet.ts`), and the code patterns in `lib/reports/cash-flow.ts` and `lib/reports/dashboard-cash-flow.ts`.
- **Sub-accounts.** `accounts.parent_account_id` exists. `assertValidParentAccount` allows any depth and only refuses a different account type, a missing parent or a loop. `ParentAccountPicker` lists sub-accounts as possible parents.

## 3. Data

Migration `468` (`467` is taken by the Schedule III P&L plan; use the next free number at build time). Written and run on `kh_phase2_test` only; staging and production need the owner's approval.

```sql
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS receivable_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_customers_receivable_account
  ON customers (business_id, receivable_account_id) WHERE receivable_account_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS customer_receivable_account_moves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  to_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  transfer_date DATE NOT NULL,
  transferred_amount NUMERIC(15,2) NOT NULL DEFAULT 0, -- signed, sum of what was moved in
  kind VARCHAR(20) NOT NULL DEFAULT 'move' CHECK (kind IN ('move', 'correction')),
  source_voucher_type VARCHAR(50),   -- for a correction: the voucher that was reversed
  source_voucher_id UUID,
  created_by UUID,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_cram_customer ON customer_receivable_account_moves (business_id, customer_id);
```

`receivable_account_id` NULL means the control account. The moves table is the audit trail, and each row's `id` is the voucher id of its transfer entry.

## 4. Rules

### 4.1 The receivable accounts of a business

New module `lib/accounting/receivable-accounts.ts`:

- `receivableControlAccountId(businessId, client?)`: the mapped receivable account, else `1103`. The same lookup `getDefaultAccounts` uses today.
- `receivableAccountIds(businessId, client?)`: the control account, any account whose code starts with `1103`, and every account under either through `parent_account_id`. Accounts under 1103 therefore stay in the set when another account is mapped as the receivable account, so category accounts and their balances do not drop out of the reports. It never throws: a business with no usable control account gets its 1103-coded accounts, possibly none.
- `resolveCustomerReceivableAccountId(businessId, customerId | null, client?)`: the customer's `receivable_account_id` when it is set, active and inside the set; otherwise the control account. With a transaction client it locks the customer row `FOR KEY SHARE`, so a move (which takes `FOR UPDATE`) cannot run between resolving and posting. It must not be `FOR SHARE`: two invoices for the same customer would deadlock when each updates the customer's running balance.

### 4.2 Posting

**Every receivable line written for a customer goes to that customer's current account. Lines already written never move.**

- The seven customer posting sites in section 2 call `resolveCustomerReceivableAccountId` instead of using `accounts.accountsReceivable`. A document with no saved customer keeps the control account. Provision utilisation is unchanged.
- **Reversals.** The database requires a reversal line to mirror its original on the same account (migration 324). So when `reverseVoucherLedgerEntries` reverses a customer's receivable line that a move has carried away, the mirror stays on that old account, and a correction entry on the same date and branch carries it to the customer's current account. The correction is a `receivable_transfer` voucher recorded as a moves row of kind `correction`, with the reversed voucher as its source. A line counts as carried away when it sits on a receivable account other than the customer's current one and was written before the customer's last move (`customerSweptLines`); a move is timed by the clock when it is recorded. A customer who was never moved, and a line written after the last move, are mirrored in place exactly as before this feature. `customerIdForVoucher(client, businessId, voucherType, voucherId)` finds the customer, using the same voucher-to-document mapping as `party-ledger-docs.ts`.

Why this is exact: after a move, the old account holds the customer's old lines and one transfer that cancels them; a later mirror on it is cancelled by its correction on the same date. Editing an old invoice from 1,000 to 1,200 therefore takes 1,000 out of the new account and puts 1,200 in, and the new account, which already holds the transferred 1,000, ends at 1,200.

- **Re-posting lines as they were.** Changing the date of a final invoice (`app/api/invoices/[id]/amend/route.ts`) reverses the posting and writes the same lines again with the new date. A receivable line that a move carried away is written back on the customer's current account, using the same `customerSweptLines` test, so the old account stays settled however often the date is changed.

### 4.2a Opening balances (added on the owner's decision, 10 Nov 2026)

While building, it turned out that a customer's or supplier's opening balance was not reaching the ledger on the test database: the two lines were saved separately, the voucher-balance check refused the first, and the create route swallowed the error. Both lines are now saved in one transaction.

Editing an opening balance, which is allowed until the party has an invoice, bill or payment, now re-posts it (`setPartyOpeningBalance` in `lib/accounting/account-rules.ts`), for customers and suppliers:

- The ledger is changed before the customer or supplier row, so a refusal (a locked period, a missing account) leaves the row as it was and returns `OPENING_BALANCE_LEDGER_FAILED`.
- The voucher keeps the date it was first posted on; a party created with no opening balance gets the start of the financial year.
- Normally the voucher is replaced. For a customer who has been moved to another receivable account, the old opening line was settled by the move's transfer, so it is left in place and only the difference is posted on the customer's current account.
- The running balance shown on the customers and suppliers lists (`current_balance`) is not touched by this change.

### 4.3 Moving a customer

`moveCustomerReceivableAccount({ businessId, customerId, toAccountId | null, actorId })` in the same module, in one transaction:

1. Lock the customer row `FOR UPDATE`. Validate the target: same business, active, asset type, inside the receivable set. `null` means the control account.
2. Work out the customer's net balance in each receivable account other than the target. The customer's lines are those whose voucher belongs to the customer, plus earlier transfer entries (through the moves table).
3. If any balance is non-zero, check that today is not in a locked period (`assertPeriodNotLocked`), insert a moves row, and post one voucher of type `receivable_transfer` with that row's id, dated today: debit the target and credit each old account by its balance (reversed for a credit balance).
4. Set `customers.receivable_account_id`. If the account changed but there was nothing to transfer, record a moves row with amount 0 and post no voucher.

Choosing the account the customer already has runs steps 1 to 3, so it sweeps up any balance left in another account; with nothing to sweep it does nothing and records nothing. That is the repair path if a posting ever lands in an old account.

A transfer entry debits and credits accounts inside the receivable set under one voucher, so it nets to zero per voucher and never appears in aging or on a statement.

Known and accepted:
- A document dated in the future but posted before the move is transferred with today's date.
- After an old document is cancelled, a balance sheet drawn for a date before the move shows the old category too high and the new one too low by that amount. The total, and all balances from the move date on, are right.

### 4.4 Chart of accounts

- An account that customers point to cannot be deactivated, moved out from under the control account, or have its type changed. The error names how many customers use it.
- No change to creating accounts: a category is an ordinary sub-account of Accounts Receivable.

## 5. Screens and API

**Customer form** (`customers/new`, `customers/[id]/edit`): a "Receivable account" picker listing the receivable set as a tree, with "Accounts Receivable (default)" first. It appears only when the business has at least one account under the control account. On an existing customer with a balance, saving shows "₹X will be transferred from A to B, dated today" and asks for confirmation. The quick-create modal keeps using the default.

**Customer detail:** shows the account and the list of moves.

**Customers list:** a filter by receivable account (including accounts under it), and a selection with a "Set receivable account" action.

**Aging report:** each row carries the customer's account; a filter by account and a subtotal per account.

**API**
- `GET /api/customers` and `GET /api/customers/[id]` return `receivable_account_id` and the account's code and name. The list accepts `receivable_account_id` as a filter.
- `POST /api/customers` accepts `receivable_account_id`, validated as in 4.3 step 1.
- `PUT /api/customers/[id]` (the existing update) never writes `receivable_account_id`.
- `POST /api/customers/[id]/receivable-account` with `{ receivable_account_id: string | null, dry_run?: boolean }` calls `moveCustomerReceivableAccount`. `dry_run` returns the amount that would be transferred, for the confirmation message, and changes nothing.
- `GET /api/customers/receivable-accounts` returns the control account and the accounts under it, for the pickers.
- `POST /api/customers/receivable-account` with `{ customer_ids: string[], receivable_account_id: string | null }`: moves up to 500 customers, each in its own transaction, and returns a result per customer.
- `GET /api/reports/aging/receivables` accepts `receivable_account_id`.

Business and user come from the session as everywhere else; a `business_id` or `created_by` in the body is ignored. The permission is the one that allows editing customers.

**Offline catalog:** the customer record carries the field through for display. The account cannot be changed offline.

## 6. Reports

| Reader | Today | Change |
|---|---|---|
| `lib/reports/party-ledger-docs.ts` (aging, statements) | `account_code LIKE '1103%'` | account in `receivableAccountIds` |
| `app/api/reports/party/statement/route.ts` | same pattern | same |
| `lib/reports/balance-sheet.ts` receivables figure | exact `1103` | sum over the set; each account still listed on its own line |
| `lib/reports/cash-flow.ts`, `lib/reports/dashboard-cash-flow.ts` | code starts with `1103` | account in the set |
| `app/api/admin/diagnostics/pl-validation/route.ts` | mapped account or `1103` | the set, and it must accept a reversal line on a different receivable account than its original |
| Dashboard receivables and aging cards | read the aging and party data | no change expected; confirm in the plan |

The test for every row: with customers spread over three accounts, each total equals the total with everyone in `1103`.

## 7. Deeper sub-accounts

The owner reported that a sub-account can be created but not one under it. The code allows it, so the first task of the plan is to reproduce it on the local server against `kh_phase2_test`: create Accounts Receivable → Domestic Debtors → North Zone through the screen and through the API. Whatever blocks it is fixed in this piece, and a DB test for three levels is added either way. If it cannot be reproduced, the owner is asked for the screen and the message before any change is made.

## 8. Errors

| Case | Result |
|---|---|
| Target account not in this business, inactive, or outside the receivable set | 400 `RECEIVABLE_ACCOUNT_INVALID` |
| Today is in a locked period and there is a balance to transfer | 400 `PERIOD_LOCKED`; the customer is not changed |
| Customer not in this business | 404 |
| Deactivating or re-parenting an account in use | 400 `ACCOUNT_IN_USE_BY_CUSTOMERS` |
| Bulk move, one customer fails | the others still move; the response lists each outcome |
| A customer's saved account was later made invalid by other means | postings fall back to the control account; the customer screen shows a warning |

## 9. Testing

**Unit** (`tests/lib/accounting/receivable-accounts.test.ts`): the receivable set from a list of accounts (descendants, legacy `1103…` codes, a mapped control account), and target validation.

**Database** (`tests/db/customer-receivable-accounts.db.test.ts`, on `kh_phase2_test`):
1. An invoice, receipt, credit note, debit note, advance adjustment and credit-note refund for a customer in Domestic all hit Domestic, and the trial balance balances.
2. Moving a customer with a balance posts one transfer; the old account nets to zero for that customer and the new one holds the balance.
3. After a move, editing and cancelling an old invoice leaves the old account untouched and the new account exact.
4. Moving twice, and moving back, stay exact.
5. Aging, statement and balance-sheet totals match the same data posted with every customer in `1103`.
6. A move with a balance inside a locked period is refused and changes nothing.
7. Deactivating an account in use is refused.
8. A customer of another business, and an account of another business, are refused.
9. Three levels of sub-accounts can be created.

**Staging steps** for the owner after deploy, written into the plan: create two accounts under Accounts Receivable, set them on two customers, raise an invoice and a receipt for each, check the balance sheet, aging and statements, then move one customer and check again.

## 10. Rollout

1. Migration 468 on staging first, with the owner's approval, then the code. No data is changed by the migration.
2. Nothing is visible until a business creates an account under Accounts Receivable.
3. Rolling back the code leaves any category accounts and transfers in the books as ordinary ledger entries; the old code's `LIKE '1103%'` would miss sub-accounts whose code does not start with `1103`, so roll back only before categories are in use, or move customers back to the default first.

## 11. To confirm while planning

- Every place that writes a receivable line for a customer is covered, including `lib/store/store-receipt.ts`, `lib/accounting/payment-reversal.ts` and `lib/accounting/advance-service.ts`.
- Nothing assumes a reversal line has the same account as its original (`ledger_entry_reversals` readers).
- No check constraint or trigger limits `voucher_type` values.
- The exact permission name for editing customers, and the helper that gives today's business date.
