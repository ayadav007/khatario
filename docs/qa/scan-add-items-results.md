# Scan & Add Items results

Feature: barcode-based product onboarding (Items → Scan & Add Items, web and phone). Built in four phases on `main`: `08633bfd` (Phase 1), `299d0fab` (Phase 2), `dd7b021c` (Phase 3), and the Phase 4 review screen, which is not committed at the time of this run. Run date 2026-10-23. All mutating tests used `kh_phase2_test` on loopback port 5433. Each database file checks `current_database()`, port and address before writing.

## Feature status

| Feature | Status | What was run |
| --- | --- | --- |
| Barcode scanning (web camera, typed or USB scanner, phone camera) | Partial | Server lookups and validation tested. The camera was not used on a device or in a browser. |
| Shop barcode check (`GET /api/items/scan-add/barcode`) | PASS | Exact match, leading zeroes, other business sees nothing. |
| External product lookup (`GET /api/items/scan-add/lookup`) | PASS for the API | Mocked ProductGuru and Open Facts answers, cache per business. One live call to each provider parsed correctly (scratch test, removed). |
| Label photo reading (`POST /api/items/scan-add/read-label`) | Partial | Input checks and output clean-up tested. No Gemini key locally, so the model was not called. |
| Manual product creation | PASS for the API | Through `POST /api/items` with and without a retry key. |
| Opening-stock posting, with optional batch and expiry | PASS | One stock movement, branch stock, opening voucher value, FIFO batch. |
| Add stock to an item already in the shop | PASS for the API | `POST /api/inventory-adjustments` with a batch and a retry key. Needs the `purchase_inventory_adjustments` plan feature. |
| Another size under the same barcode, and converting a plain item | PASS for the API | `POST /api/items/scan-add/variant`. Conversion refused once an item has history. Blocked in warehouse mode by design. |
| Size picker when billing a shared barcode | Partial | Phone matching logic unit-tested. The web bill screen and the phone sheet were not clicked. |
| Session review (`POST /api/items/scan-add/review`) | PASS for the API | Gaps, expiry, sizes, other business's ids dropped. Screens not opened in a browser or on a device. |
| Failed-save recovery | Partial | Server side PASS: a retried key returns the same item, with no second item, stock movement or voucher. Web keeps failed rows in `sessionStorage` (this tab only). Phone keeps them in memory while Scan & Add is open; closing it loses them. |
| Tenant isolation on Scan & Add routes | PASS | See below. |

## Commands and results

| Check | Command | Database | Result |
| --- | --- | --- | --- |
| Scan & Add database tests | `npx jest tests/db/scan-add-items.db.test.ts --runInBand` | `kh_phase2_test`, port 5433 | 26 passed, 0 failed |
| Scan & Add unit tests | `npx jest tests/lib/scan-add-items.test.ts tests/lib/product-lookup.test.ts tests/lib/scan-add-batches-variants.test.ts tests/lib/scan-add-review.test.ts` | none | 4 suites, 51 passed, 0 failed |
| All unit and security tests | `npx jest tests/lib tests/security --runInBand` | none needed | 276 suites passed, 6 failed, 1 skipped. Tests: 2203 passed, 7 failed, 8 skipped. The 6 failures are listed below. |
| Same 6 failing suites on the commit before Scan & Add (`8df41f22`) | same files, run in a temporary worktree | none | 6 failed, 7 tests failed, 62 passed. Same tests fail. Confirmed pre-existing. |
| Item, adjustment and isolation suites touched by this work (Phase 3 run) | `npx jest tests/security/items-create-route.test.ts tests/security/inventory-adjustments-route.test.ts tests/db/phase3a-auth-isolation.db.test.ts tests/db/phase3i-write-identity.db.test.ts tests/db/soft-delete-items-and-report.db.test.ts tests/db/phase2a-release-remediation.db.test.ts tests/lib/stock-movement-label.test.ts --runInBand` | `kh_phase2_test` | all passed. The Phase 4 security runner above repeated the identity files. |
| Flutter, Scan & Add | `flutter test test/scan_add_logic_test.dart` (in `phone/`) | none | 17 passed, 0 failed. `test/invoice_form_test.dart` passed in the Phase 3 run. |
| Flutter, whole suite | `flutter test` (in `phone/`) | none | 154 passed, 17 failed. All 17 are golden image tests. |
| Same 17 golden tests on `8df41f22` | `flutter test` on those 11 files in a temporary worktree | none | Same 17 fail. Confirmed pre-existing. |
| Flutter analyzer on changed files | `flutter analyze lib/screens/items lib/screens/invoices/invoice_scan.dart lib/shell/app_shell.dart` | none | No new issues. One pre-existing warning: `_openedFromMore` unused in `app_shell.dart`. |
| Typecheck | `npx tsc --noEmit -p .` | none | 2 errors, neither in Scan & Add files. `lib/subscription/feature-access.ts:506` was failing before this work. `lib/indian-gst-invoice-extract.ts:733` is in uncommitted invoice-extract work that is not part of this feature. |
| Security regression runner | `npm run test:qa:security-live` | `kh_phase2_test`, port 5433 | **FAIL, runner stopped early.** Middleware 4 passed, cron 4 passed, database identity files 52 passed, Phase 3M 108 passed and 1 failed. The runner stopped after Phase 3M, so 3N, 3O and the report check did not run inside it. |
| Remaining live suites, run one by one | `node tests/live/phase3n-http.mjs`, `node tests/live/phase3o-http.mjs`, `node tests/live/coa-reports-http.mjs` | `kh_phase2_test`, port 5433 | 3N: 49 passed, 0 failed. 3O: 19 passed, 0 failed. Reports: 32 passed, 0 failed, leftover COA-RPT businesses 0, leftover ledger lines 0. These were separate runs, not a pass of the runner. |

## The Phase 3M failure

`FAIL POST /api/expenses session A own records HTTP 400 IDEMPOTENCY_KEY_REQUIRED`. Expense saves have required a retry key since commit `8468a49e` (2026-10-21, "Protect expense saves from duplicate and stale edits…"), before Scan & Add. `tests/live/phase3m-http.mjs` still posts an expense without a key. The handler's identity checks for expenses passed in the same run (no session 401, body naming business B left B unchanged, stale session 401). Not fixed here: it is a test that needs a key added, outside this feature. Still open.

Scan & Add touched `POST /api/items` and `POST /api/inventory-adjustments`. In the same Phase 3M run both passed every check: no session 401, body naming business B returned 201 or 400 with B unchanged, own records 201, stale session 401. Phase 3N's inventory-adjustment checks passed separately.

## Tenant isolation

- Every Scan & Add route (`barcode`, `lookup`, `read-label`, `variant`, `review`) takes the business and user from `requireStrictSession`. None reads `business_id`, `user_id` or `created_by` from the request.
- Database tests: another business's barcode is not found; the lookup cache is per business; another business cannot add a size (404); the review drops another business's item ids; an item's data source is read from that business's own cache, never from the client.
- The review's **Fix** button opens the existing item edit page, which saves through the existing `PATCH /api/items/[id]`. When signed in, that handler uses the session business. With no session it falls back to a business id from the body or query. That fallback was not called in this run: **NOT TESTED** at the time. Closed on 2026-10-24 (Hardening A): both GET and PATCH now use the verified session only.

## Retries

- `POST /api/items` with `X-Idempotency-Key`: the key row is written in the item's transaction together with the opening stock movement, branch stock and batch. A retry returns the same item with HTTP 200. Tested: one item, one stock movement, current stock 20, opening voucher ₹160; two simultaneous saves with one key create one item; a key reused with other values gets 409.
- The opening voucher is rebuilt, not added, so re-running it on a retry cannot double it.
- `POST /api/inventory-adjustments` and `POST /api/items/scan-add/variant` work the same way. Tested: one adjustment row and batch quantities unchanged after a retry; the same variant id returned on retry.
- A review retry sends the stored body with the original key. If the first attempt had in fact committed, the retry returns that item. If the shopkeeper edits a failed row and the first attempt had committed after all, the server answers 409 instead of creating a second item.

## Data scope

No shared product catalogue and no cross-business barcode table were added. `product_lookup_cache` (migration 410) is keyed by `(business_id, barcode)` and holds provider answers only. `items.external_source` is per item. Barcodes typed by a shopkeeper are stored only on that business's items.

## Failures in this run

| Failure | State |
| --- | --- |
| 6 Jest suites: `gst/return-helpers`, `work-orders/work-order`, `capacitor/server-url`, `capability-normalizer` (`debit_notes`), `more-menu-for-user`, `capability-snapshot` (missing jsdom environment) | Pre-existing. Same failures on `8df41f22`. Not fixed. |
| 17 Flutter golden tests (banners, customer ledger, invoices, home, orders, invoice form, items, login screens, settings, widgets, theme) | Pre-existing. Same failures on `8df41f22`. The items golden also covers the Items header, where Scan & Add adds a button, so its image will need regenerating once the goldens are fixed. |
| `tsc`: `feature-access.ts:506` | Pre-existing. |
| `tsc`: `indian-gst-invoice-extract.ts:733` | In uncommitted work outside this feature. Not checked against a baseline. |
| Phase 3M `POST /api/expenses` without a retry key | Test not updated after `8468a49e`. Open. |

## Hardening and UI validation (2026-10-24)

### A. Item edit ownership (Fix path)

Before: `GET` and `PATCH /api/items/[id]` took the business from the session header, but without one they used a `business_id` from the query or body and a `user_id`/`updated_by` from the body. Neither checked the session version, so a revoked cookie could still edit. The middleware rejects requests with no session before they reach the handler, so the body fallback was not reachable through HTTP in normal running, but the handler itself trusted it.

Fix: both handlers now take business and user only from `requireStrictSession` (verified and not revoked). Body and query identity is ignored. The rest of each handler is unchanged. `DELETE` in the same file still has the old fallback; it is not on the Fix path and is covered by `tests/db/soft-delete-items-and-report.db.test.ts`.

| Check | Command | Database | Result |
| --- | --- | --- | --- |
| No session with `business_id`/`user_id` in body or query; other business's session; forged body `business_id` while signed in; revoked session | `npx jest tests/db/scan-add-items.db.test.ts --runInBand` (section "item edit ownership") | `kh_phase2_test`, port 5433 | PASS. 401 UNAUTHENTICATED, 404, 200 editing only the session business's item, 401 SESSION_REVOKED. Whole file 30 passed. |
| Existing callers of the route | `npx jest tests/db/phase2a-invoice-s01-s08.db.test.ts tests/db/phase3a-auth-isolation.db.test.ts tests/db/soft-delete-items-and-report.db.test.ts --runInBand --forceExit` | `kh_phase2_test` | 26 passed |

### B. Drafts on the device

- Web: `localStorage`, key `khatario.scan-add.draft:<businessId>:<userId>` (`lib/items/scan-add-draft.ts`). Phone: `SharedPreferencesAsync`, key `scan_add_draft:<businessId>:<userId>` (`phone/lib/screens/items/scan_add_draft.dart`).
- Kept: session rows (saved, skipped, stock, size, not saved), the product being filled in, its retry key, and the not-saved body with its original key. Not kept: photos, cookies or tokens, provider responses.
- A draft names its business and user inside; one read under another business's key is refused and removed. Old format, damaged or older than 30 days: dropped.
- Saved rows carry the server's item id. Not-saved rows and the unfinished product are labelled as kept on this device only. Retrying sends the original key, so a save that went through comes back as the same item.
- Discard: the unfinished product (with confirmation), a not-saved row in the review, or the whole session with Finish (confirmation when rows are not saved).

| Check | Command | Result |
| --- | --- | --- |
| Web draft rules | `npx jest tests/lib/scan-add-draft.test.ts` | PASS, 8 tests |
| Scan & Add unit tests, all five files | `npx jest tests/lib/scan-add-items.test.ts tests/lib/product-lookup.test.ts tests/lib/scan-add-batches-variants.test.ts tests/lib/scan-add-review.test.ts tests/lib/scan-add-draft.test.ts` | PASS, 59 tests |

### C. Screens

**Phone (Flutter widget tests, no device):** `flutter test test/scan_add_logic_test.dart test/scan_add_screen_test.dart` in `phone/`: 24 passed. `test/scan_add_screen_test.dart` drives the real screens against a fake server, with the camera plugin answering "permission denied":

| Scenario | Result |
| --- | --- |
| Camera permission denied shows the message; typed barcode still works | PASS |
| Known barcode → Already in your shop; same barcode again stays one row | PASS |
| Unknown barcode, typed in by hand: one POST with opening stock and a retry key, no business id | PASS |
| Product database suggestion fills the form and nothing is posted until saved | PASS |
| Failed save kept as not saved; Review → Try again resends the same body and key | PASS |
| Unfinished product survives closing Scan & Add; Continue keeps its fields; save clears it | PASS |
| Discard after confirmation | PASS |
| Another business on the same phone sees none of the draft | PASS |

Not run on a phone: no Android device or emulator was available. The camera itself, photo capture and the device's back button were not exercised.

**Web (Playwright, Chromium, headless):** `node tests/live/scan-add-e2e.mjs` starts Next on `127.0.0.1:3131` against `kh_phase2_test` (port 5433), creates two businesses with their own logins, runs `e2e/scan-add-items.spec.ts`, checks stock and ledger rows, and removes its data.

| Scenario (spec test) | Result |
| --- | --- |
| 1. Entry point, camera refused, manual entry, known barcode, repeated scan | Before the layout fix: PASS once, FAIL twice (remount). After it: PASS in two consecutive runs. Headless Chromium reported the camera as not supported. |
| 2. Unknown barcode by hand with opening stock | Before the layout fix: FAIL (remount). After it: PASS, PASS |
| 3. Database suggestion shown for confirmation (live ProductGuru) · 4. Reply lost after the server saved, then Try again (HTTP 200, `idempotent: true`) · 5. Review lists missing details, Fix edits MRP through PATCH (200) and the gap clears · 6. Unfinished product survives leaving the page; Continue restores it; Discard after confirmation · 7. Business B on the same browser sees none of A's draft, rows or barcode; A's draft is still there afterwards | After the layout fix: PASS, PASS (not run before it). Test 5 was changed to add its own item, because each Playwright test has its own browser storage. |
| Runner database checks (after each run) | PASS both runs: Manual item, Harpic 500 ml (source productguru), Retry item and Review item each exist once with one stock movement, stock 7, 3, 5, 2 and opening value ₹84, ₹240, ₹45, ₹20; items created in business B 0; unsaved drafts on the server 0 |
| Fixture cleanup | `leftover SCAN-E2E businesses 0` |

Defects the browser run found:

1. **Scanner closed itself right after login. Fixed.** The cached capability snapshot is provisional for the first seconds (no features, not owner) but already marked loaded, so the scanner's own plan check closed it. Scan & Add now passes `feature={null}`: its route is plan-gated by `plan-path-gate` and its APIs check the plan on the server. Billing's scanner keeps its `advanced_barcode` check.
2. **A late first session load reset a scan in progress. Fixed** in `app/(app)/items/scan-add/page.tsx`: the draft load resets the screen only on a real business or user switch; on first load it merges with what is already on screen.
3. **The whole app remounted a few seconds after load. Fixed 2026-10-24 (approved).** `app/(app)/layout.tsx` returned `accessibilityOn ? <AccessibilityProvider>{shell}</AccessibilityProvider> : shell`, so when the plan arrived the tree was re-wrapped and every page under `(app)` lost its state (measured 8.5 s and 17 s after load). Now the layout always renders `<AccessibilityProvider enabled={accessibilityOn}>`, and the provider adds its skip link, live region and keyboard-focus class only when enabled. The browser spec no longer waits for the plan snapshot, and all 7 scenarios passed twice.

### Not run

- Real Android device or emulator.
- Label reading by Gemini (no key locally).
- Other pages under `(app)` were not clicked through after the layout change. Only the Scan & Add pages and the item edit form were.

### Release blockers

1. No device run of the phone camera and photo capture.
2. Label reading never run against the model.

### Security regression after the PATCH and layout changes

| Command | Database | Result |
| --- | --- | --- |
| `npm run test:qa:security-live` | `kh_phase2_test`, port 5433 | **FAIL, runner stopped early.** Middleware 4 passed, cron 4 passed, database identity files 52 passed, Phase 3M `pass=108 fail=1`. The one failure is the known expense script without a retry key (`8468a49e`), unchanged. 3N, 3O and reports did not run inside the runner. |
| `node tests/live/phase3n-http.mjs`, `phase3o-http.mjs`, `coa-reports-http.mjs`, run separately | `kh_phase2_test`, port 5433 | 49, 19 and 32 passed, 0 failed. Leftover COA-RPT businesses 0, leftover ledger lines 0. Separate runs, not a pass of the runner. |

### Browser run commands

`node tests/live/scan-add-e2e.mjs` (runs `e2e/scan-add-items.spec.ts`, Chromium, server `127.0.0.1:3131`). Two consecutive runs after the layout fix: 7 passed, 0 failed, playwright exit 0, database checks passed, leftover SCAN-E2E businesses 0.

## Gaps

- No browser or device run of any Scan & Add screen. The local preview needs a test password that the project does not hold.
- Label reading was not run against Gemini.
- `PATCH /api/items/[id]` without a session: closed on 2026-10-24, see Hardening A.
- Phone failed saves are not kept after Scan & Add is closed.
- A stock batch goes out of date when stock arrives without a batch number. Billing never blocks, but no batch is reduced for that sale.
