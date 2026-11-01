# Heritage Couture (premium theme, plan 2): staging test checklist

> **2026-11-01:** premium presets are free for every store (`PREMIUM_THEMES_FREE` in `lib/store/engine/premium.ts`), so skip any step below that turns `store_premium_themes` on or expects Heritage Couture to be hidden or refused; Heritage Couture is listed with its Premium pill for everyone.

What to check on `https://staging.khatario.com` once plan 2 is deployed there. **Nothing in this list has ever been checked in a browser**: the plan was built without local browser checks (owner's rule: write the steps, test on staging). Migration 459 has only ever run on the disposable DB `kh_phase2_test`. The five e2e scenarios added in Task 7 (`e2e/store-studio2.spec.ts`, `e2e/store-theme-library.spec.ts`) are written, not run, and cover only structure; every look below is a human check.

Branch `claude/heritage-couture` (worktree), base `658369e2` (plan 1 merged to `main`). Tasks 1 to 7. Nothing is pushed. Carry-over, rulings and deferred minors: `docs/superpowers/plans/2026-10-31-store-heritage-couture-carryover.md`. The checklist for the next design: `docs/store-engine/design-to-preset.md`.

Use an engine test store (`store_engine` on) and a merchant login with settings permission (staging E2E keys from `.env`). Keep `store_engine` off for every real store throughout. A second engine test store, left with the premium flag off, is needed for section 1.

## Before deploying (owner approval required)

**Migration `database/migrations/459_store_premium_themes.sql` must run on staging BEFORE the plan 2 code is deployed.** The owner runs migrations; agents never do. It adds `business_settings.store_premium_themes BOOLEAN NOT NULL DEFAULT false` (idempotent, `ADD COLUMN IF NOT EXISTS`).

If the code ships first: the themes route reads the new column on every GET of `/api/settings/online-store/themes` (`premium_enabled`), so **the theme library page fails to load** until 459 runs. Running 459 before the code is safe: nothing reads the column yet and it defaults to off.

**Plan 1's migration 458** (`items.store_badge`, `store_tagline`, `store_swatches`) is also still owed on staging; Heritage Couture's cards, product page tagline and Signature pieces depend on it. Run 458 then 459.

- [ ] The owner approves the migration run.
- [ ] 458 and 459 run on staging, in that order, before the code is deployed. Check neither number clashes with another session's file (the M5 carry-over noted a 448 and an untracked 455 elsewhere).
- [ ] No script runs for plan 2.
- [ ] `store_engine` is off for every real store after deploy.
- [ ] **The premium flag has no admin screen.** Turn it on for the engine test store by hand, by the owner, in the staging database: `UPDATE business_settings SET store_premium_themes = true WHERE business_id = '<the test store's business id>';` Leave it off for every other store.

## 1. The premium flag (Task 6)

- [ ] **Flag off** (the default): Settings, Online store, Themes (beta), Add theme lists exactly five presets (Studio, Quick, Premium Grocery, Khatario, Blank) plus "Your current store design". No Heritage Couture, no "Premium" pill.
- [ ] Flag off, in the console as the store's admin: `fetch('/api/settings/online-store/themes').then(r=>r.json())` has `premium_enabled: false`. `fetch('/api/settings/online-store/themes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({preset:'heritage'})}).then(r=>r.status)` gives `403`, and the body's `code` is `premium_locked`. The theme count does not change.
- [ ] Flag off: a `POST` with `{preset:'studio'}` and one with `{source:'migrated'}` still work (the gate touches only premium presets).
- [ ] **Turn the flag on** (see above), reload the library: the list now has seven choices, Heritage Couture among them with an amber "Premium" pill after its name, and its description mentions the sample images.
- [ ] A user with settings update but a store with the flag off (the second test store): still no Heritage card.
- [ ] Flag on, Add theme, Heritage Couture, type the name "Heritage Couture" in the Name field: a draft with that name appears first in Drafts, labelled with the preset. (Left empty, the server names it "Untitled theme".)
- [ ] **Flag off again** after a Heritage theme exists: the card is hidden and the POST is refused again, **but the existing Heritage theme still opens in the editor, can be renamed, duplicated (the duplicate is allowed: `duplicate_of` is never gated), published and restored from version history.**
- [ ] Known edge: with the Add theme modal open and Heritage selected, turning the flag off in the database does not change the open modal; creating then returns the 403 as an error toast. Reload to clear it.

## 2. The Heritage Couture home page (Tasks 1 to 5)

Open the new draft's preview (Preview link, or Customise then the editor). First on a desktop window, then at 390 px wide (browser device mode or a real phone). Heading and body fonts should be **Newsreader** (headings) and **Manrope** (text); confirm in the inspector.

Placeholder rule: the preset ships **no invented claims, reviews, press names or customer photos**. Every promise, testimonial and press line is instruction text for the merchant to replace. Check that nothing reads like a real claim by the store.

- [ ] **Announcement bar**: the store's tagline, else "Welcome to <store name>", on a dark (crimson) scheme. No shipping or price claim.
- [ ] **"Our story" links**: the header menu link, the Collage's second button and the story section's "Read our story" button all open `/pages/our-story`, a custom page the preset ships (title "Our story", an Image with text and a Rich text section with instruction copy). None 404s on the storefront once the draft is published; the page is listed under Pages in Studio 2.
- [ ] **Header**: logo or name, five menu links (New in, Sarees, Bridal, Jewellery, Our story), search, account, cart. Caps or spaced labels as the preset styles them.
- [ ] **Collage hero** (text on the left): eyebrow "Festive & bridal edit", heading "Welcome to <store name>", the tagline as text, two buttons ("Explore the collection" filled, "Our story" outline), three sample picture tiles with the first larger. **Picture art check**: the nine SVGs under `public/store-presets/heritage/` were never looked at by eye (the browser could not render local files during the build); judge the lattice, paisley, arch and diamond shapes. Tiles do not stretch or leave gaps; the grid is not lopsided with exactly three tiles.
- [ ] Collage at 390 px: text first, tiles below; the first tile spans the row, the other two sit side by side. Buttons wrap rather than overflow.
- [ ] **Pillars** (Multicolumn): four columns, icons, titles Delivery, Materials, Made to measure, Personal service, with instruction texts. Two per row on a phone.
- [ ] **Four promo cards**: overlay style, four across on desktop, two per row on a phone; each shows eyebrow, heading and "Shop now" over a sample picture, and the overlay text is readable on every picture. They link to the catalog.
- [ ] **Signature pieces** (Featured products, four columns): on a store whose featured items have a badge, tagline and swatches (set them in the item form, "Card" group): the badge shows on the photo, the tagline above the name, the swatch dots after the price, with the swatch name on hover. Items without them show no empty gaps. A very long tagline is clipped, not overflowing the card.
- [ ] **Story section** (Image with text): picture left, eyebrow "Our craft", heading "Tell the story of your craft", text, a quote, three checklist items with ticks, a "Read our story" button, and the **highlight card** (eyebrow "Your promise", title "Add the one promise you make") sitting over the picture's lower corner on desktop and stacking under the picture on a phone. The card text is readable and not clipped.
- [ ] **Shop the look**: with no hotspots yet, the editor shows a note ("Add a hotspot and pick a product") and the section shows the photo and heading but **no list** (the list only draws once a hotspot resolves to a product); **shoppers see no note** (open the storefront preview link in a private window after publishing). Then in Studio 2 add two hotspots with real products (Add block, Hotspot, search the product, set the horizontal and vertical position boxes, optionally a label):
  - [ ] Each pin sits where its percentages say, as a numbered round button in the button colour, and stays on the photo at 390 px.
  - [ ] **On the storefront (not inside the editor, whose click guard swallows clicks)**: clicking a pin opens a small card with the photo thumbnail, name, price and "Add to bag"; one card open at a time; Esc closes it and focus returns to the pin; clicking elsewhere closes it. A pin near the left or right edge (x under 30 or over 70) keeps its card on the photo; a pin low on the photo (y over 55) opens its card above.
  - [ ] "Add to bag" puts the item in the cart (check the cart count and the cart page) and the button reads "Added" for a moment. A product with sizes or colours shows "Choose options" and goes to its page; a sold-out one shows "Sold out".
  - [ ] The list beside the photo repeats the products with numbers and the same buttons; turn on Show "Add all to cart": the button reads "Add all to bag · ₹total" and adds each addable item once (an item with options is skipped and left out of the total).
  - [ ] Show product list off with Add all on: only the Add all button shows. Image position Right swaps the sides on desktop; on a phone the photo is always first.
  - [ ] Known: a card on a pin near x 30 or 70 can overhang the photo edge at 390 px; look and decide.
- [ ] **Testimonials**: one placeholder quote ("Tell shoppers what a customer said about you."), summary line off. Add your own and turn Show summary on to see the "4.x / 5 from N reviews" line.
- [ ] **Press names** (Logo list): heading "Add your press mentions", three name-only entries drawn as text in the heading font, no captions.
- [ ] **Gallery** (Image gallery, four sample pictures, "@yourstore" subcaption): grid at four columns, square pictures; the subcaption shows on hover on desktop and always on touch. Then try:
  - [ ] Masonry layout: uneven picture heights, no stray gap at the bottom of a column.
  - [ ] Scrolling strip: at 390 px about two pictures show with the next one peeking in, the strip scrolls sideways, and the keyboard focus ring is visible (a known minor: it can clip at the strip's edge). On desktop it shows the set columns per view.
  - [ ] Give one picture a link and no caption: the picture is a link with an accessible name ("Gallery image N"; check with a screen reader or the accessibility tree).
- [ ] **Newsletter**: heading "Stay in touch", the text ("Say what shoppers get when they sign up."), the signup works the way it does on other themes.
- [ ] **Footer**: dark scheme, about text is the tagline when set, menu columns, payment icons shown.
- [ ] Scheme colours: ivory, parchment, crimson, dark, cream and gold papers read cleanly; **eyebrows, links and checklist ticks on the light papers use a deeper antique gold** (ruling in the carry-over) and are readable; gold on crimson and dark is brighter.
- [ ] **The store accent does not change this theme**: change the store's accent colour in Online store settings, then Add theme → Heritage Couture: the new theme is still crimson and gold (ruling: the palette is fixed; merchants edit the colour schemes in Studio 2 if they want their brand colour). Confirm that is acceptable.
- [ ] **Style settings are on** for this preset (Theme settings, Style: Label style Spaced capitals, Frame style Thin accent border, Background texture Dots; square buttons, bordered cards): the preview root carries `eng-labels-caps eng-frame-accent eng-texture-dots`; eyebrows and small labels are spaced capitals, cards and promo pictures have a thin accent border, the dots do not hide text on any section.

## 3. Product page and catalog

Open a product in the preview of the Heritage draft.

- [ ] Title with the product's **tagline** under it (the Title block's Show tagline is on for this preset), price, variant picker, buy buttons, description.
- [ ] **Three tabs** below the description: "Craft and provenance", "Care", "Delivery and returns", each with instruction text, opening and closing; the first is not forced open by anything odd.
- [ ] Reviews, Related products and Recently viewed follow.
- [ ] **Catalog**: four product columns on a wide desktop; fewer on narrower windows and two on a phone; the cards show badge, tagline and swatches the same way as on the home page.
- [ ] Fonts on product page and catalog are Newsreader headings and Manrope text. Newsreader is declared without a size-adjusted fallback (plan 1): look for a small layout shift on first paint.

## 4. Publish and storefront

- [ ] Fill the placeholders you care about, publish the Heritage draft: the live storefront matches the preview (home, a product, the catalog). Look at it as a shopper in a private window.
- [ ] **Parity**: an existing store on another preset is unchanged after the deploy (home, product, catalog), including its cards and header.
- [ ] Version history lists the publish; Restore as draft works; the restored draft keeps `preset` Heritage Couture.
- [ ] Duplicate the Heritage draft with the flag **off**: allowed. Delete the copy.

## 5. Collage, Shop the look and Image gallery as general sections (Tasks 2 to 4)

These are general sections, not Heritage-only: add them to a theme from another preset (the sections are in Add section for Studio, Quick, Grocery, Khatario and Blank).

- [ ] **Collage**: Add section, Collage. Layouts Text on the left, Text on the right and Tiles only; Tile sizes First tile larger and All equal; Portrait and Square shape. With **exactly two tiles** and the first larger, the pair reads 2:1, neither a sliver. Image tiles take an image or video, a caption, a label and a link; a **Product tile** shows the product name and price in its caption and links to the product; a **Category tile** shows the category name and links to the catalog for it. A tile with no image (image tile) is skipped; a product tile with no image of its own uses the product photo. Four tiles is the limit.
- [ ] Collage with a text layout and no tiles shows only the text; Tiles only with no tiles draws nothing (an empty section for shoppers).
- [ ] **Image gallery**: Add section, Image gallery; layouts Grid, Masonry, Scrolling strip; Columns 2 to 6, Gap, Image shape (Square, Portrait, Natural), On hover (Nothing, Show caption, Show caption and link). With hover Nothing the caption is the picture's alt text. Sixteen pictures is the limit.
- [ ] **Shop the look** on a product page and on a custom page (it is offered on both, and on the home page).
- [ ] The sections show in the Add section dialog under the right categories (Collage under Banners, Shop the look under Products, Image gallery under Media).
- [ ] Undo and redo after each block add, reorder and setting change; reload keeps everything.

## 6. Plan 1's checklist: items still open

Plan 1 (premium foundations) merged to `main` as `658369e2` **without ever being checked on staging**, and nothing in `docs/superpowers/plans/2026-10-31-store-premium-foundations-carryover.md` has been ticked since. Run those lists on the same engine test store; they are not repeated here. In order of how much Heritage Couture leans on them:

- [ ] Plan 1 section 6, **content blocks**: old Image with text and Rich text themes convert and look the same; Add block offers Eyebrow, Heading, Text, Quote, Checklist item, Button and Highlight card; reorder, hide, reload; highlight card placement; Narrow image; centring; two buttons in a row. The Heritage story section is built on these.
- [ ] Plan 1 section 4, **cards**: Show tagline and Show colour swatches; a custom badge replaces only the "% OFF" badge and keeps the struck MRP; the Title block's Show tagline; swatches and tagline at phone width.
- [ ] Plan 1 section 3, **product card fields in the item form** ("Card" group: badge, tagline, swatches, limits, remove from the middle, 7-swatch refusal, public item route).
- [ ] Plan 1 section 2, **Style settings**: spaced capitals, thin accent border (`.heroImg` 1px shift, border following the corner radius), Dots, Linen and Grid on sections with and without a scheme, root classes, publish.
- [ ] Plan 1 section 1, **fonts**: all six in the Heading and Body lists, the file loads only when used; Newsreader's layout shift; Outfit's first-paint swap (it also has `preload: false` now).
- [ ] Plan 1 section 7, **small block upgrades**: Testimonials title, location, purchased and summary; Logo list name-only and captions; Promo cards at four columns (split cards cramped on a phone); Multicolumn photo columns.
- [ ] Plan 1 section 8, **whole editor pass**, including Publish and Restore.
- [ ] Plan 1's migration 458 run on staging (see "Before deploying").
- [ ] Section 5 of plan 1 (products-by-id loader) is now exercised by Shop the look and Collage product tiles: a hotspot or tile whose product was since deleted draws nothing (no pin, no list row, no tile) instead of breaking the page.
