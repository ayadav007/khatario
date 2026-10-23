# Online store journey audit — 2026-10-23

Scope: customer journey on the storefront, the three store templates, and the merchant journey from order received to shipped, payment, COD and accounts. Asked for by the user. No application code was changed. Nothing was deployed.

Database for every run: `current_database()` = `kh_phase2_test`, port 5433, address `::1`. Runner: a scratch node script that refuses any other database and sets `PHASE2_TEST_DATABASE_URL`, then runs `npx jest <files> --runInBand --forceExit`.

## Evidence

### 1. Existing store and fulfilment suites

Command (through the runner): `npx jest tests/db/phase3-5-store-invoice.db.test.ts tests/db/phase3-6a-store-cancel.db.test.ts tests/db/phase3-6b-store-payment.db.test.ts tests/db/easebuzz-store-payment.db.test.ts tests/db/store-checkout-stock.db.test.ts tests/db/store-order-safety.db.test.ts tests/db/shiprocket-booking.db.test.ts tests/db/order-fulfilment.db.test.ts tests/db/fulfilment-ops.db.test.ts tests/db/order-returns.db.test.ts tests/db/order-notify.db.test.ts tests/lib/store tests/lib/fulfilment tests/security/store-host-api-lockdown.test.ts --runInBand --forceExit`

Result: 32 suites, 27 passed, 5 failed. 340 tests, 314 passed, 26 failed. Exit 1.

Passed suites: checkout stock holds, Shiprocket booking, order fulfilment, fulfilment ops, returns, order notifications, store host lockdown, and all `tests/lib/store` and `tests/lib/fulfilment` unit files.

Failures, grouped by cause:

| Cause | Tests | Kind |
| --- | --- | --- |
| Online store receipt cannot choose a settlement account: `SettlementAccountError: Choose the cash or bank account. More than one account can take this payment.` and, for card, `Add a credit-card or payment-gateway clearing account`. | 3.6B #33; Easebuzz #1, #2 (webhook HTTP 500), #7, #8 | Product defect D1 |
| Test fixtures have no plan. Handlers now gate with `denyIfFeatureMissing` / `hasFeatureAccess`, which the old mocks do not stub, so they return 403 or the store resolves to 404. | 3.5 #14, #15; 3.6A #19, #20; 3.6B #17, #18, #31; store-order-safety (13 tests); 3.6B "webhook notes" (401 instead of 400) | Test drift. BLOCKED, not a product result |

### 2. New journey audit

File: `tests/db/store-journey-e2e.db.test.ts`. Real ledger, stock and invoices. WhatsApp, plan gates (`feature-access`, `enforce-access`) and fulfilment notifications are stubbed. Each test asserts what the merchant should see.

Result: 9 tests, 1 passed, 8 failed. Exit 1. Fixture businesses left afterwards: 0.

| Test | Result | Observed |
| --- | --- | --- |
| J1 COD order with no delivery fee: invoice, stock −2, confirm, ready (own delivery), parcel COD ₹236, delivered, cash collected, invoice balance 0 | PASS | — |
| J2 COD order with ₹40 delivery fee is invoiced | FAIL | `CHARGE_UNCLASSIFIED`. No invoice, no ledger, no stock deduction |
| J3 COD order with ₹20 coupon is invoiced | FAIL | `CHARGE_UNCLASSIFIED` |
| J4 mixed cart: ₹100 + 18% exclusive and ₹118 inclusive | FAIL | Quote ₹254, expected ₹236 (+₹18 overcharge) |
| J5 gateway UPI payment posts a receipt on the standard chart | FAIL | Order marked paid; receipt not posted: "The store receipt is not posted yet" |
| J6 order at 00:30 IST on 23 Oct | FAIL | `invoice_date` 2026-10-22 |
| J7 COD remittance for a delivered parcel settles the invoice | FAIL | Remittance saved; invoice balance still ₹236. No receipt or ledger line |
| J8 direct-UPI order marked received | FAIL | "Choose the cash or bank account. More than one account can take this payment." |
| J9 direct-UPI order label | FAIL | Label banner "CASH ON DELIVERY · COLLECT ₹236" |

### 3. Store templates on staging

Built-in browser, read only, preview stores where checkout is turned off: `theme-studio`, `theme-khatario`, `theme-grocery` `.staging.khatario.com`.

Result: BLOCKED. All three stay on a spinner. `/_next/static/chunks/runtime-30150d2d36757ff1.js` returns HTTP 400 and `css/6fdbe1aa067a34ce.css` returns 404, on store hosts and on `staging.khatario.com` itself. `/login` renders without styles. The staging build and its static files do not match. Not a store-code result.

Code check of template wiring: the three packs (`studio`, `khatario`, `grocery`) are defined in `lib/store/store-theme.ts`, demo subdomains in `lib/store/theme-demo.ts`, and the pack switches in cart, catalogue, product card, mobile nav and product modal. `tests/lib/store/store-theme.test.ts`, `theme-demo.test.ts`, `theme-draft.test.ts`, `studio.test.ts`, `grocery.test.ts` PASS. Rendering is NOT TESTED.

## Defects

| Id | Defect | Where | Effect |
| --- | --- | --- | --- |
| D1 | Store receipts use `getAccountForPaymentMode` with no account picked. `ensure_standard_account_heads` adds 2112 Bank OD, which counts as a bank account next to 1102, so any bank-class mode (UPI, netbanking, wallet) has two candidates and fails. Card fails without a clearing account. The saved `account_mappings.payment_modes` is not used. | `lib/store/store-receipt.ts` `postStoreInvoiceReceipt`; `lib/accounting/settlement-accounts.ts` | Paid online orders stay unsettled: customer shows dues, bank not debited. The webhook returns 500 and the gateway keeps retrying. Direct-UPI "received" also fails. |
| D2 | Orders with a delivery fee or coupon are never invoiced (`CHARGE_UNCLASSIFIED`). | `lib/store/fulfill-paid-order.ts` `createInvoiceForStoreOrder` | No sale, GST, stock or receivable for those orders. The dashboard retry repeats every minute and never succeeds. |
| D3 | Mixed GST-inclusive and exclusive cart: tax of inclusive lines is added again. | `lib/store/quote.ts` (`exclusiveTax` uses the whole `taxTotal`) | Customer overcharged. Invoice is also refused (`STORE_TAX_NOT_REPRESENTABLE`). |
| D4 | Invoice date from `toISOString()` (UTC). | `lib/store/fulfill-paid-order.ts` | Orders between 00:00 and 05:30 IST are dated the previous day. Same class as S03. |
| D5 | COD remittance only links parcels. It posts no receipt, no bank entry, and no expense for courier deductions. | `lib/fulfilment/cod-remittance.ts` `recordRemittance` | Invoice stays unpaid after the courier pays the money over. |
| D6 | Direct-UPI orders are stored as `payment_status = 'cod'`, so the parcel COD amount is the order total. The shipping label and the Shiprocket booking say collect cash, and the order screen button says "Cash collected". | `lib/fulfilment/service.ts` `syncStoreOrderFulfilment`; `components/orders/OrderDrawer.tsx` | Courier may collect again from a buyer who paid by UPI. |
| D7 | Confirm on the Orders screen drops `invoiceError`; only the Settings → Online store → Orders screen shows it. | `app/api/orders/[source]/[id]/route.ts` | Merchant is not told that the sale did not post. Found by reading code, not run. |

## Not tested

Storefront pages in a browser (catalogue, product, cart, OTP, checkout, account, wishlist, return), real Razorpay, Easebuzz and Shiprocket calls, the Shiprocket tracking webhook over HTTP, printing the packing slip and labels, refunds after D1, and the 26 failing tests in the existing suites until their fixtures grant a plan.
