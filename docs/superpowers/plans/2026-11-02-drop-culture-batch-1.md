# Drop Culture, batch 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Drop Culture premium theme with the eight engine pieces it needs to launch: Anton and Space Grotesk, a countdown block in the hero, size chips on cards, "Only N left" per size, a per-product fit note, a delivery check, a sticky Add to bag bar on phones and photos in a grid. Add the preset, a streetwear demo store and the theme store entry.

**Architecture:**
- Every engine piece is additive. It is a new setting, block, card line or column whose default draws today's output, so `sanitizeThemeData` fills it for saved themes without a conversion.
- Pure, client-safe helpers live in `lib/store/...` and are unit-tested. Renderers stay thin.
- The preset is one file built only from registry sections, like `heritage.ts`.

**Tech Stack:** Next.js 14 app router, React 18, TypeScript, Postgres, Jest + ts-jest (`npx jest <path>`; node env, `.ts` tests only), `next/font/google`.

**Spec:** `docs/superpowers/specs/2026-11-02-store-drop-culture-theme-design.md`: §2.1–2.3, §2.5–2.9, §3, and the batch 1 row of §4. Batch 2 (size filter, cart drawer) and batch 3 (reels, phone sign-up) get their own plans.

## Global Constraints

- **Migrations:** written under `database/migrations/` and applied to `kh_phase2_test` only, never staging or production (AGENTS.md). DB tests run with `PHASE2_TEST_DATABASE_URL` set.
- **Git:** stage files by name; commit on `main` after each task; never push. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Defaults keep today's output:**

| Setting | Default |
|---|---|
| Card line `sizes` | off |
| Hero `countdown` block | absent |
| `low_stock_at` | `0` |
| `sticky_buy_bar` | `false` |
| `thumbs` | `side`, and `grid` only when chosen |
| `delivery_check` block | absent from existing templates |

  Every existing preset's sanitised output is unchanged apart from these defaults (Task 9 proves it).
- **Limits from the spec:**
  - Fit note: 80 chars.
  - Countdown block: one per hero; label 40 chars.
  - Size chips: 6, then `+N`.
  - `low_stock_at`: 0–10.
  - Delivery check: heading 40 chars, button label 20 chars.
- **Ids exactly as the spec writes them:**
  - Preset `drop`; fonts `anton`, `space-grotesk`.
  - Card line `sizes`; block types `countdown` and `delivery_check`.
  - Settings `low_stock_at`, `sticky_buy_bar`, `thumbs: 'grid'`; column `store_fit_note`.
  - Theme store slug `drop-culture`; demo subdomain `demo-drop-culture`, brand `VOLTX`, tagline `Drops every Friday`; catalogue `streetwear`.
- **Drop Culture schemes ignore the store accent** (fixed `PRESET_SCHEMES`, as Heritage).
- **Do not touch** header or footer schemas.
- **After the last task:** run `graphify update .`.

## Review Focus

1. **Sizes typed with different case** (`l` on one variant, `L` on another) must count as one chip, not two. A size whose variants are all at zero stock is struck through, and one with any stock is not. Test in Task 3.
2. **A product with variants but no `size` attribute** (only colour) shows no size chips and no "Only N left in <size>"; the note falls back to the variant name. Test in Tasks 3 and 4.
3. **The countdown's end time:**
   - With `hide_when_over` off, an end time in the past shows zeros, not a negative number.
   - An empty or unreadable `ends_at` hides the block whatever `hide_when_over` says.
   - Test in Task 2.
4. **The sticky bar on a phone** must never sit on top of the bottom navigation or show at the same time as the phone kit cart bar. Test in Task 7 with the pure visibility helper; check on staging.
5. **A fit note of only spaces, or longer than 80 chars,** is stored as null or clipped, never rejected for the whole item save. Test in Task 5.

---

### Task 1: Anton and Space Grotesk

**Files:**
- Modify: `lib/store/store-theme.ts:83-98` (`STORE_FONT_FAMILIES`), `:567` (`storeFontStack`)
- Modify: `lib/store/engine/editor/fields.ts:199` (`FONT_LABELS`)
- Modify: `app/store/layout.tsx` (declarations, root class list at line 152)
- Test: `tests/lib/store/store-theme-fonts.test.ts`, `tests/lib/store/engine/settings.test.ts`

**Interfaces:**
- Produces: `'anton' | 'space-grotesk'` in `StoreFontFamily`.
  - `storeFontStack('anton') === 'var(--font-store-anton), Impact, sans-serif'`
  - `storeFontStack('space-grotesk') === 'var(--font-store-space-grotesk), system-ui, sans-serif'`
  - `settings.ts` `FONTS` picks them up from `STORE_FONT_FAMILIES` with no edit.

- [ ] **Step 1: Write the failing tests.**
  - In `store-theme-fonts.test.ts`: `it('lists anton and space-grotesk')`, and `it('maps them to their variables')` with the two exact stacks above.
  - In `settings.test.ts`: `it('accepts anton and space-grotesk as heading and body fonts')`, saving `font_heading: 'anton', font_body: 'space-grotesk'` through `sanitizeThemeData` and expecting them kept.
- [ ] **Step 2:** Run `npx jest tests/lib/store/store-theme-fonts.test.ts tests/lib/store/engine/settings.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Add both families to `STORE_FONT_FAMILIES` and `storeFontStack`.**
  - Add `FONT_LABELS['space-grotesk'] = 'Space Grotesk'`.
  - In `app/store/layout.tsx`, declare `Anton({ subsets: ['latin'], weight: '400', variable: '--font-store-anton', display: 'swap', preload: false })` and `Space_Grotesk({ subsets: ['latin'], variable: '--font-store-space-grotesk', display: 'swap', preload: false })`, and add both `.variable` classes to the root `div`.
  - If `next build` complains about fallback metrics, add `adjustFontFallback: false` as Newsreader does.
- [ ] **Step 4:** Run the same tests and `npx tsc --noEmit`. Expected: PASS, no type errors.
- [ ] **Step 5:** Commit `lib/store/store-theme.ts lib/store/engine/editor/fields.ts app/store/layout.tsx` and the two tests.

### Task 2: Countdown block in the hero

**Files:**
- Modify: `lib/store/engine/content-blocks.ts` (new `COUNTDOWN_BLOCK`, not added to `CONTENT_BLOCKS`)
- Modify: `lib/store/engine/sections/image-banner.ts:4-14` (append it to `HERO_BLOCKS`)
- Modify: `lib/store/engine/content-blocks-map.ts:10-50` (union member and mapper case)
- Modify: `components/store/engine/sections/EngineCountdown.tsx` (new `EngineInlineCountdown`), `components/store/engine/sections/ContentBlocks.tsx:7` (`renderBlock` case)
- Modify: `components/store/engine/sections/countdown-logic.ts` (new `countdownUnits`)
- Test: `tests/lib/store/engine/content-blocks-map.test.ts`, `tests/lib/store/engine/section-schemas.test.ts`, new `tests/lib/store/engine/countdown-logic.test.ts`

**Interfaces:**
- Produces:
  - `COUNTDOWN_BLOCK: BlockSchema`: `type: 'countdown'`, `name: 'Countdown'`, `limit: 1`, settings `label` (text, max 40, default `Ends in`), `ends_at` (text, max 40, default `''`, same `info` as the Countdown section), `style` (select `boxes` \| `inline`, default `boxes`), `hide_when_over` (checkbox, default true).
  - `ContentBlock` gains `{ type: 'countdown'; label: string; endsAt: string; style: 'boxes' | 'inline'; hideWhenOver: boolean }`.
  - `countdownUnits(parts: CountdownParts | null): [string, number][]` returns `[['Days', d], ['Hrs', h], ['Min', m], ['Sec', s]]`, dropping Days when it is 0. With `null` it returns `[['Hrs', 0], ['Min', 0], ['Sec', 0]]`.
  - `EngineInlineCountdown({ label, endsAt, style, hideWhenOver })`.
- Consumes: `countdownParts(endsAt, now)`.

- [ ] **Step 1: Write the failing tests.**
  - Map test `it('maps a countdown block and drops it without an end time')`:
    - Settings `{ label: 'Ends in', ends_at: '2026-12-31T20:00', style: 'boxes', hide_when_over: true }` map to the union member above.
    - `ends_at: ''` maps to `null`.
    - `style: 'BOXES'` maps to `'boxes'`.
  - Schema test `it('offers one countdown block in the hero and none in rich text')`: `image-banner` blocks include `countdown` with `limit: 1`; `rich-text` and `image-with-text` blocks do not.
  - Logic test `it('drops days when zero and gives zeros when over')`: `countdownUnits(countdownParts(end, end - 3_725_000))` is `[['Hrs',1],['Min',2],['Sec',5]]`, and `countdownUnits(null)` is all zeros.
- [ ] **Step 2:** Run `npx jest tests/lib/store/engine/content-blocks-map.test.ts tests/lib/store/engine/section-schemas.test.ts tests/lib/store/engine/countdown-logic.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the schema, mapper case, `countdownUnits` and `EngineInlineCountdown`.**
  - The component ticks like `EngineCountdown`.
  - It returns null when `countdownParts` is null and `hideWhenOver` is set, or when `Date.parse(endsAt)` is not finite.
  - It draws `eng-cb eng-cb-countdown` with the label and the boxes (`eng-countdown-boxes`, reused) or one inline line for `inline`.
  - `ContentBlocks` renders it for `type: 'countdown'`.
- [ ] **Step 4:** Run the same tests, then `npx jest tests/lib/store`. Expected: PASS.
- [ ] **Step 5:** Commit the files above.

### Task 3: Size chips on product cards

**Files:**
- Create: `lib/store/engine/card-sizes.ts`
- Modify: `lib/store/engine/product-card.ts:5` (`CARD_LINE_IDS`), `:85-94` (`DEFAULT_LINES`)
- Modify: `lib/store/engine/theme-settings-schema.ts:36` (line label `['sizes', 'Sizes']`)
- Modify: `components/store/StoreProductCard.tsx:~313-350` (pass `sizes`), `components/store/studio-theme/StudioSections.tsx:~994-1060` (prop and `case 'sizes'`)
- Modify: `components/store/engine/product-card.css` (`.psizes`, beside `.pswatches`)
- Test: new `tests/lib/store/engine/card-sizes.test.ts`, `tests/lib/store/engine/product-card.test.ts`

**Interfaces:**
- Produces: `cardSizes(variants: StoreVariantInput[], max = 6): { sizes: { value: string; soldOut: boolean }[]; more: number }`.
  - It reads the `size` axis of `variantOptions(variants)` (`lib/store/variant-options.ts`), so case and key spelling follow the variant picker.
  - It returns `{ sizes: [], more: 0 }` when there is no size axis.
  - `StudioProductTile` gains `sizes?: { value: string; soldOut: boolean }[]` and `moreSizes?: number`.

- [ ] **Step 1: Write the failing tests.**
  - In `card-sizes.test.ts`:
    - `it('lists sizes in variant order, once each')`: variants with attributes `{size:'S'}`, `{size:'M'}`, `{size:'m'}`, `{size:'L'}` give `S, M, L`.
    - `it('marks a size sold out only when every variant of it is at zero')`: two `M` variants, stock 0 and 3, give `M` not sold out; `XL` at 0 is sold out.
    - `it('cuts after six and counts the rest')`: eight sizes give `sizes.length === 6` and `more === 2`.
    - `it('returns nothing for colour-only variants or none')`.
  - In `product-card.test.ts`:
    - `it('adds the sizes line off, after price')`: the sanitised default lines contain `{ id: 'sizes', on: false }` right after `price`.
    - `it('keeps a saved card without sizes unchanged otherwise')`: an old lines array round-trips with `sizes` appended off.
- [ ] **Step 2:** Run `npx jest tests/lib/store/engine/card-sizes.test.ts tests/lib/store/engine/product-card.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `cardSizes`, the line id, default, label, prop pass-through and the `case 'sizes'` branch.**
  - The branch draws nothing when `sizes` is empty. Otherwise it draws chips (`<span>`, `aria-hidden` only when decorative) with `.is-out` on sold-out ones (struck through, faded) and `+N`.
  - `StoreProductCard` passes `cardSizes(product.variants)` only when `product.has_variants`.
- [ ] **Step 4:** Run the same tests and `npx jest tests/lib/store/engine`. Expected: PASS, including `product-card-css.test.ts` and `card-design-setting.test.ts`.
- [ ] **Step 5:** Commit the files above.

### Task 4: "Only N left" under the size buttons

**Files:**
- Modify: `lib/store/engine/sections/main-product.ts:54` (`variant_picker` settings)
- Modify: `components/store/engine/product/product-blocks.ts` (new `lowStockNote`)
- Modify: `components/store/engine/product/ProductBlocks.tsx:94-102` (`VariantBlock`)
- Test: `tests/lib/store/engine/product-blocks.test.ts`

**Interfaces:**
- Produces:
  - `variant_picker` setting `low_stock_at`: range 0–10, step 1, default 0, label `Show "Only N left" at`, info `0 hides it`.
  - `lowStockNote(variant: { current_stock: number; variant_name: string; attributes: unknown } | null, threshold: number): string | null`.
    - Returns `Only N left in <size>` (the `size` attribute, any key case), else `Only N left in <variant_name>`.
    - Returns null when the threshold is 0, there is no variant, the stock is 0, or the stock is above the threshold.

- [ ] **Step 1: Write the failing test** `it('says only N left at or under the threshold')`, with these cases:

| Stock | Threshold | Expected |
|---|---|---|
| 2 | 3 | `Only 2 left in L` |
| 3 | 3 | `Only 3 left in L` |
| 4 | 3 | null |
| 0 | 3 | null |
| 2 | 0 | null |
| 2 (colour only, name `Red`) | 3 | `Only 2 left in Red` |

- [ ] **Step 2:** Run `npx jest tests/lib/store/engine/product-blocks.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the setting and `lowStockNote`.**
  - `VariantBlock` reads `settings.low_stock_at` (number, clamped 0–10) and draws the note under `VariantPicker` in the scheme's sale colour class used by the "% OFF" text.
  - `blockSettings` passes the setting; add it to the block's `settings` array.
- [ ] **Step 4:** Run the test and `npx jest tests/lib/store/engine`. Expected: PASS.
- [ ] **Step 5:** Commit the files above.

### Task 5: Fit note per product

**Files:**
- Create: `database/migrations/462_store_fit_note.sql` (confirm 462 is still the next number; use the next free one otherwise)
- Modify: `lib/store/product-extras.ts:10-11,~184` (field, `MAX_FIT_NOTE = 80`, `cleanShortText`)
- Modify: `app/api/items/route.ts:424,~585`, `app/api/items/[id]/route.ts:372,~453` (extras key list and SET)
- Modify: `lib/store/store-items-query.ts:138`, `app/api/public/store/[subdomain]/items/[id]/route.ts:30,76`, `lib/store/map-store-product.ts:80,118` (select and map `store_fit_note`)
- Modify: `components/store/admin/ItemStorePageFields.tsx` (a "Fit note" input beside Tagline, `maxLength={80}`, hint `Shown under the size buttons, like "Oversized fit. Size down for a regular fit."`)
- Modify: `components/store/engine/product/ProductBlocks.tsx` (`VariantBlock` draws `product.store_fit_note` under the picker and note, also when the product has no variants)
- Modify: `lib/store/engine/demo-catalogs.ts:~30-45` (`store_fit_note: null` in the row defaults)
- Test: `tests/lib/store/product-extras.test.ts`, `tests/db/store-product-card-fields.db.test.ts`

**Interfaces:**
- Produces: `store_fit_note: string | null` on `ProductExtrasValue`, `StoreItem` and the demo `StoreProduct` rows.
- Migration body: `ALTER TABLE items ADD COLUMN IF NOT EXISTS store_fit_note TEXT;` with a one-line comment.

- [ ] **Step 1: Write the failing tests.**
  - In `product-extras.test.ts`, `it('cleans the fit note')`:
    - `'  Oversized fit  '` becomes `'Oversized fit'`.
    - `'   '` becomes `null`.
    - 90 chars are clipped to 80.
    - A number gives the same error shape as a bad tagline.
  - In the DB test, `it('saves and returns store_fit_note')`, following the badge test in that file: write through the item update path, then read through `buildStoreItemsQuery` + `mapStoreItemRow`.
- [ ] **Step 2:** Run `npx jest tests/lib/store/product-extras.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Apply the migration to `kh_phase2_test` only: `psql "$PHASE2_TEST_DATABASE_URL" -f database/migrations/462_store_fit_note.sql`. Expected: `ALTER TABLE`.
- [ ] **Step 4:** Implement the field through validation, both item routes, both reads, the mapper, the form, the product page and the demo defaults.
- [ ] **Step 5:** Run `npx jest tests/lib/store/product-extras.test.ts`, then `PHASE2_TEST_DATABASE_URL=... npx jest tests/db/store-product-card-fields.db.test.ts --runInBand`, then `npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 6:** Commit the migration and the files above.

### Task 6: Delivery check block

**Files:**
- Modify: `lib/store/store-pincode.ts` (two helpers)
- Modify: `lib/store/engine/sections/main-product.ts:~70` (new block after `delivery_estimate`)
- Modify: `components/store/engine/product/ProductBlocks.tsx:~258` (`delivery_check: DeliveryCheckBlock`)
- Test: new `tests/lib/store/store-pincode.test.ts`, `tests/lib/store/engine/section-schemas.test.ts`

**Interfaces:**
- Produces:
  - `deliveryCheckShown(branch: Pick<StoreBranch, 'serviceable_pincodes' | 'delivery_mode'> | undefined): boolean`. True only when the branch lists at least one pincode and `delivery_mode !== 'all_india'`.
  - `deliveryCheckAnswer(branch, pincode: string): string | null`. Null until a 6-digit pincode is entered. Otherwise `Delivers to <pin>` when `pincodeServiceable`, else `We don't deliver to <pin> yet`.
  - Block `delivery_check`: `limit: 1`; settings `heading` (text, max 40, default `Check delivery`) and `button_label` (text, max 20, default `Check`).
- Consumes: `cleanPincode`, `pincodeServiceable`, `storePinKey`; `useStore()` `branches`, `selectedBranchId` (pick the branch as `EngineViews.tsx` does at line ~641).

- [ ] **Step 1: Write the failing tests.**
  - `it('shows the check only for a branch with its own pincode list')`: no branch, `[]`, `all_india` with pins and a list.
  - `it('answers per pincode')`: `'5600'` gives null; a listed pin gives `Delivers to 560001`; an unlisted one gives `We don't deliver to 400001 yet`.
  - Schema test `it('has a delivery check block, absent from the default product template')`.
- [ ] **Step 2:** Run `npx jest tests/lib/store/store-pincode.test.ts tests/lib/store/engine/section-schemas.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the helpers, the schema block and `DeliveryCheckBlock`.**
  - The block is a client component that renders null unless `deliveryCheckShown`.
  - It has a numeric input with `cleanPincode` on change, prefilled from `localStorage[storePinKey(subdomain)]` (try/catch), and saves the pincode on Check.
  - The answer goes in an `aria-live="polite"` line.
- [ ] **Step 4:** Run the same tests. Expected: PASS.
- [ ] **Step 5:** Commit the files above.

### Task 7: Sticky Add to bag bar on phones

**Files:**
- Modify: `lib/store/engine/sections/main-product.ts:34` (`sticky_buy_bar` checkbox after `sticky_info`)
- Modify: `components/store/engine/sections/MainProduct.tsx` (pass `stickyBuyBar={s.sticky_buy_bar === true}`)
- Create: `components/store/engine/product/StickyBuyBar.tsx`
- Modify: `components/store/engine/product/ProductBlocks.tsx` (`EngineMainProduct` mounts it when on), `components/store/engine/product/product-blocks.ts` (`stickyBuyBarVisible`)
- Modify: the stylesheet that styles `.qk-kit` (hide it while `body[data-eng-buy-bar="on"]`)
- Test: `tests/lib/store/engine/product-blocks.test.ts`

**Interfaces:**
- Produces:
  - Setting `sticky_buy_bar`: checkbox, default false, label `Show an Add to bag bar on phones`.
  - `stickyBuyBarVisible(input: { enabled: boolean; phone: boolean; buyInView: boolean; hasProduct: boolean }): boolean`. True only when enabled, on a phone, with a product, and the buy block is out of view.
- Consumes: `useEngineProduct()` (`product`, `offer`, `needsVariant`, `variant`, `add`), `buyButtonState`.

- [ ] **Step 1: Write the failing test** `it('shows the sticky bar only on phones when the buy buttons are out of view')`, covering all 16 combinations of the four booleans: only `{true,true,false,true}` is true.
- [ ] **Step 2:** Run `npx jest tests/lib/store/engine/product-blocks.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the setting, the helper and `StickyBuyBar`.**
  - `phone` is `matchMedia('(max-width: 767px)')`; `buyInView` is an `IntersectionObserver` on `[data-eng-block]` of the `buy_buttons` block.
  - The bar shows the chosen size (or a `Select size` button that scrolls the Options block into view), the price, and the same add or choose action as `BuyButtonsBlock`.
  - It is fixed at the bottom, offset by the bottom navigation's height. Read `components/store/StoreMobileNav.tsx`; if it exposes no height variable, add `--eng-bottom-nav-h` there and use it.
  - While shown it sets `document.body.dataset.engBuyBar = 'on'` (removed on hide and unmount). The `.qk-kit` rule hides the kit cart bar then.
- [ ] **Step 4:** Run the test and `npx jest tests/lib/store/engine`. Expected: PASS.
- [ ] **Step 5:** Commit the files above.

### Task 8: Product photos in a grid

**Files:**
- Modify: `lib/store/engine/sections/main-product.ts:25-33` (`thumbs` option `{ value: 'grid', label: 'Photos in a grid' }`)
- Modify: `components/store/engine/sections/MainProduct.tsx` (map `'grid'`), `components/store/engine/product/ProductBlocks.tsx:~277` (prop type)
- Modify: `components/store/features/product/ProductGallery.tsx:27,43` (`thumbs?: 'side' | 'bottom' | 'grid'`)
- Test: `tests/lib/store/engine/sanitize.test.ts`

**Interfaces:**
- Produces: `thumbs: 'grid'`. At `md` and up, every image shows in two columns at 4:5, then the video (`videoUrl`) last, with no thumbnail strip. Below `md`, the swipe gallery with `thumbs: 'bottom'`.

- [ ] **Step 1: Write the failing test** `it('keeps thumbs grid and falls back to side for unknown values')`: `'grid'` is kept, and `'mosaic'` becomes `'side'`.
- [ ] **Step 2:** Run `npx jest tests/lib/store/engine/sanitize.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the option, the mapping and the grid branch in `ProductGallery`. Two `md:` wrappers inside the component, not two galleries in `EngineMainProduct`.
- [ ] **Step 4:** Run the test. Expected: PASS.
- [ ] **Step 5:** Commit the files above.

### Task 9: The Drop Culture preset

**Files:**
- Create: `lib/store/engine/presets/drop.ts`
- Create: `public/store-presets/drop/` SVG sample pictures: `hero-1`, `promo-1`, `promo-2`, `look-1`, `gallery-1` to `gallery-4`, `category-1` to `category-3`. Flat dark shapes in the scheme colours, like `public/store-presets/heritage/`.
- Modify: `lib/store/engine/types.ts:4`, `lib/store/engine/root-class.ts:7`, `lib/store/engine/presets/look.ts:38,114` (`PRESET_LOOK.drop`, `PRESET_SCHEMES.drop`), `lib/store/engine/card-look.ts:22` (`PRESET_CARD_FIELDS.drop`), `lib/store/engine/presets/index.ts:32` (switch case). Also any other list `grep -rn "'heritage'" lib/store/engine` finds outside `theme-catalog.ts` and `demo-stores.ts`.
- Test: `tests/lib/store/engine/preset-look.test.ts`, `tests/lib/store/engine/presets.test.ts`, `tests/lib/store/engine/preset-templates.test.ts`, `tests/lib/store/engine/root-class.test.ts`

**Interfaces:**
- Produces: `dropPreset(ctx: PresetContext): ThemeData`, and `presetTheme('drop', ctx)`.
- Consumes:
  - Helpers from `presets/shared.ts` (`block`, `section`, `template`, `onScheme`, `presetSettings`).
  - `cloneProductCard`, `PRODUCT_CARD_DEFAULTS`.
  - Block types `countdown` (Task 2), card line `sizes` (Task 3), `low_stock_at` (Task 4), `delivery_check` (Task 6), `sticky_buy_bar` (Task 7), `thumbs: 'grid'` (Task 8).

**Preset values** (spec §3, verbatim):

| Setting | Value |
|---|---|
| `PRESET_LOOK.drop` | `{ canvas: '#0d0d0d', accent: '#d4ff3a', font_heading: 'anton', font_body: 'space-grotesk', button_radius: 0, card_style: 'plain', label_style: 'caps', frame_style: 'none', texture: 'none' }` |
| `PRESET_CARD_FIELDS.drop` | `{ tagline: false, swatches: false }` |

**`PRESET_SCHEMES.drop`**, ids `scheme-1`…`scheme-6`:
- Every scheme: `border = mixHex(text, background, 0.12)`, `card = mixHex(text, background, 0.06)`.

| Id | Name | `background` | `text` | `accent` | `button` | `button_text` |
|---|---|---|---|---|---|---|
| `scheme-1` | Ink | `#0d0d0d` | `#f2f0ea` | `#d4ff3a` | `#d4ff3a` | `#0d0d0d` |
| `scheme-2` | Concrete | `#1f1f1f` | `#f2f0ea` | `#d4ff3a` | `#f2f0ea` | `#0d0d0d` |
| `scheme-3` | Bone | `#f2f0ea` | `#0d0d0d` | `#0d0d0d` | `#0d0d0d` | `#f2f0ea` |
| `scheme-4` | Volt | `#d4ff3a` | `#0d0d0d` | `#0d0d0d` | `#0d0d0d` | `#d4ff3a` |
| `scheme-5` | Alarm | `#ff4d2e` | `#0d0d0d` | `#0d0d0d` | `#0d0d0d` | `#ff4d2e` |
| `scheme-6` | Smoke | `#2a2a2a` | `#f2f0ea` | `#d4ff3a` | `#d4ff3a` | `#0d0d0d` |

**`product_card` overrides** on `cloneProductCard(PRODUCT_CARD_DEFAULTS)`:

| Setting | Value |
|---|---|
| `design` | `'dark'` |
| `image_shape` | `'portrait'` |
| `image_hover` | `'second'` |
| `badge_shape` | `'corner'` |
| `button_style` | `'icon'` |
| `oos_look` | `'label'` |
| `oos_place` | `'end'` |
| `lines` | `name`, `price`, `sizes`, `buttons` on; `brand`, `unit`, `rating`, `tagline`, `swatches` off |

**Pages:**
- **Header group:** Announcement (scrolling, scheme Volt, text `Free shipping over ₹699 · COD available · Any 3 tees @ ₹999`) and Header.
- **Home:**
  1. Image banner (Smoke, photo beside words, picture `hero-1`), with blocks:
     - eyebrow `New drop`
     - heading `<business name>` at size `xxl`, or `Summer drop` without one
     - countdown (`ends_at: ''`)
     - button `Shop the drop` → `/catalog`
  2. Marquee (Ink): four items `New drop`, `Heavyweight cotton`, `Ships in 24 hours`, `7-day exchange`.
  3. Featured products `Just dropped`: four columns, `show_badges` on.
  4. Category grid: three tiles `category-1..3`.
  5. Video `On the streets` (Concrete, empty `video_url`; it renders nothing until set).
  6. Promo cards, two cards:
     - `Combo` / `Any 3 @ ₹999` on Volt
     - `Last call` / `Up to 40% off` on Alarm
  7. Shop the look `Shop the fit` (`look-1`).
  8. Countdown `Next drop` (Volt): empty `ends_at`, button label `Get drop alerts`, empty link.
  9. Image gallery (grid of four).
  10. Testimonials with `show_summary` on and one placeholder quote, as the other presets do.
  11. Multicolumn: three columns `Cash on delivery`, `7-day exchange`, `Ships in 24 hours`.
  12. Newsletter `Join the crew` (Bone).
- **Catalog:** Catalog banner (Smoke) and Main catalog with `columns_desktop: 4`, `columns_mobile: 2`.
- **Product:**
  - Main product with `thumbs: 'grid'`, `sticky_info: true`, `sticky_buy_bar: true`.
  - Blocks:
    - title
    - price
    - `variant_picker` with `low_stock_at: 3`
    - `buy_buttons`
    - `delivery_check`
    - three `collapsible_tab`s: `Details`, `Fabric and care`, `Exchange and returns` (one neutral line each)
  - Then Related products `Complete the fit`, Product reviews, Recently viewed.
- **Footer:** Ink, with payment icons.

- [ ] **Step 1: Write the failing tests.**
  - In `preset-look.test.ts`:
    - `it('drop ignores the store accent')`: `schemesFor('drop', a)` is equal for `'#004537'`, `'nope'` and `''`.
    - `it('every drop accent and button reads on its background (3:1)')`, using `contrastRatio`.
    - The `PRESET_LOOK.drop` equality.
  - In `presets.test.ts`:
    - `it('drop uses only registry sections and unique ids')`, as the Heritage case does.
    - `it('drop turns on its card and product settings')`: `product_card.design === 'dark'`; `sizes` on; the main product has `sticky_buy_bar: true` and `thumbs: 'grid'`; the variant picker has `low_stock_at: 3`; the hero has one `countdown` block.
    - `it('existing presets keep the new pieces off')`. For each of `studio`, `quick`, `grocery`, `khatario`, `blank` and `heritage`:
      - the `sizes` line is off;
      - no hero has a `countdown` block and no product template has a `delivery_check` block;
      - every `variant_picker` has `low_stock_at: 0`;
      - main product has `sticky_buy_bar: false` and the same `thumbs` value as before the change;
      - `preset-parity.test.ts` still passes unchanged.
  - In `root-class.test.ts`: `it('adds eng-preset-drop')`.
- [ ] **Step 2:** Run `npx jest tests/lib/store/engine/preset-look.test.ts tests/lib/store/engine/presets.test.ts tests/lib/store/engine/root-class.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `drop.ts`, the lists, `PRESET_LOOK.drop`, `PRESET_SCHEMES.drop`, `PRESET_CARD_FIELDS.drop` and the SVG pictures. Copy is neutral: no reviews, press or service claims beyond the placeholders listed.
- [ ] **Step 4:** Run the same tests, then `npx jest tests/lib/store`. Expected: PASS.
- [ ] **Step 5:** Commit the files above.

### Task 10: Streetwear demo store and theme store entry

**Files:**
- Modify: `lib/store/engine/theme-catalog.ts:20` (`DemoCatalogId` gains `'streetwear'`), `:~127-143` (new entry after Heritage)
- Modify: `lib/store/engine/demo-catalogs.ts` (`STREETWEAR` catalogue and its map entry), `lib/store/engine/demo-stores.ts:~66-71` (Drop pictures like `HERITAGE_PICTURES`)
- Modify: `scripts/theme-demo-photos.json` (streetwear photos), then run `node scripts/theme-demo-photos.mjs` (writes `public/theme-demos/streetwear/*.webp`, the heroes and `CREDITS.md`)
- Test: `tests/lib/store/engine/theme-catalog.test.ts`, `tests/lib/store/engine/demo-catalogs.test.ts`, `tests/lib/store/engine/demo-stores.test.ts`

**Interfaces:**
- Produces:
  - A `THEME_CATALOG` entry:

| Field | Value |
|---|---|
| `preset` | `'drop'` |
| `slug` | `'drop-culture'` |
| `name` | `'Drop Culture'` |
| `premium` | `true` |
| `categories` | `['fashion']` |
| `palette` | `['#0d0d0d', '#d4ff3a', '#f2f0ea']` |
| `canvas` | `'#0d0d0d'` |
| `accent` | `'#d4ff3a'` |
| `added` | `'2026-11-02'` |
| `demo` | `{ subdomain: 'demo-drop-culture', brand: 'VOLTX', tagline: 'Drops every Friday', catalog: 'streetwear' }` |

  - `summary`: `Ink black and acid lime with loud caps headings, for streetwear and drop brands`.
  - `features`: `Drop countdown in the hero`, `Size chips on product cards`, `"Only N left" per size`, `Sticky Add to bag on phones`, `Delivery check by pincode`, `Photos in a grid`.
- Consumes: `presetTheme('drop', …)` (Task 9).

- [ ] **Step 1: Write the failing tests.**
  - `it('lists Drop Culture as premium with its demo store')`, in `theme-catalog.test.ts`.
  - `it('streetwear products have sizes, some sold out')`, in `demo-catalogs.test.ts`:
    - 12–16 products across `Tees`, `Co-ords`, `Denim` and `Accessories`.
    - At least 8 have `has_variants: true` with `size` attributes `S`–`XXL` (denim waist `28`–`36`).
    - At least two sizes are at 0 stock.
    - At least three products have `store_badge`, from `Selling fast`, `Any 3 @ ₹999` and `New`.
    - At least three have `store_fit_note`.
  - `it('draws the drop demo store')`, in `demo-stores.test.ts`: `demoThemeData` for `demo_preset: 'drop'` has `preset 'drop'` schemes and Drop's pictures.
- [ ] **Step 2:** Run `npx jest tests/lib/store/engine/theme-catalog.test.ts tests/lib/store/engine/demo-catalogs.test.ts tests/lib/store/engine/demo-stores.test.ts`. Expected: FAIL.
- [ ] **Step 3: Get the photos.**
  - Add the photo list to `scripts/theme-demo-photos.json`: Unsplash or Pexels only (free for commercial use), with photographer and link for `CREDITS.md`.
  - Run `node scripts/theme-demo-photos.mjs`. Expected: files under `public/theme-demos/streetwear/`, each under 200 KB, and `CREDITS.md` updated.
- [ ] **Step 4:** Implement `STREETWEAR` (variant rows built by one small local helper), the entry and the demo pictures map.
- [ ] **Step 5:** Run the same tests, then `npx jest tests/lib/store`. Expected: PASS.
- [ ] **Step 6:** Commit the catalogue, the entry, the photos, `CREDITS.md` and the JSON.

### Task 11: Wrap up

**Files:**
- Modify: `docs/project.log.md` (append one entry, brain.md format), `docs/roadmap.md` (move the Drop Culture card if one exists, else add it under Now)

- [ ] **Step 1:** Run `npx jest tests/lib/store` and `npx tsc --noEmit`. Expected: all pass, no errors.
- [ ] **Step 2:** Run `graphify update .`. Expected: the graph is updated with no API cost.
- [ ] **Step 3:** Append the project log entry (asked, decided, shipped with short hashes, open: batches 2 and 3, migration 462 not on staging, staging checks from Review Focus 4 and spec §6) and commit it with the roadmap by name.
