# Store theme engine M4 (Presets and migration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quick, Premium Grocery and Khatario become presets of the engine, each with its own look (a CSS layer scoped by a root class), and Studio's preset takes on Studio's real paper and type. `migrate.ts` turns any store's `business_settings.store_theme` into its first live engine theme, so a migrated store looks like it does today. A script runs the migration (test DB only), and a parity script screenshots old and new renderers side by side. `store_engine` stays off for every store.

**Architecture:**
- Sections stay preset-agnostic. A preset is data (`lib/store/engine/presets/<preset>.ts`) plus a CSS layer (`components/store/engine/presets/<preset>.css`).
- `EngineShell` puts `eng-preset-<preset>` on the root, so the layer restyles the shared Studio markup. Quick also gets the old `store-quick` class, because `quick-theme.css` already restyles Studio markup under it.
- Two new sections cover what Grocery and Khatario have and the engine lacks: `promo-cards` and `category-shelves`. Four small extensions cover the rest: category-grid emoji tiles and per-category images, a scrolling announcement, header category chips, and slides per device.
- `migrate.ts` is pure:
  - it reads the old theme through `sanitizeStoreTheme`, so it sees what the old storefront sees;
  - Studio and Quick go through `resolveStudioSections`, the exact list the old storefront renders;
  - Grocery and Khatario go through a mapping table that mirrors `StoreGroceryHome` and the Khatario branch of `StoreCatalogView`.
- A server runner wraps `migrate.ts` for the script. The same "first live theme" helper is used when the editor or the themes API needs a live theme and none exists yet.

**Tech Stack:** Next.js 14 app router, React 18, TypeScript, Postgres, Jest + ts-jest (node env, `.ts` tests only), Playwright (parity script only, never run by a task), ts-node (`tsconfig.worker.json`) for the two `.mjs` launchers.

**Spec:** `docs/superpowers/specs/2026-10-29-store-theme-engine-studio2-design.md`: M4 = §8 item 4; Presets in §3; Migration and rollout in §6; Testing in §7. Earlier plans: `2026-10-30-store-engine-m1-core.md`, `-m2-studio2-editor.md`, `-m3-every-page.md`. Carry-over lists: `2026-10-30-store-engine-m2-carryover.md`, `2026-10-30-store-engine-m3-carryover.md`.

## Decisions beyond the spec

These were decided while planning. Hold the code to them; do not re-open them.

- **D26 Preset look table.** `lib/store/engine/presets/look.ts` holds one row per preset:

  | preset | canvas (scheme 1 background) | default accent | heading / body font | button radius | card style |
  |---|---|---|---|---|---|
  | studio, blank | `#fbf8f3` | `#b94717` | outfit / inter | 10 | bordered |
  | quick | `#f3f5f7` | `#0f7a5c` | inter / inter | 14 | shadow |
  | grocery | `#f6f7f4` | `#176b45` | inter / inter | 24 | bordered |
  | khatario | `#f4f5f7` | `#00897b` | inter / inter | 12 | plain |

  - The canvases and accents are `PACK_CANVAS` and `STORE_THEME_PRESETS` from `lib/store/store-theme.ts`. Import them; do not copy the hex values.
  - `schemesFor(preset, accent, canvas)` builds the six schemes as hex. Scheme 1 is the page, the way the old pack painted it:
    - background = canvas;
    - text = `chowkInkOn(canvas)`;
    - accent = button = accent;
    - button_text = `chowkOnAccent(accent)`;
    - border = `mixHex(text, canvas, 0.12)`;
    - card = `#ffffff` on a light canvas, `mixHex('#ffffff', canvas, 0.06)` on a dark one.
  - Scheme 4 ("Accent") is rebuilt from the accent: background accent, text and button `chowkOnAccent(accent)`, button_text accent.
  - Grocery's scheme 6 becomes "Deep green": background `mixHex(accent, '#07140d', 0.30)`, text `#ffffffe0`, accent `#fbbf24`. Its marquee and footer use it.
  - Schemes 2, 3 and 5 keep `DEFAULT_COLOR_SCHEMES`.
  - **The Studio preset changes too:** its scheme 1 background moves from `#ffffff` to Studio's real paper `#fbf8f3`.
  - `PresetContext.accent` must be the store's *effective* accent, `sanitizeStoreTheme(raw).accent`. For a named old preset, the old storefront ignores the stored `accent` and uses the pack's. Today `presetContextFor` reads the raw `store_theme->>'accent'`, which is a bug that this plan fixes.
- **D27 One look per preset, through a scoped CSS layer.**
  - `EngineShell`'s root class list is built by `engineRootClass({ preset, kit, editor, dark })` in a new client-safe `lib/store/engine/root-class.ts`:

    ```
    st-root store-studio st-cq eng-root eng-preset-<preset>
      [store-quick when quick] [is-dark when scheme 1's background is dark] [phone-kit] [eng-editor]
    ```

    `dark` means luminance < 0.4, the same test as `storePackClass`.
  - Layers live in `components/store/engine/presets/{quick,grocery,khatario}.css` and are imported once by `EngineShell`. Every selector starts with `.st-root.eng-root.eng-preset-<preset>`. There is no `@import` and no `url(` in them.
  - Studio and Blank have no layer: `studio-theme.css` is the base.
  - Quick's layer is thin on purpose, because `quick-theme.css` (already bundled through `QuickChrome`) does the work under `.store-quick`.
  - Sections never branch on the preset. `EngineSectionProps` does not gain a preset.
- **D28 Old home features: map, extend or add.**

  | Old feature | Engine |
  |---|---|
  | Hero slides (Studio hero, Grocery hero card, Khatario carousel) | `slideshow`. Its `slide` block gains `device` (`both`/`mobile`/`desktop`, default `both`). The client picks slides with `pickSlidesForDevice` (same rule as `resolveHeroSlides`: the matching slides, else all). Grocery uses layout `image-text` with the grocery layer's gradient card. Khatario uses `full`. |
  | Categories: Studio tiles, Grocery emoji tiles, Khatario pills | `category-grid`. `style` gains `emoji`. New block `category_image` (`category`, `image`; max 40) replaces `store_theme.category_images`. The Khatario layer lays the grid out as a scrolling pill row. |
  | Grocery category chips under the header | `header` gains `show_category_chips` (default false). It requests categories only when on. |
  | Grocery marquee announcement | `announcement` gains `scrolling` (default false). Items are split with `marqueeItems` from `lib/store/grocery.ts`. |
  | Offers / Today's deals | `product-rail`, source `discounted`. |
  | Featured | `featured-products`, source `featured`, limit 6. |
  | Product shelves (discounted / under ₹N) | One `product-rail` per shelf (`discounted`, or `price_max` with `price_max`). |
  | Category shelves | **New `category-shelves`:** one rail per category with a "View all" link to its catalog. |
  | Overlay bands (Khatario image cards), Grocery promo cards, Khatario promo slides | **New `promo-cards`:** style `overlay` (image behind the caption) or `split` (copy plus image; the grocery layer makes even cards "deep"). |
  | Testimonials | `testimonials`, with `quote` blocks from `store_theme.testimonials`. |
  | Brand story | `rich-text`, heading "Our story". Text is escaped into `<p>` paragraphs. |
  | Khatario tagline line, popular products | `rich-text` (tagline), and `product-rail` source `all` limit 6 "Popular products". |
  | All products | `featured-products`, source `all`, limit 24. |

  - **Dropped, and listed as migration warnings when the old value was not the default:**
    - Grocery hero stats line and emoji illustration;
    - Khatario popular rail's "only products with an image" filter;
    - `mobile_columns` (except Quick, whose layer keeps 3 phone columns);
    - Studio per-section `background`/`textColor`, hero `eyebrow`/`benefits`/`align`/`overlay`;
    - header icon SVGs and a header logo text that differs from the store name;
    - product `imageRatio`.
  - The `trust` toggle renders nothing on Grocery and Khatario today. It is ignored there and is not a warning.
- **D29 Phone kit.**
  - The kit is on when `settings.phone_kit` is true, or always when the theme's preset is `quick`.
  - On Quick, `EngineShell` matches the old Quick shell:
    - `QuickTabs` replaces `StoreMobileNav`;
    - `QuickCartBar` is always mounted except on `/cart` and `/checkout` (it hides itself when the cart is empty);
    - `<main>` gets `qk-main` (`noBar` on cart/checkout).
  - `lockedThemeSettings(preset)` in `theme-settings-schema.ts` returns `{ phone_kit: 'Always on in the Quick theme' }` for quick and `{}` otherwise. Studio 2's theme settings form shows a locked setting checked and disabled, with that text as its info line.
- **D30 Deterministic preset ids.**
  - `presets/shared.ts` `template()` gives the first section of a type the type as its id, and repeats `-2`, `-3` and so on (two `product-rail`s become `product-rail` and `product-rail-2`).
  - Ids stay unique across header, templates and footer (D12). The existing Studio preset's ids do not change.
- **D31 `migrate.ts` contract.** `migrateStoreTheme(raw: unknown, ctx: MigrationContext): MigrationResult` is pure. No db, no clock, no randomness.
  - **Input.** It first runs `sanitizeStoreTheme(raw)`. Retired packs therefore land on Studio, named presets use their pack accent, and `homepage_sections` falls back to the `show_*` flags, exactly as on the storefront.
  - **Output.** `preset` = pack; `name` = `STORE_THEME_PRESETS[pack].label`; `data` such that `sanitizeThemeData(data)` deep-equals `data` and is under 512 KB.
  - **Templates.**
    - `home` comes from the mapping (Tasks 5 and 6).
    - `product` and `catalog` stay **empty**, so a migrated store keeps its classic product and catalog pages (D15) and its home `?cat` narrowing (R5). The merchant can apply "Use the default layout" later.
    - New themes from a preset still get the default product and catalog templates.
    - No custom pages.
  - **Snapshots.** Store name, tagline, about text, hero image and category names are copied in at migration time from `ctx`.
  - **Settings:**
    - colour schemes from `schemesFor(pack, accent, storeCanvas(t))`, so `appearance_mode` dim/dark carry over through the canvas;
    - fonts: `font_family` `system` → the pack's D26 fonts, else both heading and body = `font_family`;
    - `button_radius` and `card_style` from D26;
    - `phone_kit`: quick → true, else `t.phone_kit`;
    - `logo_url` and `favicon_url` only when the engine image rule keeps them (https or root-relative), else `''` plus a warning;
    - `custom_css` copied, with a warning when non-empty ("written for the old layout");
    - `social.instagram` / `social.whatsapp` from `instagram_url` / `whatsapp_url`.
  - **Announcement colours.** Custom `announcement_bg`/`announcement_fg` replace scheme 5, renamed "Announcement", and the announcement section uses it. Otherwise:
    - Khatario's announcement and header use scheme 4;
    - Grocery's announcement and footer use scheme 6.
  - **Images.** Any image the engine sanitiser would drop (inline `data:` images, `http:`) is left out, with one warning per field kind.
  - **Fields that stay in `store_theme`**, read by their own pages until M6: `contact_form`, `show_listing_add`, `sticky_buy_now`, `show_store_name`, `featured_item_id`, and the promo sheet. They are not migrated and not warned.
- **D32 Link conversion.** Studio's free-text nav and footer labels go through `studioLinkTarget(label, ctx.categories)`:

  | Target | Link |
  |---|---|
  | `products` | `/catalog` |
  | `offers` | `/catalog?disc=10` |
  | `category` | `/catalog/<id>` |
  | `href` | kept when the engine `url` rule accepts it, else dropped with a warning |

  `/catalog…` links are safe on a migrated store: with an empty catalog template they redirect to `/` (`catalogRedirect`). Hero and promo CTAs that used to scroll to the grid get `#catalog` (D12 anchor).
- **D33 The first live theme is always the migrated one.**
  - `lib/store/engine/migrate-runner.ts` exports `migrationInputFor(businessId)`, which reads the store theme, name, tagline, about, hero, logo and the store's categories.
  - `themes-repo.ts` gains `insertMigratedLiveLocked(client, businessId, userId, input)`. It runs under the existing business advisory lock and inserts the live theme only when the business has none.
  - It is used by:
    - the working-draft path, which today creates a Studio preset when no live theme exists;
    - `createTheme(…, { migrate })`, which the themes POST route now passes, so a preset theme created before migration becomes a draft beside the migrated live one instead of becoming live itself;
    - the script.
  - `createTheme` without `migrate` keeps M1's "first theme is live" for existing tests and callers.
- **D34 Migration runner and script.**
  - **Guard.** `runStoreThemeMigration` first runs `SELECT current_database()`. It refuses (`MigrationRefusedError`, exit 2), before any other query, unless the name is `kh_phase2_test` or exactly equals `--allow-database <name>`.
  - **Connection.**
    - The script requires `DATABASE_URL` in its own environment and refuses without it. It never loads `.env` or `.env.production`, and never falls back to `DB_*` variables.
    - It never prints the URL or the password; it prints only the database name.
  - **Which businesses.** `--all` takes businesses with a non-empty `business_settings.store_subdomain`; `--business <uuid>` (repeatable) names them instead. Business ids come only from the database or the command line.
  - **Each business** runs in its own transaction:
    - a business that already has a live theme → `skipped_live`, with no write;
    - `--dry-run` → `would_migrate` with warnings, and no write;
    - one business failing does not stop the others, and the exit code is 1 if any failed.
  - **Never touched:** `business_settings` (including `store_engine`) and `store_theme`.
  - **Report.** Written as JSON to `--report` (default `tmp-qa/engine-migration/report.json`; `tmp-qa/` is never committed).
  - **Preview links.** `--preview-links` adds `preview_path` = `/?preview_theme=<id>&pt=<7-day share token>` for each migrated theme. It is skipped, with one notice, when no signing secret is configured.
- **D35 Demo stores render their migrated theme on request.**
  - On a theme demo subdomain (`theme-studio`, `theme-quick`, `theme-grocery`, `theme-khatario`), `?engine=1` renders `migrateStoreTheme(demo store_theme, demo ctx)`.
  - It shows the Preview badge, is never in editor mode, and touches no database.
  - Real stores ignore `engine`.
  - This gives the parity report a fixed old/new pair for every pack on any host.
- **D36 Parity report.**
  - `scripts/store-engine-parity.mjs --base <url> [--report <migration report>] [--demos] [--only <sub>] [--out tmp-qa/engine-parity]`.
  - `--base` accepts only `http://localhost:<port>`, `http://127.0.0.1:<port>` or `https://staging.khatario.com` (AGENTS.md: no browser automation on production). Store origins are `<sub>.localhost:<port>` or `<sub>.staging.khatario.com`.
  - **Targets:**
    - with `--demos`, the four demo stores at `/` (old) and `/?engine=1` (new);
    - from the report, each `migrated` row that has a `preview_path`: `/` (old; only valid while that store's `store_engine` is off) and the preview path (new).
  - **Shots.** Chromium; widths 390 and 1280; `reducedMotion: 'reduce'`; `networkidle` plus 1 s; full page. Output is `<out>/<label>/{old,new}-{390,1280}.png` and `<out>/index.html` (side by side, labels escaped). No pixel diff.
  - **No task runs it.** It runs on staging after deploy (Task 9 checklist).
- **D37 Carry-over pulled into M4:**
  - M3 Minor 7: the Sale starter's button links to `/catalog`.
  - M3 Minor 8: `preview-token.test.ts` tampers a middle character, not the last two.
  - M3 Minor 10: the theme `card_style` setting gets the info line "Product grid and rail sections keep their own card style".
  - M3 Minor 2: `catalogRedirect` drops a non-uuid `cat` instead of redirecting to a 404.
  - Left where they are: M3 Minors 3, 4, 5, 6, 9 and 11; parked M2 items (M2, N4, N5). N2 goes to M5.
- **D38 Shared Studio components get one additive prop.** `StudioCategoryTiles` / `StudioCategoriesSection` take an optional `marks?: Record<string, string>` (category id → short text in the tile mark), used for emoji tiles. Absent means today's behaviour, so the old storefront is unchanged.

## Global Constraints

- **Database:**
  - Migrations and DB tests touch only the disposable DB `kh_phase2_test`.
  - Nothing runs against staging or production: no SQL migration, no migration script, no parity run.
  - M4 adds **no SQL migration**.
- **The migration script:**
  - `scripts/migrate-store-themes.mjs` refuses any database other than `kh_phase2_test` unless `--allow-database <exact name>` is passed (D34).
  - It is idempotent: a business with a live theme is skipped.
  - It never writes `store_engine`, which stays **off for every store**, test stores included.
- **Trust:** never trust a client-sent `business_id`, `user_id` or `created_by`. The themes routes keep taking the business from the session (`requireTenantPermission`); the script takes business ids only from the DB or its own command line.
- **Secrets:** never print a DB password, a connection URL or a signing secret.
- **Commits:**
  - Commit only at each task's commit step: one commit per task on `main`, never push.
  - Stage files by path (never `git add .`). Never stash, reset or clean; never stage another session's hunks.
  - Message trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **No local browser checks** (owner direction, M3 R11):
  - Do not start a dev server.
  - Do not run Playwright: no e2e spec, no parity script.
  - Each task with visible output ends with **Staging test steps**, collected in Task 9.
  - The gate is jest unit tests, DB tests (`PHASE2_TEST_DATABASE_URL` set to the local `kh_phase2_test` URL, as the workspace's `with-test-db.js` does) and `npx tsc --noEmit`.
- **Client bundle:**
  - Client components never import server-only modules: `pg`, `@/lib/db`, `sanitize-html`, or anything importing them (`settings.ts`, `sanitize.ts`, `html.ts`, `color-schemes.ts`, `themes-repo.ts`, `render-helpers.ts`, `studio-adapter.ts`, `presets/{index,shared,look,studio,blank,quick,grocery,khatario}.ts`, `migrate*.ts`, `parity.ts`).
  - New client-safe modules: `lib/store/engine/root-class.ts`, the new `sections/*.ts` schemas, and `pickSlidesForDevice` in `shared.ts`. They import only types, `shared.ts` and each other.
  - The editor rule from M3 stands.
- **Unchanged limits** (M1–M3): 25 sections per template, 50 blocks per section, 30 custom pages, 512 KB, 20 themes, ids `/^[a-z0-9_-]{1,32}$/`. `advanced_online_store` gate plus `settings` permission on the themes routes.
- **Hands off:**
  - project C's files (`components/store/features/**`, `components/store/product/*`);
  - the old Studio editor (`components/store/admin/theme-studio/*`, `app/(app)/settings/online-store/studio/*`);
  - the old pack renderers (`StoreGroceryHome`, `StoreGroceryChrome`, `StoreCatalogView`, `StoreShell`, `quick-theme/*`). They are only read, as the reference for the presets. The one exception is D38's additive prop in `studio-theme/StudioSections.tsx`.

## Review Focus

1. **The script is pointed at the wrong database.**
   - With `DATABASE_URL` naming any database other than `kh_phase2_test`, and no matching `--allow-database`, nothing is read or written beyond `current_database()`. The exit code is 2, and the message names the database but not the URL.
   - `--allow-database staging_x` against `kh_phase2_test` also refuses: the names must match exactly.
   - Test: Task 7 `migrationDatabaseAllowed` cases, and the DB test `refuses a database it was not allowed`.
2. **The script runs twice, or runs for a business that already customised.**
   - The second run reports every business `skipped_live` with no row changed (`updated_at` identical).
   - `store_engine` and `store_theme` are byte-identical before and after.
   - Test: Task 7 DB `idempotent, leaves flags and old theme alone`.
3. **A merchant opens Studio 2, or the API creates a theme, before migration ran.** The live theme is the migrated design, not the Studio preset, and the requested theme is a draft. Test: Task 7 DB `working draft and POST start from the migrated live theme`.
4. **Odd or hostile old themes:**
   - inline `data:` images, `http:` images, `javascript:` announcement links;
   - 8000-character CSS;
   - 30 Studio sections;
   - uppercase section ids;
   - a retired pack (`noir`);
   - an unknown `preset`.

   For each, `migrateStoreTheme` returns data that sanitises to itself, stays under 512 KB, has at most 25 home sections, and has a warning for each dropped thing. Test: Task 5 `hostile fixtures`.
5. **Preset CSS leaks.** Every selector in the three layers is scoped to its preset class, so a Studio-preset store and every non-engine page render exactly as before. Test: Task 4 `preset-css.test.ts`.
6. **Quick's phone kit cannot be switched off; other presets' toggle still works.** Test: Task 4 `engineRootClass` and `lockedThemeSettings` cases.
7. **`?engine=1` on a real store does nothing.** Test: Task 8 `demo engine theme`.

## File Structure

```
lib/store/engine/
  presets/look.ts          PRESET_LOOK, mixHex(), schemesFor(), presetSettings(ctx, preset)   (server)
  presets/shared.ts        template() suffixes repeated types (D30); presetSettings moves to look.ts
  presets/{quick,grocery,khatario}.ts   new full presets
  presets/{index,studio,blank}.ts       switch + Studio look
  presets/templates.ts     Sale starter link → /catalog (D37)
  preset-context.ts        presetContextFromRow() (pure) + effective accent
  sections/promo-cards.ts, sections/category-shelves.ts               new schemas
  sections/{category-grid,announcement,header,slideshow}.ts           extensions (D28)
  schema-types.ts          SectionDataRequest.shelves
  section-data.ts          shelves resolution; storeCategories(businessId)
  render-helpers.ts        categoryImageMap(), categoryMarks()
  shared.ts                pickSlidesForDevice()
  root-class.ts            engineRootClass(), isDarkHex()                      (client-safe)
  theme-settings-schema.ts lockedThemeSettings(); card_style info line
  links.ts                 catalogRedirect drops a non-uuid cat (D37)
  migrate.ts               migrateStoreTheme(), settings, header/footer groups, MigrationContext
  migrate-studio.ts        StudioSection[] → home template + groups
  migrate-packs.ts         grocery / khatario home mapping
  migrate-runner.ts        guard, migrationInputFor(), runStoreThemeMigration()  (server)
  themes-repo.ts           insertMigratedLiveLocked(); createTheme({ migrate }); working draft uses it
  load-theme.ts            demo stores: ?engine=1 → migrated demo theme (D35)
  parity.ts                storeOrigin(), parityTargets(), parityHtml()
components/store/engine/
  EngineShell.tsx          engineRootClass, Quick chrome, layer imports
  presets/{quick,grocery,khatario}.css
  sections/{PromoCards,CategoryShelves}.tsx (server) + client views in EngineViews.tsx
  sections/{CategoryGrid,Announcement,Header,Slideshow}.tsx            extensions
  registry.tsx             two new components
components/store/studio-theme/StudioSections.tsx   optional `marks` prop (D38)
components/store/studio2/SettingsPanel.tsx         locked theme settings
app/api/settings/online-store/themes/route.ts      POST passes { migrate }
scripts/migrate-store-themes.mjs, scripts/store-engine-parity.mjs
tests/lib/store/engine/fixtures/store-themes.ts    raw store_theme fixtures, one or more per pack
```

---

### Task 1: Preset look, deterministic ids, effective accent, carry-over minors

**Files:**
- Create: `lib/store/engine/presets/look.ts`
- Modify:
  - `lib/store/engine/presets/{shared,studio,blank,templates}.ts`;
  - `lib/store/engine/preset-context.ts`;
  - `lib/store/engine/links.ts`;
  - `lib/store/engine/theme-settings-schema.ts` (card_style `info`).
- Test:
  - Create `tests/lib/store/engine/preset-look.test.ts`.
  - Extend `tests/lib/store/engine/{presets,preset-templates,catalog-links,preview-token}.test.ts`.

**Interfaces:**
- Produces:
  - `PRESET_LOOK: Record<ThemePreset, { canvas: string; accent: string; font_heading: string; font_body: string; button_radius: number; card_style: ThemeSettings['card_style'] }>` (D26).
  - `mixHex(a: string, b: string, weightA: number): string`: `#rrggbb` inputs (3-digit expanded), `#rrggbb` output, weight clamped to 0–1.
  - `schemesFor(preset: ThemePreset, accent: string | undefined, canvas?: string): ColorScheme[]`:
    - six schemes, all passing `sanitizeColorSchemes` unchanged;
    - an invalid or missing accent falls back to the look's accent;
    - `canvas` defaults to the look's.
  - `presetSettings(ctx: PresetContext, preset: ThemePreset = 'studio'): ThemeSettings`. It moves from `shared.ts`, which re-exports it.
  - `template(sections)` with D30 ids.
  - `presetContextFromRow(row): PresetContext`, pure. `accent` = `sanitizeStoreTheme(row.store_theme).accent`, and the query selects the whole `store_theme`. `presetContextFor` uses it.
  - `catalogRedirect` drops a non-uuid `cat` (and returns null when nothing else remains).

- [ ] **Step 1: Write failing tests.**
  - `preset-look.test.ts`:
    - `mixHex('#000000', '#ffffff', 0.5) === '#808080'` (round half up), `mixHex('#fff', '#000', 1) === '#ffffff'`;
    - `schemesFor('grocery', '#176b45')`:
      - scheme 1 background `#f6f7f4`, text `#1c1917`, button_text equals `chowkOnAccent('#176b45')`;
      - scheme 6 is named "Deep green" with text `#ffffffe0`;
    - `schemesFor('studio', 'nope')[0].accent === '#b94717'`;
    - a dark canvas `#131210` gives scheme 1 text `#f4efe6` and a non-white card;
    - `sanitizeColorSchemes(schemesFor(p, accent))` deep-equals the input for all five presets.
  - `presets.test.ts`: Studio scheme 1 background is `#fbf8f3`, and the accent test still passes.
  - D30: `template([section('product-rail',{}), section('product-rail',{})]).order` equals `['product-rail','product-rail-2']`.
  - `presetContextFromRow({ name: 'A', store_theme: { preset: 'grocery', accent: '#ff0000' } }).accent === '#176b45'`; with `preset: 'custom', accent: '#ff0000'` it is `#ff0000`.
  - `preset-templates.test.ts`: the Sale starter's `image-banner` link is `/catalog`.
  - `catalog-links.test.ts`: `catalogRedirect(true, '/', '?cat=foo')` is null; `catalogRedirect(true, '/', '?cat=foo&q=rice')` is `/catalog?q=rice`.
  - `preview-token.test.ts`: the tamper case flips the token's middle character. Run it 200 times in a loop inside the test, and it must never verify.
  - `THEME_SETTINGS_SCHEMA` `card_style` has the D37 info text.
- [ ] **Step 2:** Run `npx jest tests/lib/store/engine/preset-look.test.ts tests/lib/store/engine/presets.test.ts tests/lib/store/engine/preset-templates.test.ts tests/lib/store/engine/catalog-links.test.ts`: FAIL.
- [ ] **Step 3:** Implement. `presets/index.ts` still maps quick/grocery/khatario to Studio until Task 3. Studio and Blank call `presetSettings(ctx, 'studio'|'blank')`.
- [ ] **Step 4:** Run `npx jest tests/lib/store` and `npx tsc --noEmit`: PASS / clean.
- [ ] **Staging test steps:**
  1. On the engine test store, open a preview of a theme created after this deploy. The page background is Studio's warm paper (`#fbf8f3`), not white.
  2. Create a custom page from the Sale starter and click its banner button: it opens the catalog.
  3. `/?cat=foo` on an engine store with a catalog template shows the home page, not a 404.
- [ ] **Step 5:** Commit: "Presets take each old pack's paper, accent, fonts and corners, and use the store's real accent; preset section ids stay unique when a type repeats; the Sale starter opens the catalog and a malformed category link no longer 404s."

### Task 2: New and extended sections for Grocery and Khatario home features

**Files:**
- Create:
  - `lib/store/engine/sections/{promo-cards,category-shelves}.ts`;
  - `components/store/engine/sections/{PromoCards,CategoryShelves}.tsx`.
- Modify:
  - `lib/store/engine/sections/{category-grid,announcement,header,slideshow}.ts`;
  - `lib/store/engine/{registry,schema-types,section-data,render-helpers,shared,studio-adapter}.ts`;
  - `components/store/engine/{registry.tsx,EngineViews.tsx}`;
  - `components/store/engine/sections/{CategoryGrid,Announcement,Header,Slideshow}.tsx`;
  - `components/store/studio-theme/StudioSections.tsx` (D38 `marks`);
  - `components/store/engine/EngineShell.tsx` (`THEME_RULES` for the two new sections).
- Test:
  - Create `tests/lib/store/engine/m4-sections.test.ts`.
  - Extend `tests/lib/store/engine/section-data.test.ts` and `tests/db/store-engine-data.db.test.ts`.

**Interfaces:**
- Produces:
  - **`promo-cards`:**
    - Category Banners; `templates: ['home','page']`.
    - Settings:
      - `heading` text 120 default '';
      - `style` select `split|overlay` default `split`;
      - `columns` range 1–3 default 2.
    - Blocks `card` (max 4):
      - `eyebrow` text 40, `heading` text 120, `text` textarea 200;
      - `button_text` text 30 default "Shop now";
      - `link` url default `#catalog`;
      - `image` image.
    - Preset: two cards.
    - Renders `.eng-promos[data-style][style=--eng-cols]` with `article.eng-promo` children. The CTA uses `useFollowLink`. A card with no heading and no image is skipped.
  - **`category-shelves`:**
    - Category Products; `templates: ['home','page']`.
    - Settings: `max_categories` range 1–12 default 6, `per_shelf` range 4–12 default 8, `show_view_all` checkbox true.
    - `data: (s) => ({ shelves: { maxCategories, perShelf } })`.
    - Each shelf renders as `EngineProductGrid` `isRow`, headed by the category name. "View all" goes to `engineCatalogHref(…, { categoryId })`. Empty shelves are skipped.
  - `SectionDataRequest.shelves?: { maxCategories: number; perShelf: number }` and `SectionData.shelves?: Array<{ category: SectionCategory; products: StoreItem[] }>`.
    - `resolveSectionData` loads the categories once (shared with other sections), takes the first `maxCategories` with `item_count > 0`, and loads `source: 'category'` products per category through the same deduped product jobs.
    - A failed category query marks only that section.
    - On demo stores it filters the demo catalog.
  - `export async function storeCategories(businessId: string): Promise<SectionCategory[]>`: the non-demo body of `loadCategories`, reused by Task 7.
  - **`category-grid`:**
    - `style` gains `{ value: 'emoji', label: 'Emoji icons' }`.
    - New block `category_image` (max 40): `category` category, `image` image.
    - `categoryImageMap(section, categories): Record<string, string>` merges block images for listed categories over `image_url`.
    - `categoryMarks(categories, style)` returns `groceryCategoryEmoji(name)` per id when the style is `emoji`, else `{}`.
    - `engineCategoryStyle('emoji', false)` returns `'icon'`, and the marks fill the tile.
  - **`announcement`:** `scrolling` checkbox default false. When on, the bar renders the items from `marqueeItems(text)` duplicated in a CSS loop (`.eng-announce-scroll`), and the whole bar follows `link`.
  - **`header`:**
    - `show_category_chips` checkbox default false.
    - `data: (s) => (s.show_category_chips === true ? { categories: true } : {})`.
    - Chips (All, then each category) render under the header row, navigating with `useCatalogNav`.
  - **`slideshow`:**
    - The `slide` block gains `device` select `both|mobile|desktop` default `both`.
    - `slideshowSettings` keeps returning `StudioSettings`. The `Slideshow` component also passes `devices: Array<'both'|'mobile'|'desktop'>` in slide order to `EngineHero`.
    - `EngineHero` applies `pickSlidesForDevice(devices, phone)`, using `useIsPhone()` from `lib/store/phone-kit.ts`. Server markup uses `desktop`, as the old storefront did.
  - `pickSlidesForDevice(devices: string[], phone: boolean): number[]` (client-safe, `shared.ts`) returns the indexes of the slides to show: those that match, else all.

- [ ] **Step 1: Write failing tests.**
  - `m4-sections.test.ts`:
    - both new schemas are registered;
    - `sectionsForTemplate('home')` includes them and `sectionsForTemplate('product')` does not;
    - the preset round-trips through `sanitizeThemeData`;
    - a 5th promo card is dropped;
    - `max_categories: 40` clamps to 12;
    - `category-grid` keeps `style: 'emoji'` and drops `style: 'nope'`;
    - a 41st `category_image` is dropped;
    - `announcement.scrolling` and `header.show_category_chips` survive sanitising;
    - a slide with `device: 'tv'` sanitises to `both`;
    - `pickSlidesForDevice(['mobile','desktop','both'], true)` → `[0,2]`, `(['mobile'], false)` → `[0]`, `([], true)` → `[]`;
    - `categoryImageMap` prefers a block image over `image_url` and ignores blocks for unknown categories;
    - `categoryMarks([{id:'a',name:'Fresh Vegetables'}], 'emoji').a` is an emoji, and `categoryMarks(…, 'tiles')` is `{}`.
  - `section-data.test.ts`:
    - `collectDataRequests` gives `{ shelves: { maxCategories: 6, perShelf: 8 } }` for a default `category-shelves`;
    - `{}` for a default header;
    - `{ categories: true }` for a header with chips.
  - DB `store-engine-data.db.test.ts` `category shelves`:
    - two categories with products and one empty → two shelves, each with at most `perShelf` items of only its category;
    - another business's category never appears.
- [ ] **Step 2:** Run the two unit files: FAIL.
- [ ] **Step 3:** Implement.
  - New CSS in `THEME_RULES`: `.eng-promos` grid, `.eng-promo` (split: copy plus image; overlay: image cover plus gradient plus caption), `.eng-shelves` spacing, `.eng-chips` row, `.eng-announce-scroll` keyframes (paused under `prefers-reduced-motion`). Keep the existing 30/16 px gutters.
- [ ] **Step 4:** Run `npx jest tests/lib/store`, the DB file (`PHASE2_TEST_DATABASE_URL` set), and `npx tsc --noEmit`: PASS.
- [ ] **Staging test steps** (engine test store, Studio 2 working draft):
  1. Add section → Promo cards: two cards side by side on desktop, stacked at 390 px. Switch Style to Overlay: the caption sits on the image.
  2. Add Category shelves: one rail per category with products, and "View all" opens that category.
  3. Category grid → Style "Emoji icons": tiles show emojis. Add a Category image block for one category: that tile shows the photo.
  4. Announcement → Scrolling on: the text scrolls. With the OS "reduce motion" setting on, it does not move.
  5. Header → Category chips on: a chip row under the header opens the catalog.
  6. Slideshow: set slide 2 to Mobile only. A phone shows it; a desktop does not.
- [ ] **Step 5:** Commit: "Two new sections, Promo cards and Category shelves, plus emoji category tiles with per-category photos, a scrolling announcement, header category chips and slides per device, so Grocery and Khatario homes can be built from sections."

### Task 3: Quick, Grocery and Khatario presets

**Files:**
- Create: `lib/store/engine/presets/{quick,grocery,khatario}.ts`
- Modify: `lib/store/engine/presets/index.ts`
- Test:
  - Extend `tests/lib/store/engine/presets.test.ts`: its `describe.each` covers all five presets.
  - Extend `tests/db/store-themes-api.db.test.ts`.

**Interfaces:**
- Consumes: `presetSettings(ctx, preset)`, `template()`, `section()`, `block()` (Task 1); the Task 2 sections; `defaultTemplate`.
- Produces: `presetTheme('quick'|'grocery'|'khatario', ctx)`. Each has full settings, header and footer groups, `home`, and default `product` and `catalog` templates.
  - **quick**:
    - **Settings:** `phone_kit: true`.
    - **Header group:**
      - `header`: `delivery_eta: 'in 30 minutes'`, `search_placeholder: 'Search for products…'`, menu links "All Products" `/catalog` and "Offers" `/catalog?disc=10` (highlight).
      - No announcement.
    - **Home**, the order `toQuickLayout(themeToStudioSections(applyStorePreset('quick')))` gives:
      1. `slideshow` (layout `full`, height `small`; one slide from ctx);
      2. `category-grid` (columns 8, heading "Shop by category");
      3. `product-rail` Bestsellers (`bestsellers`, 12);
      4. `product-rail-2` "Top deals" (`discounted`, 12);
      5. `multicolumn` (the four Studio USPs);
      6. `featured-products` "Handpicked for you" (`all`, 24, columns 6).
    - **Footer:** as Studio.
  - **grocery**:
    - **Header group:**
      - `announcement`, `scrolling: true`, `color_scheme: 'scheme-6'`, text = tagline or "Fresh groceries delivered to your door";
      - `header`, `show_category_chips: true`, `search_placeholder: 'Search for products, brands and categories…'`.
    - **Home:**
      1. `slideshow` (layout `image-text`, height `large`, speed 7; slide heading tagline or "Fresh groceries & daily essentials", description "Fresh produce and everyday essentials, delivered to your doorstep.", button "Shop groceries", link `#catalog`);
      2. `category-grid` (style `emoji`, columns 6, heading "Shop by category", eyebrow "");
      3. `product-rail` "Today's deals" (`discounted`, 8);
      4. `promo-cards` (split; the two default Grocery cards from D28, with links `/catalog?disc=10` and `#catalog`);
      5. `featured-products` "All products" (`all`, 24, columns 5).
    - **Footer:** `footer` with `color_scheme: 'scheme-6'`.
  - **khatario**:
    - **Header group:**
      - `announcement` with scheme 4, text = tagline;
      - `header` with scheme 4, `search_placeholder: 'Search for items…'`.
    - **Home:**
      1. `slideshow` (layout `full`, height `medium`, button "Order now", link `#catalog`);
      2. `category-grid` (style `tiles`, heading "");
      3. `product-rail` "Popular products" (`all`, 6);
      4. `featured-products` "All products" (`all`, 24, columns 4).
  - Each preset is under 64 KB serialised.

- [ ] **Step 1: Write failing tests.**
  - `presets.test.ts`: the existing `describe.each` (sanitises unchanged, valid unique ids across header, home and footer, deterministic, accent on scheme 1) covers all five presets.
  - Home type order per preset, exactly as listed above.
  - `presetTheme('quick', ctx).settings.phone_kit === true`.
  - Grocery's announcement has `scrolling: true` and `color_scheme: 'scheme-6'`.
  - Khatario's header has `color_scheme: 'scheme-4'`.
  - Every preset's `templates.product.order.length > 0`.
  - `JSON.stringify(p).length < 65536`.
  - DB `store-themes-api.db.test.ts`: POST `{ preset: 'grocery' }` returns `preset: 'grocery'`, and its home has a `promo-cards` section.
- [ ] **Step 2:** Run `npx jest tests/lib/store/engine/presets.test.ts`: FAIL.
- [ ] **Step 3:** Implement, and switch `presetTheme` to the new builders.
- [ ] **Step 4:** Run `npx jest tests/lib/store`, the DB file and `npx tsc --noEmit`: PASS.
- [ ] **Staging test steps:** signed in as the engine test store's merchant, from the browser console on `staging.khatario.com`:
  1. `await (await fetch('/api/settings/online-store/themes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Grocery test',preset:'grocery'})})).json()`. Note the theme id.
  2. `await (await fetch('/api/settings/online-store/themes/<id>/preview-link',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json()`, then open the URL.
  3. The home shows a hero, emoji category tiles, Today's deals, two promo cards and All products. (The Grocery look arrives in Task 4.)
  4. Repeat steps 1–3 for `quick` and `khatario`.
  5. Delete the test themes afterwards: `DELETE /api/settings/online-store/themes/<id>`.
- [ ] **Step 5:** Commit: "Quick, Premium Grocery and Khatario are now engine presets with their own home layouts, header and footer, so a new theme can start from any of the four looks."

### Task 4: Preset CSS layers and Quick chrome in the engine shell

**Files:**
- Create:
  - `lib/store/engine/root-class.ts`;
  - `components/store/engine/presets/{quick,grocery,khatario}.css`.
- Modify:
  - `components/store/engine/EngineShell.tsx`;
  - `lib/store/engine/theme-settings-schema.ts` (`lockedThemeSettings`);
  - `components/store/studio2/SettingsPanel.tsx` (and `fields/SettingField.tsx` if the disabled state lives there);
  - `components/store/studio2/Studio2Editor.tsx` (pass the theme's `preset` to the panel).
- Test: create `tests/lib/store/engine/root-class.test.ts` and `tests/lib/store/engine/preset-css.test.ts`.

**Interfaces:**
- Produces:
  - `engineRootClass(input: { preset: ThemePreset; phoneKit: boolean; editor: boolean; schemeBackground: string | undefined }): { className: string; kit: boolean; quick: boolean }` (D27, D29).
  - `isDarkHex(hex: string): boolean`: luminance < 0.4. A non-hex value is light.
  - `lockedThemeSettings(preset: ThemePreset | undefined): Readonly<Record<string, string>>` (D29).
  - `EngineShell`:
    - reads `theme.preset`;
    - imports the three layer files;
    - on Quick, renders `QuickTabs` and an always-mounted `QuickCartBar` (not inside `.qk-kit`), with `qk-main`/`noBar` on `<main>`;
    - on other presets, keeps today's chrome.
  - **Layers** (selectors scoped per D27; key rules only, sized to match the old packs):
    - `grocery.css`:
      - hero (`.heroCopy`, `.hero`) becomes a 28 px rounded card on a `color-mix` accent 14%→24% gradient;
      - headings weight 800, `clamp(22px,2.6vw,30px)`, tight tracking;
      - category tiles: white, bordered, 18 px radius, lift on hover;
      - product cards lift on hover;
      - `.eng-promo` split cards at 24 px radius, with even cards in the deep scheme-6 colours;
      - content width 80rem (`max-w-7xl`).
    - `khatario.css`:
      - category grid as a single scrolling row of round marks (`.catGrid` → flex, `overflow-x:auto`, `scroll-snap`);
      - section headings 1.05rem / 600;
      - product cards 1.35rem radius;
      - rails snap-scroll;
      - content width 72rem;
      - the scheme-4 header keeps its search field white.
    - `quick.css`: only what `quick-theme.css` lacks for engine markup:
      - `.eng-promos`, `.eng-shelves`, `.eng-chips` in Quick's 14 px radius and shadow;
      - three-column product grids under 640 px container width.
  - `SettingsPanel` theme settings: for each key in `lockedThemeSettings(preset)`, the field is disabled, shows the effective value (checked), and has the locked text as its info line.

- [ ] **Step 1: Write failing tests.**
  - `root-class.test.ts`:
    - quick with `phoneKit: false` → `kit: true`, and `className` contains `eng-preset-quick` and `store-quick` and `phone-kit`;
    - grocery with `phoneKit: false` → no `phone-kit`;
    - studio, editor → contains `eng-editor` and `eng-preset-studio`, and not `store-quick`;
    - `schemeBackground: '#131210'` → contains `is-dark`; `'#f6f7f4'` → does not;
    - `lockedThemeSettings('quick')` has `phone_kit`; `lockedThemeSettings('grocery')` is `{}`.
  - `preset-css.test.ts`, for each of the three files:
    - strip comments;
    - split at top level and inside `@media`/`@container`/`@supports` blocks;
    - every selector of every rule starts with `.st-root.eng-root.eng-preset-<name>`;
    - `@keyframes` names start with `eng-<name>-`;
    - the file contains no `@import`, no `url(` and no `expression(`.
- [ ] **Step 2:** Run both files: FAIL.
- [ ] **Step 3:** Implement. Copy rule values from the old components' Tailwind classes (`StoreGroceryHome`, `StoreGroceryChrome`, the Khatario branch of `StoreCatalogView`), not from memory.
- [ ] **Step 4:** Run `npx jest tests/lib/store` and `npx tsc --noEmit`: PASS.
- [ ] **Staging test steps** (preview links of the Task 3 test themes, at 390 px and 1280 px):
  1. Grocery:
     - gradient rounded hero card;
     - bold headings;
     - white emoji category tiles that lift on hover;
     - deep-green scrolling announcement and footer;
     - the second promo card is deep green.
  2. Khatario:
     - accent-coloured announcement and header bar;
     - categories as one swipeable row;
     - rounded product cards.
  3. Quick:
     - Quick's look, with the bottom tabs Home/Categories/Search/Cart;
     - after adding an item, the floating cart bar on phone *and* desktop widths.
  4. In Studio 2 on a Quick-preset working draft: Theme settings → "Phone-friendly layout" is ticked, greyed out, and reads "Always on in the Quick theme". On a Grocery draft, it can be switched off, and the phone layout then changes.
  5. A Studio-preset store looks as before, apart from the page colour from Task 1.
- [ ] **Step 5:** Commit: "Each engine preset now has its own look: Grocery's rounded green cards, Khatario's brand bar and category row, and Quick's app chrome with its always-on phone layout."

### Task 5: `migrate.ts`: settings, header and footer, Studio and Quick homes

**Files:**
- Create:
  - `lib/store/engine/migrate.ts`, `lib/store/engine/migrate-studio.ts`;
  - `tests/lib/store/engine/fixtures/store-themes.ts`;
  - `tests/lib/store/engine/migrate.test.ts`.

**Interfaces:**
- Consumes:
  - `sanitizeStoreTheme`, `storeCanvas`, `resolveAnnouncementText`, `STORE_THEME_PRESETS`;
  - `resolveStudioSections`, `studioLinkTarget`;
  - `schemesFor`, `PRESET_LOOK`, `template`/`section`/`block` (Task 1);
  - `sanitizeSettingValue`, `sanitizeThemeData`, `themeTooLarge`.
- Produces:
  - **Types:**

    ```ts
    export interface MigrationContext {
      businessName: string; tagline: string; aboutMd: string; heroUrl: string; logoUrl: string;
      categories: Array<{ id: string; name: string }>;
    }
    export interface MigrationResult {
      preset: 'studio' | 'quick' | 'grocery' | 'khatario'; name: string; data: ThemeData; warnings: string[];
    }
    export function migrateStoreTheme(raw: unknown, ctx: MigrationContext): MigrationResult;
    ```

    For grocery and khatario, `migrateStoreTheme` calls `migratePackHome` from `migrate-packs.ts`. Until Task 6, that is a stub returning an empty home and the warning `'pack home not migrated yet'`.
  - **`migrateStudioSections(sections: StudioSection[], t: StoreTheme, ctx): { header: Template; footer: Template; home: Template; warnings: string[] }`.** One engine section per Studio section, ids per D30:

    | Studio type | Engine section |
    |---|---|
    | `announcement` | header group `announcement`: `text`, `link`, `text_align`. `announceMode: 'auto'` with empty `autoText` → `disabled: true`. Custom colours per D31. |
    | `header` | `header`: `show_search`, `search_placeholder` (= `t.search_placeholder` or the header's), `delivery_eta` (= `deliveryEta`, else the Studio tagline clipped to 40, with a warning when clipped), `icons_position`, `show_account`, `show_cart`, `show_cart_count`. Plus `menu_link` blocks from `navLinks` (comma list, max 12, D32 links, `highlight` = the label equals `highlightLink`). `showNav === false` → no blocks. |
    | `hero` | `slideshow`: `layout`, `height`, `autoplay` (`autoplay > 0`), `speed` (clamped 3–10). Slide 1 from the hero fields, then the extra slides. Slide `device` from `t.hero_slides[i].viewport` when the hero came from `hero_slides`. |
    | `categories` | `category-grid`: `heading` = title, `eyebrow`, `columns` clamped 3–8, `style` from `t.category_style` (`letter`→`tiles`, `icon`→`cards`, `photo`→`tiles`). `category_image` blocks from `t.category_images` for ids in `ctx.categories`. |
    | `products` | `featured-products`, or `product-rail` when `display === 'carousel'`. Settings: `heading`, `eyebrow`, `source`, `category`, `price_max`, `limit` (2–24; source `all` → 24), `columns` (2–6), `card_style`, `show_rating`, `show_badges`. |
    | `banner` | `image-banner`. |
    | `testimonials` | `testimonials` with `quote` blocks from `t.testimonials` (rating 5). |
    | `richtext` | `rich-text` (text escaped into `<p>`). |
    | `usp` | `multicolumn` (`usps`, else the four Studio defaults). |
    | `marquee` | `marquee` (`slow` 48, `normal` 30, `fast` 18 s; items split on `,`). |
    | `footer` | footer group `footer`: `about` = tagline. One `link_column` "Links" from the comma list via D32. |

    - Every section maps `enabled === false` → `disabled: true`, `cssClass` → `css_class`, `customCss` → `custom_css`, and `spacingTop`/`spacingBottom` → `spacing_*`.
    - No header section → the header from `themeToStudioSections`; no footer section → its footer.
    - Studio/Quick home = everything that is not announcement, header or footer, capped at 25 (a warning names the overflow count).

- [ ] **Step 1: Write failing tests.**
  - **Fixtures** (`fixtures/store-themes.ts`; plain objects as stored in `business_settings.store_theme`):
    - `studioDerived`: no `studio_sections`, testimonials, overlay band, hero slides with a mobile-only one;
    - `studioSaved`: 9 sections incl. hidden `banner`, `css_class`, section CSS, a carousel product row with `source: 'category'`;
    - `quickDerived`: preset `quick`, no sections;
    - `quickSaved`;
    - `customDark`: `preset: 'custom'`, `pack: 'studio'`, `appearance_mode: 'dark'`, `accent: '#7c3aed'`, `font_family: 'playfair'`;
    - `retiredNoir`: `pack: 'noir'`;
    - `hostile`:
      - a `data:image` logo, an `http:` hero image;
      - `announcement_link: 'javascript:alert(1)'`;
      - 8000 chars of CSS;
      - 30 saved sections with uppercase ids;
      - a nav label `https://evil.com/x`.
    - `ctx`: three categories with names matching the nav labels.
  - **Cases:**
    - Every fixture: `sanitizeThemeData(r.data)` deep-equals `r.data`; `themeTooLarge(r.data) === false`; `migrateStoreTheme(f, ctx)` called twice is deep-equal (pure); all ids match `ID_RE` and are unique across groups.
    - `studioDerived`:
      - preset studio, name "Studio";
      - home types in the order `resolveStudioSections` gives (`slideshow, category-grid, featured-products, image-banner, testimonials`);
      - the slideshow's second slide has `device: 'mobile'`;
      - testimonial quotes equal the fixture's;
      - product and catalog templates are empty.
    - `studioSaved`:
      - the hidden banner is `disabled: true`;
      - `css_class` and `custom_css` survive;
      - the carousel row is a `product-rail` with `source: 'category'` and its category;
      - the nav label equal to a category name links `/catalog/<id>`, "Offers" links `/catalog?disc=10`, "Contact" links `/contact`.
    - `quickDerived`:
      - preset quick;
      - `phone_kit` true;
      - home types `slideshow, category-grid, product-rail, product-rail, multicolumn, featured-products`;
      - ids `product-rail` and `product-rail-2`.
    - `customDark`:
      - scheme 1 background is `PACK_CANVAS_MODE.studio.dark`, its text `#f4efe6`, its accent `#7c3aed`;
      - `font_heading === font_body === 'playfair'`.
    - `retiredNoir`: preset studio, scheme 1 background dark (noir defaults to dark).
    - `hostile`:
      - logo `''`, plus warnings matching `/logo/` and `/hero image/`;
      - the announcement section has no link;
      - home has 25 sections, plus a warning matching `/5 sections/`;
      - the evil nav link is dropped with a warning;
      - `custom_css` length 8000, plus the CSS warning.
    - A named preset `{ preset: 'grocery', accent: '#ff0000' }` gets scheme 1 accent `#176b45` (the effective accent).
- [ ] **Step 2:** Run `npx jest tests/lib/store/engine/migrate.test.ts`: FAIL.
- [ ] **Step 3:** Implement. Escape text with a local `escapeHtml` (`& < > " '`) before wrapping it in `<p>`; never pass raw merchant text into a richtext setting.
- [ ] **Step 4:** Run `npx jest tests/lib/store` and `npx tsc --noEmit`: PASS.
- [ ] **Staging test steps:** none; nothing is visible until Tasks 7–8.
- [ ] **Step 5:** Commit: "migrate.ts turns a Studio or Quick store's saved or derived layout, colours, fonts, announcement, menu and footer into an engine theme that sanitises to itself, with warnings for anything it cannot carry."

### Task 6: `migrate.ts`: Grocery and Khatario homes

**Files:**
- Create: `lib/store/engine/migrate-packs.ts`, `tests/lib/store/engine/migrate-packs.test.ts`
- Modify: `lib/store/engine/migrate.ts` (header, footer and announcement for the two packs), `tests/lib/store/engine/fixtures/store-themes.ts`

**Interfaces:**
- Produces: `migratePackHome(t: StoreTheme, ctx: MigrationContext): { home: Template; warnings: string[] }`, following D28.
  - Shared rules:
    - `on(id)` = `sectionEnabled(t, id)`.
    - Hero slides are `t.hero_slides` (with `device` from `viewport`), else one fallback slide:
      - image `ctx.heroUrl`;
      - heading `ctx.tagline` or (grocery "Fresh groceries & daily essentials" / khatario `Shop from ${name}`);
      - description `t.hero_subtitle` or "Fresh products from your local store. Add to cart in one tap.";
      - button `t.hero_cta`, link `#catalog`.
    - A toggle that is off is omitted, unless it carries merchant content (overlay bands, shelves, testimonials, brand story). Such a toggle is kept as a `disabled: true` section.
  - **grocery**, in order:
    1. hero → `slideshow` (`image-text`, `large`, speed 7);
    2. categories → `category-grid` (style `emoji` unless `category_style` is `photo` with images, columns 6, heading "Shop by category", plus `category_image` blocks);
    3. offers → `product-rail` "Today's deals" (`discounted`, 8);
    4. overlay → `promo-cards` `split`: up to two bands (eyebrow "Special offer"/"Featured", heading caption, button cta or "Shop now", image, link `#catalog`), else the two default Grocery cards;
    5. featured → `featured-products` "Featured picks" (eyebrow "Chosen by the store", `featured`, 6, columns 3);
    6. product_shelves → one `product-rail` per shelf (a disabled shelf → disabled section);
    7. category_shelves → `category-shelves` (12, 8);
    8. always → `featured-products` "All products" (`all`, 24, columns 5);
    9. testimonials → `testimonials` "Loved by our customers";
    10. brand_story → `rich-text` "Our story" (`t.brand_story`, else `ctx.aboutMd`).
  - **khatario**, in order:
    1. hero → `slideshow` (`full`, `medium`);
    2. `ctx.tagline` → `rich-text` (no heading, align left, spacing 12/0, label "Tagline");
    3. categories → `category-grid`;
    4. overlay with bands → `promo-cards` `overlay` (captions, images);
    5. always → `product-rail` "Popular products" (`all`, 6);
    6. hero on with ≥2 image slides → `promo-cards` `overlay` from slides 2–3 (label "Promo slides");
    7. featured → `featured-products` "Featured" (6, columns 2);
    8. product_shelves; 9. category_shelves; 10. testimonials "Customer testimonials"; 11. brand_story "Our story";
    12. always → `featured-products` "All products" (`all`, 24, columns 4).
  - **Groups** (in `migrate.ts`):
    - grocery:
      - `announcement` (`scrolling: true`, text `resolveAnnouncementText(t, ctx.tagline)`, scheme 6 unless custom colours);
      - `header` (`show_category_chips: on('categories')`, menu "All Products" plus "Offers" when offers is on);
      - `footer` (scheme 6).
    - khatario:
      - `announcement` (text `resolveAnnouncementText(t, '')`, scheme 4 unless custom colours);
      - `header` (scheme 4);
      - default `footer`.
    - An empty announcement text → the section is `disabled: true`.
  - D28's dropped features produce warnings only when the old value is not the default. Grocery hero stats are always shown on the old store, so that warning is constant ("Grocery hero stats line is not shown") and is listed once.

- [ ] **Step 1: Write failing tests.** Fixtures:
  - `groceryDefault` = `applyStorePreset('grocery')`;
  - `groceryAll`: every toggle on, 2 bands, 2 shelves (one disabled), 3 testimonials, brand story, custom announcement colours, `category_images` for one category;
  - `khatarioDefault`;
  - `khatarioAll`: 3 hero slides with images, every toggle on;
  - `khatarioBare`: hero off, no tagline.

  Cases:
  - Every fixture passes the same invariants as Task 5.
  - `groceryAll` home types are exactly `slideshow, category-grid, product-rail, promo-cards, featured-products, product-rail, product-rail, category-shelves, featured-products, testimonials, rich-text`. The second shelf rail is `disabled`.
  - The announcement uses the "Announcement" scheme 5 with the fixture's colours.
  - The category grid has one `category_image` block.
  - `groceryDefault` and `khatarioDefault` produce the same home **type order** as `presetTheme('grocery'|'khatario')`. This test ties the presets to the stores they reproduce. (Grocery default: `slideshow, category-grid, product-rail, promo-cards, featured-products`.)
  - `khatarioAll`:
    - the second `promo-cards` holds slides 2–3;
    - the header's `color_scheme` is `scheme-4`;
    - the "All products" grid is last.
  - `khatarioBare` home starts with `category-grid`; no tagline section.
  - A Grocery store with testimonials toggled off but 2 testimonials keeps them as a disabled section.
- [ ] **Step 2:** Run `npx jest tests/lib/store/engine/migrate-packs.test.ts tests/lib/store/engine/migrate.test.ts`: FAIL.
- [ ] **Step 3:** Implement, replacing the Task 5 stub.
- [ ] **Step 4:** Run `npx jest tests/lib/store` and `npx tsc --noEmit`: PASS.
- [ ] **Staging test steps:** none; visible from Task 8 (`?engine=1`).
- [ ] **Step 5:** Commit: "migrate.ts rebuilds Premium Grocery and Khatario homes (hero, categories, deals, promo cards, featured, shelves, testimonials, brand story) as engine sections in the order those stores show them."

### Task 7: First live theme from migration, the runner and `scripts/migrate-store-themes.mjs`

**Files:**
- Create:
  - `lib/store/engine/migrate-runner.ts`, `scripts/migrate-store-themes.mjs`;
  - `tests/lib/store/engine/migrate-runner.test.ts`, `tests/db/store-theme-migrate.db.test.ts`.
- Modify:
  - `lib/store/engine/themes-repo.ts` (`insertMigratedLiveLocked`, `createTheme` `migrate` option, the working draft path);
  - `app/api/settings/online-store/themes/route.ts`;
  - `lib/store/engine/section-data.ts` (export `storeCategories` if Task 2 did not);
  - `tests/db/store-themes-api.db.test.ts` (the first-POST case, D33).

**Interfaces:**
- Produces:
  - `MIGRATION_DATABASE = 'kh_phase2_test'`.
  - `migrationDatabaseAllowed(actual: string, allow: string | null): boolean`.
  - `class MigrationRefusedError extends Error`.
  - `currentDatabaseName(): Promise<string>`: `SELECT current_database()`. It is the runner's first query.
  - `migrationInputFor(businessId: string): Promise<{ raw: unknown; ctx: MigrationContext } | null>`:
    - null when the business does not exist;
    - categories from `storeCategories`.
  - `insertMigratedLiveLocked(client: PoolClient, businessId: string, userId: string | null, input: { raw: unknown; ctx: MigrationContext }): Promise<{ theme: ThemeRow; warnings: string[] } | null>`:
    - null when a live theme exists;
    - else inserts `role 'live'`, the migrated `preset` and `name`, `data` = `sanitizeThemeData(result.data)`, and `updated_by = userId`;
    - respects the 20-theme limit (returns null and lets the caller report `limit`).
  - `createTheme(businessId, userId, { …, migrate?: { raw: unknown; ctx: MigrationContext } })`: with `migrate` and no live theme, it inserts the migrated live first, so the requested theme becomes a draft.
  - The working-draft path calls `insertMigratedLiveLocked` (with `migrationInputFor`) where it created a Studio preset. Only when the business has no store theme row at all does it fall back to the Studio preset.
  - The themes POST passes `migrate: await migrationInputFor(tenant.businessId)` (the business comes from the session).
  - **The runner:**

    ```ts
    export interface MigrationOptions { businessIds?: string[]; all?: boolean; dryRun?: boolean; allowDatabase?: string | null; previewLinks?: boolean }
    export interface MigrationReportRow {
      business_id: string; subdomain: string | null;
      status: 'migrated' | 'skipped_live' | 'would_migrate' | 'failed' | 'not_found';
      preset?: string; theme_id?: string; warnings: string[]; preview_path?: string; error?: string;
    }
    export async function runStoreThemeMigration(opts: MigrationOptions): Promise<{ database: string; dryRun: boolean; rows: MigrationReportRow[] }>;
    ```

    - It refuses first (D34).
    - It requires exactly one of `all` or a non-empty `businessIds` (every id a uuid), and throws `MigrationRefusedError` otherwise.
    - Each business runs in its own transaction under the business advisory lock.
    - `error` holds the error message only, never SQL parameters.
  - **`scripts/migrate-store-themes.mjs`:**
    - parses `--all`, `--business <uuid>` (repeatable), `--dry-run`, `--allow-database <name>`, `--report <path>`, `--preview-links`;
    - refuses without `DATABASE_URL` (exit 2);
    - registers `ts-node/register` (with `TS_NODE_PROJECT=tsconfig.worker.json`) and `tsconfig-paths/register` through `createRequire`, then requires `lib/store/engine/migrate-runner.ts`;
    - writes the report (creating the folder);
    - prints one line per business (`<subdomain or id>  <status>  <preset>  <n> warnings`) and totals, then closes the pool;
    - exit codes: 0 when all succeed, 1 when any failed, 2 when refused.
    - Usage comment at the top:

      ```
      DATABASE_URL=postgres://…/kh_phase2_test node scripts/migrate-store-themes.mjs --all --dry-run
      ```

- [ ] **Step 1: Write failing tests.**
  - `migrate-runner.test.ts`:
    - `migrationDatabaseAllowed('kh_phase2_test', null)` is true;
    - `('khatario', null)` false; `('khatario', 'khatario')` true; `('khatario', 'kh_phase2_test')` false; `('khatario', '')` false.
  - DB `store-theme-migrate.db.test.ts` (seed 3 businesses with `store_subdomain` and Grocery, Studio-saved and Khatario `store_theme`s; a 4th already has a live theme):
    1. **`refuses a database it was not allowed`:** the runner's database-name lookup (`currentDatabaseName()`, exported so it can be spied) is stubbed with `jest.spyOn` to return `khatario`.
       - With no `allowDatabase`, and with `allowDatabase: 'kh_phase2_test'`, the call rejects with `MigrationRefusedError`.
       - No other query runs (spy on `query`), and the `store_themes` row count is unchanged.
    2. **`dry run writes nothing`:** three `would_migrate` and one `skipped_live`; row counts unchanged.
    3. **`migrates once`:**
       - three `migrated` with presets `grocery`, `studio`, `khatario`;
       - each live theme's data sanitises to itself;
       - its home matches `migrateStoreTheme(raw, ctx).data.templates.home`.
    4. **`idempotent, leaves flags and old theme alone`:**
       - the second run gives four `skipped_live`;
       - `updated_at` is unchanged;
       - `store_engine` is false for all four (as seeded) and `store_theme` JSON is identical to the seed.
    5. **`businessIds only touches those`.**
    6. **`working draft and POST start from the migrated live theme`:** on a fresh business with a Khatario `store_theme` and no themes:
       - `getOrCreateWorkingDraft` creates a live theme with preset `khatario` and a working draft copying it;
       - on another fresh business with a Grocery `store_theme`, POST `{preset:'quick'}` through the route handler → the response theme is `role: 'draft'` with preset `quick`, and a live theme with preset `grocery` exists.
    7. **`preview links`:** with `previewLinks` and `JWT_SECRET` set, `preview_path` verifies (`verifyThemePreview`) to the new theme id for that business.
  - Update `store-themes-api.db.test.ts` `first POST is live…`: it becomes `first POST creates the migrated live theme and returns a draft`. The rest of that file uses the migrated live theme's id where it used the first POST's.
- [ ] **Step 2:** Run the unit file and the DB file: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx jest tests/lib/store`, `tests/db/store-theme-migrate.db.test.ts`, `tests/db/store-themes-api.db.test.ts`, `tests/db/store-themes.db.test.ts`, `tests/db/store-engine-load.db.test.ts` (all with `PHASE2_TEST_DATABASE_URL`) and `npx tsc --noEmit`: PASS.
- [ ] **Step 5: Script smoke on the test DB only.** Run:

  ```
  DATABASE_URL=<kh_phase2_test url> node scripts/migrate-store-themes.mjs --all --dry-run --report tmp-qa/engine-migration/dry-run.json
  ```

  Expected: exit 0, one line per store, nothing written. Then run it with `DATABASE_URL` pointing at a database named anything else on the same local server (for example `postgres`): exit 2, "Refusing to run on postgres". Do **not** run it without `--dry-run`; the DB test covers writes. Do not print the URL.
- [ ] **Staging test steps** (the script is **not** run on staging; that needs the owner's approval, Task 9):
  1. On a staging store that has never opened Studio 2, open "Edit store design (beta)". The working draft looks like that store's current pack (Grocery, Khatario, Quick or Studio), not the generic Studio home.
- [ ] **Step 6:** Commit: "A store's first engine theme is now its migrated design, whether made by the migration script, by opening Studio 2 or by creating a theme; the script refuses any database but the test one unless named exactly, skips stores that already have a live theme, and never touches store_engine."

### Task 8: Demo stores on the engine and the parity report script

**Files:**
- Create:
  - `lib/store/engine/parity.ts`, `scripts/store-engine-parity.mjs`;
  - `tests/lib/store/engine/parity.test.ts`, `tests/lib/store/engine/demo-engine.test.ts`.
- Modify: `lib/store/engine/load-theme.ts`, `lib/store/engine/page-loader.ts` (no editor mode for a demo theme)

**Interfaces:**
- Produces:
  - `loadEngineTheme(store, params: { preview_theme?, pt?, engine? })` returns `{ theme, preview, demo?: true } | null`.
    - **For `store.is_demo`:** `params.engine === '1'` gives `{ theme: demoEngineTheme(store), preview: true, demo: true }`, else null, as today.
    - **For other stores:** `engine` is ignored.
  - `demoEngineTheme(store): ThemeRow`:
    - `migrateStoreTheme(store.store_theme, { businessName: store.name, tagline: store.store_tagline ?? '', aboutMd: store.store_about_md ?? '', heroUrl: store.store_hero_image_url ?? '', logoUrl: store.logo_url ?? '', categories: <demo categories> })`;
    - id `00000000-0000-4000-8000-0000000000e1`, `role: 'live'`, `is_working: false`, `updated_at` = `'1970-01-01T00:00:00.000Z'`;
    - data sanitised.
  - `loadEnginePage` sets `editor: false` whenever `demo` is set.
  - **`parity.ts`**, pure, no imports beyond the migration report type:
    - `storeOrigin(base: string, subdomain: string): string`:
      - `http://localhost:3015` → `http://<sub>.localhost:3015`;
      - `http://127.0.0.1:3015` → `http://<sub>.localhost:3015`;
      - `https://staging.khatario.com` → `https://<sub>.staging.khatario.com`;
      - it **throws** for any other host (production included) and for a subdomain failing `/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/`.
    - `PARITY_WIDTHS = [390, 1280] as const`.
    - `parityTargets(input: { base: string; demos: boolean; report?: { rows: MigrationReportRow[] }; only?: string | null }): Array<{ label: string; oldUrl: string; newUrl: string }>` (D36). Labels are the subdomain, with demo labels prefixed `demo-`.
    - `parityHtml(rows: Array<{ label: string; oldUrl: string; newUrl: string; shots: Array<{ width: number; old: string; new: string }> }>): string`:
      - one section per label, old left and new right per width;
      - every label, URL and path HTML-escaped;
      - `preview_path` query values are shown as `pt=…`, never the token.
  - **`scripts/store-engine-parity.mjs`:**
    - flags `--base` (required), `--report`, `--demos`, `--only`, `--out` (default `tmp-qa/engine-parity`);
    - registers ts-node like Task 7 for `parity.ts`;
    - uses `chromium` from `@playwright/test` with the D36 shot settings;
    - writes the PNGs and `index.html`;
    - continues past a failed shot (a red "failed" cell in the HTML);
    - exits 0.
    - Usage comment:

      ```
      node scripts/store-engine-parity.mjs --base https://staging.khatario.com --demos --report tmp-qa/engine-migration/report.json
      ```

- [ ] **Step 1: Write failing tests.**
  - `demo-engine.test.ts`, with `@/lib/db` mocked to throw if called:
    - `loadEngineTheme(themeDemoStore('theme-grocery'), { engine: '1' })` returns `preview: true, demo: true`, with a theme whose preset is `grocery` and whose home has a `promo-cards` section;
    - without `engine` it returns null;
    - a non-demo store with `{ engine: '1' }` and no token: `queryOne` is mocked to return `{ store_engine: false }` → null.
    - Use the existing `themeDemoStore`; adjust to its real signature.
  - `parity.test.ts`:
    - `storeOrigin` cases above;
    - `storeOrigin('https://khatario.com','x')` throws, and `('https://evil.com','x')` throws;
    - `parityTargets` with `demos` gives 4 targets with `/?engine=1` new URLs;
    - a report with one `migrated` row (with `preview_path`), one `skipped_live` and one `migrated` without `preview_path` gives one target;
    - `--only` filters;
    - `parityHtml` escapes `<script>` in a label and never contains the token string from a `pt=` value.
- [ ] **Step 2:** Run both files: FAIL.
- [ ] **Step 3:** Implement. Do not run the parity script.
- [ ] **Step 4:** Run `npx jest tests/lib/store`, `tests/db/store-engine-load.db.test.ts` (with `PHASE2_TEST_DATABASE_URL`) and `npx tsc --noEmit`: PASS.
- [ ] **Staging test steps:**
  1. Open `https://theme-grocery.staging.khatario.com/` and `…/?engine=1` side by side at 390 px and 1280 px. They have the same sections in the same order and the same colours; the new one has the Preview badge.
  2. Repeat for `theme-khatario`, `theme-quick` and `theme-studio`.
  3. On a real store, `/?engine=1` is the normal storefront.
  4. Run the parity script against staging (Task 9 checklist) and read `tmp-qa/engine-parity/index.html`.
- [ ] **Step 5:** Commit: "The four theme demo stores show their migrated engine theme with ?engine=1, and a parity script screenshots old and new storefronts side by side at phone and desktop width on localhost or staging."

### Task 9: M4 staging checklist and project log

**Files:**
- Create: `docs/superpowers/plans/2026-10-31-store-engine-m4-staging-checklist.md`
- Modify: `docs/project.log.md` (append only)

**Interfaces:**
- Consumes: the staging test steps of Tasks 1–8.

- [ ] **Step 1: Write the checklist**, in the M3 checklist's format.
  - **Before deploying:** no new SQL migration; 450 and 453 still pending on staging.
  - **One section per task**, with that task's staging steps.
  - **"Migration on staging (owner approval required)":**
    1. The owner approves.
    2. Dry run on the staging server:

       ```
       DATABASE_URL=<staging url> node scripts/migrate-store-themes.mjs --all --dry-run --allow-database <staging db name> --report tmp-qa/engine-migration/staging-dry.json
       ```

       Read the warnings.
    3. The real run with `--preview-links`.
    4. Run the parity script with `--base https://staging.khatario.com --demos --report …`.
    5. The owner reviews `index.html` before any `store_engine` is turned on.
  - **"Known differences" list:** D28's dropped features, and product/catalog staying classic on migrated stores (D31).
- [ ] **Step 2: Append the M4 entry to `docs/project.log.md`** (Asked / Decided / Shipped / Open, as the M3 entry).
  - `docs/project.log.md` has another session's unstaged edits. Stage only the new entry:
    1. build the blob from `git show HEAD:docs/project.log.md` plus the entry;
    2. `git hash-object -w`;
    3. `git update-index --cacheinfo`.
  - Stage the checklist by path.
- [ ] **Step 3:** Commit: "Log store theme engine M4 (presets and migration) and list what to check on staging, including the owner-approved migration and parity run."
