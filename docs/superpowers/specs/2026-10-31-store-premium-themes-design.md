# Premium store themes (Heritage Couture first): design

Date: 2026-10-31
Status: approved in chat part by part, awaiting written review
Builds on: `2026-10-29-store-theme-engine-studio2-design.md` (the engine, M1–M5 built). Independent of `2026-10-31-store-menus-design.md` (header and footer navigation), which owns every header and footer change.

## 1. Goal

A store owner on the online-store plan can add a premium theme from the theme library and then edit every visible part of it in Studio 2 the way a Shopify merchant edits a paid theme: photos, text, which products show, colours, the order of parts, without losing the premium look. The first premium theme is **Heritage Couture**, for fashion, couture and jewellery sellers, taken from a Stitch design (ivory paper, crimson and zari gold, serif headings, a photo mosaic hero, a "shop the look" photo with hotspots, press and customer-photo rows).

Everything built for it is engine-wide: new sections, product fields and style settings work in every preset, so the next premium theme is mostly a preset file. Nothing in code is specific to one theme.

### Decisions taken with the user

| Topic | Decision |
|---|---|
| Pricing | Decided later. Premium presets sit behind a per-business flag until then; the check lives in one helper so plan or purchase gating replaces the flag without touching callers |
| Where themes come from | Khatario builds each premium theme in code as a preset. Designs (Stitch, Canva, a designer's HTML) are references, translated by a developer. No HTML import |
| First release | One finished theme end to end (Heritage Couture), built as engine upgrades plus a preset, not as a theme-only section pack or a CSS skin |
| Approach | B: upgrade the engine where Shopify's model needs it (style settings, product fields, content blocks, three general sections), then the preset |
| New designs later | Colour, type, order and content need no code. A design costs code only for a part no section can express; such parts are built as general sections (Collage, not "hero mosaic"). A design with a radically different page structure is bent to the engine, never given its own code path |

### Assumptions (not stated by the user)

- The store's own accent colour replaces the preset's crimson when set, as with the other presets; gold stays the secondary colour.
- Sample photos shipped with the preset are Khatario's own or CC0; the owner replaces them.
- Shop-the-look hotspots are placed with sliders in v1; dragging pins in the preview is a later nicety.
- Swatches are decorative in v1 (they do not switch the photo or a variant).

### Out of scope

Pricing and entitlement (beyond the flag); bundle discounts; a currency switcher; a wishlist icon in the header; filter tabs on the home page; any header or footer change (menus sub-project); importing HTML designs; a hosted demo store per premium theme; deriving swatches from variants; drag-to-place hotspots.

## 2. Theme style settings and fonts

### Fonts

Six more fonts in `STORE_FONT_FAMILIES`, `storeFontStack`, the sanitiser's `FONTS` list and the editor's font picker: `cinzel` (Cinzel), `newsreader` (Newsreader), `manrope` (Manrope), `dm-serif` (DM Serif Display), `lora` (Lora), `poppins` (Poppins). Each is loaded with `next/font/google` and exposed as `--font-store-<name>`.

**On-demand loading.** Today `app/store/layout.tsx` loads all seven fonts for every store. With thirteen that is too much, so the store layout applies only the variables of the live theme's `font_heading` and `font_body` (plus Inter, the UI font). Each font is still declared at module level (`next/font` requires it); only the `className`/`variable` of the two chosen fonts goes on the root. A preview of another theme applies that theme's two fonts. The old storefront keeps its behaviour (it reads `store_theme.font_*` the same way).

### Style group

Three fields on `ThemeSettings`, each with a default that changes nothing for existing themes:

| Field | Values | Default | Effect |
|---|---|---|---|
| `label_style` | `normal` \| `caps` | `normal` | Eyebrows, badges, buttons and menu links in uppercase with letter spacing (`eng-labels-caps`) |
| `frame_style` | `none` \| `accent` | `none` | A 1px `--c-accent` line around product cards, images and tiles, with a faint inset second line (`eng-frame-accent`) |
| `texture` | `none` \| `dots` \| `linen` \| `grid` | `none` | A faint CSS pattern over every section background, drawn in the section's text colour at low opacity (`eng-texture-<name>`) |

`engineRootClass` adds the classes next to `eng-preset-<preset>`; the engine stylesheet styles them. There is no per-section switch, so the store stays consistent; a section's Custom CSS can still override. The theme settings panel shows them under a "Style" heading after Card style (`THEME_SETTINGS_SCHEMA`). `sanitizeThemeData`, `defaultSettings`, `presetSettings` and `PRESET_LOOK` carry the fields.

## 3. Product card fields

Three per-product fields, stored like the existing store extras (own columns on `items`; one migration, numbered after the highest at build time, 458 or later):

| Column | Type | Limit | Shown as |
|---|---|---|---|
| `store_badge` | text | 24 chars | A label on the photo corner. When set it replaces the automatic badge; when empty the automatic New / % off / Only N left badges work as today |
| `store_tagline` | text | 60 chars | A small line above the product name on cards; under the title on the product page |
| `store_swatches` | jsonb | up to 6 of `{ name: string (<= 30), hex: string }` | Colour dots under the price, each with its name as a tooltip |

- **Validation** joins `validateProductExtras` (`lib/store/product-extras.ts`): trims, clips, checks hex with `isHexColor`, drops bad swatches, refuses more than 6.
- **Writes:** both item routes (`app/api/items/route.ts`, `app/api/items/[id]/route.ts`) save the columns in the same `patchExtras` path as video, tabs and size chart.
- **Reads:** `mapStoreProduct` and the public item routes return `store_badge`, `store_tagline`, `store_swatches` on `StoreItem`, so the engine and the old storefront see the same object. The demo stores' loader fills sample values for a few items.
- **Item form:** on the online-store area next to Video, Store tabs and Size chart: Badge text, Tagline text, and a Swatches list (colour input plus name, add and remove, 6 at most).
- **Cards:** `StoreProductCard` draws the badge through the existing `badges` list (custom badge first, automatic ones suppressed when it is set), the tagline above the name and the swatches under the price. `EngineCardLook` gains `tagline` and `swatches` booleans so sections without their own settings (Category shelves, Related products, Recently viewed, the catalog grid) follow the preset.
- **Section settings:** `productSettings` (Featured products, Product rail) gains `show_tagline` and `show_swatches`, both default off. Product information's `title` block gains `show_tagline` (default off). Show badges already exists.

## 4. Three new sections

Each is an ordinary engine section: a schema in `lib/store/engine/sections/`, a server renderer in `components/store/engine/sections/`, an entry in both registries, the common settings, colour schemes and custom CSS. Studio 2 needs no new field types.

### Products by id

`SectionDataRequest` gains `productIds?: string[]` (UUIDs, at most 12, deduplicated). `loadSectionData` collects every section's ids into one `WHERE id = ANY($1) AND business_id = $2` store-products query (same visibility rules as the source-based loader), then hands each section its own items in its block order; missing or hidden products are simply absent. Demo stores answer from the demo catalog.

### Collage (`collage`, Banners, home and page)

A general hero or feature layout.

- **Settings:** `eyebrow` (60), `heading` (120), `text` (richtext), `button_text` (30) + `link`, `button_2_text` (30) + `link_2`, `layout` (`text-left` \| `text-right` \| `tiles`), `feature_tile` (`first` \| `equal`), `tile_shape` (`portrait` \| `square`).
- **Blocks, 4 at most, three types:**
  - `image_tile`: `image` (video allowed), `caption` (60), `label` (30, a small corner tag such as a price), `link`.
  - `product_tile`: `product`, `image` (optional override). Renders the product's photo, name and price, linked to it. Requests the product by id.
  - `category_tile`: `category`, `image` (optional override). Renders the category's photo (first product photo fallback, as elsewhere) and name, linked to its catalog page. Requests categories (optional).
- **Render:** with the text column, tiles take the other half: one tile is a split hero; two to four form a mosaic, the first tile large when `feature_tile` is `first`. `tiles` layout spans the full width. Phones stack: text, then tiles two per row.
- **Preset:** text left, three image tiles, first large.

### Shop the look (`shop-the-look`, Products, home, page and product)

- **Settings:** `eyebrow`, `heading`, `text` (textarea, 300), `image`, `image_side` (`left` \| `right`), `show_list` (default on), `show_add_all` (default off), `list_heading` (60, default "In this look").
- **Blocks, 6 at most, `hotspot`:** `product`, `x` (range 0–100, step 1, default 50), `y` (range 0–100, default 50), `label` (40, optional override of the product name). Requests products by id.
- **Render:** numbered pins at `(x%, y%)` of the photo; hover, focus or tap opens a card with photo, name, price and the existing add-to-bag button (cart sync as everywhere). The list beside the photo repeats the items with prices and add buttons; the "Add all to bag" button adds each in-stock item once and shows the plain sum (no discount). A product that is out of stock shows "Sold out" without an add button; one that is no longer in the store is skipped (its pin is not drawn). Phones: image on top, pins kept, list below.
- **Preset:** photo, list on, no hotspots; the editor's empty state says "Add a hotspot and pick a product".

### Image gallery (`image-gallery`, Media, home, page and product)

- **Settings:** `eyebrow`, `heading`, `layout` (`grid` \| `masonry` \| `strip`), `columns` (range 2–6, default 4), `shape` (`square` \| `portrait` \| `natural`), `hover` (`none` \| `caption` \| `caption-link`), `gap` (range 0–32, step 4, default 8).
- **Blocks, 16 at most, `image`:** `image`, `caption` (80), `subcaption` (60, e.g. a handle), `link`.
- **Render:** CSS grid, CSS columns (masonry) or a scroll-snap strip. With `hover` set, the caption overlays on hover or focus and is always shown on touch devices. `natural` ignores `shape` cropping. Phones: two columns (or the strip).

## 5. Content blocks in text sections, and small upgrades

### Image with text and Rich text

Both keep their layout settings and take **content blocks** in the merchant's order (12 at most), as Product information does:

| Block | Settings |
|---|---|
| `eyebrow` | `text` (60) |
| `heading` | `text` (120), `size` (`small` \| `medium` \| `large`) |
| `text` | `content` (richtext) |
| `quote` | `text` (400), `attribution` (80) |
| `checklist_item` | `title` (60), `text` (160) |
| `button` | `label` (30), `link`, `style` (`filled` \| `outline`) |
| `highlight_card` (Image with text only, 1 at most) | `eyebrow` (40), `title` (80), `text` (200); a card overlapping the image's lower outer corner |

Image with text keeps `image` and `image_side`, and gains `image_width` (`half` \| `narrow`) and `text_align` (`left` \| `center`). Rich text keeps `align`. Its old `heading`, `description`/`content`, `button_text` and `link` settings go away from the schemas.

**Conversion of existing themes.** Inside `sanitizeThemeData`, on the raw data before sections are sanitised (the schemas no longer declare the old keys, so sanitising first would drop them): a section of either type whose settings carry any of the old keys and which has no blocks gets, in this order, a `heading` block (when the heading is non-empty), a `text` block (description or content), and a `button` block (when `button_text` or `link` is set); the old keys are deleted. A section that already has blocks is left alone, so the conversion runs once and repeated runs give the same result. Presets, page starters and `migrate-studio.ts` are rewritten to emit blocks directly.

### Small upgrades (all additive, defaults keep today's output)

- **Testimonials:** `quote` block gains `title` (80), `location` (60), `purchased` (40). Section gains `show_summary` (default off): a line "4.9 / 5 from 3 reviews" computed from the blocks' ratings.
- **Logo list:** `logo` block gains `name` (40) and `caption` (80). With no image, the name is drawn as a text wordmark in the heading font.
- **Promo cards:** `columns` range 1–4 (was 1–3).
- **Multicolumn:** `column` block gains `image` (optional); when set it replaces the icon.

## 6. The Heritage Couture preset and the premium flag

### Preset

`ThemePreset` gains `'heritage'` (types, `root-class.ts` PRESETS, sanitiser, `PRESET_LOOK`, `PRESET_CHOICES`, `presetTheme`). Look: canvas `#fcf9f3`, accent `#7a0c1e`, gold `#c89d53`, `font_heading: 'newsreader'`, `font_body: 'manrope'`, `button_radius: 0`, `card_style: 'bordered'`, `label_style: 'caps'`, `frame_style: 'accent'`, `texture: 'dots'`.

**Schemes.** `schemesFor` gains a per-preset table of fixed schemes (`PRESET_SCHEMES[preset]`), used instead of the derived set when present; the store's accent still replaces the button colour of the schemes that use the preset accent. Heritage's six: Ivory (`#fcf9f3`, ink text, gold accent, crimson button), Parchment (`#f4ece0`), Crimson (`#7a0c1e` background, ivory text, gold accent), Dark (`#1b1514`, ivory text, gold accent and button), Cream (`#faf5ed`), Gold (`#c89d53` background, dark text, crimson button).

**Pages** (nothing heritage-only in code):

- Header group: announcement bar (Crimson scheme), header with search and menu links.
- Home: Collage (text left, three image tiles, first large) → Multicolumn (four pillars) → Promo cards (overlay, four columns, eyebrow per card) → Featured products (four columns, badges, tagline and swatches on) → Image with text (eyebrow, heading, text, quote, three checklist items, button, highlight card) → Shop the look (photo, list on, no hotspots) → Testimonials (three quotes, summary on) → Logo list (text names with captions) → Image gallery (grid of four) → Newsletter.
- Product: Product information with `show_tagline` on and three collapsible tabs (Craft and provenance, Care, Delivery and returns), Reviews, Related products, Recently viewed.
- Catalog: Catalog banner and Product grid, four columns.
- Footer: about text, three link columns, social links, payment icons, Dark scheme. (Built with whatever the Footer schema is at build time: blocks today, a menu after the menus sub-project.)

**Sample content.** Product pickers stay empty; product sections use the store's real items. Photo tiles reference sample photos under `public/store-presets/heritage/` (Khatario's own or CC0). The Add theme modal's card says "Comes with sample photos; replace them with yours". Text comes from `PresetContext` (business name, tagline) and neutral copy; no invented reviews or press quotes: the Testimonials and Logo list presets ship with one placeholder quote and placeholder names, as the other presets do.

### Premium flag

- `PresetChoice` gains `premium?: true`; Heritage sets it.
- `lib/store/engine/premium.ts`: `premiumThemesEnabled(businessId): Promise<boolean>`. Today it reads `business_settings.store_premium_themes` (new boolean column, default false; migration numbered after the highest at build time). Later the body becomes the plan or purchase check; callers do not change.
- `GET /themes` returns `premium_enabled`; the Add theme modal hides premium presets when it is false and shows them with a "Premium" tag when true.
- `POST /themes` with a premium preset refuses 403 `premium_locked` ("Premium themes are not enabled for this store") when the flag is off; duplicating or restoring an existing heritage theme is allowed either way, so turning the flag off never locks a store out of its own themes.
- The storefront renders a heritage theme regardless of the flag.

## 7. Errors and fallbacks

- The sanitiser drops invalid blocks and settings (bad ids, out-of-range `x`/`y`, too many blocks, bad hex, bad images) and never stores them.
- A tile or hotspot whose product is missing, hidden or deleted is not drawn; the section still renders. A category tile whose category is gone is not drawn.
- A failed products-by-id lookup gives the section no products (like `categoriesOptional`): Collage draws image tiles only; Shop the look draws the photo without pins and an empty list.
- Fonts not in the list fall back to the defaults (`outfit` / `inter`), as today.
- A theme JSON from before this work loads and saves without change in meaning: style fields take their defaults, text sections are converted to blocks, presets render the same HTML (parity test).

## 8. Testing

- **Unit (jest, `tests/lib/store/engine`):** every new and changed schema through the sanitiser (limits, ranges, pickers, defaults); the text-section conversion (each legacy key, empty values, idempotent, runs before section sanitising, leaves blocked sections alone); `engineRootClass` and `engineRootStyle` for the style fields; renderers' prop mapping for Collage, Shop the look, Image gallery and the block-based Image with text and Rich text; `productSettings` flags; `premiumThemesEnabled` callers' decisions (`library.ts` hides/shows, POST refuses); preset parity (each existing preset's rendered HTML is unchanged by the foundations); the heritage preset passes the sanitiser unchanged and uses only registered sections and block types.
- **DB (`kh_phase2_test` only):** item routes save and return the three fields; the products-by-id loader scopes by business, deduplicates and drops missing ids; the flag column defaults false.
- **E2E (written, not run by tasks):** scenarios appended to `tests/e2e/store-studio2.spec.ts` for the three sections and block editing, and to `store-theme-library.spec.ts` for the premium card and refusal.
- **Staging:** a checklist (`docs/superpowers/plans/…-staging-checklist.md`) run on the E2E store after deploy: add Heritage, replace a sample photo, pick products in a hotspot and a product tile, show tagline and swatches on a real item, convert an existing Studio theme and confirm no visible change, flag off hides the card and refuses the POST.

## 9. Build order

Two implementation plans, one release:

1. **Premium theme foundations:** fonts and on-demand loading (§2), style settings (§2), product card fields with migration (§3), products-by-id loader (§4), content blocks with the conversion and the preset rewrite (§5), small upgrades (§5). Existing stores see no change.
2. **Heritage Couture:** Collage, Shop the look, Image gallery (§4), the preset and schemes (§6), the premium flag with migration (§6), library and modal changes, e2e scenarios, the staging checklist, and `docs/store-engine/design-to-preset.md`: a checklist for turning the next design into a preset (map each part to a section, list only the real gaps, decide general section vs setting).

Migrations are written and applied to `kh_phase2_test` only; staging and production applications need the owner.
