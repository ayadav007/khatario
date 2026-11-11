# Theme store Part A: staging checklist

Spec: `docs/superpowers/specs/2026-11-01-store-theme-store-design.md`. Plan: `docs/superpowers/plans/2026-11-01-store-theme-store-part-a.md`.
No migration. Deploy the code to staging as usual, then check each line on a computer and on a phone.

## Hosts
- [ ] `https://demo-heritage-couture.staging.khatario.com` answers with a valid certificate (wildcard DNS and TLS cover `demo-*`). Same for `demo-premium-grocery`, `demo-quick`, `demo-studio`, `demo-khatario`.
- [ ] A demo photo loads on its demo host and on the app host: `https://demo-heritage-couture.staging.khatario.com/theme-demos/heroes/jewellery-1.webp` and `https://staging.khatario.com/theme-demos/jewellery/ring-gold.webp` (an image, not a page or a login redirect).
- [ ] `https://demo-blank.staging.khatario.com` and `https://demo-nope.staging.khatario.com` show "Store not found".

## Demo stores (opened directly, no `embed`)
- [ ] Each demo store's home, `/catalog` and a product page draw with its brand (Aarna Jewels, FreshMart, QuickBasket, Studio Loom, Kartik Electronics) and its own photos; nothing from another theme's catalogue.
- [ ] Heritage Couture's demo shows jewellery photos in the collage, promo cards, story, shop the look and gallery (no pattern pictures).
- [ ] Links and categories navigate; Add to cart and checkout say it's a preview (no order is created).
- [ ] No pop-up appears.

## `staging.khatario.com/themes` (signed out)
- [ ] Themes is in the website menu (desktop and phone menu) and highlighted on these pages.
- [ ] Hero: heading, search, three points, Heritage Couture drawn live in the laptop and the phone.
- [ ] Categories show counts; Pharmacy & Wellness is absent (no theme); picking Jewellery leaves Heritage Couture only.
- [ ] Tabs: Free hides Heritage, Premium shows only Heritage, New shows Heritage; Sort by Name and Newest reorder; Popular disables Sort; Blank ("Start from blank") is always last.
- [ ] Search "grocery" finds Premium Grocery and Quick; "zzz" shows "No themes match" with Clear search.
- [ ] Cards load their live previews as you scroll; clicking inside a preview does nothing; "Live preview" and Details open the theme page.
- [ ] Apply theme (signed out) goes to Sign up; after signing up, the app lands on the Apply page for that theme (check a new trial business has the online store feature).
- [ ] Apply theme (signed out), then Log in on the sign-up page with an existing account: lands on the Apply page, not the dashboard.
- [ ] Page weight: note the request count and size of `/themes` (six live stores) in the browser's network panel.
- [ ] On a phone: categories are a row of chips above the tabs, one card per row, the hero shows the phone frame only.

## Theme page (`/themes/heritage-couture` and one other)
- [ ] Click a link inside the preview within a second of it appearing: nothing happens (and later clicks still do nothing).
- [ ] Computer / Phone switch the frame size; Home / Catalog / Product switch the page; the preview scrolls but links and buttons inside do nothing; no Preview pill.
- [ ] Side panel: Apply theme, about, Good for, features, colours, Open demo store (new tab, clicks work there).
- [ ] `/themes/blank` and `/themes/nope` show the not-found page.
- [ ] View source: no store counts in the page data.

## Apply (signed in, a store with the store engine on)
- [ ] Apply theme on a card goes straight to "Add <Name> to your themes?"; Add and customise opens the editor on a new draft named "Heritage Couture" (a second time: "Heritage Couture 2").
- [ ] A role without settings permission sees "Ask an admin…"; at 20 themes the page says "Delete a draft to add another".
- [ ] The library's Explore themes opens the store inside the app (`/settings/online-store/themes/explore`): the app's own menu, no website header, Login or Start free trial; Details opens `/settings/online-store/themes/explore/<theme>`; Apply goes straight to the Apply page; every Back link stays in the app.
- [ ] Copy current store design adds "<name> (from your store)" as before.
- [ ] The live store is unchanged until the new draft is published.

## Fixes shown by the previews
- [ ] Heritage Couture on a computer: the collage, shop the look and gallery sit in the same column as "Signature pieces" (no words touching the left edge); Full width still runs them edge to edge.
- [ ] A new Quick theme with no hero picture: dark words and a coloured Shop now button on the panel; a hero with a picture keeps white words.

## Nothing else changed
- [ ] An existing store's home page looks as before (e.g. `shalinitraders.staging.khatario.com`).
- [ ] The old demo stores (`theme-studio`, `theme-grocery`) look as before.
- [ ] Saving the Online store settings of a store whose URL is unchanged still works.

## Before production
- [ ] On production, `SELECT count(*) FROM business_settings WHERE store_subdomain LIKE 'demo-%'` is 0 and no business uses the portal slug `themes` (read-only).
