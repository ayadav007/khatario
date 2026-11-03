# Bazaar Bright Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Bazaar Bright premium kirana theme.

**What it builds:**
- Baloo 2 font
- Pack chips you can add from on cards
- Price per kg or litre
- Rupee savings badge
- Pack tiles on the product page
- Store hours: owner settings, open/closed badge, closed notice
- Store info section
- Buy again
- Cart drawer: free-delivery bar, suggestions, Order on WhatsApp
- The `bazaar` preset, the kirana demo store and the theme store entry

**Architecture:**
- Each engine piece is additive: a new setting, block, section, card line, column or route whose default draws today's output. `sanitizeThemeData` fills missing values without a conversion.
- Pure helpers live in `lib/store/...` with unit tests; renderers stay thin.
- Data reaches the client through `StoreBusinessContext` (`lib/store/resolve-store.ts`) and `EngineShell` props.
- The preset is one file built only from registry sections, like `presets/drop.ts`.

**Tech Stack:** Next.js 14 app router, React 18, TypeScript, Postgres, Jest + ts-jest (`npx jest <path>`; node env, `.ts` tests only), `next/font/google`.

**Spec:** `docs/superpowers/specs/2026-11-03-store-bazaar-bright-theme-design.md` (all of it). The cart pieces also follow `docs/superpowers/specs/2026-11-02-store-drop-culture-theme-design.md` §2.11.

## Global Constraints

- **Migrations:** written under `database/migrations/` and applied to `kh_phase2_test` only, never staging or production. DB tests run with `PHASE2_TEST_DATABASE_URL` set, `--runInBand`.
- **Git:** stage files by name; commit on `main` after each task; never push.
- **Server trust:** never trust client-sent `business_id`, `user_id` or customer ids; the business comes from the store, the customer from the session cookie.
- **Defaults keep today's output:**

| Setting | Default |
|---|---|
| Card line `packs` | off |
| `unit_price` | `false` |
| `discount_badge` | `'percent'` |
| `variant_picker.style` | `'buttons'` |
| `show_open_status` | `false` |
| `cart_free_ship_bar` | `false` |
| `cart_suggestions` | `false` |
| `cart_suggestions_heading` | `'Pair it with'` |
| `cart_whatsapp_order` | `false` |
| `store_hours` | null |

  Every existing preset's sanitised output is unchanged apart from these (Task 11 proves it).
- **Ids exactly:**
  - Font `baloo`; card line `packs`; card settings `unit_price`, `discount_badge` (`percent` \| `rupees`).
  - Block setting `variant_picker.style` (`buttons` \| `tiles`); header setting `show_open_status`; sections `store-info`, `buy-again`.
  - Theme settings `cart_free_ship_bar`, `cart_suggestions`, `cart_suggestions_heading`, `cart_whatsapp_order`.
  - Column `business_settings.store_hours`; preset `bazaar`; theme store slug `bazaar-bright`; demo subdomain `demo-bazaar-bright`; catalogue `kirana`.
- **Store hours are Asia/Kolkata always**, one `{ open, close }` per day (`HH:MM`, close later than open), `null` = closed that day. Orders are still taken when closed.
- **Copy exactly as the spec writes it:**
  - Badge labels: "Open · till 10 PM", "Closed · opens 7 AM", "Closed · opens tomorrow 7 AM", "Closed · opens Mon 7 AM".
  - Closed notice: "We're closed now. Orders placed now are delivered after we open at 7 AM."
  - Button: "Order on WhatsApp instead".
  - WhatsApp message format as in spec §2.9.
- **Bazaar Bright schemes ignore the store accent;** saffron is `#e8590c`.
- **Demo content:** unbranded product names; no real phone numbers.
- **After the last task:** run `graphify update .`.

## Review Focus

1. **Store hours must be read in India time whatever the server or visitor clock says.** A server in UTC at 02:00 UTC is 07:30 IST, so the shop is open. A shopper abroad still sees the shop's hours. Test in Task 5.
2. **Packs on the same product must not merge in the cart.** Adding 1 kg then 5 kg of the same product makes two cart lines. The stepper on each chip controls only its own line. Test in Task 3.
3. **Buy again must never show another customer's or another business's orders, or a product now hidden.**
   - A product whose variant was later deleted shows without that pack.
   - The DB test is in Task 8.
4. **The price per unit must never mislead.** "Pack of 2", "5-in-1 masala", "Room no 12" and "2 × 6 pcs" give no per-unit price. "1kg", "1 KG", "1.5 kg" and "500g x 2" read correctly. Test in Task 2.
5. **The WhatsApp message must survive any product name.**
   - `&`, `#`, `+`, newlines and Hindi characters are encoded.
   - A long cart is cut at 30 lines plus "…and N more items".
   - The link must stay under 2,000 characters.
   - Test in Task 10.

---

### Task 1: Baloo 2 font

**Files:**
- Modify: `lib/store/store-theme.ts:83-100` (`STORE_FONT_FAMILIES`), `:567` (`storeFontStack`)
- Modify: `lib/store/engine/editor/fields.ts:199` (`FONT_LABELS`)
- Modify: `app/store/layout.tsx` (declaration and root class)
- Test: `tests/lib/store/store-theme-fonts.test.ts`, `tests/lib/store/engine/settings.test.ts`

**Interfaces:**
- Produces: `'baloo'` in `StoreFontFamily`. `storeFontStack('baloo') === 'var(--font-store-baloo), system-ui, sans-serif'`, and the label is `Baloo 2`.

- [ ] **Step 1: Write the failing tests.**
  - `it('lists baloo and maps it to its variable')`, asserting the exact stack.
  - `it('accepts baloo as a heading font')`, through `sanitizeThemeData`.
  - `it('labels baloo as Baloo 2')`, on `FONT_OPTIONS`.
- [ ] **Step 2:** Run `npx jest tests/lib/store/store-theme-fonts.test.ts tests/lib/store/engine/settings.test.ts tests/lib/store/engine/editor-fields.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Declare `Baloo_2({ subsets: ['latin', 'devanagari'], weight: ['500','600','700','800'], variable: '--font-store-baloo', display: 'swap', preload: false })`. Check `node_modules/next/dist/server/capsize-font-metrics.json` for "Baloo 2"; add `adjustFontFallback: false` only if it is missing.
- [ ] **Step 4:** Run the same tests and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 2: Price per unit and the rupee savings badge

**Files:**
- Create: `lib/store/unit-price.ts`
- Modify: `lib/store/engine/product-card.ts` (`ProductCardSettings`, defaults, sanitiser lists)
- Modify: `lib/store/engine/theme-settings-schema.ts` (Price group: `unit_price` checkbox "Show price per kg or litre"; Badges group: `discount_badge` select "Savings badge": `percent` "14% OFF", `rupees` "₹91 OFF")
- Modify: `lib/store/engine/card-badges.ts` (`tileBadges`)
- Modify: `components/store/studio-theme/StudioSections.tsx` (price line shows unit price), `components/store/StoreProductCard.tsx` (passes the label)
- Test: new `tests/lib/store/unit-price.test.ts`, `tests/lib/store/engine/card-badges.test.ts`, `tests/lib/store/engine/product-card.test.ts`

**Interfaces:**
- Produces:
  - `unitPrice(label: string | null | undefined, price: number): string | null`.
  - `packLabelFromName(name: string): string | null` returns the last number-and-unit in a product name.
  - `tileBadges(off: number, badges, hideDiscountBadge?, opts?: { rupeesOff?: number; format?: 'percent' | 'rupees' })`.
  - `ProductCardSettings.unit_price: boolean` and `discount_badge: 'percent' | 'rupees'`.

- [ ] **Step 1: Write the failing tests.**
  - `it('reads weights and volumes')`:

| Input | Expected |
|---|---|
| `('500 g', 30)` | `'₹60/kg'` |
| `('1kg', 110)` | `'₹110/kg'` |
| `('1.5 KG', 165)` | `'₹110/kg'` |
| `('200ml', 18)` | `'₹90/L'` |
| `('1 L', 58)` | `'₹58/L'` |
| `('1 litre', 58)` | `'₹58/L'` |
| `('4 × 100 g', 90)` | `'₹225/kg'` |
| `('500g x 2', 100)` | `'₹100/kg'` |
| `('100 g', 8)` | `'₹80/kg'` |
| `('2 kg', 15)` | `'₹7.5/kg'` |

  - `it('gives nothing when it cannot be sure')`: `'Pack of 2'`, `'5-in-1 masala'`, `'Room no 12'`, `'6 pcs'`, `'2 × 6 pcs'`, `'1 dozen'`, `''` and `null` all give `null`.
  - `it('takes the pack from a product name')`: `packLabelFromName('Tomatoes, 1 kg') === '1 kg'`, and `packLabelFromName('Masala jar set') === null`.
  - `it('shows rupees off when asked')`: `tileBadges(14, [], false, { rupeesOff: 91, format: 'rupees' })` puts `'₹91 OFF'` first; the default format is unchanged (`'14% OFF'`).
  - `it('adds unit_price off and discount_badge percent by default')`, and a sanitiser fallback for `discount_badge: 'RUPEES'` (gives `'percent'`).
- [ ] **Step 2:** Run `npx jest tests/lib/store/unit-price.test.ts tests/lib/store/engine/card-badges.test.ts tests/lib/store/engine/product-card.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Rounding: whole rupees from ₹10 up, one decimal below, with no trailing `.0`.
  - The card label is the chosen pack's label (Task 3 passes it). Without variants, use `packLabelFromName(product.name)`.
  - Draw the unit price under the price in `.punit` when `look.unit_price` is on.
- [ ] **Step 4:** Run the same tests and `npx jest tests/lib/store/engine`. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 3: Pack chips you can pick and add from

**Files:**
- Create: `lib/store/engine/card-packs.ts`
- Modify: `lib/store/engine/product-card.ts` (`CARD_LINE_IDS` adds `packs` after `price`; `DEFAULT_LINES` adds `{ id: 'packs', on: false }`)
- Modify: `lib/store/engine/theme-settings-schema.ts` (line label `['packs', 'Pack sizes to pick']`)
- Modify: `components/store/StoreProductCard.tsx` (chosen pack state, add with variant, stepper per variant), `components/store/studio-theme/StudioSections.tsx` (`case 'packs'`), `components/store/engine/product-card.css` (`.ppacks`)
- Test: new `tests/lib/store/engine/card-packs.test.ts`, `tests/lib/store/engine/product-card.test.ts`, `tests/lib/store/engine/shared.test.ts`

**Interfaces:**
- Consumes: `variantOptions` (`lib/store/variant-options.ts`), `initialVariantId` (`components/store/features/product/product-logic.ts`), `unitPrice` (Task 2).
- Produces:
  - `cardPacks(variants: StoreVariantInput[], max = 4): { packs: { id: string; label: string; price: number; stock: number; soldOut: boolean }[]; more: number; axisCount: number }`. The label is the single axis's value for that variant.
  - `packPriceShowsMrp(packPrice: number, productPrice: number): boolean`.
  - `cartLineFor(cart: StoreCartItem[], itemId: string, variantId: string | undefined): StoreCartItem | undefined`.

- [ ] **Step 1: Write the failing tests.**
  - `it('lists one-axis packs in order')`: covers a `size` key, a `weight` key and name-only variants.
  - `it('reports two axes so the card falls back')`: `axisCount: 2`, `packs: []`.
  - `it('cuts at four with more')`.
  - `it('marks sold-out packs')`.
  - `it('shows MRP only for the product's own price')`: `packPriceShowsMrp(549, 549) === true` and `packPriceShowsMrp(1050, 549) === false`.
  - `it('keeps packs of one product apart in the cart')`: a cart with `{itemId:'a', variantId:'1kg'}` and `{itemId:'a', variantId:'5kg'}`; `cartLineFor` returns each separately and undefined for `'10kg'`.
  - Line tests:
    - `packs` sits after `price` and is off by default.
    - Saved cards get `packs` appended off.
    - Update the pinned line lists in `product-card.test.ts` and `shared.test.ts` by inserting `packs` only.
- [ ] **Step 2:** Run the three test files. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Before wiring add, read `components/store/StoreProvider` / `lib/store/store-context.tsx` and confirm `addToCart` merges lines by `(itemId, variantId)`. If it merges by `itemId` alone, stop and report NEEDS_CONTEXT.
  - The card starts on `initialVariantId(variants)`.
  - Chips are buttons (`aria-pressed`). Sold-out chips are disabled, and `+N` opens `onOptions` on phones or the product link otherwise.
  - ADD adds `{ itemId, variantId, variantName: label, price, maxStock: stock, mrp: packPriceShowsMrp ? product.mrp : undefined }`.
  - Once that line exists, the button is the stepper for that line.
  - Price, MRP and the badge follow the chosen pack. The unit price uses the chosen label.
  - With `axisCount !== 1` or no `packs` line, the card behaves exactly as today.
- [ ] **Step 4:** Run the tests and `npx jest tests/lib/store`. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 4: Pack tiles on the product page and the savings line

**Files:**
- Modify: `lib/store/engine/sections/main-product.ts:54` (`variant_picker` setting `style`: select `buttons` "Buttons" \| `tiles` "Tiles with price", default `buttons`)
- Modify: `components/store/features/product/VariantPicker.tsx` (`tiles` prop), `components/store/engine/product/ProductBlocks.tsx` (`VariantBlock` passes it; `PriceBlock` shows "You save ₹N")
- Modify: `components/store/engine/product/product-blocks.ts` (`youSave`)
- Test: `tests/lib/store/engine/product-blocks.test.ts`, `tests/lib/store/engine/section-schemas.test.ts`

**Interfaces:**
- Consumes: `cardPacks`, `packPriceShowsMrp` (Task 3), `unitPrice` (Task 2).
- Produces: `youSave(price: number, productPrice: number, mrp: number | null): number | null`. It returns `mrp - price` only when `packPriceShowsMrp(price, productPrice)` and `mrp > price`.

- [ ] **Step 1: Write the failing tests.**
  - `it('offers tiles on the Options block, default buttons')`.
  - `it('says you save only for the product's own price')`: `youSave(549, 549, 640) === 91`, `youSave(1050, 549, 640) === null`, and `youSave(549, 549, null) === null`.
- [ ] **Step 2:** Run the two test files. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - With `style: 'tiles'` and exactly one axis, `VariantPicker` draws tiles: label, price, and `unitPrice` when it reads. Sold-out tiles are faded and struck. Selection behaves exactly as the buttons do.
  - With two or more axes it draws buttons.
  - `PriceBlock` shows `You save ₹N` in the sale colour when `youSave` is not null.
  - `low_stock_at` and the fit note stay under the picker.
  - `VariantPicker`'s default output is unchanged (it is shared with the old storefront).
- [ ] **Step 4:** Run the tests and `npx jest tests/lib/store`. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 5: Store hours: data, logic and owner settings

**Files:**
- Create: `database/migrations/463_store_hours.sql` (confirm 463 is free; use the next free number otherwise). Body: `ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS store_hours JSONB;` with a one-line comment.
- Create: `lib/store/store-hours.ts`
- Modify: `lib/store/resolve-store.ts` (select `bs.store_hours`; `StoreBusinessContext.store_hours: StoreHours | null`)
- Modify: `app/api/settings/online-store/route.ts` (GET returns `store_hours`; PATCH accepts it through `sanitizeStoreHours`)
- Modify: `app/(app)/settings/online-store/page.tsx` (a "Store hours" card on Store setup, using the existing `SetupRow` / group card building blocks from `components/store/admin/StoreSetupLayout.tsx`)
- Modify: `lib/store/engine/demo-stores.ts` (demo stores get `store_hours: null` unless set later in Task 12)
- Test: new `tests/lib/store/store-hours.test.ts`, new `tests/db/store-hours.db.test.ts`

**Interfaces:**
- Produces:
  - `type StoreDay = 'mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun'`
  - `type StoreHours = Record<StoreDay, { open: string; close: string } | null>`
  - `sanitizeStoreHours(raw: unknown): StoreHours | null`: drops bad days to `null`; returns null when nothing is valid or input is null.
  - `storeOpenState(hours: StoreHours | null, now: Date): { state: 'open'; closesAt: string } | { state: 'closed'; opensAt: string; opensOn: 'today' | 'tomorrow' | StoreDay } | { state: 'unknown' }`
  - `openStatusLabel(state): string | null`
  - `closedNotice(state): string | null`

- [ ] **Step 1: Write the failing tests.** Use fixed UTC instants; IST is UTC+5:30. Hours are 07:00–22:00 Mon–Sat, with Sunday closed.

| Case | Instant (UTC) | Expected |
|---|---|---|
| Open, Monday 07:30 IST | `Mon 02:00Z` | `{state:'open', closesAt:'22:00'}`; label `Open · till 10 PM` |
| Before opening, 06:00 IST | `Mon 00:30Z` | `{state:'closed', opensAt:'07:00', opensOn:'today'}`; label `Closed · opens 7 AM` |
| After closing, Monday 23:00 IST | `Mon 17:30Z` | opens `tomorrow`; label `Closed · opens tomorrow 7 AM` |
| Saturday 23:00 IST (Sunday closed) | `Sat 17:30Z` | opens `mon`; label `Closed · opens Mon 7 AM` |
| Half-hour times | `09:30`–`21:30` | labels `9:30 AM` and `9:30 PM` |
| `null` hours, or all days closed | any | `{state:'unknown'}`; label `null` |

  - Closed notice: `We're closed now. Orders placed now are delivered after we open at 7 AM.`. With tomorrow: `…after we open tomorrow at 7 AM.`. Nothing when open.
  - `sanitizeStoreHours`: `close` not after `open` gives that day `null`. `'7:00'` (no leading zero) and `'25:00'` are invalid. Unknown keys are dropped. A non-object gives `null`.
  - DB test `it('saves and reads store_hours')` on `kh_phase2_test`: the column exists, and the PATCH path writes the sanitised value (a direct UPDATE plus the resolve-store read is acceptable, as the badge field DB test does).
- [ ] **Step 2:** Run `npx jest tests/lib/store/store-hours.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Apply the migration to `kh_phase2_test` only, with the local-only helper or `PHASE2_TEST_DATABASE_URL`. Never print credentials.
- [ ] **Step 4: Implement.**
  - India time comes from the instant plus 330 minutes, or `Intl.DateTimeFormat` with `timeZone: 'Asia/Kolkata'`. Never the process locale.
  - The settings card has 7 rows: an Open switch and `type="time"` from and to inputs. A "Copy Monday to all days" button. Saved with the rest of Store setup.
- [ ] **Step 5:** Run the unit tests, the DB test (`--runInBand`), `npx jest tests/lib/store` and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 6:** Commit, including the migration.

### Task 6: Open badge in the header and the closed notice

**Files:**
- Modify: `lib/store/engine/sections/header.ts` (`show_open_status` checkbox "Show open or closed", default false, after `delivery_eta`)
- Create: `components/store/engine/OpenStatusBadge.tsx` (client; renders after mount)
- Modify: `components/store/engine/sections/Header.tsx` (passes `store.store_hours` when the setting is on)
- Modify: `components/store/StoreCartDrawer.tsx` and `components/store/StoreCheckout.tsx` (closed notice from `useStore().store?.store_hours`)
- Test: `tests/lib/store/engine/section-schemas.test.ts`

**Interfaces:**
- Consumes: `storeOpenState`, `openStatusLabel`, `closedNotice` (Task 5).
- Produces: `<OpenStatusBadge hours={StoreHours | null} />`. It renders null before mount, for `unknown`, and when hours are null.

- [ ] **Step 1: Write the failing test** `it('header has show_open_status off by default')`.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The badge is a pill: green dot when open, grey when closed. It re-checks every minute.
  - The closed notice appears in the cart drawer above the items and on checkout above Place order, in a dark banner. Shown only when the state is `closed`; checkout still works.
  - Stores without hours see no change.
- [ ] **Step 4:** Run `npx jest tests/lib/store` and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 7: Store info section

**Files:**
- Create: `lib/store/engine/sections/store-info.ts`, `components/store/engine/sections/StoreInfo.tsx` (+ a small client part for the live status)
- Create: `lib/store/engine/store-info-map.ts` (pure mapping)
- Create: `lib/store/whatsapp-order.ts` with `whatsappNumber` only (Task 10 adds the message builder to the same file)
- Modify: `lib/store/engine/registry.ts`, `components/store/engine/registry.tsx` (register `store-info`)
- Test: new `tests/lib/store/engine/store-info-map.test.ts`, new `tests/lib/store/whatsapp-order.test.ts` (the number table from Task 10), `tests/lib/store/engine/registry.test.ts`

**Interfaces:**
- Consumes: Task 5 helpers; `store.location_address`, `store.phone`, `theme.settings.social.whatsapp`.
- Produces:
  - The section schema `store-info`: category `Info`; templates `home` and `page`; settings `heading` (text, max 60, default `''`, meaning the store name), `show_hours`, `show_address`, `show_buttons` (checkboxes, default true).
  - `storeInfoView(input): { heading: string; hours: StoreHours | null; address: string | null; callHref: string | null; whatsappHref: string | null; directionsHref: string | null } | null`. Returns null when every part is missing.

- [ ] **Step 1: Write the failing tests.**
  - `it('builds call, WhatsApp and directions links')`:
    - `tel:+919845012345` from `9845012345`.
    - The WhatsApp link (`https://wa.me/<number>`) only when `whatsappNumber(social.whatsapp)` reads. `whatsappNumber` is defined here; its input/output table is in Task 10 and its test moves to this task.
    - Directions: `https://www.google.com/maps/search/?api=1&query=<encoded address>`.
  - `it('hides parts with no data and returns null when all are missing')`.
  - The registry test lists `store-info`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.** The renderer is a card in the section's scheme: heading; today's hours ("Open today 7 AM – 10 PM", or "Closed today") with the live badge; the address; and up to three buttons.
- [ ] **Step 4:** Run `npx jest tests/lib/store/engine`. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 8: Buy again

**Files:**
- Create: `lib/store/buy-again.ts` (query and pure helpers)
- Create: `app/api/public/store/[subdomain]/buy-again/route.ts`
- Create: `lib/store/engine/sections/buy-again.ts`, `components/store/engine/sections/BuyAgain.tsx` (client fetch, then a rail or grid of store cards)
- Modify: both registries
- Test: new `tests/lib/store/buy-again.test.ts`, new `tests/db/buy-again.db.test.ts`, `tests/lib/store/engine/registry.test.ts`

**Interfaces:**
- Consumes: `readStoreCustomer`, `STORE_CUSTOMER_COOKIE` (`lib/store/customer-session`); `buildStoreItemsQuery` and `mapStoreItemRow` (the shared items select, so visibility rules match the catalogue).
- Produces:
  - `buyAgainPairs(rows: { item_id: string; variant_id: string | null; ordered_at: string }[], limit: number): { itemId: string; variantId: string | null }[]`: distinct pairs, newest first.
  - Route response: `{ items: (StoreItem & { buy_again_variant_id: string | null })[] }`.
  - Section schema `buy-again`: category `Products`; templates `home` and `catalog`; settings `heading` (default `Buy again`), `max_items` (range 4–12, default 8), `style` (`rail` \| `grid`, default `rail`).

- [ ] **Step 1: Write the failing tests.**
  - Pure: `it('keeps distinct item-and-pack pairs, newest first, up to the limit')`. Two orders of the same pack count once; two packs of one product count twice.
  - DB, on `kh_phase2_test`, with two businesses, two customers and orders, including a cancelled one:
    - `it('returns only this customer\'s own orders in this store')`.
    - `it('leaves out cancelled orders and hidden products')`.
    - `it('drops a deleted pack but keeps the product')`.
    - `it('returns nothing without a session')`.
  - Registry lists `buy-again`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Route.**
    - Resolve the store from the subdomain, and the customer from the cookie (business must match).
    - Select order lines of that customer's non-cancelled store orders (newest first, limit 60), then `buyAgainPairs(…, 12)`.
    - Load the items through the shared store items query with `ids`, and attach the variant id when it still exists.
    - Demo stores (`is_demo`) return their catalogue's `DEMO_BUY_AGAIN` ids (Task 12 fills them; empty until then).
    - `Cache-Control: private, no-store`.
  - **Section.**
    - Fetch after mount and render nothing until there are items. Cards use the store card with that pack preselected.
    - The rail scrolls on phones and shows up to 6 across on computers.
- [ ] **Step 4:** Run the unit test, the DB test (`--runInBand`), `npx jest tests/lib/store` and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 9: Cart drawer: free-delivery bar and suggestions

**Files:**
- Modify: `lib/store/engine/types.ts` (`ThemeSettings` gains `cart_free_ship_bar: boolean`, `cart_suggestions: boolean`, `cart_suggestions_heading: string`, `cart_whatsapp_order: boolean`)
- Modify: `lib/store/engine/sanitize.ts` (`sanitizeThemeSettings`: booleans default false; heading trimmed, max 40, default `Pair it with`)
- Modify: `lib/store/engine/presets/look.ts` `presetSettings` (defaults)
- Modify: `lib/store/engine/theme-settings-schema.ts` (a "Cart" group with the four settings)
- Modify: `components/store/engine/EngineShell.tsx` (passes `engineCart` to `StoreCartDrawer`)
- Modify: `components/store/StoreCartDrawer.tsx` (bar and suggestions)
- Create: `lib/store/cart-suggestions.ts`
- Test: new `tests/lib/store/cart-suggestions.test.ts`, `tests/lib/store/engine/sanitize.test.ts`, `tests/lib/store/quick.test.ts` (if `freeDeliveryProgress` text helpers are added there)

**Interfaces:**
- Consumes: `freeDeliveryProgress` (`lib/store/quick.ts`), the branch `free_delivery_above` already read in `EngineShell`.
- Produces:
  - `engineCart?: { freeAbove: number | null; freeShipBar: boolean; suggestions: boolean; suggestionsHeading: string; whatsappOrder: boolean; whatsappLink: string; isDemo: boolean }`. It is a prop of `StoreCartDrawer`; the old storefront passes nothing.
  - `freeShipText(progress): string`: "Add ₹N more for free delivery", or "You have free delivery".
  - `pickSuggestions(candidates: StoreItem[], cartItemIds: Set<string>, limit = 4): StoreItem[]`: in stock, not in the cart, in candidate order.

- [ ] **Step 1: Write the failing tests.**
  - Free-delivery text at, under and over the limit, and with no limit (no bar).
  - `pickSuggestions` excludes cart items and out-of-stock items, and caps at 4.
  - The sanitiser:
    - Defaults are false, false, `Pair it with`, false.
    - `cart_suggestions_heading` is trimmed and clipped to 40.
    - Every existing preset's sanitised settings gain only these four keys.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The bar sits above the items when `freeShipBar` and `freeAbove` are set.
  - Suggestions load once per drawer open from the public items API, using the cart products' categories, in stock, `sort=new`, limit 12. Then `pickSuggestions`, and a row of up to 4 small cards with `+`. A product with variants opens its page.
  - The heading is `suggestionsHeading`; the row is hidden when empty.
  - Leave `whatsappOrder` for Task 10.
- [ ] **Step 4:** Run `npx jest tests/lib/store` and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 10: Order on WhatsApp

**Files:**
- Create: `lib/store/whatsapp-order.ts`
- Modify: `components/store/StoreCartDrawer.tsx` (the button under Checkout)
- Test: new `tests/lib/store/whatsapp-order.test.ts`

**Interfaces:**
- Consumes: `engineCart.whatsappOrder`, `whatsappLink` and `isDemo` (Task 9); `whatsappNumber` (Task 7).
- Already in the file from Task 7 (the table below is its contract):
  - `whatsappNumber(link: string): string | null`. Reads digits from `wa.me/<n>` or `api.whatsapp.com/send?phone=<n>`. Accepts a 10-digit Indian mobile (prefixed with 91) or 12 digits starting `91`; anything else gives null.
- Produces:
  - `whatsappOrderText(storeName: string, lines: { name: string; pack?: string; quantity: number; price: number }[], pincode?: string): string`. Exact format from spec §2.9; amounts in `en-IN` rupees; more than 30 lines gives 30 plus `…and N more items`.
  - `whatsappOrderUrl(number: string, text: string): string`.

- [ ] **Step 1: Write the failing tests.**
  - `it('builds the message exactly')`, comparing against the spec §2.9 text for two lines plus pincode 560034, and without a pincode.
  - `it('encodes any product name')`: names with `&`, `#`, `+`, a newline and `दाल`. `decodeURIComponent` of the URL's `text` equals the message, and the URL has no raw newline.
  - `it('cuts long carts and stays under 2000 characters')`, with 80 lines.
  - `it('reads the number from a WhatsApp link')` (written in Task 7; Task 10 leaves it as is):

| Input | Expected |
|---|---|
| `https://wa.me/919845012345` | `'919845012345'` |
| `https://wa.me/9845012345` | `'919845012345'` |
| `https://api.whatsapp.com/send?phone=919845012345` | `'919845012345'` |
| `https://instagram.com/x` | `null` |
| `''` | `null` |
| `https://wa.me/12345` | `null` |

- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The button is green, labelled `Order on WhatsApp instead`, and shown only when `whatsappOrder` is on and `whatsappNumber` reads.
  - It opens the URL in a new tab with the shopper's saved pincode (`storePinKey`, wrapped in try/catch). The cart is not cleared.
  - In demo stores it shows a small notice `This is a demo store` instead of opening WhatsApp.
- [ ] **Step 4:** Run the test and `npx jest tests/lib/store`. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 11: The Bazaar Bright preset

**Files:**
- Create: `lib/store/engine/presets/bazaar.ts`
- Create: `public/store-presets/bazaar/` SVGs: `hero-1`, `promo-1`, `promo-2`, `catalog-promo`, `category-1`…`category-8`. Flat shapes in the scheme colours, each under 4 KB.
- Modify: `lib/store/engine/types.ts`, `lib/store/engine/root-class.ts`, `lib/store/engine/presets/look.ts` (`PRESET_LOOK.bazaar`, `PRESET_SCHEMES.bazaar`), `lib/store/engine/card-look.ts` (`PRESET_CARD_FIELDS.bazaar`), `lib/store/engine/presets/index.ts`. Also every other list `grep -rn "'drop'" lib/store/engine app/api/settings/online-store` finds outside `theme-catalog.ts` and `demo-stores.ts`.
- Test: `tests/lib/store/engine/preset-look.test.ts`, `tests/lib/store/engine/presets.test.ts`, `tests/lib/store/engine/root-class.test.ts`

**Interfaces:**
- Consumes: every earlier task's ids.
- Produces: `bazaarPreset(ctx: PresetContext): ThemeData` and `presetTheme('bazaar', ctx)`.

**Preset values** (spec §3, verbatim):

`PRESET_LOOK.bazaar`: `{ canvas: '#ffffff', accent: '#e8590c', font_heading: 'baloo', font_body: 'poppins', button_radius: 12, card_style: 'bordered', label_style: 'normal', frame_style: 'none', texture: 'none' }`.

`PRESET_SCHEMES.bazaar`, ids `scheme-1`…`scheme-6`:
- `border = mixHex(text, bg, 0.12)`, `card = mixHex(text, bg, 0.04)`.

| Id | Name | `background` | `text` | `accent` | `button` | `button_text` |
|---|---|---|---|---|---|---|
| `scheme-1` | White | `#ffffff` | `#14213d` | `#e8590c` | `#e8590c` | `#ffffff` |
| `scheme-2` | Cream | `#fff6ea` | `#14213d` | `#e8590c` | `#14213d` | `#ffffff` |
| `scheme-3` | Saffron | `#e8590c` | `#ffffff` | `#ffc300` | `#14213d` | `#ffffff` |
| `scheme-4` | Navy | `#14213d` | `#ffffff` | `#ffc300` | `#ffc300` | `#14213d` |
| `scheme-5` | Marigold | `#ffc300` | `#14213d` | `#14213d` | `#14213d` | `#ffffff` |
| `scheme-6` | Leaf | `#2a9d4b` | `#ffffff` | `#ffffff` | `#ffffff` | `#1d6b33` |

**Card** (`product_card`):

| Setting | Value |
|---|---|
| `design` | `'grocery'` |
| `image_shape` | `'square'` |
| `image_bg` | `'#fff6ea'` |
| `radius` | `18` |
| `border` | `1` |
| `badge_shape` | `'pill'` |
| `discount_badge` | `'rupees'` |
| `unit_price` | `true` |
| `button_style` | `'full'` |
| `after_add` | `'stepper'` |
| `oos_look` | `'faded'` |
| `oos_place` | `'end'` |
| `lines` | `name`, `packs`, `price`, `buttons` on, then `brand`, `unit`, `rating`, `tagline`, `swatches`, `sizes` off (every id in `CARD_LINE_IDS` once) |

**Settings:** `cart_free_ship_bar`, `cart_suggestions` and `cart_whatsapp_order` true; `cart_suggestions_heading: 'You may also need'`.

**Pages** (spec §3):
- **Header group:** Announcement (Navy, the spec text) and Header (Saffron), with `show_open_status: true`, the search placeholder from the spec and category chips on.
- **Home:**
  1. Category grid `Shop by category` (photo tiles).
  2. Image banner (Navy, picture behind words), with blocks: eyebrow `Maha Bachat Week`, heading `Up to 40% off on staples` (xl), countdown with `ends_at: ''`, button `Shop deals` → `/catalog`.
  3. Buy again.
  4. Featured products `Today's deals` (`source: 'discounted'`, 5 columns on desktop, 2 on mobile).
  5. Promo cards: `Fresh every morning` / `Sabzi from the mandi` and `Monthly ration pack` / `Save on atta, rice and dal`.
  6. Category shelves.
  7. Multicolumn (Cream), with the four trust items from the spec.
  8. Store info.
  9. Newsletter `Get offers first` (Cream).
- **Catalog:** Main catalog with `layout: 'rail'`, `columns_desktop: 4`, `columns_mobile: 2`, filters and sort on, and one promo block `Monthly ration` / `Atta + rice + dal, save ₹250` (`catalog-promo`, position 5).
- **Product:**
  - Main product with `thumbs: 'bottom'`, `sticky_info: true` and `sticky_buy_bar: true`.
  - Blocks:
    - title
    - price
    - `variant_picker` with `style: 'tiles'` and `low_stock_at: 3`
    - `buy_buttons`
    - `delivery_check`
    - `description`
    - three `collapsible_tab`s: `Product details`, `Storage and shelf life`, `Returns`
  - Then Related products `You may also need`, Recently viewed.
- **Footer:** Navy, with payment icons.

- [ ] **Step 1: Write the failing tests.**
  - `bazaar ignores the store accent`.
  - `every bazaar accent, button and button text reads 3:1` (`contrastRatio`).
  - The `PRESET_LOOK.bazaar` equality.
  - `bazaar uses only registry sections and unique ids`.
  - `bazaar turns on its pieces`: `packs` on after name; `unit_price`; `discount_badge: 'rupees'`; the four cart settings; header `show_open_status`; `variant_picker.style: 'tiles'`; `buy-again` and `store-info` on home; the catalog `layout: 'rail'`.
  - `sanitizeThemeData(bazaar)` equals bazaar for four contexts, including a long name with `&` and `<`.
  - `existing presets keep the new pieces off`, for studio, quick, grocery, khatario, blank, heritage and drop: `packs` off, `unit_price` false, `discount_badge` `percent`, every `variant_picker.style` `buttons`, header `show_open_status` false, the cart settings off, and no `buy-again` or `store-info` section. `preset-parity.test.ts` passes unchanged.
  - `root-class` adds `eng-preset-bazaar`.
  - The sample pictures exist and are under 4 KB.
- [ ] **Step 2:** Run the four test files. Expected: FAIL.
- [ ] **Step 3:** Implement the preset, the lists and the SVGs. Neutral copy.
- [ ] **Step 4:** Run them and `npx jest tests/lib/store`. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task 12: Kirana demo store and theme store entry

**Files:**
- Modify: `lib/store/engine/theme-catalog.ts` (`DemoCatalogId` adds `'kirana'`; the entry after Drop)
- Modify: `lib/store/engine/demo-catalogs.ts` (`KIRANA` and `DEMO_BUY_AGAIN.kirana`)
- Modify: `lib/store/engine/demo-stores.ts` (Bazaar pictures via `ctx.images`; demo `store_hours` 07:00–22:00 every day; category tiles mapped to kirana categories, as Drop's are)
- Modify: `app/api/settings/online-store/themes/route.ts` (`PRESETS` gains `'bazaar'`, if Task 11's grep did not already add it)
- Modify: `scripts/theme-demo-photos.json`, then run `node scripts/theme-demo-photos.mjs` (new `public/theme-demos/kirana/*.webp`, `CREDITS.md`)
- Test: `tests/lib/store/engine/theme-catalog.test.ts`, `tests/lib/store/engine/demo-catalogs.test.ts`, `tests/lib/store/engine/demo-stores.test.ts`, `tests/lib/store/engine/premium-route.test.ts`

**Interfaces:**
- Consumes: `presetTheme('bazaar', ctx)` (Task 11); `DEMO_BUY_AGAIN` (read by Task 8's route).
- Produces: the theme store entry, verbatim from spec §3 (slug, name, premium, categories, palette, canvas, accent, summary, the six features, `added: '2026-11-03'`, demo).

- [ ] **Step 1: Write the failing tests.**
  - `lists Bazaar Bright as premium with its demo store`.
  - `kirana products`:
    - 18–22 products, unbranded, across Vegetables, Fruits, Dairy & eggs, Atta rice & dal, Masala, and Snacks & drinks.
    - At least 12 with exactly one pack axis.
    - The bigger packs are cheaper per kg or L (via `unitPrice`).
    - At least two sold-out packs and at least three `store_badge`s.
    - No product name contains a brand listed in the test (India Gate, Aashirvaad, Tata, Fortune, Amul, Britannia).
  - `draws the bazaar demo store with hours and buy-again ids that exist in the catalogue`.
  - `POST bazaar is refused with premium_locked when off and created when on`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3: Get the photos.**
  - Unsplash or Pexels only, of atta or flour, dal, oil, onions, sugar and tea (reuse the existing `grocery/` photos for the rest).
  - No brand marks, viewed before keeping.
  - Credits must contain no unescaped `|`.
- [ ] **Step 4:** Implement the catalogue, demo pictures, hours, category mapping and the entry.
- [ ] **Step 5:** Run them, `npx jest tests/lib/store` and `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 6:** Commit the code, photos, `CREDITS.md` and JSON by name.

### Task 13: Wrap up

**Files:**
- Modify: `docs/project.log.md` (one entry), `docs/roadmap.md` (Bazaar Bright card), `docs/SERVER_INFRASTRUCTURE.md` (migration 463 note: `resolve-store` reads `store_hours` on every store page, so 463 must run before this code)

- [ ] **Step 1:** Run `npx jest tests/lib/store` and `npx tsc --noEmit`. Expected: all pass, no errors.
- [ ] **Step 2:** Run `graphify update .`.
- [ ] **Step 3:** Append the log entry (asked, decided, shipped with short hashes, open: migration 463 on staging first, and the staging checks from spec §5), then commit the docs by name.
