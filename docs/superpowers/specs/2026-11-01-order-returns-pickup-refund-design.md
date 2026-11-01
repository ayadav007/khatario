# Order returns: courier pickup, refund to original payment, messages: design

Date: 2026-11-01
Status: written from the chat decisions, awaiting the owner's review
Source: the Shiprocket and returns audit of 1 Nov 2026 (`docs/project.log.md`), compared with Shopify self-serve returns and Shiprocket's return orders.

## 1. Goal

A customer's return should be as easy as Shopify in India: the customer asks from their store account, the shop approves with one click, Shiprocket collects the parcel from the customer's door, the shop checks what came back, and the money goes back to the UPI or card the customer paid with. The customer gets a WhatsApp message at every step.

What exists today and stays: return requests from the store account within the shop's return window, approve / reject / cancel, receive with restock or damaged per line, credit note, refund as store credit or cash / UPI / bank recorded in the books (`lib/returns/service.ts`, migration 380).

### Decisions taken with the user

| Topic | Decision |
|---|---|
| Scope | Return pickup, refund to original payment, customer messages, "not returnable" products, and five fixes. Exchanges and return / restocking fees are a second release. |
| When the pickup is booked | On approval. The shop chooses how the item comes back while approving; Shiprocket pickup is booked straight away when chosen ("as Shopify"). |
| Not returnable products | A per-product setting; such lines cannot be asked for online. |
| Return window | Stays per shop (exists: `business_settings.store_return_window_days`, default 7, 0 = off), counted from delivery; its clock fallback is fixed. |

### Assumptions (decided here, not by the user; correct any of them in review)

1. **Three ways back**, chosen at approval: *Courier pickup* (Shiprocket), *Customer sends or brings it*, *No need to send it back*. Courier pickup is the default when Shiprocket is connected, and hidden otherwise.
2. **Pickup only through Shiprocket.** The shop's own rider collecting returns is out of scope.
3. **Arrival does not receive the return.** When Shiprocket says the parcel reached the shop, the return shows "Arrived, check the items"; the shop still inspects and receives (restock or damaged), because only the shop knows the condition.
4. **Refund to original payment is the default** for store orders paid online (Razorpay or Easebuzz), and only for those. COD, direct UPI and manual orders keep store credit / cash / UPI / bank.
5. **Delivery fee is not refunded** automatically (the credit note covers the returned items; Shopify does the same). The shop can type a different refund amount, up to what can be refunded.
6. **No quality check at pickup in this release.** Shiprocket's QC needs a product photo URL and checks only one SKU per return; it is listed for later.
7. **The shop pays Shiprocket for the return** (Shiprocket bills the merchant's wallet). Charging the customer a return fee is the second release.
8. **Return shipments are told apart from forward parcels by their AWB and Shiprocket's `is_return` flag**, never by order number: return orders are sent to Shiprocket as `RET-0001` (the return number), which can never equal a store order number.

### Out of scope

Exchanges; return fees and restocking fees; QC at pickup; photos with the return request; return pickup by the shop's own rider; a written return policy page; returns on WhatsApp / manual orders started by the customer (the merchant can still start those).

## 2. The journey, end to end

**Customer, online store**

1. Order delivered. In *My orders*, the order shows *Return items* while the window is open.
2. The return screen lists the bill lines. Lines whose product is *not returnable* are shown greyed with "Can't be returned". The customer picks items, quantities and a reason, and sends the request.
3. Status on the order: *Return requested*. The shop gets an in-app notification.
4. The shop approves. The customer gets WhatsApp: approved, plus either *Pickup booked, AWB 1490…, track here*, or *Please send it to: shop address / instructions*, or *No need to send it back*.
5. Courier picks up; the order page shows the pickup progress and a Track link.
6. The shop receives and inspects. WhatsApp: *We received your return; credit note CN-0042 for ₹1,180*.
7. Refund: WhatsApp *₹1,180 refunded to your original payment; it reaches you in 5–7 working days* (or *kept as store credit*, or *paid by UPI / cash*). The order page shows *Refunded*.

Rejected requests get WhatsApp with the shop's reason.

**Merchant, web and phone (Orders → Returns, and the order's return card)**

1. New request arrives (notification). Open it: items, reason, customer.
2. **Approve** opens one small form: *How does it come back?* (Courier pickup / Customer sends it / No need to send it back), with the pickup address, phone and package weight prefilled. One click books the pickup.
3. While it travels the return shows the pickup status, AWB and Track, with *Book again* if booking failed and *Cancel pickup* until it is picked up.
4. *Arrived at shop* (from Shiprocket) or the shop's own judgement: **Receive**, mark each line restock or damaged, choose the refund (*Back to original payment* preselected for online-paid store orders), one click *Receive and refund*.
5. A pending gateway refund shows *Refund on its way* and closes itself when the gateway confirms.

## 3. Ways back (return method)

New `order_returns.return_method`: `courier_pickup` | `customer_sends` | `no_return` (null for courier RTO returns and old rows).

- **courier_pickup**: on approval the pickup is booked (section 4). A booking failure does not undo the approval: the return stays approved with the reason and *Book again*; the shop may switch the method to *customer_sends*.
- **customer_sends**: the shop's instructions are stored in `return_instructions` (prefilled with the branch's delivery address `store_branch_delivery.location_address`, else the business address) and sent to the customer.
- **no_return**: approval receives the return in the same transaction with every line `damaged` (nothing restocked), posts the credit note and moves to the refund step. Needs the same credit-note right as receiving.

Merchant-started returns (`StartReturnDialog`, they start approved) choose the method in the same dialog. Customer requests choose nothing; the shop chooses at approval.

## 4. Shiprocket return pickup

### Client (`lib/store/delivery/shiprocket.ts`)

New client functions beside the forward ones, same `call()`, login cache and `ShiprocketError` (new stages `return_create`, `return_awb`, `return_pickup`):

- `warehouseAddress()`: the primary pickup location's full address (`name`, `address`, `address_2`, `city`, `state`, `pin_code`, `phone`, `email`) from `/settings/company/pickup`, cached like `pickupLocation()`. This is where the parcel goes back to.
- `createReturnOrder(parcel)`: `POST /orders/create/return` with `order_id` (our ref), `order_date`, `pickup_customer_name` / `pickup_last_name` / `pickup_address` / `pickup_city` / `pickup_state` / `pickup_country` / `pickup_pincode` / `pickup_email` / `pickup_phone` (the customer), `shipping_customer_name` / `shipping_address` / `shipping_city` / `shipping_state` / `shipping_country` / `shipping_pincode` / `shipping_phone` / `shipping_email` (the warehouse), `order_items[]` (`name`, `sku`, `units`, `selling_price` per unit including GST, `return_reason`), `payment_method: "Prepaid"`, `sub_total`, `length`, `breadth`, `height`, `weight`. City and state come from the same postcode lookup and address parsing as forward booking. Returns `{ orderId, shipmentId }`.
- `assignReturnAwb(shipmentId)`: `POST /courier/assign/awb` with `is_return: 1`.
- `bookReturn(parcel, existing)`: create (unless a previous attempt did), assign AWB, request pickup (`/courier/generate/pickup`); same partial-failure contract as `book()`: ids from a failed attempt are returned so a retry never creates a second Shiprocket order.
- Cancel uses the existing `cancelOrders([carrierOrderId])`.

Field names follow Shiprocket's documented return-order body (via the `shiprocket` crate's `CreateReturnRequest` / `ReturnOrderItem`, since apidocs.shiprocket.in is not readable as text). The plan's first task checks them against one live call on the staging Shiprocket account.

### Booking (`lib/returns/pickup.ts`, new)

`bookReturnPickup(businessId, returnId, opts)`, the return-side twin of `bookFulfilmentWithShiprocket`:

- **Customer address**: the return's saved pickup address, else the original parcel's `ship_address` / `ship_pincode` / `buyer_phone`, else `loadShipTo`. Missing address, 6-digit PIN or 10-digit phone gives a clear error code (`NO_ADDRESS`, `NO_PINCODE`, `NO_PHONE`), as forward booking does.
- **Items**: the return lines, `selling_price = unit_price × (1 + tax_rate/100)`, SKU from the item, else `RET-0001-1`.
- **Package**: saved on the return at approval; prefilled from the original parcel's weight and size when the whole parcel comes back, else 0.5 kg and 10 × 10 × 10 cm.
- **Reference**: `RET-0001` on the first booking, `RET-0001-2`, `-3` after a cancel and re-book (`pickup_attempt`), so Shiprocket never sees a duplicate `order_id`.
- Saves `carrier_order_id`, `carrier_shipment_id`, `awb`, `courier_name`, `tracking_url`, `pickup_scheduled_at`, `pickup_status = 'booked'`, `pickup_error`, even on partial failure (same transaction pattern as forward booking).
- Store returns: nothing is written to `store_orders`; the return is the record.

`cancelReturnPickup(businessId, returnId)`: only while `pickup_status` is `booked`, `out_for_pickup` or `pickup_issue`; cancels in Shiprocket, clears the carrier ids and AWB, sets `pickup_status = 'cancelled'`, keeps `pickup_attempt` so the next booking gets a new reference. Rejecting or cancelling a return with a live pickup cancels the pickup first; once picked up, the return can no longer be rejected or cancelled (the goods are coming; receive them, with 0 or damaged if need be).

## 5. Return tracking (webhook)

`POST /api/webhooks/store/shiprocket` checks returns **first**:

1. Parse also `is_return`, `sr_order_id` and `qc_failure_reason` (new fields on `parseShiprocketWebhook`'s result).
2. Look up `order_returns` of the token's business by `awb`, else by `carrier_order_id = sr_order_id`. If found, apply the return update and stop. If `is_return = 1` and nothing matches, acknowledge and ignore (never fall through to forward orders).
3. Otherwise the existing forward handling runs.

Return status mapping (`parseShiprocketReturnStatus`, keyword based like the forward parser, tested with Shiprocket's labels):

| Shiprocket label contains | `pickup_status` | Effect |
|---|---|---|
| `cancel` | `cancelled` | pickup_error = `qc_failure_reason` when Shiprocket sends one |
| `delivered` (not `out for delivery`, not `undeliver`) | `arrived` | `arrived_at`; in-app notification "Return RET-0001 arrived" |
| `out for delivery`, `in transit`, `picked`, `shipped`, `reached` | `in_transit` | `picked_up_at` the first time |
| `out for pickup` | `out_for_pickup` | |
| `pickup exception`, `not picked`, `fail`, `undeliver` | `pickup_issue` | pickup_error = label |
| `pickup scheduled`, `pickup generated`, `awb assigned`, `new` | `booked` | |

Statuses only move forward (`booked → out_for_pickup → pickup_issue ↔ out_for_pickup → in_transit → arrived`; `cancelled` from any state before `in_transit`). Out-of-order events are acknowledged, not applied. Each applied change writes a `order_return_events` row (new table, section 10).

## 6. Refund to original payment

### Where the money goes

The refund goes back through the gateway the customer paid with, for the store order's captured payment (`store_orders.provider_payment_id`, `payment_provider`). The existing gateway calls are reused: `RazorpayPaymentProvider.refundCapturedPayment` and `EasebuzzPaymentProvider.refundPayment` (+ `fetchRefundStatus`), through the requesters in `lib/store/store-refund.ts` (exported for reuse).

The existing order-cancellation refund (`store_payment_refunds`, one full refund per order that reverses the receipt) is **not** used: a return refunds part of an order, can happen more than once per order, and the sale stays (the credit note reverses it).

### Flow (`lib/returns/gateway-refund.ts`, new)

1. **Claim** (own transaction, committed before calling the gateway): the return must be `received` with a credit note, on a store order paid online. Amount = the shop's amount or, by default, the most that can go back: the smaller of the credit note's refundable amount (`refundableOnCreditNote`) and the online payment left after earlier refunds (cancellation refunds plus pending or processed return refunds). Inserts a `return_gateway_refunds` row (`pending`, idempotency key = row id) or reuses the open one.
2. **Call the gateway** with the partial amount in paise and the idempotency key (Easebuzz: ask Refund Status for the key first, as today).
3. **Apply** (transaction):
   - `processed`: post the refund with `refundCreditNote` using the new mode `gateway`, `payment_account_id` = the settlement account of the order's receipt payment, reference = the gateway refund id. Mark the row processed, add to `order_returns.refunded_amount`, `refund_method = 'original_payment'`, close the return when fully refunded. Send the *refunded* message.
   - `pending`: save the gateway refund id; the return shows *Refund on its way*.
   - gateway error: row `failed` with the reason; the drawer shows it and offers *Try again* or another method.
4. **Confirmation of pending refunds**:
   - Razorpay webhook (`app/api/webhooks/store/razorpay`): for a verified `refund.*` notice, first look for a `return_gateway_refunds` row of that order by `provider_refund_id`, else a pending row of that order with no refund id and the same amount (the notice can arrive before step 3 commits). If found, apply it; otherwise the existing cancellation path runs. A partial-refund notice that matches nothing is acknowledged and logged instead of failing with `REFUND_AMOUNT_MISMATCH` (today it would make Razorpay retry for days).
   - New cron `/api/cron/return-refunds` (every 30 minutes): pending rows older than 10 minutes are checked with the gateway (Easebuzz `fetchRefundStatus`; Razorpay fetch refund by id, added to the provider if missing) and applied. The drawer has *Check now* for the same.

### Accounting

`Dr customer receivable / Cr the bank account the online payment settled in`, through the credit-note refund voucher. This brings the customer's credit back to zero for the refunded part, exactly like a cash or UPI refund today; the original receipt is not reversed. `store_orders.payment_status` stays `paid`, and becomes `refunded` only when gateway refunds reach the amount paid online.

## 7. Messages

Customer WhatsApp through the tenant event system (`lib/whatsapp/tenant-events.ts`): the shop's approved Meta template when chosen, else plain text over the QR session, like the order updates. New event keys and their default text:

| Key | When | Default text (variables) |
|---|---|---|
| `return_approved` | approved | "Your return {return_number} for order {order_number} is approved." + one of: "Pickup booked with {courier}, AWB {awb}. Track: {tracking_url}" / "Please send it to: {instructions}" / "No need to send it back." |
| `return_pickup_booked` | pickup booked later (Book again) | "Pickup for return {return_number} is booked with {courier}, AWB {awb}. Track: {tracking_url}" |
| `return_rejected` | rejected | "Sorry, your return {return_number} was not accepted: {reason}" |
| `return_received` | received | "We received your return {return_number}. Credit note {credit_note_number} for ₹{amount}." |
| `return_refunded` | refund settled | "{refund_note}" (e.g. "₹1,180 refunded to your original payment; it reaches you in 5–7 working days." / "₹1,180 kept as store credit for your next order." / "₹1,180 paid back by UPI.") |

New variables: `return_number`, `instructions`, `credit_note_number`; the rest exist (`order_number`, `courier`, `awb`, `tracking_url`, `amount`, `reason`, `refund_note`). Messages go only to customers with a phone on the bill; a failed send never fails the return action.

Merchant: an in-app notification (`notifications` table, `reference_type = 'order_return'`) for a new customer request and for *arrived at shop*.

## 8. Not returnable products

- New `items.store_returnable BOOLEAN NOT NULL DEFAULT true` (every existing product stays returnable).
- Web item form (`components/store/admin/ItemStorePageFields.tsx`): checkbox *Customers can return this online*. Phone item form (`item_form_screen.dart`, next to *Show in online store*): the same switch. Item APIs read and write it.
- Customer return API (`app/api/public/store/[subdomain]/orders/[id]/return`): GET marks such lines `returnable: false`; POST rejects them (`NOT_RETURNABLE`, "{item} can't be returned"); when nothing on the order can be returned, `can_return` is false with "Items on this order can't be returned".
- Product page: "This item can't be returned" under the price, from the public item API.
- The merchant can still return anything (a *Not returnable online* tag shows in `StartReturnDialog`).

## 9. Fixes

1. **RTO in progress is not "returned".** Only `RTO DELIVERED` maps to `returned`. Other RTO labels (`RTO INITIATED`, `RTO IN TRANSIT`, `RTO OFD`, `RTO NDR`) leave the store order and the parcel status as they are and add a delivery event "Coming back to the shop (RTO)", so the bill is not cancelled and no return opens while the parcel is still on the road.
2. **Webhook fallback match.** The parser returns our reference (`order_id`) and Shiprocket's id (`sr_order_id`) separately; the Orders-screen fallback matches `carrier_order_id = sr_order_id`, the store path keeps matching `order_number` on our reference.
3. **Checkout price = booked courier.** The quote uses the rate of Shiprocket's `recommended_courier_company_id` from the serviceability response (the courier `assign/awb` picks when no courier id is sent), falling back to the cheapest. Weight stays the 0.5 kg default at checkout (products have no weight field); the real weight is entered at packing.
4. **Return clock.** When the parcel has no `delivered_at`, the window starts at the parcel's first `delivered` event in `order_fulfilment_events`, and only then at the order's `updated_at`; later edits no longer restart it.
5. **Return shipments never touch forward orders** (section 5): return events are matched to returns first and are never applied to store orders or parcels.

## 10. Data (migration 460, tested only on `kh_phase2_test`)

`order_returns` new columns:

| Column | Type | Notes |
|---|---|---|
| `return_method` | varchar(16) | `courier_pickup` \| `customer_sends` \| `no_return`, null allowed |
| `return_instructions` | text | customer_sends |
| `pickup_address`, `pickup_pincode`, `pickup_phone` | text, varchar(6), varchar(15) | saved at approval |
| `pickup_weight_kg`, `pickup_length_cm`, `pickup_breadth_cm`, `pickup_height_cm` | numeric | |
| `pickup_status` | varchar(16) | `booked` \| `out_for_pickup` \| `pickup_issue` \| `in_transit` \| `arrived` \| `cancelled`, null = no pickup |
| `pickup_attempt` | smallint not null default 0 | reference suffix |
| `carrier_order_id`, `carrier_shipment_id`, `awb`, `courier_name`, `tracking_url` | varchar / text | |
| `pickup_scheduled_at`, `picked_up_at`, `arrived_at` | timestamptz | |
| `pickup_error` | text | last booking or courier problem |

Index `(business_id, awb) WHERE awb IS NOT NULL`, `(business_id, carrier_order_id) WHERE carrier_order_id IS NOT NULL`. `refund_method` check gains `original_payment`.

`credit_note_refunds.mode` check gains `gateway`.

New `return_gateway_refunds`: `id`, `business_id`, `order_return_id`, `store_order_id`, `credit_note_id`, `provider` (`razorpay` \| `easebuzz`), `provider_payment_id`, `provider_refund_id`, `idempotency_key` (unique per business), `amount` (> 0), `status` (`pending` \| `processed` \| `failed`), `failure_reason`, `credit_note_refund_id`, `created_by`, timestamps. Partial unique index: one `pending` row per return.

New `order_return_events`: `id`, `return_id`, `business_id`, `kind` (`requested`, `approved`, `rejected`, `pickup_booked`, `pickup_status`, `pickup_cancelled`, `received`, `refund_pending`, `refunded`, `refund_failed`, `cancelled`), `note`, `actor_type` (`customer` \| `staff` \| `webhook` \| `system`), `actor_user_id`, `created_at`. Used for the timeline on every screen.

`items.store_returnable BOOLEAN NOT NULL DEFAULT true`.

## 11. API

`PATCH /api/returns/:id` (existing route; `business_id` and user from the session as today):

| Action | Body | Notes |
|---|---|---|
| `approve` | `method`, `instructions?`, `pickup?: { address, pincode, phone, weight_kg, length_cm, breadth_cm, height_cm }` | books the pickup or receives (`no_return`) in the same request; booking failure returns 200 with `pickup_error` |
| `book_pickup` | `pickup?` | approved returns with `courier_pickup` and no live pickup |
| `cancel_pickup` | | before pickup |
| `set_method` | `method`, `instructions?` | approved returns without a live pickup |
| `settle` | `refund.method` gains `original_payment` | existing action |
| `check_refund` | | asks the gateway about a pending refund |

`POST /api/returns` (merchant start) accepts `method`, `instructions`, `pickup`. `GET` responses add the method, pickup fields, gateway refund state, `can_refund_original` with its maximum, and the event timeline.

Public store return route: line `returnable` flags; each listed return adds `method`, `instructions`, `pickup_status`, `awb`, `tracking_url`, refund state and the timeline.

New `GET /api/cron/return-refunds` (cron secret, like the existing crons).

## 12. Screens

**Web**
- `ReturnDrawer.tsx`: approve form (method radio, pickup address / phone / weight, instructions); pickup card (status, AWB, Track, Book again, Cancel pickup, error); *Arrived* badge; refund choices with *Back to original payment* (preselected when allowed, with the maximum shown), pending state with *Check now*; timeline from events.
- `StartReturnDialog.tsx`: method choice; *Not returnable online* tags.
- `ReturnsList.tsx` / `OrderReturnsSection.tsx`: pickup status and refund state chips.
- `ItemStorePageFields.tsx`: the returnable checkbox.
- Storefront `StoreOrderReturn.tsx`: greyed not-returnable lines; after the request, a timeline (Requested → Approved → Picked up → Received → Refunded) with Track and the refund note. Product page: the "can't be returned" line.

**Phone (Flutter)**
- `return_detail_screen.dart`: the same approve sheet, pickup card, refund choice and timeline.
- `order_detail_screen.dart` / `orders_screen.dart`: pickup and refund chips on the return card.
- `item_form_screen.dart`: the returnable switch.

## 13. Errors and edge cases

- Shiprocket not connected: *Courier pickup* hidden with "Connect Shiprocket to book pickups".
- Not serviceable, empty wallet, bad address: the Shiprocket message is shown on the return; *Book again* or switch method.
- Booking half done (order created, AWB failed): ids kept, the retry continues.
- Return rejected or cancelled with a live pickup: pickup cancelled first; if Shiprocket refuses, the action stops with its message.
- Pickup cancelled by Shiprocket or failed QC: `cancelled` with the reason; the shop can book again or switch method.
- Gateway refund larger than what is left online: capped; the rest can be paid by another method.
- Gateway refund pending for days: stays visible on the return and in the Returns list filter *Refund pending*.
- Two staff approving at once: the return row lock (`lockReturn`) serialises it; the second gets "already approved".
- Customer asks again while a request is open: refused (exists).

## 14. Testing

- **Unit**: return status mapping and RTO mapping with Shiprocket labels; `createReturnOrder` / `assignReturnAwb` request bodies with a fake fetch; reference numbering; refund amount cap.
- **DB (`kh_phase2_test` only)**: approve with courier pickup (fake client) including half-done retry and cancel → re-book with `-2`; webhook routes a return AWB to the return and never to the store order (including a return `DELIVERED`); `no_return` posts the credit note with nothing restocked; gateway refund with a fake requester: processed, pending then Razorpay notice, notice arriving before the refund id is saved, failure and retry, cap after an earlier refund; not-returnable lines refused; return clock fallback; tenant isolation (another business's AWB, return id or refund id never matches).
- **E2E (written, run on staging)**: customer requests → merchant approves with pickup → simulated webhook arrival → receive and refund to original payment.

## 15. Rollout

1. Apply migration 460 to staging before deploying the code.
2. Razorpay: the store webhook must include `refund.processed` and `refund.failed` events (check the dashboard setting per merchant; the cron covers it if not).
3. Shiprocket: no new webhook; return shipments post to the same tracking URL with `is_return = 1`. Confirm with one staging return.
4. Add `/api/cron/return-refunds` to `docs/SERVER_INFRASTRUCTURE.md` and the server crontab.
5. WhatsApp: the five events work with the default text over QR; shops on the Cloud API choose templates in WhatsApp settings.
