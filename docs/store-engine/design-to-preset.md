# From a design to a premium preset

The checklist for the next premium theme (the way Heritage Couture was made). Read it with `docs/superpowers/specs/2026-10-31-store-premium-themes-design.md` and keep `lib/store/engine/presets/heritage.ts` open as the template.

The rule behind everything below: **nothing in code is specific to one theme.** A new design becomes mostly a preset file (a list of sections with settings and placeholder copy, a look, a few colour schemes). Anything the design needs that the engine cannot do becomes a general section, setting or product field that every store can use, never a "Heritage hero".

## 1. List the design's parts, top to bottom

Open the design (Figma, screenshots, a reference site) and write one line per band of the page, in order, for each page the design covers: announcement bar, header, each home band, footer, product page, catalog. Next to each line note what it shows: eyebrow, heading, text, buttons, pictures, products, icons, numbers, a link target. Note the **tablet and phone** version of each band if the design shows one. Include the global look: fonts, colours, corner radius, borders, texture, label capitals.

## 2. Map each part to a section type

Use the table below. A part can usually be one section with blocks; two bands that share a background are still two sections. Prefer the existing section even if it looks slightly different, then list the difference as a gap (step 3).

| Section (`type`) | Pages | What it can show |
|---|---|---|
| Announcement bar (`announcement`) | header | One line of text with an optional link |
| Header (`header`) | header | Logo, menu (links, columns), search, account, cart, delivery estimate, category chips |
| Footer (`footer`) | footer | Menu columns, about text, social, payment icons, badge |
| Slideshow (`slideshow`) | home, page | Up to 6 slides: picture, heading, text, button; autoplay |
| Image banner (`image-banner`) | home, page, catalog | One picture with heading, description and a button |
| Collage (`collage`) | home, page | A text panel (eyebrow, heading, text, two buttons) beside up to 4 tiles: image, product or category; first tile larger or all equal; portrait or square |
| Promo cards (`promo-cards`) | home, page | Up to 4 cards with picture, eyebrow, heading, button; overlay or split style; 2 to 4 columns |
| Countdown (`countdown`) | home, page | A timer to a date with a button |
| Image with text (`image-with-text`) | home, page, product | A picture beside content blocks: eyebrow, heading, text, quote, checklist item, button, highlight card |
| Rich text (`rich-text`) | home, page, product, catalog | A centred or left column of the same content blocks |
| Multicolumn (`multicolumn`) | home, page, product, catalog | Up to 6 columns: icon or photo, title, text |
| Marquee (`marquee`) | home, page | A scrolling line of short items |
| FAQ (`faq`) | home, page, product, catalog | Question and answer pairs, opening and closing |
| Testimonials (`testimonials`) | home, page, product | Quotes with name, title, location, purchased item, rating; optional average line |
| Logo list (`logo-list`) | home, page | Logos or names with captions (press, brands, certifications) |
| Featured products (`featured-products`) | home, page, product, catalog | A grid of products from a source (featured, category, price cap), 2 to 6 columns, card style, badges, rating, tagline, swatches |
| Product rail (`product-rail`) | home, page, product, catalog | Products in a sideways rail |
| Category grid (`category-grid`) | home, page | Category pictures in a grid |
| Category shelves (`category-shelves`) | home, page | Several categories, each with a row of its products |
| Collection list (`collection-list`) | home, page | Up to 12 picture links to collections |
| Shop the look (`shop-the-look`) | home, page, product | One photo with up to 6 numbered product pins that open a card, plus a product list and Add all to bag |
| Image gallery (`image-gallery`) | home, page, product | Up to 16 pictures as a grid, masonry or scrolling strip, with caption, subcaption and link |
| Video (`video`) | home, page, product, catalog | A YouTube or Vimeo video with heading and cover picture |
| Newsletter signup (`newsletter`) | home, page | Heading, text, email box |
| Spacer (`spacer`) | home, page, product, catalog | Vertical space, separate heights on desktop and phone |
| Custom HTML (`custom-html`) | home, page, product, catalog | Sanitised HTML (last resort) |
| Product information (`main-product`) | product | Blocks: title (with optional tagline), price, variant picker, buy buttons, description, collapsible tabs, delivery estimate, share, custom text |
| Reviews, Related products, Recently viewed | product | The product page's own bands |
| Product grid (`main-catalog`) | catalog | The catalog grid with columns, filters, sort, count and promo slots |
| Catalog banner (`catalog-banner`) | catalog | Heading, text and picture at the top of the catalog |

The schemas are the truth (`lib/store/engine/sections/*.ts`); the table is a map. Every section also takes a colour scheme and the usual spacing and custom CSS settings. A section's `templates` list says where the Add section dialog offers it.

## 3. Decide each gap

For every part that no section covers exactly, choose one, in this order:

1. **A setting or block on an existing section** when the difference is a variation of something the section already is (a column count, a layout switch, one more optional line). Example: Promo cards got a fourth column; Multicolumn columns got a photo.
2. **A new general section** when the design needs a different structure that other stores would want too. Name it for what it **is**, not for the design that asked for it. Examples: "Collage" (text beside image, product and category tiles), not "hero mosaic"; "Image gallery" (grid, masonry or strip), not "Instagram wall"; "Shop the look" (a photo with product pins), not "lookbook". If you cannot name it without the design's name in it, it is probably too specific: split it or generalise it.
3. **Out of scope** when it is decoration or behaviour the engine should not own (a parallax effect, a custom animation, a third-party widget, a bespoke checkout). Say so in the carry-over and ship the closest thing the engine can do. Custom HTML is a last resort and never a way to build a design's hero.

Write the decision for each gap down before coding, with the one-line reason. A new section gets: a schema in `lib/store/engine/sections/`, registration in `lib/store/engine/registry.ts` and (for rendering) `components/store/engine/registry.tsx`, its CSS in `components/store/engine/premium-section-rules.ts` (all rules under the `.st-root.eng-root` scope, phone-first, using the engine's colour variables `--c-btn`, `--c-btn-text`, `--c-text`, `--c-bg` and the card variables, never fixed colours), a pure mapper in `lib/store/engine/*-map.ts` when it turns blocks into display items (client-safe, takes a `settingsOf` function), a `data()` function when it needs products or categories, and tests for the schema, the mapper and the CSS rules. Product blocks list their ids through `blockProductIds` so the loader fetches them in one go. Add the section to the add-section category list and the registry count test.

## 4. Product data the design assumes

Designs show more than the engine's products carry. Check, per product card and product page, and decide whether the fields already exist:

- A **badge** on the photo (`store_badge`), a **tagline** (`store_tagline`) and **colour swatches** (`store_swatches`, up to 6 with a name) exist on the item form's "Card" group and are switched on per card by Featured products' Show badges, Show tagline and Show colour swatches, and by the Title block's Show tagline.
- **Variants** (size, colour) already exist; "Add to bag" in a section is offered only for a product without options and in stock, otherwise the shopper is sent to the product page.
- Anything else (a second photo on hover, a material line, a size chart, a "made to order" flag) is a new product field: it needs a migration, validation, both item routes, the public item route, the item form and the card. That is a plan of its own; do not smuggle it into a preset. The preset's job is to turn on what exists and to **leave copy that tells the merchant what to enter**.
- The placeholder rule: a preset ships **no invented claims, reviews, press names, prices or customer photos**. Every line of copy is neutral or instructional ("Say how you pack, insure and ship orders"). The announcement bar defaults to the store's tagline, else "Welcome to <name>". The merchant replaces; the preset never promises on their behalf.

Also decide where sample pictures come from: draw simple SVGs under `public/store-presets/<preset>/` (no text, under 4 KB each, checked by a test) rather than stock photos, so there is no licensing and the owner clearly replaces them.

## 5. Fonts and style settings

- **Fonts.** The engine loads six extra families with `next/font/google` (Cinzel, Newsreader, Manrope, DM Serif Display, Lora, Poppins) plus Inter and Outfit, all `preload: false`; the store only downloads a file a theme uses. A new family must be added to `app/store/layout.tsx`, `lib/store/store-theme.ts` (the font key list and its CSS variable) and the font label list, and **built with `npx next build`**, which is the only thing that exercises the declaration (Newsreader needed `adjustFontFallback: false`).
- **Style settings** (Theme settings, Style): `label_style` (normal or spaced capitals), `frame_style` (none or thin accent border) and `texture` (none, dots, linen, grid) are set in the preset's `PRESET_LOOK` entry together with `canvas`, `accent`, `font_heading`, `font_body`, `button_radius` and `card_style`.
- **Colour schemes.** A preset can ship a **fixed scheme table** (`PRESET_SCHEMES` in `lib/store/engine/presets/look.ts`), used instead of the schemes derived from the store accent. A fixed table **ignores the store accent entirely** (ruling from Heritage Couture: every store has a valid accent, so honouring it would mean no store ever sees the designed palette; the merchant edits the schemes in Studio 2). If you use one: every text and accent colour must reach **3:1 against its own background** (use `readableAccent` for accents on light papers) and `button_text` on `button` too; test it for every scheme.
- **Card fields.** `PRESET_CARD_FIELDS` in `lib/store/engine/card-look.ts` says which of tagline and swatches the preset's cards start with.

## 6. Write the preset file

Copy `lib/store/engine/presets/heritage.ts` and change:

1. Rename the function and constants; put sample images under `public/store-presets/<preset>/`.
2. Build `header_group`, `footer_group` and each `templates.*` from `section(type, settings, blocks)`, `block(type, settings)`, `onScheme(section, 'scheme-n')` and `template([...])` (all from `presets/shared.ts`). Use only registered sections and blocks; use the `ctx` (business name, tagline, logo) for the few lines that may be personal and escape anything you put into HTML.
3. Register it everywhere a preset is listed. Heritage touched exactly these, and `Record<ThemePreset, ...>` tables will fail `tsc` until each has an entry:
   - `lib/store/engine/types.ts`: the `ThemePreset` union
   - `lib/store/engine/presets/index.ts`: the `switch` case
   - `lib/store/engine/presets/look.ts`: `PRESET_LOOK` (and `PRESET_SCHEMES` if fixed)
   - `lib/store/engine/card-look.ts`: `PRESET_CARD_FIELDS`
   - `lib/store/engine/root-class.ts`: the known presets
   - `app/api/settings/online-store/themes/route.ts`: `PRESETS`
   - `lib/store/engine/library.ts`: `PRESET_CHOICES` (label, description, canvas and accent swatches, and `premium: true` for a premium preset)
4. **Premium gating needs no new code**: `premium: true` on its `PRESET_CHOICES` entry is enough. The Add theme modal hides it, and the themes route refuses to create it (`403 premium_locked`), until `business_settings.store_premium_themes` is on for the store. Duplicates, editing, restoring a version and already-created themes are never gated.
5. Do not edit `migrate.ts`, the legacy Studio adapter or the parity fixtures for a new preset: the parity test checks that existing presets still produce their old output, and a new preset does not touch it.

## 7. Tests and staging

- **Sanitiser test.** The preset must pass the sanitiser unchanged (`presetTheme(preset, ctx)` equals `sanitizeThemeData` of itself), use only registered sections and blocks, keep ids unique and stay under the size limit. Run it with a long tagline and a business name that contains `&` and `<`. Copy the Heritage cases in `tests/lib/store/engine/presets.test.ts`.
- **Look, library and route tests.** Add the new preset to the lists in `preset-look.test.ts`, `root-class.test.ts`, `card-look.test.ts` and `library.test.ts` (the preset count), and the premium case in `premium-route.test.ts` if it is premium. A fixed scheme table gets a contrast test for every scheme.
- **Parity unaffected.** `preset-parity.test.ts` and `parity.test.ts` must stay green without edits; if you had to change them, a general section or setting changed an existing preset's output and that is a bug.
- **Full run.** `npx jest tests/lib/store` plus the DB suites against `kh_phase2_test` (never staging or production), `npx tsc --noEmit -p .`, and `npx next build`.
- **E2E scenarios** go in `e2e/store-studio2.spec.ts` (editor) and `e2e/store-theme-library.spec.ts` (library, with the premium flag flipped in the test DB and restored in a `finally`). Written, not run, unless asked.
- **Staging checklist.** Write `docs/superpowers/plans/<date>-store-<preset>-staging-checklist.md` in the style of the Heritage one: the migrations to run first, then the flag, the card in Add theme, every band at desktop and 390 px, the product page, the catalog, publish, and the still-open items of earlier plans. List what was never seen in a browser (picture art, phone layouts, overlaps) as explicit checks.
- **Carry-over.** List the open items, the rulings with their costs, and the deferred review minors, and add an "Owed at merge" section: the project log entry and roadmap card are written by whoever merges (the controller), not on the branch.
