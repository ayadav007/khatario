# Online store vs Shopify: setting-by-setting gap audit

Date: 2026-10-31. Asked by the owner after finding header and hero controls missing: "why did you not cover all these when i had asked you to compare with shopify".

## How this was done

- **Shopify side:** Dawn, Shopify's free reference theme (github.com/Shopify/dawn, `main`, read 2026-10-31): `config/settings_schema.json` (theme settings) and the schema of 27 sections, labels taken from its English locale file. Dawn is the baseline every paid Shopify theme builds on, so "Dawn has it" means a Shopify merchant expects it.
- **Our side:** every section, block and theme setting in the engine registry (`lib/store/engine/registry.ts`, `theme-settings-schema.ts`) on `main` at 5e2d6c8e, plus the per-section Colours and Advanced blocks.
- **Why the first design missed this:** the Studio 2 spec (2026-10-29) copied Shopify's structure (sections, blocks, colour schemes, editor, library, versions) and listed which sections to build, but never compared each section's settings with a real Shopify theme. The header was specified as "logo, menu, search, account, cart, delivery ETA", nothing about its layout.
- **Overlap:** the premium themes work (`docs/superpowers/specs/2026-10-31-store-premium-themes-design.md`) has since been merged into `main` (2026-11-01), with Heritage Couture on top. Items it covers are marked **[Done: premium]**; batch 1 builds on its content blocks (`lib/store/engine/content-blocks.ts`).

Priority: **P1** a store owner coming from Shopify notices it on day one (header, hero, text, buttons, product cards). **P2** expected but less visible. **P3** nice to have. **N/A** Shopify-only (markets, Shopify-hosted video, Liquid, dynamic checkout).

## Summary

| Area | Dawn | Us | Biggest gaps |
|---|---|---|---|
| Header | 12 settings | 12 settings | Logo position and width, phone logo position, sticky options, separator, header and menu colour schemes |
| Hero (Image banner) | 15 settings + 3 block types | 7 settings, no blocks | Content position (9 spots), container box, overlay, heading size, 2 buttons with outline style, second image, phone layout |
| Slideshow (per slide) | 13 per slide | 7 per slide | Per-slide position, size, subheading, outline button, container, overlay, colour scheme; pagination style |
| Text everywhere | Heading size S–XXL, caption/subtitle/uppercase styles, inline bold/italic | Plain text fields | Heading size, text styles, bold/italic in headings |
| Theme style | 18 groups, ~110 settings | 12 settings | Type scale, page width, spacing, buttons/inputs/cards/media borders and shadows, badges, animations |
| Product lists | Image ratio and shape, hover image, quick add, phone carousel, "View all" style | Card style, rating, badges, columns | Image ratio, second image on hover, phone carousel |
| Product page | Gallery layouts, zoom, media size, inventory, SKU, icons with text, complementary products | Gallery side, thumbs position, sticky info, 9 blocks | Gallery layouts, zoom choice, inventory and icon blocks |
| Cart | Drawer / page / notification, note, upsell collection, colour scheme | Fixed drawer + page | Cart type, note, upsell, scheme (cart sub-project) |
| Footer | Newsletter, policy links, brand info, image and text blocks, 9 socials | Menu, about, social (4), payment icons | Newsletter in footer, policy links, more socials |
| Colour schemes | Unlimited, add / rename / delete | 6 fixed | Scheme management |

Where we are ahead of Dawn (keep): delivery ETA and pincode, category chips, the Quick theme and phone kit, category rail, per-slide device and video, slide image fit and phone image, countdown, marquee, promo cards, category shelves, testimonials, logo list, per-section custom colours, left/right spacing, custom HTML and custom CSS, GST note, delivery estimate, wishlist, three-level menus with mega panels and automatic categories.

## 1. Header

| Dawn setting | Us | Gap | Pri |
|---|---|---|---|
| Logo (theme setting) + logo width 50–300 | Logo upload; height fixed at 40px | **Logo width/size** | P1 |
| Logo position: top left / top centre / middle left / middle centre | Logo always left | **Logo position** | P1 |
| Phone logo position: centre / left | Always left | **Phone logo position** | P1 |
| Menu + menu type: dropdown / mega / drawer | Menu, below or one line, dropdown and mega by shape | "Drawer" menu on desktop | P3 |
| Sticky header: none / on scroll up / always / always with smaller logo | Always sticky | **Sticky choice** | P2 |
| Separator line | None | Separator line | P3 |
| Colour scheme; separate menu colour scheme | Section scheme | Separate menu-row scheme | P3 |
| Top/bottom padding, bottom margin | Common spacing | — | — |
| Country / language selector | — | N/A | N/A |
| (ours) search, placeholder, delivery ETA, icons position, account/cart/count, category chips, CAPITALS | — | Ahead | — |

## 2. Hero: Image banner

| Dawn setting | Us | Gap | Pri |
|---|---|---|---|
| Image 1 + Image 2 (side by side) | One image | Second image | P2 |
| Overlay opacity | None (slideshow has it) | **Overlay** | P1 |
| Height: adapt to first image / S / M / L | S / M / L | Adapt to image | P2 |
| Animation: ambient / fixed background / zoom on scroll | None | Image animation | P3 |
| Content position, 9 spots | Left / centre / right | **9-spot position** | P1 |
| Content alignment L/C/R | Tied to position | Separate alignment | P2 |
| Container (text box behind words) | None | **Container box** | P1 |
| Colour scheme | Section scheme | — | — |
| Phone: stack images, alignment, text below image | None | **Phone layout options** | P1 |
| Blocks: Heading (size S–XXL, inline bold/italic) | One heading field | **Heading size**, bold/italic | P1 |
| Blocks: Text (style body / subtitle / uppercase) | One description | **Text style**, subheading | P1 |
| Blocks: Buttons (2 buttons, each outline or filled) | One button | **Second button, outline style** | P1 |
| Block order chosen by merchant | Fixed order | Reorderable content | P2 |

There is no section named "Hero"; Image banner is it. **Rename or add a "Hero" preset** in the Add section list so owners find it (P1).

## 3. Slideshow (per slide and section)

| Dawn | Us | Gap | Pri |
|---|---|---|---|
| Layout full width / page | Full width checkbox | — | — |
| Height adapt / S / M / L | S / M / L + image fit (match shape) | — | — |
| Pagination dots / counter / numbers | Dots | Pagination style | P3 |
| Auto rotate + speed | Autoplay + speed | — | — |
| Ambient animation | Ken Burns built in, not switchable | Toggle | P3 |
| Phone: stack text below image | Layout choices | Stack text below on phones | P2 |
| Per slide: overlay | Section-wide darken | Per-slide overlay | P2 |
| Per slide: heading size, subheading | Heading, description | **Heading size**, subheading style | P1 |
| Per slide: button outline style | Filled only | **Outline style** | P1 |
| Per slide: container, 9-spot position, alignment, phone alignment | Section-wide layout | **Per-slide position and container** | P1 |
| Per slide: colour scheme | Section scheme + text colour | Per-slide scheme | P2 |
| Accessibility description | None | Slideshow label | P3 |

## 4. Text controls across sections (cross-cutting)

Dawn gives almost every heading a size (Small / Medium / Large / XL / XXL) and allows bold and italic inside it (`inline_richtext`), and gives text a style (Body / Subtitle / Uppercase). Ours are plain text fields with a fixed size per section.

| Gap | Where | Pri | Note |
|---|---|---|---|
| Heading size S–XXL | Every section with a heading | P1 | **[Done: premium]** adds `heading` blocks with small/medium/large to Image with text and Rich text only |
| Bold / italic / link inside headings and short text | All headings | P2 | |
| Caption / eyebrow style and size | Rich text, Image with text, banners | P2 | Eyebrow exists on product sections; **[Done: premium]** adds eyebrow blocks |
| Text style body / subtitle / uppercase | Text blocks | P2 | **[Done: premium]** `label_style: caps` is theme-wide only |
| Secondary (outline) buttons, two buttons | Banner, rich text, image with text, slides | P1 | **[Done: premium]** button block with filled/outline for Image with text and Rich text |
| Merchant-ordered content blocks | Banner, image with text, rich text, newsletter | P2 | **[Done: premium]** for Image with text and Rich text |

## 5. Theme settings (store-wide style)

| Dawn group | Us | Gap | Pri |
|---|---|---|---|
| Logo width | Fixed | Logo width (see header) | P1 |
| Colour schemes: unlimited, add / rename / delete | 6 fixed, colours editable | **Scheme management** | P1 |
| Typography: heading font + scale 100–150%, body font + scale 100–130% | Two fonts (7 families) | **Type scale**; more fonts **[Done: premium]** | P1 |
| Layout: page width 1000–1600, space between sections, grid spacing | None | Page width, global section spacing, grid gaps | P2 |
| Animations: reveal on scroll, hover lift | None | Animations | P3 |
| Buttons: border thickness/opacity, radius, shadow | Radius only | Border and shadow | P2 |
| Variant pills, inputs: border, radius, shadow | None | Inputs and pills style | P3 |
| Product cards: standard/card, image padding, text alignment, scheme, border, radius, shadow | Plain/bordered/shadow | **Card image padding, text alignment, radius, card scheme** | P1 |
| Collection cards, blog cards: same | Category grid styles | Collection card style group | P3 |
| Content containers, media, pop-ups, drawers: border, radius, shadow | Hard-coded | Media radius/shadow at least | P2 |
| Badges: position on card, radius, sale and sold-out schemes | Show badges on/off | **Badge position and colours** | P2 |
| Brand information: headline, description, image | Footer about text | Brand block | P3 |
| Social: 9 networks | 4 (Instagram, WhatsApp, Facebook, YouTube) | TikTok, X, Pinterest, Snapchat, LinkedIn | P2 |
| Search: suggestions on/off, show price/vendor | Suggestions always on | Search options | P3 |
| Currency codes | — | N/A (INR only) | N/A |
| Cart type drawer / page / notification, vendor, cart note, drawer collection, cart scheme | Fixed | **Cart settings** (cart sub-project) | P1 |
| Customer account menu | — | Account sub-project | P2 |

## 6. Product lists (Featured products, Product rail, Related, Catalog grid)

| Dawn | Us | Gap | Pri |
|---|---|---|---|
| Collection + count | Source (7 kinds) + count | Ahead | — |
| Heading size, description, show collection description, description style | Heading, eyebrow | Heading size, description | P2 |
| Columns 1–6, carousel on desktop | Columns 2–6; rail is a carousel | — | — |
| Full width products | Full width | — | — |
| "View all" button + style link / outline / solid | Shelves only | **"View all" on product sections** | P2 |
| Image ratio adapt / portrait / square | Theme preset decides | **Image ratio** | P1 |
| Image shape (arch, blob, round…) | None | Image shape | P3 |
| Second image on hover | None | **Hover image** | P2 |
| Vendor, rating | Rating, badges; brand in product page | Brand on cards | P3 |
| Quick add none / standard / bulk | Add button on cards | — (ours always adds) | — |
| Phone: 1 or 2 columns, carousel | Phone columns 2/3 | Phone carousel | P2 |
| Catalog: products per page, filter layout horizontal / vertical / drawer, sorting on/off | Filters on/off (sidebar + sheet), sort, count, category rail | **Filter layout choice**, page size | P2 |

## 7. Product page

| Dawn | Us | Gap | Pri |
|---|---|---|---|
| Sticky content | Sticky info | — | — |
| Media width S / M / L, constrain to screen, fit original / fill | Fixed | Media width | P2 |
| Gallery layout: stacked / 2 columns / thumbnails / thumbnail carousel; phone: 2 columns / thumbnails / hidden | Thumbs beside or below | **Gallery layouts** | P2 |
| Zoom: lightbox / click and hover / none | Lightbox + hover zoom fixed | Zoom choice | P3 |
| Loop video, hide other variant media | — | Variant media | P3 |
| Blocks: text, title, price, SKU, inventory status (low-stock threshold, count), quantity, variant picker (dropdown / pills, swatch shape), buy buttons, description, share, collapsible rows with icons, pop-up page link, rating, complementary products, icons with text | Title, price, options, buy buttons, description, collapsible tab, delivery estimate, share, text | **Inventory status**, SKU, variant picker style, **icons with text**, pop-up link (size chart / policy), complementary products, collapsible row icons | P2 |

## 8. Footer, announcement bar, newsletter, others

| Dawn | Us | Gap | Pri |
|---|---|---|---|
| Announcement: several announcements, auto rotate + speed, separator, social icons | One text, scrolling, alignment | **Several rotating announcements** | P2 |
| Footer: email signup with heading | Separate Newsletter section | Newsletter inside footer | P2 |
| Footer: policy links, payment icons, social, follow on Shop | Payment icons, social | Policy links | P2 |
| Footer blocks: menu, brand info, text, image | Menu columns, about text | Text and image blocks | P3 |
| Newsletter: blocks, full width | Heading, text, button, thank-you | — | — |
| Email signup banner (background image, 9-spot position) | None | Signup with image | P3 |
| Video: Shopify-hosted file or URL, loop, full width | YouTube/Vimeo URL + cover | Uploaded video (we host MP4 now) | P3 |
| Collapsible content: icons, image, containers, open first | FAQ (question/answer) | Image, icons, open first | P3 |
| Collection list: image ratio, phone carousel, "View all" | Columns, blocks | Image ratio, phone carousel | P3 |
| Multicolumn: images, image width/ratio, column button, alignment, background, phone carousel | Icon, title, text | Images **[Done: premium]**, button, phone carousel | P2 |

## 9. Sections Dawn has that we do not

| Section | Pri | Note |
|---|---|---|
| Multirow (alternating image + text rows) | P2 | |
| Featured product (one product with buy box on any page) | P2 | |
| Contact form | P2 | |
| Collage | — | **[Done: premium]** (also Shop the look, Image gallery) |
| Email signup banner | P3 | |
| Blog posts, article, blog | N/A | No blog in the store yet |
| Custom Liquid | N/A | Custom HTML covers it |

## Proposed batches

Each batch gets its own spec and plan, P1 first. Batches 1–2 should be agreed with the premium themes work first, because its content blocks change the same sections.

1. **Header and hero.** Logo position, logo width (desktop and phone), phone logo position, sticky choice, separator; a "Hero" entry in Add section; Image banner with overlay, 9-spot position, container box, heading size, subheading/text style, two buttons with outline, phone layout, second image; the same per-slide controls on Slideshow.
2. **Text and buttons everywhere.** Heading sizes S–XXL, bold/italic in headings, text styles, outline and second buttons, "View all" on product sections. Built on the premium plan's content blocks so both use one block system.
3. **Theme style.** Colour scheme management, type scale, page width and section spacing, button border/shadow, product card style group (image padding, text alignment, radius, scheme), badge position and colours, media radius/shadow, more social networks, image ratio and hover image on product cards.
4. **Product page and catalog.** Gallery layouts, media width, inventory status, SKU, variant picker style, icons with text, pop-up link, filter layout choice, page size.
5. **Cart, footer and sign-up.** The cart, checkout and sign-up sub-projects already queued, plus cart type/note/upsell, rotating announcements, newsletter and policy links in the footer.
6. **New sections.** Multirow, Featured product, Contact form, Email signup banner.
