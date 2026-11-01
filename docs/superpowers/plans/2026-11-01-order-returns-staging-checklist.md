# Order returns release 1: staging test checklist

What to do on `https://staging.khatario.com` once Order returns release 1 is deployed there. **Nothing in this list has ever been checked in a browser or on a phone**: the feature was built without local browser checks (owner's rule: write the steps, test on staging). Migration 460 has only ever run on the disposable DB `kh_phase2_test`.

Built and committed on `main`, not pushed. Spec: `docs/superpowers/specs/2026-11-01-order-returns-pickup-refund-design.md`. Plan: `docs/superpowers/plans/2026-11-01-order-returns-pickup-refund.md`. Written, not run: `e2e/store-returns.spec.ts` (journey in section C).

Use the E2E store on staging (staging E2E keys in `.env`: `E2E_TEST_PHONE`, `E2E_TEST_PASSWORD`), with Shiprocket connected, Razorpay in **test mode**, and a customer phone you can receive WhatsApp on. Never use production.

## A. Before and while deploying (owner steps, in this order)

1. - [ ] **Apply migration `database/migrations/460_order_returns_pickup_refund.sql` to staging BEFORE the code is deployed.** The owner runs migrations; agents never do. It is idempotent (safe to run twice). Check that no other session has taken the number 460.
   - If the code ships first, return screens and the customer return API fail on the missing columns and tables until 460 runs. Running 460 first is safe: the old code does not read it.
2. - [ ] **Check Shiprocket's return field names.** From the repo root, with the owner's Shiprocket API login in the environment (set `SHIPROCKET_EMAIL` and `SHIPROCKET_PASSWORD`; never paste them into chat or a file):
   `node scripts/check-shiprocket-return.mjs`
   It creates a dummy return order `RET-CHECK-<timestamp>` from the account's primary pickup address back to itself, prints Shiprocket's answer, then cancels it. If Shiprocket rejects a field name, the fix is in `createReturnOrder` in `lib/store/delivery/shiprocket.ts` (the script says which). Do this before the journey: every pickup booking depends on it.
3. - [ ] **Cron line.** Add the `/api/cron/return-refunds` line to the staging crontab (every 30 minutes). The exact line is already in `docs/SERVER_INFRASTRUCTURE.md` (staging block). It needs `CRON_SECRET` in the clone's `.env.production`. The endpoint does not exist until step 4, so do not expect a good answer from it yet.
4. - [ ] **Deploy the code to staging** (see `docs/SERVER_INFRASTRUCTURE.md`). Production is **not** part of this checklist.
5. - [ ] **Razorpay webhook, per store, after the deploy.** In each store's Razorpay dashboard, open the webhook that points at the store webhook and tick **`refund.processed`** and **`refund.failed`** (the existing payment events stay ticked). Why after the deploy: the old handler already treats every `refund.*` notice as a confirmation of the whole-order cancellation refund and answers 500 (so Razorpay keeps retrying) when the amount does not match one. No return refund can exist before the deploy, so ticking earlier is harmless, but the new handler is what routes a partial return refund correctly. Without the two events the cron (below) still confirms refunds, only every 30 minutes.
6. - [ ] **Cron check.** After the first run following the deploy, `/var/log/khatario-cron-staging.log` shows a 200 with no error.
7. - [ ] Shiprocket tracking: no new webhook. Return shipments post to the same tracking URL with `is_return = 1`. The journey below confirms it with one real staging return.

## B. Set-up checks

- [ ] **Not returnable product.** Inventory > Items: open a product with *Show in online store* on, open *Store page*, untick **Customers can return this online**, save, reopen: it stays unticked. On the storefront product page "This item can't be returned" shows under the price (classic theme and a Studio engine theme). A brand-new item has the box ticked.
- [ ] The Settings > Online Store *return window* (days) is at least 1 for the test store.
- [ ] Shiprocket connected: the approve form offers *Courier pickup*. In a second shop with Shiprocket **not** connected: only *Customer sends it* and *No need to send it back*, plus a "Connect Shiprocket" link.

## C. The journey (web, then phone)

Use one delivered, online-paid (Razorpay test) store order with at least three lines, one of them the not-returnable product.

1. **Customer asks.** Storefront > My orders: the order shows *Return items*. The not-returnable line is greyed "Can't be returned". Pick the other lines, a reason, send. The order shows *Return requested*. The shop gets a notification; tapping it opens Orders > Returns with that return open (web) / the return screen (phone).
2. **Approve with pickup.** Web Orders > Returns > the return > the form shows *Courier pickup* selected, with the customer's address, PIN, phone and weight filled in. Press **Approve**. The return shows **Pickup booked**, an AWB and a *Track* link. The customer gets a WhatsApp "approved ... Pickup booked with <courier>, AWB ...". The Shiprocket dashboard shows an order named `RET-0001` (the return number).
3. **Tracking arrives.** Shiprocket test statuses reach the return (or post them by hand to `/api/webhooks/store/shiprocket` with the shop's `x-api-key` and `is_return: 1`): *Out for pickup* -> *Picked up / in transit* -> *Delivered*. The pickup card follows each step and the timeline gets a line each. At *Delivered* the drawer banner says "Arrived at shop, check the items" and the shop gets an "arrived" notification. The **store order itself is untouched** (still delivered, not cancelled, no extra parcel event).
4. **Customer storefront timeline.** Requested -> Approved -> Picked up -> Received progress, with the Track link.
5. **Receive with a damaged line.** In the drawer, mark one line *Damaged* and the others *Restock* (and one with a lower received quantity if you like). The refund picker lists **Back to original payment** first, with "Up to ₹<max>". Press **Receive & post credit note**. WhatsApp "We received your return ... Credit note ... for ₹...". Restocked lines add to stock, the damaged one does not.
6. **Refund to original payment** (Razorpay test mode). Confirm: *Refund on its way (₹...)* shows if Razorpay answers pending; *Check now* confirms it. When Razorpay sends `refund.processed` (or after the cron) the return closes, the drawer says "Refunded ₹... to the original payment", the credit note is paid, and the customer gets WhatsApp "refunded to your original payment; it reaches you in 5–7 working days". Customer page: *Refunded* ticked. In Razorpay's dashboard the refund is the partial amount, once.
7. **Refund failure and retry.** On a second return, make the refund fail (for example refund more than Razorpay allows from a test payment already refunded): the drawer shows the error and offers *Try again* and the other methods (cash / UPI / bank / store credit).
8. **Cap.** On an order with an earlier refund, the *Up to ₹max* shrinks by what already went back.
9. **COD order.** A cash-on-delivery order's return has no *Back to original payment*.

## D. The other ways back and the fixes

1. **Customer sends it.** New request > approve choosing *Customer sends it*: the instructions are prefilled with the shop's address, edit them, approve. Customer WhatsApp carries "Please send it to: ...". No pickup card. Receive and refund as above.
2. **No need to send it back.** New request > approve choosing *No need to send it back*: the return goes straight to *received* with every line damaged, nothing restocked, the credit note is posted and the refund step shows. WhatsApp says "No need to send it back".
3. **Book again after a failure.** Approve a pickup on an order whose customer PIN is wrong (or 000000): the return is still approved, the card shows a red pickup error with the address, PIN, phone and weight open for editing. A 5-digit PIN keeps *Book again* disabled with a message. Fix the PIN, press **Book again**: the new details are used and the pickup books (`RET-0001`, or `RET-0001-2` if a Shiprocket order was already made). *Customer will send it instead* switches the method.
4. **Cancel and re-book.** While *Booked* / *Out for pickup*, press **Cancel pickup**: status *Cancelled*, then **Book again** books `RET-0001-2`. Reject or Cancel return while a booking is running shows the "pickup busy" message; with a live pickup, rejecting cancels the pickup first. After pickup (*in transit*) the return can no longer be rejected or cancelled.
5. **RTO on a forward parcel.** Post (or let Shiprocket send) *RTO INITIATED* / *RTO IN TRANSIT* for an ordinary forward parcel: the store order is **not** cancelled and no return opens; the parcel timeline says "Coming back to the shop (RTO)". Only *RTO DELIVERED* returns it as before.
6. **Return events never reach forward orders.** A return's *Delivered* event does not mark the store order delivered again.
7. **Return window.** An order past the shop's return window (or with the window set to 0) shows no *Return items*; a parcel with no delivered date counts from its first *delivered* event, not from a later edit.
8. **Merchant-started return.** Orders > an order > Start return: method choice works, the not-returnable line carries a *Not returnable online* tag but can still be returned.
9. **Returns list.** Pickup chips on rows, a *Refund pending* chip and filter with a count; the same chips on the order detail's returns card.
10. **Another shop.** A second business's Shiprocket token never matches this shop's returns (404 / ignored).

## E. Phone app (same return)

The shop owner's app is the Flutter app in `phone/` (the Capacitor app installed with `npm run cap:android:staging:install` is the customer app). Use a Flutter build pointed at staging.

1. Customer request arrives as a notification; tapping it opens the return screen.
2. Approve sheet: *Courier pickup* selected with address / PIN / phone / weight; type in a field, open and close the keyboard: what you picked and typed stays. Approve books the pickup; the card shows *Pickup booked*, AWB, *Track* opens the courier page.
3. No PIN on the order: *Customer sends it* is preselected with the instructions filled in. Shiprocket not connected: only two ways plus "Connect Shiprocket to book pickups".
4. Bad PIN: error shown, details open; fix it, **Book again**; *Customer will send it instead* switches.
5. **Cancel pickup** works while booked; the button for sending instead is hidden once picked up; Reject / Cancel during a booking shows the pickup-busy text.
6. Receive on an online-paid order: *Back to original payment* first and selected with "Up to ₹max"; *Receive & refund*; pending shows *Refund on its way* + *Check now*; a failed refund shows the error and the other methods.
7. Returns tab: pickup and *Refund pending* chips, the *Refund pending* filter.
8. Start return from an order: method choice works, not-returnable lines tagged.
9. Item form: **Customers can return this online** switch next to *Show in online store*, default on; switch off, save, reopen: stays off; the storefront shows the item as not returnable.

## Notes for the tester

- Always on staging, never production. Use Razorpay **test** mode; no real money moves.
- Return numbers look like `RET-0001`; the Shiprocket order for the first booking carries exactly that name.
- Delivery fee is not refunded automatically; the shop may type a lower amount, never a higher one than shown.
- Easebuzz-paid orders refund through Easebuzz and are confirmed by the cron (no webhook); check one if a store uses it.
- If a step fails, note the return number, the step, and the red message shown.
