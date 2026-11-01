# Store Menus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Named menus inside each theme that the Header and Footer pick, with dropdowns, mega menus, an automatic "All categories" item, an inline header layout, a phone side panel, and a Menus editor in Studio 2.

**Architecture:** Menus are plain data in `ThemeData.settings.menus`, cleaned by the theme sanitiser, which also converts today's header `menu_link` blocks and footer `link_column` blocks once. A pure resolver turns a menu plus the store's categories into render items; React components in `components/store/engine/menu/` draw the desktop bar, panels and phone drawer. The editor gets pure menu ops (undoable through the existing history) and a Menus panel.

**Tech Stack:** Next.js 14 app router, React 18, TypeScript, Tailwind plus plain CSS, `@dnd-kit` (already used by `SectionTree.tsx`), Jest (node environment; `.tsx` is not unit-tested here).

**Spec:** `docs/superpowers/specs/2026-10-31-store-menus-design.md`

## Global Constraints

- Limits: 10 menus, 12 items per level, 3 levels, labels and menu names 40 characters, picture captions 60 characters.
- Starting menu ids: `main` (header) and `footer` (footer). Item and menu ids match `ID_RE` (`/^[a-z0-9_-]{1,32}$/`).
- Top-only item fields: `highlight`, `source` (`'links' | 'categories'`), `category_photos`, `picture`. Dropped below the top level.
- Links use the `url` setting rules (`sanitizeSettingValue({ type: 'url' })`); picture images use the `image` rules.
- Header settings: `menu` (default `main`), `menu_layout` (`below` | `inline`, default `below`), `menu_caps` (default false). Footer: `menu` (default `footer`).
- Phone layout applies at store container width ≤ 640px (`@container store (max-width: 640px)`), as the other phone rules.
- Tests: Jest only on `.ts`; DB tests only against `kh_phase2_test` (`PHASE2_TEST_DATABASE_URL`). Never run migrations elsewhere (no migration in this plan).
- Commits only when the owner has asked for them in the session; stage files by name, never `git add .`. Commit messages are plain sentences of what changed, ending with the Co-Authored-By line.
- Before finishing: append an entry to `docs/project.log.md` and move the roadmap card (`docs/brain.md` rules).

## Review Focus

1. Duplicating an item that has children: every copied descendant needs a new id; duplicated ids would make the tree editor edit two items at once. (Task 6 test.)
2. "Move in" of an item that already has grandchildren must refuse when the result would exceed 3 levels, not silently drop the deepest links. (Task 6 test.)
3. A theme whose `settings.menus` is present but not an array (`null`, an object) must still be converted from the old blocks, not end up with no menus. (Task 2 test.)
4. An "All categories" item in a store with no categories, or when the lookup failed, must still render as a working link to `/catalog`, never an empty dropdown. (Task 3 test.)
5. Labels with emoji or Indian scripts: clipping to 40 must not split a character into a broken symbol. (Task 1 test.)

---

### Task 1: Menu types, limits and sanitiser

**Files:**
- Modify: `lib/store/engine/types.ts` (add `MenuPicture`, `MenuItem`, `Menu`; `ThemeSettings.menus: Menu[]`)
- Modify: `lib/store/engine/shared.ts` (`ENGINE_LIMITS.menus`)
- Create: `lib/store/engine/menus-sanitize.ts`
- Modify: `lib/store/engine/sanitize.ts` (`sanitizeThemeSettings` sets `menus: sanitizeMenus(r.menus)`)
- Test: `tests/lib/store/engine/menus-sanitize.test.ts`

**Interfaces:**
- Produces: types exactly as spec §2; `ENGINE_LIMITS.menus = { menus: 10, itemsPerLevel: 12, depth: 3, label: 40, name: 40, caption: 60 }`; `sanitizeMenus(raw: unknown): Menu[]`.

- [ ] **Step 1: Write the failing tests** in `menus-sanitize.test.ts`:
  - `keeps a valid three-level menu`: input with ids `a` → `b` → `c` round-trips unchanged.
  - `drops a fourth level`: a child under `c` is absent in the output.
  - `drops top-only fields below the top`: `highlight`, `source`, `category_photos`, `picture` on a level-2 item are removed.
  - `clips labels and names by characters`: `'🛍️'.repeat(30)` label → `Array.from(label).length <= 40` and no lone surrogate (`/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/` does not match).
  - `drops items with an empty label, a bad or duplicate id`; `drops menus over 10` and `items over 12 per level`.
  - `cleans links and pictures`: `javascript:alert(1)` link → `''`; picture without a valid image is removed; caption clipped to 60.
  - `source categories drops children`.
  - `non-array input gives []`.
- [ ] **Step 2: Run** `npx jest tests/lib/store/engine/menus-sanitize.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement** the types, the limit and `sanitizeMenus`. Clip with `Array.from(s.trim()).slice(0, n).join('')`. Ids must be unique within a menu (all levels) and across menus for menu ids. An empty menu name becomes `'Menu'`. Wire into `sanitizeThemeSettings`.
- [ ] **Step 4: Run** the test file → PASS; then `npx jest tests/lib/store/engine` → PASS (fix fixtures that build `ThemeSettings` literals by adding `menus: []`).
- [ ] **Step 5: Commit** `lib/store/engine/types.ts lib/store/engine/shared.ts lib/store/engine/menus-sanitize.ts lib/store/engine/sanitize.ts tests/lib/store/engine/menus-sanitize.test.ts` (+ any fixture files touched).

### Task 2: Header and footer settings, `menu` setting type, one-time conversion

**Files:**
- Modify: `lib/store/engine/schema-types.ts` (`SettingType` adds `'menu'`)
- Modify: `lib/store/engine/settings.ts` (`case 'menu'`: string matching `ID_RE`, or `''`)
- Modify: `lib/store/engine/sections/header.ts` (add `menu`, `menu_layout`, `menu_caps` per Global Constraints; remove the `menu_link` block type, `max_blocks` and the preset's blocks)
- Modify: `lib/store/engine/sections/footer.ts` (add `menu`; remove `link_column`; add `data: () => ({ categories: true, categoriesOptional: true })`)
- Modify: `lib/store/engine/menus-sanitize.ts` (`convertLegacyMenus`)
- Modify: `lib/store/engine/sanitize.ts` (`sanitizeThemeData` calls `convertLegacyMenus` on the raw object first)
- Modify: `lib/store/engine/studio-adapter.ts` (delete `headerNavLinks` and `footerColumns`)
- Modify: `components/store/engine/sections/Header.tsx`, `components/store/engine/sections/Footer.tsx` (stop importing the deleted adapters; pass no links for now, so the build stays green until Tasks 4 and 5)
- Test: `tests/lib/store/engine/menus-convert.test.ts`; update `tests/lib/store/engine/studio-adapter.test.ts`, `editor-ops.test.ts`, `migrate.test.ts`, `migrate-packs.test.ts` where they assert `menu_link` / `link_column` blocks.

**Interfaces:**
- Consumes: `sanitizeMenus`, `Menu`, `MenuItem` (Task 1).
- Produces: `convertLegacyMenus(raw: Record<string, unknown>): Record<string, unknown>` (returns a new object; input untouched). After `sanitizeThemeData`, every theme has `settings.menus` and its header/footer sections carry `settings.menu`.

Presets and `migrate-studio.ts` keep producing the old blocks; the conversion turns them into menus (this replaces the spec's "presets build menus directly": same result, one code path).

- [ ] **Step 1: Write the failing tests** in `menus-convert.test.ts`:
  - `header links become the main menu`: header with enabled blocks `Sale /sale highlight` and `All /catalog`, plus a disabled one → `menus[0]` is `{ id: 'main', name: 'Main menu', items: [{label:'Sale', link:'/sale', highlight:true}, {label:'All', link:'/catalog'}] }` (ids `m1`, `m2`); header `settings.menu === 'main'`; header `blocks` empty.
  - `footer columns become the footer menu`: column `Help` with `Contact|/pages/contact\nbad line\nFAQ|/pages/faq` → top item `Help` (link `''`) with two children; footer `settings.menu === 'footer'`.
  - `runs once`: `sanitizeThemeData(sanitizeThemeData(raw))` deep-equals `sanitizeThemeData(raw)`.
  - `converts when menus is null or an object` (Review Focus 3).
  - `leaves a theme with a menus array alone` (old blocks still dropped by the sanitiser, menus kept).
  - `every preset sanitises to main and footer menus`: for each of `studio`, `quick`, `grocery`, `khatario`, `blank`, `sanitizeThemeData(presetTheme(p, ctx)).settings.menus.map(m => m.id)` contains `'main'` and `'footer'`.
- [ ] **Step 2: Run** `npx jest tests/lib/store/engine/menus-convert.test.ts` → FAIL.
- [ ] **Step 3: Implement** the setting type, schema changes and `convertLegacyMenus`. Conversion applies when `!Array.isArray(raw.settings?.menus)`; it reads the raw header/footer sections of type `header`/`footer` in `header_group`/`footer_group`, uses deterministic item ids `m1, m2, …` per menu, and reuses today's `Label|/url` line rule (the url check from `footerColumns`). Always create both `main` and `footer` (empty when there were no blocks).
- [ ] **Step 4: Run** `npx jest tests/lib/store` and `npx tsc --noEmit -p .` → PASS / no errors.
- [ ] **Step 5: Commit** the files above.

### Task 3: Render model (pure)

**Files:**
- Create: `lib/store/engine/menus.ts` (client-safe: imports only `types` and `shared`)
- Test: `tests/lib/store/engine/menus.test.ts`

**Interfaces:**
- Consumes: `Menu`, `MenuItem`, `MenuPicture`.
- Produces:
  - `type MenuItemKind = 'link' | 'dropdown' | 'mega' | 'categories'`; `menuItemKind(item: MenuItem): MenuItemKind`.
  - `interface MenuCategory { id: string; name: string; image_url: string | null }`.
  - `interface ResolvedItem { id: string; label: string; href: string; highlight: boolean; kind: MenuItemKind; children: ResolvedItem[]; picture?: MenuPicture; categoryPhotos: boolean; categories?: MenuCategory[] }`.
  - `pickMenu(menus: Menu[], id: unknown, fallbackId: 'main' | 'footer'): Menu | null` (the chosen menu, else the fallback, else null).
  - `resolveMenu(menu: Menu | null, categories: MenuCategory[] | null): ResolvedItem[]` (`categories` null = lookup failed).
  - `menuFooterColumns(items: ResolvedItem[]): { heading: string; href: string; links: { label: string; href: string }[] }[]` (third-level links listed under their group).
  - `foldMenu(widths: number[], available: number, moreWidth: number): number` (how many items stay in the bar).

- [ ] **Step 1: Write the failing tests:**
  - `menuItemKind`: no children → `link`; children without grandchildren → `dropdown`; any grandchild → `mega`; `source: 'categories'` → `categories`.
  - `resolveMenu hides links to deleted categories`: item `/catalog/gone` with categories `[{id:'veg'}]` → absent; with `categories === null` → kept.
  - `a dropdown whose children are all hidden becomes a link`.
  - `categories item`: with two categories → `kind 'categories'`, `categories.length === 2`, `href '/catalog'` when its link is empty; with `[]` or `null` → `kind 'link'`, `href '/catalog'` (Review Focus 4).
  - `pickMenu` falls back to `main`, then null.
  - `menuFooterColumns` flattens level 3 under the group.
  - `foldMenu([100,100,100], 400, 60) === 3`; `foldMenu([100,100,100], 250, 60) === 1`; `foldMenu([300], 100, 60) === 0`.
- [ ] **Step 2: Run** `npx jest tests/lib/store/engine/menus.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Category links are recognised as `/catalog/<encoded id>` (the format `linkOptions` writes). `foldMenu`: all fit if `sum(widths) <= available`; else the largest `k` with `sum(widths[0..k)) + moreWidth <= available`, min 0.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `lib/store/engine/menus.ts tests/lib/store/engine/menus.test.ts`.

### Task 4: Desktop header menu (both layouts, dropdown and mega panels)

**Files:**
- Create: `components/store/engine/menu/MenuBar.tsx`, `components/store/engine/menu/MenuPanel.tsx`, `components/store/engine/menu/menu.css`
- Modify: `components/store/studio-theme/StudioSections.tsx` (`StudioHeader` gains optional `menuSlot?: ReactNode` rendered instead of its `nav` row, `inlineSlot?: ReactNode` rendered between the logo and search, and `menuButton?: ReactNode` before the logo; existing callers unchanged)
- Modify: `components/store/engine/sections/Header.tsx`, `components/store/engine/EngineViews.tsx` (`EngineHeader` takes `menu: { items: ResolvedItem[]; layout: 'below' | 'inline'; caps: boolean }` instead of `nav`)

**Interfaces:**
- Consumes: `pickMenu`, `resolveMenu`, `foldMenu`, `ResolvedItem` (Task 3); header settings (Task 2); `data.categories` (header's existing optional categories, `item_count > 0` only).
- Produces: `MenuBar({ items, layout, caps, holdOpenId }: { items: ResolvedItem[]; layout: 'below' | 'inline'; caps: boolean; holdOpenId?: string | null })`; `MenuPanel({ item }: { item: ResolvedItem })`. `MenuBar` listens for `window` event `kh-menu-hold` (`CustomEvent<{ itemId: string | null }>`) and holds that item open (Task 8 sends it).

Behaviour (spec §5): disclosure pattern (label is a link when `href` set, separate ▾ `button` with `aria-expanded`/`aria-controls`; label is the button when no link); hover opens after 150ms and closes 300ms after leaving; Esc and outside click close; one open at a time; panel starts with "View all {label}" when the item has a link; inline layout folds overflow into "More ▾" with `foldMenu` measured by `ResizeObserver`; `caps` adds `text-transform: uppercase; letter-spacing: .08em` on top items; panels use `var(--c-card)`, `var(--c-text)`, `var(--c-border)` with a soft shadow; categories panel uses CSS columns and `max-height: 70vh; overflow-y: auto`; all panels are in the server HTML with `hidden` until opened. Desktop bar hidden at `@container store (max-width: 640px)`.

- [ ] **Step 1: Implement** the components and wire `Header.tsx` → `EngineHeader` → `StudioHeader` slots.
- [ ] **Step 2: Run** `npx tsc --noEmit -p .` → no errors; `npx jest tests/lib/store` → PASS.
- [ ] **Step 3: Browser check** (local dev server or staging): a theme with a simple dropdown, a mega menu with a picture and an All categories item; both layouts; Tab/Enter/Esc only; narrow window shows More ▾; CAPITALS; no console errors.
- [ ] **Step 4: Commit** the files above.

### Task 5: Phone side panel, Quick pills, footer menu

**Files:**
- Create: `components/store/engine/menu/MenuDrawer.tsx`
- Modify: `components/store/engine/menu/menu.css`, `components/store/engine/sections/Header.tsx`, `components/store/engine/EngineViews.tsx` (Quick header), `lib/store/engine/quick-header.ts` (`quickChips` links gain optional `itemId` and `hasChildren`; a chip from an item with children carries `menuItemId`), `components/store/engine/sections/Footer.tsx`
- Test: `tests/lib/store/engine/quick-header.test.ts` (extend)

**Interfaces:**
- Consumes: `ResolvedItem`, `resolveMenu`, `pickMenu`, `menuFooterColumns` (Task 3).
- Produces: `MenuDrawer({ items, open, onClose, initialOpenId }: { items: ResolvedItem[]; open: boolean; onClose(): void; initialOpenId?: string | null })`; `quickChips` link input gains `itemId?: string; hasChildren?: boolean`; `QuickChip.menuItemId?: string` (set when `hasChildren`).

Behaviour (spec §5): ☰ button (`aria-label="Menu"`) shown only at ≤ 640px for non-Quick headers; drawer from the left, max width 360px, overlay; closes with ✕, overlay tap, Esc and Back (push a history entry on open, close on `popstate`); body scroll locked while open; focus moves into the drawer and returns to ☰ on close; items with children expand in place; groups as small headings; picture after its item's links; categories item expands into the list (photos when `categoryPhotos`). Quick: pills from top items (highlight → Quick's offers pill); a pill with `menuItemId` shows ▾ and opens `MenuDrawer` with that item expanded. Footer: columns from `menuFooterColumns(resolveMenu(pickMenu(menus, v.menu, 'footer'), data?.categories ?? null))`.

- [ ] **Step 1: Write the failing test** in `quick-header.test.ts`: `quickChips([{ label: 'Shop', href: '/catalog', highlight: false, itemId: 'm1', hasChildren: true }], [])[0].menuItemId === 'm1'`, and a link without children has no `menuItemId`.
- [ ] **Step 2: Run** `npx jest tests/lib/store/engine/quick-header.test.ts` → FAIL.
- [ ] **Step 3: Implement** `quickChips` change, `MenuDrawer`, the ☰ wiring, Quick pills and the footer.
- [ ] **Step 4: Run** `npx jest tests/lib/store` → PASS; `npx tsc --noEmit -p .` → no errors.
- [ ] **Step 5: Browser check** at 390px: ☰ opens/closes four ways, scroll locked, focus returns; Quick pill with ▾ opens the drawer at its item; footer columns render; desktop unchanged.
- [ ] **Step 6: Commit** the files above.

### Task 6: Editor menu operations (pure)

**Files:**
- Create: `lib/store/engine/editor/menu-ops.ts`
- Modify: `lib/store/engine/editor/ops.ts` (`OpError` adds `'menu_limit' | 'menu_item_limit' | 'menu_depth' | 'menu_in_use'`, with `OP_ERROR_TEXT`: "A theme can have up to 10 menus", "A menu level can have up to 12 items", "Menus go three levels deep", "Used by the Header or Footer. Pick another menu there first.")
- Modify: `lib/store/engine/editor/shell.ts` (`Selection` adds `{ kind: 'menus' }` and `{ kind: 'menu'; menuId: string; itemId: string | null }`; `selectionRef` returns null for both; `pruneSelection` turns a missing menu into `{ kind: 'menus' }` and a missing item into `itemId: null`)
- Test: `tests/lib/store/engine/menu-ops.test.ts`; prune cases in `tests/lib/store/engine/editor-shell.test.ts`.

**Interfaces:**
- Consumes: `Menu`, `MenuItem`, `ENGINE_LIMITS.menus`, `OpResult`, `newId`.
- Produces (all `(theme: ThemeData, …) => OpResult`, `id` set when something is created):
  `addMenu(theme, name, makeId?)`, `renameMenu(theme, menuId, name)`, `removeMenu(theme, menuId)`,
  `addMenuItem(theme, menuId, parentId: string | null, makeId?)` (label `'New link'`, link `''`, appended),
  `updateMenuItem(theme, menuId, itemId, patch: Partial<Omit<MenuItem, 'id' | 'children'>>)`,
  `moveMenuItem(theme, menuId, itemId, dir: 'up' | 'down' | 'in' | 'out')`,
  `reorderMenuItem(theme, menuId, itemId, toIndex: number)` (within its level, for drag),
  `duplicateMenuItem(theme, menuId, itemId, makeId?)`, `removeMenuItem(theme, menuId, itemId)`;
  and `menuInUse(theme: ThemeData, menuId: string): boolean`.

Rules: `in` = last child of the previous sibling; `out` = next sibling after its parent; both strip top-only fields when the item leaves the top level; a parent with `source: 'categories'` takes no children (`not_allowed_here`). A header/footer section without a `menu` setting uses `main`/`footer`, which therefore count as in use.

- [ ] **Step 1: Write the failing tests:**
  - `addMenu` gives a new id and fails `menu_limit` at 10.
  - `removeMenu('main')` → `menu_in_use`; a menu nobody uses is removed.
  - `addMenuItem` at a full level → `menu_item_limit`; under a level-3 item → `menu_depth`.
  - `moveMenuItem in` of an item with grandchildren under a level-1 sibling → `menu_depth`, theme unchanged (Review Focus 2).
  - `moveMenuItem in` of a top item with `highlight` and `picture` → the moved item has neither; moving it back `out` does not bring them back.
  - `duplicateMenuItem` of an item with two levels of children → every id in the copy is new and unique across the menu (Review Focus 1).
  - `reorderMenuItem` moves within the level only.
  - Purity: inputs deep-frozen (as `editor-ops-purity.test.ts` does) do not throw.
  - `pruneSelection` cases above.
- [ ] **Step 2: Run** `npx jest tests/lib/store/engine/menu-ops.test.ts` → FAIL.
- [ ] **Step 3: Implement** in `menu-ops.ts` (immutable updates; one tree helper `mapTree` reused by every op).
- [ ] **Step 4: Run** `npx jest tests/lib/store/engine` → PASS.
- [ ] **Step 5: Commit** the files above.

### Task 7: Menus editor UI

**Files:**
- Create: `components/store/studio2/menus/MenusPanel.tsx` (list: name, item count, Add, Rename, Delete with the in-use message), `components/store/studio2/menus/MenuEditor.tsx` (indented tree, `@dnd-kit` sortable per level, ▸ fold, ⋮ actions, Add item per level), `components/store/studio2/menus/MenuItemForm.tsx` (Label, Link via `LinkPicker`; top items: Highlight, Shows Links / All categories, Show category photos, Picture image/caption/link via `StoreImageField`; "This category no longer exists" for a `/catalog/<id>` link not in the editor's categories)
- Modify: `components/store/studio2/SectionTree.tsx` (a **Menus** row under Theme settings selecting `{ kind: 'menus' }`), `components/store/studio2/SettingsPanel.tsx` (route the two new selection kinds), `components/store/studio2/fields/SettingField.tsx` (`case 'menu'`: select of `theme.settings.menus` by name plus an "Edit menus" button selecting `{ kind: 'menus' }`, via `useStudio2()`)

**Interfaces:**
- Consumes: every op in Task 6 through `apply(fn, { mergeKey, immediate })` (text edits use a `mergeKey` such as `menu:${menuId}:${itemId}:label`, structural ops `mergeKey: null, immediate: true`); `OP_ERROR_TEXT` for refusals; `Selection` kinds from Task 6.
- Produces: nothing used by other tasks.

- [ ] **Step 1: Implement** the three components and the three modifications. Disable actions the ops would refuse (depth, per-level limit, first item has no "Move in", top item has no "Move out").
- [ ] **Step 2: Run** `npx tsc --noEmit -p .` → no errors; `npx jest tests/lib/store` → PASS.
- [ ] **Step 3: Browser check** in Studio: add a menu, build three levels with Move in/out and drag, rename, try deleting `main` (message shown), Header picks a menu, undo/redo each action, reload keeps the draft.
- [ ] **Step 4: Commit** the files above.

### Task 8: Preview holds the selected dropdown open; DB round trip; docs

**Files:**
- Modify: `lib/store/engine/editor/bridge.ts` (editor → preview message `{ source: 'kh-studio'; type: 'menu-hold'; itemId: string | null }`), `components/store/engine/EditorBridge.tsx` (on that message dispatch `window` `CustomEvent('kh-menu-hold', { detail: { itemId } })`), `components/store/studio2/Studio2Editor.tsx` (post it when the selection is `{ kind: 'menu' }` with a top-level `itemId`, else `null`)
- Test: `tests/db/store-themes.db.test.ts` (extend)
- Modify: `docs/project.log.md`, `docs/roadmap.md`

**Interfaces:**
- Consumes: `kh-menu-hold` listener in `MenuBar` (Task 4); `Selection` (Task 6).

- [ ] **Step 1: Write the DB test**: save a theme whose data has two menus (three levels, picture, categories item) through the themes repo, reload it: menus deep-equal; save an old-shape theme with header `menu_link` blocks and no `menus`: reload has `main` with those links and header `settings.menu === 'main'`.
- [ ] **Step 2: Run** `npx jest tests/db/store-themes.db.test.ts` with `PHASE2_TEST_DATABASE_URL` pointing at `kh_phase2_test` → PASS (Tasks 1–2 implement this; a failure is a bug to fix there).
- [ ] **Step 3: Implement** the bridge message and wiring; browser check: selecting a top item in the Menus editor shows its dropdown open in the preview; selecting something else closes it.
- [ ] **Step 4: Run** `npx jest tests/lib/store` and `npx tsc --noEmit -p .` → PASS / no errors.
- [ ] **Step 5: Docs:** project log entry (what shipped, commits, open items: staging check list from spec §7); roadmap card → "menus built, staging check; next: cart page spec".
- [ ] **Step 6: Commit** the files above.
