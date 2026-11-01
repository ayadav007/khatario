# Store header and hero (Shopify gap batch 1): design

Date: 2026-11-01
Status: approved in chat section by section, awaiting written review
Source: `docs/plan/STORE_SHOPIFY_GAP_AUDIT.md` batch 1 (header and hero), compared with Shopify Dawn's `header`, `image-banner` and `slideshow` sections.

## 1. Goal

Give store owners Shopify's header and hero controls: where the logo sits and how big it is, how the header behaves while scrolling, and a real hero whose words, buttons, pictures and text position they control, with the same control on every slide of a slideshow. Existing stores look exactly the same until the owner changes something.

### Decisions taken with the user

| Topic | Decision |
|---|---|
| Hero | Upgrade Image banner into the hero ("as Shopify"): listed as **Hero banner**, its words become content blocks, existing banners convert |
| Logo position | All four: left or centre, combined with the existing menu layout (below / one line); phones choose left or centre |
| Sticky header | All four: doesn't stay / comes back when scrolling up / always stays (default) / always stays and the logo shrinks |
| Hero pictures | Phone picture, video (MP4/GIF), a second picture side by side, and movement |
| Slideshow | Everything per slide, as Shopify (no slideshow-wide override layer); existing section-wide darkening and text colour are copied into every slide |

### Assumptions (not stated by the user)

- The hero reuses the content blocks merged with the premium work (`lib/store/engine/content-blocks.ts`); heading sizes grow from three to five and the text block gains a style, for every section that uses those blocks.
- The Quick preset keeps its own app-style header: logo size applies, logo position does not.
- No database migration: everything lives in the theme JSON.

### Out of scope

Separate menu-row colour scheme; a desktop drawer menu; slide counter or number indicators; per-slide movement; bold or italic inside headings (gap batch 2); theme-wide type scale and card styles (gap batch 3).

## 2. Header

New settings on `header` (`lib/store/engine/sections/header.ts`):

| id | Type | Values | Default |
|---|---|---|---|
| `logo_position` | select | `left` \| `center` | `left` |
| `logo_position_mobile` | select | `left` \| `center` | `left` |
| `logo_width` | range 0–300, step 10 | 0 = automatic (today's 40px tall, max 140px wide) | 0 |
| `logo_width_mobile` | range 0–200, step 10 | 0 = automatic (today's 32px tall) | 0 |
| `sticky` | select | `none` \| `scroll_up` \| `always` \| `always_shrink` | `always` |
| `separator` | checkbox | line under the header | true (today's line) |

`menu_layout` (`below` \| `inline`) stays. The four desktop layouts:

- **left + below:** today.
- **left + inline:** logo, menu, search, icons in one row (exists).
- **center + below:** logo row with search on the left and icons on the right, logo centred; menu row centred below.
- **center + inline:** menu left, logo centre, search and icons right; overflow folds into More ▾ as today.

Phones (store container ≤ 640px): `left` is today (☰, logo, icons, search row); `center` puts ☰ left, logo centred, account and cart right, search on its own row.

Logo width sets the image's CSS width (height auto); 0 keeps today's rule. Logo text (no image) is unaffected.

Sticky: the engine's `.st-sticky` wrapper (`components/store/engine/EngineShell.tsx`) reads the header's `sticky` setting. `none` drops `position: sticky`; `scroll_up` hides the wrapper while scrolling down and shows it on scroll up; `always_shrink` adds a class after the first 24px of scroll that scales the logo to 70%. The decision is a pure function `stickyHeaderState(mode, scrollY, lastScrollY, current)` in `lib/store/engine/header-layout.ts`; the component only feeds it scroll positions (passive listener, `requestAnimationFrame`). With `prefers-reduced-motion` the header changes state without sliding. Without JavaScript `scroll_up` and `always_shrink` behave like `always`.

The header's layout classes come from a pure `headerLayoutClasses({ logoPosition, logoPositionMobile, menuLayout, separator })` in the same file. Rendering stays in `StudioHeader` (`components/store/studio-theme/StudioSections.tsx`) via its existing slots; CSS in `components/store/engine/menu/menu.css` or `studio-theme.css` next to the header rules. The Quick header (`EngineQuickHeader` in `EngineViews.tsx`) takes only `logo_width` / `logo_width_mobile`.

## 3. Hero banner (`image-banner`)

Name in Add section: **Hero banner** (type stays `image-banner`, category Banners).

### Settings

| id | Type | Values | Default |
|---|---|---|---|
| `image` | image, `video: true` | picture or MP4/GIF | `''` |
| `image_2` | image, `video: true` | second picture, side by side | `''` |
| `mobile_image` | image, `video: true` | used on phones instead | `''` |
| `height` | select | `adapt` \| `small` \| `medium` \| `large` | `medium` |
| `overlay` | range 0–80, step 5 | photo darkening % | 40 |
| `motion` | select | `none` \| `drift` \| `zoom_scroll` \| `fixed` | `none` |
| `position` | select | `top-left` … `bottom-right` (9) | `middle-left` |
| `align` | select | `left` \| `center` \| `right` | `left` |
| `box` | checkbox | text box in the section's scheme | false |
| `text_color` | color | as the slideshow's | `''` |
| `align_mobile` | select | `left` \| `center` \| `right` | `left` |
| `text_below_mobile` | checkbox | words under the picture on phones | false |
| `two_images_mobile` | select | `stack` \| `first` | `stack` |

Blocks: `eyebrow` (shown as "Label"), `heading`, `text`, `button` from `CONTENT_BLOCKS`; at most 2 `button` blocks; 8 blocks in all. Preset: heading "New arrivals", text "Fresh picks for the season", button "Shop now" → `/catalog`.

Rendering (`components/store/engine/sections/ImageBanner.tsx`, replacing the `EngineBanner` / `StudioBanner` path for engine pages): pictures as background layers (video as the slideshow's `<video>` layer, phone picture swapped by the phone container query as in the slideshow), darkening as a gradient layer (brightness on video), content in a 3×3 grid cell by `position`, aligned by `align`; `box` wraps the words in a card on `--c-card` with `--c-text`; without `box`, words over a picture are white unless `text_color` is set; with no picture the words sit on the section scheme. `adapt` uses the slideshow's `natural` sizing. Two pictures share the width 50/50; on phones `stack` puts them one above the other, `first` shows only `image`. `motion`: `drift` a slow CSS scale/translate loop, `zoom_scroll` scales with scroll progress (one passive listener), `fixed` uses `background-attachment: fixed` (falls back to normal on iOS); all off under `prefers-reduced-motion`.

### Conversion (one time)

In `sanitizeThemeData`, on raw data before sections are sanitised, beside `convertLegacyTextSections` (new file `lib/store/engine/hero-convert.ts`, `convertLegacyHeroSections(raw)`): an `image-banner` section with no blocks and any of `heading`, `description`, `button_text`, `link`, `text_position` gets a `heading` block (when non-empty), a `text` block (description, as one `<p>`), a `button` block (when `button_text` set; `link` kept), `position: middle-<text_position>` and `align: <text_position>`; the old keys are deleted. Overlay keeps the schema default 40, which is today's fixed darkening. Same id rule and purity as `text-sections-convert.ts`; idempotent (a banner with blocks is left alone).

## 4. Shared content blocks

In `lib/store/engine/content-blocks.ts`:

- `heading.size` options become `small`, `medium`, `large`, `xl`, `xxl` (default `medium`); `content-block-rules.ts` adds `.eng-cb-size-xl` and `.eng-cb-size-xxl` and the hero's own scale. Existing values are unchanged.
- `text` gains `style`: `body` \| `subtitle` \| `caps` (default `body`): subtitle is larger and lighter, caps uppercase with letter spacing.
- `content-blocks-map.ts` carries the two new fields; `ContentBlocks.tsx` renders them.

## 5. Slideshow (`slideshow`)

Section settings kept: `autoplay`, `speed`, `height`, `image_fit`, `layout`; new `text_below_mobile` (checkbox, false). Removed after conversion: `overlay`, `text_color`.

Slide block settings, grouped with `header` setting rows (Pictures, Words, Buttons, Layout, Colours):

| id | Type | Notes |
|---|---|---|
| `image`, `mobile_image`, `device` | as today | |
| `eyebrow` | text 60 | "Label" |
| `heading` | text 120 | as today |
| `heading_size` | select small…xxl | default `large` (today's slide heading size) |
| `description` | textarea 300 | label becomes "Subheading" |
| `button_text`, `link` | as today | button 1 |
| `button_style` | select filled \| outline | default filled |
| `button_2_text` (30), `button_2_link`, `button_2_style` | | button 2 |
| `position` | select, 9 spots | full layout; split layouts use only the row (top/middle/bottom) |
| `align`, `align_mobile` | select L/C/R | default left |
| `box` | checkbox | default false |
| `overlay` | range 0–80 | default 0 |
| `text_color` | color | default `''` |
| `color_scheme` | color_scheme | `''` = the slideshow's scheme |

Conversion (`hero-convert.ts`, same function): a `slideshow` section that still has section-level `overlay` or `text_color` copies them into every slide that lacks its own, then deletes them from the section; slides with no `position` get `middle-left`. Idempotent.

Rendering: `StudioHero` (`components/store/studio-theme/StudioSections.tsx`) takes per-slide values through `slideshowSettings` / `StudioSlide` (`lib/store/engine/studio-adapter.ts`, `lib/store/studio-sections.ts`); the copy panel is keyed per slide, so the active slide's position, box, darkening, colours and buttons apply when it shows. A slide `color_scheme` sets the scheme's CSS variables on that slide's copy and image layer only.

## 6. Errors and fallbacks

- The sanitiser drops bad values (unknown position, out-of-range numbers, a third button block, a missing scheme id → `''`); the section uses its defaults.
- A slide `color_scheme` that no longer exists falls back to the slideshow's scheme.
- A hero with no picture shows its words on the section colours, as today.
- No JavaScript: sticky modes degrade to `always`; motion is static.
- `prefers-reduced-motion`: no drift, zoom, header slide or logo shrink animation.

## 7. Testing

- Unit (jest, `tests/lib/store/engine`): every new and changed schema through the sanitiser (defaults, ranges, select values, button limit); `convertLegacyHeroSections` (old banner with each key, empty banner, old slideshow with overlay and text colour, slides that already have their own values, run twice); heading sizes and text style through `content-blocks-map`; `headerLayoutClasses` for all combinations; `stickyHeaderState` for each mode, direction and threshold; the parity test of the premium work still passes (existing presets render unchanged).
- DB (`kh_phase2_test` only): save and reload a theme with an old image banner and an old slideshow; both come back converted.
- Staging (manual): four desktop header layouts and two phone positions; logo sizes; the four sticky modes with and without reduced motion; a hero at each of the nine positions with and without the box, two pictures, phone picture, video, each motion; a slideshow with different settings on each slide; existing stores unchanged.
