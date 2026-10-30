# Store theme engine M2 (Studio 2 editor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A merchant opens Studio 2 from Online store settings, edits the home page of a working draft theme in a Shopify-style three-pane editor (section tree with drag and drop, generated settings forms, live preview with click-to-select, undo/redo, autosave) and publishes it to their storefront.

**Architecture:** The editor holds the theme in client state and changes it only through pure, tested operations (`lib/store/engine/editor/ops.ts`) recorded in an undo history. A save queue PUTs the whole theme to the M1 API (which sanitises it), and after each save the editor tells the preview iframe to re-render from the server. The iframe is the real storefront (`?preview_theme&pt&editor=1`) with an editor bridge that outlines sections, turns clicks into selections and reports "add here" positions over `postMessage`, with origins checked on both sides.

**Tech Stack:** Next.js 14 app router, React 18, TypeScript, `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` (new dependencies), Jest + ts-jest (node env, `.ts` tests only), Playwright (`e2e/`, logged-in storage state from `e2e/auth.setup.ts`).

**Spec:** `docs/superpowers/specs/2026-10-29-store-theme-engine-studio2-design.md` (M2 = §8 item 2; editor §4; rendering errors §5). M1 plan and engine interfaces: `docs/superpowers/plans/2026-10-30-store-engine-m1-core.md`.

## Decisions beyond the spec

These were decided while planning. Each one is a deviation the reviewer should hold the code to, not re-open.

- **D1 Preview refresh from the server.** The spec's `theme:update` message (whole theme, 150 ms) is replaced. After each successful save the editor sends `{type:'refresh', rev}` and the iframe calls `router.refresh()`, keeping its scroll position. Why: M1 sections are server components, and `sanitizeThemeData` must stay the only trust boundary. A client-side copy of the renderer would need a second, unsanitised render path. Structural edits (add, remove, move, hide, duplicate) save immediately; setting edits save after the 1 s autosave debounce. Cost: a text edit appears in the preview about 1–2 s later.
- **D2 Click-to-select is section-level.** Clicking in the preview selects a section. Blocks are selected from the tree, because M1 blocks render inside Studio components that have no block anchors. Block anchors come in M3 along with native section markup.
- **D3 Working draft.** "Customise" opens a working draft. It is marked by a new column, `store_themes.is_working` (migration 453, first numbered 451), with at most one per business. Publishing the working draft copies its data onto the live theme and the draft stays the working draft (final-review ruling R11); publishing any other draft swaps roles.
- **D4 Home only.** The page switcher lists Home in M2. Product, Catalog and custom pages, including the spec's "Custom pages" subsection, arrive with their templates in M3.
- **D5 Rich text** uses the existing `components/email/SimpleRichTextEditor.tsx`. The server sanitiser still decides which tags survive.
- **D6 Entry point.** Online store settings gets an "Edit store design (beta)" button, shown only when `business_settings.store_engine` is true. The theme library page is M5.
- **D7 Versions.** The version list and restore APIs belong to M5. Publishing already writes version rows (M1).
- **D8 Failed section in editor mode.** It shows a red card saying "This section failed to load" with the section's name, but never the raw error text (keeps M1 ruling R12).
- **D9 Section labels.** `Section` gains an optional `label` (the tree's "rename label"), 1–40 chars, trimmed, sanitised on save.
- **D10 Previews work before launch (M1 review I2).** A request carrying `preview_theme` and `pt` resolves the store with `allowOffline: true` and keeps it only if `verifyThemePreview(pt, store.business_id)` names that theme. This applies to `currentStore()`, the page, `StoreProvider`'s client fetch and the public store API the engine page calls. Otherwise the editor shows nothing for an unlaunched store.
- **D11 No old theme on engine pages (M1 review I1).** `StoreThemeEffects` skips the old `store_theme` custom CSS, body font and favicon when the engine renders the page. `EngineShell` applies the engine's `favicon_url`.
- **D12 Ids unique across groups (M1 review M9).** `sanitizeThemeData` drops a section whose id already appears in an earlier group (header, then templates, then footer). Editor ops generate ids unique across the whole theme. The hard-coded DOM ids `catalog` and `st-categories` become per-section anchors (`catalog-<id>`, `categories-<id>`), and "View All" links target the first all-products grid's anchor.
- **D13 Settings that do nothing are hidden (M1 review M10).** COMMON `full_width`, theme `card_style` and footer `show_payment_icons` are not wired in the renderer yet. The editor hides them through `EDITOR_HIDDEN_SETTINGS` in `theme-settings-schema.ts` until M3 wires them; `favicon_url` is wired by D11.

## Global Constraints

- Everything in M1's Global Constraints still applies: `kh_phase2_test` only; business, user and author always from the session; `advanced_online_store` gate plus `settings` permission; limits of 25 sections per template, 50 blocks per section, 512 KB and 20 themes; ids match `/^[a-z0-9_-]{1,32}$/`; stage files by name; one commit per task on `main` (the user's choice for this project).
- Editor route: `app/(app)/settings/online-store/themes/[id]/editor/page.tsx`. Below 1024 px viewport width it shows only "Open the editor on a laptop or desktop".
- Undo/redo: whole-theme snapshots, max 100 entries; edits to the same field within 1000 ms merge into one entry. Shortcuts: Ctrl/Cmd+Z undo; Ctrl/Cmd+Shift+Z and Ctrl+Y redo. They are ignored while focus is in a text input, textarea or contenteditable, where the browser's own undo applies.
- Autosave: 1000 ms debounce, `PUT /api/settings/online-store/themes/[id]` with `{ data, updated_at }`. A 409 with code `conflict` shows "This theme changed in another tab. Reload?". On a network failure, unsaved edits are kept in `localStorage` under `kh-theme-unsaved:<themeId>`, with a retry every 5000 ms.
- `postMessage` envelope: `{ source: 'kh-studio', type, ... }`. Each side accepts a message only from the expected origin and the expected window (`event.source`), and ignores everything else.
- Device toggle: phone frame 390 px wide; desktop fills the pane.
- **Client bundle:** editor code (`lib/store/engine/editor/*`, `components/store/studio2/*`) may import only `lib/store/engine/{types,schema-types,registry,shared}.ts`, `lib/store/engine/sections/*` and `lib/store/engine/theme-settings-schema.ts`. Never `settings.ts`, `sanitize.ts`, `html.ts`, `color-schemes.ts`, `themes-repo.ts` or `@/lib/db`; these pull in `sanitize-html` or `pg`.
- Migration number `453` (renumbered from 451 in the final review; `451_whatsapp_message_id_per_business.sql` took 451). It runs on `kh_phase2_test` only.
- Do not edit project C's files (`components/store/features/**`, `components/store/product/*`, reviews, filters, abandoned cart) or the old Studio (`components/store/admin/theme-studio/*`, `app/(app)/settings/online-store/studio/*`).

## Review Focus

1. **Two tabs edit the same theme.** The second tab's next save gets 409 `conflict`. It stops saving, shows the reload banner and keeps its edits in `localStorage`; nothing is overwritten. Test: Task 6 `stops on conflict and keeps the backup`.
2. **The network drops mid-edit.** Edits are kept and retried every 5 s, and the status shows "Offline, retrying". A reload of the editor offers the unsaved copy. Test: Task 6 `keeps a backup and retries after a network failure` and `readBackup marks a backup stale when the server moved on`.
3. **A page that frames the store with a leaked share link, or another window, sends or listens for bridge messages.** Both sides ignore any message whose origin or `event.source` is not the expected one, and malformed messages (bad ids, unknown types, out-of-range index) are dropped. Test: Task 5 `rejects wrong source, type, ids and index` and `appOriginsForStoreHost` cases.
4. **The merchant hits a limit** (26th section, a type's own `limit`, the 51st block, a block type's `limit`, a section type not allowed in this group). The operation returns a reason and the theme is unchanged; the UI disables the control with that reason as its tooltip. Test: Task 3 limit tests.
5. **The merchant publishes, then keeps editing.** The editor moves to a new working draft and never PUTs to the live theme; a save that still reaches the live theme gets 409 `live_locked` and is treated as "reload". Test: Task 1 `publish clears the working flag and a new working draft copies the new live` and Task 11 e2e `publish then edit again`.

## File Structure

```
database/migrations/453_store_theme_working_draft.sql   is_working + one-per-business index
lib/store/engine/
  shared.ts                 client-safe: ENGINE_LIMITS, ID_RE, newId(), defaultSettings() (moved; old modules re-export)
  preset-context.ts         presetContextFor(businessId) (moved out of the themes POST route)
  themes-repo.ts            + getOrCreateWorkingDraft(); publish clears is_working; Section.label sanitised
  theme-settings-schema.ts  THEME_SETTINGS_SCHEMA (SettingSchema[] for ThemeSettings minus colour schemes)
  editor/ops.ts             pure theme operations + canAddSection/canAddBlock
  editor/history.ts         undo/redo history
  editor/bridge.ts          message types, parsers, origin helpers
  editor/save-queue.ts      SaveQueue, backupKey, readBackup
app/api/settings/online-store/themes/working-draft/route.ts   POST → working draft (creates live from Studio preset if none)
app/store/page.tsx                                  passes editor mode
components/store/engine/
  RenderTemplate.tsx        + data-section-group, editor flag
  SectionFrame.tsx          + group attr, editor error card
  EditorBridge.tsx          client: outlines, click/hover → messages, add-at buttons, refresh
components/store/studio2/
  Studio2Editor.tsx         state owner: theme, history, selection, save queue, bridge
  TopBar.tsx                page switcher, undo/redo, device, save status, preview link, publish
  PreviewPane.tsx           iframe + device frame + message wiring
  SectionTree.tsx           groups, sections, blocks, dnd, eye, ⋮ menu
  AddSectionModal.tsx       categories, presets, limits
  SettingsPanel.tsx         selected section/block/theme settings + Advanced
  fields/SettingField.tsx   one control per SettingType
  fields/pickers.tsx        product, category, link pickers
app/(app)/settings/online-store/themes/[id]/editor/page.tsx
app/(app)/settings/online-store/page.tsx            + "Edit store design (beta)" button
e2e/store-studio2.spec.ts
```

---

### Task 1: Working draft (migration 453, repo, API)

**Files:**
- Create: `database/migrations/453_store_theme_working_draft.sql`, `lib/store/engine/preset-context.ts`, `app/api/settings/online-store/themes/working-draft/route.ts`
- Modify: `lib/store/engine/themes-repo.ts`, `lib/store/engine/route-utils.ts`, `app/api/settings/online-store/themes/route.ts` (use `presetContextFor`)
- Test: `tests/db/store-themes.db.test.ts`, `tests/db/store-themes-api.db.test.ts`

**Interfaces:**
- Consumes: M1 `createTheme`, `publishTheme`, `getLiveTheme`, `RepoResult`, `repoJson`, `repoFailure`.
- Produces:
  - `presetContextFor(businessId: string): Promise<PresetContext>`.
  - `getOrCreateWorkingDraft(businessId: string, userId: string): Promise<RepoResult<ThemeRow>>`. It returns the existing `is_working` draft. Otherwise it duplicates the live theme into a draft named `"<live name> (editing)"`, clipped to 60 chars, with `is_working = true`. If no live theme exists, it first creates a live theme from the `studio` preset with `presetContextFor`. Fails with `limit` at 20 themes.
  - `ThemeRow` and `listThemes` rows gain `is_working: boolean`.
  - `repoFailure` JSON becomes `{ error, code }`, where `code` is the failure key (`conflict`, `live_locked`, `limit`, `too_large`, `not_found`).
  - `POST /api/settings/online-store/themes/working-draft` → `{ theme: ThemeRow }`, with the same auth and gate as `POST /themes`.

- [ ] **Step 1: Write the migration**
  `ALTER TABLE store_themes ADD COLUMN IF NOT EXISTS is_working boolean NOT NULL DEFAULT false;` plus `CREATE UNIQUE INDEX IF NOT EXISTS store_themes_one_working ON store_themes (business_id) WHERE is_working;`. Apply it with `node .superpowers/sdd/<workspace>/with-test-db.js psql -f database/migrations/453_store_theme_working_draft.sql` (or `psql` with `PG*` from `.env` against `kh_phase2_test`).
- [ ] **Step 2: Write the failing DB tests** in `tests/db/store-themes.db.test.ts`:
  - `working draft is created once and reused`: two calls return the same id, with `is_working` true and role `draft`.
  - `working draft copies the live data`: the draft's `data` deep-equals the live theme's `data`.
  - `working draft creates a live Studio theme when there is none`: afterwards there is one live theme with preset `studio` and one working draft.
  - `publish clears the working flag and a new working draft copies the new live`: publish the working draft, then the published theme is live with `is_working` false; the next `getOrCreateWorkingDraft` returns a new id whose data equals the new live data.
  - `working draft fails with limit at 20 themes`.
- [ ] **Step 3: Run them and confirm they fail** (`getOrCreateWorkingDraft is not a function`).
- [ ] **Step 4: Implement.** Run the create and duplicate inside the same advisory lock `createTheme` uses, so two tabs can't create two drafts. If the insert hits a unique violation on `store_themes_one_working`, re-read and return the existing working draft. In `publishTheme`, set `is_working = false` on the target in the same transaction.
- [ ] **Step 5: API test** in `tests/db/store-themes-api.db.test.ts`: `POST working-draft returns the same draft twice` and `PUT to the live theme returns 409 with code live_locked`.
- [ ] **Step 6: Run** `tests/db/store-themes.db.test.ts tests/db/store-themes-api.db.test.ts` against `kh_phase2_test`: all pass. Then commit.

### Task 2: Client-safe shared module, section labels, theme settings schema

**Files:**
- Create: `lib/store/engine/shared.ts`, `lib/store/engine/theme-settings-schema.ts`
- Modify: `lib/store/engine/types.ts` (`Section.label?: string`), `lib/store/engine/sanitize.ts`, `lib/store/engine/settings.ts` (re-export from `shared.ts`)
- Test: `tests/lib/store/engine/sanitize.test.ts`, `tests/lib/store/engine/shared.test.ts`

**Interfaces:**
- Produces:
  - `shared.ts` exports `ENGINE_LIMITS`, `ID_RE`, `newId(prefix?)` and `defaultSettings(schemas)`, all moved verbatim. `sanitize.ts` and `settings.ts` re-export them so existing imports keep working.
  - `THEME_SETTINGS_SCHEMA: SettingSchema[]` covers `font_heading` and `font_body` (type `font`), `button_radius` (range 0–24), `card_style` (select: plain, bordered, shadow), `phone_kit` (checkbox), `logo_url` and `favicon_url` (image), `custom_css` (textarea, info "Applies to the whole store"), and `social.instagram`, `social.whatsapp`, `social.facebook`, `social.youtube` (text; dotted ids address the nested `social` object). Defaults match `presets/shared.ts`.

- [ ] **Step 1: Failing tests:**
  - `sanitizeSection keeps a trimmed label up to 40 chars and drops empty or non-string labels`.
  - `sanitizeThemeData drops a section whose id repeats an earlier group's id` (D12; e.g. a home section with id `footer` is dropped while the footer group keeps its own).
  - `logo_url and favicon_url use the image rule` (M1 deferred minor: a value like `#x` is dropped).
  - `shared.ts loads without sanitize-html or pg`: `jest.mock('sanitize-html', () => { throw new Error('server-only'); })` and the same for `pg`, then `require('@/lib/store/engine/shared')` and `require('@/lib/store/engine/registry')` succeed.
  - `THEME_SETTINGS_SCHEMA ids cover every ThemeSettings key except color_schemes`.
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.** Label rule: `typeof label === 'string'`, trim, then slice to 40; keep only if non-empty.
- [ ] **Step 4: Run** `npx jest tests/lib/store`: all pass. Then commit.

### Task 3: Editor operations

**Files:**
- Create: `lib/store/engine/editor/ops.ts`
- Test: `tests/lib/store/engine/editor-ops.test.ts`

**Interfaces:**
- Consumes: `ThemeData`, `Section`, `Block`, `Template`, `TemplateKind` (types); `getSectionSchema`, `sectionsForTemplate` (registry); `ENGINE_LIMITS`, `newId`, `defaultSettings` (shared).
- Produces (all pure; they never mutate their input and keep unchanged subtrees by reference):

```ts
export type GroupKey = 'header' | 'footer' | 'template';
export interface SectionRef { group: GroupKey; id: string }
export type OpError = 'unknown_type' | 'not_allowed_here' | 'section_limit' | 'type_limit'
  | 'block_limit' | 'block_type_limit' | 'unknown_block_type' | 'not_found';
export type OpResult = { ok: true; theme: ThemeData; id?: string } | { ok: false; reason: OpError };
export const OP_ERROR_TEXT: Record<OpError, string>;   // tooltip copy, e.g. section_limit: 'A page can have up to 25 sections'
export function templateKind(templateKey: string, group: GroupKey): TemplateKind; // header|footer by group; 'page.x' → 'page'
export function getGroup(theme: ThemeData, templateKey: string, group: GroupKey): Template;
export function canAddSection(theme, templateKey, group, type): OpError | null;
export function canAddBlock(theme, templateKey, ref, blockType): OpError | null;
export function addSection(theme, templateKey, group, type, index, presetIndex = 0, makeId = newId): OpResult;
export function duplicateSection(theme, templateKey, ref, makeId = newId): OpResult;   // inserted right after
export function removeSection(theme, templateKey, ref): OpResult;
export function moveSection(theme, templateKey, group, from: number, to: number): OpResult;
export function toggleSection(theme, templateKey, ref): OpResult;
export function updateSection(theme, templateKey, ref,
  patch: Partial<Pick<Section, 'label' | 'color_scheme' | 'css_class' | 'custom_css'>>): OpResult;
export function setSectionSetting(theme, templateKey, ref, key: string, value: unknown): OpResult;
export function addBlock(theme, templateKey, ref, blockType, index, makeId = newId): OpResult;
export function duplicateBlock(theme, templateKey, ref, blockId, makeId = newId): OpResult;
export function removeBlock(theme, templateKey, ref, blockId): OpResult;
export function moveBlock(theme, templateKey, ref, from: number, to: number): OpResult;
export function toggleBlock(theme, templateKey, ref, blockId): OpResult;
export function setBlockSetting(theme, templateKey, ref, blockId, key, value): OpResult;
export function setThemeSetting(theme, key: string, value: unknown): ThemeData; // dotted keys for social.*
```

- [ ] **Step 1: Failing tests** (fixture: `presetTheme('studio', ctx)`, with a deterministic `makeId` returning `s1`, `s2`, …):
  - `addSection inserts at index with schema defaults and preset settings and blocks`.
  - `addSection refuses a type not allowed in the group` → `not_allowed_here` (e.g. `header` into `template` for home).
  - `addSection refuses the 26th section` → `section_limit`.
  - `addSection refuses a second section past its own limit` → `type_limit` (use a schema with `limit`, e.g. `header` in the header group).
  - `addBlock refuses the 51st block and past a block type limit` → `block_limit` / `block_type_limit`.
  - `duplicateSection copies settings and blocks with new block ids and places it after the original`.
  - `moveSection and moveBlock reorder only the order arrays; out-of-range indexes return not_found`.
  - `removeSection removes it from order and sections`.
  - `operations leave the input theme unchanged and reuse untouched groups by reference`.
  - `canAddSection matches addSection's refusal reasons`.
  - `ops.ts loads without sanitize-html or pg` (same mock trick as Task 2).
- [ ] **Step 2: Run them and confirm they fail.**
- [ ] **Step 3: Implement.** No value coercion: the server sanitises on save.
- [ ] **Step 4: Run them: pass.** Then commit.

### Task 4: Undo history

**Files:**
- Create: `lib/store/engine/editor/history.ts`
- Test: `tests/lib/store/engine/editor-history.test.ts`

**Interfaces:**

```ts
export const HISTORY_LIMIT = 100;
export const MERGE_MS = 1000;
export interface History<T> { past: T[]; present: T; future: T[]; lastKey: string | null; lastAt: number }
export function createHistory<T>(present: T): History<T>;
export function record<T>(h: History<T>, next: T, mergeKey: string | null, now: number): History<T>;
export function undo<T>(h: History<T>): History<T>;
export function redo<T>(h: History<T>): History<T>;
export function canUndo(h: History<unknown>): boolean;
export function canRedo(h: History<unknown>): boolean;
```

The merge key for a setting edit is `"<group>:<sectionId>[:<blockId>]:<settingKey>"`; theme settings use `"theme:<key>"`; structural ops pass `null`.

- [ ] **Step 1: Failing tests:**
  - `same key within 1000 ms replaces present without a new past entry`.
  - `different key, or 1000 ms or more apart, or a null key adds a past entry`.
  - `undo after a merged run returns the state before the run`.
  - `record clears the future`.
  - `past never exceeds 100 (oldest dropped)`.
  - `record with next === present is a no-op`.
  - `undo/redo at the ends return the same object`.
- [ ] **Step 2: Fail → Step 3: implement → Step 4: pass.** Then commit.

### Task 5: Bridge protocol

**Files:**
- Create: `lib/store/engine/editor/bridge.ts`
- Test: `tests/lib/store/engine/editor-bridge.test.ts`

**Interfaces:**

```ts
export const BRIDGE_SOURCE = 'kh-studio';
export type EditorToPreview =
  | { source: 'kh-studio'; type: 'select'; ref: SectionRef | null }
  | { source: 'kh-studio'; type: 'hover'; ref: SectionRef | null }
  | { source: 'kh-studio'; type: 'scroll-to'; ref: SectionRef }
  | { source: 'kh-studio'; type: 'refresh'; rev: number };
export type PreviewToEditor =
  | { source: 'kh-studio'; type: 'ready'; rev: number | null }
  | { source: 'kh-studio'; type: 'hover'; ref: SectionRef | null }
  | { source: 'kh-studio'; type: 'select'; ref: SectionRef }
  | { source: 'kh-studio'; type: 'add-at'; index: number };          // index in the current template
export function parseEditorMessage(data: unknown): EditorToPreview | null;
export function parsePreviewMessage(data: unknown): PreviewToEditor | null;
export function appOriginsForStoreHost(protocol: 'http:' | 'https:', host: string): string[];
export function storeOriginFromPreviewUrl(url: string): string | null;
```

`appOriginsForStoreHost`:
- `x.localhost:P` → `['http://localhost:P', 'http://127.0.0.1:P']`, using the page's protocol;
- `x.staging.khatario.com` → `['https://staging.khatario.com']`;
- `x.khatario.com` → `['https://khatario.com', 'https://app.khatario.com', 'https://www.khatario.com']`;
- anything else → `[]`.

- [ ] **Step 1: Failing tests:**
  - `parses each valid message type`.
  - `rejects wrong source, type, ids and index`: an id that fails `ID_RE`, a group outside `header|footer|template`, an `index` that is negative, non-integer or above 25, a non-integer or negative `rev`, extra-type payloads.
  - `appOriginsForStoreHost` for the three host shapes plus `evil.com` → `[]`, and `http:` on khatario hosts → `[]`.
  - `storeOriginFromPreviewUrl` returns the origin and returns null for a non-URL.
- [ ] **Step 2: Fail → Step 3: implement → Step 4: pass.** Then commit.

### Task 6: Save queue

**Files:**
- Create: `lib/store/engine/editor/save-queue.ts`
- Test: `tests/lib/store/engine/editor-save-queue.test.ts` (Jest fake timers; `put` and storage are fakes)

**Interfaces:**

```ts
export const AUTOSAVE_MS = 1000;
export const RETRY_MS = 5000;
export type SaveStatus = 'saved' | 'pending' | 'saving' | 'offline' | 'conflict' | 'locked' | 'error';
export interface PutResult { status: number; body: { theme?: ThemeRow; error?: string; code?: string } }
export interface SaveQueueDeps {
  put(themeId: string, data: ThemeData, updatedAt: string): Promise<PutResult>;   // throws on network failure
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  onStatus(status: SaveStatus, message?: string): void;
  onSaved(theme: ThemeRow): void;      // the editor sends 'refresh' to the preview from here
}
export function backupKey(themeId: string): string;                // 'kh-theme-unsaved:' + id
export function readBackup(storage, themeId: string, serverUpdatedAt: string):
  { data: ThemeData; stale: boolean } | null;                      // stale: base updated_at differs
export class SaveQueue {
  constructor(themeId: string, updatedAt: string, deps: SaveQueueDeps);
  schedule(data: ThemeData, immediate?: boolean): void;  // writes the backup {data, base} synchronously
  flush(): Promise<void>;
  retry(): void;
  dispose(): void;
}
```

Rules:
- Only one PUT is in flight. Edits made during a PUT replace the queued data and save after it, using the `updated_at` the PUT returned.
- Status mapping:
  - 409 `conflict` → `conflict`, stop;
  - 409 `live_locked` → `locked`, stop;
  - 413 → `error` with the body's error;
  - another 4xx or 5xx → `error`;
  - a network throw → `offline`, and retry every `RETRY_MS`.
- The backup is removed only after a successful save with nothing queued.

- [ ] **Step 1: Failing tests:**
  - `debounces 1000 ms and saves the latest data once`.
  - `immediate saves without waiting`.
  - `queues edits made during a save and chains updated_at`.
  - `stops on conflict and keeps the backup`.
  - `reports locked on live_locked`.
  - `keeps a backup and retries after a network failure`.
  - `clears the backup after a clean save`.
  - `readBackup marks a backup stale when the server moved on`.
  - `readBackup ignores corrupt JSON`.
- [ ] **Step 2: Fail → Step 3: implement → Step 4: pass.** Then commit.

### Task 7: Storefront editor mode

**Files:**
- Create: `components/store/engine/EditorBridge.tsx`
- Modify: `app/store/page.tsx`, `lib/store/engine/home-page.ts`, `components/store/engine/RenderTemplate.tsx`, `components/store/engine/SectionFrame.tsx`, `components/store/engine/SectionBoundary.tsx`, `components/store/engine/EngineShell.tsx`

**Interfaces:**
- Consumes: Task 5 parsers and `appOriginsForStoreHost`; `SectionRef`, `GroupKey` (Task 3); `getSectionSchema` (for display names).
- Produces:
  - `RenderTemplate` takes `editor: boolean`. `editor` is true only when `preview` is true **and** `searchParams.editor === '1'`.
  - Each `<section>` gets `data-section-group="header|template|footer"`.
  - In editor mode the engine root gains class `eng-editor` and renders `<EditorBridge templateKey="home" />`.

- [ ] **Step 1: Server side.**
  - `loadEngineHome` returns `editor`.
  - `SectionFrame` takes `group` and `editor`.
  - In editor mode, a section whose data has an `error`, or whose component throws, renders a red card: "<schema name>: This section failed to load". The shopper path stays unchanged (render nothing, `console.error`).
- [ ] **Step 2: EditorBridge** (client, `'use client'`):
  - **Allowed origins:** `appOriginsForStoreHost(location.protocol, location.host)`. It accepts messages only from those origins with `event.source === window.parent`, and posts to `window.parent` with the matched origin. Until the first valid editor message it posts `ready` to each allowed origin.
  - **Section outlines:** it outlines `[data-section-id]` on hover (dashed) and on select (solid), using the theme accent and a name tag showing the schema name or the section's `label`. The overlay layer is `position:absolute` and `pointer-events:none`, and is recomputed on scroll, resize and a `ResizeObserver`.
  - **Clicks:** a capture-phase click listener calls `preventDefault()` and `stopPropagation()` on any click inside a section, then posts `select`. Links and buttons inside the preview never navigate in editor mode.
  - **Add buttons:** a "+" button sits between template sections and posts `add-at` with the insertion index.
  - **Editor messages:** `select` and `hover` draw outlines. `scroll-to` calls `scrollIntoView({block:'center', behavior:'smooth'})`. `refresh` calls `router.refresh()`, puts `scrollY` back after the refresh paints, and then posts `ready` with that `rev`.
- [ ] **Step 2b: Preview before launch and old-theme isolation (D10, D11, D12).**
  - Add `currentStoreForPreview(previewTheme, pt)` next to `currentStore()` in `lib/store/current-store.ts`. The store page, `StoreProvider` (pass `preview_theme`/`pt` through to `/api/public/store/[subdomain]`) and that route accept an offline store only with a verified token for that business.
  - `StoreThemeEffects` reads an engine signal from `StoreProvider` (a `engineActive` flag that `EngineShell` sets) and then skips the old custom CSS, font and favicon. `EngineShell` sets the favicon from `settings.favicon_url`.
  - Per-section anchors replace `id="catalog"` and `id="st-categories"` in `EngineViews.tsx`.
  - Tests:
    - `tests/db/store-engine-load.db.test.ts` `an offline store renders its draft with a valid token and stays hidden without one`.
    - A unit test showing `StoreThemeEffects`' pure helper (extract one) returns no CSS when the engine is active.
- [ ] **Step 3: Editor CSS** (add to `THEME_RULES` only under `.eng-editor`): `.eng-editor .eng-sec:empty, .eng-editor .eng-sec:not(:has(>:not(style))) { display:block; min-height:48px }`, plus an `::after` placeholder showing `attr(data-section-type)` and " (nothing to show yet)", so empty sections stay clickable.
- [ ] **Step 4: Verify in the browser.** Run on one dev server only; never run two `next dev` processes in this folder, because they share `.next`. Use the ganesh test store and `setup-ganesh-theme.ts on` from the M1 workspace.
  - Open `/?preview_theme=…&pt=…&editor=1` directly: outlines appear on hover, clicks don't navigate, and "+" buttons show.
  - Without `editor=1`, the page looks exactly like M1.
  - From the console of another origin's page, posting `{source:'kh-studio',type:'refresh',rev:1}` into the iframe does nothing.
- [ ] **Step 5: Run** `npx jest tests/lib/store` and `npx tsc --noEmit`: pass. Then commit.

### Task 8: Editor shell (route, state, top bar, preview, publish)

**Files:**
- Create: `app/(app)/settings/online-store/themes/[id]/editor/page.tsx`, `components/store/studio2/Studio2Editor.tsx`, `components/store/studio2/TopBar.tsx`, `components/store/studio2/PreviewPane.tsx`
- Modify: `package.json` (`@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`; take the latest 6.x / 8.x / 3.x releases, then `npm install`)

**Interfaces:**
- Consumes: Tasks 3–6 and the API (`GET /themes/[id]`, `PUT`, `POST /publish`, `POST /preview-link` with `kind: 'editor' | 'share'`, `POST /working-draft`).
- Produces: the context `Studio2Context` (exported from `Studio2Editor.tsx`), used by Tasks 9–10:

```ts
interface Selection { kind: 'section'; ref: SectionRef } | { kind: 'block'; ref: SectionRef; blockId: string } | { kind: 'theme' } | null
interface Studio2Api {
  theme: ThemeData; templateKey: 'home'; selection: Selection;
  apply(fn: (t: ThemeData) => OpResult | ThemeData, opts: { mergeKey: string | null; immediate: boolean }): OpError | null;
  select(sel: Selection, opts?: { scroll?: boolean }): void;
  hover(ref: SectionRef | null): void;
  openAddSection(group: GroupKey, index: number): void;
  categories: { id: string; name: string }[];   // loaded once from /api/categories
}
```

- [ ] **Step 1: Page.**
  - Client component using `useAuth()`.
  - Under 1024 px (`matchMedia('(max-width: 1023px)')`) it renders only "Open the editor on a laptop or desktop".
  - It loads the theme. A live theme redirects (`router.replace`) to the id returned by `POST /working-draft`.
  - It offers a `readBackup` copy: not stale → restore it with the notice "Restored changes that hadn't saved"; stale → a banner with "Keep my changes" and "Discard".
  - It renders `Studio2Editor` full-screen, outside the settings shell, like the old Studio page does.
- [ ] **Step 2: Studio2Editor.**
  - **State:** `History<ThemeData>`.
  - **`apply`:** runs the op. On `ok: false` it returns the reason. Otherwise it calls `record(...)` and `saveQueue.schedule(theme, opts.immediate)`.
  - **Undo/redo:** these schedule an immediate save of the new present.
  - **Shortcuts:** as in Global Constraints.
  - **After a save:** `onSaved` bumps `rev` and sends `refresh` to the preview.
  - **Status banners:** `conflict` shows "This theme changed in another tab." with Reload. `locked` shows "This theme is now live." and takes the working-draft redirect. `offline` shows "Offline, retrying…".
  - **Leaving the page:** `beforeunload` asks first while the status is `pending`, `saving` or `offline`.
- [ ] **Step 3: TopBar.**
  - Back link to `/settings/online-store`, then the theme name.
  - Page switcher showing "Home" (D4).
  - Undo and redo, disabled by `canUndo`/`canRedo`.
  - Device toggle (phone 390 / desktop).
  - Save status text: Saved / Saving… / Unsaved / Offline / Error <message>.
  - "Preview" copies a 7-day share link and toasts "Preview link copied".
  - "Publish": a confirm dialog "Publish this theme? Shoppers will see it now." → `flush()` → `POST /publish` → toast "Published" → `POST /working-draft` → `router.replace` to the new id.
- [ ] **Step 4: PreviewPane.**
  - The iframe `src` comes from `POST /preview-link` (`kind:'editor'`) plus `&editor=1`; the editor origin is `storeOriginFromPreviewUrl`.
  - It refreshes the editor token before 2 h by re-requesting the link at 100 minutes.
  - It accepts `parsePreviewMessage` only from that origin with `event.source === iframe.contentWindow`.
  - Preview `select` → `select(...)`; `hover` → tree highlight; `add-at` → `openAddSection('template', index)`.
  - Every `select` initiated from the editor posts `select` and, when `scroll` is set, `scroll-to`.
- [ ] **Step 5: Run** `npx tsc --noEmit`, then a browser check: open the editor for the ganesh working draft, see the preview, undo/redo disabled at start, publish dialog opens. Then commit.

### Task 9: Section tree and Add section

**Files:**
- Create: `components/store/studio2/SectionTree.tsx`, `components/store/studio2/AddSectionModal.tsx`

**Interfaces:**
- Consumes: `Studio2Context`; ops `moveSection`, `moveBlock`, `toggleSection`, `toggleBlock`, `duplicateSection`, `removeSection`, `duplicateBlock`, `removeBlock`, `updateSection` (label), `addSection`, `addBlock`, `canAddSection`, `canAddBlock`, `OP_ERROR_TEXT`; `sectionsForTemplate`, `getSectionSchema`.

- [ ] **Step 1: Tree.**
  - Order: a "Theme settings" row (selects `{kind:'theme'}`), then Header group, Template ("Home"), Footer group.
  - Each section row shows its label or schema name, an eye toggle (hidden rows dimmed), a drag handle, and a ⋮ menu with Rename, Duplicate and Remove (Remove asks "Remove <name>?").
  - Rows expand to their blocks, with "+ Add block" (a menu of the schema's block types).
  - "+ Add section" sits at the end of each group.
  - Keyboard: rows are focusable; Enter selects.
- [ ] **Step 2: Drag and drop.**
  - `DndContext` + `SortableContext` per group and one per section's blocks, using `verticalListSortingStrategy`, `PointerSensor` (activation distance 4) and `KeyboardSensor` with `sortableKeyboardCoordinates`.
  - Items can't be dragged across groups or sections.
  - A drop calls `moveSection`/`moveBlock` with `{ mergeKey: null, immediate: true }`.
- [ ] **Step 3: AddSectionModal.**
  - Sections allowed for the group (`sectionsForTemplate`), grouped by `category`. One card per schema preset, showing the preset name and the schema name.
  - Cards with a `canAddSection` reason are disabled, with `OP_ERROR_TEXT` as the tooltip.
  - Adding inserts at the requested index, then selects and scrolls to the new section.
- [ ] **Step 4: Browser check.**
  - Drag a section; the preview order changes after the refresh.
  - Hide a section.
  - Add an "Image banner" between two sections via the preview "+".
  - Undo all three, then redo.
- [ ] **Step 5: Commit.**

### Task 10: Settings panel and fields

**Files:**
- Create: `components/store/studio2/SettingsPanel.tsx`, `components/store/studio2/fields/SettingField.tsx`, `components/store/studio2/fields/pickers.tsx`

**Interfaces:**
- Consumes: `Studio2Context`; `setSectionSetting`, `setBlockSetting`, `updateSection`, `setThemeSetting`; `THEME_SETTINGS_SCHEMA`; `StoreImageField` (`components/store/admin/StoreImageField.tsx`); `SimpleRichTextEditor` (`components/email/SimpleRichTextEditor.tsx`); `STORE_FONT_FAMILIES`; `STUDIO_USP_ICONS` (import from `lib/store/studio-sections.ts` only if that file is client-safe; otherwise copy the icon id list into `theme-settings-schema.ts` with a test asserting the two lists are equal).

- [ ] **Step 1: SettingField.** One control per `SettingType`:
  - `text`, `textarea` (with `max_length` counters);
  - `richtext` (SimpleRichTextEditor);
  - `number`, `range` (slider plus number, clamped to min/max/step);
  - `checkbox`, `select`, `radio`;
  - `color` (swatch plus hex input, rejecting invalid hex);
  - `color_scheme` (swatches of `theme.settings.color_schemes`);
  - `image` (StoreImageField);
  - `video_url`;
  - `url` (link picker: Home `/`, All products `/?cat=` cleared, each category `/?cat=<id>`, or a typed `https://` URL);
  - `product` and `product_list` (search `/api/items?search=`, max from schema, shown as chips);
  - `category` and `category_list`;
  - `icon` (icon select);
  - `font` (STORE_FONT_FAMILIES);
  - `html` (monospace textarea, "20 KB max" counter, info "Scripts and unsafe tags are removed when saved");
  - `header` (a sub-heading, no value).

  Every change calls `apply` with the setting's merge key and `immediate: false`. Settings listed in `EDITOR_HIDDEN_SETTINGS` (D13) are not rendered. The image picker URL-encodes uploaded file names, because the url rule rejects spaces.
- [ ] **Step 2: SettingsPanel.**
  - Shows the selected section's or block's schema settings (section settings include `COMMON_SETTINGS`).
  - For a section, a collapsible "Advanced" with Colour scheme, CSS class and Custom CSS (info: "Scoped to this section").
  - Duplicate and Remove buttons.
  - For `{kind:'theme'}`: `THEME_SETTINGS_SCHEMA` plus a colour scheme editor, where each of the existing schemes edits its 7 colours (no add or remove in M2).
  - Empty state: "Select a section to edit it."
- [ ] **Step 3: Browser check.**
  - Change the slideshow heading; the preview shows it about 1–2 s later.
  - Change the button radius in Theme settings.
  - Pick products for a featured-products section.
  - Paste `<script>alert(1)</script><p>x</p>` into Custom HTML; the preview shows only "x".
  - Reload the editor; every change persisted.
- [ ] **Step 4: Run** `npx tsc --noEmit`. Then commit.

### Task 11: Entry point, end-to-end test, log

**Files:**
- Modify: `app/(app)/settings/online-store/page.tsx` (button), the online-store settings GET route (add `store_engine` to its response if missing), `docs/project.log.md`
- Create: `e2e/store-studio2.spec.ts`

- [ ] **Step 1: Entry button.** "Edit store design (beta)" is shown when `store_engine` is true. On click it calls `POST /working-draft`, then `router.push('/settings/online-store/themes/<id>/editor')`.
- [ ] **Step 2: E2E spec** (localhost, test DB, logged-in storage state; skip unless `STUDIO2_E2E=1`; the store needs `store_engine` on, so set it up with the M1 fixture script):
  - `edit heading autosaves and survives reload`;
  - `drag reorders sections`;
  - `undo after save persists after reload`;
  - `clicking a section in the preview selects it in the tree`;
  - `add section between sections from the preview`;
  - `publish then edit again` (the storefront without a preview token shows the published heading, and the editor URL changed to a new draft id);
  - `under 1024 px shows the laptop notice`.
- [ ] **Step 3: Run** `STUDIO2_E2E=1 npx playwright test e2e/store-studio2.spec.ts --project=chromium` against one dev server on the test DB: all pass.
- [ ] **Step 4: Full checks.** Run `npx jest tests/lib/store`, the four engine DB suites plus `store-themes*` against `kh_phase2_test`, and `npx tsc --noEmit`: all pass.
- [ ] **Step 5: Log entry.** Append a `docs/project.log.md` entry: migration 453 runs on `kh_phase2_test` only (it must run on staging and production with 450); D1–D9; next is M3. Commit the entry, then turn `store_engine` off for the test store.
