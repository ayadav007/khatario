# Premium theme foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the store engine the pieces a premium theme needs and every theme can use: six more fonts, three theme style settings, product badge/tagline/swatch fields shown on cards, a products-by-id loader, content blocks in Image with text and Rich text (with a one-time conversion of existing themes), and small block upgrades to Testimonials, Logo list, Promo cards and Multicolumn. Existing stores look the same afterwards.

**Architecture:** Every change is additive with a default equal to today's behaviour, or a conversion that runs once inside `sanitizeThemeData` (the same place `convertLegacyMenus` runs). Pure, client-safe mappers live in `lib/store/engine/` and are unit-tested; server renderers in `components/store/engine/sections/` stay thin. Product fields are columns on `items`, validated by `validateProductExtras`, read through the shared `storeItemSelectSql`, so the engine, the old storefront and the public API see one `StoreItem`.

**Tech Stack:** Next.js 14 app router, React 18, TypeScript, Postgres, Jest + ts-jest (`npx jest <path>`; node env, `.ts` tests only), `next/font/google`.

**Spec:** `docs/superpowers/specs/2026-10-31-store-premium-themes-design.md` (§2, §3, §4 "Products by id", §5, §7, §8). Plan 2 (Heritage Couture: the three new sections, the preset, the premium flag) follows this one.

## Global Constraints

- Migrations are written under `database/migrations/` and applied to `kh_phase2_test` only; never to staging or production (AGENTS.md).
- Stage files by name; commit on `main` after each task; never push.
- Defaults: `label_style: 'normal'`, `frame_style: 'none'`, `texture: 'none'`, `show_tagline: false`, `show_swatches: false`, `show_summary: false`; every existing preset's sanitised output is unchanged except for these defaults and the text-section blocks (Task 8 proves it).
- Limits from the spec: badge 24 chars, tagline 60, swatch name 30, 6 swatches, 12 content blocks, `productIds` at most 12 per section, Promo cards columns 1–4.
- Field ids and values exactly as the spec writes them (`store_badge`, `store_tagline`, `store_swatches`, `label_style` `normal|caps`, `frame_style` `none|accent`, `texture` `none|dots|linen|grid`, fonts `cinzel newsreader manrope dm-serif lora poppins`).
- The menus sub-project is in flight in `menus-sanitize.ts`, `header.ts`, `footer.ts` and `sanitize.ts`: do not touch header or footer schemas; in `sanitize.ts` add only the one conversion call.

## Review Focus

1. A swatch hex typed as `#ABC` or `#AABBCC` must be kept (lower-cased, 3 or 6 digits); `#aabbccdd` (alpha) and `red` must be dropped, not fail the whole save. Test in Task 3.
2. A theme saved half-way (a text section that has blocks *and* leftover `heading`/`description` keys) must keep its blocks and lose the old keys, never gain duplicates. Test in Task 7.
3. A product with `store_badge` set *and* a discount shows only the custom badge (no "20% OFF", no "New"); with it empty the automatic badges are as today. Test in Task 5.
4. Two sections asking for the same product id, one of them also asking for a hidden (`show_in_store = false`) id: one query, hidden id absent, each section's items in its own block order. Test in Task 6.
5. A style value in the wrong case or from the future (`label_style: 'CAPS'`, `texture: 'stripes'`) falls back to the default and never reaches the root class. Test in Task 2.

---

### Task 1: Six more store fonts

**Files:**
- Modify: `app/store/layout.tsx` (font declarations, root class list)
- Modify: `lib/store/store-theme.ts:83-100` (`STORE_FONT_FAMILIES`), `storeFontStack` (~line 560)
- Modify: `lib/store/engine/settings.ts:13` (`FONTS`)
- Modify: `lib/store/engine/editor/fields.ts:190` (`FONT_OPTIONS` labels)
- Test: `tests/lib/store/engine/settings.test.ts`, `tests/lib/store/store-theme-fonts.test.ts` (new)

**Interfaces:**
- Produces: `STORE_FONT_FAMILIES` includes `'cinzel' | 'newsreader' | 'manrope' | 'dm-serif' | 'lora' | 'poppins'`; `storeFontStack(f)` returns `var(--font-store-<f>), Georgia, serif` for cinzel, newsreader, dm-serif and lora, `var(--font-store-<f>), system-ui, sans-serif` for manrope and poppins.

Decision (not in the spec, replaces its "apply only the two chosen fonts" mechanism with a simpler one that gives the same result): every font is declared with `preload: false` except Inter. `next/font` then emits only `@font-face` rules and the CSS variable; the browser downloads a font file only when text actually uses that family, so thirteen declared fonts cost nothing until a theme picks one. The root keeps every `.variable` class, as today.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/store/store-theme-fonts.test.ts
import { STORE_FONT_FAMILIES, storeFontStack } from '@/lib/store/store-theme';
it('lists the six new families', () => {
  for (const f of ['cinzel', 'newsreader', 'manrope', 'dm-serif', 'lora', 'poppins']) expect(STORE_FONT_FAMILIES).toContain(f);
});
it('maps each new family to its variable with the right fallback', () => {
  expect(storeFontStack('cinzel')).toBe('var(--font-store-cinzel), Georgia, serif');
  expect(storeFontStack('manrope')).toBe('var(--font-store-manrope), system-ui, sans-serif');
  expect(storeFontStack('dm-serif')).toBe('var(--font-store-dm-serif), Georgia, serif');
});
// tests/lib/store/engine/settings.test.ts (append)
it('accepts the new fonts and rejects unknown ones', () => {
  const font = { id: 'f', type: 'font', label: 'F' } as const;
  expect(sanitizeSettingValue(font, 'newsreader')).toBe('newsreader');
  expect(sanitizeSettingValue(font, 'comic-sans')).toBeUndefined();
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest tests/lib/store/store-theme-fonts.test.ts tests/lib/store/engine/settings.test.ts`
Expected: FAIL (`toContain` on `STORE_FONT_FAMILIES`, `storeFontStack` returns the system default, `'newsreader'` is `undefined`).

- [ ] **Step 3: Add the fonts**

In `app/store/layout.tsx`: import `Cinzel, Newsreader, Manrope, DM_Serif_Display, Lora, Poppins` from `next/font/google`; declare each with `subsets: ['latin']`, `display: 'swap'`, `preload: false`, variable `--font-store-<id>` (`--font-store-dm-serif` for DM Serif Display, which needs `weight: '400'`; Poppins needs `weight: ['400', '500', '600', '700']`); add `preload: false` to the existing six non-Inter fonts; append the six `.variable` classes to the root `className`. In `store-theme.ts`: extend `STORE_FONT_FAMILIES` and `storeFontStack`. In `engine/settings.ts`: replace the `FONTS` literal with `STORE_FONT_FAMILIES.filter((f) => f !== 'system')` (import from `@/lib/store/store-theme`; it is client-safe). In `editor/fields.ts`: `titleCase('dm-serif')` must read "DM Serif"; add a label map `{ 'dm-serif': 'DM Serif Display' }` consulted before `titleCase`.

- [ ] **Step 4: Run the tests and type-check**

Run: `npx jest tests/lib/store/store-theme-fonts.test.ts tests/lib/store/engine/settings.test.ts tests/lib/store/engine/editor-fields.test.ts && npx tsc --noEmit -p .`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add app/store/layout.tsx lib/store/store-theme.ts lib/store/engine/settings.ts lib/store/engine/editor/fields.ts tests/lib/store/store-theme-fonts.test.ts tests/lib/store/engine/settings.test.ts
git commit -m "Store themes can use Cinzel, Newsreader, Manrope, DM Serif Display, Lora and Poppins; fonts load only when a theme uses them"
```

---

### Task 2: Theme style settings (label style, frame style, texture)

**Files:**
- Modify: `lib/store/engine/types.ts` (`ThemeSettings`), `lib/store/engine/sanitize.ts` (`sanitizeThemeSettings`), `lib/store/engine/theme-settings-schema.ts`, `lib/store/engine/presets/look.ts` (`PresetLook`, `PRESET_LOOK`, `presetSettings`), `lib/store/engine/root-class.ts`, `components/store/engine/EngineShell.tsx:230-235` (root class call, `THEME_RULES`)
- Create: `components/store/engine/style-rules.ts`
- Test: `tests/lib/store/engine/root-class.test.ts`, `tests/lib/store/engine/sanitize.test.ts`, `tests/lib/store/engine/preset-look.test.ts`, `tests/lib/store/engine/style-rules.test.ts` (new)

**Interfaces:**
- Produces: `ThemeSettings.label_style: 'normal' | 'caps'`, `frame_style: 'none' | 'accent'`, `texture: 'none' | 'dots' | 'linen' | 'grid'`; `engineRootClass` input gains `style: Pick<ThemeSettings, 'label_style' | 'frame_style' | 'texture'>` and emits `eng-labels-caps`, `eng-frame-accent`, `eng-texture-<t>` only for non-default values; `STYLE_RULES: string` (CSS) exported from `components/store/engine/style-rules.ts` and concatenated into `THEME_RULES`.

- [ ] **Step 1: Write the failing tests**

```ts
// root-class.test.ts (append)
it('adds style classes only for non-default values and ignores unknown ones', () => {
  const base = { preset: 'studio' as const, phoneKit: false, editor: false, schemeBackground: '#fff' };
  expect(classes(engineRootClass({ ...base, style: { label_style: 'normal', frame_style: 'none', texture: 'none' } }).className)).not.toEqual(expect.arrayContaining([expect.stringMatching(/^eng-(labels|frame|texture)/)]));
  const c = classes(engineRootClass({ ...base, style: { label_style: 'caps', frame_style: 'accent', texture: 'dots' } }).className);
  expect(c).toEqual(expect.arrayContaining(['eng-labels-caps', 'eng-frame-accent', 'eng-texture-dots']));
  const bad = engineRootClass({ ...base, style: { label_style: 'CAPS' as never, frame_style: 'none', texture: 'stripes' as never } }).className;
  expect(bad).not.toMatch(/eng-(labels|texture)-/);
});
// sanitize.test.ts (append)
it('keeps valid style settings and defaults the rest', () => {
  const t = sanitizeThemeData({ settings: { label_style: 'caps', frame_style: 'accent', texture: 'linen' } });
  expect(t.settings).toMatchObject({ label_style: 'caps', frame_style: 'accent', texture: 'linen' });
  const d = sanitizeThemeData({ settings: { label_style: 'CAPS', texture: 'stripes' } });
  expect(d.settings).toMatchObject({ label_style: 'normal', frame_style: 'none', texture: 'none' });
});
// preset-look.test.ts (append)
it('every preset starts with the default style', () => {
  for (const p of PRESETS) expect(presetSettings({ businessName: 'X', tagline: '' }, p)).toMatchObject({ label_style: 'normal', frame_style: 'none', texture: 'none' });
});
// style-rules.test.ts (new)
import { STYLE_RULES } from '@/components/store/engine/style-rules';
it('scopes every rule under the engine root and covers each class', () => {
  for (const cls of ['eng-labels-caps', 'eng-frame-accent', 'eng-texture-dots', 'eng-texture-linen', 'eng-texture-grid']) expect(STYLE_RULES).toContain(`.eng-root.${cls}`);
  expect(STYLE_RULES).toContain('currentColor'); // textures draw in the section's text colour
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx jest tests/lib/store/engine/root-class.test.ts tests/lib/store/engine/sanitize.test.ts tests/lib/store/engine/preset-look.test.ts tests/lib/store/engine/style-rules.test.ts`
Expected: FAIL (missing fields, missing module).

- [ ] **Step 3: Implement**

- `types.ts`: add the three fields to `ThemeSettings` (exact unions above).
- `sanitize.ts` `sanitizeThemeSettings`: `pick` each against its allowed list, default otherwise (follow the `card_style` line).
- `theme-settings-schema.ts`: after `card_style`, insert `{ id: 'style_header', type: 'header', label: 'Style' }` and three `select` settings with the labels "Label style" (Normal / Spaced capitals), "Frame style" (None / Thin accent border), "Background texture" (None / Dots / Linen / Grid).
- `presets/look.ts`: `PresetLook` gains the three fields; every entry in `PRESET_LOOK` sets the defaults; `presetSettings` copies them. Update the `PRESET_LOOK` `toEqual` assertions in `preset-look.test.ts` to include the new fields.
- `root-class.ts`: new `style` input; a small table `{ label_style: { caps: 'eng-labels-caps' }, frame_style: { accent: 'eng-frame-accent' }, texture: { dots, linen, grid } }`; unknown values add nothing.
- `style-rules.ts`: `export const STYLE_RULES = '...'` with rules for `.st-root.eng-root.eng-labels-caps :is(.eyebrow,.badges em,.addBtn,.eng-cta,.eng-nav a){text-transform:uppercase;letter-spacing:.12em}`, `.st-root.eng-root.eng-frame-accent :is(.product,.heroImg,.eng-promos article,.eng-collections-grid a){border:1px solid var(--c-accent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--c-accent) 25%,transparent)}`, and one `background-image` per texture using `currentColor` at `opacity`-equivalent low alpha via `color-mix(in srgb, currentColor 10%, transparent)` on `.eng-sec` (dots: `radial-gradient(... 0.75px, transparent 0.75px)` 16px; linen: two crossed `repeating-linear-gradient`s; grid: two `linear-gradient`s 24px). Match the selector names the existing `THEME_RULES` and `studio-theme.css` use (check `.eyebrow`, `.eng-cta`, `.eng-nav` names in those files before writing).
- `EngineShell.tsx`: pass `style: { label_style: settings.label_style, frame_style: settings.frame_style, texture: settings.texture }` to `engineRootClass`; `THEME_RULES` becomes `THEME_RULES + STYLE_RULES` where it is injected.

- [ ] **Step 4: Run the tests and type-check**

Run: `npx jest tests/lib/store/engine && npx tsc --noEmit -p .`
Expected: PASS (whole engine suite still green), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add lib/store/engine/types.ts lib/store/engine/sanitize.ts lib/store/engine/theme-settings-schema.ts lib/store/engine/presets/look.ts lib/store/engine/root-class.ts components/store/engine/EngineShell.tsx components/store/engine/style-rules.ts tests/lib/store/engine/root-class.test.ts tests/lib/store/engine/sanitize.test.ts tests/lib/store/engine/preset-look.test.ts tests/lib/store/engine/style-rules.test.ts
git commit -m "Theme settings gain a Style group: spaced-capital labels, a thin accent frame and a dots, linen or grid texture"
```

---

### Task 3: Product card fields: columns, validation, reads

**Files:**
- Create: `database/migrations/458_store_product_card_fields.sql` (renumber to the next free number if 458 is taken when you start)
- Modify: `lib/store/product-extras.ts`, `app/api/items/route.ts:424-450`, `app/api/items/[id]/route.ts:372-445`, `lib/store/store-items-query.ts:105-125` (`storeItemSelectSql`), `lib/store/map-store-product.ts` (`StoreItem`, `mapStoreItemRow`), `app/api/public/store/[subdomain]/items/[id]/route.ts:22-80`, `components/store/StoreProductCard.tsx:17-50` (`StoreProduct`), `lib/store/theme-demo.ts` (`mk`)
- Test: `tests/lib/store/product-extras.test.ts` (append or create), `tests/db/store-product-card-fields.db.test.ts` (new)

**Interfaces:**
- Produces: `type StoreSwatch = { name: string; hex: string }`; `validateProductExtras` accepts `store_badge: string | null`, `store_tagline: string | null`, `store_swatches: StoreSwatch[]` and returns them cleaned in `value`; `StoreItem` and `StoreProduct` gain `store_badge: string | null`, `store_tagline: string | null`, `store_swatches: StoreSwatch[]` (optional on `StoreProduct`).

- [ ] **Step 1: Write the migration**

```sql
-- Premium themes: per-product card fields (badge text, craft/origin line, colour swatches).
ALTER TABLE items ADD COLUMN IF NOT EXISTS store_badge varchar(24);
ALTER TABLE items ADD COLUMN IF NOT EXISTS store_tagline varchar(60);
ALTER TABLE items ADD COLUMN IF NOT EXISTS store_swatches jsonb NOT NULL DEFAULT '[]'::jsonb;
```

Apply to the test DB only: `psql "$PHASE2_TEST_DATABASE_URL" -f database/migrations/458_store_product_card_fields.sql`.

- [ ] **Step 2: Write the failing validation tests**

```ts
// tests/lib/store/product-extras.test.ts
it('cleans badge, tagline and swatches', () => {
  const r = validateProductExtras({ store_badge: '  Pure Katan Silk  ', store_tagline: 'Varanasi • Kadwa weave', store_swatches: [{ name: 'Gold', hex: '#C89D53' }, { name: 'Bad', hex: 'red' }, { name: 'Alpha', hex: '#aabbccdd' }, { name: 'Short', hex: '#ABC' }] });
  expect(r).toEqual({ ok: true, value: { store_badge: 'Pure Katan Silk', store_tagline: 'Varanasi • Kadwa weave', store_swatches: [{ name: 'Gold', hex: '#c89d53' }, { name: 'Short', hex: '#abc' }] } });
});
it('clips to the limits and nulls empty text', () => {
  const r = validateProductExtras({ store_badge: 'x'.repeat(30), store_tagline: '', store_swatches: Array.from({ length: 7 }, (_, i) => ({ name: `s${i}`, hex: '#000' })) });
  expect(r.ok).toBe(false); // 7 swatches
  const ok = validateProductExtras({ store_badge: 'x'.repeat(30), store_tagline: '   ' });
  expect(ok).toEqual({ ok: true, value: { store_badge: 'x'.repeat(24), store_tagline: null } });
});
it('leaves absent keys out', () => {
  expect(validateProductExtras({ video_url: null })).toEqual({ ok: true, value: { video_url: null } });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx jest tests/lib/store/product-extras.test.ts`
Expected: FAIL (`value` lacks the new keys).

- [ ] **Step 4: Implement validation and plumbing**

- `product-extras.ts`: `export type StoreSwatch`; constants `MAX_BADGE = 24`, `MAX_TAGLINE = 60`, `MAX_SWATCHES = 6`, `MAX_SWATCH_NAME = 30`; in `validateProductExtras`, for each present key: text → trim, clip, `null` when empty; swatches → must be an array, else error "Swatches must be a list."; more than 6 → error "Up to 6 swatches."; each entry with a string `name` (trim, clip) and a hex matching `/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i` kept lower-cased, others dropped.
- Both item routes: add the three keys to the `hasExtras`/`patchExtras` key list and write them next to `store_tabs` (`store_swatches` as `::jsonb` of `JSON.stringify`).
- `storeItemSelectSql`: add `i.store_badge, i.store_tagline, COALESCE(i.store_swatches, '[]'::jsonb) AS store_swatches,`.
- `mapStoreItemRow`: `store_badge: (r.store_badge as string) || null`, same for tagline, `store_swatches: Array.isArray(r.store_swatches) ? r.store_swatches : []`; add the fields to `StoreItem`.
- Public item `[id]` route: add the three columns to the SELECT and the response (same shaping).
- `StoreProduct`: optional `store_badge?: string | null; store_tagline?: string | null; store_swatches?: StoreSwatch[]`.
- `theme-demo.ts` `mk`: an optional trailing `card?: { badge?: string; tagline?: string; swatches?: StoreSwatch[] }` argument; give `demo-1` (`Merino crew`) `{ badge: 'Pure merino', tagline: 'Spun in Ludhiana', swatches: [{ name: 'Oat', hex: '#d9cbb3' }, { name: 'Charcoal', hex: '#333333' }] }`.

- [ ] **Step 5: Write the DB test**

```ts
// tests/db/store-product-card-fields.db.test.ts (same skeleton as tests/db/quick-store.db.test.ts: PHASE2_TEST_DATABASE_URL, describe.skip otherwise)
it('stores and lists the card fields', async () => {
  // INSERT a business row and one item with show_in_store = true, store_badge 'Pure Katan Silk', store_tagline 'Varanasi', store_swatches '[{"name":"Gold","hex":"#c89d53"}]'
  const q = buildStoreItemsQuery({ businessId: BIZ, limit: 10, offset: 0 });
  const rows = (await pool.query(q.listSql, q.listParams)).rows.map(mapStoreItemRow);
  expect(rows[0]).toMatchObject({ store_badge: 'Pure Katan Silk', store_tagline: 'Varanasi', store_swatches: [{ name: 'Gold', hex: '#c89d53' }] });
});
```

Look at how `tests/db/quick-store.db.test.ts` inserts its business and items (columns it fills) and copy that insert.

- [ ] **Step 6: Run everything**

Run: `npx jest tests/lib/store/product-extras.test.ts tests/db/store-product-card-fields.db.test.ts && npx tsc --noEmit -p .`
Expected: PASS, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add database/migrations/458_store_product_card_fields.sql lib/store/product-extras.ts app/api/items/route.ts "app/api/items/[id]/route.ts" lib/store/store-items-query.ts lib/store/map-store-product.ts "app/api/public/store/[subdomain]/items/[id]/route.ts" components/store/StoreProductCard.tsx lib/store/theme-demo.ts tests/lib/store/product-extras.test.ts tests/db/store-product-card-fields.db.test.ts
git commit -m "Products get a store badge, a tagline and up to six colour swatches, saved with the other store-page fields and returned to the storefront; migration 458"
```

---

### Task 4: Item form: badge, tagline and swatches

**Files:**
- Modify: `components/store/admin/ItemStorePageFields.tsx` (`ItemStorePageValue`, the form), `app/(app)/items/new/page.tsx:54,80-82,495-510,815-845` (load, change detection, payload)

**Interfaces:**
- Consumes: `validateProductExtras`, `StoreSwatch` from Task 3.
- Produces: `ItemStorePageValue` gains `store_badge: string; store_tagline: string; store_swatches: StoreSwatch[]`.

- [ ] **Step 1: Extend the value type and the form**

In `ItemStorePageFields.tsx`: add the three fields to `ItemStorePageValue`; pass them into the `validateProductExtras` call so the inline error covers them; render, above the video field, a "Card" group: `<input id="store-badge" maxLength={24}>` labelled "Badge on the photo" with help "Replaces the automatic New / % off badge. Leave empty to keep those.", `<input id="store-tagline" maxLength={60}>` labelled "Tagline above the name", and a swatch list: one row per swatch with `<input type="color">`, a name input (`maxLength={30}`), a remove button; an "Add colour" button disabled at 6. Follow the tabs list's markup (`Button`, `Trash2`, `Plus`).

- [ ] **Step 2: Wire the page**

In `items/new/page.tsx`: `EMPTY_STORE_PAGE` gains `store_badge: ''`, `store_tagline: ''`, `store_swatches: []`; the load block (~line 499) reads `item.store_badge ?? ''`, `item.store_tagline ?? ''`, `Array.isArray(item.store_swatches) ? item.store_swatches : []`; the `extrasCheck` call (~line 819) passes the three; the payload block (~line 830) adds each key when `extrasChanged(...)`, sending `extrasCheck.value.store_badge ?? null`, `... store_tagline ?? null`, `... store_swatches ?? []`.

- [ ] **Step 3: Type-check and try it**

Run: `npx tsc --noEmit -p .`
Expected: clean. Then, with the dev server on the test DB, open an item, set a badge, a tagline and two swatches, save, reload: the values persist; `curl` the public item route and see the three fields.

- [ ] **Step 4: Commit**

```bash
git add components/store/admin/ItemStorePageFields.tsx "app/(app)/items/new/page.tsx"
git commit -m "The item form's store page card takes a badge, a tagline and colour swatches"
```

---

### Task 5: Cards show the badge, tagline and swatches

**Files:**
- Create: `lib/store/engine/card-badges.ts`
- Modify: `components/store/studio-theme/StudioSections.tsx:563-660` (`StudioProductTile`), `components/store/studio-theme/studio-theme.css` (`.ptag`, `.pswatches`), `components/store/StoreProductCard.tsx:255-295`, `lib/store/engine/card-look.ts` (`EngineCardLook`), `components/store/engine/EngineShell.tsx:236` (`cardLook`), `lib/store/engine/sections/featured-products.ts` (`productSettings`), `lib/store/engine/studio-adapter.ts:133-150` (`productSectionSettings`), `lib/store/studio-sections.ts` (`StudioSettings`), `components/store/engine/EngineViews.tsx:462-515` (`EngineProductGrid`), `lib/store/engine/sections/main-product.ts` (`title` block), `components/store/engine/product/ProductBlocks.tsx:28-45` (`TitleBlock`)
- Test: `tests/lib/store/engine/card-badges.test.ts` (new), `tests/lib/store/engine/card-look.test.ts`, `tests/lib/store/engine/studio-adapter.test.ts`, `tests/lib/store/engine/section-schemas.test.ts`

**Interfaces:**
- Produces: `cardBadges(input: { customBadge?: string | null; highlight?: string; createdAt?: string | null; discountPct: number }, now?: number): { badges: StudioBadge[]; hideDiscount: boolean }` in `card-badges.ts` (client-safe; `StudioBadge` type moves to or is re-exported from `lib/store/studio-sections.ts` so the lib file does not import a component); `EngineCardLook` gains `tagline: boolean; swatches: boolean`; `StudioSettings` gains `showTagline?: boolean; showSwatches?: boolean`; `StudioProductTile` gains props `tagline?: string | null; swatches?: StoreSwatch[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// card-badges.test.ts
it('a custom badge replaces every automatic badge, including the discount', () => {
  expect(cardBadges({ customBadge: 'Pure Katan Silk', highlight: 'Bestseller', createdAt: new Date().toISOString(), discountPct: 20 })).toEqual({ badges: [{ label: 'Pure Katan Silk', tone: 'hot' }], hideDiscount: true });
});
it('without a custom badge the automatic badges are as before', () => {
  const r = cardBadges({ customBadge: null, highlight: 'Bestseller', createdAt: new Date().toISOString(), discountPct: 20 });
  expect(r).toEqual({ badges: [{ label: 'Bestseller', tone: 'hot' }, { label: 'New', tone: 'new' }], hideDiscount: false });
});
// card-look.test.ts (append)
it('carries tagline and swatch flags', () => {
  expect(productCardLook({ quick: false, phoneKit: false, tagline: true, swatches: false }, theme).studioTile).toBe(true);
});
// studio-adapter.test.ts (append)
it('productSectionSettings maps show_tagline and show_swatches, default off', () => {
  expect(productSectionSettings(sec({ show_tagline: true }))).toMatchObject({ showTagline: true, showSwatches: false });
});
// section-schemas.test.ts (append)
it('product sections and the title block have the tagline and swatch switches, default off', () => {
  for (const t of ['featured-products', 'product-rail']) {
    const s = getSectionSchema(t)!.settings;
    expect(s.find((x) => x.id === 'show_tagline')).toMatchObject({ type: 'checkbox', default: false });
    expect(s.find((x) => x.id === 'show_swatches')).toMatchObject({ type: 'checkbox', default: false });
  }
  const title = getSectionSchema('main-product')!.blocks!.find((b) => b.type === 'title')!;
  expect(title.settings.find((x) => x.id === 'show_tagline')).toMatchObject({ type: 'checkbox', default: false });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/lib/store/engine/card-badges.test.ts tests/lib/store/engine/card-look.test.ts tests/lib/store/engine/studio-adapter.test.ts tests/lib/store/engine/section-schemas.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `card-badges.ts`: the function above. With `customBadge` non-empty: `badges = [{ label: customBadge, tone: 'hot' }]`, `hideDiscount: true`. Otherwise the two existing rules from `StoreProductCard.tsx:271-274` (highlight, then `isNewArrival`), `hideDiscount: false`.
- `StudioProductTile`: new props; when `hideDiscount` is wanted the caller passes `discount={0}`; render `{tagline ? <div className="ptag">{tagline}</div> : null}` just above `.pname`, and `{swatches?.length ? <div className="pswatches">{swatches.map(s => <span key={s.hex+s.name} title={s.name} style={{ background: s.hex }} />)}</div> : null}` after `.price`. CSS in `studio-theme.css`: `.ptag{font-size:11px;letter-spacing:.06em;text-transform:uppercase;opacity:.7;margin:8px 0 2px}`, `.pswatches{display:flex;gap:6px;margin-top:6px}`, `.pswatches span{width:14px;height:14px;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(0,0,0,.15)}`.
- `StoreProductCard.tsx` Studio-tile branch: `const look = useEngineCardLook()`; `const { badges, hideDiscount } = cardBadges({ customBadge: product.store_badge, highlight, createdAt: product.created_at, discountPct: discount })`; pass `discount={hideDiscount ? 0 : discount}`, `badges`, `tagline={showTagline ? product.store_tagline : null}`, `swatches={showSwatches ? product.store_swatches : undefined}` where `showTagline = props.showTagline ?? look?.tagline ?? false` (same for swatches). Add `showTagline?: boolean; showSwatches?: boolean` to `StoreProductCardProps`.
- `card-look.ts`: the two booleans; `EngineShell.tsx` sets both `false` for now (plan 2's preset turns them on through `PRESET_LOOK`).
- `featured-products.ts` `productSettings`: after `show_badges`, `{ id: 'show_tagline', type: 'checkbox', label: 'Show tagline', default: false }`, `{ id: 'show_swatches', type: 'checkbox', label: 'Show colour swatches', default: false }`. `productSectionSettings` maps them to `showTagline`/`showSwatches`; `EngineProductGrid` passes `showTagline={s.showTagline}` `showSwatches={s.showSwatches}` to each `StoreProductCard` (both branches, including `NarrowableGrid`).
- `main-product.ts` `title` block: `{ id: 'show_tagline', type: 'checkbox', label: 'Show tagline', default: false }`; `TitleBlock` renders `product.store_tagline` under the `h1` in the same style as the brand line when `settings.show_tagline === true` (note: `on()` treats undefined as true; this one is default-off, so test `=== true`).

- [ ] **Step 4: Run the tests and type-check**

Run: `npx jest tests/lib/store/engine tests/lib/store && npx tsc --noEmit -p .`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add lib/store/engine/card-badges.ts components/store/studio-theme/StudioSections.tsx components/store/studio-theme/studio-theme.css components/store/StoreProductCard.tsx lib/store/engine/card-look.ts components/store/engine/EngineShell.tsx lib/store/engine/sections/featured-products.ts lib/store/engine/studio-adapter.ts lib/store/studio-sections.ts components/store/engine/EngineViews.tsx lib/store/engine/sections/main-product.ts components/store/engine/product/ProductBlocks.tsx tests/lib/store/engine/card-badges.test.ts tests/lib/store/engine/card-look.test.ts tests/lib/store/engine/studio-adapter.test.ts tests/lib/store/engine/section-schemas.test.ts
git commit -m "Product cards show a product's own badge, tagline and colour swatches; Featured products, Product rail and the product title block get switches for them"
```

---

### Task 6: Products-by-id loader

**Files:**
- Modify: `lib/store/engine/schema-types.ts` (`SectionDataRequest`), `lib/store/engine/section-data.ts` (`SectionData`, `resolveSectionData`)
- Test: `tests/lib/store/engine/section-data.test.ts`, `tests/db/store-section-products-by-id.db.test.ts` (new)

**Interfaces:**
- Produces: `SectionDataRequest.productIds?: string[]` (UUIDs, the schema's `data()` passes at most 12); `SectionData.productsById?: Record<string, StoreItem>` (only the ids found); `export function collectProductIds(requests: Map<string, SectionDataRequest>): string[]` (deduplicated, UUID-checked, in first-seen order).

- [ ] **Step 1: Write the failing tests**

```ts
// section-data.test.ts (append)
it('collectProductIds dedupes across sections and drops non-uuids', () => {
  const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
  const m = new Map([['s1', { productIds: [a, 'junk'] }], ['s2', { productIds: [b, a] }]]);
  expect(collectProductIds(m)).toEqual([a, b]);
});
it('resolveSectionData gives each section only its own ids, in its order', async () => {
  // mock '@/lib/db' queryRows to return rows for ids [a, b] in any order; store = demo-less fake context
  const out = await resolveSectionData(store, new Map([['s1', { productIds: [b, a] }], ['s2', { productIds: [a, 'missing-uuid-…'] }]]));
  expect(Object.keys(out.s1.productsById!)).toEqual([b, a]);
  expect(Object.keys(out.s2.productsById!)).toEqual([a]);
});
// tests/db/store-section-products-by-id.db.test.ts
it('one query, hidden products absent, business scoped', async () => {
  // insert items A (show_in_store true), H (show_in_store false) for BIZ and X for another business
  const out = await resolveSectionData(ctxFor(BIZ), new Map([['s1', { productIds: [A, H, X] }]]));
  expect(Object.keys(out.s1.productsById!)).toEqual([A]);
});
```

Look at the existing mocks in `section-data.test.ts` for how `queryRows` and the store context are faked and reuse them.

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/lib/store/engine/section-data.test.ts tests/db/store-section-products-by-id.db.test.ts`
Expected: FAIL (`collectProductIds` undefined, `productsById` undefined).

- [ ] **Step 3: Implement**

- `schema-types.ts`: `productIds?: string[]` with the doc line "Products by id, at most 12; each section gets the ones found, keyed by id."
- `section-data.ts`: `collectProductIds` (filter with the file's UUID test; dedupe). In `resolveSectionData`, when the union is non-empty start one job: for demo stores filter `themeDemoProducts()` by id; otherwise `buildStoreItemsQuery({ businessId, branchId, ids, limit: ids.length, offset: 0 })` → `mapStoreItemRow`. Per section, `productsById` = its own valid ids, in order, that the job returned. A failed job sets `data.error` only on sections that asked for ids (same pattern as the categories job).

- [ ] **Step 4: Run the tests and type-check**

Run: `npx jest tests/lib/store/engine/section-data.test.ts tests/db/store-section-products-by-id.db.test.ts && npx tsc --noEmit -p .`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add lib/store/engine/schema-types.ts lib/store/engine/section-data.ts tests/lib/store/engine/section-data.test.ts tests/db/store-section-products-by-id.db.test.ts
git commit -m "Sections can ask for products by id; all of a page's ids load in one query and each section gets its own, in order"
```

---

### Task 7: Content block schemas and the one-time conversion

**Files:**
- Create: `lib/store/engine/content-blocks.ts`, `lib/store/engine/text-sections-convert.ts`, `tests/lib/store/engine/fixtures/presets-before/*.json`
- Modify: `lib/store/engine/sections/image-with-text.ts`, `lib/store/engine/sections/rich-text.ts`, `lib/store/engine/sanitize.ts` (`sanitizeThemeData`, one line)
- Test: `tests/lib/store/engine/content-blocks.test.ts` (new), `tests/lib/store/engine/text-sections-convert.test.ts` (new)

**Interfaces:**
- Produces: `CONTENT_BLOCKS: BlockSchema[]` (types `eyebrow`, `heading`, `text`, `quote`, `checklist_item`, `button`) and `HIGHLIGHT_CARD_BLOCK: BlockSchema` (type `highlight_card`, `limit: 1`) in `content-blocks.ts`; `convertLegacyTextSections(raw: Record<string, unknown>): Record<string, unknown>` in `text-sections-convert.ts` (pure, returns a new object); the two section schemas with `blocks`, `max_blocks: 12` and settings exactly: image-with-text `image`, `image_side` (`left|right`), `image_width` (`half|narrow`, default `half`), `text_align` (`left|center`, default `left`); rich-text `align` (`left|center|right`, default `center`).

- [ ] **Step 1: Capture today's preset output as fixtures (before any schema change)**

Write a one-off script (scratch, not committed) that imports `presetTheme` from `@/lib/store/engine/presets` and `PAGE_STARTERS` from `.../presets/templates`, calls each preset with `{ businessName: 'Fixture Store', tagline: 'Fixture tagline', accent: '#b94717' }` and each starter's `build()`, passes the result through `sanitizeThemeData` (presets) and writes `tests/lib/store/engine/fixtures/presets-before/<preset>.json` and `starter-<name>.json`. Commit the fixtures with this task. They are the "before" side of Task 8's parity test.

- [ ] **Step 2: Write the failing tests**

```ts
// content-blocks.test.ts
it('declares the six content blocks with the spec limits', () => {
  expect(CONTENT_BLOCKS.map((b) => b.type)).toEqual(['eyebrow', 'heading', 'text', 'quote', 'checklist_item', 'button']);
  const by = Object.fromEntries(CONTENT_BLOCKS.map((b) => [b.type, b]));
  expect(by.heading.settings.find((s) => s.id === 'size')).toMatchObject({ type: 'select', default: 'medium' });
  expect(by.quote.settings.find((s) => s.id === 'text')?.max_length).toBe(400);
  expect(by.button.settings.find((s) => s.id === 'style')).toMatchObject({ default: 'filled' });
  expect(HIGHLIGHT_CARD_BLOCK).toMatchObject({ type: 'highlight_card', limit: 1 });
});
it('image-with-text and rich-text take the blocks and no longer have heading/description settings', () => {
  const iwt = getSectionSchema('image-with-text')!;
  expect(iwt.blocks!.map((b) => b.type)).toEqual([...CONTENT_BLOCKS.map((b) => b.type), 'highlight_card']);
  expect(iwt.max_blocks).toBe(12);
  expect(iwt.settings.map((s) => s.id)).toEqual(expect.arrayContaining(['image', 'image_side', 'image_width', 'text_align']));
  expect(iwt.settings.find((s) => s.id === 'heading')).toBeUndefined();
  const rt = getSectionSchema('rich-text')!;
  expect(rt.blocks!.map((b) => b.type)).toEqual(CONTENT_BLOCKS.map((b) => b.type));
  expect(rt.settings.find((s) => s.id === 'content')).toBeUndefined();
});
// text-sections-convert.test.ts
const legacy = (type: string, settings: object) => ({ templates: { home: { order: ['a'], sections: { a: { type, settings, blocks: {}, block_order: [] } } } } });
it('turns heading, description and button into blocks in that order and drops the old keys', () => {
  const out = convertLegacyTextSections(legacy('image-with-text', { image: '/x.webp', heading: 'Our story', description: '<p>Hi</p>', button_text: 'Read', link: '/pages/about', image_side: 'right' }));
  const s = out.templates.home.sections.a;
  expect(s.block_order).toEqual(['heading-1', 'text-1', 'button-1']);
  // Only the values the old settings held: size and style stay unset so the schema defaults apply (and so a
  // converted old preset equals the rewritten preset, Task 8).
  expect(s.blocks['heading-1']).toEqual({ type: 'heading', settings: { text: 'Our story' } });
  expect(s.blocks['text-1']).toEqual({ type: 'text', settings: { content: '<p>Hi</p>' } });
  expect(s.blocks['button-1']).toEqual({ type: 'button', settings: { label: 'Read', link: '/pages/about' } });
  expect(s.settings).toEqual({ image: '/x.webp', image_side: 'right' });
});
it('rich-text uses content and align; empty values make no block', () => {
  const s = convertLegacyTextSections(legacy('rich-text', { heading: '', content: '<p>x</p>', align: 'left' })).templates.home.sections.a;
  expect(s.block_order).toEqual(['text-1']);
  expect(s.settings).toEqual({ align: 'left' });
});
it('a section that already has blocks keeps them and only loses the old keys; running twice changes nothing', () => {
  const half = legacy('rich-text', { heading: 'Old', content: '<p>old</p>' });
  half.templates.home.sections.a.blocks = { 'text-1': { type: 'text', settings: { content: '<p>new</p>' } } };
  half.templates.home.sections.a.block_order = ['text-1'];
  const once = convertLegacyTextSections(half);
  expect(once.templates.home.sections.a.block_order).toEqual(['text-1']);
  expect(once.templates.home.sections.a.settings).toEqual({});
  expect(convertLegacyTextSections(once)).toEqual(once);
});
it('runs inside sanitizeThemeData and the result passes the schema', () => {
  const t = sanitizeThemeData(legacy('image-with-text', { heading: 'H', description: '<p>D</p>' }));
  expect(t.templates.home.sections.a.block_order).toEqual(['heading-1', 'text-1']);
});
it('leaves other section types and page templates alone except for conversion', () => { /* a slideshow with a heading key is untouched; page.about converts too */ });
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx jest tests/lib/store/engine/content-blocks.test.ts tests/lib/store/engine/text-sections-convert.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 4: Implement**

- `content-blocks.ts` (client-safe, types only): the six `BlockSchema`s with the spec's ids and limits (`eyebrow.text` 60; `heading.text` 120, `size` small|medium|large default medium; `text.content` richtext; `quote.text` 400, `attribution` 80; `checklist_item.title` 60, `text` 160; `button.label` 30, `link` url, `style` filled|outline default filled) and `HIGHLIGHT_CARD_BLOCK` (`eyebrow` 40, `title` 80, `text` 200, `limit: 1`).
- `image-with-text.ts` / `rich-text.ts`: settings as in Interfaces; `blocks: [...CONTENT_BLOCKS, HIGHLIGHT_CARD_BLOCK]` / `CONTENT_BLOCKS`; `max_blocks: 12`; presets emit blocks: image-with-text `heading` "Our story" + `text` "<p>Tell customers about your business.</p>"; rich-text `heading` "About us" + `text` "<p>Share your story.</p>".
- `text-sections-convert.ts`: walk `header_group`, `footer_group` and every `templates.*`; for each section of the two types: if `block_order` is empty and any of `heading`, `description`, `content`, `button_text`, `link` is present, build blocks with ids `heading-1`, `text-1`, `button-1` (same id rule as `presets/shared.ts section()`), each holding only the keys the old settings had (`text`; `content`; `label` and, when set, `link`), never `size` or `style`; always delete those five keys. No other key, section or type is touched. Pure: copy objects you change.
- `sanitize.ts` `sanitizeThemeData`: `const r = convertLegacyTextSections(convertLegacyMenus(...))`.

- [ ] **Step 5: Run the tests and type-check**

Run: `npx jest tests/lib/store/engine && npx tsc --noEmit -p .`
Expected: the two new suites PASS; `studio-adapter.test.ts`, `preset-templates.test.ts`, `presets.test.ts` or `migrate.test.ts` may now FAIL where they assert the old `heading`/`content` settings. Those are fixed in Tasks 8 and 9; note the failing names here and move on only if every failure is one of those.

- [ ] **Step 6: Commit**

```bash
git add lib/store/engine/content-blocks.ts lib/store/engine/text-sections-convert.ts lib/store/engine/sections/image-with-text.ts lib/store/engine/sections/rich-text.ts lib/store/engine/sanitize.ts tests/lib/store/engine/content-blocks.test.ts tests/lib/store/engine/text-sections-convert.test.ts tests/lib/store/engine/fixtures/presets-before
git commit -m "Image with text and Rich text are built from content blocks (eyebrow, heading, text, quote, checklist item, button, highlight card); existing themes convert once when loaded"
```

---

### Task 8: Render content blocks; presets, starters and the Studio migration emit blocks

**Files:**
- Create: `lib/store/engine/content-blocks-map.ts`, `components/store/engine/sections/ContentBlocks.tsx`
- Modify: `components/store/engine/sections/ImageWithText.tsx`, `components/store/engine/sections/RichText.tsx`, `components/store/engine/EngineShell.tsx` (`THEME_RULES`: `.eng-cb-*` rules), `lib/store/engine/studio-adapter.ts:168-189` (remove `imageWithTextSettings` and `richTextSettings` if nothing else imports them), `lib/store/engine/presets/templates.ts:50-78`, `lib/store/engine/presets/khatario.ts:16`, `lib/store/engine/migrate-studio.ts:342`
- Test: `tests/lib/store/engine/content-blocks-map.test.ts` (new), `tests/lib/store/engine/preset-parity.test.ts` (new), fix-ups in `studio-adapter.test.ts`, `preset-templates.test.ts`, `migrate.test.ts`

**Interfaces:**
- Consumes: `CONTENT_BLOCKS`, `convertLegacyTextSections`, fixtures from Task 7; `blockSettings` from `sections/shared.ts`.
- Produces: `type ContentBlock = { id: string } & ({ type: 'eyebrow'; text } | { type: 'heading'; text; size } | { type: 'text'; html } | { type: 'quote'; text; attribution } | { type: 'checklist_item'; title; text } | { type: 'button'; label; link; style } | { type: 'highlight_card'; eyebrow; title; text })`; `contentBlocksOf(section: Section, settingsOf: (block: Block) => Record<string, unknown> | null): ContentBlock[]` (skips disabled and unknown blocks, drops blocks whose required text is empty: eyebrow/heading/quote text, text html, checklist title, button label); `<ContentBlocks blocks={ContentBlock[]} />` renders them in order with classes `eng-cb eng-cb-<type>`.

- [ ] **Step 1: Write the failing tests**

```ts
// content-blocks-map.test.ts
it('maps blocks in order, skipping disabled and empty ones', () => {
  const section = sec('rich-text', {}, [blk('eyebrow', { text: 'New' }), blk('heading', { text: '', size: 'large' }), blk('button', { label: 'Go', link: '/catalog', style: 'outline' })]);
  section.blocks['button-1'].disabled = true;
  expect(contentBlocksOf(section, (b) => ({ ...b.settings }))).toEqual([{ id: 'eyebrow-1', type: 'eyebrow', text: 'New' }]);
});
// preset-parity.test.ts
import before from './fixtures/presets-before/studio.json'; // and the others
it.each(['studio', 'quick', 'grocery', 'khatario', 'blank'])('%s: converting yesterday\'s preset equals today\'s preset', (p) => {
  const now = sanitizeThemeData(presetTheme(p, CTX));
  expect(sanitizeThemeData(before[p])).toEqual(now);
});
it.each(['about', 'sale', 'contact', 'blank'])('starter %s matches its converted fixture', (n) => { /* same shape via a wrapper theme */ });
```

The equality holds because `sanitizeThemeData` adds the style defaults to both sides and converts the fixture's text sections to the blocks the rewritten preset now emits. If a preset differs for a reason other than text blocks or style defaults, that is a bug in the rewrite.

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/lib/store/engine/content-blocks-map.test.ts tests/lib/store/engine/preset-parity.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the mapper and renderer**

- `content-blocks-map.ts` (client-safe): the type and `contentBlocksOf` above; `size`, `style` fall back to their defaults when not one of the allowed values.
- `ContentBlocks.tsx`: eyebrow → `<p className="eng-cb eng-cb-eyebrow eyebrow">`; heading → `<h2 className="eng-cb eng-cb-heading eng-cb-size-<size>">`; text → `<div className="eng-cb eng-cb-text eng-rt" dangerouslySetInnerHTML>`; quote → `<blockquote className="eng-cb eng-cb-quote"><p>…</p><footer>…</footer></blockquote>`; checklist_item → `<div className="eng-cb eng-cb-check"><span className="eng-cb-tick">✓</span><div><b>title</b><span>text</span></div></div>`; button → `<EngineCtaButton label link />` with `data-style`; highlight_card → `<aside className="eng-cb eng-cb-highlight">`. Consecutive buttons share one `.eng-cb-buttons` row (group them in the renderer).
- `ImageWithText.tsx`: `const blocks = contentBlocksOf(section, (b) => blockSettings(section.type, b))`; keep the `hero image-text|text-image` markup; `heroCopy` renders `<ContentBlocks>` for every block except `highlight_card`, which renders inside `heroImg` as the overlapping aside; `image_width: 'narrow'` adds class `eng-iwt-narrow`; `text_align: 'center'` adds `eng-iwt-center`.
- `RichText.tsx`: `<div className="rich" style={{ textAlign }}><ContentBlocks blocks /></div>`; return null with no blocks.
- `THEME_RULES`: rules for `.eng-cb-quote` (left accent border, italic, larger), `.eng-cb-check` (tick in a small accent square), `.eng-cb-highlight` (card on `--c-card`, border `--c-border`, positioned at the image's lower outer corner on wide screens, stacked below on phones), `.eng-cb-buttons` (flex, gap 12px), `.eng-cta[data-style=outline]` (transparent, 1px `--c-button` border), `.eng-iwt-narrow .heroImg` (flex-basis 40%), `.eng-iwt-center .heroCopy` (text-align center).
- Delete `imageWithTextSettings` and `richTextSettings` from `studio-adapter.ts` and their tests when no other file imports them (`grep -rn` first).

- [ ] **Step 4: Rewrite presets, starters and the Studio migration to emit blocks**

- `presets/templates.ts` `about`: `sec('image-with-text', { image_side: 'left' }, [blk('heading', { text: 'Our story' }), blk('text', { content: '<p>Tell customers about your business.</p>' })])`; its and `contact`'s rich-text sections likewise (`heading` + `text` blocks, `align` stays a setting).
- `presets/khatario.ts:16`: `engineSection('rich-text', { align: 'left', spacing_top: 12, spacing_bottom: 0 }, [{ type: 'text', settings: { content: textToParagraphs(text) } }])`.
- `migrate-studio.ts:342`: `engineSection('rich-text', { align }, [heading block when s.title, text block])`.
- Update the assertions in `preset-templates.test.ts`, `migrate.test.ts` and any other suite that named the old settings, to the block shape.

- [ ] **Step 5: Run everything**

Run: `npx jest tests/lib/store && npx tsc --noEmit -p .`
Expected: PASS, including `preset-parity.test.ts`; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add lib/store/engine/content-blocks-map.ts components/store/engine/sections/ContentBlocks.tsx components/store/engine/sections/ImageWithText.tsx components/store/engine/sections/RichText.tsx components/store/engine/EngineShell.tsx lib/store/engine/studio-adapter.ts lib/store/engine/presets/templates.ts lib/store/engine/presets/khatario.ts lib/store/engine/migrate-studio.ts tests/lib/store/engine
git commit -m "Content blocks render in Image with text and Rich text; presets, page starters and the Studio migration emit blocks, and a parity test shows every existing preset is unchanged"
```

---

### Task 9: Small block upgrades (Testimonials, Logo list, Promo cards, Multicolumn)

**Files:**
- Modify: `lib/store/engine/sections/testimonials.ts`, `components/store/engine/sections/Testimonials.tsx`, `lib/store/engine/studio-adapter.ts:124-131` (`testimonialItems`), `lib/store/engine/sections/logo-list.ts`, `components/store/engine/sections/LogoList.tsx`, `lib/store/engine/sections/promo-cards.ts`, `components/store/engine/sections/PromoCards.tsx:30`, `components/store/engine/EngineViews.tsx:112-130` + its `.eng-promos` CSS in `EngineShell.tsx` (4 columns), `lib/store/engine/sections/multicolumn.ts`, `lib/store/engine/studio-adapter.ts:102-110` (`multicolumnSettings`), `lib/store/studio-sections.ts` (`StudioUsp.image?`), `components/store/studio-theme/StudioSections.tsx:860-880` (`StudioUspStrip`)
- Create: `lib/store/engine/testimonials-summary.ts`
- Test: `tests/lib/store/engine/section-schemas.test.ts`, `tests/lib/store/engine/studio-adapter.test.ts`, `tests/lib/store/engine/testimonials-summary.test.ts` (new)

**Interfaces:**
- Produces: `testimonialItems(section)` items gain `title: string; location: string; purchased: string`; `summaryLine(ratings: number[]): string | null` → `"4.7 / 5 from 3 reviews"` (one decimal, `"1 review"` singular, `null` for none); `StudioUsp.image?: string`; `EnginePromoCards` accepts `columns` 1–4.

- [ ] **Step 1: Write the failing tests**

```ts
// testimonials-summary.test.ts
it('averages to one decimal and pluralises', () => {
  expect(summaryLine([5, 4, 5])).toBe('4.7 / 5 from 3 reviews');
  expect(summaryLine([5])).toBe('5.0 / 5 from 1 review');
  expect(summaryLine([])).toBeNull();
});
// section-schemas.test.ts (append)
it('small upgrades: new block settings with empty defaults, promo columns to 4', () => {
  const q = getSectionSchema('testimonials')!.blocks![0].settings.map((s) => s.id);
  expect(q).toEqual(expect.arrayContaining(['title', 'location', 'purchased']));
  expect(getSectionSchema('testimonials')!.settings.find((s) => s.id === 'show_summary')).toMatchObject({ type: 'checkbox', default: false });
  expect(getSectionSchema('logo-list')!.blocks![0].settings.map((s) => s.id)).toEqual(expect.arrayContaining(['name', 'caption']));
  expect(getSectionSchema('promo-cards')!.settings.find((s) => s.id === 'columns')).toMatchObject({ max: 4 });
  expect(getSectionSchema('multicolumn')!.blocks![0].settings.find((s) => s.id === 'image')).toMatchObject({ type: 'image' });
});
// studio-adapter.test.ts (append)
it('testimonialItems and multicolumnSettings carry the new fields', () => {
  expect(testimonialItems(sec('testimonials', {}, [blk('quote', { text: 'Great', name: 'A', title: 'Loved it', location: 'Delhi', purchased: 'Saree', rating: 5 })]))[0]).toMatchObject({ title: 'Loved it', location: 'Delhi', purchased: 'Saree' });
  expect(multicolumnSettings(sec('multicolumn', {}, [blk('column', { title: 'T', image: '/i.webp' })])).usps![0]).toMatchObject({ image: '/i.webp' });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx jest tests/lib/store/engine/testimonials-summary.test.ts tests/lib/store/engine/section-schemas.test.ts tests/lib/store/engine/studio-adapter.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- Testimonials: block settings `title` (80), `location` (60), `purchased` (40); section `show_summary` checkbox default false; `testimonialItems` maps them; `summaryLine` in `testimonials-summary.ts`; `Testimonials.tsx` shows `<p className="eng-test-summary">` under the heading when `show_summary === true` and the line is non-null, each quote shows `<strong>` title above the text and `<small>location · Bought: purchased</small>` after the name (each part only when set).
- Logo list: block `name` (40), `caption` (80); `LogoList.tsx` keeps a block when it has an image *or* a name; without an image render `<span className="eng-logo-name">` in `var(--font-heading)`; caption as `<small>` under either. The existing `if (!b || !str(b.image)) continue;` becomes "skip only when both are empty".
- Promo cards: schema `columns` `max: 4`; `PromoCards.tsx` clamp `Math.min(4, …)`; `EnginePromoCards` CSS already uses `--eng-cols`; add a phone rule that keeps 2 per row at 4 columns if the current `@container` rule hard-codes 1 or 2 (check `.eng-promos` rules in `THEME_RULES`).
- Multicolumn: block `image` (type image, default ''); `StudioUsp.image?: string`; `multicolumnSettings` maps it; `StudioUspStrip` renders `<img src={u.image} alt="" className="uspImg">` instead of the icon when set; CSS `.uspImg{width:40px;height:40px;object-fit:cover;border-radius:8px}` in `studio-theme.css`.

- [ ] **Step 4: Run everything**

Run: `npx jest tests/lib/store && npx tsc --noEmit -p .`
Expected: PASS (parity test still green: all new settings default to today's output), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add lib/store/engine/sections/testimonials.ts components/store/engine/sections/Testimonials.tsx lib/store/engine/testimonials-summary.ts lib/store/engine/studio-adapter.ts lib/store/engine/sections/logo-list.ts components/store/engine/sections/LogoList.tsx lib/store/engine/sections/promo-cards.ts components/store/engine/sections/PromoCards.tsx components/store/engine/EngineViews.tsx components/store/engine/EngineShell.tsx lib/store/engine/sections/multicolumn.ts lib/store/studio-sections.ts components/store/studio-theme/StudioSections.tsx components/store/studio-theme/studio-theme.css tests/lib/store/engine
git commit -m "Testimonials get a title, location, purchase and a rating summary; logo list takes text names and captions; promo cards go to 4 columns; multicolumn columns can use a photo"
```

---

### Task 10: Editor check, full suite, log and carry-over

**Files:**
- Modify: `docs/project.log.md` (append), `docs/roadmap.md` (card text)
- Create: `docs/superpowers/plans/2026-10-31-store-premium-foundations-carryover.md`

- [ ] **Step 1: Run the whole store suite and the type-check**

Run: `npx jest tests/lib/store tests/db/store-product-card-fields.db.test.ts tests/db/store-section-products-by-id.db.test.ts && npx tsc --noEmit -p .`
Expected: all PASS, tsc clean. Note the suite and test counts for the log.

- [ ] **Step 2: Open Studio 2 on the test DB and check each new control once**

Theme settings → Style: pick Spaced capitals, Thin accent border, Dots; the preview updates (root classes visible in the inspector). Add an Image with text: add one block of each type, reorder, disable one; the preview follows. Featured products: turn on Show tagline and Show colour swatches on a store whose item has them (Task 4). Testimonials: fill title/location/purchased and Show summary. Logo list: a block with only a name. Promo cards: 4 columns. Multicolumn: a column with a photo. Open an existing theme from the library that has an old Image with text: it shows the same text as before, now as blocks.

- [ ] **Step 3: Append the e2e scenarios (written, not run)**

In `tests/e2e/store-studio2.spec.ts`, following the existing scenario shape: (a) "content blocks": add an Image with text, add an eyebrow, heading, text, quote, checklist item and two buttons, reorder the quote above the text, disable one button, save; reload and assert the block order and the disabled flag come back. (b) "style settings": set Spaced capitals, Thin accent border and Dots; assert the preview root has `eng-labels-caps eng-frame-accent eng-texture-dots`. (c) "card switches": on Featured products turn on Show tagline and Show colour swatches; assert a `.ptag` and `.pswatches` appear for an item that has them.

- [ ] **Step 4: Write the carry-over and the log entry**

Carry-over: anything the plan left (e.g. a `THEME_RULES` selector that did not exist, a demo store sample value, a test skipped). Log entry per `docs/brain.md`: asked, decided (the `preload: false` font decision; the `productsById` shape; anything changed from the spec), shipped (commit hashes), open (plan 2 next; migration 458 applied to the test DB only; staging needs the owner). Update the roadmap card: "foundations built, Heritage Couture plan next".

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/store-studio2.spec.ts docs/project.log.md docs/roadmap.md docs/superpowers/plans/2026-10-31-store-premium-foundations-carryover.md
git commit -m "E2E scenarios, log and carry-over for the premium theme foundations"
```
