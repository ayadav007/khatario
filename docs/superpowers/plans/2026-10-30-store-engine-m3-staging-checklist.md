# Store theme engine (M1–M3): staging test checklist

What to check on `https://staging.khatario.com` once the theme engine and Studio 2 are deployed there. Nothing from the engine has run on staging yet. M1–M8 tasks were checked in a browser locally (`:3015`, test DB) except where this list says **not checked locally**. Tasks 9 (custom pages), 10 (layout settings) and the new e2e scenarios were never run in a browser.

## Before deploying

- [ ] Migrations `database/migrations/450_store_themes.sql` and `453_store_theme_working_draft.sql` run on the staging DB, **before** the code (the online store settings GET and the storefront read `business_settings.store_engine`). Both use `IF NOT EXISTS`. The owner runs these; agents never run migrations on staging.
- [ ] Other pending migrations from earlier work that the same push carries (448, 449; see `docs/project.log.md`) are run too, or the push is held.
- [ ] `store_engine` is off for every store after deploy; turn it on only for one test store.
- [ ] Pick the staging test store and a merchant login with settings permission (`.env` staging E2E keys).

## 1. Store pages render (engine on for the test store)

- [ ] Home renders with header, sections and footer; no console errors.
- [ ] `/products/<id>` renders the product page: gallery, title, price, variant picker (on an item with variants), Add to cart → stepper, description, delivery estimate, share. Reviews, related products and recently viewed show below (recently viewed only after visiting a second product).
- [ ] `/products/00000000-0000-0000-0000-000000000000` shows "Product not found." with the header.
- [ ] `/catalog` lists products with sort and filters; the URL updates (`?sort=…`, `?stock=1`). **Not checked locally:** "Load more" on a store with more than 40 products.
- [ ] `/catalog/<category id>` shows that category's name as the heading and only its products; an empty category shows an empty state, not a 404.
- [ ] On an engine store with a catalog template, `/?cat=<id>` and `/?q=milk` redirect to `/catalog…`. With the engine off, `/catalog` redirects to `/?cat`.
- [ ] Promo tiles inside the catalog grid appear at their slots.
- [ ] New home sections: collection list, logo list, video (YouTube and Vimeo; click-to-play; **not checked locally:** play after click), FAQ, newsletter, countdown (ticks), spacer.
- [ ] Newsletter: submit an email → success message; the merchant's enquiries list shows a "Newsletter subscriber" row; works even with the contact form disabled; an invalid email shows "Enter a valid email".
- [ ] On a store whose live theme has no newsletter section (or the engine off) and the contact form off, a POST to `/api/public/store/<sub>/enquiries` with topic `newsletter` is refused (404), as before M3.
- [ ] `/pages/<handle>` for a published custom page renders with its own tab title and meta description; `/pages/nope` and `/pages/cart` give 404.

## 2. Studio 2: every template

- [ ] Open the working draft in Studio 2. The page dropdown lists Home, Product, Catalog and any custom pages.
- [ ] Switch Home → Product → Catalog → Home: the preview moves to that page each time; unsaved edits are saved first.
- [ ] On an empty Product (or Catalog) template the preview shows the classic page and the panel offers "Use the default layout"; clicking it fills the tree and the preview in one step, and Undo empties it again.
- [ ] "Preview with:" lists only products the store sells; picking one moves the preview to it.
- [ ] Clicking a section in the preview selects it in the tree, on every template; "+" between sections in the preview adds a section at that spot.
- [ ] Edit the product page's Delivery estimate text → the preview shows it after autosave.
- [ ] Catalog: set desktop columns to 3 → the grid shows 3 columns on a wide screen.

## 3. Custom pages (Task 9, not checked in a browser)

1. [ ] Top bar → "New page" (file-plus icon right of the Page dropdown). Starters: Blank page, About us, Sale, Contact.
2. [ ] Title "Diwali Sale" → Address fills as `diwali-sale`. Change Address to `cart` → "That address is used by the store", Create page disabled. Set it back.
3. [ ] Pick Sale → Create page. The dropdown shows "Diwali Sale"; the preview loads `/pages/diwali-sale` with an image banner and a product rail.
4. [ ] With nothing selected, the right panel shows Page settings. Change the title (dropdown follows), fill SEO title and description; counters show x/100, x/120, x/320.
5. [ ] A section's Link dropdown lists "Diwali Sale" after the categories; add it to a header menu link.
6. [ ] Publish. On the store, `/pages/diwali-sale` renders; tab title is the SEO title; the meta description is set; the menu link works.
7. [ ] In the editor, Delete page → confirm → the dropdown goes to Home and the page is gone. Undo → page is back, dropdown stays on Home. Pick it, Redo → it is deleted again and the dropdown falls back to Home with no blank entry.
8. [ ] A theme with 30 pages: New page shows "This theme already has 30 pages".

## 4. Layout settings (Task 10, not checked in a browser)

- [ ] Theme settings now show **Card style**: Plain removes card borders; Shadow swaps the border for a soft shadow; Bordered is the old look. Check on home rails, the catalog grid and related products.
- [ ] Every section's settings now show **Full width**: on custom HTML, collection list, logo list, video, FAQ, newsletter and countdown it removes the side gutter (video and FAQ also lose their centred width cap); catalog banner and catalog grid drop their max width. Most Studio sections were already edge to edge, so the toggle makes no visible change there.
- [ ] Footer settings show **Show payment icons** (off by default, so existing stores show no badges after deploy). Turning it on shows UPI, Visa, Mastercard and RuPay badges under the footer.

## 5. Preview links and safety

- [ ] "Copy preview link" on each template opens that page in a new tab with the draft (not the live theme), on a store with the engine off too.
- [ ] A preview link with a tampered or expired token shows the live store, never the draft.
- [ ] Item and review APIs with a valid preview token show the store's products only; a hidden (offline) product is not exposed.
- [ ] In a shared preview link, clicking a product (home rails, related products, recently viewed) stays in the preview.
- [ ] Known gap, not fixed: any non-empty `td` query value opens an unlaunched store's catalog APIs (pre-existing, from the old Studio draft preview).
- [ ] Custom HTML and video iframes are sandboxed (inspect the iframe: `sandbox="allow-scripts allow-same-origin allow-presentation"`).

## 6. After testing

- [ ] Turn `store_engine` off again on the test store unless it should stay on.
- [ ] The e2e spec `e2e/store-studio2.spec.ts` (11 scenarios) is local only: it needs the test DB through `with-test-db.js`. Run it locally on a warm dev server, or adapt it before pointing it at staging.
