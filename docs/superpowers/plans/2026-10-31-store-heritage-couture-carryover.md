# Heritage Couture (premium theme, plan 2): carry-over

Plan: `docs/superpowers/plans/2026-10-31-store-heritage-couture.md`. Spec: `docs/superpowers/specs/2026-10-31-store-premium-themes-design.md` (§4, §6, §7, §8, §9). Staging checklist: `docs/superpowers/plans/2026-10-31-store-heritage-couture-staging-checklist.md`. The checklist for the next theme: `docs/store-engine/design-to-preset.md`.

Branch `claude/heritage-couture` (worktree), base `658369e2` (plan 1 merged to `main`), commits `13c23018..` the Task 7 commit. Nothing is pushed and the branch is not merged. Built and reviewed without a browser (owner's rule: test on staging); **nothing here has been looked at in a browser**, and the five e2e scenarios were written, not run.

## What shipped

| Task | What | Commit |
|---|---|---|
| Plan | Implementation plan | `13c23018` |
| 1 | Schemas for Collage, Shop the look and Image gallery; a section's `data()` now receives its blocks (`blockProductIds`), so product tiles and hotspots load their products | `a5bf01f1` |
| 2 | Collage renderer, tile link, `collage-map.ts`, CSS | `7bb8c4f9`, fix `871bc93d` |
| 3 | Shop the look renderer (server and client parts), `shop-the-look-map.ts`, CSS | `18d21519` |
| 4 | Image gallery renderer, `image-gallery-map.ts`, CSS | `a1e214a7`, fix `04eac1c5` |
| 5 | The `heritage` preset, fixed colour schemes (`PRESET_SCHEMES`), `PRESET_CARD_FIELDS`, nine SVG pictures | `5cd0c72b`, fix `be70bb6e` |
| 6 | Premium flag: migration 459 `business_settings.store_premium_themes`, `premium.ts`, `premium_enabled` on GET, `403 premium_locked` on POST, `visiblePresetChoices`, the "Premium" pill | `95ba7ccb` |
| 7 | Five e2e scenarios, the staging checklist, `design-to-preset.md`, this carry-over | the Task 7 commit |

## Owed at merge

- **The project log entry and the roadmap card are the controller's.** By controller ruling, nothing on this branch touches `docs/project.log.md` or `docs/roadmap.md`: the main checkout's copies already carry other sessions' entries and would conflict. The controller writes the `docs/project.log.md` entry (required by AGENTS.md) and the `docs/roadmap.md` card ("Heritage Couture built, staging checks owed") in the main checkout at merge time. If that does not happen, the AGENTS.md requirement is silently lost.
- **Verification counts for that entry (at the Task 7 commit):**
  - `npx jest tests/lib/store tests/db/store-premium-flag.db.test.ts tests/db/store-section-products-by-id.db.test.ts` (the DB suites against `kh_phase2_test`): **119 suites, 1342 tests, all pass**.
  - `npx tsc --noEmit -p .`: clean. The two e2e spec files, which that tsconfig excludes, were type-checked separately: clean.
  - `npx next build`: **passed, exit 0, 343 static pages generated**. The only noise is the existing `jose` "Edge Runtime" warnings through `lib/jwt.ts`. It wrote an untracked `public/worker-*.js` (PWA), which was deleted, not committed.
  - E2E: five scenarios written, **not run** (they need the local dev server on the test DB with `STUDIO2_E2E=1`).
- **Decisions to log:** all three new sections are general (Collage, Shop the look, Image gallery work in every preset, on the pages their `templates` list). Premium presets sit behind a per-store flag (`business_settings.store_premium_themes`, migration 459, default off); the flag only gates **creating** a premium preset (POST with `source: 'preset'` and no `duplicate_of`); duplicating, editing, publishing, restoring and migrated themes are never gated, so a store that loses the flag keeps and edits what it has. POST order: tenant permission, plan gate, body validation, premium gate. A preset with a fixed scheme table ignores the store accent (ruling below). Preset copy is neutral or instructional (ruling below). Phone strip in Image gallery is about 2.2 items per view regardless of Columns (ruling below).
- **Open for the owner:** migration **459 has only run on `kh_phase2_test`**; the owner runs it on staging (and 458 from plan 1, still owed) before deploying; the flag has **no admin screen**, so it is switched on by hand in the database for the test store; nothing is pushed or merged.
- **Migration numbers:** 459 was free when checked before dispatch. Check again at merge that no other session has taken it (earlier carry-overs noted clashes at 448 and 455).

## Rulings (controller, with their cost)

- **Fixed schemes ignore the store accent.** A preset with a fixed scheme table (`PRESET_SCHEMES`) uses it as written. The spec's "accent replaces crimson when set" assumed accent could be unset; `sanitizeStoreTheme` always defaults it, so honouring it would mean no store ever shows crimson. *Cost:* a store with a strong brand colour gets the crimson theme until the merchant edits the schemes in Studio 2; visible and reversible.
- **Readable gold on the light papers.** Ivory, Parchment and Cream use `readableAccent(gold, background)` for `accent` (a deeper antique gold that reaches 3:1); gold stays as given on Crimson, Dark and Gold. *Cost:* eyebrows on the light papers are slightly darker than the design's gold.
- **Neutral placeholder copy.** The announcement defaults to the store's tagline, else `Welcome to <name>`; the four promise titles are "Delivery", "Materials", "Made to measure", "Personal service" with texts that tell the merchant what to write; the press heading is "Add your press mentions". The spec's "neutral copy" rule won over the brief's sample lines. *Cost:* none. **The plan file still shows the old sample copy** and is stale against this ruling; this carry-over and `presets/heritage.ts` are right.
- **Phone strip is 2.2 items per view.** In Image gallery's scrolling strip on phones each item is `calc(100%/2.2)` (the next picture peeking) whatever Columns says; desktop keeps `calc(100%/Columns)`. The spec's "or the strip" left the phone count open, and four per view was unreadable. *Cost:* a CSS tweak if the owner wants otherwise.
- **Briefs vs spec §6:** the brief governs where they differ (one quote and summary off, empty logo captions, `studioFooter()` for the footer).
- **No log or roadmap entry on the branch** (see Owed at merge).
- **Final-review fix wave (rulings 1 to 4).** (1) **Our story page:** `about` is a reserved page handle (`RESERVED_PAGE_HANDLES`), so `/pages/about` always 404s; the preset ships a custom page template `page.our-story` (title "Our story", the About starter's two sections with instruction copy) and the menu link, the Collage's second button and the Image with text button all point to `/pages/our-story`. (2) **Remaining claim copy made instructional:** the story heading is "Tell the story of your craft", the highlight card is "Your promise / Add the one promise you make / One sentence shoppers can hold you to.", the newsletter is "Stay in touch / Say what shoppers get when they sign up."; the three old strings are in the banned-claims test. (3) **Flag-on e2e names the draft:** the modal sends no name when the field is empty (the server says "Untitled theme"), so the scenario and checklist section 1 type "Heritage Couture" first. (4) **Fix-now minors:** Add all and `lookTotal` dedupe by product id (first hotspot wins); the themes GET reads `premium_enabled` as false if the flag read throws (POST still fails closed); checklist and carry-over wording corrected.

## Open items

- **Staging checks** (the checklist): everything visual, above all the nine SVG pictures (never seen by eye; the browser could not render local files), the Collage at three tiles and at two, Shop the look pin placement and card positions at 390 px, the phone strip, scheme contrast on every paper, Newsreader's missing fallback metrics (plan 1), and the product page tabs.
- **Plan 1's list is still open.** `docs/superpowers/plans/2026-10-31-store-premium-foundations-carryover.md` has a full staging checklist (fonts, Style settings, item form "Card" group, cards, content blocks, small block upgrades, whole editor pass) that has **never been run on staging**; migration 458 has not been run on staging either. Section 6 of the Heritage checklist points to each part. Plan 1's own deferred-minor list stays in that file.
- **No admin screen for the premium flag.** Owner flips it in the database.
- **Brain / log.** AGENTS.md asks every session to append a project-log entry; the controller does it for this plan (above).
- **Demo stores.** `loadProductsById` skips demo product ids (not UUIDs), so a demo store that previews Heritage sections with products shows none; plan 1 noted it. Not reachable today.
- **The plan file's sample copy** is stale (ruling above); edit it if the plan is reused.

## Deferred minors (found in review, not fixed)

One line each, by task.

**Task 1, schemas and block-aware data**
- The block-list type is written out twice (export a `SectionBlockInput`).
- Eyebrow and heading definitions are repeated across the three schemas (the codebase pattern).
- No test on `product_tile` / `category_tile` settings; the hotspot test does not assert that the product UUID survives sanitising.
- The sections appear in the Add section dialog before their renderers existed on the branch (resolved: Tasks 2 to 4 landed first).

**Task 2, Collage**
- The rules test's scope check misses rules inside `@container` blocks.
- With the tiles-only layout the first tile is featured on phones but not on desktop.
- Product and category tiles use `alt=""` (their name is in the caption), so the link is named by the caption only.
- Near-white caption text on a photo-less tile relies on the `#2b2b2b` fallback.
- The server-rendered tile `href` lacks the preview params (open-in-new-tab leaves the preview; a plain click keeps them).
- The mapper does not cap at 4 tiles (the schema's `max_blocks` does).

**Task 3, Shop the look**
- The open card is rendered after all pins (keyboard order), and focus does not move into the card.
- A pin's name is its label only; "Added" has no `aria-live`.
- Esc always refocuses the pin; the outside-close on `pointerdown` can fire on a touch scroll.
- The same product in two hotspots is added twice by Add all (fixed in the final-review fix wave: `addableProducts` dedupes by product id).
- A card on a pin near x 30 or 70 can overhang the photo on narrow phones; the photo has no reserved aspect; the pin size assumes border-box.
- The full `StoreItem` is serialised per hotspot into the client component (brief-mandated type).
- The CSS variables are `--c-btn` / `--c-btn-text` (the brief said `--c-button`). With Show product list off and Add all on, only the Add all button shows (accepted).
- There are no component-level (DOM) tests; Esc, outside-click and Add all were checked by reading.

**Task 4, Image gallery**
- A caption-link hover has no behaviour of its own (the picture is the link, by design).
- The test title is half true; the fourth hand-rolled clamp helper is untested.
- "Gallery image N" is hard-coded English; `galleryAlt` reads the raw hover value while `galleryClass` normalises it.
- Masonry has a trailing margin; the strip's focus ring is clipped at its edge; a prefix check was widened for `@media`.

**Task 5, Heritage Couture preset**
- The accent-slot approach was replaced by the fixed table; the 3:1 threshold also applies to button labels.
- Crimson's border and card colours are derived, not hand-picked; Parchment and Cream borders are mixed against their own paper.
- `escapeHtml` is duplicated in the preset.
- The tagline appears three times (announcement, collage text, footer about).
- The same four pictures serve both the promo cards and the gallery.
- "Add your press mentions" sits over placeholder names; the gallery SVGs sit on a parchment ground.
- Shop the look with no hotspots shows the editor-only note, and shoppers see the photo and heading but no list (staging check). The header search default comes from the header schema (`show_search` default true).

**Task 6, premium flag**
- The premium check in POST sits outside the route's try/catch: a DB error there gives a 500 without a JSON body (it fails closed).
- No test pins the order (permission and plan denial before the flag lookup); `duplicate_of: null` is untested.
- The modal keeps a hidden premium choice selected if the flag flips mid-session; `visiblePresetChoices` is called inline in render.

**Task 7, e2e**
- The Shop the look scenario publishes and clicks the pin as a shopper, because the editor preview's click guard swallows clicks; it also relies on the product having stock and no options in the test DB (`storeProduct(true)` looks at `items.current_stock`, not the branch stock the storefront may use). If the first store product is sold out on the storefront the card shows "Sold out" and the scenario fails; pick another product.
- The Collage and Image gallery scenarios assume the starter presets add three image tiles and four image blocks and that tiles and images with no picture are not drawn.
- The library scenarios restore the flag in `finally` and again in `afterAll` from the value read at the start; the existing `restore()` does not cover `store_premium_themes`.
- The Add theme modal's option label nests the "Premium" pill inside the label span, so `getByText('Heritage Couture', { exact: true })` (what `addTheme` uses) does not match it; the new scenarios select it by `label` plus `hasText`. Extend `addTheme` if more premium presets get scenarios.

**Final review, deferred**
- A stale "Saved" pill waits in the e2e scenarios: they read or act while the editor's Saved indicator may still show an earlier save, so a wait on it can pass too early.

## 2026-11-01: premium presets are free for now

Owner decision: "make it free now, we will work on pricing later". `PREMIUM_THEMES_FREE = true` in `lib/store/engine/premium.ts` makes `premiumThemesEnabled` answer true for every store, so Heritage Couture is listed (with its Premium pill) and creatable everywhere on the online-store plan without touching `store_premium_themes`. The column, migration 459, `premiumFlagOn` and the POST refusal all stay: flipping the constant to `false` gates by the column again. The library e2e "stored switch off" scenario now expects the free behaviour; its comment says what to restore when pricing lands. Staging no longer needs the flag update in §1 of the checklist.
