# Store shopping features (project C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catalog filters/sort/search suggestions, a sectioned product page (gallery, swatches, tabs, size chart, related, recently viewed), buyer reviews with moderation, and abandoned-cart recovery for the Khatario online store.

**Architecture:** Each feature is a pure lib in `lib/store/*` (SQL builders and rules, unit-tested), a public or admin API route, and prop-driven components in `components/store/features/<feature>/` that own no fetching and read colours only from CSS variables. Today's pages and the Quick/grocery chrome mount them; the theme-engine session wraps them as sections later.

**Tech Stack:** Next.js App Router (client store pages), TypeScript, PostgreSQL via `@/lib/db` (`query`, `queryOne`, `getClient`), Jest + ts-jest, Tailwind, lucide-react.

**Spec:** `docs/superpowers/specs/2026-10-29-store-shopping-features-design.md` — read it alongside this plan; section numbers below (§) refer to it.

## Global Constraints

- Do not edit `components/store/admin/theme-studio/*`, `lib/store/studio-*.ts`, `lib/store/store-theme.ts`, `components/store/studio-theme/*`. Anything needed there goes in spec §8.
- New feature components import nothing from `lib/store/store-theme.ts`; colours via `var(--primary)`, `var(--store-accent, var(--primary))`, `var(--paper, #fff)`.
- `business_id` from `resolveStoreBySubdomain(params.subdomain)`; shopper from `readStoreCustomer(request.cookies.get(STORE_CUSTOMER_COOKIE)?.value)` with `session.businessId === store.business_id`; never from the body.
- Migrations `448_store_product_page_reviews.sql`, `449_store_abandoned_carts.sql`; apply only to `kh_phase2_test`; mirror into `database/schema.sql`.
- DB tests are opt-in: skip unless `PHASE2_TEST_DATABASE_URL` is set (pattern of `tests/db/store-items-sort.db.test.ts`).
- Shared folder, user works on `main`: **no commits** unless the user asks; then stage by name. "Commit" steps below mean: list the touched files in the phase's project-log entry instead.
- Copy: plain English, ₹ amounts with Indian grouping (`toLocaleString('en-IN')`).
- Every query that lists store items keeps the visibility rules: `show_in_store = true`, active, `deleted_at IS NULL`.

## Review Focus

1. **Item with variants but no `attributes`** (the common case today) must still be buyable from the product page: `VariantPicker` shows one "Option" axis of `variant_name` chips. Test in Task 8.
2. **Filter URL rewrite drops the Studio draft param**, breaking Studio's live preview. `serializeCatalogFilters` must keep unknown params. Test in Task 4.
3. **Search text with `%` or `_`** (e.g. "100%") must match literally, not as wildcards. Test in Task 2.
4. **Shopper whose order is `delivered` but was later cancelled/refunded** — only `status = 'delivered'` counts; a cancelled order never makes a shopper eligible. Test in Task 14.
5. **Cart reminder sent to a shopper who already ordered** after leaving the cart — the cron must skip a cart when that customer has a `store_orders` row created after the cart's `updated_at`. Test in Task 19.

---

## Phase 1 — Catalog browsing (spec §4)

### Task 1: Items query — filters, sorts, byIds

**Files:**
- Modify: `lib/store/store-items-query.ts`
- Modify: `components/store/StoreProductCard.tsx` (add `brand?: string | null` to `StoreProduct` only)
- Test: `tests/lib/store/store-items-query.test.ts` (extend)

**Interfaces:**
- Produces:
  - `StoreItemsSort = 'name'|'new'|'bestsellers'|'price_asc'|'price_desc'|'discount'|'rating'`; `parseStoreItemsSort(raw)` accepts all seven, default `'name'`.
  - `StoreItemsQueryInput` adds `categoryIds?: string[]`, `brands?: string[]`, `minPrice?: number|null`, `inStockOnly?: boolean`, `minDiscountPct?: number|null`, `ids?: string[]`. `categoryId` stays and is merged into `categoryIds`.
  - `buildStoreItemFilters(input): { conditions: string[]; params: unknown[]; nextIdx: number }` — exported, reused by Task 2 facets. `opts.skip?: Array<'price'|'category'|'brand'|'stock'|'discount'>` omits a filter.
  - List rows gain `brand`. When `ids` is set: `ORDER BY array_position($n::uuid[], i.id)`, and `countSql`/`categorySql` are still returned but the route skips them.
  - `BAYES_PRIOR = 3.5`, `BAYES_WEIGHT = 5` exported constants.

- [ ] **Step 1: Write failing tests** in `tests/lib/store/store-items-query.test.ts`:
  - `it('filters by price range, categories and brands with bound params')`: input `{minPrice: 100, maxPrice: 500, categoryIds: [c1, c2], brands: ['Amul']}` → `listSql` contains `i.selling_price >= $`, `i.selling_price <= $`, `i.category_id = ANY($`, `i.brand = ANY($`; `countParams` equals `[businessId, 100, 500, [c1, c2], ['Amul']]` in that order.
  - `it('in-stock filter counts variant stock')`: `listSql` contains `EXISTS (SELECT 1 FROM item_variants`.
  - `it('discount filter uses percentage off MRP')`: `{minDiscountPct: 25}` → contains `(i.mrp - i.selling_price) / i.mrp * 100 >=` and param `25`.
  - `it('clamps and caps inputs')`: `{minPrice: -5, brands: Array(30).fill('x')}` → no price condition; brands param length 20.
  - `it.each(['price_asc','price_desc','discount','rating'])('parses sort %s')`.
  - `it('rating sort uses the Bayesian average')`: `listSql` contains `3.5` and `5` in the ORDER BY expression.
  - `it('byIds keeps the requested order')`: `{ids: [a, b]}` → contains `array_position(`.
  - `it('selects brand')`: `listSql` contains `i.brand`.
  - Every case calls `assertQueryBinds` implicitly via the builder (no throw).
- [ ] **Step 2: Run** `npx jest tests/lib/store/store-items-query.test.ts` — expect the new cases FAIL.
- [ ] **Step 3: Implement** by extracting the WHERE building into `buildStoreItemFilters`. Variant stock check uses the existing branch-aware `variantStockExpr` logic (move its construction before the conditions). Rating sort: `(COALESCE(rs.sum,0) + 3.5*5) / (COALESCE(rs.cnt,0) + 5) DESC, COALESCE(rs.cnt,0) DESC, i.name` with a `LEFT JOIN (SELECT item_id, SUM(rating) sum, COUNT(*) cnt FROM store_item_ratings WHERE business_id = $1 GROUP BY item_id) rs` only when sort is `rating`. Discount sort: `CASE WHEN i.mrp > 0 THEN (i.mrp - i.selling_price)/i.mrp END DESC NULLS LAST, i.name`.
- [ ] **Step 4: Run** the suite — all PASS (old cases too).

### Task 2: Facets and search-suggest builders

**Files:**
- Create: `lib/store/store-facets-query.ts`, `lib/store/store-suggest.ts`
- Test: `tests/lib/store/store-facets-query.test.ts`, `tests/lib/store/store-suggest.test.ts`

**Interfaces:**
- Consumes: `buildStoreItemFilters` (Task 1).
- Produces:
  - `buildStoreFacetsQuery(input: StoreItemsQueryInput): Record<'price'|'categories'|'brands'|'discount'|'inStock', {sql: string; params: unknown[]}>`; each facet built with `skip` of its own filter.
  - `type StoreFacets = { price: {min: number; max: number}; categories: {id: string; name: string; count: number}[]; brands: {name: string; count: number}[]; discount: {pct: 10|25|50; count: number}[]; inStock: number }`.
  - `shapeFacets(rows): StoreFacets` — drops `brands` to `[]` when fewer than 2 distinct brands; drops `discount` to `[]` when all bucket counts are 0.
  - `escapeLike(s: string): string`; `buildSuggestQuery(businessId: string, q: string): {products: {sql, params}; categories: {sql, params}} | null` (null when trimmed `q` < 2 chars; `q` cut to 60).
  - `type SuggestResult = { products: {id, name, image_url, selling_price: number, mrp: number|null}[]; categories: {id, name}[] }`.

- [ ] **Step 1: Failing tests:**
  - facets: `it('each facet ignores its own filter')` — with `brands: ['Amul']`, `brands.sql` lacks `i.brand = ANY` while `categories.sql` contains it; same for price and categories.
  - `it('hides the brand facet with one brand')`: `shapeFacets` with brand rows `[{name:'Amul',count:3}]` → `brands: []`; with two → kept.
  - suggest: `it('escapes LIKE wildcards')`: `escapeLike('100%_off')` === `'100\\%\\_off'`; products params contain `'100\\%\\_off%'` (prefix) and `'%100\\%\\_off%'`; sql has `ESCAPE '\\'`.
  - `it('returns null under 2 characters')`, `it('ranks word-start matches first')`: sql ORDER BY contains `CASE WHEN`.
- [ ] **Step 2: Run** both files — FAIL.
- [ ] **Step 3: Implement.** Products ILIKE on `i.name`, `i.code`, `i.brand`; rank 0 when `i.name ILIKE q%` or `i.name ILIKE '% ' || q%`, else 1; limit 6. Categories: names with visible items only, limit 3.
- [ ] **Step 4: Run** — PASS.

### Task 3: Catalog APIs + DB test

**Files:**
- Modify: `app/api/public/store/[subdomain]/items/route.ts`
- Create: `app/api/public/store/[subdomain]/items/facets/route.ts`, `app/api/public/store/[subdomain]/search/suggest/route.ts`, `lib/store/query-params.ts`
- Test: `tests/lib/store/query-params.test.ts`, `tests/db/store-catalog-filters.db.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `parseCatalogQuery(sp: URLSearchParams): Partial<StoreItemsQueryInput>` reading `cat` (comma list), `brand` (comma list), `min`, `max`, `stock=1`, `disc` (10|25|50), `sort`, `q`, `ids` (comma list, uuids only). Invalid values dropped.
  - `GET …/items` accepts those params (existing `category`, `search`, `max_price` kept as aliases). With `ids`, returns `{items}` only.
  - `GET …/items/facets` → `StoreFacets`. `GET …/search/suggest?q=` → `SuggestResult`. Both `Cache-Control: public, max-age=30`.
- [ ] **Step 1: Failing unit test** `query-params.test.ts`: `parseCatalogQuery(new URLSearchParams('cat=a,b&brand=Amul&min=100&max=x&stock=1&disc=33&ids=not-a-uuid'))` equals `{brands:['Amul'], minPrice:100, inStockOnly:true}` (non-uuid `cat` and `ids`, non-numeric `max` and `disc` outside 10/25/50 are dropped). Second case with two valid uuids in `cat` and `ids` keeps them in order.
- [ ] **Step 2: Failing DB test** `store-catalog-filters.db.test.ts` (seed one business with store subdomain, two categories, items with brands Amul/Mother Dairy, one out of stock, one with mrp 200 price 100):
  - `filters by brand and in-stock` → only matching ids.
  - `facets count brands ignoring the brand filter` → both brands listed with counts.
  - `suggest finds "amu" by brand and "dai" mid-word` → products ranked.
  - `byIds returns requested order`.
  - Calls the route handlers directly with `new NextRequest(...)` as in `store-khata.db.test.ts`.
- [ ] **Step 3: Run** `npx jest tests/lib/store/query-params.test.ts` (FAIL) and `PHASE2_TEST_DATABASE_URL=… npx jest tests/db/store-catalog-filters.db.test.ts --runInBand` (FAIL).
- [ ] **Step 4: Implement** the parser and routes; routes use `export const dynamic = 'force-dynamic'`, 404 on unknown store, map numeric strings to numbers as the existing items route does.
- [ ] **Step 5: Run** both — PASS.

### Task 4: `useCatalogFilters` state

**Files:**
- Create: `components/store/features/catalog/catalog-filters.ts` (pure), `components/store/features/catalog/useCatalogFilters.ts`
- Test: `tests/lib/store/catalog-filters.test.ts`

**Interfaces:**
- Produces:
  - `type CatalogFilterValue = { categoryIds: string[]; brands: string[]; min: number|null; max: number|null; inStock: boolean; disc: 10|25|50|null; sort: StoreItemsSort; q: string }`.
  - `parseCatalogFilters(sp: URLSearchParams): CatalogFilterValue`; `serializeCatalogFilters(value, base: URLSearchParams): URLSearchParams` — writes only non-default keys, deletes cleared ones, **keeps every other key of `base`**; `activeFilterCount(value): number`; `toApiParams(value): URLSearchParams`.
  - `useCatalogFilters(): { value; set(patch: Partial<CatalogFilterValue>); clear(); apiParams: string }` using `useSearchParams` + `router.replace(pathname + '?' + …, {scroll: false})`.
- [ ] **Step 1: Failing tests:** round trip parse→serialize equals input; `it('keeps the studio draft and unknown params')`: base `draft=abc&utm=x`, set brands → result has `draft=abc`, `utm=x`, `brand=…`; clearing all leaves only `draft` and `utm`; default sort `name` is not written.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.

### Task 5: Catalog components

**Files:**
- Create in `components/store/features/catalog/`: `CatalogFilterPanel.tsx`, `CatalogSortSelect.tsx`, `ActiveFilterChips.tsx`, `SearchSuggest.tsx`, `index.ts` (re-exports)

**Interfaces:**
- Consumes: `StoreFacets`, `SuggestResult` (Task 2), `CatalogFilterValue` (Task 4).
- Produces:
  - `CatalogFilterPanel({facets, value, onChange, layout: 'sidebar'|'sheet', open?, onClose?})`: price min/max inputs (placeholders from `facets.price`), category and brand checkbox lists (brand section absent when `facets.brands` empty), "In stock only" toggle, discount radios "10% off or more"/"25%…"/"50%…" (absent when `facets.discount` empty). Sheet layout: fixed bottom sheet with Apply/Clear footer; edits staged locally until Apply.
  - `CatalogSortSelect({value, onChange})` labels: Name A–Z, Newest, Best sellers, Price: low to high, Price: high to low, Biggest discount, Top rated.
  - `ActiveFilterChips({value, facets, onRemove(key, item?), onClear})`.
  - `SearchSuggest({subdomain, value, onChange, onPick({type:'product'|'category', id}), onSubmit(q), placeholder?, className?})`: 200 ms debounce, `AbortController` per keystroke, arrow/enter/escape, `role="combobox"` + `role="listbox"`, closes on outside click.
- [ ] **Step 1:** Build the four components; no data fetching except `SearchSuggest`'s own suggest call (it is the one self-fetching leaf, via `fetch('/api/public/store/' + encodeURIComponent(subdomain) + '/search/suggest?q=…')`).
- [ ] **Step 2:** `npx tsc --noEmit -p tsconfig.json 2>&1 | grep features/catalog` — no output.

### Task 6: Mount catalog features; Phase 1 check

**Files:**
- Modify: `components/store/StoreCatalogView.tsx`, `components/store/StoreShell.tsx`, `components/store/quick-theme/QuickChrome.tsx`, `components/store/StoreGroceryChrome.tsx`
- Create: `components/store/features/catalog/useCatalogData.ts`

**Interfaces:**
- Produces: `useCatalogData(subdomain, apiParams): {items, total, facets, loading, error, loadMore}` — fetches `items` and `items/facets` with the same params (+ `withStoreDraft`).
- [ ] **Step 1:** In `StoreCatalogView`, replace its local category/search/sort state with `useCatalogFilters` + `useCatalogData` on category and search listings; sidebar at `lg:`, a "Filters (n)" button opening the sheet below; sort select in the toolbar; chips above the grid. Home rows untouched.
- [ ] **Step 2:** Wrap each header search input with `SearchSuggest`; `onPick` product → `/store/products/<id>`, category → catalog with `cat=<id>`; `onSubmit` → catalog with `q`.
- [ ] **Step 3:** Run `npx jest tests/lib/store` — all PASS; `tsc` clean for touched files.
- [ ] **Step 4: Browser check** on `http://ganesh.localhost:<port>` (Map Test Shop, `kh_phase2_test`; seed brands/MRP on two items if missing) at 390 px and 1366 px on studio and quick themes: filters narrow the grid, facets update, chips remove, back button restores, suggestions appear after 2 letters, Studio preview (`/settings/online-store/studio`) still loads with a filter in its URL. Screenshot to `tmp-qa/`.
- [ ] **Step 5:** Append a Phase 1 entry to `docs/project.log.md` (format in `docs/brain.md`).

## Phase 2 — Product page (spec §5)

### Task 7: Migration 448

**Files:**
- Create: `database/migrations/448_store_product_page_reviews.sql`
- Modify: `database/schema.sql`

- [ ] **Step 1:** Write the migration exactly as spec §5.1 (`items.video_url`, `items.store_tabs JSONB NOT NULL DEFAULT '[]'`, `items.size_chart`, `categories.size_chart`) and §6.1 (`store_item_reviews` with both indexes, named `idx_store_item_reviews_item` and `idx_store_item_reviews_status`). Header comment in the style of `444_store_khata.sql`; all statements `IF NOT EXISTS`.
- [ ] **Step 2:** Apply to `kh_phase2_test` only: `psql "$PHASE2_TEST_DATABASE_URL" -f database/migrations/448_store_product_page_reviews.sql`; run it twice — second run no errors.
- [ ] **Step 3:** Mirror columns and table into `database/schema.sql` next to `items`/`store_item_ratings`.

### Task 8: Variant options

**Files:**
- Create: `lib/store/variant-options.ts`
- Test: `tests/lib/store/variant-options.test.ts`

**Interfaces:**
- Produces:
  - `type StoreVariant = { id: string; variant_name: string; selling_price: number|null; current_stock: number; attributes?: Record<string, string>|null }`.
  - `type VariantAxis = { key: string; label: string; values: { value: string; inStock: boolean; swatch: string|null }[] }`.
  - `variantOptions(variants: StoreVariant[]): VariantAxis[]`; `resolveVariant(variants, selection: Record<string,string>): StoreVariant|null`; `nextSelection(variants, selection, key, value): Record<string,string>`; `swatchColor(value: string): string|null`.
- [ ] **Step 1: Failing tests:**
  - `merges color and Colour keys into one "Colour" axis` (keys `color`, `Colour` → one axis key `colour`).
  - `falls back to an Option axis of variant names when attributes are empty` — 2 variants, `attributes: {}` → `[{key:'option', label:'Option', values:[…names]}]`, and `resolveVariant(v, {option: 'Large'})` returns that variant. (Review Focus 1.)
  - `marks values out of stock when every variant with it has no stock`.
  - `swatchColor('Maroon')` → `'#800000'`, `swatchColor('#0af')` → `'#0af'`, `swatchColor('XL')` → `null`.
  - `nextSelection picks an in-stock size when the colour changes and the old size is gone`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (name map: CSS named colours subset + maroon, peach, mustard, navy, cream, beige, rust, olive, teal, magenta, wine, mint, lavender, skin, off white, charcoal; ≤ 40 entries). **Step 4: Run** — PASS.

### Task 9: Related products, recently viewed, JSON-LD, product extras validation

**Files:**
- Create: `lib/store/related-products.ts`, `lib/store/recently-viewed.ts`, `lib/store/product-jsonld.ts`, `lib/store/product-extras.ts`
- Test: `tests/lib/store/product-page-libs.test.ts`

**Interfaces:**
- Produces:
  - `buildRelatedQuery({businessId, itemId, categoryId, brand, limit=8}): {sql, params}` — rank 0 same category, 1 same brand, 2 others by store units sold; excludes `itemId`; returns the same row shape as the items list (reuse its select via a shared exported `STORE_ITEM_SELECT` from Task 1's file if convenient).
  - `pushRecentlyViewed(subdomain, id): void`; `readRecentlyViewed(subdomain, excludeId?): string[]` — key `kh_rv_<subdomain>`, max 12, newest first, dedupe, try/catch.
  - `productJsonLd(p: {name, description, images: string[], sku: string|null, brand: string|null, price: number, inStock: boolean, url: string}, rating: {avg: number; count: number}|null): object`.
  - `type StoreTab = {title: string; body: string}`; `type SizeChart = {columns: string[]; rows: string[][]}`.
  - `validateProductExtras(body): {ok: true; value: {video_url?: string|null; store_tabs?: StoreTab[]; size_chart?: SizeChart|null}} | {ok: false; error: string}` — rules in spec §5.3 (https YouTube/youtu.be or `.mp4`/`.webm`; ≤ 4 tabs, title ≤ 40, body ≤ 4000; ≤ 8 columns, ≤ 20 rows, cells ≤ 40 chars). `videoEmbed(url): {kind:'youtube'; src: string}|{kind:'file'; src: string}|null` (youtube → `https://www.youtube-nocookie.com/embed/<id>`).
- [ ] **Step 1: Failing tests:** related sql excludes item and orders by the rank CASE; recently viewed dedupes and caps at 12 (jsdom `localStorage`); JSON-LD has `@type: 'Product'`, `offers.priceCurrency: 'INR'`, `availability` InStock/OutOfStock, no `aggregateRating` when count 0; validator rejects `http://youtube.com/…`, a 5th tab, a 9-column chart, accepts `https://youtu.be/abc123`; `videoEmbed('https://www.youtube.com/watch?v=abc123').src` ends with `/embed/abc123`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.

### Task 10: Product APIs (public detail, related; admin item and category save)

**Files:**
- Modify: `app/api/public/store/[subdomain]/items/[id]/route.ts`, `app/api/items/[id]/route.ts` (PUT), `app/api/items/route.ts` (POST), `app/api/categories/route.ts` (POST/PUT accepting `size_chart`)
- Create: `app/api/public/store/[subdomain]/items/[id]/related/route.ts`
- Test: `tests/db/store-product-page.db.test.ts`

**Interfaces:**
- Consumes: Tasks 7, 9.
- Produces: detail JSON adds `brand`, `video_url`, `store_tabs`, `size_chart` (item's, else category's — `COALESCE(i.size_chart, c.size_chart)`), and `variants[].attributes`. `GET …/related` → `{items: StoreProduct[]}`.
- [ ] **Step 1: Failing DB test:** item with no chart inherits the category chart; item chart overrides; related excludes the item and lists the same-category item first; item PUT with a 5th tab → 400 with the validator message; valid PUT persists `store_tabs`.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (item save uses `validateProductExtras` only when any of the three keys is present, matching how `gallery_urls` is patched). **Step 4: Run** — PASS, plus `npx jest tests/db/store-items-sort.db.test.ts` still passes.

### Task 11: Product components

**Files:**
- Create in `components/store/features/product/`: `ProductGallery.tsx`, `VariantPicker.tsx`, `ProductInfoTabs.tsx`, `SizeChartSheet.tsx`, `ProductRail.tsx`, `ProductJsonLd.tsx`, `index.ts`
- Modify: `components/store/StoreProductGallery.tsx` (becomes a thin wrapper over `ProductGallery`, same props)

**Interfaces:**
- Consumes: Tasks 8, 9.
- Produces:
  - `ProductGallery({images: string[], videoUrl?: string|null, alt: string, thumbs?: 'side'|'bottom'})` — swipe (pointer events, 40 px threshold), arrow keys, hover zoom ≥ 1024 px (2× background-position pane), click opens a full-screen lightbox with pinch/double-tap zoom; video slide last via `videoEmbed`.
  - `VariantPicker({variants: StoreVariant[], value: string|null, onChange(variantId: string|null)})` — swatch circles when every value of an axis has `swatch`, chips otherwise; out-of-stock values struck through, still selectable; shows "Out of stock" under the axis.
  - `ProductInfoTabs({description: string|null, tabs: StoreTab[], sizeChart: SizeChart|null})` — tabs ≥ 768 px, accordion below; "Size chart" entry opens `SizeChartSheet`. Description tab first; empty sections not rendered.
  - `SizeChartSheet({chart, open, onClose})`.
  - `ProductRail({title: string, products: StoreProduct[], onOpen(id)})` — horizontal scroll of `StoreProductCard`; renders nothing when empty. `RelatedProducts` and `RecentlyViewed` are this component with different titles ("You may also like", "Recently viewed").
  - `ProductJsonLd({data: object})`.
- [ ] **Step 1:** Build the components.
- [ ] **Step 2:** `tsc` clean for `features/product`; `npx jest tests/lib/store/item-gallery.test.ts` still passes.

### Task 12: Product page composition and other mounts

**Files:**
- Modify: `app/store/products/[id]/page.tsx`, `components/store/StoreProductDetailModal.tsx`, `components/store/quick-theme/QuickSheets.tsx` (`QuickVariantSheet` only), `components/store/StoreKhatarioProductView.tsx`
- Create: `components/store/features/product/ProductInfo.tsx`, `components/store/features/product/useProductPage.ts`

**Interfaces:**
- Produces:
  - `useProductPage(subdomain, id): {product, related, recent, loading}` — fetches detail and related, pushes recently viewed, hydrates recent via `items?ids=`.
  - `ProductInfo({product, variantId, onVariantChange, quantity, onQuantity, onAdd, inCart, favorite, onToggleFavorite, rating})` — title, brand, price/MRP/% off, stars, `VariantPicker`, qty, add-to-cart, wishlist. Cart calls stay in the page (existing `addToCart`/`updateCartQuantity` from `useStore`).
- [ ] **Step 1:** Page renders, in order: `ProductGallery`, `ProductInfo`, `ProductInfoTabs`, a `product-reviews` slot (empty until Task 16), `ProductRail` related, `ProductRail` recent, `ProductJsonLd` (url = `window.location.href`). The khatario-pack branch keeps `StoreKhatarioProductView` but passes it `ProductGallery`/`VariantPicker`/`ProductInfoTabs` in place of its own gallery and variant list.
- [ ] **Step 2:** Modal and `QuickVariantSheet` replace their variant list with `VariantPicker` (variant id flows into the existing cart code unchanged) and the modal gets `ProductInfoTabs`.
- [ ] **Step 3:** `tsc` clean for touched files; `npx jest tests/lib/store` PASS.

### Task 13: Admin extras; Phase 2 check

**Files:**
- Create: `components/store/admin/ItemStorePageFields.tsx`, `components/store/admin/CategorySizeChartEditor.tsx`
- Modify: `app/(app)/items/[id]/page.tsx` (or its form component), `app/(app)/items/new/page.tsx`, `app/(app)/items/categories/page.tsx`

**Interfaces:**
- Produces: `ItemStorePageFields({value: {video_url, store_tabs, size_chart}, onChange, categoryChart: SizeChart|null})` with a "Use category size chart" toggle (on = `size_chart: null`); `CategorySizeChartEditor({value: SizeChart|null, onChange})` — editable grid, add/remove row and column within the §5.3 limits.
- [ ] **Step 1:** Build and mount; the item form sends the three keys only when changed.
- [ ] **Step 2: Browser check** (signed in on the local test-DB server): set a video, two tabs and a category chart; on the store at 390 px and 1366 px: swipe, zoom, video slide, swatches on a variant item with attributes and chips on one without, size chart sheet, related and recently viewed rails; view page source/DOM for the JSON-LD script. Screenshots to `tmp-qa/`.
- [ ] **Step 3:** Project-log entry for Phase 2 (Migration 448 written, applied to `kh_phase2_test` only).

## Phase 3 — Reviews (spec §6)

### Task 14: Reviews lib + DB test

**Files:**
- Create: `lib/store/reviews.ts`
- Test: `tests/lib/store/reviews.test.ts`, `tests/db/store-reviews.db.test.ts`

**Interfaces:**
- Produces:
  - `type ReviewStatus = 'published'|'pending'|'hidden'`; `type StoreReview = {id, item_id, rating, title: string|null, body, photos: string[], status, merchant_reply: string|null, replied_at: string|null, created_at, customer_name: string}` (name shown as first name + last initial).
  - `reviewStatusFor(photos: string[]): ReviewStatus`; `histogram(rows: {rating:number; n:number}[]): {avg: number; count: number; histogram: [number,number,number,number,number]}` (index 0 = 5 stars).
  - `canReview(businessId, customerId|null, itemId): Promise<{ok: true; orderId: string} | {ok: false; reason: 'sign_in'|'not_bought'|'already_reviewed'}>`.
  - `createReview(businessId, customerId, input: {item_id, rating, title?, body, photos?}): Promise<StoreReview>` — in one transaction: eligibility, insert, upsert `store_item_ratings`.
  - `updateReview(businessId, customerId, reviewId, input): Promise<StoreReview>` — author only, within 30 days of `created_at`, re-applies `reviewStatusFor`; syncs the rating row by the rule below.
  - `reviewSummary(businessId, itemId)`; `listReviews({businessId, itemId, sort: 'recent'|'highest'|'lowest'|'with_photos', page, pageSize = 10}): Promise<{reviews: StoreReview[]; hasMore: boolean}>` (published only); `listReviewsForMerchant({businessId, status?, page}): Promise<{reviews: (StoreReview & {item_name: string; phone: string})[]; hasMore: boolean}>`.
  - `moderateReview(businessId, reviewId, action: 'hide'|'publish'|'reply'|'delete_reply', reply?: string): Promise<StoreReview>`.
  - **Rating-row rule (spec §6.1):** a review's rating row exists exactly when the review is `published`. Insert as `pending` → no rating row yet; publish → upsert; hide → delete. Author edit follows the resulting status.
- [ ] **Step 1: Failing unit tests:** `reviewStatusFor([])` → published, with one photo → pending; `histogram` avg rounding to 1 decimal and bucket order.
- [ ] **Step 2: Failing DB tests** (seed shopper, item, orders):
  - `refuses a shopper without a delivered order` (`pending` order → `not_bought`).
  - `refuses a shopper whose only order with the item is cancelled` (Review Focus 4).
  - `publishes a text review and writes the rating row`.
  - `keeps a photo review pending with no rating row until published`.
  - `hide removes the rating row and publish restores it`; summary excludes hidden.
  - `one review per shopper per item` → `already_reviewed`.
  - `author cannot edit after 30 days` (set `created_at` back).
  - `merchant of another business cannot moderate` (wrong businessId → not found).
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement** (use `getClient()` + `BEGIN/COMMIT` like the orders route). **Step 5: Run** — PASS.

### Task 15: Review APIs

**Files:**
- Create: `app/api/public/store/[subdomain]/items/[id]/reviews/route.ts` (GET), `app/api/public/store/[subdomain]/reviews/route.ts` (POST), `app/api/public/store/[subdomain]/reviews/[id]/route.ts` (PATCH), `app/api/public/store/[subdomain]/reviews/photos/route.ts` (POST multipart), `app/api/settings/online-store/reviews/route.ts` (GET), `app/api/settings/online-store/reviews/[id]/route.ts` (PATCH)
- Test: extend `tests/db/store-reviews.db.test.ts`

**Interfaces:**
- Consumes: Task 14; `uploadImage(file, businessId, folder)` from `lib/image-upload.ts`.
- Produces:
  - `GET …/items/[id]/reviews?sort&page` → `{summary, reviews, hasMore, can_review: {ok, reason?}}`.
  - `POST …/reviews` → 201 `{review}`; 401 without session; 403 `{error, reason}` when not eligible; body rules: rating 1–5 integer, body 10–2000 chars, title ≤ 120, photos ≤ 4 URLs that start with the business's upload prefix.
  - `POST …/reviews/photos` → `{url}`; session required; `image/jpeg|png|webp` only, ≤ 2 MB; folder `store-reviews/<business_id>`.
  - Admin routes authenticate like `app/api/settings/online-store/route.ts` (same session + business helper and access check); PATCH body `{action, reply?}`; reply ≤ 1000 chars.
- [ ] **Step 1: Failing DB route tests:** POST without cookie → 401; POST with a photo URL from another prefix → 400; admin PATCH hide → GET public no longer lists it; photo route rejects `application/pdf` (call handler with a `FormData` file).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.

### Task 16: Review components and mounts

**Files:**
- Create in `components/store/features/reviews/`: `ReviewSummary.tsx`, `ReviewList.tsx`, `ReviewForm.tsx`, `useProductReviews.ts`, `index.ts`
- Modify: `app/store/products/[id]/page.tsx` (fill the `product-reviews` slot), `components/store/StoreProductDetailModal.tsx`, `components/store/quick-theme/QuickSheets.tsx` (summary + link only)

**Interfaces:**
- Produces:
  - `ReviewSummary({summary, canReview: {ok, reason?}, onWrite, onSignIn})` — big average, stars (`StoreStars`), 5→1 bars, "Write a review" (or "Sign in to review" / "Only buyers can review" / "You reviewed this").
  - `ReviewList({reviews, sort, onSort, hasMore, onLoadMore, onOpenPhoto(url)})` — "Verified buyer" tag on every review, merchant reply indented "Reply from <store>".
  - `ReviewForm({initial?, onSubmit(input), onUploadPhoto(file): Promise<string>, onCancel})` — after submitting with photos shows "Thanks! Your review will appear once the shop approves the photos."
  - `useProductReviews(subdomain, itemId)`.
- [ ] **Step 1:** Build and mount; after a successful post, call the existing `rateProduct` refresh path (or re-fetch the product) so card stars update.
- [ ] **Step 2:** `tsc` clean for touched files.

### Task 17: Admin moderation; Phase 3 check

**Files:**
- Create: `components/store/admin/StoreReviewsManager.tsx`, `app/(app)/settings/online-store/reviews/page.tsx`
- Modify: `app/(app)/settings/online-store/page.tsx` (add a "Reviews" link beside "Enquiries" in the header actions, with a pending-count badge from `GET …/reviews?status=pending`). The spec says "tab"; Enquiries and Orders are separate pages linked from the header, so Reviews and Abandoned carts follow that pattern.

- [ ] **Step 1:** Manager: status filter (Pending / Published / Hidden / All), rows with item, shopper name + phone, stars, title/excerpt, photo thumbs, date; actions Publish, Hide, Reply (inline textarea), Delete reply.
- [ ] **Step 2: Browser check:** as debug-OTP shopper Sharma ji with a delivered order (seed one), post a text review (shows at once) and a photo review (pending); approve it in admin; hide one; reply; check product page, card stars and the modal at 390 px and 1366 px. Screenshots to `tmp-qa/`.
- [ ] **Step 3:** Project-log entry for Phase 3.

## Phase 4 — Abandoned cart (spec §7)

### Task 18: Migration 449 and the reminder event

**Files:**
- Create: `database/migrations/449_store_abandoned_carts.sql`
- Modify: `database/schema.sql`, `lib/whatsapp/tenant-events.ts`, `lib/push/customer-push.ts`
- Test: extend the existing tenant-events/template tests (find with `grep -rl TENANT_WA_EVENT_KEYS tests`)

- [ ] **Step 1:** Migration per spec §7.2 (`store_carts` with partial index `idx_store_carts_open`; `businesses.store_cart_reminder_enabled`, `store_cart_reminder_hours` with the 1–72 check). Apply twice to `kh_phase2_test`; mirror to `schema.sql`.
- [ ] **Step 2:** Add `store_cart_reminder` to `TENANT_WA_EVENT_KEYS` with fields `customer_name`, `store_name`, `item_names`, `total`, `cart_link`; add `item_names` (sample "Basmati rice 5 kg, Ghee 1 L") and `cart_link` (sample `https://sharma.khatario.com/store/cart`) to `TENANT_WA_FIELDS`; default template body must not start or end with a variable (existing template tests enforce it): "Hi {{customer_name}}, you left {{item_names}} (₹{{total}}) in your cart at {{store_name}}. Complete your order here: {{cart_link}} Thank you." Category `MARKETING`.
- [ ] **Step 3:** Add `store_cart_reminder: {title: 'Your cart is waiting', href: '/store/cart'}` to `CUSTOMER_PUSH_EVENTS`.
- [ ] **Step 4:** Run the template/event test files — PASS.

### Task 19: Abandoned-cart lib + DB test

**Files:**
- Create: `lib/store/abandoned-carts.ts`
- Test: `tests/lib/store/abandoned-carts.test.ts`, `tests/db/store-abandoned-carts.db.test.ts`

**Interfaces:**
- Consumes: Task 18; `enqueueCustomerPush`, `notifyStoreEvent`.
- Produces:
  - `type CartLine = {item_id: string; variant_id: string|null; quantity: number; price: number; name: string; image_url: string|null}`.
  - `mergeCarts(local: CartLine[], server: CartLine[]): CartLine[]` — union by `item_id + variant_id`; server quantity wins; order: server lines then new local lines.
  - `cartSubtotal(lines): number`; `cartReminderMessage(lines, store: {name: string}, total: number): {item_names: string; total: string}` — first 3 names joined by ", ", then " and N more"; total `toLocaleString('en-IN', {minimumFractionDigits: 2})`.
  - `saveCart(businessId, customerId, lines): Promise<void>` (≤ 50 lines, quantity 1–999; empty → status `cleared`; non-empty → `open`, `updated_at = now()`, `reminded_at` unchanged).
  - `readCart(businessId, customerId): Promise<CartLine[]>`; `markRecovered(client, businessId, customerId, orderId): Promise<void>`.
  - `claimDueCarts(limit = 50): Promise<DueCart[]>` — one statement with `FOR UPDATE SKIP LOCKED` on enabled businesses, conditions per spec §7.3 **including no `store_orders` row for that business and `store_customer_id` with `created_at > cart.updated_at`**, sets `reminded_at = now()` in the same transaction.
  - `sendCartReminder(cart: DueCart|{id: string; businessId: string}, via: 'auto'|'manual'): Promise<{sent: boolean; channel: 'push'|'whatsapp'|null; error?: string}>` — push when `enqueueCustomerPush` returns `queued: true`, else `notifyStoreEvent({eventKey: 'store_cart_reminder', …})`; writes `reminder_via`.
  - `canRemindManually(remindedAt: Date|null, now: Date): boolean` (null or ≥ 24 h).
  - `purgeStaleCarts(): Promise<number>` (open or cleared, `updated_at` older than 30 days).
- [ ] **Step 1: Failing unit tests:** merge keeps server quantity and appends new local line; message "A, B, C and 2 more" and "1,250.00"; `canRemindManually` at 23 h false, 24 h true.
- [ ] **Step 2: Failing DB tests:**
  - `claims only carts older than the business setting and not yet reminded`.
  - `skips a business with reminders off`.
  - `skips a cart whose shopper ordered after leaving it` (Review Focus 5).
  - `a second claim run returns nothing`.
  - `empty save marks the cart cleared`; `markRecovered sets status and order id`.
  - `sendCartReminder falls back to WhatsApp when the shopper has no device` (mock `notifyStoreEvent` with `jest.mock('@/lib/store/notify-whatsapp')`, assert called with `eventKey: 'store_cart_reminder'`).
- [ ] **Step 3: Run** — FAIL. **Step 4: Implement.** **Step 5: Run** — PASS.

### Task 20: Cart API, context sync, recovered on order

**Files:**
- Create: `app/api/public/store/[subdomain]/cart/route.ts` (GET, PUT)
- Modify: `lib/store/store-context.tsx`, `app/api/public/store/[subdomain]/orders/route.ts` (call `markRecovered(client, …)` before its `COMMIT` at line ~382 when `store_customer_id` is set)
- Test: extend `tests/db/store-abandoned-carts.db.test.ts`

**Interfaces:**
- Produces: `GET …/cart` → `{lines: CartLine[]}`; `PUT …/cart {lines}` → `{ok: true}`; both 401 without session. Line `price`/`name`/`image_url` are re-read from `items`/`item_variants` on PUT (the client sends only `item_id`, `variant_id`, `quantity`); unknown or hidden items dropped.
- [ ] **Step 1: Failing DB tests:** PUT ignores a client-sent price (stored price equals the item's `selling_price`); PUT drops a hidden item; placing a store order through the orders route marks the open cart recovered.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the route; in `store-context` when `customer` is set: on sign-in GET, `mergeCarts(local, server)`, set cart and PUT the merged result; afterwards debounce 2 s PUT on every cart change; never PUT when signed out; failures ignored (cart still works locally).
- [ ] **Step 4: Run** — PASS; `npx jest tests/db/store-order-safety.db.test.ts` same result as before the change (it has 6 known failures on clean HEAD per the 2026-10-29 log).

### Task 21: Cron and manual reminder routes

**Files:**
- Create: `app/api/cron/abandoned-carts/route.ts`, `app/api/settings/online-store/abandoned-carts/route.ts` (GET list), `app/api/settings/online-store/abandoned-carts/[id]/remind/route.ts` (POST)
- Modify: `vercel.json` (cron every 15 min), `docs/SERVER_INFRASTRUCTURE.md` (crontab lines for staging and production beside `whatsapp-followups`)

**Interfaces:**
- Consumes: Task 19.
- Produces: cron → `{claimed, sent, failed, purged}`, guarded by `assertCronAuthorized(request)`; list → `{carts: {id, customer_name, phone, item_count, subtotal, updated_at, reminded_at, reminder_via, lines}[]}` (open only, newest first, limit 100); remind → 409 `{error: 'Reminder already sent in the last 24 hours'}` when `canRemindManually` is false, else `{sent, channel}`.
- [ ] **Step 1: Failing DB test:** cron without the bearer → 401; with it sends one reminder for the due cart; remind route twice → second is 409; list excludes recovered carts and another business's carts.
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.

### Task 22: Admin list and setting; Phase 4 check

**Files:**
- Create: `components/store/admin/AbandonedCartList.tsx`, `app/(app)/settings/online-store/abandoned-carts/page.tsx`
- Modify: `app/(app)/settings/online-store/page.tsx` (header link "Abandoned carts"; in the setup tab a toggle "Remind shoppers about carts they leave" and "after [3] hours"), `app/api/settings/online-store/route.ts` (read/write the two columns; hours clamped 1–72)

- [ ] **Step 1:** List: shopper, phone, items (expandable), subtotal ₹, "left 5 h ago", reminder status ("Reminded by WhatsApp 2 h ago"); "Send reminder" (disabled with title "Already reminded in the last 24 hours"); "WhatsApp" link `https://wa.me/91<digits>?text=<encoded message>` built from `cartReminderMessage`.
- [ ] **Step 2: Browser check:** as Sharma ji add two items and leave; confirm the row in admin; set hours to 1, backdate `updated_at` in `kh_phase2_test`, call the cron locally with the bearer, see "Reminded"; place an order from a second cart and confirm it leaves the list; sign in on a fresh browser and confirm the cart reappears (merge). Screenshots to `tmp-qa/`.
- [ ] **Step 3:** Project-log entry for Phase 4 (Migration 449 written, applied to `kh_phase2_test` only; open: migrations 448/449 on staging with owner approval, crontab line, Meta template for `store_cart_reminder`). Add a roadmap card if the owner wants one tracked.

## Final verification (after Phase 4)

- [ ] `npx jest tests/lib/store` — all PASS.
- [ ] `PHASE2_TEST_DATABASE_URL=… npx jest tests/db/store-catalog-filters.db.test.ts tests/db/store-product-page.db.test.ts tests/db/store-reviews.db.test.ts tests/db/store-abandoned-carts.db.test.ts tests/db/store-items-sort.db.test.ts tests/db/store-khata.db.test.ts --runInBand` — all PASS.
- [ ] `npx tsc --noEmit` — no new errors in touched files (known errors elsewhere listed in the log).
- [ ] `git status` shows no changes to the files listed under Global Constraints as off-limits.
