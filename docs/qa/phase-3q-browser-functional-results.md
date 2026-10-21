# Phase 3Q — staging browser workflows

Browser functional check on `https://staging.khatario.com`. Application code was not changed. `playwright.config.ts` was not changed. Its default `baseURL` is still local. This run set `PLAYWRIGHT_BASE_URL` and `PLAYWRIGHT_SKIP_WEBSERVER=1` only for the command below.

The recurring-date fix stays in `phase-3q-recurring-date-fix-results.md`.

## Command

```
PLAYWRIGHT_BASE_URL=https://staging.khatario.com PLAYWRIGHT_SKIP_WEBSERVER=1 npx playwright test e2e/phase3q-staging-browser.spec.ts --project=chromium --retries=0
```

Browser: Playwright Chromium, desktop viewport 1440×900. The spec refuses to continue unless the page host is `staging.khatario.com`.

Account: the existing Playwright primary-admin credentials. The signed-in business was **Shalini Traders**, Karnataka, plan Business Classic. That is the staging business used by the earlier GST browser checks. The documented QA Trial Traders phone is a different account and was not the one in the environment. Passwords and cookies were not printed.

## What the browser actually did

| Step | Status | Observed |
| --- | --- | --- |
| Sign in and open the dashboard | PASS, then BLOCKED | Several sign-ins reached `/dashboard` on `staging.khatario.com` as Shalini Traders. A later attempt stayed on `/login` with “Too many login attempts. Please try again later.” No further form was submitted after that. |
| Empty invoice | PASS | `/invoices/new`. Generate invoice stayed on that page and showed the error toast “Add items”. |
| New customer | PASS for the save that left `/customers/new` | A customer whose name starts with `P3QB` was saved with state Karnataka. The customer screen was not reopened field by field. |
| New service item | PASS for the item that reached an invoice | Item name `P3QB202610200040 Service`, selling price 100, tax rate 18. |
| Generate invoice | PASS for the values on the form | The line showed qty 1, rate 100, GST 18%, tax 18.00, line total 118.00. The form said Karnataka matches the place of supply, so CGST + SGST. Generate opened the share dialog for **INV-072**, status Final. Email and WhatsApp were disabled because that customer had no email or phone. Neither was sent. |
| Reopen the invoice and find it in the list | NOT TESTED | The script waited for a change of URL. The composer stays on `/invoices/new` and opens the share dialog, so that wait timed out before the list was opened. |
| Repeated generate | NOT TESTED | Generate was clicked once. |
| Purchase | BLOCKED | The purchase form was not opened. Login was rate-limited before this step ran. |
| Stock screens | NOT TESTED | |
| Purchase return and cancel | BLOCKED | The return form was not opened. The Phase 3P warehouse observation was not checked on staging. |
| Return warehouse | NOT TESTED | The return screen has no warehouse control in source. Staging did not show it because the page was not opened. |

The spec’s last exit was 1. That failure is the rate-limited login, not a wrong invoice total.

## Records left on staging

Cleanup did not run. Login was already refused, and cancelling or deleting from the database was not allowed.

Left in Shalini Traders:

- Invoice **INV-072** (final), line `P3QB202610200040 Service`, total 118.00. No payment was recorded and the share buttons were not used.
- Other customers and items whose names start with `P3QB`, from attempts that saved a party or item and then stopped. They were not deleted.

A later pass can cancel INV-072 from the invoice screen and remove only those `P3QB` parties and items, after login works again. The checklist below is that pass. No record id was stored. Do not invent one.

## Follow-up — test corrected, not re-run

Staging was not opened. No login was attempted. No form was submitted. The shared Playwright `baseURL` is still localhost. Staging runs use `playwright.staging.config.ts`, which sets `https://staging.khatario.com`, retries 0, and does not start a local server. The default Chromium project ignores `e2e/phase3q-staging-browser.spec.ts`.

The invoice workflow is not fully passed. Validation and creation of INV-072 remain the last executed results. The list and the side panel were not opened.

### Corrected UI behaviour

Generate stays on `/invoices/new`. The header line is the invoice number plus ` · Final`, from `DesktopInvoiceComposer`. The share dialog heading is “Share Invoice”. Its close control is the button beside that heading. “Send via Email” and “Send via WhatsApp” stay unclicked. The list is the sidebar link “All Invoices”. A row is a button with the invoice number. The detail is the side panel: an `h2` with the invoice number, a Final badge, the customer name, and “Grand Total”. The panel does not require `/invoices/[id]`.

The item picker does not select a row when its name is clicked. The row’s “Add” button selects one, then “Add 1 to bill” commits it.

### Login

The file signs in once and reuses that page. If the page shows “Too many login attempts. Please try again later.”, the rest of the file is skipped and Login is not clicked again. Playwright prints that skip. The QA status is BLOCKED.

A mutating run also requires `STAGING_TEST_BUSINESS` to equal the signed-in business, plus the existing Playwright phone and password. If any of those is missing, or the host is not `staging.khatario.com`, the file stops before a form submit.

```
STAGING_TEST_BUSINESS="<designated test business>" npx playwright test --config=playwright.staging.config.ts
```

Do not run that command while staging still shows the rate-limit message.

### Cleanup checklist

Confirm the open business is Shalini Traders before changing anything. Touch only the rows below. Do not use the database. Do not send email or WhatsApp. Do not record a payment.

| Record | How it was identified | Removal in the app | If removal is refused |
| --- | --- | --- | --- |
| Invoice INV-072, Final, total 118.00, line `P3QB202610200040 Service`, qty 1, rate 100, GST 18% | Shown on the new-invoice screen after Generate | Sales → All Invoices, search `INV-072`, open it, Cancel Invoice. Leave the share and payment buttons alone. | Leave INV-072 in place. |
| Item `P3QB202610200040 Service` | Same screen, the invoice line | Items, search `P3QB202610200040`, delete that item only. Cancel the invoice first if the item is still on it. | Leave the item. |
| Customer `P3QB202610200040 Customer` | Same run’s name prefix. The customer words were not on the retained snapshot. | Customers, search `P3QB202610200040`, delete that customer only. | Leave the customer. |
| Any other party or item whose name starts with `P3QB` | Later attempts saved a customer or item and then stopped. Those exact names were not kept after the failure snapshot was replaced. No id was captured. | Search `P3QB` on Customers and Items. Delete a row only when the whole name starts with `P3QB`. | Leave that row and write its name here. |

Purchases, suppliers, and purchase returns from this phase were not created.

## Still not tested

- Purchase create, purchase totals, and stock after that purchase.
- Purchase return, its cancel, supplier balance, and which warehouse loses stock.
- Invoice list, reopening INV-072 from the list, and a second click on Generate.
- Pages other than login, new customer, new item, and new invoice.
- Staff users, a cancelled subscription, and any payment, email, or WhatsApp send.
