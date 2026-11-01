# Store product cards (Shopify gap batch 3, first part): design

Date: 2026-11-01
Status: approved in chat, awaiting written review
Source: `docs/plan/STORE_SHOPIFY_GAP_AUDIT.md` §5–6 (product card style group), brought forward by the owner; Dawn's "Product cards" theme settings and per-section card options as the reference.

## 1. Goal

Let a store owner redesign the product card used in every product list: start from a gallery of ten ready designs drawn live with the store's own products, then change anything: which lines show and in what order, the photo, name, price, badges, buttons, the card itself and how out-of-stock products look and where they sit. Existing stores look exactly the same until the owner picks a design or changes a setting.

### Decisions taken with the user

| Topic | Decision |
|---|---|
| Starting point | A **Choose a card design** gallery pop-up with **ten designs** plus **Theme's own**, each drawn live with one of the store's products; picking one fills every setting, which stays editable |
| Designs | Classic, Minimal, Grocery app, Boutique, List, Royal, Deal, Soft, Editorial, Dark |
| Where set | Once for the store (Theme settings → Product cards); each product section picks **Card**: "Store's card design" or any of the ten |
| Line order | A list of lines with on/off switches and ↑ ↓ arrows; "Name and price on one line" switch |
| Out of stock | Look (three choices) and place in lists (stay / end / hide), store-wide |
| Additions for cards like the jewellery example | Badge shape/position/icon, swipe between photos with dots, review count, price size/colour and discount pill, two-button styles, card background picture, name font |

### Assumptions (not stated by the user)

- "Theme's own" is a design value that adds nothing to the card, so each preset's current CSS keeps drawing it.
- The design applies to engine stores (Studio 2). The old non-engine storefront keeps its cards.
- Badge text comes from the product's own badge (`store_badge`) or the automatic badges (Sale, New, Low stock), as today.

### Out of scope

Veg / non-veg mark, "Notify me when back", "Bought 50+ this week", quick view, compare, full per-section fine-tuning, more designs (each is data, added later).

## 2. Settings

`ThemeSettings.product_card: ProductCardSettings` (sanitised in `lib/store/engine/sanitize.ts`; new file `lib/store/engine/product-card.ts` holds the type, defaults, sanitiser and the ten designs).

| Group | id | Values | Default |
|---|---|---|---|
| — | `design` | `theme` \| `classic` \| `minimal` \| `grocery` \| `boutique` \| `list` \| `royal` \| `deal` \| `soft` \| `editorial` \| `dark` | `theme` |
| Lines | `lines` | ordered list of `{ id: 'brand'\|'name'\|'unit'\|'rating'\|'tagline'\|'price'\|'swatches'\|'buttons', on: boolean }`, each id once | today's order |
| | `name_price_row` | boolean (applies when price follows name) | false |
| | `name_font` | `heading` \| `body` | `body` |
| | `name_case` | `normal` \| `caps` | `normal` |
| | `name_lines` | 1 \| 2 | 2 |
| | `name_size` | `s` \| `m` \| `l` | `m` |
| | `rating_style` | `stars` \| `number` \| `count` | `number` |
| Price | `price_size` | `s` \| `m` \| `l` | `m` |
| | `price_color` | `text` \| `accent` | `text` |
| | `show_mrp` | boolean | true |
| | `discount_style` | `none` \| `text` \| `pill` \| `save` | `text` |
| Photo | `image_shape` | `square` \| `portrait` \| `landscape` \| `natural` | `square` |
| | `image_fit` | `fill` \| `contain` | `fill` |
| | `image_padding` | 0–24 | 0 |
| | `image_radius` | 0–32 | 0 |
| | `image_bg` | hex or `''` | `''` |
| | `image_hover` | `none` \| `second` \| `zoom` | `none` |
| | `image_swipe` | boolean (dots) | false |
| | `placeholder` | `initial` \| `logo` \| `icon` | `initial` |
| Badges | `badge_shape` | `pill` \| `ribbon` \| `corner` | `pill` |
| | `badge_position` | `top-left` \| `top-right` | `top-left` |
| | `badge_icon` | `none` \| `crown` \| `star` \| `flame` \| `sparkle` | `none` |
| | `badge_colors` | `accent` \| `button` | `accent` |
| Buttons | `button_style` | `full` \| `pill_on_photo` \| `icon` \| `icon_full` \| `none` | `full` |
| | `button_action` | `add` \| `buy` (the full button; with `icon_full` the icon does the other) | `add` |
| | `after_add` | `button` \| `stepper` | `stepper` |
| | `wishlist` | `off` \| `top-left` \| `top-right` | `top-right` |
| | `wishlist_bg` | `plain` \| `circle` | `plain` |
| Card | `color_scheme` | scheme id or `''` (section's colours) | `''` |
| | `border` | 0–3 | 0 |
| | `radius` | 0–32 | 12 |
| | `shadow` | `none` \| `soft` \| `strong` | `none` |
| | `align` | `left` \| `center` | `left` |
| | `padding` | 0–24 | 12 |
| | `background_image` | image or `''` | `''` |
| | `hover` | `none` \| `lift` \| `zoom` | `none` |
| Out of stock | `oos_look` | `label` \| `faded` \| `soldout_button` | `label` |
| | `oos_place` | `stay` \| `end` \| `hide` | `stay` |

When `design` is `theme`, every visual setting is ignored and the card renders exactly as today (no class, no style). Picking a design writes that design's full settings object over the current one (and sets `design`); editing any setting afterwards keeps the design name (the gallery shows "Edited" on its tile). `oos_place` applies whatever the design.

The ten designs (`CARD_DESIGNS` in `product-card.ts`) are complete settings objects. Royal matches the jewellery reference: portrait photo with padding and radius, ribbon badge with crown top-left, white-circle heart top-right, swipe dots, heading-font name, tagline on, rating with count, large accent price with MRP and discount pill, `icon_full` with the full button "Add to cart", border 1, radius 16, scheme-coloured card.

## 3. Sections

Product sections (`featured-products`, `product-rail`, `category-shelves`, `related-products`, `recently-viewed`, `main-catalog`) gain `card_design`: `store` (default) or one of the ten. A section design uses that design's settings, with the section's existing switches (`show_rating`, `show_badges`, `show_tagline`, `show_swatches`) still hiding their lines; the section's old `card_style` applies only when the resolved design is `theme` (info text says so). `resolveCardLook(store: ProductCardSettings, sectionDesign: string, sectionSwitches)` in `product-card.ts` returns the effective settings; the engine passes it through `EngineCardContext` (extended) to the cards.

## 4. Rendering

`StudioProductTile` (`components/store/studio-theme/StudioSections.tsx`) and `StoreProductCard`'s engine branch read the resolved look. `cardLookClasses(look)` and `cardLookVars(look)` (pure, in `product-card.ts`) give one set of classes on the card root (e.g. `pc-shape-portrait pc-btn-icon_full pc-badge-ribbon`) and CSS variables (radius, padding, colours); styles live in `components/store/engine/product-card.css`, scoped under the engine root, and win over the presets' tile CSS only when a design is active (the root also gets `pc-on`). Lines render in `look.lines` order; `name_price_row` puts name and price in one flex row with the name truncated or wrapped by `name_lines`. Swipe uses CSS scroll-snap over `product.images` with dots (no JS beyond the active-dot update); hover second photo uses `images[1]`. Buy now uses the existing buy-now flow (as `StoreKhatarioProductView.buyNow`). The badge uses the existing badges list (custom badge first). Background picture is a CSS background on the card's detail area.

Out-of-stock place: `buildStoreItemsQuery` (`lib/store/store-items-query.ts`) gains `outOfStock?: 'stay'|'end'|'hide'`: `end` adds a leading `ORDER BY (stock <= 0)` term (a product with sizes is out only when every size is out), `hide` adds the matching `WHERE`; the theme's value is passed by section data loads (`lib/store/engine/section-data.ts`), the public items and search routes for engine stores, and category shelves.

## 5. Editor

Theme settings get a **Product cards** group: **Choose a card design** opens `components/store/studio2/CardDesignGallery.tsx`, a modal with eleven live tiles (Theme's own + ten) rendered with the real tile component and one of the store's products (first product with a photo from the editor's product list, else a built-in sample), "Use this design", and a confirm when current settings would be replaced. The settings below follow the groups in §2. New setting type `line_list` (ordered on/off list with ↑ ↓; sanitised as a permutation of the known ids) in `SettingField.tsx`. Sections show **Card** as a select. Changes preview live and undo/redo as usual.

## 6. Errors and fallbacks

Unknown design or bad values: dropped by the sanitiser (design → `theme`). Missing photo → the placeholder; one photo → no dots / no hover swap; missing badge, rating, tagline → the line is absent. A section design name that no longer exists → store design. `hide` never hides a product reached by its own page link.

## 7. Testing

- Unit (jest): sanitiser (every field, `lines` permutation, defaults), all ten designs pass the sanitiser unchanged, `resolveCardLook` (store, section override, section switches), `cardLookClasses` / `cardLookVars` (`theme` → empty), the name–price row rule, `buildStoreItemsQuery` SQL for `end` and `hide`.
- DB (`kh_phase2_test`): a store with in-stock, out-of-stock and sized products lists them in the right order with `end` and without the out ones with `hide`.
- Staging: each design in the gallery and on home, catalog and product pages on computer and phone; Royal against the jewellery reference; existing stores unchanged.
