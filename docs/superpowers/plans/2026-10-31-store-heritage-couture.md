# Heritage Couture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three new general sections (Collage, Shop the look, Image gallery), the `heritage` preset built only from engine sections, and a per-business premium flag that hides premium presets in the theme library until pricing is decided.

**Architecture:** The sections follow the engine pattern from plan 1: a client-safe schema in `lib/store/engine/sections/`, a pure mapper in `lib/store/engine/` (unit-tested), a thin server renderer in `components/store/engine/sections/`, CSS in a `*-rules.ts` string appended to `THEME_RULES`. Products a block names come through plan 1's `productIds` request / `productsById` data; to reach them, `SectionSchema.data` gains the section's enabled blocks as a second argument. The preset is a file in `presets/` plus one entry in each preset table; nothing in code is heritage-only except that file, its fixed colour schemes and its sample SVGs. The flag is a `business_settings` column read by one helper, so a plan or purchase check later replaces the body without touching callers.

**Tech Stack:** Next.js 14 app router, React 18 (server components; one `'use client'` component for the hotspots), TypeScript, Postgres, Jest + ts-jest (`npx jest <path>`), Playwright specs in `e2e/` (written, never run by tasks).

**Spec:** `docs/superpowers/specs/2026-10-31-store-premium-themes-design.md` (§4, §6, §7, §8, §9 item 2). Plan 1 (`2026-10-31-store-premium-foundations.md`, merged to main as 658369e2) built the fonts, style settings, product card fields, products-by-id loader and content blocks this plan uses; its carry-over is `2026-10-31-store-premium-foundations-carryover.md`.

## Global Constraints

- Migrations are written under `database/migrations/` and applied to `kh_phase2_test` only; never to staging or production. Next free number at writing time: 459 (check when you start).
- Stage files by name; commit after each task on the plan's branch; never push.
- Nothing visible changes for existing stores: new sections appear only when added; the preset appears only when the flag is on; every new setting defaults to today's output.
- Exact values from the spec: section types `collage`, `shop-the-look`, `image-gallery`; block types and limits as §4; `productIds` at most 12 per section; preset id `heritage`, look canvas `#fcf9f3`, accent `#7a0c1e`, gold `#c89d53`, `font_heading: 'newsreader'`, `font_body: 'manrope'`, `button_radius: 0`, `card_style: 'bordered'`, `label_style: 'caps'`, `frame_style: 'accent'`, `texture: 'dots'`; six scheme names Ivory, Parchment, Crimson, Dark (`#1b1514`), Cream, Gold; flag column `business_settings.store_premium_themes BOOLEAN NOT NULL DEFAULT false`; refusal `403 premium_locked` "Premium themes are not enabled for this store".
- Header and footer schemas are the menus project's; the preset uses whatever header/footer shape `presets/studio.ts` uses at build time.
- No invented reviews, press quotes or customer photos in the preset: placeholder copy and our own sample SVGs only.
- Sample photos: Khatario-made SVG placeholders under `public/store-presets/heritage/` (ivory/crimson/gold geometric patterns, no third-party imagery), so no licence question arises; the Add theme card says "Comes with sample images; replace them with yours".

## Review Focus

1. A hotspot whose product is out of stock must show "Sold out" with no Add button, and one whose product is hidden or deleted must draw no pin and no list row; "Add all to bag" adds only in-stock items. Test in Task 3.
2. `x`/`y` typed outside 0–100 (or as text) must clamp or default, never place a pin off the photo. Test in Task 1 (sanitiser) and Task 3 (mapper).
3. A Collage with the text column but zero valid tiles must still render the text (a split hero with an empty image side is wrong); with `layout: 'tiles'` and zero tiles it renders nothing. Test in Task 2.
4. Turning the premium flag off after a store already has a heritage theme must leave that theme editable, duplicable and restorable; only creating a NEW theme from the premium preset is refused. Test in Task 6.
5. The heritage preset, run through `sanitizeThemeData`, must come back byte-for-byte unchanged (every section and block type registered, every value within limits), so a merchant never sees a "failed to load" card on a fresh theme. Test in Task 5.

---

### Task 1: Section schemas and block-aware data requests

**Files:**
- Create: `lib/store/engine/sections/collage.ts`, `lib/store/engine/sections/shop-the-look.ts`, `lib/store/engine/sections/image-gallery.ts`
- Modify: `lib/store/engine/schema-types.ts` (`SectionSchema.data` signature), `lib/store/engine/section-data.ts:50` (`collectDataRequests`), `lib/store/engine/registry.ts` (three imports + `ALL`)
- Test: `tests/lib/store/engine/premium-sections.test.ts` (new), `tests/lib/store/engine/section-data.test.ts`

**Interfaces:**
- Produces: `SectionSchema.data?: (settings: Record<string, unknown>, blocks: Array<{ type: string; settings: Record<string, unknown> }>) => SectionDataRequest` — `collectDataRequests` passes the section's enabled blocks in `block_order` (disabled ones left out); existing one-argument `data` functions keep working.
- Produces: `blockProductIds(blocks, blockType, settingId = 'product'): string[]` exported from `section-data.ts`'s client-safe neighbour `lib/store/engine/block-products.ts` (types only, no pg): the UUID-looking ids of `blocks` of that type, deduplicated, first 12.
- Schemas (settings/blocks exactly):
  - `collage` (name "Collage", category Banners, templates home + page): `eyebrow` text 60; `heading` text 120; `text` richtext; `button_text` 30; `link` url; `button_2_text` 30; `link_2` url; `layout` select `text-left|text-right|tiles` default `text-left`; `feature_tile` select `first|equal` default `first`; `tile_shape` select `portrait|square` default `portrait`. Blocks, `max_blocks: 4`: `image_tile` (`image` image `video: true`, `caption` 60, `label` 30, `link` url), `product_tile` (`product`, `image`), `category_tile` (`category`, `image`). `data`: `{ productIds: blockProductIds(blocks, 'product_tile'), categories: true, categoriesOptional: true }` (omit `productIds` when empty).
  - `shop-the-look` (name "Shop the look", category Products, templates home + page + product): `eyebrow` 60; `heading` 120; `text` textarea 300; `image` image; `image_side` select `left|right` default `left`; `show_list` checkbox default true; `show_add_all` checkbox default false; `list_heading` text 60 default "In this look". Blocks, `max_blocks: 6`: `hotspot` (`product`, `x` range 0–100 step 1 default 50, `y` range 0–100 step 1 default 50, `label` 40). `data`: `{ productIds: blockProductIds(blocks, 'hotspot') }` (omit when empty).
  - `image-gallery` (name "Image gallery", category Media, templates home + page + product): `eyebrow` 60; `heading` 120; `layout` select `grid|masonry|strip` default `grid`; `columns` range 2–6 default 4; `shape` select `square|portrait|natural` default `square`; `hover` select `none|caption|caption-link` default `caption`; `gap` range 0–32 step 4 default 8. Blocks, `max_blocks: 16`: `image` (`image`, `caption` 80, `subcaption` 60, `link` url).
  - Presets: collage → `{ layout: 'text-left', feature_tile: 'first' }` with three empty `image_tile` blocks; shop-the-look → `{ show_list: true }` with no blocks; image-gallery → `{ layout: 'grid', columns: 4 }` with four empty `image` blocks.

- [ ] **Step 1: Write the failing tests**

```ts
// premium-sections.test.ts
it('registers the three sections for the right templates', () => {
  expect(getSectionSchema('collage')!.templates).toEqual(['home', 'page']);
  expect(getSectionSchema('shop-the-look')!.templates).toEqual(['home', 'page', 'product']);
  expect(getSectionSchema('image-gallery')!.templates).toEqual(['home', 'page', 'product']);
  expect(sectionsForTemplate('home').map((s) => s.type)).toEqual(expect.arrayContaining(['collage', 'shop-the-look', 'image-gallery']));
});
it('hotspot x/y clamp to 0–100 and default to 50', () => {
  const t = sanitizeThemeData(themeWith('shop-the-look', {}, [blk('hotspot', { product: UUID_A, x: 140, y: -3 }), blk('hotspot', { product: UUID_B, x: 'left' })]));
  const s = t.templates.home.sections.a;
  expect(s.blocks['hotspot-1'].settings).toMatchObject({ x: 100, y: 0 });
  expect(s.blocks['hotspot-2'].settings.x).toBeUndefined(); // the renderer falls back to the schema default 50
});
it('caps blocks at 4 / 6 / 16', () => { /* sanitizeThemeData drops the 5th collage tile, 7th hotspot, 17th image */ });
it('data() asks for the blocks\' products and only those', () => {
  const schema = getSectionSchema('shop-the-look')!;
  expect(schema.data!({}, [{ type: 'hotspot', settings: { product: UUID_A } }, { type: 'hotspot', settings: { product: UUID_A } }, { type: 'hotspot', settings: {} }])).toEqual({ productIds: [UUID_A] });
  expect(schema.data!({}, [])).toEqual({});
  expect(getSectionSchema('collage')!.data!({}, [{ type: 'product_tile', settings: { product: UUID_B } }])).toEqual({ productIds: [UUID_B], categories: true, categoriesOptional: true });
});
// section-data.test.ts (append)
it('collectDataRequests hands each schema its enabled blocks in order', () => {
  // a shop-the-look section with hotspot-1 (A, disabled) and hotspot-2 (B) → request productIds [B]
});
```

Check how `sanitizeSettingValue` treats a `range` value that is not a number (settings.ts `sanitizeNumber` returns undefined) and write the `x: 'left'` assertion to match that behaviour.

- [ ] **Step 2: Run to verify they fail** — `npx jest tests/lib/store/engine/premium-sections.test.ts tests/lib/store/engine/section-data.test.ts`: FAIL (schemas null).

- [ ] **Step 3: Implement** the three schema files, `block-products.ts`, the `data` signature change (`collectDataRequests` builds the blocks list from `section.block_order` / `section.blocks`, skipping `disabled`), and the registry entries (categories Banners / Products / Media are existing `SectionSchema['category']` values).

- [ ] **Step 4: Run** `npx jest tests/lib/store/engine && npx tsc --noEmit -p .` — PASS, clean (the parity test stays green: no preset changes yet).

- [ ] **Step 5: Commit** — `git add lib/store/engine/sections/collage.ts lib/store/engine/sections/shop-the-look.ts lib/store/engine/sections/image-gallery.ts lib/store/engine/block-products.ts lib/store/engine/schema-types.ts lib/store/engine/section-data.ts lib/store/engine/registry.ts tests/lib/store/engine/premium-sections.test.ts tests/lib/store/engine/section-data.test.ts` — message: "Collage, Shop the look and Image gallery sections exist in Studio 2 (schemas only), and a section's data request can read its blocks so product tiles and hotspots load their products".

---

### Task 2: Collage renderer

**Files:**
- Create: `lib/store/engine/collage-map.ts`, `components/store/engine/sections/Collage.tsx`, `components/store/engine/premium-section-rules.ts`
- Modify: `components/store/engine/registry.tsx` (`SECTION_COMPONENTS.collage`), `components/store/engine/EngineShell.tsx` (`THEME_RULES + CONTENT_BLOCK_RULES + PREMIUM_SECTION_RULES + STYLE_RULES`)
- Test: `tests/lib/store/engine/collage-map.test.ts`, `tests/lib/store/engine/premium-section-rules.test.ts`

**Interfaces:**
- Consumes: `SectionData.productsById: Record<string, StoreItem>`, `SectionData.categories: SectionCategory[]` (id, name, image_url), `blockSettings` from `sections/shared.ts`, `videoUrl`-style detection used by the Slideshow for a tile `image` that is a video (read `Slideshow.tsx` for the helper name).
- Produces: `type CollageTile = { id: string } & ({ kind: 'image'; image: string; video: boolean; caption: string; label: string; link: string } | { kind: 'product'; product: StoreItem; image: string } | { kind: 'category'; categoryId: string; name: string; image: string })`; `collageTiles(section, data, settingsOf): CollageTile[]` (skips disabled/unknown blocks, image tiles with no image, product tiles whose product is not in `productsById`, category tiles whose category is not in `data.categories`; a product/category tile's `image` override wins over the product photo / category image); `collageMode(layout: string, tileCount: number): 'text' | 'text+tiles' | 'tiles' | 'empty'` (`text-left`/`text-right` with 0 tiles → `'text'`, with tiles → `'text+tiles'`; `tiles` with tiles → `'tiles'`, with none → `'empty'`, and the renderer returns null only for `'empty'`); `PREMIUM_SECTION_RULES: string`.

- [ ] **Step 1: Write the failing tests**

```ts
// collage-map.test.ts
it('maps the three tile kinds and drops the unresolvable ones', () => {
  const data = { productsById: { [A]: itemA }, categories: [{ id: C, name: 'Sarees', item_count: 3, image_url: '/c.webp' }] };
  const tiles = collageTiles(sec('collage', {}, [blk('image_tile', { image: '/x.webp', caption: 'Kashi', label: '₹1,85,000' }), blk('product_tile', { product: A }), blk('product_tile', { product: B }), blk('category_tile', { category: C, image: '/override.webp' }), blk('image_tile', {})]), data, (b) => ({ ...b.settings }));
  expect(tiles.map((t) => t.kind)).toEqual(['image', 'product', 'category']);
  expect(tiles[2]).toMatchObject({ kind: 'category', categoryId: C, name: 'Sarees', image: '/override.webp' });
});
it('flags a video tile', () => { /* image ending .mp4 → video: true */ });
it('a text layout with no tiles still shows the text; a tiles layout with none is empty', () => {
  expect(collageMode('text-left', 0)).toBe('text');
  expect(collageMode('text-right', 2)).toBe('text+tiles');
  expect(collageMode('tiles', 0)).toBe('empty');
  expect(collageMode('tiles', 3)).toBe('tiles');
});
// premium-section-rules.test.ts
it('scopes every rule under the engine root and covers the collage layouts', () => {
  for (const cls of ['eng-collage', 'eng-collage--text-right', 'eng-collage--tiles', 'eng-collage--feature', 'eng-collage-tile']) expect(PREMIUM_SECTION_RULES).toContain(cls);
});
```

- [ ] **Step 2: Run to verify they fail** — FAIL (modules missing).

- [ ] **Step 3: Implement**
  - `Collage.tsx` (server): `const tiles = collageTiles(section, data ?? {}, (b) => blockSettings(section.type, b))`; with `layout !== 'tiles'` render the text column (eyebrow `.eyebrow`, heading `h2`, rich text via `richtextHtml`, up to two `EngineCtaButton`s in a `.eng-cb-buttons` row) and the tile grid; with `tiles` layout and no tiles return null; with text layout and no tiles render only the text column full width. Tile markup: `<a class="eng-collage-tile" data-kind>` with the image (a `<video muted loop playsInline autoPlay>` when `video`), caption and label overlays, product tiles show name + `rupees(price)` (reuse the Studio tile's price formatter import), category tiles the name; links: image tile `link`, product `/products/<id>`, category `/catalog/<id>` (through `ctaTarget` / the catalog link helper the Collection list uses).
  - Classes: `eng-collage eng-collage--<layout> eng-collage--feature` (when `feature_tile === 'first'` and ≥2 tiles) `eng-collage--<tile_shape>`; CSS: two-column grid on wide screens (text 6 / tiles 6), tiles as a 2×2 grid with the first spanning both rows when featured, portrait `aspect-ratio: 3/4` / square `1/1`; `@container store (max-width: 640px)` stacks text then tiles two per row; `.eng-collage--tiles` spans the full width.
  - Register the component; append `PREMIUM_SECTION_RULES` to the stylesheet concatenation.

- [ ] **Step 4: Run** `npx jest tests/lib/store/engine && npx tsc --noEmit -p .` — PASS.

- [ ] **Step 5: Commit** — "The Collage section renders a text column beside up to four image, product or category tiles, with the first tile large"

---

### Task 3: Shop the look renderer with hotspots and add-to-bag

**Files:**
- Create: `lib/store/engine/shop-the-look-map.ts`, `components/store/engine/sections/ShopTheLook.tsx` (server), `components/store/engine/sections/ShopTheLookClient.tsx` (`'use client'`)
- Modify: `components/store/engine/registry.tsx`, `components/store/engine/premium-section-rules.ts`
- Test: `tests/lib/store/engine/shop-the-look-map.test.ts`, `tests/lib/store/engine/premium-section-rules.test.ts`

**Interfaces:**
- Consumes: `useStore().addToCart({ itemId, name, price, quantity: 1, imageUrl, unit, maxStock, taxRate, mrp? })` exactly as `StoreProductCard.tsx:211-220` builds it; `StoreItem` fields `current_stock`, `has_variants`, `selling_price`, `mrp`, `image_url`, `images`, `unit`, `tax_rate`.
- Produces: `type LookItem = { id: string; n: number; x: number; y: number; label: string; product: StoreItem; soldOut: boolean; hasOptions: boolean }`; `shopTheLookItems(section, data, settingsOf): LookItem[]` (hotspots in block order numbered 1..n after skipping blocks whose product is missing; `x`/`y` default 50 and clamp 0–100; `label` falls back to the product name; `soldOut = current_stock <= 0 && !has_variants`; `hasOptions = has_variants`); `lookTotal(items): number` (sum of `selling_price` over items that are neither sold out nor with options).

- [ ] **Step 1: Write the failing tests**

```ts
it('numbers resolvable hotspots in order, clamps positions, marks sold out and options', () => {
  const data = { productsById: { [A]: { ...itemA, current_stock: 0 }, [B]: { ...itemB, has_variants: true } } };
  const items = shopTheLookItems(sec('shop-the-look', {}, [blk('hotspot', { product: MISSING, x: 10, y: 10 }), blk('hotspot', { product: A, x: 130, y: -5 }), blk('hotspot', { product: B, label: 'Choker' })]), data, (b) => ({ ...b.settings }));
  expect(items.map((i) => [i.n, i.x, i.y])).toEqual([[1, 100, 0], [2, 50, 50]]);
  expect(items[0]).toMatchObject({ soldOut: true, label: itemA.name });
  expect(items[1]).toMatchObject({ hasOptions: true, label: 'Choker' });
});
it('lookTotal sums only items that can be added', () => {
  expect(lookTotal([{ ...base, soldOut: true, product: { ...itemA, selling_price: 100 } }, { ...base, product: { ...itemB, selling_price: 250 } }])).toBe(250);
});
```

- [ ] **Step 2: Run to verify they fail** — FAIL.

- [ ] **Step 3: Implement**
  - `ShopTheLook.tsx` (server): maps items, returns null when there is no `image` and no items; renders eyebrow/heading/text, then `<ShopTheLookClient image imageSide items showList showAddAll listHeading total />`. In editor mode a section with an image but no items shows a small `.eng-look-empty` note "Add a hotspot and pick a product" (editor mode = the `eng-editor` root class; render the note unconditionally with CSS `.eng-root:not(.eng-editor) .eng-look-empty{display:none}`).
  - `ShopTheLookClient.tsx`: the photo in `.eng-look-photo` with absolutely positioned `<button class="eng-look-pin" style="left:x%;top:y%" aria-expanded>` numbered pins; one open at a time (state), opened by click/Enter/Space, closed by Esc or outside click; the card `.eng-look-card` shows the product photo, label, `rupees(price)` and either `Add to bag` (calls `addToCart` as above, then a brief "Added" state), `Choose options` (link to `/products/<id>`), or `Sold out` text. The list beside the photo repeats items with the same controls; `show_add_all` renders "Add all to bag · ₹total" that adds each addable item once. Links use `engineProductHref`-style helpers if the preview needs params (see how `EngineViews.tsx` builds product links).
  - CSS: `.eng-look` two-column grid (photo 7 / list 5, `--right` swaps order), pins 28px crimson-on-`--c-button` circles with `--c-button-text`, `.eng-look-card` on `--c-card` / `--c-border` with a soft shadow; phones stack photo then list.

- [ ] **Step 4: Run** `npx jest tests/lib/store/engine && npx tsc --noEmit -p .` — PASS.

- [ ] **Step 5: Commit** — "Shop the look: numbered hotspots on a photo open a card with the product's photo, price and Add to bag; the items are listed beside the photo with an optional Add all"

---

### Task 4: Image gallery renderer

**Files:**
- Create: `lib/store/engine/image-gallery-map.ts`, `components/store/engine/sections/ImageGallery.tsx`
- Modify: `components/store/engine/registry.tsx`, `components/store/engine/premium-section-rules.ts`
- Test: `tests/lib/store/engine/image-gallery-map.test.ts`, `tests/lib/store/engine/premium-section-rules.test.ts`

**Interfaces:**
- Produces: `type GalleryImage = { id: string; image: string; caption: string; subcaption: string; href: string | null }`; `galleryImages(section, settingsOf): GalleryImage[]` (skips disabled blocks and blocks without an image; `href` from `ctaTarget(link)` as `LogoList.tsx` does); `galleryClass(settings): string` → `eng-gallery eng-gallery--<layout> eng-gallery--<shape> eng-gallery--hover-<hover>` with `--eng-cols` and `--eng-gap` inline variables set by the renderer (columns clamped 2–6, gap 0–32).

- [ ] **Step 1: Write the failing tests** — `galleryImages` drops imageless and disabled blocks and maps the link; `galleryClass({ layout: 'strip', shape: 'natural', hover: 'none' })` equals `'eng-gallery eng-gallery--strip eng-gallery--natural eng-gallery--hover-none'`; unknown values fall back to the defaults; rules contain `eng-gallery--masonry`, `eng-gallery--strip`, `scroll-snap-type`.

- [ ] **Step 2: Run to verify they fail** — FAIL.

- [ ] **Step 3: Implement** the mapper, the renderer (eyebrow/heading, then `<ul>` of figures: `<a>` when `href`, `<img loading="lazy">`, `<figcaption>` with caption and subcaption; returns null with no images) and CSS: grid `repeat(var(--eng-cols),1fr)`, masonry `columns: var(--eng-cols)`, strip `display:flex; overflow-x:auto; scroll-snap-type:x mandatory` with each figure `flex: 0 0 calc(100%/var(--eng-cols))`; shapes `aspect-ratio 1/1` / `3/4` / none; hover captions overlay with opacity 0 → 1 on `:hover`/`:focus-within`, always visible under `@media (hover: none)`; `hover-none` hides captions; phones `--eng-cols: 2` (strip keeps its own).

- [ ] **Step 4: Run** `npx jest tests/lib/store/engine && npx tsc --noEmit -p .` — PASS.

- [ ] **Step 5: Commit** — "Image gallery: a grid, masonry or sideways strip of photos with captions on hover"

---

### Task 5: The Heritage Couture preset

**Files:**
- Create: `lib/store/engine/presets/heritage.ts`, `public/store-presets/heritage/{hero-1,hero-2,hero-3,look,story,gallery-1,gallery-2,gallery-3,gallery-4}.svg`
- Modify: `lib/store/engine/types.ts` (`ThemePreset`), `lib/store/engine/root-class.ts:4` (PRESETS), `app/api/settings/online-store/themes/route.ts:11` (PRESETS), `lib/store/engine/presets/look.ts` (`PRESET_LOOK.heritage`, `PRESET_SCHEMES`, `schemesFor`), `lib/store/engine/presets/index.ts` (`presetTheme` case), `lib/store/engine/library.ts` (`PRESET_CHOICES` entry with `premium: true`, `presetLabel`), `lib/store/engine/card-look.ts` (`PRESET_CARD_FIELDS`), `components/store/engine/EngineShell.tsx` (cardLook from `PRESET_CARD_FIELDS[theme.preset]`)
- Test: `tests/lib/store/engine/presets.test.ts`, `tests/lib/store/engine/preset-look.test.ts`, `tests/lib/store/engine/library.test.ts`, `tests/lib/store/engine/root-class.test.ts`, `tests/lib/store/engine/card-look.test.ts`

**Interfaces:**
- Produces: `ThemePreset = 'studio' | 'quick' | 'grocery' | 'khatario' | 'blank' | 'heritage'`; `PRESET_SCHEMES: Partial<Record<ThemePreset, ColorScheme[]>>` consulted by `schemesFor(preset, accent, canvas?)` before deriving (the store's `accent`, when valid, replaces `button` on Ivory, Parchment and Cream and `background` on Crimson); `PRESET_CARD_FIELDS: Record<ThemePreset, { tagline: boolean; swatches: boolean }>` (client-safe, in `card-look.ts`; heritage `true/true`, others `false/false`); `PresetChoice.premium?: true`; `heritagePreset(ctx: PresetContext): ThemeData`.

- [ ] **Step 1: Write the failing tests**

```ts
// preset-look.test.ts (append; also add 'heritage' to its PRESETS list and a PRESET_LOOK.heritage toEqual with the Global Constraints values)
it('heritage uses its fixed six schemes and the store accent replaces the button colour', () => {
  const s = schemesFor('heritage', undefined);
  expect(s.map((x) => x.name)).toEqual(['Ivory', 'Parchment', 'Crimson', 'Dark', 'Cream', 'Gold']);
  expect(s[0]).toMatchObject({ background: '#fcf9f3', accent: '#c89d53', button: '#7a0c1e' });
  expect(s[3].background).toBe('#1b1514');
  expect(schemesFor('heritage', '#004537')[0].button).toBe('#004537');
});
// presets.test.ts (append)
it('heritage passes the sanitiser unchanged and uses only registered sections and blocks', () => {
  const t = heritagePreset(CTX);
  expect(sanitizeThemeData(t)).toEqual(t);
  const types = [...Object.values(t.header_group.sections), ...Object.values(t.footer_group.sections), ...Object.values(t.templates).flatMap((tpl) => Object.values(tpl.sections))].map((s) => s.type);
  expect(types).toEqual(expect.arrayContaining(['collage', 'shop-the-look', 'image-gallery', 'featured-products', 'testimonials', 'logo-list', 'newsletter']));
  for (const s of Object.values(t.templates.home.sections)) expect(getSectionSchema(s.type)).not.toBeNull();
});
it('heritage home has the spec\'s section order and switches', () => {
  const home = heritagePreset(CTX).templates.home;
  expect(home.order.map((id) => home.sections[id].type)).toEqual(['collage', 'multicolumn', 'promo-cards', 'featured-products', 'image-with-text', 'shop-the-look', 'testimonials', 'logo-list', 'image-gallery', 'newsletter']);
  expect(home.sections[home.order[3]].settings).toMatchObject({ columns: 4, show_badges: true, show_tagline: true, show_swatches: true });
  expect(heritagePreset(CTX).templates.product.sections['main-product'].block_order.filter((id) => id.startsWith('collapsible-tab'))).toHaveLength(3);
});
// library.test.ts: PRESET_CHOICES now ends with heritage, label 'Heritage Couture', premium true, swatches equal PRESET_LOOK.heritage
// root-class.test.ts: 'heritage' is accepted (eng-preset-heritage) ; card-look.test.ts: PRESET_CARD_FIELDS.heritage is { tagline: true, swatches: true }, studio false/false
```

- [ ] **Step 2: Run to verify they fail** — FAIL (type errors / missing exports; use `npx jest` on the five files).

- [ ] **Step 3: Implement**
  - Sample SVGs: nine files, each 1200×1500 (hero/look/story) or 1200×1200 (gallery), ivory background with a crimson/gold geometric motif (a jaali-style dot lattice, a paisley outline or diagonal bands) and no text; keep each under 4 KB.
  - `presets/heritage.ts` builds, with `section`/`block`/`onScheme`/`template` from `presets/shared.ts` and `defaultTemplate('catalog')` from `presets/templates.ts`:
    - `settings: presetSettings(ctx, 'heritage')` (the look table supplies fonts, radius, cards and the three style fields).
    - Header group: announcement `onScheme(…, 'scheme-3')` (Crimson) with text `ctx.tagline || 'Complimentary shipping on orders over ₹15,000'`; header exactly as `studio.ts` builds its header (same block or menu shape), menu labels "New in", "Sarees", "Bridal", "Jewellery", "Our story" → links `/catalog`, `/catalog`, `/catalog`, `/catalog`, `/pages/about` (the owner retargets).
    - Home, in this order: `collage` (`layout: 'text-left'`, `feature_tile: 'first'`, eyebrow "Festive & bridal edit", heading `Welcome to ${businessName}`, text `<p>${tagline}</p>` or a neutral line, button "Explore the collection" → `/catalog`, second button "Our story" → `/pages/about`, three `image_tile`s with `/store-presets/heritage/hero-1.svg` …`hero-3.svg`) → `multicolumn` with four columns (icons `truck`, `shield`, `return`, `badge`; titles "Insured delivery", "Certified materials", "Made to measure", "Personal concierge"; one-line texts) → `promo-cards` (`style: 'overlay'`, `columns: 4`, four cards with eyebrow/heading/button and `gallery-1..4.svg`, links `/catalog`) → `featured-products` (`heading` "Signature pieces", `source: 'featured'`, `limit: 8`, `columns: 4`, `show_badges: true`, `show_tagline: true`, `show_swatches: true`) → `image-with-text` (`image: story.svg`, `image_side: 'left'`, blocks: eyebrow "Our craft", heading "Made by hand, for keeps", text paragraph, quote + attribution placeholders "A line from your founder" / "Founder", three `checklist_item`s, button "Read our story" → `/pages/about`, highlight card eyebrow "Our promise" / title "Every piece documented" / text) → `shop-the-look` (`image: look.svg`, `show_list: true`, no hotspots) → `testimonials` (`show_summary: false`, one quote block "Tell shoppers what a customer said about you." name "A customer") → `logo-list` (`heading` "As featured in", three logo blocks with `name` "Your press mention", "Another publication", "A magazine", captions empty) → `image-gallery` (`layout: 'grid'`, `columns: 4`, four `image` blocks with `gallery-1..4.svg`, subcaptions "@yourstore") → `newsletter` (heading "Private previews", text "Be first to see new pieces and festive edits.").
    - Product: `main-product` with blocks title (`show_tagline: true`), price, variant_picker, buy_buttons, description, three `collapsible_tab`s ("Craft and provenance", "Care", "Delivery and returns", each `<p>` placeholder), then `product-reviews`, `related-products`, `recently-viewed`.
    - Catalog: `defaultTemplate('catalog')` with the grid's `columns_desktop: 4`.
    - Footer: `studioFooter()` from `studio.ts` with `onScheme(…, 'scheme-4')` (Dark), `show_payment_icons: true`, about text `tagline`.
  - `look.ts`: `PRESET_LOOK.heritage` (values in Global Constraints); `PRESET_SCHEMES.heritage` with ids `scheme-1..6`, names Ivory `#fcf9f3`/ink `#1c1c18`/accent gold/button crimson/button_text `#ffffff`/border `mixHex('#1c1c18','#fcf9f3',0.12)`/card `#ffffff`; Parchment `#f4ece0` likewise; Crimson background `#7a0c1e` text `#fcf9f3` accent gold button gold button_text `#1c1c18`; Dark `#1b1514` text `#fbf8f5` accent gold button gold button_text `#1b1514` border `#3d3230` card `#2a2220`; Cream `#faf5ed` like Ivory; Gold background `#c89d53` text `#1c1c18` accent crimson button crimson button_text `#ffffff`. `schemesFor` returns a copy of the fixed table when present, applying the accent rule above.
  - `types.ts`, `root-class.ts`, the themes route's `PRESETS`, `presetTheme`, `library.ts` (`PRESET_CHOICES` entry: label "Heritage Couture", description "Ivory, crimson and gold with serif headings: a boutique for fashion, couture and jewellery. Comes with sample images; replace them with yours", canvas `#fcf9f3`, accent `#7a0c1e`, `premium: true`; `presetLabel('heritage')` → "Heritage Couture"), `card-look.ts` `PRESET_CARD_FIELDS`, `EngineShell` reads it for `cardLook`.
  - Any other `Record<ThemePreset, …>` or preset list the compiler flags (grep `'khatario'` under `lib/store/engine`, `components/store/library`, `tests/lib/store/engine`) gets a heritage entry.

- [ ] **Step 4: Run** `npx jest tests/lib/store && npx tsc --noEmit -p .` — PASS (preset-parity stays green: the existing presets are untouched).

- [ ] **Step 5: Commit** — `git add lib/store/engine/presets/heritage.ts public/store-presets/heritage lib/store/engine/types.ts lib/store/engine/root-class.ts app/api/settings/online-store/themes/route.ts lib/store/engine/presets/look.ts lib/store/engine/presets/index.ts lib/store/engine/library.ts lib/store/engine/card-look.ts components/store/engine/EngineShell.tsx tests/lib/store/engine` — "Heritage Couture preset: ivory, crimson and gold schemes, serif headings, a collage hero, shop the look, gallery and press row, built only from engine sections"

---

### Task 6: The premium flag

**Files:**
- Create: `database/migrations/459_store_premium_themes.sql`, `lib/store/engine/premium.ts`
- Modify: `app/api/settings/online-store/themes/route.ts` (GET response, POST refusal), `components/store/library/api.ts` (`listThemes` returns `{ themes, premium_enabled }`), `components/store/library/ThemeLibrary.tsx` (state + prop), `components/store/library/AddThemeModal.tsx` (`premiumEnabled` prop: hide premium choices when false; "Premium" tag when true), `lib/store/engine/library.ts` (`visiblePresetChoices(premiumEnabled): PresetChoice[]`, `isPremiumPreset(p): boolean`)
- Test: `tests/lib/store/engine/library.test.ts`, `tests/lib/store/engine/premium-route.test.ts` (new, mocks like `theme-read-permission.test.ts`), `tests/db/store-premium-flag.db.test.ts` (new)

**Interfaces:**
- Produces: `premiumThemesEnabled(businessId: string): Promise<boolean>` (reads `business_settings.store_premium_themes`; a missing row is `false`); GET `/api/settings/online-store/themes` → `{ themes: ThemeListRow[], premium_enabled: boolean }`; POST with `source: 'preset'`, no `duplicate_of`, and `isPremiumPreset(preset)` while the flag is off → `403 { error: 'Premium themes are not enabled for this store', code: 'premium_locked' }`; duplicates (`duplicate_of`), `source: 'migrated'`, version restore and editing are never gated.

- [ ] **Step 1: Write the failing tests**

```ts
// library.test.ts (append)
it('hides premium presets until the flag is on', () => {
  expect(visiblePresetChoices(false).map((c) => c.preset)).toEqual(['studio', 'quick', 'grocery', 'khatario', 'blank']);
  expect(visiblePresetChoices(true).map((c) => c.preset)).toContain('heritage');
  expect(isPremiumPreset('heritage')).toBe(true); expect(isPremiumPreset('studio')).toBe(false);
});
// premium-route.test.ts: mock requireTenantPermission, denyIfFeatureMissing (allowed), premiumThemesEnabled → false; POST { preset: 'heritage' } → 403 code premium_locked; POST { preset: 'heritage', duplicate_of: '<uuid>' } → not refused by the flag (createTheme mock called); POST { preset: 'studio' } → createTheme called; GET → body.premium_enabled false
// store-premium-flag.db.test.ts: a fresh business_settings row has store_premium_themes false; premiumThemesEnabled(BIZ) false, true after UPDATE, false for an unknown business
```

- [ ] **Step 2: Run to verify they fail** — FAIL.

- [ ] **Step 3: Implement** the migration (`ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS store_premium_themes BOOLEAN NOT NULL DEFAULT false;` with a one-line comment; apply to the test DB only), `premium.ts`, the route changes, `library.ts` helpers, `api.ts` (keep `listThemes()` returning rows for existing callers and add `listThemesWithFlags()` returning both, or change the one caller: pick whichever leaves other callers untouched), `ThemeLibrary` → `AddThemeModal premiumEnabled`; the modal renders `visiblePresetChoices(premiumEnabled)` and, for a `premium` choice, a small "Premium" pill after the label.

- [ ] **Step 4: Run** `npx jest tests/lib/store tests/db/store-premium-flag.db.test.ts && npx tsc --noEmit -p .` — PASS.

- [ ] **Step 5: Commit** — "Premium presets sit behind a per-store flag: hidden in Add theme and refused on create until it is on; existing premium themes stay editable; migration 459"

---

### Task 7: E2E scenarios, docs, full suite

**Files:**
- Modify: `e2e/store-studio2.spec.ts`, `e2e/store-theme-library.spec.ts`
- Create: `docs/superpowers/plans/2026-10-31-store-heritage-couture-staging-checklist.md`, `docs/store-engine/design-to-preset.md`, `docs/superpowers/plans/2026-10-31-store-heritage-couture-carryover.md`

- [ ] **Step 1: Full suite and build** — `npx jest tests/lib/store tests/db/store-premium-flag.db.test.ts tests/db/store-section-products-by-id.db.test.ts && npx tsc --noEmit -p . && npx next build` (build in the background; fix only an error in files this plan touched). Note the counts.

- [ ] **Step 2: E2E scenarios (written, not run)** — Studio 2 spec: (a) add a Collage, set an image tile and a product tile (pick the first product in the picker), save, reload, assert both tiles render; (b) add Shop the look, set the image, add a hotspot with a product at x 30 / y 40, assert the pin sits at those percentages and clicking it opens a card with "Add to bag"; (c) add an Image gallery with two images and `layout: 'strip'`, assert the `eng-gallery--strip` class. Library spec: (d) with the flag off the Add theme modal lists five presets and no "Premium" pill, and a direct POST with `preset: 'heritage'` returns 403 `premium_locked`; (e) after `UPDATE business_settings SET store_premium_themes = true` for the E2E business (through the test DB helper the spec already uses), the card appears with the pill and creating it yields a draft named "Heritage Couture" whose home starts with a Collage. Restore the flag in `finally`.

- [ ] **Step 3: Docs**
  - Staging checklist, same style as the M5 one: turn the flag on for the E2E store; Add theme → Heritage Couture; preview on desktop and 390 px: collage hero, pillars, four promo cards, Signature pieces with badge/tagline/swatches on a real item, story section with the highlight card, shop the look (add two hotspots, open a pin, Add to bag, Add all), testimonials summary, press names, gallery grid/masonry/strip, newsletter, dark footer; product page tabs and tagline; catalog 4 columns; fonts Newsreader/Manrope; Style settings on; flag off → card hidden and POST refused, existing heritage theme still opens; plan 1's checklist items that are still unchecked.
  - `docs/store-engine/design-to-preset.md`: the checklist for the next design: (1) list the design's parts top to bottom; (2) map each to a section type (table of all section types with what they can show); (3) for each gap decide setting vs new general section vs out of scope, with the "general, not design-specific" rule and examples (Collage not "hero mosaic"); (4) product data the design assumes (badge, tagline, swatches, variants); (5) fonts and style settings; (6) write the preset file from `presets/heritage.ts` as the template; (7) sanitiser test, parity test unaffected, staging checklist.
  - Carry-over: open items, deferred minors from the reviews, plan 1's still-open list, and "Owed at merge: log entry and roadmap card (controller)".

- [ ] **Step 4: Commit** — "E2E scenarios for Collage, Shop the look, Image gallery and the premium flag; the Heritage staging checklist; the design-to-preset checklist for the next theme"
