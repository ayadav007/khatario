# Phase 4.1 — Payments, Refunds & Payment Lifecycle (Audit Only)

Read-only audit of the accounting payment lifecycle in the local codebase. Phases 1–3 are local and uncommitted; this report does not assume they exist on staging or production. No runtime code, migrations, tests, or databases were changed.

Phase 3.6B (online-store capture, receipt voucher, refund, Razorpay) was reviewed only as a boundary. It was not modified.

## 1. Executive summary

Normal business receipts and payments are the `payments` table plus a `voucher_type = 'payment'` ledger voucher posted by `createPaymentLedgerEntries`. The safe paths are:

- `PATCH /api/invoices/[id]/payments` — receipt on a **final** customer invoice
- `PATCH /api/purchases/[id]/payments` — payment on a **final** supplier bill
- `POST /api/payments` when `type` matches the document (receivable + invoice, payable + purchase)

Those three reject drafts, proformas, and cancelled documents, cap the amount at the outstanding balance, lock the document row, and commit the payment row, party balance, document totals, and ledger lines in one transaction. Accounting-period locks are enforced in the route and again by the ledger insert trigger. There is no idempotency key; the document row lock stops two concurrent allocations from both succeeding.

The material gaps are elsewhere:

1. `POST /api/payments` will update a document and a party balance even when `type` does not match the document, and then skip the ledger voucher.
2. An on-account payment does not check that the customer or supplier belongs to the session business. A foreign party id posts local cash and AR/AP and does not move that party’s balance.
3. There is no edit, void, or reversal API for a payment already posted against a final invoice or final bill.
4. Marking a purchase return (and, at create time, a credit note) as refunded stores the status and does not post cash or bank.
5. A bill saved as fully paid inserts a `payments` row whose cash sits inside the purchase voucher. Cancellation then refuses `PURCHASE_HAS_PAYMENTS`, so the bill cannot be reversed.
6. Cancelling a paid sales invoice reverses the sales voucher only. The receipt stays. The customer is left with a credit balance, not an advance and not a refund.

Store receipts reuse `createPaymentLedgerEntries` and `reverseVoucherLedgerEntries`. Store-only assumptions (order lock, `receipt_payment_id`, Razorpay method map, `razorpay_webhook` actor, COD not being cash) must not be copied into counter payments.

## 2. Payment-flow inventory

| Entry | What it writes | Document | Ledger | Identity |
| --- | --- | --- | --- | --- |
| `POST /api/payments` (`app/api/payments/route.ts` `POST`) | `payments` row; optional `tds_transactions`; party `current_balance`; invoice `paid_amount` / purchase `paid_amount` | `reference_type` `invoice` or `purchase`, or none (on-account) | `createPaymentLedgerEntries` only when receivable+customer or payable+supplier | Session: `getAuthenticatedUserId`, `getSessionScopedBusinessId`. Body `user_id` / `business_id` ignored |
| `PATCH /api/invoices/[id]/payments` | Receivable `payments` row, invoice totals, customer balance | Final tax invoice only | Same helper, **only if `customer_id` is set** | Session user and business |
| `PATCH /api/purchases/[id]/payments` | Payable `payments` row, bill totals, supplier balance | Final purchase only | Same helper, **only if `supplier_id` is set** | Session user and business |
| `POST /api/invoices` when `status=final` and `payments[]` (`app/api/invoices/route.ts`) | Receivable rows inside the invoice transaction. Replacing rows on an existing draft reverses old payment vouchers then soft-deletes or hard-deletes them | Final tax invoice. A posted tax invoice cannot be re-saved (`INVOICE_POSTED_IMMUTABLE`) | Receipt voucher only when the invoice has a customer. Walk-in (no customer) is Dr Cash / Cr Sales on the **invoice** voucher; the payment row has no voucher | Session actor for the invoice. **`payments.created_by` is not set** |
| `POST /api/purchases` and `createPurchaseInTransaction` when `paid_amount > 0` | Payable row, mode hardcoded `cash` | Final bill | Separate payment voucher **only if the payment is partial** (`paid_amount < supplier payable`). A fully paid bill keeps cash inside the purchase voucher | `created_by` is `getAuthenticatedUserId` |
| `deleteDraftPurchase` (`lib/purchases/delete-draft-purchase.ts`) | Reverses payment and TDS vouchers, restores supplier balance, soft-deletes or hard-deletes payment rows, zeroes `paid_amount` | Draft purchase only. Final and cancelled are rejected | `reverseVouchers` voucher type `payment` | Caller passes `userId` (purchase delete route; not re-audited beyond this function) |
| `POST /api/payments/restore` | Clears `deleted_at` only | None | Does not post. Refuses `PAYMENT_RESTORE_ACCOUNTING_UNSAFE` when no live (unreversed) payment lines exist | Session user and business. `authorize(..., 'payments', 'update')` |
| `POST /api/expenses` | `expenses` row, not `payments` | Expense | `postExpenseVoucher`: cash/bank, or AP if mode is `on_account` / `pay_later` / `unpaid` / `credit` | **Body `created_by` and `getBusinessIdFromRequest` (body/query fallback)** |
| Expense delete | Soft-delete header | Expense | `deleteExpenseByReversal` → `reverseVoucherLedgerEntries` | Existing Phase 2 path |
| `POST /api/advances` and `POST /api/advances/[id]/refund` | `advance_payments` / `advance_adjustments`, not `payments` | Advance, optionally later adjusted onto an invoice or bill | New balanced voucher `advance_refund` (Rule 51), not a reversal of the original advance lines | `guardLedgerRoute`: tenant via `requireTenantBusinessId`; actor via **`getUserIdFromRequest`** (body/query/`x-user-id` if the session header is absent) |
| `POST /api/credit-notes` | Credit note + credit-note voucher | Invoice (optional) | Dr sales / Cr AR (and GST). `refund_status` is stored and **does not post cash** | Session user (Phase 3.7) |
| `PATCH /api/purchase-returns/[id]` | Updates `refund_status`, `refund_mode`, `refund_date`, `refund_amount` | Purchase return | **No ledger write** | `getUserIdFromRequest` + `getBusinessIdFromRequest` |
| `POST /api/gst/payment` | GST cash-ledger deposit and utilisation | None (`payments` not used) | `gst_cash_deposit` / `gst_cash_utilization` via `recordGstPayment` | `withPremiumSubscriptionApi` session `businessId` / `userId` |
| `POST /api/tds/payments` | `tds_payments` challan row | Marks deposit metadata | **No ledger**. Does not clear TDS Payable 2102 | Premium wrapper supplies `businessId`. Body `created_by` is still accepted |
| `POST /api/tax-provisions/[id]/payments` | `tax_payments` via `recordTaxPayment` | Tax provision | **No ledger** | **Body `business_id` and `user_id` only. No session check** |
| `POST /api/employees/salary/payments` | `salary_payments` | Employee | **No accounting voucher** found on this route | **Body `processed_by` is the authorizer**. Business is the session |
| `POST /api/payments/upi-collect`, webhooks (`handle-post`, phonepe, payu, instamojo, `[provider]`), `POST /api/payments/manual-action` | `payment_transactions` and `sales_orders.payment_status` | Sales order, not an invoice | **No `payments` row and no ledger** | UPI collect and manual action: session business first, then body fallback; user from `getUserIdFromRequest` |
| `lib/store/store-receipt.ts` `settleStoreOrderReceipt` | One `payments` row, `store_orders.receipt_payment_id` | Store invoice that already exists and is final, and has a customer | `createPaymentLedgerEntries`. Cash-sale store invoices skip (`CASH_SALE_INVOICE`) | `created_by` NULL, `receipt_actor_type = razorpay_webhook` |
| `lib/store/store-refund.ts` | `store_payment_refunds` | Store order | Reverses the **payment** voucher only, after the provider says processed | Session user for admin; webhook actor `razorpay_webhook` |
| `POST /api/offline-sync/replay` action `payment.record` | Nothing | — | Handler returns “not implemented” | Session business must match body. User is `getUserIdFromRequest`, then compared to body `user_id` |

`GET /api/payments`, `GET /api/payments/[id]`, receipts, and history are reads. They are not mutation paths. List and detail still fall back to query/body `business_id` and `getUserIdFromRequest` when the session header is absent.

Payment modes on the `payments` table are free text. Schema comment lists `cash`, `upi`, `bank`, `cheque`, `credit`. Account resolution is `getPaymentModeAccountId`: an explicit `payment_modes` mapping wins; `bank` / `neft` / `rtgs` use bank 1102; **every other unmapped mode, including UPI, card, and cheque, returns Cash 1101**. The later bank fallback in `getAccountForPaymentMode` never runs once that function returns an id.

Supported accounting types on `payments.type`: `receivable` (payment in) and `payable` (payment out). There is no `reference_type` for credit notes, debit notes, or expenses.

## 3. Lifecycle matrix

| Flow | Create | Edit amount/mode | Delete / void | Reverse voucher | Refund | Restore | Document cancelled |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Invoice receipt (`PATCH …/payments`, `POST /api/payments` receivable+invoice, invoice save with `payments[]`) | Final invoice only. Overpayment `PAYMENT_EXCEEDS_BALANCE`. Partial allowed. Atomic with ledger if the invoice has a customer | No payment PATCH/PUT | No API. Invoice re-save of a **draft** can reverse and soft-delete old rows; a **final** invoice cannot be re-saved | No user-facing reversal | Not a refund. Credit note is a different voucher | `POST /api/payments/restore` only clears `deleted_at`, and only if a live payment voucher still exists. It does not change `paid_amount` | Invoice cancel reverses the **sales** voucher and reduces customer balance by `grand_total` minus released advances. **Receipt voucher and `payments` row stay.** Comment in `reverseInvoiceAccountingOnCancel` says the remainder is a customer credit |
| Purchase payment | Final bill only. Outstanding is payable minus paid, TDS, and advances. Partial allowed | No | Draft delete reverses and soft/hard-deletes. **Final bill with any live payment or `paid_amount > 0` cannot be cancelled** (`PURCHASE_HAS_PAYMENTS`) | Only via draft delete | Not a refund. Purchase return is separate | Same restore route | Cancel refuses. No automatic supplier refund |
| On-account `POST /api/payments` (no `reference_id`) | Posts Dr cash / Cr AR or Dr AP / Cr cash and moves party balance. **No cap, no idempotency key** | No | No | No | No | Same restore route | n/a |
| Expense | Cash/bank or on-account AP in one expense voucher. Not a `payments` row | Edit path not re-read line by line; corrections module reverses | `deleteExpenseByReversal` | Yes, Phase 2 reversal links | n/a | n/a | n/a |
| Advance refund | New `advance_refund` voucher, capped at unadjusted balance | n/a | n/a | New opposite voucher, not `ledger_entry_reversals` of the original advance | This **is** the non-store refund | n/a | Invoice/purchase cancel releases adjustments via `releaseDocumentAdvances` |
| Credit note `refund_status` | Label on the note. Accounting is the credit-note voucher | No later route updates `refund_status` | Cancel reverses the note, not a cash refund | Note reversal only | **Status is not a cash refund** | n/a | n/a |
| Purchase return refund PATCH | Status, mode, date, amount only | Can be set back to `pending` (clears the fields) | No cash reversal because none was posted | None for the “refund” | **Status is not a cash receipt** | n/a | n/a |
| Store receipt / refund | One receipt per paid order. Idempotent on `receipt_payment_id` | No | Refund reverses the payment voucher when the provider reports processed | Yes | Explicit, not implied by invoice cancel | n/a | Invoice cancel does not refund the store receipt |
| Gateway `payment_transactions` | PSP row + sales-order `payment_status` | Manual `mark_paid` / `mark_failed` | No accounting void | No accounting voucher to reverse | No | n/a | Does not touch invoices |
| GST challan, TDS challan, income-tax provision, salary | Domain tables | Not audited as edits | Not a `payments` void | GST challan has ledger vouchers. TDS challan, tax provision, and salary **do not** | n/a | n/a | n/a |

## 4. Findings

### F1 — Mismatched payment type skips the voucher but still settles the document

- **Severity:** High
- **Where:** `POST` in `app/api/payments/route.ts` (document updates around the invoice and purchase blocks; ledger call uses `type` plus party id). Poster: `createPaymentLedgerEntries` in `lib/ledger-utils.ts` (returns without lines unless receivable+customer or payable+supplier).
- **Current behavior:** `reference_type: 'purchase'` with `type: 'receivable'` still passes the final-bill checks, inserts the row, increases `paid_amount`, and decreases supplier `current_balance`. The ledger branch for receivable requires `customerId`, which this path does not set, so no voucher is written. The mirror case (`type: 'payable'` against an invoice) moves customer balance and `paid_amount` and posts nothing.
- **Failure:** Session user posts `{ type: 'receivable', reference_type: 'purchase', reference_id: <final bill>, amount: 100 }`. Bill shows paid. Supplier balance drops. Cash and AP do not move. Trial balance and the bill disagree.
- **Impact:** Party subledger and document outstanding diverge from the books. `validate_voucher_balance` does not fire because there are no lines.
- **Status:** Confirmed from code.

### F2 — On-account payment does not prove the party belongs to the business

- **Severity:** High
- **Where:** `POST` in `app/api/payments/route.ts` (standalone balance updates). Schema: `payments.customer_id` / `supplier_id` reference the party id only, not `(id, business_id)`.
- **Current behavior:** Allocated payments overwrite the party from the document, which is loaded with `business_id`. On-account payments trust body `customer_id` / `supplier_id`. The balance `UPDATE` is scoped with `AND business_id = session`, so another tenant’s balance is not changed. The ledger still posts in the session business.
- **Failure:** Business A sends Business B’s customer id, type receivable, no `reference_id`. Insert succeeds. Customer balance update affects 0 rows. Business A still gets Dr Cash, Cr AR.
- **Impact:** Cash and AR move with no party subledger movement. The payment row points at another tenant’s customer.
- **Status:** Confirmed from code and `database/schema.sql` (`payments` check constraint allows a customer without proving tenancy).

### F3 — A posted receipt or supplier payment cannot be corrected

- **Severity:** High
- **Where:** No `PATCH` or `DELETE` on `app/api/payments/[id]/route.ts` (GET only). No payment reversal route. Policies in `lib/policies/resources/payments.ts` define `read` and `create` only.
- **Current behavior:** Amount, mode, date, and allocation are immutable after insert, except the draft-purchase delete path and the draft-invoice “replace payments” path. Neither applies to a final document. Ledger lines cannot be updated (`prevent_ledger_entry_update`).
- **Failure:** A ₹10,000 receipt is recorded on the wrong final invoice. The product has no void. A second receipt is also wrong. The user cannot reverse the voucher.
- **Impact:** Books stay wrong until a database change or a future void. This is a missing workflow, not a silent corruption of the happy path.
- **Status:** Confirmed absence. **Product decision:** void (reverse the payment voucher and restore outstanding) versus refund (new cash-out) versus credit note. Do not invent one in 4.2 without that choice.

### F4 — Purchase-return “refunded” does not post cash or bank

- **Severity:** High
- **Where:** `PATCH` in `app/api/purchase-returns/[id]/route.ts`.
- **Current behavior:** Status `refunded` requires mode and date, then updates four columns. No `payments` insert, no ledger, no period lock, no supplier balance change.
- **Failure:** User marks a ₹5,000 return refunded by bank. The return voucher (if any) is unchanged. Bank is unchanged. Reports that sum `refund_amount` show ₹5,000 received.
- **Impact:** Cash/bank and the refund report disagree.
- **Status:** Confirmed. **Product decision:** is “refunded” a memo, or must it post Dr Bank / Cr AP (or Dr Bank / Cr Purchase) through the reversal architecture?

### F5 — Walk-in cash sales and the cash-flow report use different sources

- **Severity:** High
- **Where:** Invoice save in `app/api/invoices/route.ts` (cash sale = no `customer_id`; receipt voucher only if `customer_id && insertedPayments`). Cash-flow in `app/api/dashboard/cash-flow/route.ts` sums `payments` rows, not cash-ledger lines. `PATCH /api/invoices/[id]/payments` also skips `createPaymentLedgerEntries` when `customer_id` is null, but still increases `paid_amount`.
- **Current behavior:** A walk-in final invoice debits Cash for the grand total on the invoice voucher. If the save includes no `payments[]`, cash-flow inflows ignore it. If it includes a partial `payments[]`, the row has no voucher (cash was already taken in full on the invoice) and cash-flow shows only the partial row.
- **Failure:** Save a ₹1,000 walk-in invoice with no payment array. Cash ledger +₹1,000. Cash-flow inflows +₹0.
- **Impact:** Dashboard cash and the cash account diverge for counter cash sales.
- **Status:** Confirmed from code.

### F6 — A bill paid in full at save cannot be cancelled

- **Severity:** High
- **Where:** `POST` `app/api/purchases/route.ts` and `createPurchaseInTransaction` in `lib/purchases/purchase-create-service.ts` (insert a payment whenever `paid_amount > 0`; call `createPaymentLedgerEntries` only when `paid_amount < supplierPayable`). Guard: `cancelFinalPurchase` in `lib/purchases/cancel-purchase.ts` (`PURCHASE_HAS_PAYMENTS` if any live payment **or** `paid_amount > 0`).
- **Current behavior:** Full settlement is one purchase voucher that credits cash (`isCashPurchase`). A `payments` row is still stored and has no voucher of its own. Cancel treats that row as a payment that must not be auto-refunded.
- **Failure:** Create a final bill with `paid_amount = grand_total`. Cancel returns 409. The purchase voucher, including cash, cannot be reversed through the product.
- **Impact:** Paid-at-source bills are stuck. The guard is right for a **partial** payment that has its own voucher. It also blocks the full-cash case, where reversing the purchase voucher would reverse the cash.
- **Status:** Confirmed. **Product decision:** allow cancel of a full-cash bill by reversing only the purchase voucher, or keep the refusal and stop inserting a payment row when no separate voucher is posted.

### F7 — Cancelling a paid invoice leaves the receipt as an unnamed customer credit

- **Severity:** Medium
- **Where:** `reverseInvoiceAccountingOnCancel` in `lib/invoices/cancel-invoice-accounting.ts`. Purchase cancel does the opposite (refuses).
- **Current behavior:** Sales, GST, and stock reverse. Customer balance decreases by `grand_total - released advances`. The receipt (Dr Cash, Cr AR) remains. Net AR and the customer balance become a credit equal to the amount already received. The `payments` row still points at the cancelled invoice.
- **Failure:** Invoice ₹1,000, receipt ₹1,000, then cancel. Cash stays ₹1,000. Customer balance is −₹1,000. There is no advance document and no refund.
- **Impact:** The credit is real in the books, but it is not an advance, not allocatable by a dedicated document, and not a refund. A later manual payout would double-pay unless someone posts a matching payment out.
- **Status:** Confirmed, and the source comment calls it existing behaviour. **Product decision** before any change.

### F8 — Credit-note refund status is not a cash refund

- **Severity:** Medium
- **Where:** `POST` `app/api/credit-notes/route.ts` (persists `refund_status`, `refund_mode`, `refund_date`, `refund_amount`). No other credit-note route updates those fields. Ledger is `createCreditNoteLedgerEntries`.
- **Current behavior:** The note reduces sales and AR (and GST). It does not credit cash or bank. Cancel reverses that note voucher.
- **Failure:** Create a note with `refund_status: 'refunded'` and `refund_mode: 'cash'`. AR falls. Cash does not.
- **Impact:** Same class of report-vs-books gap as F4, on the sales side. There is no follow-up API to post the cash later.
- **Status:** Confirmed. Needs the same product decision as F4.

### F9 — Expense cash posting still trusts body identity

- **Severity:** Medium
- **Where:** `POST` `app/api/expenses/route.ts`.
- **Current behavior:** `business_id` comes from `getBusinessIdFromRequest` (session header, then body, then query). Authorization and `expenses.created_by` use body `created_by`. The voucher is cash/bank or AP, in one transaction, with an accounting-period lock and a GST lock when GST amounts are present.
- **Failure:** Without the middleware header, a caller supplies another user’s id and a business id and posts an expense to cash.
- **Impact:** Cash/AP and the audit actor are client-chosen on this path. Invoice and purchase payment creates no longer do this.
- **Status:** Confirmed. In scope because it is a cash or AP settlement, not because it uses the `payments` table.

### F10 — Unmapped UPI, card, and cheque hit Cash

- **Severity:** Medium
- **Where:** `getPaymentModeAccountId` in `lib/account-mappings.ts` (default branch returns cash). `getAccountForPaymentMode` in `lib/ledger-utils.ts` returns as soon as that id exists.
- **Current behavior:** A configured `payment_modes.upi` (or card) account is used. With no mapping, UPI/card/cheque resolve to Cash 1101. Bank is used for `bank`, `neft`, `rtgs`, and `bank_transfer` only.
- **Failure:** Record a receipt with `payment_mode: 'upi'` and empty mappings. Dr Cash, not Bank.
- **Impact:** Bank reconciliation misses UPI. This is the same resolver the store receipt uses after it maps Razorpay methods onto these keys.
- **Status:** Confirmed.

### F11 — Government and payroll “payments” do not all hit the books

- **Severity:** Medium
- **Where:** `POST` `app/api/tds/payments/route.ts` (inserts `tds_payments` only). `recordTaxPayment` in `lib/services/tax-provision-calculator.ts` (inserts `tax_payments` only). `POST` `app/api/employees/salary/payments/route.ts` (no ledger import). Contrast: `POST /api/gst/payment` does post.
- **Current behavior:** A TDS challan row does not debit TDS Payable 2102. An income-tax provision payment does not move a tax liability. Salary payment does not credit cash. GST challan does move liability and bank.
- **Failure:** Record a TDS deposit challan for the amount sitting in 2102. The challan list shows it. The ledger still shows 2102.
- **Impact:** Statutory payments look done in their screens and remain payable in the books.
- **Status:** Confirmed. **Product decision:** which of these screens are memos and which must post. Tax-provision create also takes body `business_id` and `user_id` with no session read (`app/api/tax-provisions/[id]/payments/route.ts`), so it is both an accounting gap and an identity gap.

### F12 — Sales-order gateway success is not an accounting receipt

- **Severity:** Medium
- **Where:** `lib/services/payment-webhook.ts`, `updatePaymentTransactionStatus` / `syncSalesOrderPaymentAggregate` in `lib/services/payment-transactions.ts`, `POST` `app/api/payments/manual-action/route.ts` (`mark_paid`).
- **Current behavior:** Success updates `payment_transactions` and `sales_orders.payment_status`. It does not insert `payments` or call `createPaymentLedgerEntries`. `mark_paid` checks the amount against the order remainder, then sets status `success`.
- **Failure:** Webhook marks a sales order paid. No cash debit, no AR credit, no invoice receipt.
- **Impact:** Order UI says paid. Books do not, until some other flow creates an invoice and a receipt. This is **not** the Phase 3.6B store Razorpay path.
- **Status:** Confirmed. Needs a product decision if sales orders are ever supposed to post cash by themselves.

### F13 — Invoice-embedded receipts have no actor

- **Severity:** Medium
- **Where:** `INSERT INTO payments` in `app/api/invoices/route.ts` (column list has no `created_by`).
- **Current behavior:** The invoice actor is the session user. The payment row stores `created_by` NULL. Purchase-create payments do set `getAuthenticatedUserId`.
- **Failure:** Save a final invoice with a `payments` entry. The receipt voucher exists. The payment’s `created_by` is null, so the audit trail does not name the cashier.
- **Impact:** Audit only. Amounts still post.
- **Status:** Confirmed.

### F14 — On-account payments can be duplicated; allocated ones cannot

- **Severity:** Medium
- **Where:** `POST` `app/api/payments/route.ts`. Allocated path takes `FOR UPDATE` on the invoice or purchase before the balance check. On-account path has no document lock and no idempotency key.
- **Current behavior:** Two concurrent ₹500 receipts against ₹500 outstanding: the second waits, recomputes, and gets `PAYMENT_EXCEEDS_BALANCE`. Two identical on-account posts both commit two vouchers. Offline `payment.record` does not implement a replay, so the queue cannot dedupe this either.
- **Failure:** Double-click Payment In with only a customer selected.
- **Impact:** Cash and the customer credit double.
- **Status:** Confirmed.

### F15 — Advance refund actor falls back to the body

- **Severity:** Low
- **Where:** `guardLedgerRoute` in `lib/http/ledger-route-guard.ts` (`getUserIdFromRequest`). Used by `POST /api/advances/[id]/refund`.
- **Current behavior:** Business mismatch is rejected (`requireTenantBusinessId`). The user id prefers `x-authenticated-user-id`, then body `user_id` / `created_by`, query, and `x-user-id`. With middleware, the header wins. Without it, body identity authorizes a cash refund voucher.
- **Failure:** Call the refund route with no session header and `user_id` of a user who is allowed to create.
- **Impact:** Same class of actor spoof already removed from invoice and purchase payments. The voucher itself is balanced and period-locked.
- **Status:** Confirmed for the helper. Depends on middleware being present in production.

### F16 — GST filing lock is not applied to ordinary receipts

- **Severity:** Low
- **Where:** `periodGuardResponse` calls in the three payment creates. They do not pass `checkGstFiled`. `createPaymentLedgerEntries` posts cash/bank, AR 1103 or AP 2101, and TDS 1116 or 2102, not GST output accounts.
- **Current behavior:** A locked **accounting** period blocks the route and the `validate_period_lock` insert trigger. A filed GST period does not block a receipt.
- **Failure:** Record a receipt dated in a filed GST month. It posts.
- **Impact:** None on GSTR figures, because those accounts are not GST ledgers. Noted so a later phase does not add a second lock by accident.
- **Status:** Confirmed. Not recommended as a defect unless product wants every cash movement frozen after filing.

## 5. Existing protections

- **One transaction** for payment row, document totals, party balance, TDS row, and ledger lines on `POST /api/payments`, invoice payment PATCH, and purchase payment PATCH. Rollback undoes the row if the voucher fails.
- **Document row lock** (`FOR UPDATE`) before the outstanding check on those three allocation paths.
- **Final-document rule** (`lib/accounting/final-document-payment.ts`): drafts return 409 `DOCUMENT_NOT_FINAL`. Proforma and cancelled documents are rejected. Covered by `tests/db/phase3-3-draft-payment.db.test.ts` (15 tests; not re-run in this audit).
- **Overpayment cap** `PAYMENT_EXCEEDS_BALANCE` for invoice receipts (after credit/debit notes via `recomputeInvoiceBalance`) and purchase payments (`purchaseOutstanding`: payable − paid − TDS − advances).
- **Ledger immutability:** `prevent_ledger_entry_update` (migration 123). Deletes go through the ledger delete guard (migration 323). Reversal-of-reversal and link edits are rejected (migration 324).
- **Period lock on insert:** `validate_period_lock_trigger` plus the route guard.
- **Voucher balance:** deferred constraint trigger `validate_voucher_balance`.
- **Restore safety:** `POST /api/payments/restore` will not clear `deleted_at` unless an unreversed payment line still exists (`PAYMENT_RESTORE_ACCOUNTING_UNSAFE`). It does not re-post.
- **Draft purchase delete** reverses payment vouchers before it hides or removes the rows.
- **Final invoice immutability** blocks the “replace payment rows on save” path for posted tax invoices.
- **Purchase cancel** will not silently refund a paid bill.
- **Store boundary:** one receipt per order (`receipt_payment_id`), refund reverses only the payment voucher, COD does not post Dr Cash / Cr AR, webhook tenant comes from the provider payment id rather than notes. Do not reuse `shouldDecrementStock`, order status, or `razorpay_webhook` for counter payments. Do reuse `createPaymentLedgerEntries` and `reverseVoucherLedgerEntries`.
- **Payment policies** have no update/delete action, so a non-admin calling restore is denied unless they are primary admin (authorize short-circuit). That is a protection, not a void workflow.

Not protected at the database: `payments` rows can change (`deleted_at`, and in principle amount) with no trigger tying them to `ledger_entry_lines`. `reference_id` has no foreign key. There is no unique constraint against duplicate on-account payments.

## 6. Recommended implementation sequence

Each subphase should be independently testable on real PostgreSQL and should not redesign store refunds.

1. **4.2 — Stop mismatched and cross-tenant settlements.** On `POST /api/payments`, require `type` to match `reference_type`, reject a party id that is not in the session business, and refuse to move `paid_amount` or party balance when no voucher will be posted (including cash-sale invoice PATCH). Add tests for F1 and F2.
2. **4.3 — On-account idempotency and caps.** Decide whether an unallocated receipt is allowed. If yes, require an idempotency key and a stated cap (or an explicit “on account” flag). If no, reject `POST /api/payments` without a final document and point advances at the existing advance module. Do not build a second advance system by accident.
3. **4.4 — Void a posted payment.** After the product choice in F3: one reversal of the payment voucher, restore document outstanding and party balance, keep the original row, respect period locks **before** any write, idempotent second void. No edit-in-place of amount.
4. **4.5 — Paid-at-source purchase cancel.** Resolve F6: either do not insert a `payments` row when cash already sits on the purchase voucher, or teach cancel to reverse that single voucher when there is no separate payment voucher. Do not auto-refund a partial payment that has its own voucher.
5. **4.6 — Refund status versus cash.** Resolve F4 and F8. Either remove the implication that `refunded` moves cash, or post an explicit receipt/payment through `createPaymentLedgerEntries` / reversal, separate from the note or return voucher.
6. **4.7 — Identity leftovers that move cash.** Expense create, advance `guardLedgerRoute` actor, tax-provision payments, purchase-return refund PATCH. Session user and session business only.
7. **4.8 — Statutory payments that should hit the ledger.** TDS challan versus 2102, and income-tax provision payments, only after product confirms they are not memos. GST challan already posts; leave it.
8. **Leave until a sales-order decision:** gateway `payment_transactions` (F12). Leave store 3.6B unchanged.

## 7. Exclusions and unresolved product decisions

**Exclusions**

- No code, migration, test, or data change in this phase.
- Phase 3.6B store capture, COD, Razorpay refunds, and `shiprocket` / store cancellation were not redesigned.
- Invoice, purchase, credit-note, debit-note, and journal posting rules from Phases 2–3 were not re-opened except where a payment is attached.
- Salary calculations, attendance, and payslip PDFs.
- Payment-provider credential storage and PSP signature verification, except to confirm those webhooks do not write accounting vouchers.
- Backup restore (`DELETE FROM payments` for a whole business) and admin invoice purge. Those are operational wipes, not the cashier lifecycle.

**Unresolved**

- Is an on-account `POST /api/payments` a supported product, or should all unallocated cash go through advances?
- After invoice cancel, is the leftover customer credit acceptable, or must it become an advance or a refund?
- May a fully cash-settled purchase be cancelled by reversing its one voucher?
- Do purchase-return and credit-note “refunded” statuses need a cash voucher?
- Do TDS challans and income-tax provision payments need ledger postings?
- Should a paid sales order (gateway) ever post cash before an invoice exists?

## What was inspected, run, and not verified

**Inspected (mutations and posters)**

- `app/api/payments/route.ts`, `app/api/payments/[id]/route.ts`, `app/api/payments/restore/route.ts`, `app/api/payments/manual-action/route.ts`, `app/api/payments/upi-collect/route.ts`
- `app/api/payments/webhook/handle-post.ts` and the provider route files (they delegate; accounting posting was confirmed absent in `lib/services/payment-webhook.ts` and `lib/services/payment-transactions.ts`)
- `app/api/invoices/[id]/payments/route.ts`, `app/api/purchases/[id]/payments/route.ts`
- Payment insert sections of `app/api/invoices/route.ts`, `app/api/purchases/route.ts`, `lib/purchases/purchase-create-service.ts`
- `lib/ledger-utils.ts` (`createPaymentLedgerEntries`, `getAccountForPaymentMode`), `lib/account-mappings.ts` (`getPaymentModeAccountId`)
- `lib/accounting/final-document-payment.ts`, `lib/invoices/invoice-edit-postings.ts`, `lib/invoices/cancel-invoice-accounting.ts`, `lib/purchases/delete-draft-purchase.ts`, `lib/purchases/cancel-purchase.ts` (payment guard), `lib/purchases/purchase-balance.ts`
- `app/api/expenses/route.ts`, `lib/accounting/expense-corrections.ts` (reversal entry points)
- `app/api/advances/[id]/refund/route.ts`, `refundAdvance` in `lib/accounting/advance-service.ts`, `lib/http/ledger-route-guard.ts`
- `app/api/credit-notes/route.ts` (refund fields), `app/api/purchase-returns/[id]/route.ts`
- `app/api/gst/payment/route.ts`, `app/api/tds/payments/route.ts`, `app/api/tax-provisions/[id]/payments/route.ts`, `recordTaxPayment` in `lib/services/tax-provision-calculator.ts`
- `app/api/employees/salary/payments/route.ts` (no ledger call)
- `app/api/offline-sync/replay/route.ts` (`payment.record` unimplemented)
- `lib/store/store-receipt.ts`, `lib/store/store-refund.ts` (boundary only)
- `lib/policies/resources/payments.ts`
- `app/api/dashboard/cash-flow/route.ts`
- `database/schema.sql` (`payments` table), migrations `123_ledger_immutability_and_period_locks.sql`, and the existence of 323/324 reversal guards
- `lib/http/period-guards.ts`

**Commands / tests**

- Repository search only (ripgrep and file reads). No Jest, no `psql`, no migration, no server, no `git add`, no commit, no push, no deploy.

**Not verified at runtime**

- No request was sent against a database, so row counts, trigger error text, and concurrent interleaving were not executed here. Conclusions are from the current source.
- Expense **edit** (as opposed to create and `deleteExpenseByReversal`) was not traced line by line.
- `app/api/employees/expenses/route.ts` is an HR claim with a `payment_mode` field. It does not insert into `payments`. Its ledger effect, if any, was not fully read.
- Whether every webhook provider file can reach `payment-webhook` was inferred from the shared handler, not by executing a signed payload.

Every `INSERT INTO payments` in application code is one of: `POST /api/payments`, invoice payment PATCH, purchase payment PATCH, invoice create, purchase create, `purchase-create-service`, or `settleStoreOrderReceipt`. No other application insert was found.
