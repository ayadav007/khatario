# Bazaar Bright premium theme (modern kirana and supermarket): design

Date: 2026-11-03
Status: designs approved in chat (phone and computer: home, catalog, product, cart), awaiting written review
Builds on: `2026-10-31-store-premium-themes-design.md` (premium presets, fixed schemes), `2026-11-01-store-product-cards-design.md` (card settings), `2026-11-01-store-theme-store-design.md` (theme store, demo stores), `2026-11-02-store-drop-culture-theme-design.md` (fonts, hero countdown, delivery check, "Only N left", sticky Add bar, and §2.11 cart drawer pieces, which this spec builds).
Mock-ups: `bazaar-bright.html` (home, design system) and `bazaar-bright-pages.html` (catalog, product, cart), shown in the session; they use the demo grocery photos in `public/theme-demos/grocery/`.

## 1. Goal

A premium theme, **Bazaar Bright**, for a neighbourhood kirana or supermarket going online. It should look as polished as BigBasket and still feel like the local shop: known customers, cash, UPI or khata on delivery, WhatsApp, and fast re-ordering of the same essentials. When an owner applies it, every setting below is already on; the owner changes anything in Studio 2.

Every new piece is built once for every theme, off by default, so no existing store changes. Bazaar Bright itself is a preset file, a demo store and a theme store entry.

### Research summary (from the session)

- Online grocery in India is repeat buying of essentials in smaller, more frequent orders: average order value fell from about $7.30 (2020) to $5.53 (2025).
- Blinkit and Zepto win on one-tap ADD that turns into a − 1 + stepper, sticky search, and easy reorder.
- Pack size is part of the product (Brand + Product + Variant + Pack size); shoppers pick 500 g / 1 kg / 5 kg before adding.
- Fees and minimums cause friction; clear "free delivery above ₹X" helps.
- Local shops win on trust, cash or UPI on delivery, and WhatsApp; customers resist installing apps.
- Premium grocery sells through curation (Nature's Basket's named aisles, seasonal packs).

### Decisions taken with the user

| Topic | Decision |
|---|---|
| Shop type | Modern kirana / supermarket (not gourmet, fresh-only, or dry-fruit specialty) |
| Must-haves | Pack size on the card; Buy again row; store open / closed; Order on WhatsApp |
| When closed | Orders are still taken; a notice says they are delivered after the shop opens |
| Direction | B, "Bazaar bright": saffron and navy, marigold for offers, leaf green for savings; Baloo 2 and Poppins; rounded; savings in rupees |
| Photos | Real photos, not icons (demo catalogue uses free stock photos, credited) |
| Designs | Phone and computer for home, catalog (categories down the left), product (pack tiles with price per kg), cart (closed notice, free-delivery bar, suggestions, WhatsApp order) |
| Out of scope | Delivery time slots and Hindi store labels (each its own project) |

### Assumptions (not stated by the user)

- **Payment choice stays at checkout.** The cart only says "Cash, UPI or khata on delivery"; checkout keeps today's payment picker, which already offers khata to shoppers with an open khata.
- **Price per unit** shows only for weight (₹/kg) and volume (₹/L), worked out from the pack label; pieces and anything unreadable show nothing.
- **Variants carry no MRP.** The strike-through MRP and the savings badge show only while the chosen pack's price equals the product's own price; other packs show their price alone.
- **Order on WhatsApp sends a message, not an order.** Nothing is recorded in Khatario; the shop handles it by hand, as it does phone orders today.
- **Store hours are one opening per day, India time.** No split shifts or after-midnight closing in v1.
- **Demo store** uses unbranded product names ("Chakki atta", not a real brand) and no real phone number.

### Out of scope

Delivery time slots; Hindi labels; recording WhatsApp orders in Khatario; split or overnight store hours; payment choice in the cart; a per-variant MRP; the Drop size filter (§2.4 of the Drop spec).

## 2. Engine pieces

Defaults keep today's output; `sanitizeThemeData` fills missing values with defaults. Existing stores have no store hours, so nothing hours-related shows for them.

### 2.1 Font: Baloo 2

`baloo` (Baloo 2) joins `STORE_FONT_FAMILIES`, `storeFontStack` (`var(--font-store-baloo), system-ui, sans-serif`), the sanitiser's `FONTS`, the picker (`Baloo 2`) and `app/store/layout.tsx` (weights 500–800, `preload: false`). Baloo 2 has Devanagari, so a later Hindi store needs no new font. Poppins already exists.

### 2.2 Pack sizes you can pick on the card

A `packs` card line joins `CARD_LINE_IDS` after `price`, **off** by default (saved cards get it appended off, as `sizes` was).

- Applies to products whose variants form exactly one option axis (`variantOptions(variants).length === 1`), whatever its key (`size`, `weight`, `pack`, or the single "Option" axis from variant names). Products with two or more axes keep today's behaviour (the add button opens the option sheet or the product).
- Draws up to 4 chips (`.ppacks`), then `+N` which opens the option sheet on phones or the product page on computers. The chosen chip is filled.
- The card starts on `initialVariantId(variants)` (the only one, else the first in stock). Sold-out packs are faded and not selectable.
- Price shows the chosen pack's `selling_price`. MRP strike-through and the savings badge show only while the chosen pack's price equals the product's own `selling_price` (variants carry no MRP).
- ADD adds the chosen variant (`variantId`, `variantName`, its price and stock). Once that variant is in the cart the button becomes the stepper for that variant; switching chips shows each pack's own ADD or stepper.
- `packs` and Drop's `sizes` line are separate: `sizes` only displays, `packs` chooses. A preset turns on one of them.

Pure helper `cardPacks(variants, max = 4): { packs: { id: string; label: string; price: number; soldOut: boolean }[]; more: number; axisCount: number }`.

### 2.3 Price per kg or litre

Pure helper `unitPrice(label: string | null, price: number): string | null` in `lib/store/unit-price.ts`:

- Reads a number and unit from the label: `g`, `gm`, `gram(s)`, `kg`, `ml`, `l`, `ltr`, `litre(s)`, `liter(s)`, case-insensitive, with or without a space, decimals allowed (`1.5 kg`, `500ml`). Multipacks like `4 × 100 g` multiply out.
- Returns `₹110/kg` or `₹58/L`: per kg for weights, per litre for volumes. Rounded to whole rupees from ₹10 up, one decimal below. Null for pieces, dozens, or anything unreadable.
- The label is the chosen pack's label; for products without variants, the product name's last number-and-unit (e.g. "Tomatoes, 1 kg").

Shown by a card setting `unit_price` (checkbox, default **false**) under the price, and on the product page (§2.4).

### 2.4 Pack tiles on the product page

The Options block (`variant_picker`) gains `style`: `buttons` (today, default) | `tiles`. With `tiles` and one option axis, each value is a tile with its label, its price and (when `unitPrice` reads it) the price per unit; sold-out tiles are faded and struck. With two or more axes `tiles` falls back to `buttons`. The block keeps `low_stock_at` (Drop §2.5).

The price block shows "You save ₹N" when the chosen pack's price is below the product MRP under the same rule as §2.2.

### 2.5 Savings in rupees on the badge

Card setting `discount_badge`: `percent` (today, "14% OFF") | `rupees` ("₹91 OFF"), default `percent`. Applies to the corner badge from `tileBadges`; the existing `discount_style` next to the price is unchanged.

### 2.6 Store hours and open status

**Data.** Migration (numbered after the highest at build time, 463 or later): `business_settings.store_hours JSONB` (null = not set).

```json
{ "mon": { "open": "07:00", "close": "22:00" }, "tue": null, ... }
```

`null` for a day means closed all day. Times are `HH:MM` 24-hour; `close` must be later than `open` on the same day. Timezone is always Asia/Kolkata. Validated by `sanitizeStoreHours` (drops bad days, never fails the whole save).

**Logic.** Pure `storeOpenState(hours, now: Date): { state: 'open'; closesAt: string } | { state: 'closed'; opensAt: string; opensOn: 'today' | 'tomorrow' | string } | { state: 'unknown' }` (`opensOn` is a weekday name further ahead). `unknown` when hours are not set or every day is closed. Labels: "Open · till 10 PM", "Closed · opens 7 AM", "Closed · opens tomorrow 7 AM", "Closed · opens Mon 7 AM" (12-hour, no ":00").

**Owner settings.** Online store → Store setup gains a "Store hours" card: seven rows (Open switch, from, to) and "Copy Monday to all days". Saved through the online-store settings route with the other store settings; `resolve-store` returns `store_hours`.

**Where it shows** (only when the state is not `unknown`):

- Header: setting `show_open_status` (checkbox, default **false**) draws the badge next to the store name. The page renders it after mount from the visitor's clock (as the countdown does), so cached pages stay right.
- Cart drawer and checkout page: when closed, a notice "We're closed now. Orders placed now are delivered after we open at 7 AM." (with tomorrow or the weekday when needed). Shown on every theme when hours are set; checkout still works.
- Store info section (§2.7).

### 2.7 Store info section

New section `store-info` (category Info; templates home, page): the store's name and area, today's hours and status (from §2.6), the address (`location_address`), and buttons Call (`tel:` store phone), WhatsApp (theme `social.whatsapp`), and Directions (Google Maps search of the address). Settings: `heading` (text, 60, default the store name), `show_hours`, `show_address`, `show_buttons` (checkboxes, default true). Each part hides when its data is missing; the section renders nothing when all are missing.

### 2.8 Buy again

New section `buy-again` (category Products; templates home, catalog). Settings: `heading` (text, 60, default `Buy again`), `max_items` (range 4–12, default 8), `style` (`rail` | `grid`, default `rail`).

- **API.** `GET /api/public/store/[subdomain]/buy-again`: needs the store customer session cookie (`readStoreCustomer`); the business comes from the store, never the request. Returns up to 12 distinct (item, variant) pairs from that customer's store orders that were not cancelled, most recent first, keeping only products still visible in the store, as `StoreItem`s (the shared store items select). No session or no orders: `{ items: [] }`.
- **Section.** Client-side: renders nothing until the answer comes, and nothing when empty or signed out, so other shoppers never see an empty row. Cards use the store card with the remembered pack preselected.
- **Demo stores** answer with a fixed list of their catalogue's everyday items, so the theme store preview shows the row.

### 2.9 Order on WhatsApp from the cart

Theme setting `cart_whatsapp_order` (checkbox, default **false**, under the "Cart" group). When on and `social.whatsapp` holds a valid Indian mobile number, the cart drawer shows "Order on WhatsApp instead" under Checkout.

Pure `whatsappOrderText(store, lines, pincode?)` builds:

```
Hi Sharma Stores, I'd like to order:
2 × Toned milk (1 L) – ₹116
1 × Basmati rice (5 kg) – ₹549
Total: ₹665
Deliver to: 560034
```

(pincode line only when the shopper entered one). The button opens `https://wa.me/<91number>?text=<encoded>` in a new tab. The cart is not cleared. In demo stores the button shows "This is a demo store" instead of opening WhatsApp.

### 2.10 Cart drawer: free-delivery bar and suggestions

Built exactly as Drop spec §2.11: theme settings `cart_free_ship_bar` and `cart_suggestions` (both default false), the bar from `freeDeliveryProgress` and `free_delivery_above`, up to 4 in-stock suggestions from the cart's categories. The suggestions heading defaults to `You may also need` when set by this preset (the setting's own default stays `Pair it with`). This also completes Drop's batch 2 cart item.

### 2.11 Existing pieces used as they are

Announcement, Header (logo, search, category chips), Slideshow / Hero banner with the countdown block, Category grid with photos, Featured products, Product rail, Promo cards, Multicolumn, Newsletter, Footer, Main catalog with `layout: 'rail'` and a promo tile, Main product with delivery check, "Only N left", sticky Add bar, Related and Recently viewed products, the minimum-order notice, khata at checkout.

## 3. The Bazaar Bright preset

`ThemePreset` gains `'bazaar'` (types, `root-class.ts`, `PRESET_LOOK`, `PRESET_SCHEMES`, `PRESET_CARD_FIELDS`, `presetTheme`, the themes route allow-list).

**Look:** canvas `#ffffff`, accent `#e8590c`, `font_heading: 'baloo'`, `font_body: 'poppins'`, `button_radius: 12`, `card_style: 'bordered'`, `label_style: 'normal'`, `frame_style: 'none'`, `texture: 'none'`. `PRESET_CARD_FIELDS.bazaar`: tagline false, swatches false.

**Schemes** (fixed; the store accent is ignored). Border = mix(text, bg, 0.12), card = mix(text, bg, 0.04).

| # | Name | Background | Text | Accent | Button / text |
|---|---|---|---|---|---|
| 1 | White | `#ffffff` | `#14213d` | `#e8590c` | `#e8590c` / `#ffffff` |
| 2 | Cream | `#fff6ea` | `#14213d` | `#e8590c` | `#14213d` / `#ffffff` |
| 3 | Saffron | `#e8590c` | `#ffffff` | `#ffc300` | `#14213d` / `#ffffff` |
| 4 | Navy | `#14213d` | `#ffffff` | `#ffc300` | `#ffc300` / `#14213d` |
| 5 | Marigold | `#ffc300` | `#14213d` | `#14213d` | `#14213d` / `#ffffff` |
| 6 | Leaf | `#2a9d4b` | `#ffffff` | `#ffffff` | `#ffffff` / `#1d6b33` |

Saffron is `#e8590c` (not the mock-up's `#ff7a00`) so white text reads 3.5:1. Every accent, button and button text must read 3:1 (tested).

**Card:** design `grocery` restyled by the theme (rounded 18px, bordered), `image_shape: square`, `image_bg` cream, `badge_shape: pill`, `discount_badge: rupees`, `unit_price: true`, `button_style: full`, `after_add: stepper`, `oos_look: faded`, `oos_place: end`; lines name, packs, price, buttons on; brand, unit, rating, tagline, swatches, sizes off.

**Theme settings:** `cart_free_ship_bar`, `cart_suggestions`, `cart_whatsapp_order` on.

**Pages:**

- Header group: Announcement (Navy, `Free delivery above ₹299 · Cash, UPI or khata on delivery`), Header (Saffron, store name, `show_open_status` on, search placeholder `Search atta, dal, milk, masala…`, category chips on).
- Home:
  1. Category grid "Shop by category" (photo tiles, 4 per row on phones, 8 on computers).
  2. Hero banner (Navy, picture behind words): eyebrow `Maha Bachat Week`, heading `Up to 40% off on staples`, countdown (`ends_at: ''`, hidden until set), button `Shop deals` → `/catalog`.
  3. Buy again.
  4. Featured products "Today's deals" (source `discounted`; 2 per row on phones, 5 on computers).
  5. Promo cards: `Fresh every morning` / `Sabzi from the mandi`, and `Monthly ration pack` / `Save on atta, rice and dal`.
  6. Category shelves (first two categories as rows).
  7. Multicolumn trust row (Cream): `Cash, UPI or khata on delivery`, `Fresh or we replace it`, `Free delivery above ₹299`, `Order on call or WhatsApp` (owner edits).
  8. Store info.
  9. Newsletter `Get offers first` (Cream).
- Catalog: Main catalog with `layout: 'rail'`, 2 columns on phones and 4 on computers, filters and sort on, one promo tile (`Monthly ration` on Marigold).
- Product: Main product (`thumbs: 'bottom'`, `sticky_info` on, `sticky_buy_bar` on); blocks title, price, Options (`style: 'tiles'`, `low_stock_at: 3`), buy buttons, delivery check, description, tabs `Product details`, `Storage and shelf life`, `Returns`; then Related products `You may also need`, Recently viewed.
- Footer: Navy (dark), about text from the tagline.

**Sample content:** product pickers empty; pictures under `public/store-presets/bazaar/` (hero, two promos, category tiles) as flat SVGs in the scheme colours; neutral copy; no invented reviews or service promises beyond the editable placeholders above.

**Theme store entry:** slug `bazaar-bright`, name `Bazaar Bright`, premium, categories `['grocery']`, palette `['#e8590c', '#14213d', '#ffc300']`, canvas `#ffffff`, accent `#e8590c`, summary `Saffron and navy supermarket with pack sizes on every card, buy again and store hours, for kirana shops`, features `Pack sizes and price per kg on cards`, `Buy again for regular customers`, `Open now / closed badge and store hours`, `Order on WhatsApp from the cart`, `Free-delivery bar in the cart`, `Categories down the left`. Demo `{ subdomain: 'demo-bazaar-bright', brand: 'Sharma General Store', tagline: 'Your neighbourhood kirana, now online', catalog: 'kirana' }`.

**Demo catalogue `kirana`:** 18–22 unbranded products across Vegetables, Fruits, Dairy & eggs, Atta rice & dal, Masala, Snacks & drinks; at least 12 with one pack axis (e.g. Chakki atta 5 kg / 10 kg, Basmati rice 1 / 5 / 10 kg, Toor dal 500 g / 1 kg / 2 kg, Sunflower oil 1 L / 5 L, Toned milk 500 ml / 1 L, Brown eggs 6 / 12 pcs), pack prices with a small bulk saving, two sold-out packs, a few `store_badge`s. Photos: the existing `public/theme-demos/grocery/` set plus new free-for-commercial-use photos (atta, dal, oil, onions, sugar, tea) through `scripts/theme-demo-photos.mjs`, credited. Demo store hours 07:00–22:00 every day; demo Buy again list (§2.8).

## 4. Errors and fallbacks

| Case | Behaviour |
|---|---|
| Product with two or more option axes | No pack chips; add opens the option sheet or product |
| All packs sold out | Chips faded; button shows Sold out |
| Pack label without a weight or volume | No price per unit |
| Store hours not set | No badge, no closed notice, store info hides hours |
| Day closed / close not after open | That day treated as closed; bad entries dropped on save |
| Shopper not signed in, or no past orders | Buy again renders nothing |
| Past order item now hidden or deleted | Left out of Buy again |
| No or invalid WhatsApp number | No "Order on WhatsApp" button |
| No `free_delivery_above` | No free-delivery bar |
| Store accent set | Ignored by Bazaar Bright |
| Unknown setting value | Sanitiser falls back to the default |

## 5. Testing

Jest, `.ts` tests:

- `cardPacks`: one axis of any key, two axes give `axisCount 2`, cut at 4 with `more`, sold-out packs, initial pack.
- `unitPrice`: g, kg, ml, L spellings, decimals, `4 × 100 g`, rounding at ₹10, pieces and junk give null, product-name fallback.
- Savings rule: MRP and badge only for the product's own price; `discount_badge: rupees` text.
- `storeOpenState` and labels: before opening, open, after closing, closed day, next open several days ahead, all closed gives unknown, IST regardless of server zone; `sanitizeStoreHours` drops bad entries.
- `whatsappOrderText`: lines, pack names, total, optional pincode, encoding; number validation.
- Buy again route: no session gives empty; distinct pairs, newest first, cancelled orders and hidden items excluded, other businesses' orders never returned; DB test on `kh_phase2_test`.
- Store hours migration and settings save: DB test on `kh_phase2_test`.
- Sanitiser: every new setting's default and fallback; existing presets unchanged apart from new defaults.
- Preset: schemes fixed and accent-proof, 3:1 contrast, registry sections only, ids unique, every piece on; demo store renders with the `kirana` catalogue; theme store entry premium-gated like Heritage and Drop.

Staging checks after deploy: pack chips and stepper per pack on phone and computer, price per kg, open/closed badge across a closing time, closed notice in cart and checkout, Buy again for a signed-in shopper with orders, WhatsApp message on a real phone, store hours settings.

## 6. Build order

1. Font, `unitPrice`, `discount_badge`.
2. Pack chips on cards (`packs` line).
3. Pack tiles on the product page and the savings rule.
4. Store hours: migration, sanitiser, logic, settings card, header badge, closed notice.
5. Store info section.
6. Buy again: route and section.
7. Cart drawer: free-delivery bar, suggestions, Order on WhatsApp.
8. Bazaar Bright preset.
9. Kirana demo catalogue, demo store, theme store entry.
