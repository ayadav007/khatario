# Drop Culture premium theme (clothing, streetwear): design

Date: 2026-11-02
Status: designs approved in chat (phone and computer), awaiting written review
Builds on: `2026-10-31-store-premium-themes-design.md` (premium presets, fixed schemes, product card fields), `2026-11-01-store-product-cards-design.md` (card settings), `2026-11-01-store-theme-store-design.md` (theme store and demo stores).

## 1. Goal

A second premium theme, **Drop Culture**, for young western clothing brands (T-shirts, co-ords, streetwear, denim; buyers 18–30 who arrive from Instagram). It sells through drops and hype, size-first shopping, combo offers and reels. When an owner applies it, every setting below is already on; the owner changes anything in Studio 2.

The theme needs thirteen engine pieces that do not exist yet. Each is built once for every theme, off by default so no existing store changes, and switched on by the Drop Culture preset. Drop Culture itself is a preset file, a demo store and a theme store entry.

### Decisions taken with the user

| Topic | Decision |
|---|---|
| Shop type | Young western D2C clothing brand, not ethnic (Heritage Couture covers couture and jewellery) |
| Must-haves | Drops and hype; size-first shopping; combo offers; reels and lookbook |
| Direction | A, "Drop culture": ink black, bone, acid lime, sale-only red-orange; Anton and Space Grotesk; square corners; 4:5 photos; caps labels |
| Designs | Phone: home (15 sections), catalog, product, cart drawer. Computer: home, catalog (filter column), product (photo grid, info column in view) |
| New pieces | Built for every theme, off by default, turned on by the preset |
| Apply | Applying Drop Culture turns all its settings on. Parts that need data (sizes, fit note, delivery areas, drop time, videos) show only when the data exists |
| Theme colours | A theme keeps its own colours; the store's accent never changes them (done for every preset in 5bcfafe5) |
| Product photos on computer | Photos in a 2 × 2 grid, as a new gallery option |
| Fit filter | Dropped (would need a fixed fit choice per product); the size filter stays |
| Combo pricing | A separate project. Until then combos are typed badges, banners and promo tiles; the cart's combo nudge is not built |

### Assumptions (not stated by the user)

- Reels take the links product videos already accept (`videoEmbed`): YouTube (watch or Shorts) or an https `.mp4`/`.webm` link. No video upload or storage in v1.
- Phone sign-ups go into `store_enquiries` (it already has a `phone` column) with the newsletter topic, so they appear where email sign-ups appear today. Nothing is sent on WhatsApp; the button text only says so.
- Sizes are read from variant attributes under the key `size` (any case), as the variant picker already reads them. A product without a size attribute shows no chips and is not matched by a size filter.
- The demo store gets its own streetwear catalogue with sizes as variants; photos and clips are free-for-commercial-use stock, downloaded once, served from our files and credited, as the other demo catalogues are.
- "Selling fast" stays a typed badge. An automatic one from sales numbers is later.

### Out of scope

Combo pricing and the cart combo nudge; a fit filter; video upload; sending WhatsApp messages to sign-ups; an automatic "Selling fast" badge; drag-to-place hotspots; any header or footer schema change.

## 2. Engine pieces

Every setting below has a default that keeps today's output. `sanitizeThemeData` fills a missing value with the default, so saved themes need no conversion.

### 2.1 Fonts: Anton and Space Grotesk

`anton` (Anton, headings) and `space-grotesk` (Space Grotesk) join `STORE_FONT_FAMILIES`, `storeFontStack`, the sanitiser's `FONTS` and the editor's font picker, declared in `app/store/layout.tsx` with `preload: false` like the other store fonts. Stacks: `var(--font-store-anton), Impact, sans-serif` and `var(--font-store-space-grotesk), system-ui, sans-serif`. Both appear in the picker for every theme.

### 2.2 Countdown block in the hero

A `countdown` block joins the Hero banner's blocks (`HERO_BLOCKS` in `image-banner.ts`), at most one per hero.

| Setting | Type | Default |
|---|---|---|
| `label` | text, 40 | `Ends in` |
| `ends_at` | text, same format and parsing as the Countdown section | `''` |
| `style` | `boxes` \| `inline` | `boxes` |
| `hide_when_over` | checkbox | true |

The renderer reuses `countdown-logic.ts` and the client timer of `EngineCountdown`. With no or an unreadable `ends_at`, or after the end with `hide_when_over`, the block renders nothing. Existing heroes have no such block.

### 2.3 Size chips on product cards

A `sizes` line joins `CARD_LINE_IDS`, after `price`, **off** in `DEFAULT_LINES`; a saved card without it gets it off (`normaliseLineList`).

- Values: the distinct `size` attribute values of the product's variants, in variant order, at most 6, then `+N`.
- A size whose every variant has no stock is drawn faded and struck through.
- Products without sizes show nothing (no empty row).
- The chips are not buttons: the card's add button already opens the option sheet on phones (`onOptions`) or the product page.

### 2.4 Size filter in the catalog

- `StoreItemsQuery` gains `sizes?: string[]` (at most 10 values, each trimmed, at most 20 chars).
- Condition: the product has a variant whose `lower(attributes->>'size')` is one of the lowered values. With "In stock only" on, that variant must have stock.
- The filter URL key is `size` (comma list), added to `FILTER_KEYS`, `toApiParams` and the active chips.
- The facets answer gains the sizes found in the current result. Order: XXS, XS, S, M, L, XL, XXL, 3XL, then numbers ascending (28, 30…), then the rest A–Z.
- Main catalog gains `show_size_filter` (checkbox, default **false**). When on and the facet has values, Size is the first filter group (chips) in the panel and, on computers, in the open filter column.

### 2.5 "Only N left" per size

The product page's Options block (`variant_picker`) gains `low_stock_at` (range 0–10, default 0 = off). When the chosen variant's stock is between 1 and the value, the picker shows "Only N left in <size>" (or the variant name when there is no size) in the scheme's sale colour. Sold-out values keep today's behaviour.

### 2.6 Fit note per product

- A product column `store_fit_note` (text, at most 80 chars), in one migration numbered after the highest at build time (462 or later).
- It is validated in `validateProductExtras` (trim, clip, empty becomes null), saved by both item routes in the `patchExtras` path, returned on `StoreItem` and filled for a few demo items.
- The item form shows "Fit note" next to Badge and Tagline.
- On the product page it shows under the Options block when set. No setting: no existing product has one.

### 2.7 Delivery check on the product page

A `delivery_check` product block (limit 1):

| Setting | Type | Default |
|---|---|---|
| `heading` | text, 40 | `Check delivery` |
| `button_label` | text, 20 | `Check` |

- It reuses `lib/store/store-pincode.ts`. `cleanPincode` reads the input, `pincodeServiceable` checks it against the store's delivery areas, and `pincodeLine` gives the answer line.
- The pincode is remembered under `storePinKey`, so the Quick header and this block share it.
- The block renders nothing when the store has no delivery areas.
- Existing product templates don't have the block.

### 2.8 Sticky "Add to bag" bar on phones

- Main product gains `sticky_buy_bar` (checkbox, default **false**).
- When on, below 768px wide, a bar appears at the bottom once the page's own buy button has scrolled out of view. It shows the chosen size (or "Select size", which scrolls to the picker), the price and the add button. It hides again when the buy button is back in view.
- While it shows, it replaces the phone kit cart bar on the product page, so only one bar sits at the bottom.
- Computers are unchanged; `sticky_info` already keeps the info column in view.

### 2.9 Product photos in a grid

- Main product's `thumbs` gains `grid` ("Photos in a grid").
- On computers every photo shows in two columns, 4:5, with the product video last, and no thumbnails.
- Phones keep the swipe gallery.

### 2.10 Reels section

A new section `reels` (category Media; templates home, page, product).

| Setting | Type | Default |
|---|---|---|
| `heading` | text, 80 | `On the streets` |
| `show_product` | checkbox | true |

Blocks `reel` (at most 12):

| Setting | Type | Notes |
|---|---|---|
| `video_url` | video link | Validated by `videoEmbed`; an invalid link drops the reel |
| `cover` | image | Shown in the row; without it a file video shows its first frame and a YouTube reel the YouTube thumbnail |
| `product` | product | Loaded through the products-by-id loader; a hidden or missing product drops the tag, not the reel |
| `caption` | text, 60 | |

**Row:**
- Covers are 9:16, scroll sideways on phones and show five across on computers.
- Nothing plays in the row, and no YouTube iframe loads until a reel is opened.

**Viewer (when a reel is opened):**
- The video and the product tag (name, price, "View").
- It closes on Esc, the close button or a tap outside, and steps to the next or previous reel with arrows or swipes.

### 2.11 Cart drawer: free-shipping bar and suggestions

Two theme settings (Theme settings, "Cart" group), both default **false**:

- **`cart_free_ship_bar`**
  - The drawer shows "You're ₹N away from free shipping" and a bar, from `freeDeliveryProgress` and the branch's `free_delivery_above`, the same numbers the phone cart bar uses.
  - When the order already qualifies it says "You've got free shipping".
  - Without `free_delivery_above` the bar is not drawn.
- **`cart_suggestions`**
  - Under the items, "Pair it with": up to 4 in-stock products from the categories of the cart's products, not already in the cart, newest first.
  - The heading is editable (text, 40, default `Pair it with`).
  - Add on a product with variants opens the product, as cards do.
  - Hidden when nothing qualifies.

### 2.12 Phone sign-up in the newsletter

- Newsletter gains `ask_for` (`email` \| `phone`, default `email`) and `placeholder` (text, 40, default empty, so the field's own hint shows).
- With `phone`, the form takes a 10-digit Indian mobile number. `validateEnquiry`'s newsletter branch accepts a valid phone when there is no email.
- The row is stored with topic `newsletter`, and the existing preview and live-section checks apply unchanged.

### 2.13 Existing pieces Drop Culture uses as they are

Announcement (scrolling), Header, Marquee, Featured products, Category grid, Promo cards, Shop the look, Countdown, Image gallery, Testimonials (average rating), Multicolumn, Newsletter, Footer, Related products, Recently viewed, Product reviews, card settings (dark design, portrait photos, second photo on hover, corner badges, icon button on photo, sold-out label, sold-out at the end), the product badge field, fixed per-preset schemes, label style caps.

## 3. The Drop Culture preset

`ThemePreset` gains `'drop'` (types, `root-class.ts` PRESETS, sanitiser, `PRESET_LOOK`, `PRESET_CARD_FIELDS`, `presetTheme`). Nothing in code checks for `'drop'` outside these lists.

**Look:**

| Setting | Value |
|---|---|
| `canvas` | `#0d0d0d` |
| `accent` | `#d4ff3a` |
| `font_heading` | `anton` |
| `font_body` | `space-grotesk` |
| `button_radius` | `0` |
| `card_style` | `plain` |
| `label_style` | `caps` |
| `frame_style` | `none` |
| `texture` | `none` |

`PRESET_CARD_FIELDS.drop`: tagline false, swatches false.

**Schemes** (`PRESET_SCHEMES.drop`, fixed, the store accent ignored like Heritage):

| # | Name | Background | Text | Accent | Button / text |
|---|---|---|---|---|---|
| 1 | Ink | `#0d0d0d` | `#f2f0ea` | `#d4ff3a` | `#d4ff3a` / `#0d0d0d` |
| 2 | Concrete | `#1f1f1f` | `#f2f0ea` | `#d4ff3a` | `#f2f0ea` / `#0d0d0d` |
| 3 | Bone | `#f2f0ea` | `#0d0d0d` | `#0d0d0d` | `#0d0d0d` / `#f2f0ea` |
| 4 | Volt | `#d4ff3a` | `#0d0d0d` | `#0d0d0d` | `#0d0d0d` / `#d4ff3a` |
| 5 | Alarm | `#ff4d2e` | `#0d0d0d` | `#0d0d0d` | `#0d0d0d` / `#ff4d2e` |
| 6 | Smoke | `#2a2a2a` | `#f2f0ea` | `#d4ff3a` | `#d4ff3a` / `#0d0d0d` |

Borders and cards are mixed from text and background as Heritage's are. Every accent and button must read 3:1 on its background (tested).

**Card** (theme card settings):

| Setting | Value |
|---|---|
| Design | `dark` |
| Photo | `image_shape: portrait`, `image_hover: second` |
| Badges | `badge_shape: corner` |
| Button | `button_style: icon` (an add icon on the photo) |
| Out of stock | `oos_look: label`, `oos_place: end` |
| Lines on | name, price, sizes |
| Lines off | brand, unit, rating, tagline, swatches |

**Theme settings:** `cart_free_ship_bar` and `cart_suggestions` on.

**Pages** (built only from engine sections):

- **Header group:** Announcement (scrolling, Volt), Header (logo centred, menu, search, wishlist, bag).
- **Home:**
  1. Hero banner (Smoke): photo beside words on computers; blocks: eyebrow, extra-large heading, countdown, button.
  2. Marquee (Ink).
  3. Featured products "Just dropped" (four across on computers, two on phones).
  4. Category grid (three tiles).
  5. Reels "On the streets" (Concrete).
  6. Promo cards: combo (Volt) and last call (Alarm).
  7. Shop the look "Shop the fit" (photo beside the list).
  8. Countdown "Next drop" (Volt), button "Get drop alerts" with an empty link for the owner to set (for example their WhatsApp link).
  9. Image gallery "#wear<brand>" (grid).
  10. Testimonials (average rating on).
  11. Multicolumn trust row: COD, 7-day exchange, ships in 24h, as editable placeholder text.
  12. Newsletter "Join the crew" (Bone, `ask_for: phone`).
- **Catalog:** Catalog banner (Smoke) and Main catalog (four columns on computers, two on phones, filters and sort on, `show_size_filter` on, one promo tile).
- **Product:**
  - Main product with `thumbs: grid`, `sticky_info` on, `sticky_buy_bar` on.
  - Blocks: title, price, Options (`low_stock_at: 3`), buy buttons, delivery check, and three tabs (Details, Fabric and care, Exchange and returns).
  - Then Related products "Complete the fit", Product reviews and Recently viewed.
- **Footer:** Ink.

**Sample content:**
- Product pickers stay empty, so product sections use the store's own items.
- Hero, promo, shop-the-look, gallery and reel covers use sample photos under `public/store-presets/drop/`.
- The preset ships no reel video links: the Reels section's blocks are covers with empty links, and they are dropped until the owner adds links. The demo store uses its own clips.
- Copy uses the business name and neutral text: no invented reviews, press quotes or service claims beyond placeholder text the owner edits.
- The countdowns ship with an empty `ends_at`, so they stay hidden until the owner sets a drop time.

**Theme store entry** (`THEME_CATALOG`):

| Field | Value |
|---|---|
| `slug` | `drop-culture` |
| `name` | `Drop Culture` |
| `premium` | true |
| `categories` | `['fashion']` |
| `palette` | `['#0d0d0d', '#d4ff3a', '#f2f0ea']` |
| `demo` | `{ subdomain: 'demo-drop-culture', brand: 'VOLTX', tagline: 'Drops every Friday', catalog: 'streetwear' }` |

The summary, features and "about" text describe drops, size-first cards, reels and the sticky Add to bag bar.

**Demo catalogue** `streetwear`:
- 12–16 products across Tees, Co-ords, Denim and Accessories, most with S–XXL (or waist) variants and a few sizes sold out.
- Some products carry badges and fit notes.
- Two hero photos, four reel covers and clips.
- The demo store draws the Reels section from these clips.

## 4. Build batches

| Batch | Pieces | The theme meanwhile |
|---|---|---|
| 1 | Fonts (2.1), hero countdown (2.2), size chips (2.3), "Only N left" (2.5), fit note (2.6), delivery check (2.7), sticky bar (2.8), photo grid (2.9), preset, demo store and theme store entry | Ships. Reels spot is the Video section; cart drawer as today; newsletter asks for email |
| 2 | Size filter (2.4), cart drawer bar and suggestions (2.11) | The preset turns them on |
| 3 | Reels section (2.10), phone sign-up (2.12) | The preset swaps Video for Reels and sets `ask_for: phone` |

Turning a later batch on changes the preset only; stores that already added Drop Culture keep their saved theme and can add the new parts in Studio 2.

## 5. Errors and fallbacks

| Case | Behaviour |
|---|---|
| Product without sizes | No chips, no "Only N left", not matched by a size filter |
| Size values typed differently (`l`, `L`) | Matched case-insensitively; shown as the first spelling met |
| Unreadable `ends_at` | The countdown block or section renders nothing |
| Invalid reel link | That reel is dropped; a section with none renders nothing |
| Reel product hidden or deleted | The reel shows without its tag |
| No delivery areas | Delivery check renders nothing |
| No `free_delivery_above` | No free-shipping bar |
| No suggestion qualifies | No "Pair it with" block |
| Phone sign-up with a bad number | Inline error, nothing stored |
| Unknown setting value from an old or future save | The sanitiser falls back to the default |
| Store accent set | Ignored by Drop Culture (fixed schemes) |

## 6. Testing

Jest (`npx jest <path>`), `.ts` tests:

- Sanitiser: every new setting's default, a missing value, a wrong value and a value from the future fall back as stated. Every existing preset's sanitised output is unchanged apart from the new defaults.
- Size chips helper: order, de-duplication, case, the sold-out rule, the `+N` cut, and no sizes.
- Size filter: query conditions with and without "In stock only", the URL key round trip, and the facet sort order.
- "Only N left" threshold edges (0 off, stock 0, stock equal to the threshold).
- Fit note validation: trim, 80-char clip, empty to null.
- Delivery check: hidden without delivery areas; shares the remembered pincode.
- Reels: invalid links dropped, product tag missing when hidden, 12-block limit.
- Cart helpers: free-shipping text at, under and over the limit; suggestions exclude cart items and out-of-stock products and cap at 4.
- Newsletter: phone accepted when `ask_for` is `phone`, rejected when malformed, email path unchanged.
- Drop Culture preset: schemes fixed and accent-proof, 3:1 contrast for every accent and button, sections only from the registry, ids unique, the demo store renders.
- DB test on `kh_phase2_test`: the size filter and facet against real variant rows; the fit note migration and item routes.

Browser checks on staging after deploy (per the test-on-staging rule): demo store on phone and computer, Apply then Publish on a test store, the sticky bar against the phone kit bar, and the reels viewer.

## 7. Build order

1. Batch 1 engine pieces, each with its tests: 2.1, 2.2, 2.3, 2.5, 2.6 (migration on `kh_phase2_test` only), 2.7, 2.8, 2.9.
2. Drop Culture preset, schemes and card settings.
3. Streetwear demo catalogue, demo store and theme store entry.
4. Batch 2: 2.4, 2.11, then the preset update.
5. Batch 3: 2.10, 2.12, then the preset update.
