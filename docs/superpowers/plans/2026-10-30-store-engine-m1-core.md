# Store theme engine M1 (engine core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A store with `store_engine` switched on renders its home page from a live theme stored in `store_themes` (sections with blocks, global settings, colour schemes), created from the Studio or Blank preset through a theme API, with drafts previewable by signed token.

**Architecture:** Server-safe schemas in `lib/store/engine/` describe every section and setting; one generic sanitiser cleans whole themes from those schemas. `app/store/page.tsx` becomes a server component that loads the live (or previewed) theme, resolves every section's data in one pass, and renders header group → home template → footer group. In M1 the sections are thin client adapters over the existing Studio components (via pure mapping functions), so the Studio preset looks like today's Studio theme. No editor yet (M2): themes are created and changed through the API.

**Tech Stack:** Next.js 14 app router, PostgreSQL (`pg` via `@/lib/db`), TypeScript, `sanitize-html` (already a dependency), Jest + ts-jest (node env, `.ts` tests only).

**Spec:** `docs/superpowers/specs/2026-10-29-store-theme-engine-studio2-design.md` (M1 = section 8 item 1; data model section 2; schemas section 3; rendering section 5).

## Global Constraints

- Migrations run only against `kh_phase2_test`; DB tests use `PHASE2_TEST_DATABASE_URL` and skip without it (copy the header of `tests/db/quick-store.db.test.ts`, including the `hasFeatureAccess` mock).
- `business_id`, `updated_by`, `published_by` come from the session (`requireTenantPermission` / `requireTenantBusinessId`), never the request body.
- Every theme API route: `denyIfFeatureMissing(businessId, 'advanced_online_store')`; writes need `requireTenantPermission(request, body.business_id, 'settings', 'update')`, reads `requireTenantBusinessId`. Same shape as `app/api/settings/online-store/studio-draft/route.ts`.
- Limits (spec §2): 25 sections per template, 50 blocks per section, 30 custom pages, 512 KB (524288 bytes) serialised theme, 20 themes per business, keep newest 30 versions per business.
- Section/block ids match `/^[a-z0-9_-]{1,32}$/`.
- Custom HTML: max 20 KB; iframes only `https://www.youtube.com/embed/`, `https://www.youtube-nocookie.com/embed/`, `https://www.google.com/maps/embed`, with `sandbox="allow-scripts allow-same-origin allow-presentation"` and `loading="lazy"` forced.
- Colour scheme CSS variables: `--c-bg`, `--c-text`, `--c-accent`, `--c-btn`, `--c-btn-text`, `--c-border`, `--c-card`; scheme 1's accent also sets `--primary`.
- Preview tokens: HMAC-SHA256 with `JWT_SECRET || NEXTAUTH_SECRET` (as `lib/store/theme-draft.ts`), payload `{ b: businessId, t: themeId, exp }`; editor TTL 2 h, share TTL 7 days.
- Old rendering path is untouched when `store_engine` is false.
- Do not edit project C's files (`components/store/product/*`, reviews/filters/abandoned-cart files) or `app/api/public/store/[subdomain]/items/route.ts` (the shopping session may be editing it).
- Commit to main only when the user asks: each task's Commit step runs only if the user has authorised commits for this execution; otherwise skip it and Task 12 asks once. Stage files by name; append one `docs/project.log.md` entry for M1.
- Migration number: `450` (447 is Connect leads; 448/449 reserved by the shopping session). Re-check `ls database/migrations | tail` before creating it.

## Review Focus

1. **A theme saved by an older engine version contains a section type or setting that no longer exists** → it is dropped silently, the rest of the page renders. Test in Task 4 (`drops unknown section and block types`).
2. **Section listed in `order` but missing from `sections`, or present in `sections` but not in `order`** → missing ids are removed from `order`; orphan sections are deleted. Test in Task 4.
3. **Two browser tabs save the same theme** → the second save with a stale `updated_at` gets 409, nothing overwritten. Test in Task 6.
4. **Product rail whose category was deleted, or a store with no products** → the section renders nothing (no crash, no empty heading). Test in Task 8 (`returns empty items for unknown category`) and verified in Task 11.
5. **Preview token for another store's theme, or an expired token** → the store renders its normal live page, never the other theme. Test in Task 9.

## File Structure

```
lib/store/engine/
  types.ts            ThemeData, Template, Section, Block, ThemeSettings, ColorScheme, ThemeRow, TemplateKind
  schema-types.ts     SettingSchema, BlockSchema, SectionSchema, SectionDataRequest
  settings.ts         sanitizeSettingValue(), defaultSettings()
  html.ts             sanitizeCustomHtml()
  color-schemes.ts    DEFAULT_COLOR_SCHEMES, schemeCssVars(), sanitizeColorSchemes()
  registry.ts         SECTION_SCHEMAS, getSectionSchema(), sectionsForTemplate()
  sections/*.ts       one schema file per section type (14)
  sanitize.ts         ENGINE_LIMITS, sanitizeThemeData(), sanitizeSection(), newId()
  presets/studio.ts   studioPreset(ctx)
  presets/blank.ts    blankPreset(ctx)
  presets/index.ts    presetTheme(preset, ctx)
  themes-repo.ts      DB access: list/get/create/save/rename/delete/publish
  preview-token.ts    signThemePreview(), verifyThemePreview()
  section-data.ts     collectDataRequests(), resolveSectionData()
  studio-adapter.ts   pure mappers engine Section → StudioSettings (+ slides, usps, testimonials, links)
  load-theme.ts       loadEngineTheme()
lib/store/current-store.ts      cached currentStore() (moved out of app/store/layout.tsx)
lib/store/map-store-product.ts  + mapStoreItemRow()
database/migrations/450_store_themes.sql
app/api/settings/online-store/themes/route.ts                  GET list, POST create
app/api/settings/online-store/themes/[id]/route.ts             GET, PUT, PATCH, DELETE
app/api/settings/online-store/themes/[id]/publish/route.ts     POST
app/api/settings/online-store/themes/[id]/preview-link/route.ts POST
components/store/engine/
  RenderTemplate.tsx  server: groups + template, SectionFrame per section
  SectionFrame.tsx    client: id, data attrs, scheme vars, class, scoped CSS, error boundary
  EngineShell.tsx     client: store root classes, cart drawer, mobile nav, phone kit
  registry.tsx        type → component map
  sections/*.tsx      14 adapters
app/store/page.tsx    server: engine page or <StoreCatalogView />
```

---

### Task 1: Engine types and setting sanitiser

**Files:**
- Create: `lib/store/engine/types.ts`, `lib/store/engine/schema-types.ts`, `lib/store/engine/settings.ts`
- Test: `tests/lib/store/engine/settings.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  ```ts
  export type TemplateKind = 'home' | 'product' | 'catalog' | 'page' | 'header' | 'footer';
  export type ThemePreset = 'studio' | 'quick' | 'grocery' | 'khatario' | 'blank';
  export type ThemeRole = 'live' | 'draft';
  export interface Block { type: string; settings: Record<string, unknown>; disabled?: boolean }
  export interface Section { type: string; settings: Record<string, unknown>; blocks: Record<string, Block>; block_order: string[];
    disabled?: boolean; color_scheme?: string; css_class?: string; custom_css?: string }
  export interface Template { order: string[]; sections: Record<string, Section> }
  export interface PageTemplate extends Template { title?: string; seo_title?: string; seo_description?: string }
  export interface ColorScheme { id: string; name: string; background: string; text: string; accent: string; button: string; button_text: string; border: string; card: string }
  export interface ThemeSettings { color_schemes: ColorScheme[]; font_heading: string; font_body: string; button_radius: number;
    card_style: 'plain' | 'bordered' | 'shadow'; phone_kit: boolean; logo_url: string; favicon_url: string; custom_css: string;
    social: { instagram: string; whatsapp: string; facebook: string; youtube: string } }
  export interface ThemeData { settings: ThemeSettings; header_group: Template; footer_group: Template; templates: Record<string, PageTemplate> }
  export interface ThemeRow { id: string; business_id: string; name: string; role: ThemeRole; preset: ThemePreset; data: ThemeData; updated_at: string }
  ```
- Produces (`schema-types.ts`): `SettingType` (the 21 types in spec §3), `SettingSchema { id; type; label; default?; options?: {value: string; label: string}[]; min?; max?; step?; max_length?; info? }`, `BlockSchema { type; name; limit?; settings: SettingSchema[] }`, `SectionSchema` exactly as spec §3 (with `templates: TemplateKind[]`), `SectionDataRequest { products?: { source: 'all'|'featured'|'new'|'bestsellers'|'discounted'|'category'|'price_max'; categoryId?: string; priceMax?: number; limit: number }; categories?: boolean }`.
- Produces (`settings.ts`): `sanitizeSettingValue(schema: SettingSchema, raw: unknown): unknown` (returns `undefined` to mean "drop, use default"), `defaultSettings(schemas: SettingSchema[]): Record<string, unknown>`, `sanitizeSettings(schemas: SettingSchema[], raw: unknown): Record<string, unknown>` (unknown keys dropped, `header` type never stored).

- [ ] **Step 1: Write failing tests** in `tests/lib/store/engine/settings.test.ts`:
  - `text` clips to `max_length ?? 200`, trims, non-string → `undefined`.
  - `textarea` clips to `max_length ?? 2000`.
  - `richtext` keeps `<p><strong>x</strong></p>`, strips `<script>` and `onclick`, `<a href="javascript:x">` loses href; only tags p, strong, em, a, ul, ol, li, br, h2, h3, h4.
  - `number`/`range` clamp to `min`/`max`, round to `step` for range; `'abc'` → `undefined`.
  - `checkbox`: only `true`/`false` survive.
  - `select`/`radio`: value not in `options` → `undefined`.
  - `color`: accepts `#abc`, `#aabbcc`, `#aabbccdd`, `''`; rejects `red`, `url(x)`.
  - `image`: accepts `https://…` and `/uploads/…`; rejects every `data:` URL and `javascript:`.
  - `url`: accepts `/`, `/pages/sale`, `/products/<uuid>`, `https://x.y`, `#catalog`; rejects `javascript:alert(1)`, `//evil.com`.
  - `video_url`: only youtube.com/youtu.be/vimeo.com https URLs.
  - `product`/`category`: uuid only; `product_list`/`category_list`: array of uuids, deduped, max 50.
  - `icon`: one of `STUDIO_USP_ICONS` (import from `@/lib/store/studio-sections`).
  - `font`: one of `'inter' | 'nunito' | 'outfit' | 'fraunces' | 'playfair' | 'cormorant' | 'source-serif'`.
  - `html`: delegates to `sanitizeCustomHtml` (Task 2) — leave this case returning `''` for now and cover it in Task 2.
  - `sanitizeSettings` drops keys not in schemas and drops `header`-type ids; `defaultSettings` returns each schema's `default` (skips undefined).
- [ ] **Step 2: Run** `npx jest tests/lib/store/engine/settings.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** the three files. Richtext uses `sanitize-html` with the tag allow-list above, `allowedAttributes: { a: ['href', 'target', 'rel'] }`, `allowedSchemes: ['https', 'http', 'mailto', 'tel']`, max 5000 chars.
- [ ] **Step 4: Run** the test → PASS. `npx tsc --noEmit -p . 2>&1 | grep engine` → no output.
- [ ] **Step 5: Commit** (when the user has asked for commits) `lib/store/engine/{types,schema-types,settings}.ts tests/lib/store/engine/settings.test.ts`.

### Task 2: Custom HTML sanitiser and colour schemes

**Files:**
- Create: `lib/store/engine/html.ts`, `lib/store/engine/color-schemes.ts`
- Modify: `lib/store/engine/settings.ts` (`html` case → `sanitizeCustomHtml`)
- Test: `tests/lib/store/engine/html.test.ts`, `tests/lib/store/engine/color-schemes.test.ts`

**Interfaces:**
- Produces: `CUSTOM_HTML_MAX = 20000`; `sanitizeCustomHtml(dirty: unknown): string`.
- Produces: `DEFAULT_COLOR_SCHEMES: ColorScheme[]` (6 schemes: `scheme-1` Light, `scheme-2` Soft (tinted), `scheme-3` Dark, `scheme-4` Accent, `scheme-5` Cream, `scheme-6` Ink); `sanitizeColorSchemes(raw: unknown, accent?: string): ColorScheme[]` (1–6 entries, ids `scheme-1…scheme-6`, colours validated like the `color` setting, falls back per field to the default scheme; `accent` overrides scheme-1 accent and button when given); `schemeCssVars(scheme: ColorScheme, isPrimary: boolean): Record<string, string>`.

- [ ] **Step 1: Failing tests (html):** removes `<script>`, `<style>`, `onerror=`, `javascript:` hrefs, `<object>`, `<embed>`, `<form>`, `<input>`; keeps `div, span, p, h1-h6, img (https src), a, ul, ol, li, table, thead, tbody, tr, td, th, figure, figcaption, blockquote, strong, em, br, hr, section, iframe`; keeps `class` and `style` attributes but strips `style` values containing `url(` or `expression(`; iframe `src="https://www.youtube.com/embed/abc"` kept with `sandbox="allow-scripts allow-same-origin allow-presentation"` and `loading="lazy"`; iframe `src="https://evil.com"` removed entirely; input over 20000 chars is cut before sanitising; non-string → `''`.
- [ ] **Step 2: Failing tests (schemes):** `sanitizeColorSchemes(undefined)` equals `DEFAULT_COLOR_SCHEMES`; `sanitizeColorSchemes([{ id: 'scheme-1', background: 'red' }])[0].background === DEFAULT_COLOR_SCHEMES[0].background`; 8 entries in → 6 out; `accent: '#e11d48'` sets scheme-1 `accent` and `button`; `schemeCssVars(s, true)` has the 7 `--c-*` keys plus `--primary === s.accent`; with `false` no `--primary`.
- [ ] **Step 3: Run** both → FAIL.
- [ ] **Step 4: Implement.** `sanitize-html` with `allowedIframeHostnames: ['www.youtube.com', 'www.youtube-nocookie.com', 'www.google.com']` plus an `exclusiveFilter` that drops iframes whose src does not start with one of the three prefixes in Global Constraints; `transformTags.iframe` forces `sandbox` and `loading`.
- [ ] **Step 5: Run** all `tests/lib/store/engine` → PASS.
- [ ] **Step 6: Commit** the four files plus the two tests.

### Task 3: Section schemas and registry

**Files:**
- Create: `lib/store/engine/sections/{announcement,header,footer,slideshow,image-banner,image-with-text,rich-text,multicolumn,marquee,featured-products,product-rail,category-grid,testimonials,custom-html}.ts`, `lib/store/engine/registry.ts`
- Test: `tests/lib/store/engine/registry.test.ts`

**Interfaces:**
- Consumes: `SectionSchema`, `SettingSchema` (Task 1).
- Produces: `SECTION_SCHEMAS: Record<string, SectionSchema>`; `getSectionSchema(type: string): SectionSchema | null`; `sectionsForTemplate(kind: TemplateKind): SectionSchema[]`.
- Common settings every non-group section gets (append via a shared `COMMON_SETTINGS` array in `registry.ts`): `spacing_top` (range 0–96, step 4, default 32), `spacing_bottom` (same), `full_width` (checkbox, default false). Colour scheme, CSS class and custom CSS live on the `Section` object, not in settings.
- Per section (settings / blocks / templates / limit). Defaults copy today's Studio defaults from `lib/store/studio-layout.ts` so the Studio preset matches:
  - `announcement`: text, link(url), text_align(select left/center/right) / blocks none / `['header']`, limit 1.
  - `header`: logo_url(image), show_search(checkbox true), search_placeholder(text), delivery_eta(text, max 40), icons_position(select left/right), show_account, show_cart, show_cart_count / blocks `menu_link { label(text 40), link(url), highlight(checkbox) }` max 12 / `['header']`, limit 1.
  - `footer`: about(textarea), show_social(checkbox), show_payment_icons(checkbox), badge(checkbox true) / blocks `link_column { heading(text), links(textarea "Label|/url" per line) }` max 4 / `['footer']`, limit 1.
  - `slideshow`: autoplay(checkbox true), speed(range 3–10 s, default 5), height(select small/medium/large), layout(select full/image-text/text-image) / blocks `slide { image, heading, description(textarea), button_text, link(url) }` max 6 / `['home','page']`.
  - `image-banner`: image, heading, description, button_text, link, height, text_position(select left/center/right) / none / `['home','page','catalog']`.
  - `image-with-text`: image, heading, description(richtext), button_text, link, image_side(select left/right) / none / `['home','page','product']`.
  - `rich-text`: heading, content(richtext), align(select) / none / all except header/footer.
  - `multicolumn`: heading / blocks `column { icon, title(text 40), text(text 120) }` max 6 / `['home','page','product','catalog']`.
  - `marquee`: speed(range 10–60, default 30) / blocks `item { text(text 60) }` max 12 / `['home','page']`.
  - `featured-products`: heading, eyebrow, source(select of the 7 sources), category(category), price_max(number 1–999999), limit(range 2–24, default 8), columns(range 2–6, default 4), card_style(select), show_rating, show_badges / none / `['home','page','product','catalog']`; `data: (s) => ({ products: { source, categoryId, priceMax, limit } })`.
  - `product-rail`: same settings as featured-products minus `columns`; `data` same.
  - `category-grid`: heading, eyebrow, columns(range 3–8, default 4), style(select tiles/circles/cards), categories(category_list; empty = all) / none / `['home','page']`; `data: () => ({ categories: true })`.
  - `testimonials`: heading / blocks `quote { text(textarea 400), name(text 60), photo(image), rating(range 1–5) }` max 12 / `['home','page','product']`.
  - `custom-html`: html(html) / none / all except header/footer.
  - Every schema has at least one preset whose settings/blocks pass the sanitiser (asserted in Task 4).

- [ ] **Step 1: Failing tests:** 14 types registered; every `type` key equals its schema's `type`; no duplicate setting ids within a schema or block; every `default` passes `sanitizeSettingValue` unchanged; `sectionsForTemplate('header')` is `['announcement','header']`; `sectionsForTemplate('home')` includes `slideshow` and excludes `header`; `getSectionSchema('nope') === null`; `featured-products` `data({ source: 'bestsellers', limit: 8 })` returns `{ products: { source: 'bestsellers', limit: 8 } }`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** the 15 files plus the test.

### Task 4: Theme sanitiser with limits

**Files:**
- Create: `lib/store/engine/sanitize.ts`
- Test: `tests/lib/store/engine/sanitize.test.ts`

**Interfaces:**
- Consumes: registry (Task 3), `sanitizeSettings`, `sanitizeColorSchemes`, `scopeSectionCss`'s limits via `SECTION_CSS_MAX` and `sanitizeCssClass` from `@/lib/store/section-css`.
- Produces:
  ```ts
  export const ENGINE_LIMITS = { sectionsPerTemplate: 25, blocksPerSection: 50, customPages: 30, themeBytes: 524288, themesPerBusiness: 20, versionsKept: 30 };
  export const ID_RE = /^[a-z0-9_-]{1,32}$/;
  export function newId(prefix?: string): string;            // e.g. 'slideshow-k3j9x2'
  export function sanitizeSection(raw: unknown, kind: TemplateKind): Section | null;
  export function sanitizeTemplate(raw: unknown, kind: TemplateKind): Template;
  export function sanitizeThemeData(raw: unknown): ThemeData;   // never throws
  export function themeTooLarge(data: ThemeData): boolean;      // JSON byte length > themeBytes
  export const PAGE_HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;
  export const RESERVED_PAGE_HANDLES = ['cart','checkout','account','products','catalog','pages','api','khata','wishlist','about','contact','privacy','refund','terms'];
  ```
- Rules: section kept only when its type is registered **and** allowed for `kind` (custom pages use `'page'`); `limit` per template enforced in `order` sequence (later duplicates dropped); blocks filtered to the schema's block types and block `limit`, capped at `max_blocks ?? 50`; `order`/`block_order` keep only ids that exist and match `ID_RE`, deduped; sections/blocks not in their order are deleted; `color_scheme` must be an existing scheme id else removed; `css_class` through `sanitizeCssClass`; `custom_css` cut to `SECTION_CSS_MAX`; `templates` keys allowed: `home`, `product`, `catalog`, `page.<handle>` with `PAGE_HANDLE_RE` and not reserved, max 30 page templates; missing `home`/`product`/`catalog` become `{ order: [], sections: {} }`; theme settings: fonts via the `font` rule, `button_radius` 0–32, `card_style` enum, `phone_kit` boolean default true, `custom_css` max 8000, social values through the `url` rule.

- [ ] **Step 1: Failing tests:**
  - `drops unknown section and block types`.
  - `removes order ids without a section and sections not in order`.
  - `drops a header section placed in the home template`.
  - `keeps only one header (limit 1)`.
  - `caps sections at 25 and blocks at schema max_blocks`.
  - `rejects bad ids` (`'Bad Id!'` dropped).
  - `drops color_scheme that does not exist`.
  - `rejects reserved and malformed page handles, keeps page.diwali-sale with title`.
  - `fills missing templates`; `sanitizeThemeData('garbage')` returns a valid empty theme with `DEFAULT_COLOR_SCHEMES`.
  - `is idempotent`: `sanitizeThemeData(sanitizeThemeData(x))` deep-equals `sanitizeThemeData(x)` for a fixture with every section type.
  - `every schema preset survives sanitising unchanged` (build a section from each preset, sanitise, compare settings).
  - `themeTooLarge` true for a theme with a 600 KB rich text.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `sanitize.ts` and its test.

### Task 5: Studio and Blank presets

**Files:**
- Create: `lib/store/engine/presets/{studio,blank,index}.ts`
- Test: `tests/lib/store/engine/presets.test.ts`

**Interfaces:**
- Produces: `PresetContext { businessName: string; tagline: string; accent?: string; logoUrl?: string; heroUrl?: string }`; `presetTheme(preset: ThemePreset, ctx: PresetContext): ThemeData` (M1 supports `studio` and `blank`; `quick`/`grocery`/`khatario` return the studio preset until M4, with a comment saying so).
- `studioPreset(ctx)`: header group = announcement (text = ctx.tagline or '') + header (3 menu links: Shop `/#catalog`, Offers `/#offers`, Contact `/contact`); home = slideshow (1 slide: heading `Welcome to ${businessName}`, description = tagline, button `Shop now` → `#catalog`, image = heroUrl), category-grid, product-rail (source bestsellers, heading `Bestsellers`), multicolumn (the 4 `DEFAULT_USPS` from `components/store/studio-theme/StudioSections.tsx` copied as blocks — copy the values into the preset, do not import the component file), featured-products (source all, heading `All products`, limit 24), testimonials (no blocks); footer group = footer (badge true, 1 column "Help": Contact, Refund policy, Terms). Settings: `DEFAULT_COLOR_SCHEMES` with `ctx.accent`, fonts `outfit`/`inter`, `button_radius` 10, `card_style` `bordered`, `phone_kit` true.
- `blankPreset(ctx)`: header + footer only, empty home.

- [ ] **Step 1: Failing tests:** for both presets `sanitizeThemeData(p)` deep-equals `p`; studio home order types are `['slideshow','category-grid','product-rail','multicolumn','featured-products','testimonials']`; accent `#e11d48` appears as scheme-1 accent; all ids match `ID_RE` and are unique across the theme; two calls produce identical output for the same ctx (ids are deterministic, built from the section type, e.g. `slideshow`, `header`).
- [ ] **Step 2–4:** run → FAIL, implement, run → PASS.
- [ ] **Step 5: Commit.**

### Task 6: Tables and themes repository

**Files:**
- Create: `database/migrations/450_store_themes.sql`, `lib/store/engine/themes-repo.ts`
- Test: `tests/db/store-themes.db.test.ts`

**Interfaces:**
- Migration:
  ```sql
  CREATE TABLE IF NOT EXISTS store_themes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    name VARCHAR(60) NOT NULL,
    role VARCHAR(8) NOT NULL DEFAULT 'draft' CHECK (role IN ('live','draft')),
    preset VARCHAR(16) NOT NULL DEFAULT 'studio',
    data JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by UUID NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS store_themes_one_live ON store_themes (business_id) WHERE role = 'live';
  CREATE INDEX IF NOT EXISTS store_themes_business ON store_themes (business_id, updated_at DESC);
  CREATE TABLE IF NOT EXISTS store_theme_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    theme_id UUID NOT NULL REFERENCES store_themes(id) ON DELETE CASCADE,
    business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
    data JSONB NOT NULL,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_by UUID NULL
  );
  CREATE INDEX IF NOT EXISTS store_theme_versions_business ON store_theme_versions (business_id, published_at DESC);
  ALTER TABLE business_settings ADD COLUMN IF NOT EXISTS store_engine BOOLEAN NOT NULL DEFAULT false;
  ```
  Apply with `psql "$PHASE2_TEST_DATABASE_URL" -f database/migrations/450_store_themes.sql` only.
- `themes-repo.ts` (all take `businessId` first and filter by it):
  ```ts
  export type RepoResult<T> = { ok: true; value: T } | { ok: false; code: 'not_found' | 'conflict' | 'limit' | 'too_large' | 'live_locked' };
  listThemes(businessId): Promise<Omit<ThemeRow,'data'>[]>
  getTheme(businessId, id): Promise<ThemeRow | null>
  getLiveTheme(businessId): Promise<ThemeRow | null>
  createTheme(businessId, userId, input: { name: string; preset?: ThemePreset; duplicateOf?: string; ctx: PresetContext }): Promise<RepoResult<ThemeRow>>   // 'limit' at 20; duplicate copies data, name `Copy of …` when name empty; first theme of a business is created live
  saveTheme(businessId, userId, id, data: unknown, expectedUpdatedAt: string | null): Promise<RepoResult<ThemeRow>>  // sanitises; 'too_large'; 'conflict' when expectedUpdatedAt given and != row.updated_at; 'live_locked' when role = live
  renameTheme(businessId, id, name): Promise<RepoResult<ThemeRow>>     // name trimmed, 1–60 chars
  deleteTheme(businessId, id): Promise<RepoResult<true>>               // 'live_locked' for live
  publishTheme(businessId, userId, id): Promise<RepoResult<ThemeRow>>  // one transaction: current live → draft, this → live, insert version, delete versions beyond 30 for the business
  ```
  `updated_at` compared as ISO strings from `to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` so microseconds survive the round trip.

- [ ] **Step 1: Apply migration** to `kh_phase2_test`; `psql … -c "\d store_themes"` shows the table and `store_themes_one_live`.
- [ ] **Step 2: Failing DB tests:** first created theme is live, second is draft; `saveTheme` on live → `live_locked`; save draft with correct `updated_at` → ok and new `updated_at`; save again with the old `updated_at` → `conflict`; publish draft → it is live, old live is draft, one version row; 31 publishes leave 30 version rows; `getTheme(otherBusiness, id)` → null and `saveTheme(otherBusiness, …)` → `not_found`; 21st `createTheme` → `limit`; oversized data → `too_large`; duplicate copies data; delete live → `live_locked`, delete draft ok.
- [ ] **Step 3: Run** `npx jest tests/db/store-themes.db.test.ts` with `PHASE2_TEST_DATABASE_URL` set → FAIL. **Step 4: Implement.** **Step 5: Run** → PASS.
- [ ] **Step 6: Commit** migration, repo, test.

### Task 7: Preview token and theme API

**Files:**
- Create: `lib/store/engine/preview-token.ts`; the four route files listed in File Structure
- Test: `tests/lib/store/engine/preview-token.test.ts`, `tests/db/store-themes-api.db.test.ts`

**Interfaces:**
- Produces: `PREVIEW_TTL = { editor: 2 * 3600_000, share: 7 * 24 * 3600_000 }`; `signThemePreview(businessId: string, themeId: string, ttlMs: number, now = Date.now()): string` (`base64url(json).base64url(hmac)`); `verifyThemePreview(token: string | null | undefined, businessId: string, now = Date.now()): string | null` (theme id; constant-time compare).
- Routes (JSON; errors `{ error }`; repo codes map to status: not_found 404, conflict 409, limit 409, too_large 413, live_locked 409):
  - `GET /themes` → `{ themes }`; `POST /themes` body `{ name, preset?, duplicate_of? }` → 201 `{ theme }`. `ctx` built server-side from `businesses.name`, `business_settings.store_tagline`, `store_theme.accent`, `store_theme.logo_url`, `store_hero_image_url`.
  - `GET /themes/[id]` → `{ theme }`; `PUT` body `{ data, updated_at }` (raw body > 600000 bytes → 413 before parsing) → `{ theme }`; `PATCH` `{ name }`; `DELETE`.
  - `POST /themes/[id]/publish` → `{ theme }`.
  - `POST /themes/[id]/preview-link` body `{ kind: 'editor' | 'share' }` → `{ url, expires_at }` where `url = <proto>//<storePublicHostname(store_subdomain, appHostname)><:port only for .localhost>/?preview_theme=<id>&pt=<token>`, using `storePublicHostname` from `lib/store/subdomain.ts` with the request's hostname and protocol (same rule as `components/store/admin/StoreAppearanceStudio.tsx:111`).
- [ ] **Step 1: Failing unit tests (token):** round trip returns theme id; other business → null; expired → null; tampered body or sig → null; garbage → null.
- [ ] **Step 2: Failing DB API tests** (call route handlers with `NextRequest` as in `tests/db/quick-store.db.test.ts`; mock auth helpers to return the test business and a user id): POST creates live then draft; body `business_id` of another business is ignored (theme lands on the session business); PUT stale `updated_at` → 409; PUT live → 409; PUT 700 KB → 413; publish → 200 and roles swap; preview-link returns a URL whose `pt` verifies to the theme id; a user without settings update permission gets 403 on PUT.
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement.** **Step 5: Run** → PASS.
- [ ] **Step 6: Commit.**

### Task 8: Section data resolver

**Files:**
- Create: `lib/store/engine/section-data.ts`
- Modify: `lib/store/map-store-product.ts` (add `mapStoreItemRow`)
- Test: `tests/lib/store/engine/section-data.test.ts`, `tests/db/store-engine-data.db.test.ts`

**Interfaces:**
- Produces: `mapStoreItemRow(r: Record<string, unknown>): StoreItem` — the exact mapping in `app/api/public/store/[subdomain]/items/route.ts` lines 107–129 plus `brand: (r.brand as string) ?? null` (the shopping session adds `brand` to list rows). Move the `StoreItem` type next to it if it is local to the route. Leave both item routes unchanged: the shopping session owns them and will switch the list route to `mapStoreItemRow` itself.
- Produces: `SectionData = { products?: StoreItem[]; categories?: { id: string; name: string; item_count: number; image_url: string | null }[]; error?: string }`; `collectDataRequests(groups: Template[]): Map<string, SectionDataRequest>` (key = section id; skips disabled sections and types without `data`); `resolveSectionData(store: StoreBusinessContext, requests: Map<string, SectionDataRequest>, opts?: { branchId?: string | null; categoryId?: string | null; search?: string | null }): Promise<Record<string, SectionData>>`. `opts.categoryId` / `opts.search` narrow only `source: 'all'` requests (M1 stand-in for catalog pages: category tiles and header search land on `/?category=` / `/?search=`; M3 moves them to `/catalog`).
- Behaviour: identical product requests share one query; categories loaded once; each request wrapped in try/catch → `{ error: message }` for that section only; demo stores (`store.is_demo`) use `filterDemoCatalog`; source mapping: `featured`→`featuredOnly`, `discounted`→`discountedOnly`, `new`→`sort:'new'`, `bestsellers`→`sort:'bestsellers'`, `category`→`categoryId`, `price_max`→`maxPrice`, `all`→default; `category` source with no categoryId → `[]` without querying.
- [ ] **Step 1: Failing unit tests:** `collectDataRequests` skips disabled sections and sections without `data`; dedupe key equal for two rails with the same request.
- [ ] **Step 2: Failing DB tests:** `opts.categoryId` narrows an `all` request but not a `bestsellers` one; a business with 3 items (1 featured, 1 discounted) → bestsellers/featured/discounted/category requests return the right ids; `returns empty items for unknown category`; a forced SQL error for one section (pass a request with `limit: -1` that makes `buildStoreItemsQuery` throw, or mock `queryRows` to throw once) leaves other sections' data intact.
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement.** **Step 5: Run** → PASS.
- [ ] **Step 6: Commit.**

### Task 9: Theme loading for the storefront

**Files:**
- Create: `lib/store/engine/load-theme.ts`, `lib/store/current-store.ts`
- Modify: `app/store/layout.tsx` (import `currentStore` from the new file instead of the local `cache` helper)
- Test: `tests/db/store-engine-load.db.test.ts`

**Interfaces:**
- Produces: `currentStore: () => Promise<StoreBusinessContext | null>` (React `cache`, same body as today's layout helper).
- Produces: `loadEngineTheme(store: StoreBusinessContext, params: { preview_theme?: string | null; pt?: string | null }): Promise<{ theme: ThemeRow; preview: boolean } | null>`:
  - valid `pt` whose verified id equals `preview_theme` and belongs to `store.business_id` → that theme, `preview: true` (works even when `store_engine` is false, so drafts can be previewed before rollout);
  - else, when `business_settings.store_engine` is true → live theme, `preview: false`;
  - else `null`. Demo stores → `null` in M1.
  - Data is re-sanitised with `sanitizeThemeData` after loading.
- [ ] **Step 1: Failing DB tests:** flag off, no token → null; flag on → live theme; flag on, no live theme → null; valid token for a draft → draft with `preview: true`; token signed for another business's theme → falls back to live; expired token → live; token valid but `preview_theme` a different id → live.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npx tsc --noEmit` shows no new errors outside the known `app/(app)/pricing/party-item/page.tsx` ones.
- [ ] **Step 5: Commit.**

### Task 10: Studio adapters (pure mapping)

**Files:**
- Create: `lib/store/engine/studio-adapter.ts`
- Test: `tests/lib/store/engine/studio-adapter.test.ts`

**Interfaces:**
- Consumes: `StudioSettings`, `StudioSlide`, `StudioUsp` from `@/lib/store/studio-sections`.
- Produces (each takes the engine `Section` and returns what the matching Studio component expects):
  - `toStudioBox(section): Pick<StudioSettings,'spacingTop'|'spacingBottom'>` (from `spacing_top`/`spacing_bottom`).
  - `slideshowSettings(section): StudioSettings` — first enabled slide block fills `image/heading/description/buttonText/link`, the rest become `slides` (max 5), plus `autoplay`, `layout`, `height`.
  - `multicolumnSettings(section): StudioSettings` — `usps` from enabled `column` blocks.
  - `marqueeSettings(section): StudioSettings` — `text` joined from `item` blocks with ` • `, `speed`.
  - `testimonialItems(section): { text: string; name: string; photo: string; rating: number }[]`.
  - `headerNavLinks(section): { label: string; href: string; highlight: boolean }[]`.
  - `footerColumns(section): { heading: string; links: { label: string; href: string }[] }[]` — parses `Label|/url` lines, drops lines whose URL fails the `url` setting rule.
  - `productSectionSettings(section): StudioSettings` — maps `heading, eyebrow, limit, columns, card_style→cardStyle, show_rating→showRating, show_badges→showBadges, source`.
  - `bannerSettings(section)`, `imageWithTextSettings(section)`, `richTextSettings(section)`, `announcementSettings(section)`.
- [ ] **Step 1: Failing tests:** disabled blocks are skipped everywhere; block order respected; slideshow with 7 slides yields 1 main + 5 `slides`; footer line `Refund|/refund` parsed, `Bad|javascript:x` dropped; marquee text joined in order.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit.**

### Task 11: Renderer, section components and the home page switch

**Files:**
- Create: `components/store/engine/{RenderTemplate,SectionFrame,EngineShell,registry}.tsx`, `components/store/engine/sections/{Announcement,Header,Footer,Slideshow,ImageBanner,ImageWithText,RichText,Multicolumn,Marquee,ProductGrid,CategoryGrid,Testimonials,CustomHtml}.tsx` (`ProductGrid` serves both `featured-products` (grid) and `product-rail` (`isRow` carousel))
- Modify: `app/store/page.tsx`

**Interfaces:**
- `EngineSectionProps = { id: string; section: Section; data?: SectionData; store: StoreBusinessContext; theme: ThemeData }` — every section component takes this.
- `SECTION_COMPONENTS: Record<string, ComponentType<EngineSectionProps>>` in `components/store/engine/registry.tsx`.
- `RenderTemplate({ store, theme, templateKey, data, preview }: { store; theme: ThemeRow; templateKey: string; data: Record<string, SectionData>; preview: boolean })` — server component: `<EngineShell theme store preview>` wrapping header group, `<main>` with the template, footer group; skips disabled sections and unregistered types.
- `SectionFrame({ id, section, theme, children })` — client: `<section id={sectionDomId(id)} data-section-type data-section-id className={['eng-sec', section.css_class].join(' ')} style={schemeCssVars(...) + spacing}>`, scoped CSS via `scopeSectionCss(section.custom_css, id)` in a `<style>` tag, children inside a class-component error boundary that renders `null` on error and logs `console.error('[engine section]', type, error)`.
- `EngineShell` — client: root `<div className="st-root store-studio st-cq eng-root{phone_kit ? ' phone-kit' : ''}">` with theme-level `--c-*` vars of scheme-1, font variables, store-wide `custom_css` (`scopeSectionCss`-style prepare via `previewStoreCss(css, '.eng-root')`), `StoreCartDrawer`, `StoreMobileNav`; a "Preview" pill fixed bottom-left when `preview`.
- Section components wrap the Studio components with the Task 10 mappers: Announcement → `StudioAnnouncement live`; Header → `StudioHeader` (cart count/open from `useStore()`); Footer → `StudioFooter`; Slideshow → `StudioHero live`; ImageBanner → `StudioBanner`; ImageWithText → `StudioHero` with one slide and `layout` from `image_side`; RichText → `StudioRichText`; Multicolumn → `StudioUspStrip`; Marquee → `StudioMarquee`; ProductGrid → `StudioProductsSection` with `data.products` (renders `null` when the list is empty); CategoryGrid → `StudioCategoriesSection` with `data.categories` (renders `null` when empty; tile click navigates to `/?category=<id>`); Header search submits to `/?search=<q>`; the `source: 'all'` ProductGrid shows a "Showing <category or “q”> · Clear" chip when narrowed; Testimonials → `StudioTestimonials` (renders `null` with no blocks); CustomHtml → `<div dangerouslySetInnerHTML={{ __html: sanitizeCustomHtml(section.settings.html) }} />` (sanitised again at render).
- `app/store/page.tsx` (server, no `'use client'`): `const store = await currentStore()`; `const engine = store && await loadEngineTheme(store, { preview_theme: searchParams.preview_theme, pt: searchParams.pt })`; when `engine`: collect requests from header group, `templates.home`, footer group → `resolveSectionData(store, requests, { categoryId: searchParams.category, search: searchParams.search })` → `<RenderTemplate templateKey="home" …/>`; otherwise `<StoreCatalogView />` exactly as today. `export const dynamic = 'force-dynamic'`.

- [ ] **Step 1: Implement** the components and page switch (no unit tests: jest runs `.ts` in node with `jsx: preserve`; logic lives in Tasks 4, 8, 10 which are tested).
- [ ] **Step 2: Type check** `npx tsc --noEmit` → no new errors.
- [ ] **Step 3: Browser check on localhost** (test store `ganesh` in `kh_phase2_test`):
  1. With `store_engine` false, `http://ganesh.localhost:<port>/` looks exactly as before (screenshot).
  2. Create a theme through `POST /api/settings/online-store/themes` (`preset: 'studio'`) while signed in with the local test login from `.env`; set `UPDATE business_settings SET store_engine = true WHERE store_subdomain = 'ganesh'` on `kh_phase2_test`; reload: header, slideshow, categories, bestsellers rail, USPs, all products, footer render; add to cart opens the cart drawer; phone width (390 px) uses the phone kit.
  3. PUT a draft with a `custom-html` section containing `<script>alert(1)</script><p>Hi</p>` and an `<iframe src="https://evil.com">`; preview it via the preview-link URL: only `Hi` shows, no alert, no iframe.
  4. Click a category tile: URL becomes `/?category=<id>`, the All products grid shows only that category with a Clear chip; header search for an item name narrows the same grid.
  5. Add a `featured-products` section with `source: 'category'` and a deleted category id: page renders, section absent.
  6. Open the preview URL with the token of another store's theme: the live page shows.
  7. Console has no errors.
  Reset `store_engine` to false afterwards.
- [ ] **Step 4: Commit.**

### Task 12: Wrap-up

- [ ] **Step 1:** Run `npx jest tests/lib/store tests/db/store-themes.db.test.ts tests/db/store-themes-api.db.test.ts tests/db/store-engine-data.db.test.ts tests/db/store-engine-load.db.test.ts` with `PHASE2_TEST_DATABASE_URL` set → all pass (paste the summary line).
- [ ] **Step 2:** Append one entry to `docs/project.log.md`: what M1 adds, migration 450 (applied to `kh_phase2_test` only; must run on staging and production before deploying), that the old storefront is unchanged while `store_engine` is false, and that M2 (editor) is next.
- [ ] **Step 3:** Ask the user before committing; on yes, stage every file from Tasks 1–11 by name plus only this log entry (hash-object + `update-index --cacheinfo`, as in earlier commits).
