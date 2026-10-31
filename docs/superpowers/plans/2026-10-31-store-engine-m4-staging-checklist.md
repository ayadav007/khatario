# Store theme engine M4 (presets and migration): staging test checklist

What to check on `https://staging.khatario.com` once M4 is deployed there. **Nothing in this list has ever been checked in a browser**: M4 was built under ruling R11 (no local browser checks), and the migration and parity scripts have never been run against staging. Each task ended with a "staging test steps" list; this is those lists, shortened, plus the fix-wave checks (commit `9c19f04e`).

Engine pages show only with `store_engine` on, with a share preview link, or on a theme demo with `?engine=1`. Keep `store_engine` off for every real store throughout.

## Before deploying

- [ ] M4 adds **no new SQL migration**.
- [ ] `database/migrations/450_store_themes.sql` and `453_store_theme_working_draft.sql` are **still pending on staging**. The owner runs them before the code. Agents never run migrations on staging.
- [ ] Other pending migrations the same push carries (see `docs/project.log.md`) are run too, or the push is held.
- [ ] `store_engine` is off for every store after deploy.
- [ ] Pick an engine test store and a merchant login with settings permission (`.env` staging E2E keys).

## 1. Look and page colour (Task 1)

- [ ] A preview of a theme created after this deploy has Studio's warm paper background (`#fbf8f3`), not white. Existing engine themes are unchanged.
- [ ] A custom page from the Sale starter: its banner button opens the catalog.
- [ ] `/?cat=foo` on an engine store with a catalog template shows the home, not a 404. `/?cat=foo&q=rice` goes to `/catalog?q=rice`.
- [ ] On a store whose old theme is a named preset (for example Premium Grocery) with a different stored `accent`, create a new theme in Studio 2: scheme 1's accent is the pack accent (`#176b45`).

## 2. New sections and settings (Task 2)

In the Studio 2 working draft of the engine test store:

- [ ] Promo cards: side by side on desktop, stacked at 390 px. "Caption over image" puts the caption on the image over a dark gradient.
- [ ] Category shelves: one rail per category that has products; "View All" opens that category's catalog; "Show View all" off hides the links.
- [ ] Category grid, style "Emoji icons": emoji tiles. A "Category image" block with a photo switches that tile to the photo.
- [ ] Announcement, Scrolling on: items loop and pause on hover; a Link makes the whole bar clickable; with OS "reduce motion" the text stays still.
- [ ] Header, Category chips on: a chip row (All, then each category) under the header; chips open the catalog.
- [ ] Slideshow, slide 2 set to "Phones only": shown at 390 px, hidden on desktop. All slides set to the other device: all slides show.

## 3. Presets (Task 3)

Signed in as the test merchant, in the browser console (delete the test themes at the end):

- [ ] Create a theme: `fetch('/api/settings/online-store/themes',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Grocery test',preset:'grocery'})})`. Then POST `/api/settings/online-store/themes/<id>/preview-link` with `{}` and open the URL.
- [ ] Grocery: hero, emoji category tiles, Today's deals, two promo cards, All products; scrolling announcement; category chips under the header.
- [ ] Quick: no announcement; header has "in 30 minutes" and a highlighted Offers link; small full hero, 8-up categories, Bestsellers, Top deals, USPs, Handpicked for you.
- [ ] Khatario: accent announcement and header, medium hero with "Order now", tiles with no heading, Popular products, All products.
- [ ] Delete each test theme: `fetch('/api/settings/online-store/themes/<id>',{method:'DELETE'})`.

## 4. Preset look (Task 4)

Preview links of the Task 3 themes, at 390 px and 1280 px:

- [ ] Grocery: gradient rounded hero card (copy only, short card, on phone); bold headings; white emoji tiles that lift on hover, swipe row on phone; deep-green scrolling announcement and footer; second promo card deep green with an amber button; content about 1248 px wide at 1440 px.
- [ ] Khatario: accent announcement and header bar with a white search field; categories as one swipeable row of round marks; 1.35rem card corners; rails swipe with snap; content about 1120 px wide at 1440 px.
- [ ] Quick: bottom tabs Home/Categories/Search/Cart/Account on phone; Categories scrolls to the category grid; floating cart bar after adding an item (phone above the tabs, desktop bottom right at 380 px); no bar on `/cart` or `/checkout`; three product columns on phone.
- [ ] Studio 2, Quick draft: Theme settings "Phone-friendly layout" is ticked, greyed out, "Always on in the Quick theme". On a Grocery draft it can be unticked and the phone layout changes.
- [ ] A Studio-preset store looks as before apart from the Task 1 page colour.
- [ ] Exact pixel match is unverified, mainly the Grocery hero image inset and the Khatario row.

## 5. Migration mapping (Task 5)

- [ ] Nothing visible on its own. Covered by sections 7 and 8.

## 6. Pack home layouts (Task 6)

- [ ] Nothing visible on its own. Covered by section 8 (`?engine=1` on `theme-grocery` and `theme-khatario`).

## 7. Migration runner and Studio 2 (Task 7)

Needs the migration run (below) or a store that has never opened Studio 2.

- [ ] A staging store that never opened Studio 2: "Edit store design (beta)" opens a working draft that looks like the store's current pack (Grocery, Khatario, Quick or Studio), not the generic Studio home.
- [ ] Another such store: create a theme from a preset (for example Quick). The new theme is a draft; the live theme beside it is the store's migrated design (its own pack name, for example "Premium Grocery").
- [ ] The storefronts of both stores are unchanged (`store_engine` still off).

## 8. Demos and parity (Task 8)

- [ ] `https://theme-grocery.staging.khatario.com/` and `…/?engine=1` side by side at 390 px and 1280 px: same sections, same order, same colours; the `?engine=1` page shows the Preview badge. Repeat for `theme-khatario`, `theme-quick`, `theme-studio`.
- [ ] `…/?engine=1&editor=1` shows the Preview badge but no editor overlay or selection outlines.
- [ ] On a real store, `/?engine=1` is the normal storefront (old store, or live engine theme if `store_engine` is on), no Preview badge.
- [ ] After the parity run (below), `tmp-qa/engine-parity/index.html` has four demo sections plus one per migrated store, each with 390 and 1280 rows, and no `pt=` value except `pt=…`.
- [ ] Playwright's Chromium is installed on the machine that runs the script (not checked).

## 9. Fix-wave checks (commit 9c19f04e)

Links on a `?engine=1` page drop `engine=1`; re-add it by hand after each click.

- [ ] **I1 header without chips:** cannot be forced on staging (needs a failing category query; unit-tested). Happy path: `theme-grocery…/?engine=1` header shows logo, search, cart, menu and the chips row.
- [ ] **I2 Offers, empty catalog template:** on a migrated store preview (`preview_path` from the report) or the Grocery demo, click "Offers" or the "Shop offers" card. URL becomes `/?disc=10` (add `&engine=1` on a demo); "All products" lists only items at least 10% off MRP, fewer than without `disc`. Compare with the old store `…/?disc=10`.
- [ ] **I2 filled catalog template:** in Studio 2, add a Product grid to the catalog template, open `/catalog?disc=10` with preview params: the grid shows the "10% off or more" chip and only discounted products.
- [ ] **I2 other values:** `/?disc=15&engine=1` on a demo shows the unfiltered grid (only 10, 25, 50 are honoured).
- [ ] **Khatario tagline:** new theme from the Khatario preset on a store with a tagline: a "Tagline" rich-text line right after the slideshow. No tagline, no line.
- [ ] **Grocery cards:** a theme from the Grocery preset and a migrated Grocery store show identical promo cards (eyebrow, heading, text, buttons, links).
- [ ] **Studio hero devices:** a Studio or Quick store with one slide set to "mobile": after migration the desktop preview shows every slide, as the old store does.
- [ ] **Exit code (server, test DB only):** `DATABASE_URL=… node scripts/migrate-store-themes.mjs --business 00000000-0000-4000-8000-000000000000 --dry-run; echo $?` prints `not_found` and `1`.
- [ ] **Parity hosts:** `node scripts/store-engine-parity.mjs --base https://staging.khatario.com --demos` completes; a store that redirects to a custom or production domain shows "failed" cells and a console line `failed … refused: navigation left the allowed base for <host>`.
- [ ] **`.gitignore`:** `git status` no longer lists `tmp-qa/`.

## Migration on staging (owner approval required)

Agents never run this. The owner runs it on the staging VPS, from the staging checkout, with the staging database URL set in that shell only. Never paste the URL or password into a doc, log or chat. `<staging db name>` must be exactly what `SELECT current_database()` returns on staging.

1. [ ] **The owner approves** the run.
2. [ ] **Dry run:**

   ```
   DATABASE_URL=<staging url> node scripts/migrate-store-themes.mjs --all --dry-run --allow-database <staging db name> --report tmp-qa/engine-migration/staging-dry.json
   ```

   Read the warnings in the output and in the report. The script refuses (exit 2) any database other than `kh_phase2_test` unless `--allow-database` names it exactly, and writes nothing under `--dry-run`.
3. [ ] **The real run**, same command without `--dry-run`, with `--preview-links`:

   ```
   DATABASE_URL=<staging url> node scripts/migrate-store-themes.mjs --all --allow-database <staging db name> --preview-links --report tmp-qa/engine-migration/report.json
   ```

   Run it on the staging server, so preview links are signed with staging's secret (a local `.env` `JWT_SECRET` would give links that fail to verify). It is idempotent: stores with a live theme are `skipped_live`. It never touches `business_settings` or `store_engine`. Exit 1 means a business failed.
4. [ ] **Parity run:**

   ```
   node scripts/store-engine-parity.mjs --base https://staging.khatario.com --demos --report tmp-qa/engine-migration/report.json
   ```

   Output goes to `tmp-qa/engine-parity/` (never committed; the report holds 7-day preview tokens).
5. [ ] **The owner reviews `tmp-qa/engine-parity/index.html`** before any `store_engine` is turned on for any store.

## Known differences

Expected gaps, not bugs. Do not report them from staging.

- **Features the plan's D28 drops or does not carry over.** The migration warns where it drops something; the plan's D28 table lists what maps to engine sections. Old features outside that table are not migrated.
- **Migration warnings.** Each store's report lists warnings (for example a clipped delivery ETA). Read them before judging a store's parity.
- **Product and catalog stay classic on migrated stores (D31).** A migrated theme has an empty product and catalog template, so those pages render the old layout until the merchant fills them in Studio 2. `/catalog…` links redirect to `/…` with the query kept.
- **Quick's header is not the old Quick header.** The engine header is the Studio header restyled: no "Delivery in …" line (`delivery_eta` shows as a small tagline), no location or branch picker, no menu chips row. Grocery's old area picker has no engine equivalent either. Tabs, cart bar and main padding do follow the old Quick shell.
- **Links in `?engine=1` demos do not keep `engine=1`.** Clicking a product card or menu link returns to the old storefront.
- **`/?disc=10` does not scroll to the grid.** The old store scrolled to products; the engine home shows the hero first and the narrowed grid below.
- The Grocery first promo card always reads "Everyday essentials, honest prices" (the old heading counted the discounted items).
- A Grocery announcement with a custom background but no text colour gets a contrast-picked text colour (old: white). An external marquee link opens in the same tab (old: new tab).
- Typed `https` menu links survive migration (R14), as the old store linked them.
- Category shelves run one product query per category (up to 12); left for the M5 performance pass.
- Existing engine themes keep their old page colour; only themes created after deploy get Studio paper.
