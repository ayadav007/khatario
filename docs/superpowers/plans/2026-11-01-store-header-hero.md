# Store Header and Hero Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shopify-level header (logo position and size, sticky choices) and hero (Hero banner with blocks, pictures, darkening, 9-spot text, box, motion) plus per-slide controls on the slideshow, with existing stores unchanged.

**Architecture:** New settings on the `header`, `image-banner` and `slideshow` schemas; one pure conversion (`hero-convert.ts`) wired beside the existing menus and content-block conversions; pure layout helpers (`header-layout.ts`, `hero-layout.ts`) tested in Jest; React renderers changed to read them. The hero reuses `CONTENT_BLOCKS`, which gain five heading sizes and a text style.

**Tech Stack:** Next.js 14 app router, React 18, TypeScript, plain CSS, Jest (node; `.tsx` not unit-tested).

**Spec:** `docs/superpowers/specs/2026-11-01-store-header-hero-design.md`

## Global Constraints

- Existing stores look the same until the owner changes a setting: header defaults `logo_position: 'left'`, `logo_position_mobile: 'left'`, `logo_width: 0`, `logo_width_mobile: 0`, `sticky: 'always'`, `separator: true`; hero `overlay` default 40, `position` default `middle-left`, `align` default `left`, `height` default `medium`; slide `heading_size` default `large`, `overlay` default 0.
- Header values: `logo_position` / `logo_position_mobile` `left|center`; `logo_width` range 0–300 step 10; `logo_width_mobile` 0–200 step 10; `sticky` `none|scroll_up|always|always_shrink`.
- Hero values: `height` `adapt|small|medium|large`; `overlay` 0–80 step 5; `motion` `none|drift|zoom_scroll|fixed`; `position` the nine `top-left, top-center, top-right, middle-left, middle-center, middle-right, bottom-left, bottom-center, bottom-right`; `align`/`align_mobile` `left|center|right`; `two_images_mobile` `stack|first`; at most 2 `button` blocks and 8 blocks; listed as "Hero banner".
- Heading sizes `small|medium|large|xl|xxl`; text style `body|subtitle|caps` (default `body`).
- Phone rules at `@container store (max-width: 640px)`; everything respects `prefers-reduced-motion`.
- Jest for `.ts` only; DB tests only on `kh_phase2_test` (`PHASE2_TEST_DATABASE_URL`, built from `.env` `DB_*`, never printed); no migration.
- Local commit per task on main (owner-approved pattern), staged by name, plain-sentence messages ending with the Co-Authored-By line; never push.

## Review Focus

1. A converted old Image banner renders the same words, button, darkening (40%) and middle-left position as before. (Task 4 test.)
2. A converted old slideshow keeps its darkening and text colour on every slide, and a slide that already had its own value is not overwritten. (Task 4 test.)
3. "Comes back when scrolling up" must always show the header near the top of the page (scrollY below the header height), never hide it there. (Task 2 test.)
4. Logo width 0 must keep today's logo exactly (40px tall desktop, 32px phones), not size it to 0. (Task 3 check, Task 2 class test.)
5. A slide colour scheme id that no longer exists falls back to the slideshow's scheme instead of unstyled text. (Task 6 test.)

---

### Task 1: Heading sizes and text style in the shared content blocks

**Files:** Modify `lib/store/engine/content-blocks.ts`, `lib/store/engine/content-blocks-map.ts`, `components/store/engine/sections/ContentBlocks.tsx`, `components/store/engine/content-block-rules.ts`. Test: extend `tests/lib/store/engine/content-blocks.test.ts` and `tests/lib/store/engine/content-blocks-map.test.ts`.

**Interfaces:** Produces `ContentBlock` heading `size: 'small'|'medium'|'large'|'xl'|'xxl'` and text `style: 'body'|'subtitle'|'caps'`; CSS classes `eng-cb-size-xl`, `eng-cb-size-xxl`, `eng-cb-text-subtitle`, `eng-cb-text-caps`.

- [ ] **Step 1: Failing tests:** `heading size xl and xxl survive sanitising` (blockSettings / sanitizer keeps them, rejects `huge` → default `medium`); `text style defaults to body and keeps subtitle/caps`; the map returns both fields.
- [ ] **Step 2:** Run `npx jest tests/lib/store/engine/content-blocks.test.ts` → FAIL.
- [ ] **Step 3:** Add the options and the `style` setting; map and render them; CSS sizes continue the existing clamp scale (xl ≈ clamp(34px,6cqi,56px), xxl ≈ clamp(40px,7.5cqi,72px)), subtitle 1.15em with 0.8 opacity, caps uppercase with .08em letter spacing.
- [ ] **Step 4:** `npx jest tests/lib/store` and `npx tsc --noEmit -p .` → pass (the premium parity test must still pass).
- [ ] **Step 5:** Commit.

### Task 2: Header settings and pure header helpers

**Files:** Modify `lib/store/engine/sections/header.ts`. Create `lib/store/engine/header-layout.ts`. Test `tests/lib/store/engine/header-layout.test.ts`.

**Interfaces:** Produces
- `type StickyMode = 'none'|'scroll_up'|'always'|'always_shrink'`;
- `headerLayoutClasses(o: { logoPosition: 'left'|'center'; logoPositionMobile: 'left'|'center'; menuLayout: 'below'|'inline'; separator: boolean }): string` returning space-joined classes from `hdr-logo-center`, `hdr-mlogo-center`, `hdr-inline`, `hdr-noline` (only the non-default ones);
- `logoWidthStyle(desktop: number, mobile: number): Record<string, string>` returning `--logo-w` / `--logo-w-m` only for non-zero values;
- `stickyHeaderState(mode: StickyMode, y: number, lastY: number, headerH: number, prev: { hidden: boolean; shrunk: boolean }): { hidden: boolean; shrunk: boolean }`.

- [ ] **Step 1: Failing tests:** schema defaults per Global Constraints; `headerLayoutClasses` for all 4 desktop × 2 phone combinations and separator; `logoWidthStyle(0, 0)` is `{}` (Review Focus 4); `stickyHeaderState`: `always` never hides; `none` never hides (the CSS removes stickiness); `scroll_up` hides when scrolling down past `headerH`, shows on any upward scroll, and always shows when `y < headerH` (Review Focus 3); a movement under 4px keeps `prev`; `always_shrink` sets `shrunk` when `y > 24` and clears it at `y <= 24`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Add the six settings (Global Constraints) to the header schema in a "Layout" group (`type: 'header'` row) after `menu_caps`; implement the helpers.
- [ ] **Step 4:** `npx jest tests/lib/store` and `tsc` → pass.
- [ ] **Step 5:** Commit.

### Task 3: Header rendering: layouts, logo size, phone position, separator, sticky

**Files:** Modify `components/store/engine/sections/Header.tsx`, `components/store/engine/EngineViews.tsx` (`EngineHeader`, `EngineQuickHeader` logo width), `components/store/studio-theme/StudioSections.tsx` (`StudioHeader` accepts `layoutClass?: string` and `logoStyle?: CSSProperties` and places search/logo/icons/menu per class), `components/store/engine/EngineShell.tsx` (sticky), `components/store/engine/RenderTemplate.tsx` (passes `headerSticky: StickyMode` from the header section to `EngineShell`), CSS beside the header rules (`components/store/studio-theme/studio-theme.css` or `components/store/engine/menu/menu.css`).

**Interfaces:** Consumes Task 2 helpers. `EngineShell` gains prop `headerSticky?: StickyMode` (default `'always'`).

Behaviour (spec §2): centre + below = logo centred in the top row (search left, icons right), menu row centred; centre + inline = menu left, logo centre, search and icons right (More fold unchanged); phones `center` = ☰ left, logo centred, account/cart right, search below; `--logo-w`/`--logo-w-m` set `width` with height auto, absent = today's rules; `hdr-noline` removes the line; sticky: `none` → wrapper `position: static`; `scroll_up` → a client hook in EngineShell feeds `stickyHeaderState` from a passive scroll listener with `requestAnimationFrame` and toggles `st-sticky--hidden` (translateY(-100%), transition .25s, none under reduced motion); `always_shrink` toggles `st-sticky--shrunk` (logo `scale(.7)`, origin left or centre by position). Quick header: width variables only.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** `npx tsc --noEmit -p .` and `npx jest tests/lib/store` → pass.
- [ ] **Step 3:** Commit. (Browser check on staging per owner rule.)

### Task 4: Hero and slideshow schemas plus one-time conversion

**Files:** Modify `lib/store/engine/sections/image-banner.ts`, `lib/store/engine/sections/slideshow.ts`. Create `lib/store/engine/hero-convert.ts`. Modify `lib/store/engine/sanitize.ts`, `lib/store/engine/presets/index.ts`, `lib/store/engine/migrate.ts` (call `convertLegacyHeroSections` wherever `convertLegacyTextSections` / `convertLegacyMenus` run on raw data). Test `tests/lib/store/engine/hero-convert.test.ts`; update tests asserting the old banner/slideshow keys.

**Interfaces:** Produces `convertLegacyHeroSections(raw: Record<string, unknown>): Record<string, unknown>` (pure, returns a new object). Hero schema: settings per spec §3 table, `name: 'Hero banner'`, `blocks` = `CONTENT_BLOCKS` filtered to `eyebrow`, `heading`, `text`, `button` with the button block given `limit: 2`, `max_blocks: 8`, preset blocks heading "New arrivals" / text "Fresh picks for the season" / button "Shop now" → `/catalog`. Slideshow schema: section keeps `autoplay`, `speed`, `height`, `image_fit`, `layout`, adds `text_below_mobile` (false), drops `overlay`, `text_color`; slide block per spec §5 table with `type: 'header'` group rows Pictures / Words / Buttons / Layout / Colours.

- [ ] **Step 1: Failing tests** (`hero-convert.test.ts`):
  - `converts an old banner`: `{ heading:'Sale', description:'Up to 50%', button_text:'Shop', link:'/catalog', text_position:'center' }` → blocks `heading-1 {text:'Sale'}`, `text-1 {content:'<p>Up to 50%</p>'}`, `button-1 {label:'Shop', link:'/catalog'}` in that order; `position:'middle-center'`, `align:'center'`; old keys gone; no `overlay` key written (schema default 40 applies) (Review Focus 1).
  - `an empty old banner gets no blocks but its position`; `a banner with blocks is left alone`.
  - `copies slideshow overlay and text colour into every slide`: section `{overlay:30, text_color:'#fff'}` with slides A (no values) and B (`overlay: 0`) → A gets 30 and `#fff`, B keeps 0 and gets `#fff`; section loses both keys; slides without `position` get `middle-left` (Review Focus 2).
  - `runs once`: `sanitizeThemeData(sanitizeThemeData(raw))` deep-equals `sanitizeThemeData(raw)`.
  - `a third button block is dropped by the sanitiser`.
  - every preset still sanitises unchanged (`presetTheme(p)` equals `sanitizeThemeData(presetTheme(p))`).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the schemas and the conversion (description text escaped into one `<p>`; block ids by the `presets/shared.ts section()` rule like `text-sections-convert.ts`).
- [ ] **Step 4:** `npx jest tests/lib/store` and `tsc` → pass. Keep `ImageBanner.tsx` and `Slideshow.tsx` compiling (they are rewritten in Tasks 5–6).
- [ ] **Step 5:** Commit.

### Task 5: Hero banner rendering

**Files:** Create `lib/store/engine/hero-layout.ts` (pure) and test `tests/lib/store/engine/hero-layout.test.ts`. Rewrite `components/store/engine/sections/ImageBanner.tsx`; CSS in `components/store/engine/content-block-rules.ts` or a new `components/store/engine/hero.css` imported by `ImageBanner.tsx`.

**Interfaces:** Produces `heroGridClass(position: string, align: string): string` (`hb-pos-<row>-<col> hb-align-<a>`, unknown → `middle-left`/`left`) and `heroImageLayers(o: { image: string; image2: string; mobileImage: string }): Array<{ url: string; video: boolean; slot: 'main'|'second'|'phone' }>`. Consumes `contentBlocksOf`, `ContentBlocks`, `isVideoUrl` (`lib/store/theme-media-url.ts`), the slideshow's video and phone-swap markup and natural sizing (`heroSizer` CSS) for `height: adapt`.

Behaviour per spec §3 (pictures and video, phone picture via the phone container query, darkening layer / brightness on video, 3×3 placement, box on `--c-card`/`--c-text`, white text over a picture unless `text_color` or box, no picture → section colours, two pictures 50/50, phones `stack|first`, `text_below_mobile`, `align_mobile`, motion `drift|zoom_scroll|fixed` off under reduced motion and `fixed` falling back to scroll on iOS).

- [ ] **Step 1: Failing tests** for both helpers (each of the 9 positions; unknown values; layers for picture + video + phone).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement helpers and the renderer.
- [ ] **Step 4:** `npx jest tests/lib/store` and `tsc` → pass.
- [ ] **Step 5:** Commit.

### Task 6: Slideshow per-slide rendering

**Files:** Modify `lib/store/studio-sections.ts` (`StudioSlide` gains `eyebrow?`, `headingSize?`, `button2Text?`, `button2Link?`, `buttonStyle?`, `button2Style?`, `position?`, `align?`, `alignMobile?`, `box?`, `overlay?`, `textColor?`, `schemeStyle?: Record<string,string>`), `lib/store/engine/studio-adapter.ts` (`toSlide`, `slideshowSettings`), `components/store/engine/sections/Slideshow.tsx` (computes each slide's `schemeStyle` from `theme.settings.color_schemes` via `schemeCssVars`; a missing id → none, Review Focus 5), `components/store/studio-theme/StudioSections.tsx` (`StudioHero`: the active slide's position via `heroGridClass`, box, overlay, text colour, scheme variables on that slide's copy and image layer, label, heading size class, subheading, two buttons with filled/outline), CSS. Test: extend `tests/lib/store/engine/studio-adapter.test.ts`.

- [ ] **Step 1: Failing tests:** `slideshowSettings` maps every new slide field with defaults (`headingSize 'large'`, `overlay 0`, `position 'middle-left'`); a slide `color_scheme` id is passed through as given (the section component resolves it); old fields keep working.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; the old non-engine store's `StudioHero` callers keep working with the old fields only.
- [ ] **Step 4:** `npx jest tests/lib/store` and `tsc` → pass.
- [ ] **Step 5:** Commit.

### Task 7: DB round trip

**Files:** Test `tests/db/store-themes.db.test.ts` (extend).

- [ ] **Step 1:** Add: save an old-shape theme (image-banner with heading/description/button_text/link/text_position; slideshow with section overlay and text_color) through the themes repo, reload via `getTheme`: the banner has the three blocks and `position`, the slides carry the overlay and text colour, the section keys are gone.
- [ ] **Step 2:** Run with `PHASE2_TEST_DATABASE_URL` on `kh_phase2_test` → PASS (Tasks 1–6 implement it; a failure is a bug to fix there).
- [ ] **Step 3:** `npx jest tests/lib/store` and `tsc` → pass; commit.
