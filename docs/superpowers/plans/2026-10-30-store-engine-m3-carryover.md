# Store theme engine M3: carry-over

Findings from the M3 final review that were not fixed in M3 (I1–I3 and Minor 1 were fixed in 3f19d339). Copied from the SDD workspace before it was deleted.

### I4. (Pre-existing, not an M3 regression; M3's new helper inherits it) Any non-empty `td` lets an unlaunched store's catalog through
`lib/store/engine/preview-access.ts:14`: `resolveStoreBySubdomain(subdomain, { allowOffline: Boolean(sp.get('td')) })`.

**What is wrong.** The value of `td` is never verified.

**Failure scenario.** `GET /api/public/store/<unlaunched>/items?td=x` returns the unlaunched store's products, prices and stock flags. The same works on `/items/facets`, `/items/<id>` and `/items/<id>/related`.
- The ledger already logged this under Task 2 as pre-existing, to surface to the user.
- It matters for priority 1 because D24's promise ("an unlaunched store answers only to a verified token") holds for `preview_theme`/`pt` but not for `td`.
- The same truthiness check exists in `[subdomain]/route.ts:18`, `offers/route.ts:14` and `search/suggest/route.ts:19`, so a fix in the helper alone would close only five of eight routes.

**Recommendation.** The user should decide: either verify the old Studio draft token where it is read, or retire `td` with the old Studio. If they choose verification, `storeForPublicApi` is the right place for the five M3 routes.

## Minor

1. **The `store_only` filter is looser than the storefront** (`app/api/items/route.ts:149,176`).
   - The filter is `show_in_store OR featured_in_store`, but the storefront item route requires `show_in_store = true` (`app/api/public/store/[subdomain]/items/[id]/route.ts:43`).
   - An item that is featured but no longer shown (possible after a PATCH) can still become the D20 default and preview as "Product not found."
   - Fix: filter on `show_in_store = true` only.
2. **An engine home with a malformed `cat` now 404s.**
   - `/?cat=foo` redirects to `/catalog/foo`, and `categoryName` returns null, so the page 404s (`EngineCatalogPage.tsx:58`). M1 ignored a malformed `cat` and showed the home.
   - Real links carry uuids, so the impact is low. `catalogRedirect` could drop a non-uuid `cat`.
3. **The product page's Share block shares the raw URL** (`components/store/engine/product/ProductBlocks.tsx:215`).
   - It shares `window.location.href`, which includes `preview_theme`/`pt` (a 7-day share token) in a preview, plus any utm or `td`.
   - Fix: share `origin + pathname`.
4. **Newsletter extras.**
   - There is no confirmation step, so anyone can add a third party's email to a merchant's list.
   - From an unlaunched store's preview, the form shows "Store not found", because the enquiries route has no preview path.
   - Signups can still be sent from the editor or preview. This is a deferred Task 7 minor; the React `onSubmit` runs despite `EditorBridge`'s `preventDefault`.
   - These fit naturally into the I1 fix: refuse when the request has `preview_theme`.
5. **PageSettings ignores read-only** (`components/store/studio2/PageSettings.tsx:27-40`).
   - Its inputs and "Delete page" are not disabled while `readOnly` (while leaving for the working draft).
   - `apply` returns `null` when it refuses (`Studio2Editor.tsx:253`), so Delete then calls `switchTemplate('home')` although nothing was deleted.
   - Fix: pass `readOnly` to `disabled`.
6. **An empty catalog template's frame is the home page** (`EngineCatalogPage.tsx:51-52`).
   - In the editor, the frame is redirected to the home page with `editor=1`. Its bridge tags messages `home`, so the editor drops clicks there. The preview looks interactive, but nothing selects; header and footer hovers still highlight.
   - The "Use the default layout" card explains the state. Consider an overlay note in the frame.
7. **The Sale starter's banner button links to `/`** (`lib/store/engine/presets/templates.ts:66`). `/catalog` would fit "Shop now" better.
8. **Flaky pre-existing test** (`tests/lib/store/engine/preview-token.test.ts:32`, not in the M3 diff).
   - Replacing the last two base64url chars with `AA` can decode to the same 32 MAC bytes, because the last char carries only 4 bits. This happens about once per thousand runs.
   - It failed once in this review's run.
   - Fix: flip a middle character, or compare decoded bytes.
9. **D24's route list omits `search/suggest` and `offers`.** Header search suggestions and offers do not work in an unlaunched store's preview. This is in the same family as R6.
10. **The theme Card style reaches only some grids.**
    - It styles only `StoreProductCard` grids (`main article.g-surface`): catalog, home grid, related and recently viewed.
    - Featured-products and product-rail keep their own section `card_style` (the `.productGrid.card-*` classes).
    - A merchant may expect the theme setting to restyle every card. An `info` line on the setting would set that expectation.
11. **Deleting a published custom page leaves dead links.** Menu or button links to `/pages/<handle>` point at a 404 after the next publish, and there is no warning. A "used by N links" hint in the delete confirm would help later.

## Deferred minors and parked items in the ledger: fix now?

**Fix now:**
- **Task 5 `EngineViews.tsx:442` product links without preview params:** promoted to **I3**. It also covers the product page's rails.
- **Task 7 "signups can be sent from preview/editor":** fold into the I1 fix (Minor 4).

**Surface to the user:**
- **Task 2 `td` truthiness:** this is **I4**.

**Keep deferred:**
- **Task 1:**
  - The `page-loader.ts` `templates[templateKey]` lookup is safe in practice. Every caller passes a code key or `pageKey()` of a validated handle, and no prototype key is reachable.
  - Loader tests and the UUID regex duplication.
- **Task 2:** the redundant `withEnginePreview` and untested `td`-only review GET (covered by I4's decision).
- **Task 3:** disabled buy button gray in dark schemes; `main-product` gutter; context duplication; test naming. These are visual or cleanup items, and staging will show them.
- **Task 4:** `limit:1`, the `useEngineEditor` one-render lag, review-heading aria.
- **Task 5:** catalog redirect e2e; the `cache()` key.
- **Task 6:** test cleanup.
- **Task 7:** newsletter no-JS action; countdown local time; countdown render after mount.
- **Task 8:**
  - Minors 2-6 (top "+" over a hidden first section, wasted reload on switch, Preview copy falling back to `/`, stale-drop untested, sweep every load).
  - Section-setting product pickers listing all items. Low impact: a non-store pick simply does not render. `storeOnly` is now a one-prop change on `ProductPicker` if wanted.

**Parked M2 (D25):** M2 (backup written per keystroke), N4 and N5. Nothing in M3 makes these worse.

**For Task 11:** the e2e still needs the `add-at {template, after}` shape. The working tree's `e2e/store-studio2.spec.ts` already mentions it. It also needs R2's add-a-Delivery-estimate step, and staging steps for I1-I3 once fixed.

## Rulings made during M3

- Ruling R1: Task 9 gives linkOptions a second parameter `pages = []` with a default — keeps Task 5's callers valid — cost if wrong: one call-site update.
- Ruling R2: Task 11's product scenario first adds a Delivery estimate block from the tree's add-block menu, then edits its text — the default product template has no such block — cost if wrong: a scenario rewrite.
- Ruling R3: Task 6's DB test is a contract test and may pass before the route exists; the route + metadata are verified by the browser check and Task 11 — cost if wrong: weaker red-green evidence for the route.
- Ruling R4: storefront client components under components/store/engine/{product,catalog}/* may also import @/lib/store/product-jsonld, @/components/store/StoreStars, @/components/store/StoreProductCard and type-only @/lib/store/variant-options — plan-named (D16/D17), dependency-free, no db/sanitiser — cost if wrong: a later import cleanup.
- Ruling R5: the home cat/q redirect runs only when the catalog template has an enabled section — reconciles D14 with D15 and avoids a /catalog <-> /?cat loop — cost if wrong: an engine store with an empty catalog keeps M1's home narrowing.
- Ruling R6: header search product picks lose preview params (project C HeaderSearch pushes itself) — accepted known gap, no project C edit; the editor frame blocks navigation anyway — cost if wrong: a shared preview link drops to the live product on a search pick.
- Ruling R7: "Load more" not exercised live (ganesh has 10 products, page 40) — accepted on code reading; e2e has no larger store — cost if wrong: a pagination bug surfaces on a big store.
- Ruling R8: newsletter signups appear in Store enquiries with topic newsletter and send the normal merchant enquiry notification — D19 routes them through enquiries, and per-signup notices tell the merchant it works — cost if wrong: notification noise on busy stores (filter by topic later).
- Ruling R9: newsletter signups are accepted even when the store's contact form is disabled — the merchant opted in by adding the section — cost if wrong: one condition to flip.
- Ruling R10: fix the picker now rather than defer — add an opt-in `store_only=1` query param to GET /api/items (filters show_in_store OR featured_in_store, business from session) and have the preview picker's searchItems pass it — a picker whose default pick shows "Product not found." is a visible editor defect, and the param is additive — if wrong, a harmless extra filter param.
- Ruling R11 (user direction): no more local browser checks; Task 9/10/11 write staging test steps instead; Task 10 done by controller; e2e written not run locally; test on staging after deploy (deploy needs user go-ahead)
- Ruling R13: fix wave = I1 (accept newsletter only when the store's live engine theme has an enabled newsletter section; preview/editor signups refused), I2 (show_payment_icons default false, render only when === true, presets false), I3 (engineProductHref at the 4 sites), Minor 1 (store_only = show_in_store only). I4 surfaced to the user, not fixed — it spans 8 routes and the old Studio. Other minors stay deferred.
