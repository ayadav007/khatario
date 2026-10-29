# Supplier Hub end-to-end results (2026-10-28)

Request: "test end to end my supplier hub feature": list the features and flows, check them as a retailer (including whether the WhatsApp message is sent), then as a wholesaler.

Two runs. **Staging API** (`https://staging.khatario.com`, deployed commit `198f1498`, the same as local `main`): every hub flow was executed through the real HTTP API with each QA persona's own login. **Local browser** (`http://localhost:3015`, dev server on `kh_phase2_test`): the screens were opened and used in the built-in browser as the wholesaler and as the retailer. Staging screens were not opened in a browser (the QA passwords are not typed into staging from here).

Statuses mean only what ran: PASS, FAIL, NOT TESTED, BLOCKED.

## Features and flows inventoried

From `docs/SUPPLIER_HUB_BUILD_PLAN.md`, the routes under `app/api/suppliers/hub/*`, `app/api/supply-orders/*`, `app/api/purchases/incoming-bills/*`, the pages under `app/(app)/suppliers/hub/*`, `app/(app)/supply-orders/*`, `app/(app)/purchases/incoming/*`, `app/(app)/settings/suppliers-directory`, and the notice code in `lib/supplier-hub-whatsapp.ts`.

| # | Flow | Who | Where |
| --- | --- | --- | --- |
| 1 | Directory listing: visibility hidden / link only / directory, profile summary, categories, slug, logo and cover, GST-verified badge | Wholesaler | Settings → Suppliers directory; `discovery` |
| 2 | Published listings (max 20 public), price display hidden / from ₹ / on request, MOQ, multiples, pack, lead time, sizes/colours, photo; collections (publish → New arrivals notice) | Wholesaler | My catalog; `published-listings`, `collections` |
| 3 | Find suppliers: search by name, place, GSTIN, product; filters has catalogue, shows prices, GST verified, district; sort; profile page with catalogue and "How it works" | Retailer | Find suppliers; `directory`, `profile/[businessId]` |
| 4 | Connection request (message, share low stock, optional first catalogue order that waits as `awaiting_link`), duplicate handling, cancel by buyer, accept with customer link/create or decline by supplier, in-app and WhatsApp notices both ways | Both | `connection-requests` |
| 5 | Orders: buyer from catalogue (MOQ enforced) or own items; supplier draft → send (proposed) → buyer confirm; buyer pending → supplier respond full / partial (backorder order) / decline; cancel; dispatch only after billing; messages on the order; statuses and inbox | Both | Orders; `supply-orders`, `comments` |
| 6 | Bill from order: invoice draft with confirmed quantities and agreed prices; `supply_order_id` on the invoice marks the order billed; dispatch note | Wholesaler | Create bill; `invoice-draft`, `POST /api/invoices` |
| 7 | Incoming bills: list (only bills after the link), receive screen with remembered matches and suggestions, create own item from a line, short/damaged quantities, shortfall mode keep / auto_return (debit note at once), duplicate protection | Retailer | Purchases → Incoming bills; `incoming-bills`, `convert-to-purchase` |
| 8 | Money notices: buyer payment → supplier records the receipt; buyer debit note → supplier is asked for a credit note | Wholesaler | Hub inbox; `money-notices` |
| 9 | Low stock: buyer shares stock and sets a default supplier; supplier dashboard; suggested draft per buyer (no duplicates); hourly cron | Both | Supplier Dashboard; `suggest`, `cron/check-low-stock` |
| 10 | Buyer prices per connected buyer (used on orders, catalogue, bills) | Wholesaler | `buyer-prices`, `/suppliers/hub/buyer-prices/[customerId]` |
| 11 | Standing orders: propose, accept, pause, resume, end; daily cron turns them into confirmed orders | Both | `supply-orders/standing`, `cron/standing-orders` |
| 12 | Order link for a supplier not on Khatario: private `/so/<token>` page, WhatsApp text, claim by the supplier once they sign up | Retailer | `invite-orders`, `invite-orders/claim` |
| 13 | Mute a supplier's launch notices; new arrivals still listed | Retailer | `mute`, `new-arrivals` |
| 14 | WhatsApp updates: every hub notice is queued in `supplier_hub_whatsapp_outbox`, flushed 3 s later through the platform Meta template `supplier_hub_update`; per-business switch; cron sweep | Both | `lib/supplier-hub-whatsapp.ts`, `cron/supplier-hub-whatsapp` |
| 15 | Permissions and isolation: staff roles (purchases/invoices/settings update), other businesses cannot read or write hub records | Both | all routes |
| 16 | Platform: admin switch `supplier_hub_visible`, listing review | Admin | `/api/admin/supplier-hub-*` |

Not covered by any run: platform admin listing review (16), the phone app, the hourly and daily crons themselves (they are not scheduled on staging, see F-013), the public `/so/<token>` form being submitted by a supplier without an account, logo and cover uploads, listing photos and size/colour options, the area report, catalogue ordering from the New arrivals page in the browser, and the buyer-prices page in the browser.

## WhatsApp: is the message sent?

**No Supplier Hub WhatsApp message has ever been sent on staging.** The code works up to the send: every hub event in this run wrote one outbox row within a second and the flush ran, but each row was skipped.

Evidence (staging database, `supplier_hub_whatsapp_outbox`, read over SSH):

| What | Result |
| --- | --- |
| Rows queued by this run (17:54–17:59 UTC) | 28 rows, one per event: request, first order, accepted, confirmed, wrote on the order, billed, dispatched, suggested order, declined, cancelled, standing order (4), joined via order link, debit note |
| Skip reasons | 27 × `NO_APPROVED_TEMPLATE`, 1 × `TURNED_OFF` (the accept notice to Retailer A while its switch was off, ST H05) |
| Whole table | 42 rows, 0 sent, since the feature exists |
| `platform_whatsapp_templates` row `khatario_supplier_hub_update` (event `supplier_hub_update`) | status **draft**, never submitted to Meta (`/api/admin/whatsapp-templates` as platform admin agrees) |
| Meta Cloud credentials (`/api/admin/whatsapp-credentials`) | `ready: true` (WABA, phone number id, token, app secret, verify token all set) |
| `platform_whatsapp_sends` for `supplier_hub_update` | 0 rows |

So: the per-business switch works (TURNED_OFF), the queue and flush work, and the message cannot go out until the platform admin submits the `khatario_supplier_hub_update` template in `/admin` → WhatsApp templates and Meta approves it. Even then the QA personas' numbers are in `QA_TEST_PHONES`, so a send to them is dropped on purpose (`[qa-test-phone]` log line); a business with a real owner phone is needed to see a message arrive.

## Staging API scenarios

Scripts: `tmp-qa/staging-hub-e2e.mjs` (H01–H27), `tmp-qa/staging-hub-e2e-2.mjs` (P01–P07), `tmp-qa/staging-hub-e2e-3.mjs` (P01r–P06r). Results: `tmp-qa/staging-hub-e2e*-results.json`. Personas: Retailer A `QA Retailer Andheri` (Maharashtra, fresh, never connected), Wholesaler `QA Wholesale Bhiwandi` (Maharashtra), Retailer B `QA Retailer Bengaluru`, read-only staff `9000011014` at the wholesaler. Run 1 started 17:54:11 UTC, run 2 17:58:17 UTC.

Totals (corrected 2026-10-29 from the saved result files): **136 checks recorded, 119 PASS, 17 FAIL**. Of the 17 FAIL, 1 is an application defect (H13d, F-011) and 16 were wrong expectations in the harness, re-checked in run 2 or 3 where noted below. F-012 came from the browser pass, not from these checks. Two PASS rows are observations with no real assertion (H19b, P01s). Steps H16 (read-only staff answer a backorder) and H18 (buyer payment → supplier money notice → record receipt) did not run in run 1, because it did not keep the purchase or backorder id. An earlier version of this file wrongly listed H18 as PASS. **H18 was then run on its own as run 4 (`tmp-qa/staging-hub-h18.mjs`): 12 checks, 12 PASS.** With run 4 the total is 148 checks, 131 PASS, 17 FAIL. H16 stays NOT TESTED; read-only staff answering an order is covered by P03c. The full numbered list is in the appendix at the end.

### Retailer flows

| Id | Scenario | Status | Observed |
| --- | --- | --- | --- |
| H01 | Hub home before any link | PASS | roles buying/selling false, 0 suppliers |
| H02 | Find the wholesaler by place "Bhiwandi" | PASS | 1 result, `connection: null`, 3 preview items, trust: fill rate 0.86, 5 orders answered, district Bhiwandi, `gst_verified: false` (made-up GSTIN) |
| H02b | Find by product "rice" | PASS | listing names are searched |
| H02c | Filters has_catalogue, shows_prices, gst_verified, district=Thane; sorts name, newest | PASS | all HTTP 200. `shows_prices=1` returned the wholesaler only after a listing had `price_display: from_amount` (P01t); `district=Thane` returns nothing because the district is "Bhiwandi" |
| H03 | Wholesaler profile | PASS | 2 listings (rice, oil), MOQ 2, price on request |
| H04–H04d | Send request, send again, cancel, see cancelled | PASS | Second POST while pending returns the same pending request (HTTP 200, no duplicate row); cancel 200; outgoing shows `cancelled` |
| H05 / H10 | Hub WhatsApp switch off, then on | PASS | `hub_whatsapp_enabled` false then true; outbox row skipped `TURNED_OFF` while off |
| H06–H06b | Request with first catalogue order (4 rice, 6 soap) and stock sharing | PASS | request 201; order `awaiting_link` |
| H08 | After accept: supplier record approved, stock sharing on | PASS | `allow_low_stock_access: true` |
| H08b | First order moved to `pending` on accept | PASS | |
| H08c | Bills typed before the link are not incoming bills | PASS | INV-00x to Retailer A from before the link not listed |
| H08d/e | Hub home shows 1 supplier; in-app "Supplier connection accepted" | PASS | |
| H12 / P03 | Order in supplier's action list; line prices | PASS | rice 1750 (buyer price), soap 1100 |
| P03d–P03g | Supplier confirms 3 of 4 rice → `partial`, one backorder (`origin: backorder`, pending, 1 rice), buyer notice names the backorder | PASS | |
| P04 | Supplier confirms the backorder later | PASS | `confirmed` |
| H13–H13c | Buyer writes on the order; supplier reads it and is notified | PASS | "QA Retailer Andheri wrote on the order" |
| H14b/c, P06b | Bill within Maharashtra: CGST+SGST, no IGST; total = Σ qty × price × (1+rate) | PASS | INV-014 15,138.00 (CGST 769 / SGST 769); INV-015 13,300.50 (rice 5 %, soap 18 %) |
| H14d/e, H15–H15c | Order billed → dispatched with note; buyer notified; hub inbox "Bill INV-014 … Receive" | PASS | |
| H17 | Bill in incoming bills, no duplicate flag | PASS | |
| H17b | Receive screen: lines, `match`, `suggestions`, `shortfall_mode` | PASS | mode `keep`; rice matched by exact name to the item Retailer A already had |
| H17c | Create own item from the soap line | PASS | "QA Soap bar (A)", cost 1100 per buyer unit |
| H17d/e | Receive → purchase INV-014 | FAIL as recorded (harness), purchase confirmed separately | The first call already created the purchase (HTTP 201). A later read of `/api/purchases` showed INV-014 total 15,138.00, CGST 769 / SGST 769, equal to the sale |
| H17f/g | Order `received`; stock in | H17f PASS, H17g FAIL (harness) | soap +6 verified. Rice went to an existing item with the same name, not the item the harness checked; that item's stock change was not measured |
| H17h/i | Receive twice refused; bill under received | PASS | HTTP 400 "Purchase already exists for this invoice" |
| H18–H18f | Pay against the purchase → supplier sees payment notice → records receipt → invoice `paid_amount`; recording twice refused | PASS (run 4, 2026-10-28 18:34 UTC) | Did not run in run 1 (an earlier version of this file wrongly said PASS). Run 4: Retailer A paid ₹7,569 cash on the INV-014 purchase (purchase paid 0 → 7,569). The wholesaler got one notice (payment, ₹7,569, cash, 2026-10-28, INV-014), the bell "QA Retailer Andheri paid ₹7,569" and a "Record receipt" item in the hub inbox. The owner recorded it: invoice paid 0 → 7,569 of 15,138, balance 7,569, `partially_paid`, and the notice left the pending list. A second record got 404 "This notice is already done" with paid still 7,569 |
| H19 | Item "QA Atta 10kg (A)" min 10, stock 2, default supplier = wholesaler | PASS | |
| P06d/P06r | Second bill: lines matched from the remembered map | PASS | rice → QA Basmati Rice 25kg, soap → QA Soap bar (A) |
| P06e/f/g | Receive INV-015 with 1 damaged soap box in `auto_return` mode | PASS | purchase 13,300.50; debit note raised in the same call; soap stock +5 not +6; order `received` |
| P06h | Supplier's money notice for the debit note | FAIL as recorded (harness), notice present | The notice list held `debit_note` ₹1,298 (1,100 + 18 %); the check looked for the bill number in the title |
| H20–H20f | Decline with reason (buyer notified), cancel own order, answer a cancelled order refused (409), below MOQ refused | PASS | "Order at least 2 of QA Basmati Rice 25kg" |
| H21–H21g | Standing order propose → accept → pause → supplier cannot resume (409) → resume → end | PASS | statuses proposed / active / paused / active / ended |
| H22d/e | New arrivals shows the published collection; "launched QA Diwali Picks" notice | PASS | |
| H22f–h | Mute, collections still listed, unmute | PASS | |
| H23–H23f | Order link for "QA Local Dairy" (not on Khatario): link + WhatsApp text, `/so/<token>` opens without login (200), listed as `sent`, claimed by Retailer B → dairy linked to B, approved | PASS | |
| P02 | Buyer sees its own price in the supplier catalogue | PASS | rice `price 1750, my_price true` |
| H27–H27c | Shortfall setting read / set auto_return / invalid refused / reset | PASS | |

### Wholesaler flows

| Id | Scenario | Status | Observed |
| --- | --- | --- | --- |
| H06a, P01r | Publish soap to the public catalogue; set "from ₹45" | PASS | `price_display` must be `from_amount` (see harness errors) |
| P01t/u | Directory "shows prices" and profile show the price | PASS | |
| H07 | Pending request visible | PASS | |
| H07b | Accept step suggests the existing customer with the same GSTIN | PASS | 1 suggestion: QA Retailer Andheri |
| H07d | Accept, link that customer | PASS | |
| H08f | In-app notice for the first order | PASS | title "First order from QA Retailer Andheri" |
| H11/H11b | Set buyer price rice 1750 for Retailer A; list shows it | PASS | |
| H14 / P06 | Invoice draft from a partial order | PASS | confirmed quantities and agreed prices |
| H19b | Supplier dashboard | PASS | 1 alert: QA Atta 10kg (A) @ QA Retailer Andheri; active customers 2 |
| H19c, P05–P05f | Build suggestions → draft for Retailer A (`origin: suggested`, Atta qty 18, vendor item unset) → send (pick own item) → buyer confirms → suggestions again add nothing | PASS | |
| H21b/c | See and accept a standing order | PASS | |
| H22–H22c | Create collection, put a listing in it, publish | PASS | |
| H25–H25e | Retailer B: link_only hides from search but profile opens; hidden → 404; `directory_approved` cannot be self-set | PASS | |

### Permissions and isolation

| Id | Scenario | Status | Observed |
| --- | --- | --- | --- |
| H07c | Read-only staff accept a request | PASS | 403 "update permission for purchases" |
| P03c, P07 | Read-only staff respond / dispatch | PASS | 403 "update permission for invoices" |
| P07c/d/e | Read-only staff publish listing / set buyer price / edit directory profile | PASS | 403 |
| P07b | Read-only staff view an order | PASS | 200 (read) |
| **H13d** | **Read-only staff post a message on an order** | **FAIL** | **HTTP 201, message saved. F-011** |
| H18c | Read-only staff record a receipt from a money notice | PASS (run 4) | 403 "User does not have create permission for payments"; notice still pending, invoice paid still 0 |
| H24–H24d | Another business: order 404, incoming bill 403, messages 404, buyer prices 404 | PASS | |

### Harness errors (not application defects)

| Id | What the harness expected | What is true |
| --- | --- | --- |
| H04b | 409 on a second pending request | The API returns the existing pending request (200) and creates no duplicate. Accepted as design. |
| H08f | title "New order from …" | A first order settled on accept is titled "First order from …". |
| H11c | buyer price on the profile listing | The rice listing is "price on request"; the buyer price shows in the catalogue (P02). |
| H12b/d, H14, H17g | order lines under `order.lines` | Lines are returned beside `order`. Rerun as P03. |
| H17d/e | 422 without an item map | The rice line matched by exact name to an item Retailer A already had, so the receive succeeded on the first call; the second call was the "already exists" check. |
| H19d | draft row keyed `buyer_business_id` | Rows use `other_business_id` / `other_business_name`. Rerun as P05. |
| P01–P01c | `price_display: 'show'` | Valid values are `hidden`, `from_amount`, `on_request`; an unknown value is ignored silently (listing stays as it was). Rerun as P01r. |
| P06b | 5 % GST on soap | Soap is 18 %; the bill is right. |
| H12c → H12d, H14 | partial confirmation in run 1 | Because the lines were not read, run 1 sent no confirmed quantities and the whole order was confirmed (4 rice), so H12d and H14 failed. The partial path was rechecked in P03d–P03g and P06. |
| P06d, P06h | field names `buyer_item`, title with bill number | Field is `match`; the debit-note notice has the amount, not the bill number. Rerun as P06r. |

## Local browser pass (`kh_phase2_test`, port 3015)

Seed: `tmp-qa/local-hub-seed.mjs` connected QA Kirana Buyer (retailer) to Map Test Shop (wholesaler, Pune, no GSTIN, so its bills are bills of supply), left one pending order (24 soap, 2 pumps) and one billed order (BOS-002, 12 soap, ₹120). Two local test users got a session-only password stored as `LOCAL_HUB_QA_PASSWORD` in `.env`. Migration 408 (`platform_settings.supplier_hub_visible`) was missing from the test DB and was applied; the switch was then set on, as on staging.

| Screen | As | Status | Observed |
| --- | --- | --- | --- |
| Supplier Hub home | Wholesaler | PASS | "1 thing waiting for you", Needs you card "QA Kirana Buyer ordered 2 items ₹6,640 · Answer", Buying and Selling tiles, buyer insights (sold ₹120, supplied 100 %) |
| Orders list `?role=vendor` | Wholesaler | **FAIL** | Opened from the hub with the Selling side selected, the "Needs you" tab said "Nothing needs you right now" although the API had returned the pending order. Clicking Open then Needs you showed it. F-012 |
| Order detail (respond) | Wholesaler | PASS | Lines with own stock ("You have 428"), quantity boxes "You can supply … of 24", Confirm quantities, Decline, Messages. Entered 20 of 24 soap → "Partly confirmed", "Asked for 24; supplier confirmed 20", "Backorder · Waiting for supplier", total ₹6,600, Create bill / Cancel order |
| My catalog | Wholesaler | PASS | Collections form, both items listed with Listed, name shown, price, min order, multiples, pack, lead time, sizes/colours, photo |
| Supplier Dashboard | Wholesaler | PASS | Active customers 1, alerts 0, Suggested orders / My catalog / View Requests, area report link |
| Settings → Suppliers directory | Wholesaler | PASS | Logo/cover, visibility radios, summary, categories, slug, WhatsApp updates switch, short/damaged goods choice, incoming requests, published listings. Took about 30 s on the first open (dev compile) |

| Sign in / sign out | Both | PASS | Phone then password; the earlier Map Test Shop session cookie (shared across localhost ports) had to be logged out first |
| Supplier Hub home | Retailer | PASS | "1 thing waiting for you", Needs you card "Bill BOS-002 from Map Test Shop ₹120 · Receive", Buying tiles (3 orders open, 1 incoming bill), My suppliers 1 connected. After receiving: "You are all caught up" |
| Find suppliers `?q=soap` | Retailer | PASS | Category chips, filters (GST verified, has catalogue, prices shown to all), district list, sort; "1 supplier" Map Test Shop with preview items, "1 shop buys here", View, badge "Connected" |
| Supplier profile | Retailer | PASS | Cover, name, summary, categories, "You buy from Map Test Shop" with Open supplier / Supplier orders / Call / WhatsApp, trust strip (replies within an hour, bills auto), catalogue "Alt Unit Soap · Min 12 · MRP ₹12 · From ₹9", "Water pump 1HP · From ₹3,000" |
| Order detail (buyer view of the partly confirmed order) | Retailer | PASS | "Partly confirmed · Backorder · Waiting for supplier", "Asked for 24; supplier confirmed 20", estimated total ₹6,600 "before tax. Their bill is final.", Cancel order, Messages |
| Incoming bills | Retailer | PASS | Tabs To receive / Received / All; "Map Test Shop · Bill BOS-002 · 28/10/2026 · 1 item · To receive ₹120" |
| Receive bill | Retailer | PASS | Line "Alt Unit Soap 12 PCS × ₹10", item search with barcode button, "New to you? Create it as a new item" → inline form (name, your units in 1 PCS, selling price, "Cost: ₹10 each") → "Created Alt Unit Soap", matched with factor 1, Short / Damaged boxes, note, shortfall text with Change link → "Receive and create purchase" → "Purchase BOS-002 created", page shows "Received · Open purchase BOS-002" |

## Findings

| Id | Severity | Finding | Where | Status |
| --- | --- | --- | --- | --- |
| F-011 | Medium (permissions) | A staff user with read-only purchases/invoices permission can post messages on a Supplier Hub order. The POST handler authorizes with `read`, while every other hub write asks for `update`. | `app/api/supply-orders/[id]/comments/route.ts` POST → `authorizeOrderRole(..., 'read')` | FIXED 2026-10-28 (not committed): POST asks for `update`; GET still `read`. Test `tests/api/supply-order-comments-permission.test.ts` (3 pass; 2 failed before the fix). Not re-run on staging (not deployed). |
| F-012 | Medium (usability) | Orders list: the first fetch uses the default side `buyer`, then the URL/localStorage side switches to `vendor` and fetches again; whichever response lands last wins, so the Selling "Needs you" tab can show "Nothing needs you" while an order is waiting. | `app/(app)/supply-orders/page.tsx` `load` has no stale-response guard | FIXED 2026-10-28 (not committed): `load` ignores any response whose request is no longer the latest (`lib/latest-request.ts`, test `tests/lib/latest-request.test.ts`). Browser recheck on `localhost:3015`: buyer-side fetches still fire first, and Selling → Needs you now lists both waiting orders. |
| F-013 | High (platform, not code) | No Supplier Hub WhatsApp has ever been sent: template `khatario_supplier_hub_update` is still `draft` on staging (never submitted to Meta). 42 outbox rows, 0 sent. | staging `platform_whatsapp_templates` | OPEN. Owner action: submit the template in `/admin` → WhatsApp templates; approve; retest with a business whose owner phone is not a QA test phone. |
| F-014 | Medium (ops) | The staging crontab has one line (a 09:00 job). `supplier-hub-whatsapp` (sweep), `check-low-stock` (alerts, suggested orders) and `standing-orders` are not scheduled, and `/var/log/khatario-cron-staging.log` does not exist. In-process flushes still run, so this run's notices were processed; suggestions and standing orders only run when a supplier opens the dashboard or calls suggest. | staging `crontab -l` as root | OPEN. Add the lines from `docs/SERVER_INFRASTRUCTURE.md` → Cron. |
| F-015 | Low (API) | `PATCH /api/suppliers/hub/published-listings/[id]` and the POST ignore an unknown `price_display` value silently instead of answering 400. | `published-listings` routes | OPEN, low. |
| F-016 | Low (test DB) | `kh_phase2_test` lacked migration 408; `schema_migrations` records 423 rows while tables from 424–440 exist, so the test DB is not rebuilt from the runner. Applied 408 by hand. | local only | Noted. |

Also observed: the dev console on every local page logs `[RENDER-LOOP] LayoutDataProvider / Sidebar / CatalogSyncProvider / BranchProvider rendered 15x in last 1000ms`. It is app-wide, not hub-specific, and was not investigated here.

## Data left on staging

QA Retailer Andheri is now connected to QA Wholesale Bhiwandi (buyer price rice 1750, items QA Rice 25kg (A), QA Soap bar (A), QA Atta 10kg (A)), with orders received/declined/cancelled/confirmed, bills INV-014 and INV-015 received (INV-015 with debit note ₹1,298), a part payment of ₹7,569 on INV-014 paid by Retailer A and recorded by the wholesaler from the notice (run 4), one ended standing order, supplier "QA Local Dairy" linked to QA Retailer Bengaluru, and collection "QA Diwali Picks 2026-10-28" at the wholesaler. Retailer B's visibility was set back to hidden. All ids are in `tmp-qa/staging-ids.json` under `hubE2E`.

## Party-wise pricing and the hub (2026-10-29)

Question: does a price set for a party in Pricing reach the Supplier Hub, so the buyer never sees one price in the hub and another on the bill?

Code: there is one list. The hub's buyer-price screen writes `party_item_prices` for the customer linked to the buyer, the same rows Pricing → customer prices and the billing resolver use (`lib/pricing/buyer-price-sql.ts`). The hub reads only the whole-item customer price valid today. It does not use the rest of the resolver: price levels and their quantity slabs, the customer's discount %, category discounts, per-variant customer prices, or the MRP cap. When a hub order is billed, every line is marked as a hand-set price (`priceUserOverride: true`), so the invoice screen does not re-apply the level or discount either.

Probe on staging (`node tmp-qa/staging-hub-pricing-probe.mjs`, results `tmp-qa/staging-hub-pricing-probe.json`). The wholesaler set, for its customer QA Retailer Andheri, oil at ₹2,100 with 5 % discount and a price level with biscuits at ₹25 (list prices oil ₹2,200, biscuits ₹500). Everything was removed afterwards and the order cancelled.

| Item | Normal billing for this customer (resolver) | Hub catalogue (buyer) | Hub order line | Invoice draft from the order | Status |
| --- | --- | --- | --- | --- | --- |
| Oil, customer price + 5 % | ₹2,100 less 5 % | ₹2,100 (marked "your price") | ₹2,100 | ₹2,100, no discount | FAIL for the discount |
| Biscuits, price level | ₹25 (level) | price not shown | ₹500 (list price, supplier view) | ₹500 | FAIL |

| Id | Severity | Finding | Status |
| --- | --- | --- | --- |
| F-017 | High (money) | A connected buyer on a price level is billed the list price on hub orders: the level price never reaches the catalogue, the order line or the invoice draft, and the bill line is locked so the invoice screen does not apply it. Same for quantity slabs. | FIXED 2026-10-29, not committed or deployed (needs migration 442 on staging). See "Fix and recheck" below. |
| F-018 | High (money) | The customer's discount % on an item (and category discounts) is dropped on hub orders: the order and invoice draft carry the price with no discount, and the line is locked. | FIXED 2026-10-29, not committed or deployed. |
| F-019 | Medium | Per-variant customer prices are not used by the hub (only whole-item prices; listing option prices are used for sizes/colours instead). | FIXED 2026-10-29 where a listing option's name matches one of the supplier's sizes/colours (the order line now keeps that size). An option with no matching size still uses its own price. |
| F-020 | Low | The supplier profile page shows the public listing price ("from ₹X" / on request) to a connected buyer, not that buyer's own price, while the catalogue shows their own price. | OPEN, seen in H11c |

### Fix and recheck (2026-10-29)

Change: `lib/supplier-hub-pricing.ts` prices hub lines through the billing resolver for the supplier's linked customer, with the same party pricing plan check as `POST /api/pricing/resolve`. A customer or level price wins; otherwise the published hub price (option, then listing) stands; the discount always comes from the rules. Order lines store `discount_percent` and `vendor_variant_id` (migration `442_supply_order_line_pricing.sql`, applied to `kh_phase2_test` only). Lines are priced when made (buyer and supplier orders, backups, suggestions, standing-order runs), when the supplier picks or changes a line's item, when a quantity changes before the order is agreed, and when a first order's connection is accepted; backorders keep the agreed price and discount. The invoice draft returns price, discount and size, and the bill screen fills them in. The buyer's catalogue, order screen and hub home totals show the discount. Every plan with Supplier Hub includes party pricing (checked on `kh_phase2_test` and staging), so the plan check removes nothing in practice.

| Check | Command | Result |
| --- | --- | --- |
| New DB test: catalogue, order lines and bill draft equal the billing resolver for a customer price with discount, a price level with a slab, a category discount and a size price; a supplier quantity edit moves onto the slab; no customer rules without the plan | `SUPPLIER_HUB_DB_TEST=1 npx jest tests/db/supplier-hub.db.test.ts --runInBand` on `kh_phase2_test` | Failed before the change (catalogue had no discount). After: 30 passed. With the plan check removed on purpose, the new test fails. |
| Pricing levels and receipt shortfall DB suites | `PHASE2_TEST_DATABASE_URL=... npx jest tests/db/pricing-levels.db.test.ts tests/db/supplier-bill-shortfall.db.test.ts --runInBand` | 16 passed |
| Type check | `npx tsc --noEmit -p tsconfig.json` | 0 errors |
| Unit folders | `npx jest tests/lib tests/api` | 2115 passed; the same 6 suites as before fail (capacitor URL, capability normalizer and snapshot, work-order lines, invoice balance helpers, More menu link), none touching these files |
| Local end to end, Map Test Shop to QA Kirana Buyer | `QA_BASE=http://localhost:3015 QA_PASSWORD_KEY=LOCAL_HUB_QA_PASSWORD node tmp-qa/local-hub-pricing-recheck.mjs` | 10 PASS: resolver pump ₹3,000 less 5 %, soap ₹8 and ₹7 from 50; catalogue pump ₹3,000 less 5 % and soap ₹8 at the 12 minimum, both "your price"; order lines and bill draft pump ₹3,000 less 5 %, soap ₹7 for 60 |
| Browser, local | built-in browser on `localhost:3015` | Order screen (wholesaler): "₹3,000 / PCS less 5% · ₹5,700", soap "₹7 / PCS · ₹420", total ₹6,120. Create bill: pump qty 2, price 3000, discount 5 (−₹300), soap qty 60, price 7, total ₹6,120. Catalogue (retailer): "₹8 per PCS · your price", "₹3,000 per PCS less 5% · your price" |

The first local run hit HTTP 500s inside webpack's module loader on routes this change did not touch; the dev server on port 3000 (another session) shares the `.next` folder. After restarting the port 3015 server the run passed. Rules set for the recheck were removed afterwards. Staging is not rechecked: it needs migration 442 and a deploy.

## Run 4: H18 buyer payment → supplier money notice (2026-10-28, 18:34 UTC)

Command: `node tmp-qa/staging-hub-h18.mjs`. Results: `tmp-qa/staging-hub-h18-results.json`. 12 PASS, 0 FAIL.

Staging database after the run (`current_database()` = `khatario`, read over SSH):

| What | Value |
| --- | --- |
| `payments` for this bill | one `payable` at QA Retailer Andheri, ₹7,569, cash, 2026-10-28, "QA H18 part payment"; one `receivable` at QA Wholesale Bhiwandi, ₹7,569, cash, 2026-10-28, "Paid by QA Retailer Andheri, recorded from Supplier Hub: QA H18 part payment" |
| `supplier_hub_money_notices` row | kind payment, status `recorded`, resolved |
| `supplier_hub_whatsapp_outbox` | "QA Retailer Andheri paid ₹7,569" queued 18:34:54 UTC, skipped `NO_APPROVED_TEMPLATE` (F-013) |

The payment date sent was the UTC date (2026-10-28) although it was already 29 October in India; the notice copies whatever date the buyer saved.

## Appendix: every staging check recorded

Generated from `tmp-qa/staging-hub-e2e-results.json` (run 1, 17:54 UTC), `-2-results.json` (run 2, 17:58 UTC), `-3-results.json` (run 3) and `tmp-qa/staging-hub-h18-results.json` (run 4, 18:34 UTC). Status is what the script recorded; see "Harness errors" for the 16 FAIL rows that were wrong expectations.

| # | Run | Id | Check | Status | Observed |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 | H01 | Retailer A hub home loads (no partners yet) | PASS | HTTP 200 suppliers 0 |
| 2 | 1 | H02 | Retailer A finds the wholesaler by "Bhiwandi" | PASS | HTTP 200 connection=null {"id":"<id>","name":"QA Wholesale Bhiwandi","city":"Bhiwandi","state":"Maharashtra","gstin":"27AQAPW1003W1ZA","logo |
| 3 | 1 | H02b | Search by product name "rice" finds the wholesaler | PASS | HTTP 200 |
| 4 | 1 | H02c | Directory filter has_catalogue=1 | PASS | HTTP 200 wholesaler listed: true of 2 |
| 5 | 1 | H02c | Directory filter shows_prices=1 | PASS | HTTP 200 wholesaler listed: false of 0 |
| 6 | 1 | H02c | Directory filter gst_verified=1 | PASS | HTTP 200 wholesaler listed: false of 0 |
| 7 | 1 | H02c | Directory filter sort=name | PASS | HTTP 200 wholesaler listed: true of 3 |
| 8 | 1 | H02c | Directory filter sort=newest | PASS | HTTP 200 wholesaler listed: true of 3 |
| 9 | 1 | H02c | Directory filter district=Thane | PASS | HTTP 200 wholesaler listed: false of 0 |
| 10 | 1 | H03 | Wholesaler profile shows its published catalogue | PASS | HTTP 200 2 listings; first: {"id":"<id>","item_id":"<id>","audience":"public_preview","display_name":null,"moq":"2.00","lead_time_text":null |
| 11 | 1 | H04 | Retailer A sends a connection request | PASS | HTTP 201 |
| 12 | 1 | H04b | A second request while one is pending is refused | FAIL | HTTP 200 |
| 13 | 1 | H04c | Buyer cancels its own pending request | PASS | HTTP 200 |
| 14 | 1 | H04d | Cancelled request shows as cancelled in outgoing | PASS | cancelled |
| 15 | 1 | H05 | Retailer A switches hub WhatsApp updates off | PASS | HTTP 200 now false |
| 16 | 1 | H06a | Wholesaler publishes soap to the public catalogue | PASS | HTTP 201 |
| 17 | 1 | H06 | Retailer A sends a connection request with a first catalogue order (4 rice, 6 soap) and stock sharing | PASS | HTTP 201 |
| 18 | 1 | H06b | That first order waits with the request (awaiting_link) | PASS | HTTP 200 statuses awaiting_link |
| 19 | 1 | H07 | Wholesaler sees the pending request from Retailer A | PASS | HTTP 200 pending |
| 20 | 1 | H07b | Accept step suggests the existing customer QA Retailer Andheri (same GSTIN) | PASS | HTTP 200 1 suggestion(s): QA Retailer Andheri |
| 21 | 1 | H07c | Read-only staff at the wholesaler cannot accept the request | PASS | HTTP 403 User does not have update permission for purchases |
| 22 | 1 | H07d | Wholesaler accepts and links the existing customer | PASS | HTTP 200 |
| 23 | 1 | H08 | Retailer A now has a supplier record linked to the wholesaler | PASS | approval approved low_stock_shared true |
| 24 | 1 | H08b | The first order moved from awaiting_link to pending for the wholesaler | PASS | status pending |
| 25 | 1 | H08c | Bills typed in before the link do not appear as incoming bills | PASS | HTTP 200 INV-012,INV-010,INV-008,INV-007 |
| 26 | 1 | H08d | Retailer A hub home now shows 1 connected supplier | PASS | suppliers 1 roles {"buying":true,"selling":false} |
| 27 | 1 | H08e | Retailer A got the in-app "connection accepted" notice | PASS | HTTP 200 Supplier connection accepted |
| 28 | 1 | H08f | Wholesaler got the in-app "new order from QA Retailer Andheri" notice | FAIL | First order from QA Retailer Andheri / New supplier connection request / New supplier connection request |
| 29 | 1 | H10 | Retailer A switches hub WhatsApp updates back on | PASS | HTTP 200 |
| 30 | 1 | H11 | Wholesaler sets a special rice price 1750 for Retailer A | PASS | HTTP 200 |
| 31 | 1 | H11b | Buyer price list shows rice at 1750 | PASS | HTTP 200 {"id":"<id>","name":"QA Basmati Rice 25kg","unit":"BAG","selling_price":"1800.00","buyer_price":"1750.00"} |
| 32 | 1 | H11c | Retailer A sees its own price 1750 on the wholesaler profile | FAIL | {"id":"<id>","item_id":"<id>","audience":"public_preview","display_name":null,"moq":"2.00","lead_time_text":null,"price_display":"on_request |
| 33 | 1 | H12 | Order is in the wholesaler’s "needs action" list | PASS | HTTP 200 |
| 34 | 1 | H12b | Order carries the agreed catalogue price on each line | FAIL |  |
| 35 | 1 | H12c | Wholesaler confirms 3 of 4 rice and all soap | PASS | HTTP 200 |
| 36 | 1 | H12d | Retailer A sees "partly confirmed" with one backorder for the missing rice | FAIL | status confirmed backorders 0 |
| 37 | 1 | H13 | Retailer A writes a message on the order | PASS | HTTP 201 |
| 38 | 1 | H13b | Wholesaler reads the message on the order | PASS | HTTP 200 1 message(s) |
| 39 | 1 | H13c | Wholesaler is notified of the message | PASS | QA Retailer Andheri wrote on the order / First order from QA Retailer Andheri |
| 40 | 1 | H13d | Read-only staff cannot post on the order | FAIL | HTTP 201 |
| 41 | 1 | H14 | Invoice draft has the confirmed quantities (3 rice, 6 soap) and the agreed price | FAIL | HTTP 200 QA Basmati Rice 25kg 4 @ 1750; QA Bath Soap 100g (box of 48) 6 @ 1100 |
| 42 | 1 | H14b | Wholesaler bills the order within Maharashtra: CGST+SGST, no IGST | PASS | HTTP 201 INV-014 total 15138.00 CGST 769.00 SGST 769.00 IGST 0.00 |
| 43 | 1 | H14c | Bill total equals confirmed qty × agreed price × (1+GST) | PASS | expected 15138.00 got 15138.00 |
| 44 | 1 | H14e | Retailer A is told the order was billed | PASS | QA Wholesale Bhiwandi billed your order / QA Wholesale Bhiwandi wrote on the order |
| 45 | 1 | H14d | Order shows as billed | PASS | status invoiced |
| 46 | 1 | H15 | Wholesaler marks the billed order dispatched with a transport note | PASS | HTTP 200 |
| 47 | 1 | H15b | Retailer A sees "on the way" with the note | PASS | status dispatched note QA tempo MH04 QA 0001, 2 bags + 1 carton |
| 48 | 1 | H15c | Retailer A hub inbox shows the bill to receive | PASS | bill_to_receive: Bill INV-014 from QA Wholesale Bhiwandi / bill_to_receive: Bill INV-012 from QA Wholesale Bhiwandi / bill_to_receive: Bill  |
| 49 | 1 | H17 | Bill INV-014 is in Retailer A's incoming bills | PASS | HTTP 200 INV-014, INV-012, INV-010, INV-008, INV-007 |
| 50 | 1 | H17b | Receive screen lists both lines (unmatched, with suggestions) and the shortfall mode | PASS | HTTP 200 mode keep; QA Basmati Rice 25kg: matched=false sugg=0; QA Bath Soap 100g (box of 48): matched=false sugg=0 |
| 51 | 1 | H17c | Retailer A creates its own item from the soap line | PASS | HTTP 201 QA Soap bar (A) cost 1100.00 |
| 52 | 1 | H17d | Receiving without matching the rice line is refused with suggestions (422) | FAIL | HTTP 201 {"purchase":{"id":"<id>","business_id":"<id>","supplier_id":"abe476d9-a968-4339-af3e-a3f508dcd21 |
| 53 | 1 | H17e | Retailer A receives the bill: purchase created with the same total and GST split | FAIL | HTTP 400 Purchase already exists for this invoice total undefined CGST undefined SGST undefined |
| 54 | 1 | H17f | Order shows received and points at the purchase | PASS | status received |
| 55 | 1 | H17g | Stock in: 3 rice bags and 6 soap bars | FAIL | rice 0 soap 6 |
| 56 | 1 | H17h | Receiving the same bill twice is refused | PASS | HTTP 400 Purchase already exists for this invoice |
| 57 | 1 | H17i | Bill now listed under received | PASS | HTTP 200 |
| 58 | 1 | H19 | Retailer A creates an item below its reorder level with the wholesaler as default supplier | PASS | HTTP 201 |
| 59 | 1 | H19b | Wholesaler low-stock dashboard loads (observed) | PASS | HTTP 200 alerts 1: QA Atta 10kg (A)@QA Retailer Andheri stats {"active_customers":2,"low_stock_alerts":1,"total_thresholds":1,"pending_reque |
| 60 | 1 | H19c | Wholesaler builds suggested orders from buyers’ low stock | PASS | HTTP 200 {"orders":1,"lines":1} |
| 61 | 1 | H19d | A draft order for Retailer A appeared | FAIL | 0 draft(s) |
| 62 | 1 | H20 | Retailer A orders 2 oil from the catalogue | PASS | HTTP 201 |
| 63 | 1 | H20b | Wholesaler declines with a reason | PASS | HTTP 200 |
| 64 | 1 | H20c | Retailer A is told the order was declined | PASS | QA Wholesale Bhiwandi declined the order / QA Wholesale Bhiwandi dispatched your order / QA Wholesale Bhiwandi billed your order |
| 65 | 1 | H20d | Retailer A cancels its own pending order | PASS | HTTP 200 |
| 66 | 1 | H20e | Answering a cancelled order is refused | PASS | HTTP 409 Only the supplier can answer a pending order |
| 67 | 1 | H20f | Ordering below the MOQ is refused | PASS | HTTP 400 Order at least 2 of QA Basmati Rice 25kg |
| 68 | 1 | H21 | Retailer A proposes a Mon/Thu standing order for 2 rice | PASS | HTTP 201 status proposed |
| 69 | 1 | H21b | Wholesaler sees the proposed standing order | PASS | HTTP 200 1 |
| 70 | 1 | H21c | Wholesaler accepts it | PASS | HTTP 200 status active |
| 71 | 1 | H21d | Retailer A pauses it | PASS | HTTP 200 paused |
| 72 | 1 | H21e | Supplier cannot resume the buyer’s paused standing order | PASS | HTTP 409 Only the buyer can resume a paused standing order |
| 73 | 1 | H21f | Retailer A resumes it | PASS | HTTP 200 active |
| 74 | 1 | H21g | Retailer A ends it | PASS | HTTP 200 ended |
| 75 | 1 | H22 | Wholesaler creates a collection | PASS | HTTP 201 |
| 76 | 1 | H22b | Biscuit listing is put in the collection | PASS | HTTP 201 |
| 77 | 1 | H22c | Wholesaler publishes the collection | PASS | HTTP 200 |
| 78 | 1 | H22d | Retailer A sees the collection under New arrivals with its item | PASS | HTTP 200 1 collection(s); items QA Glucose Biscuits (carton) @ undefined |
| 79 | 1 | H22e | Retailer A got a new-collection notice | PASS | QA Wholesale Bhiwandi launched QA Diwali Picks 2026-10-28 / QA Wholesale Bhiwandi accepted your standing order / QA Wholesale Bhiwandi decli |
| 80 | 1 | H22f | Retailer A mutes the wholesaler’s launch notices | PASS | HTTP 200 |
| 81 | 1 | H22g | Muted supplier’s collections still show in New arrivals | PASS | HTTP 200 |
| 82 | 1 | H22h | Unmute | PASS | HTTP 200 |
| 83 | 1 | H23 | Retailer A adds a plain supplier "QA Local Dairy" (not on the hub) | PASS | HTTP 201 |
| 84 | 1 | H23b | Order link and WhatsApp text are created | PASS | HTTP 201 keys order,link,supplier_phone,message; link https://staging.khatario.com/so/<token>; message "Hello QA Local Dairy, order from QA  |
| 85 | 1 | H23c | The order link opens without a login | PASS | HTTP 200 |
| 86 | 1 | H23d | Retailer A sees the sent order link in the list | PASS | HTTP 200 1 link(s), status sent |
| 87 | 1 | H23e | Retailer B (acting as that dairy) claims the link and connects as the supplier | PASS | HTTP 200 {"ok":true,"buyer_business_id":"<id>"} |
| 88 | 1 | H23f | QA Local Dairy is now linked to Retailer B’s business | PASS | linked 0bb09eb2 approval approved |
| 89 | 1 | H24 | Another business cannot open Retailer A’s order | PASS | HTTP 404 Order not found |
| 90 | 1 | H24b | Another business cannot open Retailer A’s incoming bill | PASS | HTTP 403 This invoice is not addressed to your business |
| 91 | 1 | H24c | Another business cannot read the order messages | PASS | HTTP 404 Order not found |
| 92 | 1 | H24d | Another business cannot set the wholesaler’s buyer prices | PASS | HTTP 404 Not a connected buyer of yours |
| 93 | 1 | H25 | Retailer B sets visibility to link only | PASS | HTTP 200 |
| 94 | 1 | H25b | Link-only business is not in directory search | PASS | HTTP 200 2 result(s) |
| 95 | 1 | H25c | Its profile still opens by link | PASS | HTTP 200 |
| 96 | 1 | H25d | Hidden business profile is not visible to others | PASS | HTTP 404 Not found |
| 97 | 1 | H25e | directory_approved cannot be changed by the business itself | PASS | approved true |
| 98 | 1 | H27 | Shortfall setting reads | PASS | HTTP 200 mode keep |
| 99 | 1 | H27b | Shortfall setting switches to auto_return | PASS | HTTP 200 |
| 100 | 1 | H27c | Invalid mode is refused | PASS | HTTP 400 mode must be 'keep' or 'auto_return' |
| 101 | 2 | P01 | Wholesaler sets the soap listing to show a price (from ₹45) | FAIL | HTTP 200 now display=on_request from=null |
| 102 | 2 | P01b | Directory filter "shows prices" now lists the wholesaler | FAIL | HTTP 200 0 result(s) |
| 103 | 2 | P01c | Profile shows "from ₹45" on soap | FAIL | {"display":"on_request","from":null} |
| 104 | 2 | P02 | Connected buyer sees its own rice price 1750 in the supplier catalogue | PASS | HTTP 200 3 catalogue items; rice {"price":"1750.00","my_price":true,"my_item":"QA Basmati Rice 25kg"} |
| 105 | 2 | P03 | Retailer A orders 4 rice and 6 soap | PASS | HTTP 201 |
| 106 | 2 | P03b | Order lines carry the agreed prices (rice at the buyer price 1750) | PASS | QA Basmati Rice 25kg: 4 @ 1750; QA Bath Soap 100g (box of 48): 6 @ 1100 |
| 107 | 2 | P03c | Read-only staff cannot answer the order | PASS | HTTP 403 User does not have update permission for invoices |
| 108 | 2 | P03d | Wholesaler confirms 3 of 4 rice and all soap, rest on backorder | PASS | HTTP 200 status partial |
| 109 | 2 | P03e | Retailer A sees "partly confirmed" and one backorder | PASS | status partial backorders 1 {"id":"<id>","status":"pending"} |
| 110 | 2 | P03f | Backorder is a pending order for the missing 1 rice | PASS | status pending origin backorder lines QA Basmati Rice 25kg 1 |
| 111 | 2 | P03g | Retailer A is told some quantities are lower, rest on backorder | PASS | QA Wholesale Bhiwandi confirmed your order: Some quantities are lower than you asked for. The rest of 1 item is on a backorder QA Whol / QA  |
| 112 | 2 | P04 | Wholesaler confirms the backorder when stock is in | PASS | HTTP 200 confirmed |
| 113 | 2 | P05 | The suggested draft for Retailer A (origin "suggested") is in the wholesaler action list | PASS | 1 draft(s) suggested |
| 114 | 2 | P05b | Draft line is QA Atta, 18 (reorder level 10 + reorder qty 20 − 2 in stock? observed) | PASS | QA Atta 10kg (A) qty 18 vendor item unset price null |
| 115 | 2 | P05c | Wholesaler sends the proposal (picking its own item for the line) | PASS | HTTP 200 proposed |
| 116 | 2 | P05d | Retailer A sees the proposal to confirm | PASS | proposed/suggested |
| 117 | 2 | P05e | Retailer A confirms the proposal | PASS | HTTP 200 confirmed |
| 118 | 2 | P05f | Running suggestions again opens no second draft for the same item | PASS | 0 draft(s) |
| 119 | 2 | P06 | Invoice draft carries confirmed quantities 3 rice and 6 soap | PASS | QA Basmati Rice 25kg 3 @ 1750; QA Bath Soap 100g (box of 48) 6 @ 1100 |
| 120 | 2 | P06b | Bill on confirmed quantities: 3×1750 + 6×1100 + 5% GST | FAIL | HTTP 201 INV-015 total 13300.50 expected 12442.50 |
| 121 | 2 | P06c | Dispatch | PASS | HTTP 200 |
| 122 | 2 | P06d | Receive screen says auto_return and both lines are already matched from last time | FAIL | mode auto_return; QA Basmati Rice 25kg: null; QA Bath Soap 100g (box of 48): null |
| 123 | 2 | P06e | Receive with 1 damaged soap box: purchase created and a debit note raised at once | PASS | HTTP 201 total 13300.50; {"mode":"auto_return","shortfalls":[{"item_id":"<id>","item_name":"QA Soap bar (A)","short_qty":0,"damaged_qty":1}] |
| 124 | 2 | P06f | Damaged box kept out of sellable stock: soap +5, not +6 | PASS | soap 6 → 11 |
| 125 | 2 | P06g | Order shows received | PASS | status received |
| 126 | 2 | P06h | Wholesaler gets a notice to issue the matching credit note | FAIL | HTTP 200 debit_note 1298, debit_note 2310, debit_note 154 |
| 127 | 2 | P07 | Read-only staff cannot dispatch | PASS | HTTP 403 User does not have update permission for invoices |
| 128 | 2 | P07b | Read-only staff can view the wholesaler’s orders | PASS | HTTP 200 |
| 129 | 2 | P07c | Read-only staff cannot publish listings | PASS | HTTP 403 User does not have update permission for purchases |
| 130 | 2 | P07d | Read-only staff cannot set buyer prices | PASS | HTTP 403 User does not have update permission for invoices |
| 131 | 2 | P07e | Read-only staff cannot edit the directory profile | PASS | HTTP 403 User does not have update permission for settings |
| 132 | 3 | P01r | Soap listing set to "from ₹45" using price_display=from_amount | PASS | HTTP 200 display=from_amount from=45.00 |
| 133 | 3 | P01s | An unknown price_display value ("show") is ignored silently rather than refused (observed) | PASS | HTTP 200 display stays from_amount from 45.00 |
| 134 | 3 | P01t | Directory filter "shows prices" lists the wholesaler | PASS | HTTP 200 1 result(s) |
| 135 | 3 | P01u | Profile shows "from ₹45" on soap | PASS | {"display":"from_amount","from":"45.00"} |
| 136 | 3 | P06r | Receive screen lines were matched to the buyer’s items remembered from the first bill | PASS | HTTP 200 QA Basmati Rice 25kg → {"item_id":"<id>","item_name":"QA Basmati Rice 25kg","unit; QA Bath Soap 100g (box of 48) → {"item_id":"<id> |
| 137 | 4 | H18-0 | Retailer A's purchase from hub bill INV-014 is found | PASS | HTTP 200 bill INV-014 total 15138.00 paid 0.00 supplier linked wholesaler |
| 138 | 4 | H18-1 | Starting point: nothing paid on either side, no pending payment notice for this bill | PASS | purchase paid 0, invoice paid 0 of 15138.00 (final), pending payment notices 0 |
| 139 | 4 | H18 | Retailer A pays ₹7569 cash against the purchase | PASS | HTTP 201 |
| 140 | 4 | H18a | Retailer A purchase shows the amount paid | PASS | paid 0 → 7569 |
| 141 | 4 | H18b | Wholesaler sees exactly one payment notice for the bill, with the buyer’s amount, mode and date | PASS | payment ₹7569 cash 2026-10-28 INV-014 from QA Retailer Andheri |
| 142 | 4 | H18b2 | Wholesaler gets the in-app notice "QA Retailer Andheri paid …" | PASS | QA Retailer Andheri paid ₹7,569: For bill INV-014 by cash. Record the receipt in one tap. |
| 143 | 4 | H18b3 | The payment is in the wholesaler’s hub inbox | PASS | payment_to_record: QA Retailer Andheri paid for bill INV-014 ₹7569 · Record receipt |
| 144 | 4 | H18c | Read-only staff cannot record the receipt; notice stays pending and nothing is paid | PASS | HTTP 403 User does not have create permission for payments; pending true; invoice paid 0 |
| 145 | 4 | H18d | Wholesaler owner records the receipt from the notice | PASS | HTTP 200 |
| 146 | 4 | H18e | Invoice paid amount moves by the buyer’s amount; balance is what is left | PASS | paid 0 → 7569 of 15138.00; balance 7569.00; status final / partially_paid |
| 147 | 4 | H18e2 | The notice leaves the pending list | PASS | pending false |
| 148 | 4 | H18f | Recording the same notice again is refused and the paid amount does not change | PASS | HTTP 404 This notice is already done; paid 7569 |
