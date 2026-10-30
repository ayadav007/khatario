# Store shopping features (project C) — design

Date: 2026-10-29. Status: awaiting owner review.

Shopify-grade shopping features for the Khatario online store: catalog browsing, a richer product
page, text and photo reviews, and abandoned-cart recovery. Built as theme-independent feature modules
so the parallel theme-engine session can wrap them as sections and blocks later.

## 1. Intent

- **For:** shoppers on any merchant's store (`<subdomain>.khatario.com`), and merchants in the admin.
- **Outcome:** browsing, choosing and buying feel like a Shopify store; merchants moderate reviews and
  recover carts without a plugin.
- **Success:** each phase works on all four themes (studio, quick, grocery, khatario) today, has unit
  and DB tests, and is checked in the browser on a `localhost` subdomain.

### Owner decisions (from brainstorming)
1. Phase order: Catalog → Product page → Reviews → Abandoned cart.
2. Reviews: only shoppers with a **delivered** store order for the item can post ("Verified buyer").
   Text-only reviews publish at once; reviews with photos wait for approval. Merchant can hide or reply.
3. Abandoned cart: one automatic reminder after N hours (setting, off by default, default 3 h), push
   if the shopper has the app else WhatsApp, plus a manual "Send reminder" button. Max one auto
   reminder per cart.
4. Product extras: video URL and up to 4 info tabs per item; size chart per category, overridable
   per item.
5. Architecture: feature modules (pure lib + API + prop-driven component), mounted into today's
   pages. Product page split into sibling section components now.

## 2. Hard rules

- **No dependency on a theme.** Components read colours from `--primary`, `--store-accent`,
  `--paper`. No imports from `components/store/studio-theme/*`, `quick-theme/*` internals, or
  `lib/store/store-theme.ts` beyond what today's mount points already pass as props.
- **Do not edit** `components/store/admin/theme-studio/*`, `lib/store/studio-*.ts`,
  `lib/store/store-theme.ts`, `components/store/studio-theme/*`. Needs there go in §8.
- `business_id`, `customer_id`, `order_id` come from the subdomain or the OTP cookie
  (`readStoreCustomer`), never the request body.
- Migrations: `database/migrations/448_store_product_page_reviews.sql` and
  `449_store_abandoned_carts.sql`, applied to `kh_phase2_test` only; mirrored in
  `database/schema.sql`.
- Shared folder with another session: touch only files listed here, commit nothing unless asked.

## 3. Layout of the new code

```
lib/store/
  store-items-query.ts      (extend: filters, sorts, byIds)
  store-facets-query.ts     (new)
  store-suggest.ts          (new)
  variant-options.ts        (new, pure)
  related-products.ts       (new)
  recently-viewed.ts        (new, client, localStorage)
  product-jsonld.ts         (new, pure)
  reviews.ts                (new)
  abandoned-carts.ts        (new)
components/store/features/
  catalog/   useCatalogFilters.ts CatalogFilterPanel.tsx CatalogSortSelect.tsx
             ActiveFilterChips.tsx SearchSuggest.tsx
  product/   ProductGallery.tsx VariantPicker.tsx ProductInfoTabs.tsx SizeChartSheet.tsx
             RelatedProducts.tsx RecentlyViewed.tsx ProductJsonLd.tsx
  reviews/   ReviewSummary.tsx ReviewList.tsx ReviewForm.tsx
components/store/admin/
  StoreReviewsManager.tsx AbandonedCartList.tsx ItemStorePageFields.tsx CategorySizeChartEditor.tsx
app/api/public/store/[subdomain]/
  items/route.ts (extend)  items/facets/route.ts  search/suggest/route.ts
  items/[id]/route.ts (extend)  items/[id]/related/route.ts  items/[id]/reviews/route.ts
  reviews/route.ts  reviews/[id]/route.ts  cart/route.ts
app/api/settings/online-store/
  reviews/route.ts  reviews/[id]/route.ts  abandoned-carts/route.ts  abandoned-carts/[id]/remind/route.ts
app/api/cron/abandoned-carts/route.ts
```

Every feature component takes data and callbacks as props and owns no fetching; a small hook next to
it (or the page) fetches. That is what makes the engine wrap trivial: a section passes settings as
props.

## 4. Phase 1 — Catalog browsing

### 4.1 Query (`lib/store/store-items-query.ts`)
`StoreItemsQueryInput` gains:

| field | SQL |
| --- | --- |
| `minPrice`, `maxPrice` | `i.selling_price BETWEEN` (each optional, clamped ≥ 0) |
| `categoryIds: string[]` | `i.category_id = ANY($n)` (replaces single `categoryId`; the old field stays as sugar) |
| `brands: string[]` | `i.brand = ANY($n)` |
| `inStockOnly` | `(stockExpr > 0 OR EXISTS variant with stock > 0)` using the branch-aware expressions already built |
| `minDiscountPct` | `i.mrp > 0 AND (i.mrp - i.selling_price) / i.mrp * 100 >= $n` |
| `ids: string[]` | `i.id = ANY($n)`; result ordered by `array_position`, no count/category queries (`byIds` branch) |

`StoreItemsSort` becomes `'name' | 'new' | 'bestsellers' | 'price_asc' | 'price_desc' | 'discount' | 'rating'`.
`rating` orders by a Bayesian average: `(sum + 3.5*5) / (count + 5)` (prior 3.5, weight 5), then count,
then name. `discount` orders by percentage off, nulls last. `parseStoreItemsSort` accepts all seven.
Unknown query params are ignored; numbers clamped; arrays capped at 20 values.

The list `SELECT` adds `i.brand`. `StoreProduct` gains `brand?: string | null`.

### 4.2 Facets (`lib/store/store-facets-query.ts`)
`buildStoreFacetsQuery({businessId, search, categoryIds, brands, inStockOnly, minDiscountPct, minPrice, maxPrice, branchId})`
returns one SQL per facet; each facet ignores **its own** filter and applies the others:
- `price`: `MIN(selling_price), MAX(selling_price)`.
- `categories`: id, name, count.
- `brands`: brand, count — **only emitted when ≥ 2 distinct brands** exist in the store's visible items.
- `discount`: counts for buckets 10/25/50 % — emitted only when at least one item is discounted.
- `in_stock`: count.

Route `GET …/items/facets` runs them in one `Promise.all`, caches 30 s per (store, params) in the
in-process cache used by the store route (`lib/cache` if present, else a module `Map` with TTL).

### 4.3 Suggest (`lib/store/store-suggest.ts`)
`buildSuggestQuery(businessId, q)`: `q` trimmed, ≥ 2 chars, ≤ 60, `%` and `_` escaped. Products:
name/code/brand `ILIKE`, ranked word-start match before substring, limit 6, returns id, name,
image_url, selling_price, mrp. Categories: name `ILIKE`, limit 3. Route
`GET …/search/suggest?q=` caches 30 s.

### 4.4 Components (`components/store/features/catalog/`)
- `useCatalogFilters(searchParams)`: parses/serialises `cat`, `brand`, `min`, `max`, `stock`,
  `disc`, `sort`, `q`; `set()` rewrites the URL with `router.replace`, **preserving every unknown
  param** (the Studio draft param among them). Pure parse/serialise functions exported for tests.
- `CatalogFilterPanel({facets, value, onChange, layout: 'sidebar' | 'sheet'})`: price range (two
  inputs + slider), category checkboxes, brand checkboxes, in-stock toggle, discount radio. Sheet
  layout has Apply/Clear footer. Colours from CSS variables only.
- `CatalogSortSelect({value, onChange})`: the seven sorts.
- `ActiveFilterChips({value, facets, onRemove, onClear})`.
- `SearchSuggest({subdomain, value, onChange, onPick, onSubmit})`: 200 ms debounce, aborts stale
  requests, arrow/enter/escape keys, `role="listbox"`.

### 4.5 Mounts
`StoreCatalogView` (category and search listings): sidebar panel at ≥ 1024 px, "Filters" button
opening the sheet below; sort select in the toolbar; chips above the grid. Store header search
box (`StoreShell`, Quick chrome, grocery chrome) wraps its input with `SearchSuggest`. Home
product rows keep their configured sort.

Out of scope: variant-attribute filters (size M) — needs attribute indexing; noted in §9.

## 5. Phase 2 — Product page

### 5.1 Data (Migration 448)
```sql
ALTER TABLE items ADD COLUMN IF NOT EXISTS video_url TEXT,
  ADD COLUMN IF NOT EXISTS store_tabs JSONB NOT NULL DEFAULT '[]',   -- [{title, body}] ≤ 4
  ADD COLUMN IF NOT EXISTS size_chart JSONB;                           -- {columns:[], rows:[[]]} | null
ALTER TABLE categories ADD COLUMN IF NOT EXISTS size_chart JSONB;
```
`item_variants.attributes` (`{"color":"Blue","size":"L"}`) is used as is.

### 5.2 Lib
- `variant-options.ts` (pure): `variantOptions(variants)` → axes `[{key, label, values:[{value, inStock, variantIds}]}]`.
  Keys normalised case-insensitively; `colour`/`color` merge into one axis labelled "Colour".
  `isSwatchable(value)` true for CSS colour names/hex or a 40-entry name map (incl. Hindi-English
  common names: maroon, peach, mustard…). Variants with empty attributes → one axis "Option" with
  `variant_name` values (the common case today). `resolveVariant(variants, selection)` → variant or
  null; `nextSelection(axes, selection, key, value)` keeps other axes valid.
- `related-products.ts`: `buildRelatedQuery(businessId, itemId, categoryId, brand, limit=8)`: same
  category first, then same brand, then bestsellers, excluding the item; visibility rules reused.
- `recently-viewed.ts` (client): `pushRecentlyViewed(subdomain, id)`, `readRecentlyViewed(subdomain)`
  → last 12 ids, newest first, try/catch around storage.
- `product-jsonld.ts` (pure): `productJsonLd(product, store, reviewSummary)` → schema.org Product with
  `offers` (INR, availability), `aggregateRating` when count > 0.

### 5.3 APIs
- `GET …/items/[id]`: adds `brand`, `video_url`, `store_tabs`, `size_chart` (item's, else its
  category's), `variants[].attributes`.
- `GET …/items/[id]/related` → `StoreProduct[]`.
- `GET …/items?ids=` (byIds branch) for recently viewed.
- Item admin save (`app/api/items/[id]` PUT) accepts `video_url`, `store_tabs`, `size_chart`;
  validation: video_url is https YouTube/youtu.be or `.mp4`/`.webm`; tabs ≤ 4, title ≤ 40, body ≤ 4000;
  size chart ≤ 8 columns × 20 rows. Categories API accepts `size_chart` with the same shape.

### 5.4 Components (`components/store/features/product/`)
- `ProductGallery({images, videoUrl, alt, onOpenLightbox?})`: thumbnails (vertical ≥ 1024 px,
  horizontal below), swipe via pointer events, hover zoom on desktop (2× pane), pinch zoom inside the
  lightbox on touch, video as the last slide (YouTube iframe `youtube-nocookie`, or `<video controls>`).
  Replaces `StoreProductGallery` internals; old export kept as a thin alias for the modal.
- `VariantPicker({variants, value, onChange})`: one row per axis; swatches when `isSwatchable`,
  chips otherwise; out-of-stock values struck through and still selectable (shows "Out of stock");
  emits the resolved variant id so existing cart code (`StoreProductDetailModal`, product page) is unchanged.
- `ProductInfoTabs({description, tabs, sizeChart, policies?})`: tabs ≥ 768 px, accordion below;
  "Size chart" tab opens `SizeChartSheet`.
- `SizeChartSheet({chart, open, onClose})`: bottom sheet / dialog, scrollable table.
- `RelatedProducts({products, onOpen, title})`, `RecentlyViewed({products, onOpen})`: horizontal rail
  of `StoreProductCard`.
- `ProductJsonLd({json})`: `<script type="application/ld+json">`.

### 5.5 Page composition
`app/store/products/[id]/page.tsx` becomes a mount list of sibling sections in this order:
`product-gallery`, `product-info` (title, brand, price, stars, variant picker, qty, add to cart,
wishlist), `product-tabs`, `product-reviews` (phase 3), `related-products`, `recently-viewed`.
Each section is one component with props; the page only fetches. `StoreProductDetailModal` and
Quick's product sheet mount gallery, picker and tabs; the Khatario-pack view keeps its layout and swaps
in the same pieces.

### 5.6 Admin
`ItemStorePageFields` card ("Store page") on `app/(app)/items/[id]` and `items/new`: video URL,
tabs editor, size chart editor (reusing `CategorySizeChartEditor`, with "Use category chart" default).
`CategorySizeChartEditor` on the categories page. Both under `components/store/admin/`.

## 6. Phase 3 — Reviews

### 6.1 Data (Migration 448)
```sql
CREATE TABLE store_item_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES store_customers(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  order_id UUID REFERENCES store_orders(id) ON DELETE SET NULL,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title VARCHAR(120), body TEXT NOT NULL,
  photos JSONB NOT NULL DEFAULT '[]',          -- ≤ 4 URLs
  status VARCHAR(10) NOT NULL DEFAULT 'published' CHECK (status IN ('published','pending','hidden')),
  merchant_reply TEXT, replied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, customer_id, item_id)
);
CREATE INDEX ON store_item_reviews (business_id, item_id, status, created_at DESC);
CREATE INDEX ON store_item_reviews (business_id, status, created_at DESC);
```
Posting a review also upserts `store_item_ratings` (same customer/item/rating), so the Studio
preview, product cards and the rating sort keep working. **One rating expression:** the items
query's `rating_avg`/`rating_count` keep reading `store_item_ratings`; a review that is hidden
deletes its `store_item_ratings` row, unhide re-inserts it. So averages always count published
reviews plus legacy star-only ratings.

### 6.2 Rules
- Eligible: an OTP-signed-in shopper with a `store_orders` row `status = 'delivered'` for this
  business and customer whose `store_order_items` contain the item. The server picks the latest such
  order as `order_id`.
- Status on insert: `published` when `photos` is empty, else `pending`.
- One review per shopper per item; editable by its author for 30 days (edit re-applies the status
  rule). Merchant actions: `hide`, `publish`, `reply` (≤ 1000 chars), `delete_reply`.
- Photos: uploaded by the shopper through a new `POST …/reviews/photos` that reuses the existing
  upload helper with prefix `store-reviews/<business_id>/`, images only, ≤ 2 MB, ≤ 4 per review,
  requires the OTP session. (The public store has no upload route today; this is the only new one.)

### 6.3 Lib (`lib/store/reviews.ts`)
`canReview(businessId, customerId, itemId)` → `{ok:true, orderId} | {ok:false, reason:'sign_in'|'not_bought'|'already_reviewed'}`;
`createReview`, `updateReview` (author), `reviewSummary(businessId, itemId)` → `{avg, count, histogram[5..1]}`
from published rows; `listReviews({businessId, itemId, sort:'recent'|'highest'|'lowest'|'with_photos', page, pageSize=10})`;
`listReviewsForMerchant({businessId, status?, page})`; `moderateReview(businessId, id, action, payload)`.
`reviewStatusFor(photos)` and histogram math are pure and unit-tested.

### 6.4 APIs
Public: `GET …/items/[id]/reviews?sort&page` → summary + page + `can_review` (uses cookie if present);
`POST …/reviews {item_id, rating, title, body, photos}`; `PATCH …/reviews/[id]` (author);
`POST …/reviews/photos` (multipart).
Admin (tenant session, store permission as `orders`): `GET /api/settings/online-store/reviews?status&page`,
`PATCH …/reviews/[id] {action, reply?}`.

### 6.5 Components
`ReviewSummary({summary, canReview, onWrite})`, `ReviewList({reviews, sort, onSort, onLoadMore, onOpenPhoto})`,
`ReviewForm({onSubmit, uploading, initial?})` with stars, title, body, photo picker, "Verified buyer" note.
Admin `StoreReviewsManager`: table with status filter, item, shopper, stars, excerpt, photos,
actions; new "Reviews" tab on `app/(app)/settings/online-store/page.tsx` beside Orders and Enquiries.
`product-reviews` section mounts summary + list + form on the product page; the modal and Quick sheet
show summary with a "See all reviews" link to the page.

## 7. Phase 4 — Abandoned cart

### 7.1 Existing state
Cart lives only in `localStorage` (`lib/store/store-context.tsx`). Nothing server-side to recover.
Reusable: `enqueueCustomerPush` (`lib/push/customer-push.ts`), `notifyStoreEvent`
(`lib/store/notify-whatsapp.ts`), `TENANT_WA_EVENT_KEYS` registry, cron pattern of `whatsapp-followups`.

### 7.2 Data (Migration 449)
```sql
CREATE TABLE store_carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES store_customers(id) ON DELETE CASCADE,
  items JSONB NOT NULL DEFAULT '[]',   -- [{item_id, variant_id, quantity, price, name, image_url}]
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  status VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open','recovered','cleared')),
  reminded_at TIMESTAMPTZ, reminder_via VARCHAR(10),      -- 'push' | 'whatsapp' | 'manual'
  recovered_order_id UUID REFERENCES store_orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, customer_id)
);
CREATE INDEX ON store_carts (business_id, status, updated_at) WHERE status = 'open';
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS store_cart_reminder_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS store_cart_reminder_hours SMALLINT NOT NULL DEFAULT 3
    CHECK (store_cart_reminder_hours BETWEEN 1 AND 72);
```
`TENANT_WA_EVENT_KEYS` gains `store_cart_reminder` with fields `customer_name`, `store_name`,
`total`, `cart_link` (new field, sample `https://sharma.khatario.com/store/cart`), `item_names`
(new, sample "Basmati rice 5 kg, Ghee 1 L"). `CUSTOMER_PUSH_EVENTS` gains the same key with href
`/store/cart`.

### 7.3 Flow
- Signed-in shopper: `store-context` debounces cart changes 2 s and `PUT …/cart {items}`; the server
  re-prices nothing (snapshot only) and sets `status='open'`, `reminded_at` untouched. Empty cart →
  `status='cleared'`.
- Sign-in: `GET …/cart` returns the server cart; `mergeCarts(local, server)` (pure): union by
  (item_id, variant_id), **server quantity wins** on conflict; result saved both sides.
- Checkout success (`app/api/public/store/[subdomain]/orders` POST, after the order row exists):
  cart `status='recovered'`, `recovered_order_id`.
- Cron `GET /api/cron/abandoned-carts` (Bearer `CRON_SECRET`, every 15 min): for businesses with
  `store_cart_reminder_enabled`, claim open carts with `reminded_at IS NULL`, `items <> '[]'`,
  `updated_at < now() - hours`, and no order by that customer since `updated_at`
  (`FOR UPDATE SKIP LOCKED`, batch 50). Send push when `enqueueCustomerPush` reports queued, else
  WhatsApp via `notifyStoreEvent('store_cart_reminder')`; set `reminded_at`, `reminder_via`. A
  delivery failure is logged and still marks `reminded_at` (the owner decision: one auto reminder).
- Manual: `POST /api/settings/online-store/abandoned-carts/[id]/remind` sends the same way,
  allowed when `reminded_at` is null or older than 24 h; sets `reminder_via='manual'`.
- Carts untouched for 30 days are deleted by the same cron.

### 7.4 Lib (`lib/store/abandoned-carts.ts`)
`saveCart`, `readCart`, `mergeCarts` (pure), `markRecovered`, `dueCarts(client, {limit})`,
`sendCartReminder(cartId, {via})`, `cartReminderMessage(cart, store)` (pure; item names capped at 3
plus "and N more", total formatted ₹). `cartLink(store)` builds the absolute URL from
`store_subdomain` and the store host helper already used for order links.

### 7.5 Admin
`AbandonedCartList`: open carts for the business with shopper name/phone, item count, subtotal,
age, reminder status, "Send reminder" (disabled with tooltip inside 24 h), and a `wa.me` link with
the prefilled message (for merchants without a connected channel). New "Abandoned carts" tab on the
online-store settings page; toggle + hours input in the store settings form (saved through the
existing `PUT /api/settings/online-store`).

## 8. Integration notes for the theme-engine session (no edits by this project)
- Engine block candidates, each already a prop-driven component: `product-gallery`, `product-info`,
  `product-tabs`, `product-reviews`, `related-products`, `recently-viewed`, `catalog-filters`,
  `catalog-sort`, `search-suggest`.
- Section settings the engine may expose: gallery thumbnail position, related-products title and
  count, reviews sort default, filter panel layout.
- `StoreProductCard` gets a `brand` prop only; no visual change.
- Studio draft param must survive filter URL rewrites; `useCatalogFilters` preserves unknown params.

## 9. Out of scope (noted for later)
Variant-attribute filters; review photo moderation by AI; a reminder sequence with coupons;
video upload/transcoding; review solicitation emails/WhatsApp after delivery (would reuse `store_cart_reminder` plumbing).

## 10. Testing
- `tests/lib/store/`: items query filters/sorts/byIds bind counts and SQL fragments; facets query;
  suggest escaping; `variantOptions`/`resolveVariant`; Bayesian rating; JSON-LD; `useCatalogFilters`
  parse/serialise round-trip with unknown params preserved; review status rule and histogram;
  `mergeCarts`; `cartReminderMessage`.
- `tests/db/` on `kh_phase2_test`: facets against seeded items; related query; review eligibility
  (no order, pending order, delivered order), publish/pending status, hide removes the rating row,
  unique per customer; cart lifecycle (save, merge, recovered on order, cleared), cron claim picks
  only due carts once and respects the enabled flag.
- Browser: each phase on `http://ganesh.localhost:<port>` (Map Test Shop in `kh_phase2_test`) on
  studio and quick themes at 390 px and 1366 px; admin tabs signed in.
- `tsc` clean for touched files; the store unit suite still passes.

## 11. Delivery
Four phases, each: migration (if any) → lib + tests → API → components → mounts → browser check →
project-log entry. Nothing committed unless asked; then stage by name.
