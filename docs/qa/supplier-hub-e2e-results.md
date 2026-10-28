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

Totals: 125 checks executed. 114 PASS, 2 FAIL that are application defects (F-011, F-012), 9 FAIL that were wrong expectations in the harness and were re-checked (listed under "Harness errors" so the record stays honest).

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
| H17d/e | Receive → purchase INV-014 | PASS | total 15,138.00, CGST 769 / SGST 769 equal the sale; purchase listed under `/api/purchases` |
| H17f/g | Order `received`; stock in | PASS | soap +6; rice +3 on the name-matched item (13 → the item it matched) |
| H17h/i | Receive twice refused; bill under received | PASS | HTTP 400 "Purchase already exists for this invoice" |
| H18–H18f | Pay ₹7,569 cash against the purchase → supplier sees payment notice → records receipt → invoice `paid_amount` 7569; recording twice refused (404 "already done") and amount unchanged | PASS | |
| H19 | Item "QA Atta 10kg (A)" min 10, stock 2, default supplier = wholesaler | PASS | |
| P06d/P06r | Second bill: lines matched from the remembered map | PASS | rice → QA Basmati Rice 25kg, soap → QA Soap bar (A) |
| P06e/f/g | Receive INV-015 with 1 damaged soap box in `auto_return` mode | PASS | purchase 13,300.50; debit note raised in the same call; soap stock +5 not +6; order `received` |
| P06h | Supplier's money notice for the debit note | PASS | `debit_note` ₹1,298 (1,100 + 18 %) |
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
| H18c | Read-only staff record a receipt from a money notice | PASS | 403 |
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

QA Retailer Andheri is now connected to QA Wholesale Bhiwandi (buyer price rice 1750, items QA Rice 25kg (A), QA Soap bar (A), QA Atta 10kg (A)), with orders received/declined/cancelled/confirmed, bills INV-014 and INV-015 received (INV-015 with debit note ₹1,298), a part payment of ₹7,569 recorded on both sides, one ended standing order, supplier "QA Local Dairy" linked to QA Retailer Bengaluru, and collection "QA Diwali Picks 2026-10-28" at the wholesaler. Retailer B's visibility was set back to hidden. All ids are in `tmp-qa/staging-ids.json` under `hubE2E`.
