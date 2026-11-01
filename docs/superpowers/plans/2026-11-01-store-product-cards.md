# Store Product Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A store-wide Product cards design (gallery of ten designs plus Theme's own, every detail editable), a per-section Card choice, and out-of-stock look and placement, with existing stores unchanged.

**Architecture:** Settings live in `ThemeSettings.product_card`, defined, sanitised and resolved in one pure module (`lib/store/engine/product-card.ts`) that also holds the ten designs and turns a resolved look into CSS classes and variables. The engine passes the resolved look to cards through the existing `EngineCardContext` (store-wide in `EngineShell`, overridden per product section). The card components read it; a new stylesheet draws it. Out-of-stock placement is a store-items query option.

**Tech Stack:** Next.js 14 app router, React 18, TypeScript, plain CSS, Jest (`.ts` only).

**Spec:** `docs/superpowers/specs/2026-11-01-store-product-cards-design.md`

## Global Constraints

- Every id, value and default exactly as the spec §2 table; `design` default `theme`; `oos_place` default `stay`.
- `design: 'theme'` adds no class, variable or style to any card (existing stores unchanged); `oos_place` applies whatever the design.
- The ten designs: `classic`, `minimal`, `grocery`, `boutique`, `list`, `royal`, `deal`, `soft`, `editorial`, `dark`; each a complete settings object that passes the sanitiser unchanged.
- Theme settings use dotted ids for the nested object (`product_card.<field>`), as `social.<network>` already does in `THEME_SETTINGS_SCHEMA`, `themeSettingValue` and `setThemeSetting`.
- Engine (Studio 2) stores only; the old non-engine storefront's cards are untouched.
- Jest for `.ts`; DB tests only on `kh_phase2_test` (`PHASE2_TEST_DATABASE_URL` built from `.env` `DB_*`, never printed); no migration.
- Local commit per task on main (owner-approved), staged by name, plain-sentence messages with the Co-Authored-By line; never push.

## Review Focus

1. With `design: 'theme'` and no section Card choice, the rendered card markup and classes are byte-identical to today in every preset. (Task 1 test on `cardLookClasses`; Task 3 review.)
2. `lines` from a hand-edited or old theme with duplicates, unknown ids or missing ids still yields every known line exactly once, in a sensible order. (Task 1 test.)
3. "Hide" out of stock must not hide a product with sizes while any size is in stock, and must not 404 the product's own page. (Task 5 tests.)
4. A section's `show_rating: false` etc. still hides that line under any design. (Task 1 `resolveCardLook` test.)
5. One photo means no swipe dots and no hover swap; no photo shows the chosen placeholder. (Task 4 review; helper test if logic is in `.ts`.)

---

### Task 1: Product card settings module

**Files:** Create `lib/store/engine/product-card.ts`; modify `lib/store/engine/types.ts` (`ThemeSettings.product_card: ProductCardSettings`), `lib/store/engine/sanitize.ts` (`product_card: sanitizeProductCard(r.product_card)`), `lib/store/engine/schema-types.ts` and `lib/store/engine/settings.ts` (setting type `line_list`, sanitised as a permutation of a fixed id list given on the schema as `options`). Test `tests/lib/store/engine/product-card.test.ts`; fix fixtures that build `ThemeSettings` literals.

**Interfaces (produced):** `ProductCardSettings` (fields per spec §2); `CARD_LINE_IDS`; `PRODUCT_CARD_DEFAULTS`; `CARD_DESIGNS: Record<CardDesignId, ProductCardSettings>`; `sanitizeProductCard(raw: unknown): ProductCardSettings`; `normaliseLines(raw: unknown): Array<{ id: CardLineId; on: boolean }>`; `resolveCardLook(store: ProductCardSettings, sectionDesign: string | undefined, switches: { rating?: boolean; badges?: boolean; tagline?: boolean; swatches?: boolean }): ResolvedCardLook` (`design: 'theme'` when the store and section say theme; a section design uses `CARD_DESIGNS[id]`; switches turn lines off); `cardLookClasses(look: ResolvedCardLook): string` and `cardLookVars(look: ResolvedCardLook): Record<string, string>` (both empty for `theme`); `nameAndPriceInRow(look): boolean` (true only when `name_price_row` and price is the next visible line after name).

- [ ] **Step 1: Failing tests:** defaults per spec; each field rejects bad values (falls back to default); `normaliseLines` (duplicates dropped, unknown dropped, missing appended off) (Review Focus 2); every design passes `sanitizeProductCard` unchanged; Royal's key values match spec §2 (portrait, ribbon + crown, circle heart top-right, swipe, heading font, tagline and rating count on, accent large price, pill discount, `icon_full`, border 1, radius 16); `resolveCardLook` store / section override / unknown section design → store / switches hide lines (Review Focus 4); `cardLookClasses` and `cardLookVars` are `''` / `{}` for theme (Review Focus 1); `nameAndPriceInRow` cases.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; wire into types and sanitiser; add `line_list` setting type.
- [ ] **Step 4:** `npx jest tests/lib/store` and `npx tsc --noEmit -p .` → pass.
- [ ] **Step 5:** Commit.

### Task 2: Section Card choice and look plumbing

**Files:** Modify the six product section schemas (`lib/store/engine/sections/featured-products.ts`, `product-rail.ts`, `category-shelves.ts`, `related-products.ts`, `recently-viewed.ts`, `main-catalog.ts`): add `card_design` select (`store` + the ten, labels "Store's card design", "Classic", …; default `store`); add the info line to existing `card_style` ("Applies when the store uses Theme's own card"). Modify `lib/store/engine/card-look.ts` (`EngineCardLook` gains `card: ResolvedCardLook`), `components/store/engine/EngineShell.tsx` (store-wide resolved look in the context), and create `components/store/engine/CardLookScope.tsx` (client provider that re-resolves with a section's `card_design` and switches). Wrap each product section's card list in `CardLookScope`. Test: extend `tests/lib/store/engine/product-card.test.ts` or a schema test.

**Interfaces:** Consumes Task 1. Produces `CardLookScope({ design, switches, children })`; `useEngineCardLook()` returns `card` for cards to read.

- [ ] **Step 1: Failing tests:** each section schema has `card_design` with the eleven values and default `store`, and passes the sanitiser.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement schema and plumbing (no visual change yet).
- [ ] **Step 4:** `npx jest tests/lib/store`, `tsc` → pass.
- [ ] **Step 5:** Commit.

### Task 3: Card rendering: lines, name, price, badges, card, out-of-stock look

**Files:** Modify `components/store/studio-theme/StudioSections.tsx` (`StudioProductTile`) and the engine branch of `components/store/StoreProductCard.tsx`; create `components/store/engine/product-card.css` (imported by the tile's module, scoped `.st-root.eng-root .pc-on …`).

**Interfaces:** Consumes `useEngineCardLook().card`, `cardLookClasses`, `cardLookVars`, `nameAndPriceInRow`.

Behaviour (spec §2, §4): with `theme` nothing changes. Otherwise the root gets `pc-on` + classes + variables; lines render in `look.lines` order (on only), name–price row, name font/case/lines/size, rating style (count uses `ratingCount`), price size/colour, MRP and discount style, badges (shape, position, icon as inline SVG, colours; custom badge first), card scheme (scheme variables like a section scheme), border/radius/shadow/align/padding, background picture on the details area, hover lift/zoom, out-of-stock look (`label` today / `faded` no button / `soldout_button`).

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** `tsc` and `npx jest tests/lib/store` → pass (premium parity tests must still pass).
- [ ] **Step 3:** Commit. (Browser check on staging.)

### Task 4: Card rendering: photo and buttons

**Files:** Same components and `product-card.css`; a pure helper in `lib/store/engine/product-card.ts` if any decision needs testing (e.g. `cardPhotoState(images, look)` returning `{ swipe: boolean; hover: string | null }`, with a test for one / no photo, Review Focus 5).

Behaviour: photo shape / fit / padding / radius / background; hover second photo (`images[1]`) or zoom; swipe with CSS scroll-snap and dots over `product.images` (active dot by a small scroll listener); placeholder `initial` / `logo` (store logo) / `icon`; buttons `full`, `pill_on_photo`, `icon`, `icon_full`, `none` (tap opens product); `button_action` `add` / `buy` (buy uses the existing buy-now flow, as `StoreKhatarioProductView.buyNow`); `after_add` stepper; wishlist position and circle. Products with sizes keep opening the option chooser as today.

- [ ] **Step 1:** Failing test for the helper (if added) → implement → `tsc`, jest → pass.
- [ ] **Step 2:** Commit.

### Task 5: Out-of-stock placement in product lists

**Files:** Modify `lib/store/store-items-query.ts` (`outOfStock?: 'stay'|'end'|'hide'`), `lib/store/engine/section-data.ts` (passes the theme's `product_card.oos_place`), `app/api/public/store/[subdomain]/items/route.ts` and `app/api/public/store/[subdomain]/search` routes (engine stores: read the live theme's value through the existing engine theme loader), category shelves. Tests: extend the store-items-query unit test; DB test in `tests/db/` (existing store items suite) on `kh_phase2_test`.

- [ ] **Step 1: Failing tests:** SQL contains the `end` ordering term first and the `hide` filter; a sized product is out only when all sizes are out (Review Focus 3); `stay` changes nothing; DB: in-stock / out-of-stock / sized products ordered with `end`, excluded with `hide`; the product page loader is unaffected.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** jest, DB suite on `kh_phase2_test`, `tsc` → pass.
- [ ] **Step 5:** Commit.

### Task 6: Editor: Product cards group, line list field, design gallery

**Files:** Modify `lib/store/engine/theme-settings-schema.ts` (a "Product cards" header and `product_card.*` settings in spec §2 groups), `lib/store/engine/editor/ops.ts` (`setThemeSetting` handles `product_card.`; new `applyCardDesign(theme, id)` that writes the design's full settings), the theme setting value reader in `components/store/studio2/SettingsPanel.tsx`, `components/store/studio2/fields/SettingField.tsx` (`case 'line_list'`: rows with switch and ↑ ↓). Create `components/store/studio2/CardDesignGallery.tsx` (modal; eleven tiles rendered with the real card component inside a store root, using the first editor product with a photo or a built-in sample; "Edited" on the current design when settings differ from it; "Use this design" with a confirm when settings would be replaced). Test: `applyCardDesign` and `setThemeSetting` for `product_card.*` in `tests/lib/store/engine/editor-ops.test.ts`.

- [ ] **Step 1: Failing tests** for the two ops.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the ops, schema rows, field and gallery.
- [ ] **Step 4:** jest, `tsc` → pass.
- [ ] **Step 5:** Commit.
