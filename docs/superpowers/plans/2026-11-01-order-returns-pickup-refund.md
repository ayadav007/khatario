# Order returns release 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customer returns with Shiprocket pickup booked on approval, refund to the original Razorpay/Easebuzz payment, WhatsApp updates at every step, "not returnable" products, and five Shiprocket/return fixes.

**Architecture:** The existing return service (`lib/returns/service.ts`, migration 380) keeps the lifecycle. New focused modules sit beside it: `lib/returns/pickup.ts` (Shiprocket return booking and tracking), `lib/returns/gateway-refund.ts` (partial gateway refunds posted as credit-note refunds), `lib/returns/events.ts` (timeline), `lib/returns/notify.ts` (messages). The Shiprocket client gains return-order calls; the Shiprocket and Razorpay webhooks route return traffic first. Network calls happen outside DB transactions, with ids saved so retries never duplicate (the pattern of `bookFulfilmentWithShiprocket` and `refundStoreOrder`).

**Tech Stack:** Next.js route handlers, TypeScript, `pg`, Jest (unit + opt-in DB tests), Flutter (phone app).

**Spec:** `docs/superpowers/specs/2026-11-01-order-returns-pickup-refund-design.md`

## Global Constraints

- Migration `460_order_returns_pickup_refund.sql` is applied only to `kh_phase2_test` (twice, idempotent) and mirrored into `database/schema.sql`. Never staging or production.
- DB tests skip unless `PHASE2_TEST_DATABASE_URL` is set (copy the header of `tests/db/order-returns.db.test.ts`).
- `business_id` and the acting user come only from the session (`resolveHubAuth`) or from the verified webhook/cron context; never from the request body.
- Never print DB passwords, Shiprocket passwords or gateway secrets, including in test output and scripts.
- Return methods: `courier_pickup` | `customer_sends` | `no_return`. Pickup statuses: `booked` | `out_for_pickup` | `pickup_issue` | `in_transit` | `arrived` | `cancelled`. Refund method adds `original_payment`; credit-note refund mode adds `gateway`.
- Shiprocket return references: `RET-0001` on the first booking, `RET-0001-2`, `RET-0001-3` after a cancel and re-book.
- Money: `round2` for rupees, `Math.round(amount * 100)` for paise.
- Customer message texts are the spec's section 7 texts, word for word.
- Stage files by name; commit only when the owner has asked for commits in this run (`AGENTS.md`).
- Screens get website and phone (Flutter) versions; browser and device checks happen on staging after deploy (write the steps, do not run slow local browser checks).

## Review Focus

1. **Shiprocket webhook arrives before the return's AWB is saved** (booking still in flight): it must match the return by `sr_order_id`, never fall through to forward orders. Test in Task 6.
2. **Customer phone stored as `+91 98765 43210`, `919876543210` or with spaces**: the pickup phone sent to Shiprocket is the last 10 digits; fewer than 10 digits gives `NO_PHONE`. Test in Task 4.
3. **Refund amount typed as `"1180.555"`, `"0"`, negative or above the maximum**: rounded to paise, refused when ≤ 0 or above the max with the max in the message. Test in Task 7.
4. **Shiprocket disconnected between request and approval**: approval still succeeds, the return stays approved with `pickup_error` "Connect Shiprocket…", and *Book again* works once reconnected. Test in Task 5.
5. **The same Shiprocket or Razorpay notice delivered twice**: the second is `unchanged`, with exactly one event row and one refund voucher. Tests in Tasks 6 and 8.

---

### Task 1: Migration 460 and shared return types

**Files:**
- Create: `database/migrations/460_order_returns_pickup_refund.sql`
- Modify: `database/schema.sql` (mirror)
- Modify: `lib/returns/labels.ts`
- Create: `lib/returns/events.ts`
- Test: `tests/db/order-returns-460.db.test.ts`

**Interfaces:**
- Produces (`lib/returns/labels.ts`): `type ReturnMethod = 'courier_pickup' | 'customer_sends' | 'no_return'`; `type PickupStatus = 'booked' | 'out_for_pickup' | 'pickup_issue' | 'in_transit' | 'arrived' | 'cancelled'`; `ReturnRefundMethod` gains `'original_payment'`; `RETURN_METHOD_LABELS: Record<ReturnMethod, string>` = Courier pickup / Customer sends it / No need to send it back; `PICKUP_STATUS_LABELS: Record<PickupStatus, string>` = Pickup booked / Out for pickup / Pickup problem / On the way back / Arrived at shop / Pickup cancelled; `isReturnMethod(v: unknown): v is ReturnMethod`.
- Produces (`lib/returns/events.ts`): `type ReturnEventKind = 'requested' | 'approved' | 'rejected' | 'pickup_booked' | 'pickup_status' | 'pickup_cancelled' | 'received' | 'refund_pending' | 'refunded' | 'refund_failed' | 'cancelled'`; `recordReturnEvent(client: Pick<PoolClient, 'query'>, e: { businessId: string; returnId: string; kind: ReturnEventKind; note?: string | null; actorType: 'customer' | 'staff' | 'webhook' | 'system'; actorUserId?: string | null }): Promise<void>`; `listReturnEvents(client: Pick<PoolClient, 'query'>, businessId: string, returnId: string): Promise<Array<{ kind: ReturnEventKind; note: string | null; actor_type: string; created_at: string }>>` (oldest first).

- [ ] **Step 1: Write the migration** with exactly the spec's section 10: the `order_returns` columns (types and checks as listed; `pickup_status` check on the six values; `return_method` check on the three values, null allowed), the two partial indexes, `refund_method` check rebuilt to include `original_payment`, `credit_note_refunds.mode` check rebuilt to include `gateway`, `return_gateway_refunds` (status check `pending|processed|failed`, provider check `razorpay|easebuzz`, `amount > 0`, `UNIQUE (business_id, idempotency_key)`, partial unique index `ON (order_return_id) WHERE status = 'pending'`), `order_return_events` (kind and actor_type checks on the listed values, index `(return_id, created_at)`), `items.store_returnable BOOLEAN NOT NULL DEFAULT true`. Use `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, and `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` for rebuilt checks (look up the existing check names with `\d order_returns` / `\d credit_note_refunds` on the test DB first).
- [ ] **Step 2: Apply twice** to the test DB: `psql "$PHASE2_TEST_DATABASE_URL" -f database/migrations/460_order_returns_pickup_refund.sql` → second run prints no errors. Mirror the DDL into `database/schema.sql`.
- [ ] **Step 3: Write the failing test** `tests/db/order-returns-460.db.test.ts`:
  - `recordReturnEvent then listReturnEvents returns the events oldest first`: seed a return with `billedOrder` + `createReturn` (copy helpers from `tests/db/order-returns.db.test.ts`), record `requested` then `approved`, expect `kinds === ['requested', 'approved']`.
  - `listReturnEvents never returns another business's events`: same return id with business `A` → `[]`.
  - `order_returns rejects an unknown pickup_status`: `UPDATE … SET pickup_status = 'lost'` rejects with a check violation.
- [ ] **Step 4: Run** `npx jest tests/db/order-returns-460.db.test.ts --runInBand` (with `PHASE2_TEST_DATABASE_URL`) → FAIL (module missing).
- [ ] **Step 5: Implement** the label additions and `lib/returns/events.ts`.
- [ ] **Step 6: Run** the test → PASS; `npx tsc --noEmit` clean.
- [ ] **Step 7: Commit** `database/migrations/460_order_returns_pickup_refund.sql database/schema.sql lib/returns/labels.ts lib/returns/events.ts tests/db/order-returns-460.db.test.ts`: "Returns can record how the item comes back, its pickup, gateway refunds and a timeline; products can be marked not returnable (migration 460, test DB only)."

### Task 2: Shiprocket webhook parsing and forward fixes (RTO, fallback match)

**Files:**
- Modify: `lib/store/delivery/webhooks.ts`
- Create: `lib/returns/pickup-status.ts`
- Modify: `app/api/webhooks/store/shiprocket/route.ts`
- Modify: `lib/fulfilment/shiprocket-booking.ts` (`applyShiprocketFulfilmentUpdate`)
- Test: `tests/lib/store/commerce-webhooks.test.ts`, `tests/lib/returns/pickup-status.test.ts`, `tests/db/shiprocket-booking.db.test.ts`

**Interfaces:**
- Produces: `parseShiprocketWebhook(body)` result gains `srOrderId: string`, `isReturn: boolean` (`is_return` 1/"1"/true), `qcFailureReason: string | null`, `rtoInProgress: boolean`, `label: string` (trimmed lowercased status label). `orderRef` stays `order_id` only (no longer falls back to `sr_order_id`).
- Produces (`lib/returns/pickup-status.ts`): `parseShiprocketReturnStatus(label: string): PickupStatus | null` (spec section 5 table, checked in table order); `canMovePickupStatus(from: PickupStatus | null, to: PickupStatus): boolean` (rank booked 0, out_for_pickup 1, pickup_issue 1, in_transit 2, arrived 3; move allowed when rank rises, or between `out_for_pickup` and `pickup_issue`; `cancelled` allowed only from rank < 2; nothing leaves `arrived` or `cancelled`).
- Produces: `applyShiprocketFulfilmentUpdate(input)` takes `srOrderId: string` in place of matching `carrier_order_id` against `orderRef`.
- Produces (route helper, same file as `applyShiprocketFulfilmentUpdate`): `noteRtoInProgress(input: { businessId: string; awb: string; srOrderId: string; label: string }): Promise<boolean>` — adds an `order_fulfilment_events` row "Coming back to the shop (RTO)" with the parcel's current status, once per label, and changes nothing else.

- [ ] **Step 1: Write failing unit tests:**
  - `parseShiprocketWebhook({ current_status: 'RTO INITIATED', awb: 'A1' })` → `status === null`, `fulfilmentStatus === null`, `rtoInProgress === true`; same for `'RTO IN TRANSIT'`, `'RTO OFD'`, `'RTO NDR'`.
  - `'RTO DELIVERED'` → `fulfilmentStatus === 'returned'`, `status === 'cancelled'`, `rtoInProgress === false`.
  - `{ order_id: 'SO-12', sr_order_id: 987, is_return: 1, qc_failure_reason: 'Used product' }` → `orderRef 'SO-12'`, `srOrderId '987'`, `isReturn true`, `qcFailureReason 'Used product'`.
  - `parseShiprocketReturnStatus`: `'Out For Delivery '`→`in_transit`; `'DELIVERED'`→`arrived`; `'UNDELIVERED'`→`pickup_issue`; `'OUT FOR PICKUP'`→`out_for_pickup`; `'PICKUP EXCEPTION'`→`pickup_issue`; `'PICKED UP'`→`in_transit`; `'PICKUP SCHEDULED'`→`booked`; `'CANCELED'`→`cancelled`; `'LOST'`→`null`.
  - `canMovePickupStatus`: `(null,'booked')` true; `('in_transit','out_for_pickup')` false; `('pickup_issue','out_for_pickup')` true; `('in_transit','cancelled')` false; `('arrived','in_transit')` false.
- [ ] **Step 2: Write failing DB tests** in `tests/db/shiprocket-booking.db.test.ts`:
  - `RTO initiated keeps the store order and parcel as they are and notes it`: store order shipped with AWB; post the parsed RTO-initiated payload through the route handler (`POST` from `app/api/webhooks/store/shiprocket/route.ts` with the business's token) → store order status unchanged, no `order_returns` row, one event note "Coming back to the shop (RTO)"; posting it again adds no second note.
  - `the Orders-screen fallback matches Shiprocket's order id`: non-store parcel with `carrier_order_id = '555'` and no AWB match; payload `{ order_id: 'SO-x', sr_order_id: 555, current_status: 'DELIVERED' }` → parcel delivered.
- [ ] **Step 3: Run** `npx jest tests/lib/store/commerce-webhooks.test.ts tests/lib/returns/pickup-status.test.ts` and the DB file → FAIL.
- [ ] **Step 4: Implement** the parser fields; RTO labels other than `rto delivered` return `rtoInProgress: true` and null statuses; `pickup-status.ts`; `noteRtoInProgress`; the route calls `noteRtoInProgress` when `rtoInProgress` and returns `{ ok: true, outcome: 'rto_noted' }`; the fallback passes `srOrderId`.
- [ ] **Step 5: Run** the three test files → PASS; existing `tests/db/order-fulfilment.db.test.ts` still passes.
- [ ] **Step 6: Commit** (the five files above): "A parcel that starts coming back (RTO) no longer cancels the order or opens a return until it reaches the shop, and courier updates for Orders-screen parcels match Shiprocket's order id."

### Task 3: Checkout quote uses Shiprocket's recommended courier

**Files:**
- Modify: `lib/store/delivery/shiprocket.ts` (`serviceability`)
- Test: `tests/lib/store/shiprocket-client.test.ts`

**Interfaces:**
- Consumes/Produces: `createShiprocketProvider(creds).quote(input)` unchanged signature; picks the company whose `courier_company_id` equals `data.recommended_courier_company_id`, else the cheapest.

- [ ] **Step 1: Failing test** `quote charges the recommended courier's rate`: mocked `/courier/serviceability/` returns `{ data: { recommended_courier_company_id: 24, available_courier_companies: [{ courier_company_id: 10, rate: 60, etd: 'Nov 5' }, { courier_company_id: 24, rate: 85, etd: 'Nov 4' }] } }` → `{ serviceable: true, charge: 85, etaText: 'Nov 4' }`. Second test: no recommended id → `charge: 60`.
- [ ] **Step 2: Run** `npx jest tests/lib/store/shiprocket-client.test.ts` → FAIL.
- [ ] **Step 3: Implement** in `serviceability`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**: "The delivery charge at checkout is the rate of the courier Shiprocket will actually book."

### Task 4: Shiprocket return-order client

**Files:**
- Modify: `lib/store/delivery/shiprocket.ts`
- Test: `tests/lib/store/shiprocket-client.test.ts`
- Create: `scripts/check-shiprocket-return.mjs` (owner-run field check)

**Interfaces:**
- Produces:
  - `interface ShiprocketWarehouse { name: string; address: string; address2: string; city: string; state: string; pincode: string; phone: string; email: string }`
  - `interface ShiprocketReturnParcel { ref: string; customerName: string; customerPhone: string; customerEmail?: string | null; address: string; pincode: string; city?: string | null; state?: string | null; items: Array<{ name: string; sku?: string; units: number; price: number; reason?: string }>; subTotal: number; weightKg: number; lengthCm?: number; breadthCm?: number; heightCm?: number }`
  - `ShiprocketStage` gains `'return_create' | 'return_awb'`.
  - Client methods: `warehouseAddress(): Promise<ShiprocketWarehouse>` (primary pickup location from `/settings/company/pickup`, cached 1 h with `pickupLocation`); `createReturnOrder(p: ShiprocketReturnParcel): Promise<{ orderId: string; shipmentId: string }>`; `assignReturnAwb(shipmentId: string): Promise<{ awb: string; courierName: string }>`; `bookReturn(p: ShiprocketReturnParcel, existing?: { orderId?: string | null; shipmentId?: string | null }): Promise<ShiprocketBooking>` (same contract as `book`: ids from a failed step are returned; pickup failure is a warning).
  - Exported helper `tenDigitPhone(raw: string): string | null` (digits only, last 10, null when fewer than 10); forward `createOrder` switches to it.

- [ ] **Step 1: Failing tests** (`mockFetch` pattern in the file):
  - `createReturnOrder sends the customer as pickup and the warehouse as shipping`: routes for `/auth/login`, `/settings/company/pickup` (primary location `{ pickup_location: 'Main', address: 'Shop 4, MG Road', address_2: '', city: 'Pune', state: 'Maharashtra', pin_code: 411001, phone: '9822000000', name: 'Sharma Fresh', email: 'shop@x.in', is_primary_location: 1 }`), `/orders/create/return` → `{ order_id: 77, shipment_id: 88 }`. Assert the body: `order_id 'RET-0001'`, `pickup_customer_name 'Asha'`, `pickup_last_name 'Rao'`, `pickup_pincode '411038'`, `pickup_phone '9876543210'`, `pickup_country 'India'`, `shipping_customer_name 'Sharma Fresh'`, `shipping_pincode '411001'`, `shipping_city 'Pune'`, `payment_method 'Prepaid'`, `order_items[0]` `{ name: 'Kurta', units: 1, selling_price: 531, return_reason: 'Damaged' }`, `weight 0.5`, `length 10`. Result `{ orderId: '77', shipmentId: '88' }`.
  - `assignReturnAwb sends is_return 1`: body `{ shipment_id: 88, is_return: 1 }`; response `{ awb_assign_status: 1, response: { data: { awb_code: 'R123', courier_name: 'Delhivery' } } }` → `{ awb: 'R123', courierName: 'Delhivery' }`.
  - `bookReturn keeps Shiprocket's ids when the AWB step fails`: AWB route returns `{ awb_assign_status: 0, message: 'Wallet balance low' }` → `{ ok: false, stage: 'return_awb', orderId: '77', shipmentId: '88', error: 'Wallet balance low' }`; calling again with those ids does not call `/orders/create/return`.
  - `tenDigitPhone`: `'+91 98765 43210'`→`'9876543210'`; `'919876543210'`→`'9876543210'`; `'98765'`→`null`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Field names exactly as the spec section 4 list; city/state via the existing postcode lookup then `cityStateFromAddress`; `selling_price` is the per-unit price passed in (callers include GST).
- [ ] **Step 4: Run** → PASS (whole file, forward tests included).
- [ ] **Step 5: Write `scripts/check-shiprocket-return.mjs`**: reads `SHIPROCKET_EMAIL` / `SHIPROCKET_PASSWORD` from the environment (never prints them), creates a return order `RET-CHECK-<timestamp>` for a dummy item from the account's own pickup address back to itself, prints Shiprocket's response status and `order_id`/`shipment_id` (or its error message), then cancels it with `/orders/cancel`. Owner runs it once against the staging Shiprocket account; if field names are rejected, fix them here before Task 5.
- [ ] **Step 6: Commit**: "Shiprocket client can create a return order, assign its AWB and request pickup, keeping ids so a retry never makes a second order."

### Task 5: Return pickup booking and the ways back

**Files:**
- Create: `lib/returns/pickup.ts`
- Modify: `lib/returns/service.ts`
- Test: `tests/db/order-return-pickup.db.test.ts` (new), `tests/db/order-returns.db.test.ts`

**Interfaces:**
- Consumes: Task 1 types and `recordReturnEvent`; Task 4 `bookReturn`, `cancelOrders`, `tenDigitPhone`; `loadShiprocketCreds`, `createShiprocketClient`.
- Produces (`lib/returns/pickup.ts`):
  - `type PickupDetails = { address?: string | null; pincode?: string | null; phone?: string | null; weightKg?: number | null; lengthCm?: number | null; breadthCm?: number | null; heightCm?: number | null }`
  - `savePickupDetails(client: PoolClient, p: { businessId: string; returnId: string; details?: PickupDetails | null }): Promise<void>` — fills blanks from the original parcel (`ship_address`, `ship_pincode`, `buyer_phone`, and weight/size only when every line of the bill is in this return), else `loadShipTo`, else 0.5 kg / 10 cm.
  - `type ReturnPickupResult = { ok: true; awb: string; courierName: string; trackingUrl: string; pickupScheduledAt: string | null; warning?: string } | { ok: false; code: 'NOT_CONFIGURED' | 'NOT_FOUND' | 'NOT_APPROVED' | 'NO_ADDRESS' | 'NO_PINCODE' | 'NO_PHONE' | 'BOOKING_FAILED'; error: string }`
  - `bookReturnPickup(businessId: string, returnId: string, opts?: { client?: ShiprocketClient; actorUserId?: string | null }): Promise<ReturnPickupResult>` — own connection; requires `status = 'approved'`, `return_method = 'courier_pickup'` and no live pickup; ref `return_number` when `pickup_attempt = 0`, else `${return_number}-${pickup_attempt + 1}`; item price `unit_price × (1 + tax_rate / 100)` rounded to paise; saves ids/AWB/`pickup_status 'booked'`/`pickup_error` like `bookFulfilmentWithShiprocket`; records `pickup_booked`; failures save `pickup_error` (NOT_CONFIGURED text: "Connect Shiprocket first: Settings → Online store → Delivery, add the Shiprocket API user.").
  - `hasLivePickup(row: { pickup_status: PickupStatus | null; carrier_order_id: string | null }): boolean` — `carrier_order_id` set and status `booked | out_for_pickup | pickup_issue`.
  - `cancelReturnPickup(businessId: string, returnId: string, opts?: { client?: ShiprocketClient; actorUserId?: string | null }): Promise<{ ok: true } | { ok: false; status: number; error: string }>` — only with a live pickup; on success clears carrier ids/AWB/tracking, `pickup_status 'cancelled'`, `pickup_attempt + 1`, records `pickup_cancelled`.
- Produces (`lib/returns/service.ts`):
  - `approveReturn(client, p: { businessId: string; returnId: string; userId?: string | null; method?: ReturnMethod | null; instructions?: string | null; pickup?: PickupDetails | null }): Promise<{ method: ReturnMethod | null; needsPickup: boolean; received?: ReceiveReturnResult }>` — `courier_pickup` saves pickup details and returns `needsPickup: true` (caller books after commit); `customer_sends` stores `instructions` or `defaultReturnInstructions`; `no_return` runs `receiveReturn` in the same transaction with every line `damaged` (needs `userId`).
  - `defaultReturnInstructions(client, businessId: string, returnId: string): Promise<string>` — `store_branch_delivery.location_address` of the return's branch, else `businesses.address`, as "Please send it to: {address}".
  - `setReturnMethod(client, p: { businessId: string; returnId: string; method: ReturnMethod; instructions?: string | null; pickup?: PickupDetails | null; userId?: string | null }): Promise<{ needsPickup: boolean; received?: ReceiveReturnResult }>` — approved returns without a live pickup only (`409 PICKUP_LIVE`).
  - `rejectReturn` / `cancelReturn` refuse with `409 PICKED_UP` "The parcel is already on its way back; receive it instead" when `pickup_status` is `in_transit` or `arrived`, and `409 PICKUP_LIVE` when a live pickup exists (the route cancels it first).
  - `createReturn` input gains `method?`, `instructions?`, `pickup?` (merchant-started returns apply them as approval does, booking after commit); every create/approve/reject/cancel/receive records its event.
  - `settleReturn` with `method: 'original_payment'` throws `409 USE_GATEWAY_REFUND` (Task 7 owns that path).

- [ ] **Step 1: Failing DB tests** (`order-return-pickup.db.test.ts`, fake client like `fakeClient` in `shiprocket-booking.db.test.ts` with `bookReturn` and `cancelOrders`):
  - `approving with courier pickup books it with the parcel's address and the return number`: `bookReturn` receives `ref 'RET-…'`, `pincode` of the parcel, `customerPhone` 10 digits, item price `118` for unit 100 + 18 %; row has `awb`, `pickup_status 'booked'`, events `['requested','approved','pickup_booked']`.
  - `a failed AWB step keeps Shiprocket's ids and Book again continues`: first result `{ ok: false, stage: 'return_awb', orderId: '77', shipmentId: '88', error: 'Wallet balance low' }` → `pickup_error 'Wallet balance low'`, status still approved; second call passes `existing { orderId: '77', shipmentId: '88' }`.
  - `cancel then re-book uses RET-xxxx-2`.
  - `Shiprocket not connected leaves the return approved with a reason` (Review Focus 4): no creds → `{ ok: false, code: 'NOT_CONFIGURED' }`, `pickup_error` starts with "Connect Shiprocket"; after inserting creds and passing a fake client, booking succeeds.
  - `a phone with fewer than 10 digits is refused` (Review Focus 2): parcel phone `'98765'` → `NO_PHONE`.
  - `another business cannot book or cancel this return's pickup`: business `A` → `NOT_FOUND` / 404.
- [ ] **Step 2: Failing DB tests** in `order-returns.db.test.ts`:
  - `customer sends it stores the shop address as instructions`.
  - `no need to send it back credits the bill without restocking`: stock unchanged, return `received` with a credit note, every line `condition 'damaged'`.
  - `a picked-up return cannot be rejected or cancelled`: set `pickup_status 'in_transit'` → `PICKED_UP`.
- [ ] **Step 3: Run** both files → FAIL.
- [ ] **Step 4: Implement** `pickup.ts` and the service changes.
- [ ] **Step 5: Run** both files plus `tests/db/order-returns-460.db.test.ts` → PASS.
- [ ] **Step 6: Commit**: "Approving a return chooses how it comes back: Shiprocket pickup is booked from the customer's address, the customer can be told where to send it, or the shop can credit it without taking it back."

### Task 6: Return tracking from the Shiprocket webhook

**Files:**
- Modify: `lib/returns/pickup.ts`
- Modify: `app/api/webhooks/store/shiprocket/route.ts`
- Test: `tests/db/order-return-pickup.db.test.ts`

**Interfaces:**
- Consumes: Task 2 parser fields and `parseShiprocketReturnStatus` / `canMovePickupStatus`; Task 10's `notifyMerchantReturn` is called here once Task 10 lands (until then leave the call out; Task 10 adds it).
- Produces: `applyShiprocketReturnUpdate(input: { businessId: string; awb: string; srOrderId: string; label: string; qcFailureReason: string | null }): Promise<{ outcome: 'not_found' | 'unchanged' | 'updated'; returnId?: string; to?: PickupStatus }>` — matches the business's `order_returns` by `awb`, else `carrier_order_id = srOrderId`, row-locked; sets `picked_up_at` on the first `in_transit`, `arrived_at` on `arrived`, `pickup_error` from `qcFailureReason` or the label for `pickup_issue`/`cancelled`; records `pickup_status` with the label as note.
- Route order: returns first (`applyShiprocketReturnUpdate`); `not_found` with `isReturn` → `{ ok: true, ignored: true }`; otherwise the forward handling (including Task 2's RTO branch).

- [ ] **Step 1: Failing DB tests:**
  - `a return's DELIVERED marks the return arrived and never touches the store order`: forward store order delivered with AWB `F1`; return booked with AWB `R1`; route POST `{ awb: 'R1', is_return: 1, current_status: 'DELIVERED' }` → return `arrived`, store order still `delivered`, its parcel unchanged.
  - `an event that arrives before the AWB is saved matches by Shiprocket's order id` (Review Focus 1): return with `carrier_order_id '77'`, no AWB; payload `{ sr_order_id: 77, is_return: 1, current_status: 'PICKUP SCHEDULED' }` → `updated`.
  - `the same event twice changes nothing the second time` (Review Focus 5): second POST → `unchanged`, one `pickup_status` event.
  - `an out-of-order event is acknowledged, not applied`: `in_transit` then `OUT FOR PICKUP` → still `in_transit`, HTTP 200.
  - `a QC failure cancels the pickup with the reason`: `{ current_status: 'CANCELED', qc_failure_reason: 'Used product' }` → `cancelled`, `pickup_error 'Used product'`.
  - `an unknown return AWB with is_return is ignored, not applied to forward orders`.
  - `another business's token never matches this return`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS, with `tests/db/shiprocket-booking.db.test.ts` and `tests/db/order-fulfilment.db.test.ts` still green.
- [ ] **Step 5: Commit**: "Shiprocket updates for return parcels move the return's pickup status and never change the original order."

### Task 7: Refund to the original payment

**Files:**
- Create: `lib/returns/gateway-refund.ts`
- Modify: `lib/store/store-refund.ts` (export the requesters)
- Modify: `lib/payments/providers/razorpay-payment-provider.ts`
- Modify: `lib/credit-notes/refund.ts`
- Modify: `lib/returns/service.ts`
- Test: `tests/db/order-return-refund.db.test.ts` (new), `tests/lib/payments/razorpay-refund-fetch.test.ts` (new)

**Interfaces:**
- Produces:
  - `store-refund.ts` exports `razorpayRefundRequester(businessId: string)` and `easebuzzRefundRequester(businessId: string)` (existing bodies, now exported).
  - `RazorpayPaymentProvider.fetchRefund(params: { providerPaymentId: string; providerRefundId: string }): Promise<{ status: 'processed' | 'pending' | 'failed' }>` — `GET /v1/payments/{pid}/refunds/{rid}`.
  - `refund.ts`: `RefundMode` adds `'gateway'`; `gateway` requires `paymentAccountId` (`400 ACCOUNT_REQUIRED`); `isRefundMode` stays cash/upi/bank only (staff cannot pick `gateway` by hand); voucher narration "Refund on {CN} (GATEWAY)".
  - `gateway-refund.ts`:
    - `type GatewayRequester = (args: { providerPaymentId: string; amountPaise: number; idempotencyKey: string }) => Promise<{ providerRefundId: string; status: 'processed' | 'pending' }>`
    - `originalRefundRoom(client: Pick<PoolClient, 'query'>, businessId: string, returnId: string): Promise<{ allowed: boolean; max: number; provider: 'razorpay' | 'easebuzz' | null; reason: string | null }>` — allowed only for a `received` return on a store order with `provider_payment_id` and `receipt_payment_id`; `max = min(refundableOnCreditNote, grand_total paid online − store_payment_refunds amount (non-failed) − return_gateway_refunds amount (pending|processed) for the order)`, `round2`.
    - `refundReturnToOriginalPayment(input: { businessId: string; returnId: string; userId: string; amount?: number | string | null; requestRefund?: GatewayRequester }): Promise<{ status: 'processed' | 'pending' | 'failed'; amount: number; providerRefundId: string | null; error?: string }>` — claim in its own committed transaction (reuse an open `pending` row with its key), call the gateway outside any transaction, then `applyReturnGatewayRefundResult`; gateway exceptions mark the row `failed` with the message.
    - `applyReturnGatewayRefundResult(input: { businessId: string; refundRowId: string; providerRefundId: string | null; providerStatus: 'processed' | 'pending' | 'failed'; failureReason?: string | null; actor: 'staff' | 'webhook' | 'system'; actorUserId?: string | null }): Promise<'pending' | 'processed' | 'failed'>` — idempotent: a `processed` row returns `'processed'` without posting again. Processed posts `refundCreditNote(mode 'gateway', paymentAccountId = payments.settlement_account_id of the order's receipt payment, else the first bank account, reference = gateway refund id, orderReturnId)`, links `credit_note_refund_id`, adds to `refunded_amount`, sets `refund_method 'original_payment'`, closes when fully refunded, sets `store_orders.payment_status 'refunded'` when gateway refunds reach the amount paid online; records `refunded` / `refund_pending` / `refund_failed`.
    - `matchReturnRefundNotice(input: { businessId: string; storeOrderId: string; providerRefundId: string; amountInr: number | null }): Promise<string | null>` — by `provider_refund_id`, else the order's `pending` row with null `provider_refund_id` and equal paise amount.
    - `checkPendingReturnRefunds(opts?: { olderThanMinutes?: number; fetchStatus?: (row: { business_id: string; provider: 'razorpay' | 'easebuzz'; provider_payment_id: string; provider_refund_id: string | null; idempotency_key: string }) => Promise<'processed' | 'pending' | 'failed' | null> }): Promise<{ checked: number; processed: number; failed: number }>` — default 10 minutes; Razorpay via `fetchRefund`, Easebuzz via `fetchRefundStatus(paymentId, idempotencyKey)`.
  - `service.ts` `settleReturn`: unchanged for other methods.

- [ ] **Step 1: Failing unit test** `fetchRefund maps Razorpay statuses`: mocked fetch returns `{ status: 'processed' }` → `processed`; `{ status: 'failed' }` → `failed`; anything else → `pending`; the URL is `/v1/payments/pay_1/refunds/rfnd_1`.
- [ ] **Step 2: Failing DB tests** (paid order via `billedOrder(qty, true)` from `order-returns.db.test.ts`, received return, fake `requestRefund`):
  - `a processed refund posts a gateway voucher to the payment's settlement account and closes the return`: voucher lines balance; credit account = the receipt payment's `settlement_account_id`; return `closed`, `refund_method 'original_payment'`; customer balance back to the pre-return value.
  - `a pending refund waits, and the matching notice completes it once`: `{ status: 'pending' }` → return `received`, row `pending`; `applyReturnGatewayRefundResult(processed)` twice → one `credit_note_refunds` row (Review Focus 5).
  - `the refund is capped by what is left online`: earlier processed return refund of 118 on a 236 order → `originalRefundRoom.max` = credit note refundable capped at 118.
  - `bad amounts are refused` (Review Focus 3): `'0'` and `-5` → `ReturnError 400 INVALID_AMOUNT`; `'1180.555'` on a large enough refund → paise `118056`; above max → `400 EXCEEDS_MAX` with "Only ₹{max} can go back to the original payment".
  - `a gateway error marks the attempt failed and a retry makes a new attempt`: requester throws `Razorpay refund failed: 400` → `failed` with that message; retry inserts a second row and succeeds.
  - `COD and manual orders cannot refund to the original payment`: `allowed false`, reason "This order was not paid online".
  - `another business cannot refund this return`.
  - `checkPendingReturnRefunds applies a processed status from the gateway`: fake `fetchStatus` → `processed`; row processed, return closed.
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement.** **Step 5: Run** both files and `tests/db/order-returns.db.test.ts` → PASS.
- [ ] **Step 6: Commit**: "A received return on an order paid online can be refunded to the customer's original UPI or card, in part or in full, posted against the credit note."

### Task 8: Gateway notices and the pending-refund cron

**Files:**
- Modify: `app/api/webhooks/store/razorpay/route.ts`
- Modify: `lib/store/store-refund.ts` (`confirmStoreRefundFromProvider` / `openWebhookRefund`)
- Create: `app/api/cron/return-refunds/route.ts`
- Modify: `docs/SERVER_INFRASTRUCTURE.md`
- Test: `tests/db/order-return-refund.db.test.ts`

**Interfaces:**
- Consumes: Task 7 `matchReturnRefundNotice`, `applyReturnGatewayRefundResult`, `checkPendingReturnRefunds`.
- Produces: the Razorpay route, for a verified `refund.*` notice, calls `matchReturnRefundNotice({ businessId: order.business_id, storeOrderId: order.id, providerRefundId, amountInr })` first and applies (`refund.processed` → processed, `refund.failed` → failed, else pending); only when nothing matches does it run `confirmStoreRefundFromProvider`. `openWebhookRefund` returns `null` (acknowledged, logged `[store refund] unmatched partial refund`) instead of throwing `REFUND_AMOUNT_MISMATCH` when the amount differs from `grand_total`.
- Produces: `GET`/`POST /api/cron/return-refunds` guarded by `assertCronAuthorized`, returns `{ checked, processed, failed }`.

- [ ] **Step 1: Failing DB tests:**
  - `a Razorpay refund.processed notice completes the matching return refund`: call the route `POST` with a signed body (reuse the signing helper from the existing razorpay webhook tests if present, else build the HMAC with the test config secret) → row processed, return closed.
  - `a notice that arrives before the refund id is saved matches by amount`.
  - `the same notice twice posts once`.
  - `an unmatched partial refund notice is acknowledged with 200, not retried`.
  - `the cron rejects calls without the cron secret`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** Add the cron line (every 30 minutes) to `docs/SERVER_INFRASTRUCTURE.md` next to `stuck-parcels`. **Step 4: Run** → PASS; existing store refund tests (`tests/db/phase3-6b-store-payment.db.test.ts`, `tests/db/easebuzz-store-payment.db.test.ts`) still pass.
- [ ] **Step 5: Commit**: "Razorpay refund notices complete return refunds, a partial notice no longer fails the webhook, and a cron confirms refunds still pending."

### Task 9: Not returnable products and the return clock

**Files:**
- Modify: `lib/returns/service.ts` (`returnableLines`)
- Modify: `lib/returns/store-eligibility.ts`
- Modify: `app/api/public/store/[subdomain]/orders/[id]/return/route.ts`
- Modify: `app/api/items/route.ts`, `app/api/items/[id]/route.ts`, `app/api/public/store/[subdomain]/items/[id]/route.ts`, `lib/store/map-store-product.ts`
- Test: `tests/db/order-returns.db.test.ts`

**Interfaces:**
- Produces: `ReturnableLine` gains `store_returnable: boolean` (LEFT JOIN `items`, true when the line has no item); item APIs read/write `store_returnable` (boolean, added to the extras list beside `store_badge`); public item JSON gains `returnable: boolean`; public return GET lines gain `returnable`, and POST refuses `400 NOT_RETURNABLE` "{item} can't be returned"; when every line with quantity left is not returnable, GET says `can_return: false`, `reason: "Items on this order can't be returned"`.
- Eligibility: delivered time = `COALESCE(f.delivered_at, (SELECT MIN(e.created_at) FROM order_fulfilment_events e WHERE e.fulfilment_id = f.id AND e.status = 'delivered'), so.updated_at)`.

- [ ] **Step 1: Failing DB tests:**
  - `a not-returnable product is shown but cannot be asked for`: item `store_returnable false` → GET line `returnable false`; POST with it → 400 `NOT_RETURNABLE`; merchant `createReturn` with it still works.
  - `an edit after delivery does not restart the return window`: parcel `delivered_at` null, delivered event 10 days ago, window 7, then `UPDATE store_orders SET updated_at = NOW()` → GET `can_return false`, reason "Returns are accepted within 7 days of delivery".
  - `the item API saves store_returnable` (PATCH `/api/items/:id` with `{ store_returnable: false }` → column false).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit**: "Products can be marked not returnable for online returns, and the return window no longer restarts when the order is edited after delivery."

### Task 10: Customer messages and merchant notifications

**Files:**
- Modify: `lib/whatsapp/tenant-events.ts`, `lib/push/customer-push.ts`
- Create: `lib/returns/notify.ts`
- Modify: `lib/returns/pickup.ts` (arrived → merchant notification)
- Test: `tests/lib/returns/notify.test.ts`, `tests/db/order-return-pickup.db.test.ts`

**Interfaces:**
- Produces:
  - Event keys `return_approved`, `return_pickup_booked`, `return_rejected`, `return_received`, `return_refunded` in `TENANT_WA_EVENT_KEYS`, registered with `deliveryEvent(...)` and suggested template bodies that match the spec texts with `{{n}}` variables; new fields `return_number` (sample `RET-0012`), `instructions` (sample `Please send it to: Shop 4, MG Road, Pune`), `credit_note_number` (sample `CN-0042`).
  - `CUSTOMER_PUSH_EVENTS` entries for the five keys: titles Return approved / Return pickup booked / Return not accepted / Return received / Refund sent, `href: '/account'`.
  - `type ReturnNoticeKind = 'approved' | 'pickup_booked' | 'rejected' | 'received' | 'refunded'`
  - `buildReturnMessage(kind: ReturnNoticeKind, v: { returnNumber: string; orderNumber: string; method: ReturnMethod | null; courier?: string | null; awb?: string | null; trackingUrl?: string | null; instructions?: string | null; reason?: string | null; creditNoteNumber?: string | null; amount?: number | null; refundMethod?: ReturnRefundMethod | null }): string` — spec section 7 texts; refund notes: original_payment "₹{amount} refunded to your original payment; it reaches you in 5–7 working days.", store_credit "₹{amount} kept as store credit for your next order.", cash/upi/bank "₹{amount} paid back by {Cash|UPI|bank transfer}."; amounts formatted `en-IN`, up to 2 decimals.
  - `notifyReturnCustomer(businessId: string, returnId: string, kind: ReturnNoticeKind): Promise<void>` — loads the return, order number (store order, sales order or invoice number), customer phone (`customers.phone`, else `store_orders.customer_phone`), sends through `notifyBusinessEvent({ eventKey: 'return_' + kind, ... })`; never throws; no phone → no send.
  - `notifyMerchantReturn(businessId: string, returnId: string, kind: 'requested' | 'arrived'): Promise<void>` — inserts into `notifications` (`type 'order_return'`, `reference_type 'order_return'`, `reference_id` = return id, titles "New return request" / "Return arrived at shop", message "{RET} for order {order}").

- [ ] **Step 1: Failing unit tests** for `buildReturnMessage`: approved + courier_pickup with Delhivery / R123 / link → exactly "Your return RET-0012 for order SO-1042 is approved. Pickup booked with Delhivery, AWB R123. Track: https://t/1"; approved + customer_sends; approved + no_return → "... is approved. No need to send it back."; rejected with reason; received "We received your return RET-0012. Credit note CN-0042 for ₹1,180."; refunded × original_payment / store_credit / upi.
- [ ] **Step 2: Failing DB test** `arrival notifies the shop once`: Task 6 arrival → one `notifications` row; repeated event → still one.
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement.** **Step 5: Run** → PASS; `tests/lib/whatsapp` (if present) still passes.
- [ ] **Step 6: Commit**: "Customers get a WhatsApp message when a return is approved, its pickup is booked, it is declined, received and refunded; the shop is told about new requests and arrivals."

### Task 11: Return API actions

**Files:**
- Modify: `app/api/returns/[id]/route.ts`, `app/api/returns/route.ts`
- Modify: `app/api/public/store/[subdomain]/orders/[id]/return/route.ts`
- Modify: `lib/returns/service.ts` (`getReturn` row shape, `listReturns` filter)
- Modify: `lib/returns/gateway-refund.ts` (send the *refunded* message when a webhook or cron completes a refund)
- Test: `tests/db/order-returns-api.db.test.ts` (new)

**Interfaces:**
- Consumes: Tasks 5, 7, 9, 10.
- Produces (`PATCH /api/returns/:id`, existing auth; `receive`, `settle`, `approve` with `no_return` need `credit_notes:create`):
  - `approve` `{ method?, instructions?, pickup? }` — method defaults to `courier_pickup` when Shiprocket creds exist, else `customer_sends`; transaction → commit → `bookReturnPickup` when `needsPickup`; response `{ ok: true, pickup?: ReturnPickupResult }`; then `notifyReturnCustomer('approved')` (after booking, so the message carries the AWB).
  - `book_pickup` `{ pickup? }` → save details, book; on success `notifyReturnCustomer('pickup_booked')`.
  - `cancel_pickup` → `cancelReturnPickup`.
  - `set_method` `{ method, instructions?, pickup? }`.
  - `reject` / `cancel` → cancel a live pickup first (stop with its error when Shiprocket refuses), then the existing action; `reject` notifies `rejected`.
  - `receive` → existing, then `notifyReturnCustomer('received')`; when `refund.method === 'original_payment'` the receive commits first, then `refundReturnToOriginalPayment`.
  - `settle` with `original_payment` → `refundReturnToOriginalPayment`; other methods existing; on closed → `notifyReturnCustomer('refunded')` (gateway: only once processed; Task 7's apply calls it for webhook/cron completions too — add that call there).
  - `check_refund` → `checkPendingReturnRefunds` for this return's pending row.
  - Body parsing: `method` via `isReturnMethod`; `pickup` numbers via `Number`, finite and > 0 or null; `pickup.pincode` 6 digits else 400 "Enter a 6-digit PIN code".
- `GET /api/returns/:id` adds `method`, `instructions`, the pickup fields (saved, else the `savePickupDetails` prefill), `shiprocket_connected: boolean`, `default_instructions: string`, `original_refund: { allowed, max, reason }`, `gateway_refund: { status, amount, error } | null`, `events`.
- `GET /api/returns?status=refund_pending` lists returns with a `pending` gateway refund (new value for `listReturns`' `status`).
- `POST /api/returns` accepts `method`, `instructions`, `pickup`; books after commit as approve does.
- Public return route: each return in `returns` adds `method`, `instructions`, `pickup_status`, `awb`, `tracking_url`, `refund_method`, `gateway_refund_status`, and `events` (kinds `requested`, `approved`, `pickup_booked`, `pickup_status`, `received`, `refunded`, `rejected`, `cancelled` only); POST notifies the merchant (`notifyMerchantReturn('requested')`).

- [ ] **Step 1: Failing route tests** (call the handlers with a session the way existing route DB tests do, e.g. `tests/db/order-fulfilment.db.test.ts`; fake Shiprocket client and gateway requester injected through the module mocks `jest.mock('@/lib/store/delivery/shiprocket', …)` / `jest.mock('@/lib/store/store-refund', …)`):
  - `approve without a method books a pickup when Shiprocket is connected`.
  - `approve for another business's return is 404`.
  - `reject with a live pickup cancels it in Shiprocket first`.
  - `settle original_payment refunds through the gateway and reports pending`.
  - `a pincode that is not 6 digits is refused`.
  - `the customer's return list shows the pickup tracking and hides staff-only events`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit**: "Return actions for approving with a way back, booking or cancelling the pickup, changing the way back and refunding to the original payment; customers see pickup tracking and refund status."

### Task 12: Website screens

**Files:**
- Modify: `components/orders/returns/ReturnDrawer.tsx`, `components/orders/returns/StartReturnDialog.tsx`, `components/orders/returns/ReturnsList.tsx`, `components/orders/returns/OrderReturnsSection.tsx`, `components/orders/returns/ReturnStatusBadge.tsx`
- Create: `components/orders/returns/ReturnPickupCard.tsx`, `components/orders/returns/ReturnTimeline.tsx`
- Modify: `components/store/admin/ItemStorePageFields.tsx`, `app/(app)/items/new/page.tsx` (and the item edit page that renders `ItemStorePageFields`)
- Modify: `components/store/StoreOrderReturn.tsx` and the storefront product page component that renders the price block (find it from `app/api/public/store/[subdomain]/items/[id]` consumers)

**Interfaces:**
- Consumes: Task 11 JSON shapes; `RETURN_METHOD_LABELS`, `PICKUP_STATUS_LABELS`.
- Produces: `ReturnPickupCard({ ret, onAction })` — status label, AWB, Track link (`tracking_url`, new tab), `pickup_error` in the error style, buttons *Book again* (`book_pickup`), *Cancel pickup* (`cancel_pickup`, only with a live pickup), *Customer will send it instead* (`set_method customer_sends`); `ReturnTimeline({ events })` — kind labels + time, oldest first.

- [ ] **Step 1: ReturnDrawer approve form**: replaces the plain Approve button for `requested` returns: radio of the three methods (Courier pickup hidden with "Connect Shiprocket to book pickups" when `shiprocket_connected` is false), pickup address / PIN / phone / weight (kg) prefilled from the GET, instructions textarea for *Customer sends it* prefilled from `default_instructions`. One button "Approve".
- [ ] **Step 2: ReturnDrawer travel and refund**: `ReturnPickupCard` while approved; "Arrived at shop, check the items" badge when `pickup_status === 'arrived'`; refund choices gain *Back to original payment* (first and preselected when `original_refund.allowed`, with "Up to ₹{max}"), pending state "Refund on its way" with *Check now* (`check_refund`), failed state with the error and the other methods; `ReturnTimeline` at the bottom.
- [ ] **Step 3: StartReturnDialog**: method choice (same component as the approve form, extract `ReturnMethodFields` inside the returns folder) and a "Not returnable online" tag on lines with `store_returnable === false`.
- [ ] **Step 4: Lists**: `ReturnsList` / `OrderReturnsSection` chips for pickup status and "Refund pending", plus a *Refund pending* filter in `ReturnsList` (`status=refund_pending`); `ReturnStatusBadge` unchanged.
- [ ] **Step 5: Item form**: checkbox "Customers can return this online" (default checked) in `ItemStorePageFields`, saved as `store_returnable`.
- [ ] **Step 6: Storefront**: `StoreOrderReturn` greys lines with `returnable === false` ("Can't be returned") and, for existing returns, shows the timeline steps Requested → Approved → Picked up → Received → Refunded with Track and the refund note; product page shows "This item can't be returned" under the price when `returnable === false`.
- [ ] **Step 7: Verify**: `npx tsc --noEmit` clean; `npx next lint --dir components/orders/returns --dir components/store` no new errors; `npx next build` passes.
- [ ] **Step 8: Commit** (files above by name): "Website: approve a return with how it comes back, follow and manage its pickup, refund to the original payment, see its timeline; products can be marked not returnable; shoppers see pickup and refund progress."

### Task 13: Phone app screens

**Files:**
- Modify: `phone/lib/screens/orders/return_detail_screen.dart`, `phone/lib/screens/orders/order_detail_screen.dart`, `phone/lib/screens/orders/orders_screen.dart`
- Modify: `phone/lib/screens/items/item_form_screen.dart`, `phone/lib/screens/items/item_form_logic.dart`

**Interfaces:**
- Consumes: Task 11 JSON (same as the website).
- Produces: the approve bottom sheet (three methods, pickup fields, instructions), pickup card (status, AWB, Track via `url_launcher`, Book again / Cancel pickup / Customer will send it instead), *Back to original payment* refund option with pending/failed states and *Check now*, timeline list; return chips on order cards; item form switch "Customers can return this online" next to "Show in online store" (`store_returnable` in `item_form_logic.dart` payload, default true).

- [ ] **Step 1: Implement** the return detail changes (the start-return sheet at the top of `return_detail_screen.dart` gets the method choice too).
- [ ] **Step 2: Implement** the order list/detail chips and the item form switch.
- [ ] **Step 3: Verify**: `C:\Users\Abhishek\flutter\bin\flutter.bat analyze` in `phone/` → no new issues; `C:\Users\Abhishek\flutter\bin\flutter.bat test` → existing tests pass (update goldens only if a golden covers these screens and the change is intended).
- [ ] **Step 4: Commit**: "Phone app: approve returns with how they come back, follow the pickup, refund to the original payment, and mark products not returnable."

### Task 14: Staging checklist, docs and full run

**Files:**
- Create: `docs/superpowers/plans/2026-11-01-order-returns-staging-checklist.md`
- Create: `tests/e2e/store-returns.spec.ts` (written, run on staging)
- Modify: `docs/plan/ORDERS_FULFILMENT_GAPS.md`, `knowledge/how-to/online-store.md`, `docs/roadmap.md`, `docs/project.log.md`

- [ ] **Step 1: Staging checklist**: apply migration 460 before the code; run `scripts/check-shiprocket-return.mjs` if not done; enable `refund.processed` / `refund.failed` on the store Razorpay webhook; add the `return-refunds` cron; then the journey: customer requests (with one not-returnable line), approve with pickup (AWB shows, WhatsApp received), Shiprocket test status updates arrive on the return, receive with one damaged line, refund to original payment (Razorpay test mode), refund confirmed by webhook, customer page timeline; also *Customer sends it*, *No need to send it back*, RTO initiated on a forward parcel, Book again after a failure; phone app on the same return.
- [ ] **Step 2: E2E spec** for the customer → merchant → refund journey on `https://staging.khatario.com` using the E2E store keys in `.env` (Playwright, written not run).
- [ ] **Step 3: Docs**: a "Returns release 1" note in `ORDERS_FULFILMENT_GAPS.md`; the how-to gets the shop-side steps in plain words; roadmap card updated; project log entry.
- [ ] **Step 4: Full run**: `npx jest tests/lib/store tests/lib/returns tests/lib/payments tests/db/order-returns.db.test.ts tests/db/order-returns-460.db.test.ts tests/db/order-return-pickup.db.test.ts tests/db/order-return-refund.db.test.ts tests/db/order-returns-api.db.test.ts tests/db/shiprocket-booking.db.test.ts tests/db/order-fulfilment.db.test.ts tests/db/phase3-6b-store-payment.db.test.ts tests/db/easebuzz-store-payment.db.test.ts --runInBand` with `PHASE2_TEST_DATABASE_URL` → all pass (paste the summary line); `npx tsc --noEmit` clean; `npx next build` passes.
- [ ] **Step 5: Commit** the docs, checklist and e2e spec: "Returns release 1: staging checklist, e2e journey and docs."
