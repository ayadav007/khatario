# Store theme store, Part A (public theme store with live demo stores): design

Date: 2026-11-01
Status: approved in chat, awaiting written review
Source: the owner's layout (Theme Store page on khatario.com: hero with a laptop and phone, search, three selling points, categories with counts, All / Popular / New / Free / Premium tabs, sort, theme cards with a live preview, badge, one line, palette dots, Details and Apply theme); Shopify's theme store as the reference.

## 1. Goal

Replace the small Add theme pop-up with a proper theme store that sells the themes: a public page on the Khatario website where anyone can browse every theme drawn live as a real store, open a theme to look through it on computer and phone, and apply it. A change to a theme shows up in the store at once, because nothing is a screenshot.

### Decisions taken with the user

| Topic | Decision |
|---|---|
| Split | Part A (this spec): public store, demo stores, theme pages, Apply. Part B: "My store" previews (a theme drawn with the merchant's products, topped up with samples) and live library thumbnails. Part C: paid themes (price, Buy, Buy to publish), once prices are set |
| Where | One page for everyone at `khatario.com/themes`, also opened from the app (Explore themes) |
| Previews | Live: each card and theme page draws the theme's demo store in a frame; no screenshots |
| Demo content | One demo store per theme with its own brand and catalogue; photos are free-for-commercial-use stock, downloaded once and served from our own files |
| Theme page | Page switcher (Home, Catalog, Product) and Computer / Phone; the preview scrolls, links and buttons inside do nothing |
| Apply | Signed in: the theme is added to the library under its own name and the editor opens. Visitor: Start Free Trial, then back to that theme with Apply ready |
| Colour dots | The theme's palette, not clickable |
| Left out | Favourites (heart), more themes (added one by one later), colour styles |

### Assumptions (not stated by the user)

- Premium themes show their Premium badge and stay free to apply while `PREMIUM_THEMES_FREE` is on (`lib/store/engine/premium.ts`); Part C adds the price.
- Blank is listed last as "Start from blank" and has no demo store: its card shows a plain drawing of an empty page instead of a live frame, and it has no Details page (Apply only).
- The page is in English like the rest of the marketing site.

## 2. Theme list

New `lib/store/engine/theme-catalog.ts` (client-safe) is the one list of themes. Each entry:

| Field | Example |
|---|---|
| `preset` | `heritage` |
| `slug` | `heritage-couture` (the page address) |
| `name` | Heritage Couture |
| `summary` | one line for the card |
| `about` | two or three sentences for the theme page |
| `categories` | `['jewellery', 'fashion']` from a fixed list |
| `features` | four to six short lines (e.g. "Serif headings, ivory and gold") |
| `palette` | three hex colours |
| `premium` | boolean |
| `added` | `2026-10-31` |
| `featured` | true for the theme shown in the page's hero (Heritage Couture) |
| `demo` | `{ subdomain: 'demo-heritage-couture', brand: 'Aarna Jewels', catalog: 'jewellery' }` |

Categories (fixed list with labels): Grocery & Kirana, Fashion & Apparel, Jewellery, Electronics, Home & Lifestyle, Pharmacy & Wellness, Restaurants & Food, Any store. A category with no theme is not shown.

`PRESET_CHOICES` in `lib/store/engine/library.ts` is derived from this list (label, description, canvas, accent, premium), so the two can never disagree; a test keeps every preset in the list exactly once.

Today's six entries: Heritage Couture (premium; jewellery, fashion), Premium Grocery (grocery), Quick (grocery, restaurants & food), Studio (fashion, home & lifestyle, any store), Khatario (any store, electronics), Blank (any store).

## 3. Demo stores

Each theme except Blank gets an in-memory demo store, served like today's theme demo stores (`lib/store/theme-demo.ts`, `is_demo`): no database rows, no orders, checkout off.

- **Address:** `demo-<slug>.khatario.com` (staging: `demo-<slug>.staging.khatario.com`). Subdomains starting with `demo-` become reserved for merchants (`lib/store/resolve-store.ts` and the store URL check); the plan first checks that no store already uses one.
- **Store:** `engineDemoStore(subdomain)` returns a `StoreBusinessContext` with `is_demo: true`, the demo brand's name, logo and tagline, and the theme's preset. `loadEngineTheme` returns `presetTheme(preset, demoContext)` for it (no `?engine=1` needed; the old `theme-*` demo stores keep working as today).
- **Catalogues:** new demo catalogues in `lib/store/engine/demo-catalogs.ts`: `jewellery`, `fashion`, `grocery`, `general`, each with 4 to 6 categories and 12 to 20 products (name, price, MRP, unit, badge, tagline, rating, photo). The existing `filterDemoCatalog` path in `section-data.ts`, the catalog page and the product page read the catalogue named by the demo store, so home sections, catalog and product pages fill from it.
- **Photos:** stored under `public/theme-demos/<catalog>/` as WebP (product photos about 900 px wide, hero photos about 1600 px, each under 200 KB), with `public/theme-demos/CREDITS.md` listing each photo's source page and licence (Unsplash or Pexels licence). No live links to stock sites.
- **Hero and section pictures:** each preset's sample pictures come from the demo context (`heroUrl` and the preset's own sample images), so the demo brand's photos replace generic ones.
- **Embed mode:** `?embed=1` on a demo store turns off the store pop-up, the install prompt and the cookie banner, and adds a small capture-phase script that stops link clicks, form submits and button presses (scrolling still works). The theme page sets it; opening a demo store directly works normally (still no checkout).

## 4. Pages

### `khatario.com/themes` (app/themes/page.tsx, server component)

Follows the owner's layout, in Khatario's marketing look (`MarketingSiteHeader`, its fonts and colours):

1. **Header:** Themes added to the marketing menu (`components/marketing/MarketingSiteHeader.tsx`), active on these pages.
2. **Hero:** "Theme store" pill, heading, one line, a search box, and the three selling points (Live preview, Mobile ready, Easy to customise). On the right the featured theme's demo store drawn live in a laptop frame and a phone frame.
3. **Catalogue:** categories on the left with counts (All themes first); tabs All, Popular, New, Free, Premium; Sort by Popular, Newest, Name. Search matches name, summary, categories and features as you type. All filtering happens in the browser over the list (six to a few dozen themes).
4. **Cards:** live preview (a frame of the demo store's home page at 1440 x 900, scaled to the card), a "Live preview" button over it that opens the theme page, name, Free or Premium badge, summary, palette dots, **Details** (theme page) and **Apply theme**.
5. **Popular:** the number of stores whose live theme uses each preset, `SELECT preset, count(*) FROM store_themes WHERE role = 'live' GROUP BY preset`, read on the server and cached for an hour; only the order is shown, never the counts. New sorts by `added`.

On phones: categories become a horizontal row of chips above the tabs, cards stack one per row, the hero shows the phone frame only.

### `khatario.com/themes/<slug>` (app/themes/[slug]/page.tsx)

- Breadcrumb back to the store, name, badge, summary.
- Large live preview with **Computer / Phone** and **Home / Catalog / Product** buttons (the frame's address changes to `/`, `/catalog`, `/products/<first demo product>`); Computer draws at 1440 wide scaled to fit, Phone at 390 wide in a phone frame.
- Side panel: **Apply theme**, "Good for" categories, features, palette, "Open demo store" link (new tab, without embed).
- Unknown slug: 404. Metadata: title "<Name> theme for online stores | Khatario", description from `about`, both pages in `app/sitemap.ts`.

### Live frames

One component, `ThemeLivePreview` (`components/marketing/themes/`): an `iframe` at a fixed design width, scaled with CSS to its box, `tabIndex=-1`, `aria-hidden` on cards (the theme page frame keeps focus and scroll), `src` set only once the frame scrolls near the view (IntersectionObserver), a skeleton in the palette colours until the frame loads, and a "Preview unavailable" fallback after 20 seconds without a load event. Cards set `pointer-events: none` on the frame so the card stays the click target. `next.config.mjs` already allows `*.khatario.com` to frame stores.

## 5. Apply theme

**Apply theme** links to `/settings/online-store/themes/apply/<slug>` (inside the app):

- Not signed in: the app's existing sign-in redirect sends the visitor to log in; the public page's Apply instead links visitors to `/signup?next=/settings/online-store/themes/apply/<slug>` (the signup page already honours same-site `next`). The public pages tell visitors from signed-in merchants by the presence of the session cookie only (no business data on the public page).
- Signed in: a small page "Add <Name> to your themes?" with the theme's live preview, **Add and customise** and **Back to themes**. It uses the same checks as the library's Add theme: settings update permission, the `advanced_online_store` feature (else the existing upgrade message), the 20-theme limit (`LIMIT_NOTICE`), premium (`premiumThemesEnabled`). On success it calls the existing create-theme API with `{ preset }` and opens the editor on the new draft (`editorPath`).
- **Naming:** a theme created from a preset without a typed name is named after the theme ("Heritage Couture"); when the business already has a theme of that name, "Heritage Couture 2", "3" and so on (`createThemeLocked` in `themes-repo.ts`). "Untitled theme" is no longer used for presets.

**Library:** the Add theme button becomes **Explore themes** (opens `/themes`). "Your current store design" stays as a library action, **Copy current store design**, using today's `source: 'migrated'` create. `AddThemeModal.tsx` is removed.

## 6. Fixed first

The live previews put every theme's home page on show, so two faults seen on staging are fixed before Part A ships:

- Heritage Couture on computers: the hero's words touch the left edge (no inner padding on the words' side).
- Quick: the hero shows white words on its beige panel when there is no picture.

Each gets its root cause found and a test where the rule is in a pure helper.

## 7. Errors and fallbacks

- A demo store that fails to draw shows the card's skeleton with "Preview unavailable" and the card still works.
- Popular counts unavailable (database error): Popular falls back to the list order.
- A slug that is in the list but whose preset no longer exists: left out of the page (a test prevents it).
- Apply errors use the library's existing messages (limit, permission, plan, premium).

## 8. Testing

- Unit (jest): the theme list (every preset once, slugs unique, categories known, palette hex, demo catalogue exists for every theme but Blank), `PRESET_CHOICES` derived from it, filters, search and sorting (pure helpers in `lib/store/engine/theme-store.ts`), naming ("Heritage Couture", then "2"), the `demo-` reservation, the embed click blocker's rules.
- DB (`kh_phase2_test`): popular counts query; naming with an existing theme of the same name.
- Staging: `/themes` on computer and phone; each demo store on computer and phone (home, catalog, product); each theme page with the page and device switches; Apply signed in (adds, opens editor, name), Apply as a visitor (sign up, back to Apply); Explore themes and Copy current store design from the library; the two fixes.

## 9. Out of scope (later parts)

- Part B: "My store" toggle on the theme page (the theme drawn with the merchant's products, topped up from the theme's demo catalogue with samples marked), live thumbnails in the library.
- Part C: prices, Buy, Trial badge and Buy to publish, using the existing add-on purchase (`/api/subscriptions/addons/[type]/purchase`).
- Favourites, colour styles, more themes.
