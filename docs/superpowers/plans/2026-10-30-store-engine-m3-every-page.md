# Store theme engine M3 (Every page) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On an engine store, the product page, the catalog (all products and one category) and merchant-made custom pages are built from sections, and Studio 2 edits all of them: page switcher, a product to preview with, "New page", page settings. The remaining home sections (collection list, logo list, video, FAQ, newsletter, countdown, spacer) are added.

**Architecture:** Every storefront route uses one loader, `loadEnginePage(store, searchParams, templateKey)`, which generalises M1's home loader. It passes the result to `RenderTemplate`. Product sections are server wrappers around client components. Those components read one client context, `EngineProductProvider`, which wraps project C's `useProductPage`; catalog sections wrap project C's filter components and `useCatalogData`. Project C's files are not edited. The editor's fixed `'home'` becomes a template key in state. Bridge messages carry that key. The preview iframe opens the route for the template being edited.

**Tech Stack:** Next.js 14 app router, React 18, TypeScript, Jest + ts-jest (node env, `.ts` tests only), Playwright (`e2e/store-studio2.spec.ts`, local only).

**Spec:** `docs/superpowers/specs/2026-10-29-store-theme-engine-studio2-design.md` (M3 = §8 item 3; catalog §3; custom pages §4; routes and SEO §5). Earlier plans: `2026-10-30-store-engine-m1-core.md`, `2026-10-30-store-engine-m2-studio2-editor.md`. Carry-over list: `2026-10-30-store-engine-m2-carryover.md`.

## Decisions beyond the spec

These were decided while planning. Hold the code to them; do not re-open them.

- **D14 Routes.**
  - Engine pages: `/products/[id]` (product), `/catalog` and `/catalog/[category]` (catalog; `[category]` is the category uuid), `/pages/[handle]` (custom page).
  - On an engine store, a home URL carrying `cat` or `q` redirects to the catalog: `/?cat=X&q=Y` → `/catalog/X?q=Y`. Preview params (`preview_theme`, `pt`, `editor`) are kept. This replaces M1's capped "all products" grid as the place to browse, and closes the M1 rollout gate on the 24-product cap.
  - On a store without the engine, `/catalog[/X]` redirects to `/` with `cat=X` and the rest of the query. A shared catalog link therefore never 404s.
- **D15 An empty product or catalog template renders the classic page.** This happens when the template has no enabled sections; themes made before M3 have both templates empty. In the editor, an empty Product or Catalog template shows "Use the default layout", which fills it from `defaultTemplate(key)`. Custom pages have no classic page: an empty one renders the header, an empty main and the footer.
- **D16 Product data stays client-loaded.** `EngineProductProvider` calls project C's `useProductPage(subdomain, productId)`: product, related, recently viewed. SEO stays in the existing `app/store/products/[id]/layout.tsx` `generateMetadata`. The provider renders `ProductJsonLd`, using the same `productJsonLd(...)` call as today's page.
- **D17 One "Product information" section, `main-product`: gallery plus info blocks.** The spec lists "product gallery" and "product info" separately. Two stacked sections cannot sit side by side, so the gallery is part of `main-product` (setting `gallery_position: left|right`), as in Shopify.
  - Blocks: `title`, `price`, `variant_picker`, `buy_buttons`, `description`, `collapsible_tab`, `delivery_estimate`, `share`, `custom_text`.
  - The spec's `quantity` block is folded into `buy_buttons`: the stepper replaces "Add to cart" once the item is in the cart, as project C does.
  - Blocks are rendered by engine components built from project C's exports: `VariantPicker`, `ProductInfoTabs`, and the `product-view.ts` helpers `findVariant`, `productOffer` and `toVariantInputs`. `StoreStars` comes from `components/store/StoreStars`.
- **D18 Promo tiles are blocks of `main-catalog`** (`promo`, max 3). Each is placed after product N of the grid, not as its own section.
- **D19 Newsletter** posts to the existing `POST /api/public/store/[subdomain]/enquiries` with topic `newsletter` and the email. If the enquiry validator restricts topics, `newsletter` is added to its list.
- **D20 Preview product.** On the Product template the top bar shows a product picker: M2's `ProductPicker`, unused until now (ruling R8). It defaults to the first result of `searchItems('')`. The choice lives in editor state, not in the theme.
- **D21 Template-aware bridge (carry-over M5).**
  - `ready`, `select` and `add-at` carry `template: string`. The editor drops any message whose template is not the one it is editing.
  - `add-at` carries `after: string | null`, the id of the section before the "+" (carry-over M4). The editor resolves the index against its own current order, not the server's.
- **D22 Custom page management.**
  - The New page modal has a title (1–100 chars), a handle (slugified from the title and editable before creation) and a starter: Blank, About, Sale or Contact info.
  - The handle cannot be changed after creation.
  - The Page settings panel shows when a page template is open and nothing is selected. It has title, SEO title, SEO description and "Delete page".
  - Caps match `sanitizePageTemplate`: title 100, seo_title 120, seo_description its existing cap.
- **D23 Collection list** = merchant-chosen categories with their own image and title (blocks `collection`: `category`, `image`, `title`). Categories have no images yet; Category grid stays as the automatic list.
- **D24 Store APIs accept the engine preview (extends M2's D10).** These routes resolve an unlaunched store when the request carries a verified `preview_theme` + `pt` for that store and the theme still exists, the same rule as `resolveOfflineStoreForPreview`:
  - `GET /api/public/store/[subdomain]/items`
  - `/items/facets`
  - `/items/[id]`
  - `/items/[id]/related`
  - `/items/[id]/reviews`

  `withStoreDraft()` (`lib/store/store-context.tsx`) also appends those params through the existing `withEnginePreview()`. Project C's hooks therefore pick them up without being edited.
- **D25 Carry-over minors fixed here:**
  - N1: the editor page treats "no user yet" as permissions still loading.
  - N3: the backup key gains the business: `kh-theme-unsaved:<businessId>:<themeId>`. The M6 sweep only removes keys of the current business. Old keys of the form `kh-theme-unsaved:<themeId>` are swept once on load.
  - Still parked: M2 (backup written per keystroke), N4 and N5. N2 goes to M5.

## Global Constraints

- **M1 and M2 constraints still apply:**
  - `kh_phase2_test` only.
  - Business, user and author come from the session.
  - `advanced_online_store` gate plus `settings` permission.
  - Limits: 25 sections per template, 50 blocks per section, 30 custom pages, 512 KB, 20 themes.
  - Ids match `/^[a-z0-9_-]{1,32}$/`.
  - Stage files by name; one commit per task on `main`; message trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
  - Never push, stash, reset or clean; never stage another session's hunks.
- **Page handles:** `/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/`. Reserved: `cart, checkout, account, products, catalog, pages, api, khata, wishlist, about, contact, privacy, refund, terms`. Template key is `page.<handle>`.
- **Client bundle:**
  - Editor code (`lib/store/engine/editor/*`, `components/store/studio2/*`) may import only:
    - `lib/store/engine/{types,schema-types,registry,shared,theme-settings-schema,preview-path,links}.ts`;
    - `lib/store/engine/sections/*`;
    - `lib/store/engine/presets/templates.ts` (new, client-safe);
    - the M2 exceptions: `lib/store/subdomain.ts`, `lib/store/studio-sections.ts`, `lib/store/store-theme.ts`.
  - Never `settings.ts`, `sanitize.ts`, `html.ts`, `color-schemes.ts`, `themes-repo.ts`, `presets/{index,shared,studio,blank}.ts` or `@/lib/db`.
- **Storefront client components** under `components/store/engine/product/*` and `components/store/engine/catalog/*` follow the same rule; they may also import project C's public modules and `@/lib/store/store-context`.
- **Section errors:** shoppers see nothing; the editor shows the D8 red card. An unknown section type is skipped.
- **No migration in M3.**
- **Dev servers:**
  - Never start a second `next dev` in this folder. Use the `khatario-hub-testdb-3015` launch config (port 3015, test DB).
  - A cold compile of a new route can abort the first client-side navigation to it. Before an e2e run, warm each route once with a direct `page.goto`.
- **Hands off:** project C's files (`components/store/features/**`, `components/store/product/*`) and the old Studio (`components/store/admin/theme-studio/*`, `app/(app)/settings/online-store/studio/*`).

## Review Focus

1. **A product is deleted, hidden or out of stock while its page is open, or the URL has a bad id.** The engine product page shows "Product not found." in the main area, with header and footer intact, and no section throws. Out of stock shows "Out of stock" on the buy button. Test: Task 3 `main-product renders not-found and sold-out states` (pure `buyButtonState`) and Task 11 e2e `unknown product id`.
2. **An unlaunched store is previewed on the product or catalog template.** The store APIs answer only with a verified preview token for that store and an existing theme. A token for another business or for a deleted theme gets 404. Test: Task 2 DB `store API preview access`.
3. **A custom page handle collides.** The modal refuses, inline, a handle that is reserved, already used in the theme, invalid, or past the 30-page cap. A hand-crafted PUT with such a key is dropped by `sanitizeThemeData`, and `/pages/<handle>` 404s for it. Test: Task 9 `addPage refuses reserved, taken, invalid and over-cap` and Task 6 `unknown handle 404s`.
4. **The merchant switches template while a save or a preview message is in flight.** A late `select` or `add-at` from the old frame is dropped (template mismatch). A "+" during an in-flight save inserts after the section it was drawn under. Test: Task 8 `drops messages for another template` and `add-at resolves by neighbour id`.
5. **Old links.** A `/?cat=<id>` link from M1, WhatsApp or the footer opens the catalog on an engine store and the classic home on a non-engine store; `/catalog/<id>` on a non-engine store opens `/?cat=<id>`. Test: Task 5 `catalogRedirect` cases.

## File Structure

```
lib/store/engine/
  shared.ts            + PAGE_HANDLE_RE, RESERVED_PAGE_HANDLES (moved from sanitize.ts, re-exported there), pageKey(), pageHandle(), CORE_TEMPLATES
  page-loader.ts       loadEnginePage(); home-page.ts becomes a wrapper
  preview-path.ts      client-safe previewPath(), isPreviewPath()
  preview-access.ts    storeForPublicApi() (D24)
  links.ts             + engineCatalogHref(), catalogRedirect()
  presets/templates.ts client-safe defaultTemplate('product'|'catalog'), PAGE_STARTERS
  sections/            + main-product, related-products, recently-viewed, product-reviews,
                         catalog-banner, main-catalog, collection-list, logo-list, video, faq,
                         newsletter, countdown, spacer
  editor/ops.ts        + addPage, removePage, setPageMeta, fillTemplate
  editor/tree.ts       + templateTitle(), templateOptions()
  editor/bridge.ts     template on ready/select/add-at; add-at.after
components/store/engine/
  product/EngineProductContext.tsx   client provider + useEngineProduct()
  product/ProductBlocks.tsx          client block renderers + buyButtonState() use
  product/product-blocks.ts          pure helpers (buyButtonState, shareText)
  catalog/MainCatalogView.tsx        client: filters, sort, chips, grid, load more, promo tiles
  catalog/promo-slots.ts             pure: interleavePromos()
  sections/*.tsx                     one server wrapper per new section type
  EngineCatalogPage.tsx              server: shared body of the two catalog routes
app/store/products/[id]/page.tsx     server: engine or classic
app/store/products/[id]/ClassicProductPage.tsx   today's client page, moved unchanged
app/store/catalog/page.tsx, app/store/catalog/[category]/page.tsx
app/store/pages/[handle]/page.tsx
components/store/studio2/            TopBar page switcher, NewPageModal.tsx, PageSettings.tsx, PreviewPane path
```

---

### Task 1: Page loader, page keys and preview paths

**Files:**
- Modify: `lib/store/engine/shared.ts`, `lib/store/engine/sanitize.ts` (import and re-export the moved constants), `lib/store/engine/home-page.ts`, `app/api/settings/online-store/themes/[id]/preview-link/route.ts`, `components/store/studio2/api.ts`
- Create: `lib/store/engine/page-loader.ts`, `lib/store/engine/preview-path.ts`
- Test: `tests/lib/store/engine/page-keys.test.ts`, `tests/lib/store/engine/preview-path.test.ts`, `tests/db/store-themes-api.db.test.ts` (extend)

**Interfaces:**
- Produces:
  - `shared.ts`: `PAGE_HANDLE_RE`, `RESERVED_PAGE_HANDLES: readonly string[]`, `CORE_TEMPLATES = ['home','product','catalog'] as const`, `pageKey(handle: string): string` (`'page.'+handle`), `pageHandle(key: string): string | null` (null unless a valid, non-reserved `page.` key).
  - `page-loader.ts`: `interface EnginePage { theme: ThemeRow; preview: boolean; editor: boolean; template: PageTemplate | null; data: Record<string, SectionData> }` and `loadEnginePage(store: StoreBusinessContext, searchParams: HomeSearchParams, templateKey: string, narrow?: { categoryId?: string | null; search?: string | null }): Promise<EnginePage | null>`. It has the same failure contract as `loadEngineHome`: any error returns null, and a missing migration is logged once. `template` is null when the key is absent from the theme. `data` covers header, template and footer.
  - `loadEngineHome(store, searchParams)` keeps its signature, delegating with `cat`/`q` narrowing.
  - `preview-path.ts` (no imports beyond `shared.ts`):
    - `previewPath(templateKey: string, opts?: { productId?: string | null }): string | null` maps `'home'`→`/`, `'product'`→`/products/<id>` (null without a uuid), `'catalog'`→`/catalog`, `'page.<h>'`→`/pages/<h>`, and anything else to null.
    - `isPreviewPath(path: string): boolean` accepts exactly those shapes.
  - The preview-link POST accepts optional `path` (default `/`); a path failing `isPreviewPath` → 400 `{error:'Invalid preview path'}`. The URL becomes `${origin}${path}?preview_theme=…&pt=…`.
  - `api.ts`: `previewLink(businessId, id, kind, path = '/')`.

- [ ] **Step 1: Write failing tests.**
  - `page-keys.test.ts`:
    - `pageHandle('page.about-us') === 'about-us'`;
    - `pageHandle('page.cart') === null`, `pageHandle('page.-x') === null`, `pageHandle('home') === null`;
    - `pageKey('sale') === 'page.sale'`;
    - `sanitize.ts` still exports `PAGE_HANDLE_RE` (the same object as `shared.ts`'s).
  - `preview-path.test.ts`:
    - `previewPath('product')` → null;
    - `previewPath('product', {productId: '4b49ddef-59bc-4ec3-94c0-65f615ce32a3'})` → `/products/4b49ddef-…`;
    - `previewPath('page.sale')` → `/pages/sale`;
    - `previewPath('page.cart')` → null;
    - `isPreviewPath` rejects `//evil.com`, `/products/x`, `/pages/Cart`, `/catalog/../api`;
    - `isPreviewPath` accepts `/catalog/<uuid>`.
  - DB test `preview link honours path`:
    - `path: '/catalog'` → url pathname `/catalog`;
    - `path: 'https://evil.com'` → 400.
- [ ] **Step 2:** Run `npx jest tests/lib/store/engine/page-keys.test.ts tests/lib/store/engine/preview-path.test.ts`: FAIL.
- [ ] **Step 3:** Implement as above. `home-page.ts` keeps exporting `EngineHome` as an alias of `EnginePage`.
- [ ] **Step 4:** Run the two unit files, `npx jest tests/lib/store`, and the DB suite via the workspace's `with-test-db.js`: PASS. Then `npx tsc --noEmit`: clean.
- [ ] **Step 5:** Commit: "Engine pages load through one page loader, page handles live in the client-safe shared module, and preview links can open a product, catalog or custom page path."

### Task 2: Store APIs accept a verified engine preview (D24)

**Files:**
- Create: `lib/store/engine/preview-access.ts`
- Modify:
  - `app/api/public/store/[subdomain]/items/route.ts`, `items/facets/route.ts`, `items/[id]/route.ts`, `items/[id]/related/route.ts`, `items/[id]/reviews/route.ts`;
  - `lib/store/store-context.tsx` (`withStoreDraft` also applies `withEnginePreview`).
- Test: `tests/db/store-engine-preview-api.db.test.ts`

**Interfaces:**
- Produces: `storeForPublicApi(subdomain: string, sp: URLSearchParams): Promise<StoreBusinessContext | null>`.
  - It resolves online stores as today, and keeps today's `td` behaviour.
  - Otherwise it resolves with `allowOffline: true` only when `preview_theme` + `pt` verify for that store and `getTheme(store.business_id, preview_theme)` exists. Reuse `resolveOfflineStoreForPreview` from `lib/store/preview-store.ts` rather than re-implementing the check.

- [ ] **Step 1:** Failing DB test `store API preview access`. Set the test store offline inside the test and restore it in `afterAll`. Then:
  - a valid token for its theme → 200 with items;
  - a token signed for another business → 404;
  - a token for a deleted theme → 404;
  - no token → 404;
  - the `td` path is unchanged.
- [ ] **Step 2:** Run it: FAIL.
- [ ] **Step 3:** Implement, and switch each listed route's store resolution to `storeForPublicApi`.
- [ ] **Step 4:** Run the DB test and `npx jest tests/lib/store`: PASS.
- [ ] **Step 5:** Commit: "The storefront item, facet, related and review APIs answer for an unlaunched store only with a verified theme preview, so product and catalog previews work before launch."

### Task 3: Product template: provider, `main-product` and the route

**Files:**
- Create:
  - `lib/store/engine/sections/main-product.ts`;
  - `components/store/engine/product/{EngineProductContext.tsx,ProductBlocks.tsx,product-blocks.ts}`;
  - `components/store/engine/sections/MainProduct.tsx`.
- Modify:
  - `lib/store/engine/registry.ts`, `components/store/engine/registry.tsx`;
  - `components/store/engine/RenderTemplate.tsx` (optional `productId`);
  - move `app/store/products/[id]/page.tsx` → `ClassicProductPage.tsx` with `git mv`, then make it the default export of a component file; new server `page.tsx`.
- Test: `tests/lib/store/engine/product-blocks.test.ts`, `tests/lib/store/engine/section-schemas.test.ts` (extend if present, else create)

**Interfaces:**
- Consumes: `loadEnginePage` (Task 1); project C's `useProductPage`, `VariantPicker`, `ProductInfoTabs`, `ProductGallery`, `ProductJsonLd`, `product-view` helpers.
- Produces:
  - **Schema `main-product`:**
    - `templates: ['product']`, `limit: 1`, `category: 'Product page'`.
    - Settings: `gallery_position` select left|right (default left), `thumbs` select side|bottom (default side), `sticky_info` checkbox (default true).
    - Blocks, each limit 1 unless noted:
      - `title`: `show_brand` true, `show_meta` true, `show_rating` true;
      - `price`: `show_tax_note` true;
      - `variant_picker`;
      - `buy_buttons`: `show_wishlist` true;
      - `description`;
      - `collapsible_tab`, no limit: `heading` text 60, `content` richtext;
      - `delivery_estimate`: `text` text 80, default "Delivered in 1–2 days";
      - `share`: `label` text 30, default "Share";
      - `custom_text`, no limit: `text` richtext.
    - Preset blocks, in order: title, price, variant_picker, buy_buttons, description.
  - `EngineProductProvider({ subdomain, productId, children })` and `useEngineProduct()`. The hook returns `{ product, related, recent, loading, error, variantId, setVariantId, variant, offer, needsVariant, rating, setRated }`, with the same variant and rating state rules as today's page. Cart add uses `useStore().addToCart` with today's payload.
    - While loading: a spinner in the main area.
    - On error or no product: "Product not found." in the main area. Header and footer are untouched.
  - `buyButtonState(input: { canAdd: boolean; stock: number; needsVariant: boolean; variantChosen: boolean; inCart: boolean; quantity: number }): 'add' | 'stepper' | 'sold_out' | 'choose'`.
  - `RenderTemplate` takes `route?: EngineRoute`, where `interface EngineRoute { productId?: string; categoryId?: string; categoryName?: string }` is exported from `components/store/engine/registry.tsx`. It passes `route` to every section component as `EngineSectionProps.route`. When `route.productId` is set, it wraps the template group in `EngineProductProvider`.
  - **`app/store/products/[id]/page.tsx`** is a server component:
    - `currentStoreForPreview` with the offline rule from home: offline and not a preview → `notFound()`;
    - then `loadEnginePage(store, sp, 'product')`;
    - if the engine is on and the template has an enabled section → `RenderTemplate` with `route={{ productId: params.id }}`;
    - otherwise `<ClassicProductPage />`.

- [ ] **Step 1:** Failing tests.
  - `buyButtonState` covers each of the four outcomes: the in-cart stepper; sold out only once a variant is chosen; "choose" while a variant is needed.
  - Schema test: `getSectionSchema('main-product')` has `limit: 1`, `templates: ['product']`, and preset block types in that order.
  - `sanitizeThemeData` keeps a `main-product` in `templates.product` and drops it from `templates.home`.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement.
  - Blocks render in `block_order`, skipping disabled blocks.
  - Each block's root gets `data-eng-block="<blockId>"` (block anchors, M2 D2's promised follow-up; selection stays section-level).
  - Buttons use `--c-btn`/`--c-btn-text`, as M2 Queued C did.
- [ ] **Step 4:** Run `npx jest tests/lib/store`: PASS. Run `npx tsc --noEmit`: clean.
- [ ] **Step 5: Browser check on :3015.** Set up through a scratch script against `kh_phase2_test`: `store_engine` on for `ganesh`, and its working draft's product template set to the `main-product` preset. Then:
  - open `http://ganesh.localhost:3015/products/<id>` with a preview link: gallery left, info right, add to cart works;
  - turn the engine off and the same URL shows the classic page;
  - restore the theme and the flag.
- [ ] **Step 6:** Commit: "Engine stores render the product page from a Product information section whose blocks (title, price, options, buy buttons, description, tabs, delivery, share, text) the merchant arranges; the classic page stays for stores without it."

### Task 4: Product page sections around the main one

**Files:**
- Create: `lib/store/engine/sections/{related-products,recently-viewed,product-reviews}.ts`, `components/store/engine/sections/{RelatedProducts,RecentlyViewed,ProductReviews}.tsx`, `lib/store/engine/presets/templates.ts`
- Modify: registries, `lib/store/engine/presets/{studio,blank}.ts` (use `defaultTemplate('product')`)
- Test: `tests/lib/store/engine/preset-templates.test.ts`

**Interfaces:**
- Produces:
  - **Schemas** (`category: 'Product page'`, `templates: ['product']`):
    - `related-products`: `heading` default "You may also like", `limit` range 2–8 default 8;
    - `recently-viewed`: `heading` default "Recently viewed";
    - `product-reviews`: limit 1, `heading` default "Reviews".
  - These sections render nothing outside an `EngineProductProvider`, or when their list is empty. In editor mode, an empty one shows a muted placeholder line, "Shows once shoppers have …", so it can still be selected.
  - `product-reviews` passes `onRated` to `setRated`.
  - `presets/templates.ts`, client-safe (imports `types` and `shared` only):
    - `defaultTemplate(kind: 'product' | 'catalog'): Template`, built with fresh `newId` ids. Product: `main-product` (preset blocks), `product-reviews`, `related-products`, `recently-viewed`. Catalog: see Task 5; it is added there.
    - `PAGE_STARTERS: Record<'blank' | 'about' | 'sale' | 'contact', { label: string; build: () => Template }>`. They use only home or page sections that exist after Task 7:
      - About: `image-with-text` plus `rich-text`;
      - Sale: `image-banner` plus `product-rail` source discounted;
      - Contact: `rich-text` plus `faq`.
      - Until Task 7 lands, Contact uses only `rich-text`; Task 7 adds `faq`.

- [ ] **Step 1:** Failing tests:
  - every template returned by `defaultTemplate('product')` and every `PAGE_STARTERS[k].build()` survives `sanitizeThemeData` unchanged in section count;
  - two calls produce different ids;
  - the Studio preset's `templates.product.order` is non-empty.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx jest tests/lib/store` and `npx tsc --noEmit`: PASS.
- [ ] **Step 5:** Browser check as in Task 3, with the preset product template: reviews, related and recent rails render.
- [ ] **Step 6:** Commit: "Product pages get Reviews, Related products and Recently viewed sections, and new themes start with a complete product page."

### Task 5: Catalog template, routes and links

**Files:**
- Create:
  - `lib/store/engine/sections/{catalog-banner,main-catalog}.ts`;
  - `components/store/engine/sections/{CatalogBanner,MainCatalog}.tsx`;
  - `components/store/engine/catalog/{MainCatalogView.tsx,promo-slots.ts}`;
  - `components/store/engine/EngineCatalogPage.tsx`;
  - `app/store/catalog/page.tsx`, `app/store/catalog/[category]/page.tsx`.
- Modify:
  - `lib/store/engine/links.ts`;
  - `app/store/page.tsx` (D14 redirect);
  - `components/store/engine/EngineViews.tsx` (search and category links);
  - category-grid and header components that link to the catalog;
  - `lib/store/engine/presets/templates.ts` (catalog default), `presets/studio.ts` (menu "All Products" → `/catalog`);
  - registries.
- Test: `tests/lib/store/engine/catalog-links.test.ts`, `tests/lib/store/engine/promo-slots.test.ts`

**Interfaces:**
- Produces:
  - **`catalog-banner`:**
    - `templates: ['catalog']`, limit 1, `category: 'Catalog'`.
    - Settings: `heading` text 80 default "All products" (on a category route, the category name replaces it unless `use_category_name` is off), `use_category_name` checkbox true, `text` textarea 300, `image` image, `height` select small|medium default small.
  - **`main-catalog`:**
    - `templates: ['catalog']`, limit 1, `category: 'Catalog'`.
    - Settings: `columns_desktop` range 2–5 default 4, `columns_mobile` range 1–3 default 2, `show_filters` true, `show_sort` true.
    - Blocks: `promo` (max 3) with `image`, `heading` 60, `text` 120, `link` url, `position` range 1–40 default 6.
  - `MainCatalogView({ categoryId, settings, promos })` (client):
    - uses project C's `useCatalogFilters`, `useCatalogData`, `CatalogFilterPanel`, `CatalogSortSelect`, `ActiveFilterChips` and `StoreProductCard`;
    - a locked `categoryId` from the route is forced into the API params and its category facet is hidden;
    - "Load more" calls `loadMore`;
    - the empty result says "No products match these filters.".
  - `interleavePromos<T>(items: T[], promos: { position: number }[]): Array<{ kind: 'item'; item: T } | { kind: 'promo'; index: number }>`. A promo goes after item `position`. Positions past the end are dropped; two promos at one position keep block order.
  - `engineCatalogHref(currentSearch: string, next: { categoryId?: string | null; q?: string | null }): string` returns `/catalog[/<id>]?q=…`, keeping preview params (and `editor` only with a preview) as `catalogHref` does.
  - `catalogRedirect(engine: boolean, path: string, search: string): string | null`:
    - engine home with `cat`/`q` → the `engineCatalogHref` URL;
    - non-engine `/catalog[/<id>]` → `/` plus `cat=<id>` plus the rest of the query;
    - else null.
  - `EngineCatalogPage({ searchParams, categoryId })` (server), the body of both routes:
    - offline rule as home;
    - not engine, or empty catalog template → `redirect(catalogRedirect(false, …))`;
    - an unknown or malformed category → `notFound()`;
    - else `RenderTemplate templateKey="catalog" route={{ categoryId, categoryName }}`. The name is looked up with the store's category query, scoped to the business.
  - Both catalog routes export `generateMetadata`: title `<category name> | <store name>` or `All products | <store name>`.
  - The engine `Header` section's search uses project C's `HeaderSearch` (with `SearchSuggest`) when `show_search` is on. Submitting goes to `engineCatalogHref(…, { q })`; a suggestion opens its product. This is spec §9's "search suggestions inside the header section".
  - Editor `linkOptions` (`lib/store/engine/editor/fields.ts`): "All products" becomes `/catalog`, and categories become `/catalog/<id>`. `linkChoice` still recognises the old `/?cat=` forms as custom links.

- [ ] **Step 1: Failing tests.**
  - `catalog-links.test.ts`:
    - `engineCatalogHref('?preview_theme=T&pt=P&editor=1&utm=x', {categoryId: C, q: 'rice'})` === `/catalog/C?preview_theme=T&pt=P&editor=1&q=rice`;
    - `catalogRedirect(true, '/', '?cat=C')` === `/catalog/C`;
    - `catalogRedirect(false, '/catalog/C', '?q=a')` === `/?q=a&cat=C`;
    - `catalogRedirect(true, '/', '')` === null.
  - `promo-slots.test.ts`: position 2 of 3 items → item, item, promo, item; position 9 of 3 → dropped.
  - Schema test: both catalog sections have limit 1 and `templates: ['catalog']`.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx jest tests/lib/store` and `npx tsc --noEmit`: PASS.
- [ ] **Step 5: Browser check on :3015** with the default catalog template on ganesh:
  - `/catalog` lists more than 24 products with Load more;
  - `/catalog/<id>` is locked to that category;
  - filters and sort change the URL;
  - the header search lands on `/catalog?q=`;
  - `/?cat=<id>` redirects;
  - with the engine off, `/catalog` lands on the classic home.
  - Restore afterwards.
- [ ] **Step 6:** Commit: "Engine stores get a catalog page at /catalog and /catalog/<category> built from a banner and a filterable product grid with promo tiles; home catalog links move there and old links keep working."

### Task 6: Custom pages on the storefront

**Files:**
- Create: `app/store/pages/[handle]/page.tsx`
- Modify: `lib/store/engine/page-loader.ts` if needed for metadata reuse
- Test: `tests/db/store-engine-load.db.test.ts` (extend)

**Interfaces:**
- Produces:
  - The route renders `RenderTemplate templateKey={pageKey(handle)}`.
  - `notFound()` when any of these hold:
    - `pageHandle(pageKey(handle))` is null;
    - the store has no engine theme;
    - the template is absent from the live theme (or from the verified preview theme).
  - `generateMetadata`: title `seo_title || title || store name`, description `seo_description`. The same lookup is used, `cache()`d, so the page and the metadata share one load.

- [ ] **Step 1:** Failing DB test `custom page loads by handle`:
  - `loadEnginePage(store, {}, 'page.sale')` returns the template;
  - `'page.missing'` returns `template: null`;
  - `'page.cart'` (reserved) returns `template: null` even when such a key is put into the theme JSON directly, because the sanitiser drops it.
- [ ] **Step 2:** Run: FAIL (or PASS for the loader parts; then the route is the remaining work).
- [ ] **Step 3:** Implement the route and metadata.
- [ ] **Step 4:** Run the DB suite and `npx tsc --noEmit`: PASS.
- [ ] **Step 5:** Browser check:
  - a page added to ganesh's working draft by script opens at `/pages/<handle>` with a preview link, with the right `<title>`;
  - `/pages/nope` → 404;
  - restore afterwards.
- [ ] **Step 6:** Commit: "Engine stores serve merchant custom pages at /pages/<handle> with their own title and SEO description, and 404 for pages the theme does not have."

### Task 7: Remaining home and page sections

**Files:**
- Create: `lib/store/engine/sections/{collection-list,logo-list,video,faq,newsletter,countdown,spacer}.ts` and matching `components/store/engine/sections/{CollectionList,LogoList,Video,Faq,Newsletter,Countdown,Spacer}.tsx`
- Modify: registries; the enquiry topic validator if it restricts topics (D19); `presets/templates.ts` (Contact starter adds `faq`)
- Test: `tests/lib/store/engine/section-schemas.test.ts` (extend), `tests/lib/store/engine/new-sections.test.ts`

**Interfaces:**
- Produces: schemas with `templates: ['home','page']`, except `spacer`, `faq` and `video`, which also allow `product` and `catalog`. Category in brackets:
  - `collection-list` (Products):
    - `heading` 80, `columns` range 2–6 default 4;
    - blocks `collection` (max 12): `category` category, `image` image, `title` text 40 (defaults to the category name);
    - `data`: categories.
  - `logo-list` (Social proof): `heading`; blocks `logo` (max 16): `image`, `link` url, `alt` text 60.
  - `video` (Media):
    - `video_url` video_url, `heading` 80, `cover_image` image;
    - renders a privacy-friendly embed: `youtube-nocookie.com/embed/<id>` or `player.vimeo.com/video/<id>`, via `videoEmbedUrl(url): string | null`, a new pure helper in `lib/store/engine/shared.ts`;
    - nothing renders when the url does not parse.
  - `faq` (Text): `heading`; blocks `question` (max 30): `question` text 160, `answer` richtext. Rendered as `<details>`.
  - `newsletter` (Text):
    - `heading` default "Get offers first", `text` 200, `button_label` default "Subscribe", `success_text` default "Thanks, you're on the list.";
    - submits `{ topic: 'newsletter', email, message: 'Newsletter signup', source_path: location.pathname }` to the enquiries API;
    - shows the API error text on failure.
  - `countdown` (Banners):
    - `heading`, `ends_at` text (ISO date-time; invalid → hidden), `link` url, `button_label`, `hide_when_over` true;
    - client tick every 1 s, using `countdownParts(endsAt: string, now: number): { days: number; hours: number; minutes: number; seconds: number } | null`, a pure helper in `components/store/engine/sections/countdown-logic.ts`.
  - `spacer` (Advanced): `height` range 0–160 step 8 default 48, `height_mobile` range 0–160 default 32.

- [ ] **Step 1: Failing tests.**
  - `videoEmbedUrl`:
    - `https://youtu.be/abc123def45` → `https://www.youtube-nocookie.com/embed/abc123def45`;
    - `https://vimeo.com/123` → `https://player.vimeo.com/video/123`;
    - `https://evil.com/x` → null.
  - `countdownParts`: one second after the end → null; 90061 s before → `{1,1,1,1}`; an invalid date → null.
  - Schema tests: each new type sanitises a preset round-trip; block maxima hold (a 13th collection is dropped).
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement. FAQ and newsletter must work without JavaScript as far as possible: `<details>`, and a real `<form>` whose submit is intercepted.
- [ ] **Step 4:** Run `npx jest tests/lib/store` and `npx tsc --noEmit`: PASS.
- [ ] **Step 5:** Browser check on :3015: add one of each to ganesh's working draft home by script and preview. A newsletter signup appears under Store enquiries. Restore afterwards.
- [ ] **Step 6:** Commit: "Seven more sections for home and custom pages: collection list, logo list, video, FAQ, newsletter signup (to store enquiries), countdown and spacer."

### Task 8: Studio 2 edits every template

**Files:**
- Modify:
  - `components/store/studio2/{Studio2Editor.tsx,TopBar.tsx,PreviewPane.tsx,SectionTree.tsx,SettingsPanel.tsx}`;
  - `lib/store/engine/editor/{bridge.ts,tree.ts,ops.ts}`;
  - `components/store/engine/EditorBridge.tsx`;
  - `app/(app)/settings/online-store/themes/[id]/editor/page.tsx` (N1);
  - `lib/store/engine/editor/save-queue.ts` (N3 key).
- Test: extend `tests/lib/store/engine/{editor-bridge,editor-tree,editor-ops,editor-save-queue}.test.ts`

**Interfaces:**
- Consumes: `previewPath` and `previewLink(…, path)` (Task 1); `defaultTemplate` (Task 4/5); `ProductPicker` and `searchItems`.
- Produces:
  - `Studio2Editor` holds `templateKey` state (default `'home'`). Switching:
    - clears the selection;
    - flushes the save queue;
    - asks for a new editor preview link with `previewPath(templateKey, { productId })`.
    - Undo history is shared across templates (it is whole-theme).
  - `templateOptions(theme): Array<{ key: string; label: string }>`: Home, Product, Catalog, then pages sorted by title, labelled with the title or the handle.
  - `templateTitle(theme, key): string` is used for the tree's template group heading.
  - `fillTemplate(theme, key: 'product' | 'catalog', template: Template): OpResult`. It returns `not_found` unless that template currently has zero sections. Fresh ids are generated against the whole theme (D12).
  - Bridge:
    - `PreviewToEditor` `ready`/`select`/`add-at` and `EditorToPreview` `select`/`scroll-to` carry `template: string` (≤ 80 chars, a core key or a valid page key);
    - `add-at` is `{ template, after: string | null }` and replaces `index`;
    - `resolveAddIndex(order: string[], after: string | null): number` gives 0 when `after` is null, after that id otherwise, and the end when the id is gone.
  - N1: `canEdit` is null while `!user` or permissions are loading.
  - N3: `backupKey(businessId: string, themeId: string)`; `sweepOtherBackups` removes only keys with this business's prefix, plus legacy keys (`kh-theme-unsaved:` followed directly by a uuid).
  - Product template: the top bar shows "Preview with:" `ProductPicker`. Its default is the first `searchItems('')` result. With no products, the preview area says "Add a product to preview the product page".

- [ ] **Step 1: Failing tests.**
  - The bridge parsers reject a missing template, a bad page key and an `index` field, and accept `{template:'page.sale', after:null}`.
  - `resolveAddIndex(['a','b'], 'a') === 1`, `(['a','b'], null) === 0`, `(['a'], 'gone') === 1`.
  - `templateOptions` lists pages after Catalog, sorted.
  - `fillTemplate` refuses a non-empty template.
  - `backupKey('b1','t1') === 'kh-theme-unsaved:b1:t1'`; the sweep keeps another business's keys.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement.
  - The editor ignores bridge messages whose `template` differs from its `templateKey`.
  - `EditorBridge` sends its `templateKey` and computes `after` from the section above each "+".
  - An empty Product or Catalog template shows a centred card in the tree area: "This page uses the classic layout." with a "Use the default layout" button, which applies `fillTemplate(…, defaultTemplate(key))` as one history entry.
- [ ] **Step 4:** Run `npx jest tests/lib/store` and `npx tsc --noEmit`: PASS.
- [ ] **Step 5:** Browser check on :3015:
  - switch Home → Product → Catalog, and the preview follows;
  - "Use the default layout" on Product fills the tree and the preview;
  - pick another preview product;
  - click a section in the product preview and it selects in the tree.
- [ ] **Step 6:** Commit: "Studio 2 edits the product and catalog pages too: a page switcher, a product to preview with, a default layout for empty pages, and preview messages tied to the page being edited."

### Task 9: Custom pages in Studio 2

**Files:**
- Create: `components/store/studio2/{NewPageModal.tsx,PageSettings.tsx}`
- Modify: `lib/store/engine/editor/ops.ts`, `components/store/studio2/{TopBar.tsx,Studio2Editor.tsx,SettingsPanel.tsx}`, `lib/store/engine/editor/fields.ts` (`linkOptions(categories, pages)`), `components/store/studio2/fields/pickers.tsx` (pass pages)
- Test: `tests/lib/store/engine/editor-pages.test.ts`

**Interfaces:**
- Produces:
  - `slugifyHandle(title: string): string`: lowercase, non-alphanumerics become `-`, trimmed to 50, leading and trailing `-` stripped.
  - `addPage(theme, { handle: string; title: string; starter: keyof typeof PAGE_STARTERS }, makeId?): OpResult`. New `OpError`s and their `OP_ERROR_TEXT`:
    - `page_limit`: "This theme already has 30 pages";
    - `handle_invalid`: "Use lowercase letters, numbers and hyphens";
    - `handle_reserved`: "That address is used by the store";
    - `handle_taken`: "Another page already uses this address".
  - `removePage(theme, key): OpResult`.
  - `setPageMeta(theme, key, patch: { title?: string; seo_title?: string; seo_description?: string }): OpResult`, clipped to the D22 caps.
  - The New page modal uses the starter `label`s. On create, it switches the editor to the new page.
  - "Delete page" confirms, then switches to Home. Undo restores the page.
  - `linkOptions(categories, pages: Array<{ handle: string; title: string }>)` adds `/pages/<handle>` choices after the categories.

- [ ] **Step 1: Failing tests:**
  - `addPage` refuses reserved (`cart`), taken, invalid (`-a`) and the 31st page;
  - `addPage` creates `templates['page.sale']` with the starter's sections and the title;
  - `removePage` deletes it;
  - `setPageMeta` clips `title` to 100;
  - `slugifyHandle('  Diwali Sale 2026! ') === 'diwali-sale-2026'`;
  - `linkOptions` includes `/pages/sale`.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx jest tests/lib/store` and `npx tsc --noEmit`: PASS.
- [ ] **Step 5:** Browser check on :3015:
  - create "Diwali Sale" from the Sale starter, edit its title and SEO, and publish;
  - `http://ganesh.localhost:3015/pages/diwali-sale` renders on the live store, with engine on;
  - delete it and undo.
  - Restore afterwards.
- [ ] **Step 6:** Commit: "Merchants can add custom pages in Studio 2 from Blank, About, Sale or Contact starters, edit their title and SEO, link to them from menus and buttons, and delete them."

### Task 10: Hide-list and wiring clean-up for M3 settings

**Files:**
- Modify: `lib/store/engine/theme-settings-schema.ts` (`EDITOR_HIDDEN_SETTINGS`), `components/store/engine/EngineShell.tsx` / `SectionFrame.tsx`, `components/store/engine/sections/Footer.tsx`
- Test: `tests/lib/store/engine/render-helpers.test.ts` (extend)

**Interfaces:**
- Produces: the three M2 D13 hidden settings are wired and removed from `EDITOR_HIDDEN_SETTINGS`, which ends empty:
  - COMMON `full_width`: the section root drops its max-width container, via `.eng-sec--full`. Add `sectionFrameClass(settings: Record<string, unknown>): string` to `lib/store/engine/render-helpers.ts`, returning `'eng-sec'` plus `' eng-sec--full'` when `full_width` is true, and use it in `SectionFrame`;
  - theme `card_style`: product cards in engine grids get `data-card="plain|bordered|shadow"`, styled in `THEME_RULES`;
  - footer `show_payment_icons`: UPI, Visa, Mastercard and RuPay as inline SVG or text badges.

- [ ] **Step 1:** Failing tests:
  - `sectionFrameClass({ full_width: true })` includes `eng-sec--full`;
  - `EDITOR_HIDDEN_SETTINGS` has no entries.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx jest tests/lib/store` and `npx tsc --noEmit`: PASS.
- [ ] **Step 5:** Browser check: toggle each setting in the editor and confirm the preview changes.
- [ ] **Step 6:** Commit: "Full width, card style and footer payment icons now take effect, so Studio 2 shows them again."

### Task 11: End-to-end coverage for every page

**Files:**
- Modify: `e2e/store-studio2.spec.ts`

**Interfaces:**
- Consumes: everything above. The spec's own snapshot and restore of ganesh's themes and `store_engine` is unchanged.

- [ ] **Step 1:** Add a `beforeAll` warm-up: one direct `page.goto` of the settings page, the editor URL, `/catalog` and a `/products/<id>` preview. This avoids the cold-compile navigation abort.
- [ ] **Step 2: Add scenarios.**
  - `product page`: switch to Product → "Use the default layout" → change the Delivery estimate block text → the preview shows it after autosave.
  - `catalog page`: switch to Catalog → default layout → set `columns_desktop` 3 → the preview grid has 3 columns at 1280 px.
  - `create custom page and open it`: New page "E2E Page" (Blank) → add Rich text "Hello e2e" → Publish → `/pages/e2e-page` on the store (engine on) shows "Hello e2e".
  - `unknown product id`: `/products/00000000-0000-0000-0000-000000000000` with engine on shows "Product not found." with the header present.
- [ ] **Step 3:** Run:

  ```
  STUDIO2_E2E=1 PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=http://localhost:3015 node <workspace>/with-test-db.js npx playwright test e2e/store-studio2.spec.ts --project=chromium
  ```

  Expected: all scenarios pass (7 existing plus 4 new), and ganesh's `store_engine` ends as it started.
- [ ] **Step 4:** Commit: "The Studio 2 end-to-end spec covers editing the product and catalog pages, creating and publishing a custom page, and a missing product."
- [ ] **Step 5:** Append the M3 entry to `docs/project.log.md`. Stage only that hunk: build the blob from `git show HEAD:docs/project.log.md` plus the new entry, then `git hash-object -w` and `git update-index --cacheinfo`. Another session's reorder is unstaged there. Commit: "Log store theme engine M3: every page."
