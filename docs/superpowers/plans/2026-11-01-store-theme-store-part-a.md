# Store theme store, Part A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public theme store at `khatario.com/themes` (and a page per theme) that draws every theme live from its own in-memory demo store, and an Apply flow that adds the theme to the merchant's library under its own name and opens the editor.

**Architecture:** One client-safe theme list (`theme-catalog.ts`) feeds the library's preset choices, the store page and pure filter helpers. Each theme gets an in-memory demo store on `demo-<slug>` (a `StoreBusinessContext` with `is_demo`, a preset and a demo catalogue), rendered by the existing engine path; the marketing pages frame those demo stores in scaled iframes. Apply is an app page that reuses the existing create-theme API.

**Tech Stack:** Next.js 14 app router, React 18, TypeScript, Tailwind (marketing pages), plain CSS (store), Jest, PostgreSQL (`kh_phase2_test` via `PHASE2_TEST_DATABASE_URL`), sharp 0.33 (photo conversion script).

**Spec:** `docs/superpowers/specs/2026-11-01-store-theme-store-design.md`

## Global Constraints

- Read `AGENTS.md`; use graphify (`graphify explain/query`) before Read/Grep where it helps; run `graphify update .` after code changes.
- Never run migrations against staging or production; DB tests use only `kh_phase2_test` (`PHASE2_TEST_DATABASE_URL`). This plan needs no migration.
- Stage files by name (never `git add .`); other sessions commit to `main` at the same time. Commit messages: one plain sentence saying what now works, ending with the attribution line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never trust client-sent `business_id`, `user_id` or `created_by`; the public pages read no business data except the aggregate popularity order.
- Existing stores and the old `theme-*` demo stores must look and behave exactly as before.
- Demo photos: free for commercial use (Unsplash or Pexels licence), stored under `public/theme-demos/<catalog>/` as WebP, product photos about 900 px wide, hero photos about 1600 px wide, each under 200 KB, every one listed in `public/theme-demos/CREDITS.md` with its source page and licence. No hotlinks to stock sites.
- Demo subdomains are `demo-<slug>`; subdomains starting with `demo-` are reserved for merchants.
- Popularity counts are never shown, only the order; cached for an hour.
- Copy in sentence case except theme and brand names; page title format "<Name> theme for online stores | Khatario".
- Only `.ts` files are unit-tested by Jest here; React components are checked by `npx tsc --noEmit -p .` and on staging.

## Review Focus

1. A merchant whose store URL already starts with `demo-` (existing row): must keep working and keep saving settings; the reservation applies only to new or changed URLs (Task 6 Step 4 test, plus the pre-check query in Task 6 Step 1).
2. A demo product id from one catalogue requested on another theme's demo store (`/products/jw-3` on `demo-premium-grocery`): must 404, not show the wrong product (Task 6 test).
3. Applying when the business already has a theme with the theme's name, or names "Heritage Couture 2" and "Heritage Couture 9": the next name is the lowest free number (Task 3 test, Task 4 DB test).
4. Search text with mixed case, extra spaces or no match: filters case-insensitively on trimmed words, and an empty result shows the "No themes match" state, not an empty grid (Task 3 test; Task 9 renders the state).
5. Clicks inside an embedded demo store (links, Add to cart, search submit, category chips) must do nothing while the page still scrolls; a demo store opened directly (no `embed=1`) must still navigate (Task 7 test).

---

### Task 1: Heritage Couture's hero words keep their inner gap on computers

**Files:**
- Modify: the rule found in Step 1 (expected in `components/store/engine/hero.css` or the Heritage preset `lib/store/engine/presets/heritage.ts`)
- Test: `tests/lib/store/engine/hero-layout.test.ts` or `tests/lib/store/engine/presets.test.ts` (whichever holds the cause)

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing new.

- [ ] **Step 1: Find the root cause (superpowers:systematic-debugging).** Reproduce: a Heritage Couture theme on computers (container wider than 900 px) draws "Welcome to <store>" flush against the card's left edge (seen on staging, store `shalinitraders`). Read the Heritage home template's hero section settings (`presetTheme('heritage', ctx)`) and the hero rules that apply to them (`heroRootClasses`, `hero.css`, the full-width and `eng-sp-l` rules in `EngineShell.tsx` THEME_RULES). Write down which setting and rule remove the words' left padding.
- [ ] **Step 2: Write the failing test** for the cause at its pure level (a `heroRootClasses` case, or the preset's hero settings, e.g. `expect(heritageHero.settings.spacing_left)...`). If the cause is CSS-only, record the reproduction in the commit message instead and skip to Step 3.
- [ ] **Step 3: Fix the cause** so the words keep the same inner gap as an over-the-photo hero (38px 44px on computers, `hero.css` `.hb-h-adapt .eng-hero-inner`), without changing any other preset's hero.
- [ ] **Step 4: Run** `npx jest tests/lib/store` → all pass.
- [ ] **Step 5: Commit** the changed files with a sentence such as "Heritage Couture's hero words keep their inner gap on computers instead of touching the left edge."

### Task 2: Quick's hero words are readable without a picture

**Files:**
- Modify: the rule found in Step 1 (expected in `lib/store/engine/presets/quick.ts`, `lib/store/engine/hero-layout.ts` or the slideshow's colour classes)
- Test: the matching test file under `tests/lib/store/engine/`

**Interfaces:** none new.

- [ ] **Step 1: Find the root cause (superpowers:systematic-debugging).** Reproduce: a new Quick theme draws its hero ("Welcome to <store>", "Shop now") as white words on a pale beige panel when the store has no hero picture. Find which section draws it (slideshow or Hero banner) and why its words are white with no picture (`hb-white` needs a computer picture in `heroRootClasses`; slides have their own rule).
- [ ] **Step 2: Write the failing test**: with no picture, the section's state classes contain no white-words class (or the Quick preset's slide carries a dark text colour), using the real Quick preset output.
- [ ] **Step 3: Fix the cause**: words without a picture use the section's text colour; existing heroes with a picture keep white words.
- [ ] **Step 4: Run** `npx jest tests/lib/store` → all pass.
- [ ] **Step 5: Commit** ("Quick's hero shows dark words on its panel when there is no picture, instead of white on beige.").

### Task 3: The theme list and the store's filter, sort and naming rules

**Files:**
- Create: `lib/store/engine/theme-catalog.ts`, `lib/store/engine/theme-store.ts`
- Modify: `lib/store/engine/library.ts` (`PRESET_CHOICES` derived from the list)
- Test: `tests/lib/store/engine/theme-catalog.test.ts`, `tests/lib/store/engine/theme-store.test.ts`, existing `tests/lib/store/engine/library.test.ts` stays green

**Interfaces:**
- Produces (theme-catalog.ts, client-safe, type-only imports):
  - `type ThemeCategoryId = 'grocery' | 'fashion' | 'jewellery' | 'electronics' | 'home' | 'pharmacy' | 'food' | 'any'`
  - `THEME_CATEGORIES: { id: ThemeCategoryId; label: string }[]` with labels Grocery & Kirana, Fashion & Apparel, Jewellery, Electronics, Home & Lifestyle, Pharmacy & Wellness, Restaurants & Food, Any store (in that order).
  - `type DemoCatalogId = 'jewellery' | 'fashion' | 'grocery' | 'general'` (re-exported by Task 5's `demo-catalogs.ts`).
  - `interface CatalogTheme { preset: ThemePreset; slug: string; name: string; summary: string; about: string; categories: ThemeCategoryId[]; features: string[]; palette: [string, string, string]; canvas: string; accent: string; premium: boolean; added: string; featured?: true; demo: { subdomain: string; brand: string; tagline: string; catalog: DemoCatalogId } | null }`
  - `THEME_CATALOG: CatalogTheme[]`, `catalogTheme(slug: string): CatalogTheme | null`, `catalogThemeByPreset(preset: ThemePreset): CatalogTheme`
- Produces (theme-store.ts, pure):
  - `type ThemeTab = 'all' | 'popular' | 'new' | 'free' | 'premium'`; `type ThemeSort = 'popular' | 'newest' | 'name'`
  - `filterThemes(list: CatalogTheme[], o: { category: ThemeCategoryId | 'all'; tab: ThemeTab; query: string; sort: ThemeSort; popularity: Partial<Record<ThemePreset, number>>; today: string }): CatalogTheme[]`
  - `categoryCounts(list: CatalogTheme[]): { id: ThemeCategoryId | 'all'; label: string; count: number }[]` (All themes first, then categories with count > 0 in `THEME_CATEGORIES` order)
  - `themeNameFor(base: string, taken: string[]): string`

- [ ] **Step 1: Write the failing tests.**

```ts
// theme-catalog.test.ts
it('lists every preset exactly once, with unique slugs and known categories', () => {
  expect(THEME_CATALOG.map((t) => t.preset).sort()).toEqual(['blank', 'grocery', 'heritage', 'khatario', 'quick', 'studio']);
  expect(new Set(THEME_CATALOG.map((t) => t.slug)).size).toBe(THEME_CATALOG.length);
  for (const t of THEME_CATALOG) {
    expect(t.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    t.categories.forEach((c) => expect(THEME_CATEGORIES.map((x) => x.id)).toContain(c));
    t.palette.forEach((h) => expect(h).toMatch(/^#[0-9a-f]{6}$/i));
    expect(t.added).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }
});
it('every theme but Blank has a demo store on demo-<slug>; one theme is featured', () => {
  for (const t of THEME_CATALOG) {
    if (t.preset === 'blank') expect(t.demo).toBeNull();
    else expect(t.demo?.subdomain).toBe(`demo-${t.slug}`);
  }
  expect(THEME_CATALOG.filter((t) => t.featured).map((t) => t.slug)).toEqual(['heritage-couture']);
});
it('PRESET_CHOICES come from the list', () => {
  expect(PRESET_CHOICES.map((c) => [c.preset, c.label, !!c.premium])).toEqual(
    THEME_CATALOG.map((t) => [t.preset, t.name, t.premium]));
});
// theme-store.test.ts (list built from THEME_CATALOG; popularity { grocery: 9, studio: 4, heritage: 4 }; today '2026-11-01')
it('search matches name, summary, categories and features, case-insensitive and trimmed', ...);   // '  GROCERY ' finds Premium Grocery and Quick
it('an unmatched search returns []', ...);
it('tabs: free hides premium, premium shows only premium, new keeps themes added in the last 90 days', ...);
it('popular tab and sort order by popularity, ties keep list order, Blank always last', ...);
it('name sort is alphabetical with Blank last; newest sorts by added descending', ...);
it('category filter keeps themes in that category', ...);
it('categoryCounts: All themes first with the total, empty categories left out', ...);
it('themeNameFor', () => {
  expect(themeNameFor('Heritage Couture', [])).toBe('Heritage Couture');
  expect(themeNameFor('Heritage Couture', ['Heritage Couture'])).toBe('Heritage Couture 2');
  expect(themeNameFor('Heritage Couture', ['Heritage Couture', 'Heritage Couture 2', 'Heritage Couture 9'])).toBe('Heritage Couture 3');
  expect(themeNameFor('Heritage Couture', ['heritage couture'])).toBe('Heritage Couture 2'); // case-insensitive
  expect(themeNameFor('x'.repeat(60), ['x'.repeat(60)])).toHaveLength(60); // NAME_MAX 60 kept, suffix fits
});
```

- [ ] **Step 2: Run** `npx jest tests/lib/store/engine/theme-catalog.test.ts tests/lib/store/engine/theme-store.test.ts` → FAIL (modules missing).
- [ ] **Step 3: Write `theme-catalog.ts`** with the six entries. Slugs: `heritage-couture`, `premium-grocery`, `quick`, `studio`, `khatario`, `blank`. Categories: Heritage `['jewellery','fashion']`, Premium Grocery `['grocery']`, Quick `['grocery','food']`, Studio `['fashion','home','any']`, Khatario `['any','electronics']`, Blank `['any']`. Premium: Heritage only. Demo brands: Aarna Jewels (jewellery), FreshMart (grocery), QuickBasket (grocery), Studio Loom (fashion), Kartik Electronics (general). `canvas`/`accent` copied from today's `PRESET_CHOICES`; `summary` = today's descriptions (Heritage's shortened to one line); `about`, `features` (four to six each) and `palette` written per theme; `added` = `2026-10-31` for Heritage, `2026-06-01` for the rest; Blank's name stays "Blank" (the store page labels its card "Start from blank").
- [ ] **Step 4: Derive `PRESET_CHOICES`** in `library.ts` from `THEME_CATALOG` (`label: name`, `description: summary`, `canvas`, `accent`, `premium` only when true), keeping `PresetChoice` and `visiblePresetChoices` unchanged.
- [ ] **Step 5: Write `theme-store.ts`.** Search: lower-cased trimmed query split on whitespace; every word must occur in the joined lower-cased name, summary, category labels and features. New tab: `added` within 90 days of `today`. The Popular tab sorts by popularity whatever `sort` says. Blank last in every order. `themeNameFor`: `base` when no taken name equals it case-insensitively, else `base` cut to fit `" n"` within 60 characters plus the lowest `n >= 2` not taken.
- [ ] **Step 6: Run** `npx jest tests/lib/store/engine` → all pass.
- [ ] **Step 7: Commit** the four files plus tests ("One theme list now feeds the library's choices, with the theme store's search, tabs, sorting and naming rules.").

### Task 4: A theme added from a preset is named after the theme

**Files:**
- Modify: `lib/store/engine/themes-repo.ts` (`createThemeLocked`)
- Test: `tests/db/store-theme-naming.db.test.ts` (new; same setup block as `tests/db/store-engine-load.db.test.ts`)

**Interfaces:**
- Consumes: `themeNameFor`, `catalogThemeByPreset` (Task 3).
- Produces: no new exports.

- [ ] **Step 1: Write the failing DB test**: on a fresh business, `createTheme(biz, user, { name: '', preset: 'heritage', ctx })` twice names the drafts "Heritage Couture" and "Heritage Couture 2"; a typed name is kept as typed; a duplicate (`duplicateOf`) still gets "Copy of …"; `source: 'migrated'` unchanged.
- [ ] **Step 2: Run** `PHASE2_TEST_DATABASE_URL=<kh_phase2_test url from .env> npx jest tests/db/store-theme-naming.db.test.ts` → FAIL ("Untitled theme").
- [ ] **Step 3: Implement**: in the preset branch, when `name` is empty, read the business's theme names (inside the held lock) and use `themeNameFor(catalogThemeByPreset(preset).name, names)`. Remove "Untitled theme".
- [ ] **Step 4: Run** the DB test and `npx jest tests/lib/store` → pass.
- [ ] **Step 5: Commit** ("A theme added from a design is named after it ("Heritage Couture", then "Heritage Couture 2") instead of "Untitled theme".").

### Task 5: Demo catalogues with our own photos

**Files:**
- Create: `lib/store/engine/demo-catalogs.ts`, `scripts/theme-demo-photos.mjs`, `scripts/theme-demo-photos.json`, `public/theme-demos/{jewellery,fashion,grocery,general}/*.webp`, `public/theme-demos/heroes/*.webp`, `public/theme-demos/CREDITS.md`
- Test: `tests/lib/store/engine/demo-catalogs.test.ts`

**Interfaces:**
- Consumes: `DemoCatalogId` (Task 3), `StoreProduct` type (`components/store/StoreProductCard`).
- Produces:
  - `DEMO_CATALOGS: Record<DemoCatalogId, { categories: { id: string; name: string }[]; products: StoreProduct[]; heroes: string[] }>`
  - `demoCatalog(id: DemoCatalogId)` returning that entry; product ids prefixed per catalogue (`jw-`, `fa-`, `gr-`, `ge-`), category ids likewise (`jw-cat-rings`).

- [ ] **Step 1: Write the failing test**: each catalogue has 4–6 categories and 12–20 products; every product's `category_id` is one of its categories, ids carry the catalogue prefix and are unique across all catalogues, `image_url` is `/theme-demos/<catalog>/<file>.webp`, every referenced file exists on disk (`fs.existsSync(path.join('public', url))`), each catalogue has at least two heroes, and every photo file appears in `CREDITS.md`; `mk` defaults keep `current_stock: 20`, `has_variants: false`.
- [ ] **Step 2: Run** `npx jest tests/lib/store/engine/demo-catalogs.test.ts` → FAIL.
- [ ] **Step 3: Choose the photos.** For each catalogue pick product and hero photos from Unsplash or Pexels whose licence allows commercial use (jewellery: rings, necklaces, earrings, bangles, bridal sets; fashion: apparel like today's `apparelDemoProducts`; grocery: produce, dairy, staples, snacks, drinks; general: electronics and home goods). Record each in `scripts/theme-demo-photos.json` as `{ "file": "jewellery/ring-gold.webp", "url": "<direct image url>", "source": "<photo page url>", "licence": "Unsplash Licence" }`.
- [ ] **Step 4: Write `scripts/theme-demo-photos.mjs`**: reads the manifest, downloads each `url` once into memory, converts with sharp to WebP (`resize({ width: 900 })` for products, `1600` for files under `heroes/`, quality 78, lowering quality until under 200 KB), writes under `public/theme-demos/`, and regenerates `CREDITS.md` (file, source, licence). Run it: `node scripts/theme-demo-photos.mjs`.
- [ ] **Step 5: Write `demo-catalogs.ts`** (names, Indian prices in ₹ with MRPs on about a third, badges and taglines on a few, ratings 4.2–4.9) referencing the files.
- [ ] **Step 6: Run** the test → PASS.
- [ ] **Step 7: Commit** the module, script, manifest, test, `CREDITS.md` and the WebP files by name (a `git add public/theme-demos/<catalog>/*.webp` per folder is fine) ("Four demo catalogues (jewellery, fashion, grocery, general) with stock photos kept in our own files.").

### Task 6: Demo stores on demo-<slug>

**Files:**
- Create: `lib/store/engine/demo-stores.ts`
- Modify: `lib/store/resolve-store.ts` (`StoreBusinessContext` gains `demo_preset?: ThemePreset; demo_catalog?: DemoCatalogId`; `resolveStoreBySubdomain` tries `engineDemoStore` after `themeDemoStore`; `isReservedStoreSubdomain` also reserves `demo-*`), `app/api/settings/online-store/route.ts` (use `isReservedStoreSubdomain` instead of its own list), `lib/store/theme-demo.ts` (`filterDemoCatalog` and `themeDemoProducts` accept `catalog?: DemoCatalogId`, which wins over `pack`), `lib/store/engine/load-theme.ts`, `lib/store/engine/section-data.ts` (four demo branches), `app/api/public/store/[subdomain]/items/route.ts`, `app/api/public/store/[subdomain]/items/[id]/route.ts`, `app/store/products/[id]/layout.tsx`, `lib/store/engine/presets/index.ts` (`PresetContext.images?: Record<string, string>`), `lib/store/engine/presets/heritage.ts` (sample picture = `ctx.images?.[name]` else today's SVG)
- Test: `tests/lib/store/engine/demo-stores.test.ts`, extend `tests/db/store-engine-load.db.test.ts`

**Interfaces:**
- Consumes: `THEME_CATALOG`, `catalogTheme` (Task 3); `demoCatalog`, `DEMO_CATALOGS` (Task 5); `presetTheme(preset, ctx)`.
- Produces:
  - `engineDemoStore(subdomain: string): StoreBusinessContext | null` — `is_demo: true`, `name` = demo brand, `store_tagline` = demo tagline, `business_id` = a fixed UUID per slug (`00000000-0000-4000-8000-0000000001<nn>`), `store_promo_sheet` disabled, checkout fields off like `themeDemoStore`, `demo_preset`, `demo_catalog`.
  - `demoThemeData(store: StoreBusinessContext): ThemeData` — `presetTheme(store.demo_preset, { businessName, tagline, heroUrl: first hero, images })` where `images` maps Heritage's sample names to the jewellery heroes.
  - `demoCatalogOptions(store: StoreBusinessContext): { pack?: StoreThemePack; catalog?: DemoCatalogId }` (exported from `theme-demo.ts`) — every demo branch passes this instead of `pack: store.store_theme?.pack`.

- [ ] **Step 1: Check existing URLs**: on `kh_phase2_test` and (read-only, via the SSH host in `docs/SERVER_INFRASTRUCTURE.md`) staging, `SELECT count(*) FROM business_settings WHERE store_subdomain LIKE 'demo-%'`. If any row exists, stop and report; the reservation must not break it.
- [ ] **Step 2: Write the failing unit tests**: `engineDemoStore('demo-heritage-couture')` returns Aarna Jewels with `demo_preset: 'heritage'`, `demo_catalog: 'jewellery'`, `is_demo: true`; `engineDemoStore('demo-nope')`, `('demo-blank')` and `('heritage-couture')` return null; case and whitespace are ignored; `demoThemeData` for Heritage uses `/theme-demos/heroes/...` pictures and for Premium Grocery the FreshMart name; `filterDemoCatalog({ catalog: 'jewellery', page: 1, limit: 50 })` returns only `jw-` items and its categories; `themeDemoProducts(undefined, 'grocery')` has no `jw-` ids (Review Focus 2); `isReservedStoreSubdomain('demo-abc')` true, `('demolition')` false, `('theme-studio')` still true; today's `themeDemoStore('theme-studio')` unchanged (no `demo_catalog`).
- [ ] **Step 3: Run** `npx jest tests/lib/store/engine/demo-stores.test.ts` → FAIL.
- [ ] **Step 4: Implement** `demo-stores.ts`, the context fields, the resolver hook, the reservation (`demo-` prefix in `isReservedStoreSubdomain`; the settings route calls it only when the submitted URL differs from the business's current `store_subdomain`, so a store already on a reserved URL can still save its settings — add that case to the route's existing tests or a new `tests/api/online-store-subdomain.test.ts`), `PresetContext.images` and Heritage's use of it.
- [ ] **Step 5: Route the demo branches**: `loadEngineTheme` returns `{ theme: <row from demoThemeData, role 'live', id DEMO_ENGINE_THEME_ID>, preview: true, demo: true }` for a store with `demo_preset` (no `engine=1` needed; old demo stores unchanged); `section-data.ts`, the items route, the item route and the product layout use `demoCatalogOptions(store)`; the item route and product layout find the product in that store's catalogue only (404 otherwise).
- [ ] **Step 6: Extend the DB load test**: `resolveStoreBySubdomain('demo-premium-grocery')` returns the FreshMart demo without touching the database, and `loadEnginePage` for it returns a home template whose product sections load `gr-` products.
- [ ] **Step 7: Run** `npx jest tests/lib/store` and the DB test → pass; `npx tsc --noEmit -p .` → clean.
- [ ] **Step 8: Commit** ("Every theme but Blank has its own demo store on demo-<theme>, drawn by the engine with its demo brand and catalogue; demo- store URLs are reserved.").

### Task 7: Embedded demo stores ignore clicks

**Files:**
- Create: `components/store/StoreEmbedGuard.tsx`
- Modify: `lib/store/engine/links.ts` (`isEmbedSearch`), `components/store/StoreApp.tsx` (mount the guard), `components/store/StorePromoSheet.tsx` (never opens when embedded), `components/store/engine/EngineShell.tsx` (the Preview pill gets class `eng-preview-pill`)
- Test: `tests/lib/store/engine/links.test.ts` (extend)

**Interfaces:**
- Produces: `isEmbedSearch(search: string): boolean` — true only when `embed=1`; `StoreEmbedGuard({ isDemo }: { isDemo: boolean })` which, when `isDemo` and `isEmbedSearch(location.search)`, adds class `eng-embed` to `document.documentElement` and registers capture-phase `click`, `submit`, `auxclick` and `keydown` (Enter or Space on a link, button or input) listeners on `window` that call `preventDefault()` and `stopPropagation()`; CSS `.eng-embed .eng-preview-pill{display:none}`.

- [ ] **Step 1: Write the failing test**: `isEmbedSearch('?embed=1')` true; `''`, `'?embed=0'`, `'?embed=true'`, `'?x=1&embed=1'` → false, false, false, true.
- [ ] **Step 2: Run** `npx jest tests/lib/store/engine/links.test.ts` → FAIL.
- [ ] **Step 3: Implement** `isEmbedSearch`, the guard (mounted inside `StoreProvider` so it reads `store?.is_demo`), the promo check and the pill class. Scrolling (wheel, touch, scrollbars) is untouched.
- [ ] **Step 4: Run** the test → PASS; `npx tsc --noEmit -p .` → clean.
- [ ] **Step 5: Commit** ("A demo store opened with embed=1 ignores clicks and hides its pop-up and Preview pill, so theme previews only scroll.").

### Task 8: Popularity and demo-store addresses for the public pages

**Files:**
- Create: `lib/store/engine/theme-popularity.ts`, `lib/store/demo-store-url.ts`
- Test: `tests/lib/store/demo-store-url.test.ts`, `tests/db/store-theme-popularity.db.test.ts`

**Interfaces:**
- Consumes: `storePublicHostname`, `storeHostSuffix` (`lib/store/subdomain.ts`).
- Produces:
  - `themePopularity(): Promise<Partial<Record<ThemePreset, number>>>` — `SELECT preset, count(*)::int AS n FROM store_themes WHERE role = 'live' GROUP BY preset`, wrapped in `unstable_cache(..., ['theme-popularity'], { revalidate: 3600 })`; returns `{}` on any error (logged).
  - `demoStoreUrl(appHost: string, proto: string, subdomain: string, path: string, embed: boolean): string` — same host and protocol rules as `storePreviewUrl` (https except `*.localhost`, port kept on localhost), `?embed=1` when `embed`.

- [ ] **Step 1: Write the failing tests**: `demoStoreUrl('khatario.com', 'http', 'demo-quick', '/', true)` = `https://demo-quick.khatario.com/?embed=1`; `('staging.khatario.com', 'https', 'demo-quick', '/catalog', false)` = `https://demo-quick.staging.khatario.com/catalog`; `('app.localhost:3000', 'http', 'demo-quick', '/', true)` keeps `http` and `:3000`. DB: two live heritage themes and one live grocery theme in two/one businesses give `{ heritage: 2, grocery: 1 }` (call the uncached inner function, exported as `countLiveThemesByPreset`).
- [ ] **Step 2: Run** both → FAIL.
- [ ] **Step 3: Implement** both files.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** ("The theme store can order themes by how many stores use them and build each demo store's address.").

### Task 9: The public theme store page

**Files:**
- Create: `app/themes/layout.tsx` (metadata, canonical `/themes`), `app/themes/page.tsx` (server: reads `headers()` for host/proto, `themePopularity()`, builds `demoStoreUrl(..., '/', true)` per theme), `components/marketing/themes/ThemeStore.tsx` (client: search, categories, tabs, sort, grid, empty state), `components/marketing/themes/ThemeCard.tsx`, `components/marketing/themes/ThemeLivePreview.tsx`, `components/marketing/themes/DeviceFrames.tsx` (laptop and phone frames), `components/marketing/themes/ApplyThemeLink.tsx`
- Modify: `components/marketing/MarketingSiteHeader.tsx` (Themes link before Pricing, desktop and mobile, active on `/themes*`), `app/sitemap.ts` (`/themes` in `STATIC_PATHS`)

**Interfaces:**
- Consumes: `THEME_CATALOG`, `filterThemes`, `categoryCounts`, `ThemeTab`, `ThemeSort` (Task 3); `themePopularity`, `demoStoreUrl` (Task 8); `LOCAL_SESSION_COOKIE` (`lib/auth/local-session-cookie.ts`).
- Produces:
  - `ThemeLivePreview({ src, width, height, interactive, palette, title }: { src: string; width: 1440 | 390; height: number; interactive: boolean; palette: [string, string, string]; title: string })` — iframe at `width`×`height`, scaled by ResizeObserver to its box; `src` set when IntersectionObserver reports it within 200px of the view; skeleton in palette colours until `load`; "Preview unavailable" after 20 s without `load`; when not `interactive`: `tabIndex={-1}`, `aria-hidden`, `pointer-events: none`.
  - `applyHref(slug: string, signedIn: boolean): string` in `lib/store/engine/theme-store.ts` (pure, tested): signed in → `/settings/online-store/themes/apply/<slug>`; else `/signup?next=/settings/online-store/themes/apply/<slug>`.
  - `ApplyThemeLink({ slug, className, children })` — reads `document.cookie` for `LOCAL_SESSION_COOKIE` after mount (defaults to the signup link before mount).

- [ ] **Step 1: Add the failing `applyHref` test** to `tests/lib/store/engine/theme-store.test.ts` (both cases; slug passes signup's `next` pattern `^\/(?!\/)[\w\-/]*$`). Run → FAIL. Implement → PASS.
- [ ] **Step 2: Build the page** to the owner's layout: hero (pill "Theme store", heading "Beautiful storefront themes for every business", line "Professional, mobile-first themes to create your online store in minutes.", search box, three points Live preview / Mobile ready / Easy to customise, featured theme in `DeviceFrames` with two `ThemeLivePreview`s: 1440 and 390); left categories with counts (chips row under 768 px); tabs All, Popular, New, Free, Premium; Sort by Popular / Newest / Name; cards (live 1440×900 preview with a "Live preview" button linking to `/themes/<slug>`, name, Free or Premium badge, summary, palette dots, Details, Apply theme via `ApplyThemeLink`); Blank's card draws a plain empty-page sketch and shows only Apply ("Start from blank"); empty result → "No themes match "<query>"" with a Clear search button (Review Focus 4). Uses `MarketingSiteHeader` and the marketing site's colours and fonts.
- [ ] **Step 3: Add the header link and sitemap path.**
- [ ] **Step 4: Run** `npx jest tests/lib/store` and `npx tsc --noEmit -p .` → pass, clean.
- [ ] **Step 5: Commit** ("khatario.com/themes shows every theme drawn live from its demo store, with search, categories, tabs, sorting and Apply.").

### Task 10: A page per theme

**Files:**
- Create: `app/themes/[slug]/page.tsx` (server: `catalogTheme(slug)` or `notFound()`; Blank → `notFound()`; `generateMetadata` with the title format and `about`; `generateStaticParams` from the list), `components/marketing/themes/ThemeDetail.tsx` (client)
- Modify: `app/sitemap.ts` (one `/themes/<slug>` entry per theme with a demo store)

**Interfaces:**
- Consumes: Tasks 3, 8, 9 (`ThemeLivePreview`, `DeviceFrames`, `ApplyThemeLink`, `demoStoreUrl`).
- Produces: `previewPath(page: 'home' | 'catalog' | 'product', catalog: DemoCatalogId): string` in `theme-store.ts` → `/`, `/catalog`, `/products/<first product id of that catalogue>` (add with a test).

- [ ] **Step 1: Add the failing `previewPath` test** (`previewPath('product', 'jewellery')` is `/products/jw-…` of the first jewellery product). Run → FAIL. Implement → PASS.
- [ ] **Step 2: Build the page**: breadcrumb "Themes / <Name>", name, badge, summary; Computer / Phone and Home / Catalog / Product toggles that swap the interactive `ThemeLivePreview`'s `src` (`demoStoreUrl(..., previewPath(...), true)`); Computer draws 1440 wide scaled to the column, Phone 390 wide inside the phone frame; side panel with Apply theme, "Good for" category labels, features, palette, "Open demo store" (new tab, no embed).
- [ ] **Step 3: Run** `npx jest tests/lib/store` and `npx tsc --noEmit -p .` → pass, clean.
- [ ] **Step 4: Commit** ("Each theme has its own page with a live preview to switch between computer and phone and between home, catalog and product.").

### Task 11: Apply from the store; the library opens the store

**Files:**
- Create: `app/(app)/settings/online-store/themes/apply/[slug]/page.tsx`
- Modify: `components/store/library/ThemeLibrary.tsx` (Add theme → **Explore themes** link to `/themes`; new **Copy current store design** button calling `createTheme({ source: 'migrated' })` with today's toast and highlight), `e2e/store-theme-library.spec.ts` (Add theme modal cases become Explore themes / Copy current store design)
- Delete: `components/store/library/AddThemeModal.tsx`

**Interfaces:**
- Consumes: `catalogTheme` (Task 3); `listThemes`, `createTheme`, `editorPath` (`components/store/library/api.ts`); `canAddTheme`, `LIMIT_NOTICE`, `NO_EDIT_NOTICE` (`lib/store/engine/library.ts`); `useAuth`, `usePermissions` (as `themes/page.tsx`).

- [ ] **Step 1: Build the apply page**: unknown slug → "This theme doesn't exist" with a link to `/themes`; no settings update permission → `NO_EDIT_NOTICE`; premium theme while `premium_enabled` is false → "Premium themes aren't on for your store yet."; at 20 themes → `LIMIT_NOTICE`; else "Add <Name> to your themes?" with the theme's live preview (`ThemeLivePreview`, `demoStoreUrl` built from `window.location`), **Add and customise** (calls `createTheme({ preset })`, then `router.push(editorPath(theme.id))`; errors as a toast with the API's message, e.g. the plan feature message) and **Back to themes** (`/themes`). Blank applies with a plain sketch instead of a preview.
- [ ] **Step 2: Change the library** and delete `AddThemeModal.tsx` (remove its import and state).
- [ ] **Step 3: Update the e2e spec** cases that opened the modal.
- [ ] **Step 4: Run** `npx jest tests/lib/store` and `npx tsc --noEmit -p .` → pass, clean.
- [ ] **Step 5: Commit** ("Apply theme adds the theme to the library and opens the editor; the library's Add theme becomes Explore themes and Copy current store design.").

### Task 12: Staging checklist and records

**Files:**
- Create: `docs/superpowers/plans/2026-11-01-store-theme-store-staging-checklist.md`
- Modify: `docs/project.log.md` (append), `docs/roadmap.md` (theme store line)

- [ ] **Step 1: Write the checklist** from the spec's §8 staging list, plus: wildcard DNS and TLS answer for `demo-heritage-couture.staging.khatario.com`; the old `theme-*` demo stores unchanged; an existing store's home page unchanged; a direct visit to a demo store still navigates; `/themes` on a phone (chips row, one card per row, phone frame only in the hero).
- [ ] **Step 2: Run** `npx jest tests/lib/store`, the new DB tests on `kh_phase2_test`, `npx tsc --noEmit -p .` and `npm run build` → record results.
- [ ] **Step 3: Append the project log entry** (Asked / Decided / Shipped / Open) and update the roadmap line; run `graphify update .`.
- [ ] **Step 4: Commit** ("Theme store Part A: staging checklist, project log and roadmap.").
