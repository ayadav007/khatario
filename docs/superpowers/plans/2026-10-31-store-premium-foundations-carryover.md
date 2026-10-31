# Premium store theme foundations: carry-over and staging checklist

Plan: `docs/superpowers/plans/2026-10-31-store-premium-foundations.md`. Spec: `docs/superpowers/specs/2026-10-31-store-premium-themes-design.md`.

Branch `claude/premium-foundations` (worktree), commits `2aefae0a..7daec744` plus the Task 10 commit. Nothing is pushed or merged. Tasks 1 to 9 were built and reviewed without a browser (owner's rule: test on staging); **nothing here has been looked at in a browser**. The Studio 2 manual check that Task 10 step 2 called for was moved to the staging checklist below by controller ruling.

## What shipped

| Task | What | Commit |
|---|---|---|
| 1 | Six fonts: Cinzel, Newsreader, Manrope, DM Serif Display, Lora, Poppins (`next/font/google`, `preload: false`) | `3cfb8a8c` |
| 2 | Theme Style settings `label_style`, `frame_style`, `texture` and root classes `eng-labels-caps`, `eng-frame-accent`, `eng-texture-<t>` | `ba6be0cb`, fix `3b40c3fa` |
| 3 | Product `store_badge`, `store_tagline`, `store_swatches` (migration 458) through validation, both item routes and the public item route | `1dd400f3` |
| 4 | Item form "Card" group (`components/store/admin/ItemStorePageFields.tsx`, `app/(app)/items/new/page.tsx`) | `10a739c1` |
| 5 | Cards show badge, tagline (`.ptag`) and swatches (`.pswatches`); `show_tagline` / `show_swatches` on Featured products and Product rail | `e406b230`, fix `5c5ab5cd` |
| 6 | Products-by-id loader (`productsById` on `SectionData`) | `721f8cd2` |
| 7 | Content blocks in Image with text and Rich text; one-time conversion of old themes; presets, starters and Studio migration emit blocks | `fdcda07c` |
| 8 | Content blocks render; preset parity test | `c3077519`, fix `9642252b` |
| 9 | Testimonials (`title`, `location`, `purchased`, `show_summary`), Logo list (`name`, `caption`), Promo cards 4 columns, Multicolumn column `image` | `7daec744` |
| 10 | Three e2e scenarios, `next build` check, this document | this commit |

## Before deploying (owner approval required)

**Migration `database/migrations/458_store_product_card_fields.sql` has only ever run on the disposable DB `kh_phase2_test`.** The owner runs it on staging; agents never do. It is idempotent (`ADD COLUMN IF NOT EXISTS`) and adds `items.store_badge varchar(24)`, `items.store_tagline varchar(60)`, `items.store_swatches jsonb NOT NULL DEFAULT '[]'`.

If the code ships before the migration, the store item list query and the public item route select the new columns and fail, so storefront product lists break. Run 458 first.

- [ ] The owner approves the migration run.
- [ ] 458 runs on staging before the code is deployed. Check the migration number does not clash with another session's file (the M5 carry-over already noted a 448 and an untracked 455 elsewhere).
- [ ] No script runs for this work.
- [ ] Old themes convert on load, not in the database: an Image with text or Rich text with the old settings (`heading`, `text`, `button_label`, `button_link`, `content`) becomes blocks in memory the first time the theme is read, and is stored as blocks only when the owner next saves or publishes. Nothing to backfill.
- [ ] `store_engine` stays off for every real store throughout. Use the engine test store with it on.

## Build check (Task 10)

`npx next build` is the only thing that exercises the six new `next/font/google` declarations in `app/store/layout.tsx`. The first build **failed**: `Failed to find font override values for font 'Newsreader'` (Next 14.2.33 has no fallback-metric entry for that family). Fixed with `adjustFontFallback: false` on the Newsreader declaration only; the second build passed (exit 0, all routes generated). Consequence: Newsreader has no size-adjusted fallback face, so a store using it can show a small layout shift on the first paint before the font arrives; look at it on staging. The other five declarations (Cinzel, Manrope, DM Serif Display with `weight: '400'`, Lora, Poppins with four weights) built as written. The build also writes an untracked `public/worker-*.js` (PWA worker); it was deleted, not committed.

## Staging checklist

Engine test store with `store_engine` on, merchant login with settings permission (staging E2E keys from `.env`). The e2e scenarios added to `e2e/store-studio2.spec.ts` cover part of this locally on the test DB; they are written, not run.

### 1. Fonts (Task 1)

- [ ] Theme settings, Heading font and Body font lists show Cinzel, Newsreader, Manrope, DM Serif Display, Lora and Poppins (the label reads "DM Serif Display", not "DM Serif").
- [ ] Pick each in turn: the preview text changes face. Network tab shows the font file loaded only when a theme uses it (`preload: false`).
- [ ] Default heading font Outfit: reload a store using it and watch for a visible swap of the heading face on first paint. `preload: false` was added to Outfit as well; if the swap is ugly, restore preloading for Outfit only.
- [ ] A store on the default fonts loads none of the six new files.
- [ ] Newsreader (declared with `adjustFontFallback: false`, see the Build check): reload a store using it and watch for a layout shift when the font arrives; if it is visible, add `fallback: ['Georgia']` or similar to that declaration.

### 2. Style settings (Task 2)

Theme settings, Style group: Label style, Frame style, Background texture.

- [ ] Spaced capitals: eyebrows, badges, small labels and the header menu links go uppercase with letter spacing. Known gap: `.nav button` (menu items that are buttons) is not covered by the caps rule; look at a header with a button menu item.
- [ ] Thin accent border: product cards, promo cards, collection pictures and the hero image get a 1px accent border. **Check `.heroImg` for a 1px layout shift** (the border adds to its box) and `.eng-collection-img` for the border following the corner radius.
- [ ] Frame rule wins over the card style (Bordered, Shadow, Minimal) only by CSS concatenation order (`THEME_RULES + CONTENT_BLOCK_RULES + STYLE_RULES`): confirm the accent border shows on all three card styles.
- [ ] Dots, Linen, Grid: each draws on sections that have **no** colour scheme and on sections that **do** (scheme or custom colours); the pattern must not hide section text or the inline background colour. Linen and Grid at phone width.
- [ ] Inspect the preview root: `eng-labels-caps eng-frame-accent eng-texture-dots` as classes when all three are set; none when all are back at the defaults.
- [ ] Publish with the three set: the live storefront has the same classes and look.

### 3. Product card fields in the item form (Tasks 3 and 4)

Items, edit an item that is shown in the store, "Card" group above the video field. **The manual form check was never done.**

- [ ] Badge on the photo (24 characters max), Tagline above the name (60 max): both show a counter or stop at the limit, save, and come back after reload.
- [ ] Add colour: up to 6 swatches, the button disables at 6 and the counter reads "6 of 6". Each swatch has a colour box and a name (30 max). Remove works on a row in the middle of the list (all remove buttons have the same accessible name, so check by eye).
- [ ] A swatch colour saved as 3-digit hex (`#abc`) by an API call shows in the colour box correctly: the browser colour input needs 6 digits, the validator keeps 3.
- [ ] Clear the badge and tagline: they save as empty and the card drops the lines.
- [ ] Console check, signed in as the store's admin: `fetch('/api/items/<id>').then(r=>r.json())` returns `store_badge`, `store_tagline`, `store_swatches`; the public item route for the same item returns them too.
- [ ] A save that sends 7 swatches (API call) is refused with "Up to 6 swatches."

### 4. Cards (Task 5)

Featured products or Product rail in Studio 2, on an item with the three fields.

- [ ] Show tagline and Show colour swatches are off by default and change nothing on an existing store when left off.
- [ ] Turned on: the tagline sits above the product name (`.ptag`), small dots after the price (`.pswatches`), hover on a dot shows the colour name. Items without the fields show neither line and no empty gap.
- [ ] A product with a custom badge shows that badge instead of "NEW"/highlight, and **keeps** the struck-through MRP next to the price when the product has a discount (only the "% OFF" badge is dropped).
- [ ] Product page Title block has a Show tagline switch (off by default); on, the tagline shows under the product title.
- [ ] Phone width: swatches and tagline do not overflow a 2-column card.

### 5. Products-by-id loader (Task 6)

No section uses it yet (plan 2 sections will), so there is nothing to see on staging.

- [ ] Nothing to check on screen; the DB suite `tests/db/store-section-products-by-id.db.test.ts` is the proof. Look again when the first section built on `productIds` lands.

### 6. Content blocks (Tasks 7 and 8)

- [ ] **Old themes convert.** Open an existing theme from the library that has an Image with text and a Rich text: each shows the same text, button and image as before, now as blocks (Heading, Text, Button for Image with text). Heading size looks the same as before (hero heading `clamp(24px,5cqi,40px)`), and Grocery's hero heading keeps its large heavy style.
- [ ] Open the live storefront of a store that was on the old settings, before touching anything: it looks the same as before the deploy.
- [ ] Add an Image with text: Add block offers Eyebrow, Heading, Text, Quote, Checklist item, Button, Highlight card (Highlight card is offered once). Add one of each, drag to reorder, hide one with the eye; the preview follows each step. Reload: same order and hidden flag.
- [ ] Highlight card sits over the image's lower outer corner on desktop (left corner for image on the left, right corner for image on the right) and stacks under the image on a phone. Text on the card is readable and not clipped.
- [ ] Image width Narrow (about 40/60 split) on desktop; phone stacking unchanged.
- [ ] Text align Centre really centres the heading, text, buttons and quote (the quote drops its left rule).
- [ ] Two buttons sit in one row; Outline style looks like an outline in the store's button colour.
- [ ] A Text block followed by a Button: the gap looks like one block gap, not a doubled one.
- [ ] Rich text: heading, text and quote blocks render centred or left per the Align setting.
- [ ] An empty Heading or Text block draws nothing (no blank gap).
- [ ] The page starters (About, Sale, Contact, Blank) and the Khatario preset tagline add blocks and look like they did before.

### 7. Small block upgrades (Task 9)

- [ ] Testimonials: Title, Location and Purchased on a block show as a bold title above the quote and "location · Bought: x" after the name. Show summary on: a line like "4.8 average from N reviews" under the heading; off by default. A rating of 4.96 or higher: see the rounding item in the deferred list.
- [ ] Logo list: a block with **only a name** shows the name in the heading font where the logo would be; a block with an image and a caption shows the caption under it; a block with neither is not drawn. Logos still centre and wrap as before on every preset (`.eng-logos li` is now a flex column for all stores).
- [ ] Promo cards: Columns goes to 4 on desktop; on a phone it holds 2 per row at 4 columns. **Split promo cards at 4 columns on a phone look cramped**: check and decide whether to cap phone columns lower for the split layout.
- [ ] Multicolumn: a column with a photo shows the photo instead of its icon, sized to fit the column; columns without a photo are unchanged.

### 8. Whole editor pass (Task 10 step 2, moved here)

- [ ] Theme settings, Style: pick Spaced capitals, Thin accent border and Dots; the preview updates (root classes visible in the inspector).
- [ ] Add an Image with text and add one block of each type; reorder; disable one; the preview follows.
- [ ] Featured products: Show tagline and Show colour swatches on a store whose item has them.
- [ ] Testimonials: fill Title, Location, Purchased; Show summary.
- [ ] Logo list: a block with only a name. Promo cards: 4 columns. Multicolumn: a column with a photo.
- [ ] Undo and Redo after each of these edits; Publish and look at the storefront; open the version history and restore the previous version.

## Deferred minors (found in review, not fixed)

One line each, so the staging pass and the final review see them.

**Task 1, fonts**
- No test for the `FONT_LABELS['dm-serif']` label ("DM Serif Display"), and the settings test does not assert that `'system'` stays rejected; the `!== 'system'` filter appears in both `settings.ts` and `editor/fields.ts`.
- `preload: false` on Outfit (the default heading font) may delay the first font swap slightly; check on staging (checklist 1).
- The `next/font/google` declarations are checked only by `next build` (see the Build check section).

**Task 2, style settings**
- The caps selector misses `.nav button`.
- The frame rule beats the card styles only by concatenation order in `EngineShell` (add a comment or a specificity bump if the order ever changes).
- `style-rules` test checks substrings and `!important` flags, not the cascade.
- Frame border on `.heroImg` adds 1px to its box; `.eng-collection-img` and every texture visual are unchecked (checklist 2).

**Task 3, product extras**
- `product-extras` tests miss: non-array swatches error, `null` becoming `[]`, name clipping, non-string badge error, exactly-6 accepted; the 7-swatch test checks only `ok = false`.
- Empty swatch names are kept as `''`; trim-then-slice can leave a trailing space on a clipped value.
- 3-digit hex is kept (lower-cased) while the browser colour input needs 6 digits (normalise to 6 on save or expand on load).
- The extras key list is duplicated in both item routes (pre-existing pattern).

**Task 4, item form**
- Manual form check not done (checklist 3).
- The remove-swatch button has the same `aria-label` on every row; swatch rows use `key={i}`; the "Card" group heading is a bare `span`, not a heading element.
- `loadedStorePage` is not refreshed after a save (pre-existing behaviour for all extras).

**Task 5, cards**
- The card-look test is weak: nothing reads `tagline`/`swatches` through `productCardLook`, so tsc is the only guard; `showTagline ?? look` precedence is untested.
- Swatch `key` is hex + name and can collide; swatch dots are title-only (no `aria-label`).
- A custom badge is capped only by the product-extras sanitiser (24 characters).

**Task 6, products by id**
- Uppercase UUIDs pass the id regex but miss the lowercase row id in the lookup (lowercase before the lookup).
- Demo product ids (`grocery-5`) are not UUIDs, so demo stores never get `productsById`; the demo branch of `loadProductsById` is unreachable. Fine today because the `product` setting sanitiser also refuses non-UUID ids; plan 2 must make demo ids UUIDs if a demo store needs Heritage sections.
- The DB test title says "one query" but asserts no query count; there is no page-wide ceiling on the union of ids (12 per section only).

**Task 7, conversion**
- "Already has blocks" is judged by `block_order.length` only: dangling ids would skip conversion and lose text (unreachable for sanitised data).
- `migrate-studio` always pushes a text block even when the Studio text is empty (the Task 8 renderer drops empty blocks, so it draws nothing).
- A whitespace-only button label now makes no button; the junk-input test asserts only `not.toThrow`; the starter fixtures are unsanitised `{sections: [...]}`.

**Task 8, rendering**
- Visual checks never done: highlight card, narrow image, phone stacking, centring, hero heading size, outline button (checklist 6).
- The content-block-rules scope test cannot see rules inside `@container` blocks.
- Extra highlight cards beyond the first are silently dropped; quote size and eyebrow width inside `.rich` differ slightly from the hero; `role="img"` with an empty aria-label when the section has no heading; dead `.eng-iwt-narrow` `flex-basis` rule (the hero is a grid); phone image height 240px is hard-coded.
- A `<p></p>`-only rich text value passes the empty check and renders an empty div (unchanged from before).

**Task 9, block upgrades**
- `summaryLine` uses `toFixed`: binary rounding means a 4.96 average or higher shows "5.0".
- `.eng-logos li` is now a flex column for every store; a single-child `li` should look as before but is unchecked.
- Split promo cards are cramped at 4 phone columns.
- No render-level tests for the summary gate, the logo keep rule, the promo clamp / `data-cols`, or the multicolumn image swap; the schema test is shape-only.
- An image logo's `alt` could fall back to the block `name`; `cleanUsps` (the legacy Studio sanitiser) strips `image`, so a photo column does not survive on the legacy Studio path (engine only).

## Found in Task 10

- The e2e spec lives at `e2e/store-studio2.spec.ts` (the task brief said `tests/e2e/`, which does not exist). The three new scenarios are written, not run; like the others they need the local test DB wrapper and a dev server, and the card-switches scenario rewrites `items.store_tagline` and `items.store_swatches` for the store's visible items and restores them in a `finally`.
- The content-blocks scenario does not assume which blocks the Image with text preset adds; it reads them back. It uses the same `drag to reorder` mouse sequence as the section-reorder scenario, which is the least stable part of the file: if it flakes, check dnd-kit's activation distance first.
- Style settings and card-switch scenarios assert on `.eng-root` and `.ptag` / `.pswatches` in the preview iframe; none of the three checks looks (colours, spacing), only structure.
- `next build` writes `public/worker-*.js` (PWA). Do not stage it.

## Plan 2 (Heritage Couture) entry points

- Sections can ask for products by id (`SectionDataRequest.productIds`, `SectionData.productsById`); no section uses it yet.
- Fonts Cinzel, Newsreader, Manrope, DM Serif Display, Lora and Poppins are available; Style settings, card fields and block upgrades are the tools Heritage Couture builds on.
- Merge note: this branch carries the Task 5 and 9 changes to `EngineViews.tsx` and `StudioSections.tsx`, which the menus session also edits in the main checkout; expect conflicts there when merging into `main`.
