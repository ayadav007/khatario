# Store theme engine M5 (Library and history) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merchants get a theme library at `/settings/online-store/themes`: the live theme, its working copy and up to 18 more drafts. From there they can Customise, copy a 7-day preview link, Duplicate, Rename, Publish, Delete a draft (with a confirm), and Add a theme from any of the five presets or from their current store design. A version history drawer, in the library and in Studio 2, lists every publish with its date and author. Each version has a read-only preview through a signed token and a "Restore as draft" action. Publishing from the library no longer leaves a stale working draft that can overwrite the live theme later (M2 N2). The editor copes with a theme that another tab deletes, publishes or resets. `store_engine` stays off for every store.

**Architecture:**
- **Versions.** Versions become a per-business timeline. Migration 454 gives `store_theme_versions` the theme's name and preset at publish time. It also stops versions being deleted with their theme (`ON DELETE SET NULL`), so history and restore outlive a deleted draft.
- **Server modules.** A new `versions-repo.ts` lists, reads, inserts and prunes versions. `themes-repo.ts` publish uses it and applies the N2 rule (D40).
- **Version preview.** It reuses the storefront's existing `preview_theme` + `pt` parameters, so every link helper, the offline-store gate and the public APIs carry it unchanged. The token itself says whether it names a theme or a version (D47). One server helper, `preview-target.ts`, resolves either, and both `load-theme.ts` and `preview-store.ts` use it. A version is never in editor mode.
- **Library UI.** It is a client page built from small components in `components/store/library/`. Display and permission rules sit in one client-safe, unit-tested module, `lib/store/engine/library.ts`. The fetch helpers live in `components/store/library/api.ts`.
- **Editor.** The editor learns a `gone` save status (404). It re-checks its theme when the tab becomes visible, so it notices a delete, a publish or a reset done in another tab even when it has nothing to save.

**Tech Stack:** Next.js 14 app router, React 18, TypeScript, Postgres, Jest + ts-jest (node env, `.ts` tests only), Playwright (e2e spec may gain scenarios; never run by a task).

**Spec:** `docs/superpowers/specs/2026-10-29-store-theme-engine-studio2-design.md`. M5 is §8 item 5. The relevant parts are Tables and Rules in §2 (role swap, rollback, newest 30 versions, token lifetimes) and Theme library, Version history and API in §4. Earlier plans: `2026-10-30-store-engine-m1-core.md`, `-m2-studio2-editor.md`, `-m3-every-page.md`, `2026-10-31-store-engine-m4-presets-migration.md`. Carry-over lists: `2026-10-30-store-engine-m2-carryover.md` (N2, N3), `2026-10-30-store-engine-m3-carryover.md`, `2026-10-31-store-engine-m4-carryover.md`.

## What already exists (do not rebuild)

- **Routes.** `GET/POST /themes` (list; create from a preset or `duplicate_of`); `GET/PUT/PATCH/DELETE /themes/[id]` (DELETE refuses the live theme); `POST /themes/[id]/publish`; `POST /themes/[id]/preview-link` (`kind: 'editor' | 'share'`, `path`); `POST /themes/working-draft`.
- **`themes-repo.ts`:**
  - the business advisory lock `lockBusinessThemes`;
  - the 20-theme limit inside the INSERTs;
  - `publishTheme`: R11 copies the working draft onto the live theme; any other draft swaps roles. It writes one version row and prunes to `ENGINE_LIMITS.versionsKept` (30) per business. `tests/db/store-themes.db.test.ts` already checks "newest 30 after 31 publishes".
- **`preview-token.ts`:** `signThemePreview` / `verifyThemePreview` with `PREVIEW_TTL = { editor: 2 h, share: 7 d }`.
- **Studio 2:** TopBar "Preview" copies a share link for the current page; Back goes to `/settings/online-store`. The `locked` save status (409 `live_locked`) moves to the working draft and carries unsaved edits as a backup.
- **Settings page:** "Edit store design (beta)" (only when `store_engine`) opens the working draft.

## Decisions beyond the spec

These were decided while planning. Hold the code to them; do not re-open them. M1–M4 used D1–D38.

- **D39 Library page.**
  - Route: `app/(app)/settings/online-store/themes/page.tsx` (client). Components go in `components/store/library/`.
  - Layout, top to bottom:
    1. a header with "Themes", the count "N of 20 themes", and "Add theme";
    2. a notice when `store_engine` is off (D52);
    3. the **live card**;
    4. inside the live card, a "Working copy" row when a working draft exists (D40);
    5. the **drafts** list, newest `updated_at` first, with the working draft left out.
  - A row shows the name, the preset label, "Edited <relative time>", and an "Unsaved edits on this device" badge when a local backup exists for that theme (D51).
  - Actions, from `themeActions(row, { canEdit, hasChanges })` in `library.ts`:

    | Row | Customise | Preview link | Duplicate | Rename | Publish | Discard changes | Delete | History |
    |---|---|---|---|---|---|---|---|---|
    | live | yes (opens the working draft) | yes | yes | yes | no | no | no | yes |
    | working draft | yes | yes | yes | yes | yes, only when `has_changes` | yes, only when `has_changes` | **no** | no |
    | other draft | yes | yes | yes | yes | yes | no | yes (confirm) | no |

  - Without `settings` modify permission (`canEdit` false), only Preview link and History stay, and the page says "Ask an admin for permission to change the store design".
  - Without `settings` view permission, the page shows only that notice. The API refuses anyway.
  - The plan gate: a 402/403 from the list call shows the API's error text in place of the library.
- **D40 The working draft and library drafts (fixes M2 N2).**
  - The working draft (W, `is_working`) is "the copy of the live theme that Customise edits". The library shows it only inside the live card, never as a separate draft.
  - `listThemes` gains `has_changes: boolean`. It is true only for W, and only when its `data` or `preset` differs from the live theme's (`IS DISTINCT FROM`).
  - **Publishing W** (R11, unchanged in shape): W's `data` is copied onto the live row. The live row also takes **W's `preset`**, so the two cannot drift. W stays the working draft.
  - **Publishing any other draft X** (swap), in the same transaction after the swap:
    - When W has no changes against the *old* live theme, W is refreshed from X: `data`, `preset`, and `name = workingDraftName(X.name)`. Its `updated_at` changes, so an editor open on W gets the existing 409 conflict, "changed in another tab, Reload".
    - When W has unpublished changes, W is detached: `is_working = false`, and it is renamed `"<old base> (unpublished edits)"`, cut to 60 characters. The edits survive as an ordinary library draft, and the next Customise makes a fresh W from X.
    - Either way, a later publish of the working draft can never overwrite X with the old design.
    - When X *is* W, nothing changes: that is the copy path.
- **D41 Discard changes.**
  - New `POST /api/settings/online-store/themes/working-draft/reset` (settings update and the plan gate).
  - Under the business lock it sets W's `data`, `preset` and name to match the live theme's again and bumps `updated_at`.
  - It returns `{ theme }`, or 404 `not_found` when there is no W.
  - It is the only way to throw W's edits away, because W itself cannot be deleted (D42).
- **D42 Delete.**
  - `deleteTheme` deletes only `role = 'draft' AND NOT is_working`.
    - The live theme gives 409 `live_locked`, as today.
    - The working draft gives 409 with the new code `working_locked`: "This is the copy the editor works on. Use Discard changes instead."
    - W counts as open whenever an editor might have it, so it is never deletable. To get rid of it: Discard changes, or publish another theme (D40 detaches it when it has edits).
  - Deleting a theme keeps its versions (D44: `theme_id` becomes null).
  - The confirm reads: "Delete '<name>'? This can't be undone. Versions it published stay in Version history." It has a red "Delete" button and focuses Cancel.
- **D43 Add theme.**
  - The modal offers six choices: the five presets (`studio`, `quick`, `grocery`, `khatario`, `blank`) and "Your current store design".
  - Each preset choice shows its label, a one-line description and two swatches (canvas and accent). They come from `PRESET_CHOICES` in `library.ts`. A unit test checks the swatches against `PRESET_LOOK`, so they cannot drift.
  - An optional name; empty gives the server default.
  - POST `/themes` gains `source: 'migrated'`. It builds the theme from `migrateStoreTheme(input.raw, input.ctx)` as a **draft**, named `"<preset label> (from your store)"`.
    - It returns 409 with the new code `no_store_design` when the business has no row to migrate from.
    - It returns 413 `too_large` when the migrated data is over the cap.
  - Any create at 20 themes is 409 `limit`. The modal disables "Add theme" at 20 and says "Delete a draft to add another".
  - After a create, the library opens nothing on its own: the new draft appears at the top of the list with a "Customise" button.
- **D44 Migration 454: versions outlive themes.** File `database/migrations/454_store_theme_versions_library.sql` (renumber to the next free number if 454 is taken when the task starts). It is idempotent:

  ```sql
  ALTER TABLE store_theme_versions ADD COLUMN IF NOT EXISTS preset VARCHAR(16) NULL;
  ALTER TABLE store_theme_versions ADD COLUMN IF NOT EXISTS theme_name VARCHAR(60) NULL;
  ALTER TABLE store_theme_versions ALTER COLUMN theme_id DROP NOT NULL;
  DO $$
  DECLARE fk text;
  BEGIN
    SELECT conname INTO fk FROM pg_constraint
     WHERE conrelid = 'store_theme_versions'::regclass AND contype = 'f'
       AND confrelid = 'store_themes'::regclass AND confdeltype <> 'n';
    IF fk IS NOT NULL THEN
      EXECUTE format('ALTER TABLE store_theme_versions DROP CONSTRAINT %I', fk);
      ALTER TABLE store_theme_versions ADD CONSTRAINT store_theme_versions_theme_fk
        FOREIGN KEY (theme_id) REFERENCES store_themes(id) ON DELETE SET NULL;
    END IF;
  END $$;
  UPDATE store_theme_versions v SET preset = t.preset, theme_name = t.name
    FROM store_themes t WHERE v.theme_id = t.id AND v.preset IS NULL;
  ```

  - **Why a migration is truly needed:**
    - without it, deleting a draft that was once live silently deletes its published history (the FK cascades);
    - a version cannot be rendered or restored with the right preset, because versions store no preset.
  - It runs on `kh_phase2_test` only. On staging and production it must run **before** M5's code is deployed, together with 450 and 453 (Task 9), because publish writes the new columns.
- **D45 Version history is the business's timeline.**
  - One list per business, newest first, at most 30 (the prune keeps exactly that many).
  - Routes live under `/api/settings/online-store/themes/versions/…`:
    - `GET /versions`;
    - `POST /versions/[vid]/restore`;
    - `POST /versions/[vid]/preview-link`.
  - The spec's `/themes/[id]/versions` is **not** built, because a version can outlive its theme (D44) and R11 records nearly every publish against the live row.
  - The static `versions` segment wins over `[id]` in the app router, as `working-draft` already does.
- **D46 Version list contents.**
  - `ThemeVersionSummary` has:
    - `id`;
    - `theme_id: string | null`;
    - `theme_name` (the name at publish time; for old rows not backfilled, `"Published theme"`);
    - `preset` (falls back to `'studio'`);
    - `published_at` (ISO);
    - `published_by_name: string | null`, from `LEFT JOIN users u ON u.id = v.published_by`, using `u.name`;
    - `theme_exists: boolean`.
  - No user ids and no data are sent.
  - The drawer shows the date (`en-IN`, for example "31 Oct 2026, 4:05 pm"), the theme name, and "by <name>". A null author shows "Set up automatically" (the migration).
  - The first row carries a "Latest" badge.
- **D47 Version preview tokens.**
  - `signVersionPreview(businessId, versionId, ttlMs)`: the payload is `{ b, v, exp }`, MACed under a **different domain prefix** (`store-theme-version-preview:`).
  - `verifyVersionPreview(token, businessId)` returns the version id or null.
  - `verifyThemePreview` keeps its prefix and requires `t`, so neither kind of token verifies as the other.
  - `verifyPreviewToken(token, businessId): { kind: 'theme' | 'version'; id: string } | null` tries both.
  - The version link is `<store origin><path>?preview_theme=<versionId>&pt=<version token>`. The existing parameter names are reused, so `links.ts`, `store-context.tsx`, `preview-access.ts` and every public API carry it unchanged.
  - `PREVIEW_TTL.version = 2 h`: the merchant opens it now, and it is not a shared link.
  - `resolvePreviewTarget(businessId, previewId, pt)` (new, server):
    - a theme token gives `getTheme`;
    - a version token gives `versionAsTheme(getVersion(...))`, with `id` = the version id, `role: 'draft'`, `is_working: false`, `updated_at` = `published_at`, and the D46 name and preset;
    - the id in the URL must equal the token's id (case-insensitive), as today.
  - `loadEngineTheme` returns `version: true` for a version, and `loadEnginePage` sets `editor = false` whenever `version` is set. A version preview is read-only: no bridge, no outlines, nothing to save.
  - A version id from another business never resolves. The token is bound to the business, and the lookup is `WHERE business_id = $1 AND id = $2`.
- **D48 Restore as draft.**
  - `restoreVersion(businessId, userId, versionId)` runs under the business lock and the 20-theme limit.
  - It inserts a **draft**: name `"Restored: <theme_name>"` cut to 60, preset = the version's, `data = sanitizeThemeData(version.data)`. The data is sanitised again because schemas may have changed since the publish. Over the cap gives `too_large`.
  - Results: `not_found` for an unknown or foreign version, `limit` at 20. Restore never goes live and never writes a version.
  - The route returns 201 `{ theme }`.
  - The UI then offers "Customise" for the new draft. In the library it highlights the row; in Studio 2 it goes there after a flush (Task 6).
- **D49 Versions and the prune.**
  - `insertVersionLocked(client, businessId, row, userId)` writes `theme_id, business_id, data, preset, theme_name, published_by`. It then calls `pruneVersionsLocked(client, businessId)`, which keeps the newest 30 by `published_at DESC, id DESC` **for that business only**.
  - Both publish paths use it.
  - `insertMigratedLiveLocked` also records a version (author null), so the store's pre-engine design can always be restored, even after the first publish replaces it.
  - The client never sends `published_by`. Its value is the session user, or null from the migration script.
- **D50 The editor and other tabs.**
  - **A theme deleted elsewhere.**
    - `SaveQueue` maps a PUT 404 with code `not_found` to a new terminal status `gone`: it stops, like `conflict`, and keeps the queued data.
    - The editor then runs `goToWorkingDraft(true)`. The unsaved edits are carried as a backup that the working draft offers, through the existing "Keep my changes / Discard" banner.
    - It also shows the toast "This theme was deleted in another tab. Your unsaved edits are offered on your working copy."
  - **A theme published elsewhere:** the existing `locked` path, unchanged.
  - **Working draft reset or refreshed elsewhere** (D40, D41): the existing `conflict` path.
  - **An idle tab.** On `visibilitychange` to visible, at most once per 10 s, the editor GETs its theme. `remoteThemeState(local, remote)`, pure in `shell.ts`, returns:
    - `'gone'` when the GET was a 404;
    - `'live'` when `role === 'live'`;
    - `'changed'` when `updated_at` differs from the queue's base and the queue is `saved`;
    - `'same'` otherwise.

    `gone` and `live` run `goToWorkingDraft(true)` (with nothing queued, there is nothing to carry). `changed` shows the conflict banner and stops the queue.
  - **On load,** a 404 from `fetchTheme` shows "This theme no longer exists." with a "Back to themes" link.
  - Read-only also disables PageSettings (M3 Minor 5), so nothing can be edited while leaving.
- **D51 Backup sweep (M2 N3 residual).** With the library, a merchant moves between themes of one business, and today's `sweepOtherBackups` would drop an offline draft's only copy.
  - Backups gain `savedAt` (ms).
  - The new `sweepBackups(storage, businessId, { keepThemeIds?, now, maxAgeMs = 14 days })` removes this business's keys whose theme is not in `keepThemeIds` (only when a list is given) or whose `savedAt` is older than `maxAgeMs`, plus legacy business-less keys.
    - The editor page calls it without a list (age only).
    - The library page calls it with the ids it listed.
  - `sweepOtherBackups` is removed.
  - `hasBackup(storage, businessId, themeId)` drives the D39 badge.
- **D52 Entry points and the engine flag.**
  - The Online store settings page shows "Themes (beta)", a link to `/settings/online-store/themes`, beside "Edit store design (beta)", under the same `store_engine` condition.
  - Studio 2's TopBar:
    - "Back" becomes "Themes" and goes to the library;
    - a new "History" button opens the version drawer.
  - The library itself works for any store on the plan.
  - When `store_engine` is off, the library shows: "Shoppers still see your classic store. Published themes show only in preview links until the new store design is switched on." Publish's confirm also says so.
  - The flag is read from the existing `GET /api/settings/online-store`.
- **D53 Read routes need the settings permission too.**
  - `GET /themes` and `GET /themes/[id]` switch from `requireTenantBusinessId` to `requireTenantPermission(request, …, 'settings', 'read')`, as the spec requires ("online-store settings permission"). `GET /versions` uses the same.
  - Every write keeps `settings` / `update`. Every route keeps `denyIfFeatureMissing(…, 'advanced_online_store')`.
  - The business is always the session's: a body or query `business_id` is only compared, never used.
- **D54 Carry-over pulled into M5:**
  - **M2 N2:** D40.
  - **M2 N3:** D51.
  - **M3 Minor 5:** PageSettings respects read-only (D50).
  - **M3 Minor 3:** the product Share block shares `origin + pathname`, never a preview token.
  - **M3 Minor 9 / R6, for preview links:** `offers` and `search/suggest` use `storeForPublicApi`, so a shared preview of an unlaunched store has offers and search suggestions.
  - **M4 4:** an oversized migrated theme falls back to the Studio preset, with a warning in the result, instead of a 500.
  - **M4 5:** the migration input is read only when no live theme exists, under the lock.
  - **M4 6:** `migrationInputFor` takes an optional `client`, so it does no nested pool reads under the lock.
  - **M4 7:** `MigrationInput` and `migrationInputFor` move to `lib/store/engine/migration-input.ts`, which ends the `themes-repo` ↔ `migrate-runner` import cycle.
  - **M4 11:** until the engine has Quick's header, a migration warning reads "Quick's delivery line, location picker and menu chips are not in the new header yet".
  - **Kept deferred:**
    - M2's per-keystroke backup write, N4, N5;
    - M3 Minors 4, 6, 11 and the Task 8 minors;
    - M4 1–3, 8–10 and 11's full header;
    - M4 9 (the category-shelves grouped query) is a storefront performance item for the M6 switch-over pass, not a library one.

## Global Constraints

- **Database:**
  - Migrations and DB tests run only on the disposable DB `kh_phase2_test`.
  - M5 adds **one** SQL migration, 454 (D44). It is numbered after the highest existing file in `database/migrations` and is idempotent (`IF NOT EXISTS`, guarded `DO` block).
  - It is applied only to `kh_phase2_test`, never beyond. Nothing in M5 runs against staging or production: no migration, no script.
- **Permission and plan gate.** Every theme route requires the online-store settings permission:
  - `settings` / `read` for GETs;
  - `settings` / `update` for every write: POST, PUT, PATCH, DELETE, publish, preview-link, working-draft, reset, restore, version preview-link.
  - It also requires the existing `advanced_online_store` plan gate.
- **Trust.** The business comes from the session (`requireTenantPermission`). Never trust a client-sent `business_id`, `user_id`, `created_by`, `updated_by` or `published_by`. `published_by` and `updated_by` are always the session user, or null from the migration script.
- **Version preview:**
  - It is read-only (never editor mode) and comes only through a signed token bound to the business and the version (D47).
  - It is valid for 2 hours. Theme share links stay at 7 days, editor tokens at 2 hours.
- **Restore** creates a draft and nothing else (D48).
- **Delete** works only on drafts: never the live theme, and never the working draft, which is treated as open whenever it exists (D42).
- **Limits:**
  - never more than 20 themes per business: create, duplicate, migrated, restore and the working draft all go through the same locked INSERT check;
  - versions keep the newest 30 per business (D49);
  - unchanged: 25 sections per template, 50 blocks per section, 30 custom pages, 512 KB, ids `/^[a-z0-9_-]{1,32}$/`.
- **No local browser checks** (owner direction, M3 R11):
  - Do not start a dev server.
  - Do not run Playwright. The e2e spec may gain scenarios, but it is not run.
  - Every task with visible output ends with **Staging test steps**, collected in Task 9.
  - The gate is jest unit tests, DB tests (`PHASE2_TEST_DATABASE_URL` set to the local `kh_phase2_test` URL) and `npx tsc --noEmit`.
- **Client bundle:**
  - Client components never import server-only modules: `pg`, `@/lib/db`, `sanitize-html`, `crypto`, or anything importing them. That includes `themes-repo.ts`, `versions-repo.ts`, `preview-token.ts`, `preview-target.ts`, `migration-input.ts`, `migrate*.ts`, `presets/*`, `sanitize.ts`, `settings.ts`, `html.ts` and `color-schemes.ts`.
  - The new client-safe modules are `lib/store/engine/library.ts` (it imports only types and `shared.ts`) and `components/store/library/api.ts` (fetch only, type-only engine imports).
- **Commits:**
  - One commit per task on `main`, never pushed.
  - Stage files by path (never `git add .`). Never stash, reset or clean; never stage another session's hunks. `docs/project.log.md` and `docs/superpowers/plans/2026-10-30-store-engine-m1-core.md` have another session's unstaged edits.
  - Message trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Hands off:**
  - project C's files;
  - the old Studio (`components/store/admin/theme-studio/*`, `app/(app)/settings/online-store/studio/*`);
  - the old pack renderers.

## Review Focus

1. **Cross-business reach.** Business A's session must get 404 when it:
   - restores B's version;
   - previews B's version;
   - deletes, renames, publishes or resets B's themes.

   A version token signed for A must not open a preview on B's store, even with B's version id in the URL. Test: Task 3 DB `foreign version` and `token for another business`.
2. **Token kind confusion:**
   - a theme token with a version id in `preview_theme` does not resolve;
   - a version token with a theme id does not resolve;
   - a version token never yields editor mode, even with `editor=1`.

   Test: Task 3 unit and load DB cases.
3. **N2 is closed.** The steps: publish X from the library, then Customise, then publish the working draft. X's row must keep X's design, or get the working draft's edits that the merchant made on X; never the pre-X design. With unpublished edits on the old W, those edits survive as a draft. Test: Task 2 DB `N2`.
4. **Delete is narrow.** The live theme and the working draft are refused. Deleting a former live theme keeps its versions, which can still be restored. Test: Task 1 and Task 2 DB.
5. **Limits:**
   - restore, duplicate, Add theme and the migrated source at 20 themes give `limit` with no row added;
   - after 31 publishes across two themes and one delete, the business has exactly 30 versions;
   - another business's versions are untouched.

   Test: Task 1 and Task 3 DB.
6. **Another tab.** A 404 PUT moves the edits to the working draft instead of looping on retry. A visible-again tab notices a delete or a publish. Test: Task 7 unit.
7. **Client bundle.** `library.ts` and `components/store/library/api.ts` load with `pg`, `sanitize-html` and `crypto` mocked to throw. Test: Task 4.

## File Structure

```
database/migrations/454_store_theme_versions_library.sql   preset, theme_name, theme_id SET NULL (D44)
lib/store/engine/
  versions-repo.ts        listVersions, getVersion, versionAsTheme, insertVersionLocked, pruneVersionsLocked, restoreVersion  (server)
  themes-repo.ts          publish uses versions-repo + N2 (D40); resetWorkingDraft (D41); delete rule (D42);
                          createTheme({ source: 'migrated' }) (D43); listThemes.has_changes; M4 4/5/6
  migration-input.ts      MigrationInput, migrationInputFor(businessId, client?)   (moved from migrate-runner, M4 7)
  migrate-runner.ts       imports migration-input.ts
  migrate.ts              Quick header warning (M4 11)
  preview-token.ts        signVersionPreview, verifyVersionPreview, verifyPreviewToken, PREVIEW_TTL.version
  preview-target.ts       resolvePreviewTarget()                                     (server)
  preview-url.ts          storePreviewUrl() shared by both preview-link routes      (server)
  load-theme.ts, page-loader.ts   version previews, never editor mode
  route-utils.ts          codes working_locked, no_store_design
  library.ts              PRESET_CHOICES, splitLibrary(), themeActions(), formatPublishedAt(), authorLabel()  (client-safe)
  editor/save-queue.ts    'gone' status; savedAt; sweepBackups(); hasBackup()
  editor/shell.ts         remoteThemeState(); 'gone' label
lib/store/preview-store.ts                     resolveOfflineStoreForPreview uses resolvePreviewTarget
app/api/settings/online-store/themes/
  route.ts                GET permission; POST source 'migrated'
  [id]/route.ts           GET permission; DELETE working_locked
  [id]/preview-link/route.ts   uses preview-url.ts
  working-draft/reset/route.ts                 new (D41)
  versions/route.ts                            new GET (D45)
  versions/[vid]/restore/route.ts              new POST (D48)
  versions/[vid]/preview-link/route.ts         new POST (D47)
app/api/public/store/[subdomain]/{offers,search/suggest}/route.ts   storeForPublicApi (D54)
app/(app)/settings/online-store/themes/page.tsx          new library page
app/(app)/settings/online-store/page.tsx                 "Themes (beta)" link
app/(app)/settings/online-store/themes/[id]/editor/page.tsx   sweepBackups, 404 text
components/store/library/
  api.ts, ThemeLibrary.tsx, ThemeRowCard.tsx, AddThemeModal.tsx, ConfirmDialog.tsx, RenameDialog.tsx, VersionHistoryDrawer.tsx
components/store/studio2/{TopBar,Studio2Editor,PageSettings}.tsx
components/store/engine/product/ProductBlocks.tsx        Share without query (D54)
e2e/store-theme-library.spec.ts                          new scenarios, not run
```

---

### Task 1: Migration 454 and the versions repository

**Files:**
- Create:
  - `database/migrations/454_store_theme_versions_library.sql` (D44);
  - `lib/store/engine/versions-repo.ts`;
  - `tests/db/store-theme-versions.db.test.ts`.
- Modify: `lib/store/engine/themes-repo.ts` (publish and the migrated live insert use `insertVersionLocked`; the inline prune moves out); `lib/store/engine/types.ts` (`ThemeVersionSummary`, `ThemeVersionRow`).

**Interfaces:**
- Produces:
  - `interface ThemeVersionSummary { id: string; theme_id: string | null; theme_name: string; preset: ThemePreset; published_at: string; published_by_name: string | null; theme_exists: boolean }` (D46).
  - `interface ThemeVersionRow extends ThemeVersionSummary { business_id: string; data: ThemeData }`.
  - `listVersions(businessId): Promise<ThemeVersionSummary[]>`:
    - newest first (`published_at DESC, id DESC`), `LIMIT ENGINE_LIMITS.versionsKept`;
    - `published_at` as a microsecond ISO string, like `UPDATED_AT`;
    - `theme_name` falls back to `'Published theme'`, `preset` to `'studio'`;
    - `theme_exists = theme_id IS NOT NULL`.
  - `getVersion(businessId, versionId): Promise<ThemeVersionRow | null>`, with `WHERE business_id = $1 AND id = $2`.
  - `versionAsTheme(v: ThemeVersionRow): ThemeRow`, pure (D47).
  - `insertVersionLocked(client, businessId, row: Pick<ThemeRow,'id'|'name'|'preset'|'data'>, userId: string | null): Promise<void>`. It inserts, then calls `pruneVersionsLocked`.
  - `pruneVersionsLocked(client, businessId): Promise<number>`, which returns the number of rows deleted.
- Consumes: `lockBusinessThemes`, `ENGINE_LIMITS`.

- [ ] **Step 1: Apply the migration to the test DB only.** Write the D44 SQL. Apply it twice, to prove it is idempotent, with `psql` (`PG*` taken from the local `.env`, database `kh_phase2_test`) or the workspace `with-test-db.js`. Never apply it anywhere else. Do not print the URL or the password.
- [ ] **Step 2: Write failing tests** in `store-theme-versions.db.test.ts`. Seed businesses `BIZ` and `OTHER`, and a `users` row named "Asha" for `BIZ`'s user, inserted like `tests/db/connect-leads-imports.db.test.ts` does.
  1. **`publish records name and preset`:** after publishing draft X (preset `grocery`, name "Green"), `listVersions(BIZ)[0]` has `theme_name: 'Green'`, `preset: 'grocery'`, `published_by_name: 'Asha'`, `theme_exists: true`.
  2. **`working-draft publish records the live row`:** after the R11 copy path, the version's `theme_id` is the live id and its `theme_name` is the live name.
  3. **`versions outlive a deleted theme`:**
     - publish X, then publish Y (X is demoted), then delete X;
     - X's version is still listed with `theme_exists: false` and `theme_id: null`;
     - `getVersion` returns its data.
  4. **`prune keeps 30 per business`:**
     - 31 publishes alternating between two drafts, plus 3 publishes on `OTHER`;
     - `BIZ` has exactly 30 versions, the oldest is gone, and `OTHER` still has 3;
     - `pruneVersionsLocked` on a business with 30 returns 0.
  5. **`foreign version`:** `getVersion(OTHER, <BIZ version id>)` is null.
  6. **`versionAsTheme`:** its id is the version id, with `role: 'draft'`, `is_working: false` and `updated_at === published_at`.
  7. **`migrated live theme records a version`:** for a fresh business with a `store_theme`, `getOrCreateWorkingDraft` → one version with `published_by_name: null` and the migrated preset.
  8. **`migration columns`:** `information_schema.columns` shows `preset` and `theme_name`. `theme_id` is nullable, and the FK's `confdeltype` is `'n'`.
- [ ] **Step 3:** Run `npx jest tests/db/store-theme-versions.db.test.ts` with `PHASE2_TEST_DATABASE_URL`: FAIL.
- [ ] **Step 4:** Implement. `publishTheme` keeps its SQL shape. It calls `insertVersionLocked(client, businessId, row, userId)`, where `row` is the live row after the copy or the swap. `insertMigratedLiveLocked` calls it with `userId` (null from the script).
- [ ] **Step 5:** Run the new file, `tests/db/store-themes.db.test.ts`, `tests/db/store-themes-api.db.test.ts`, `tests/db/store-theme-migrate.db.test.ts` and `npx tsc --noEmit`: PASS. If a migrate test counts versions, update it to expect the D49 row and say so in the commit.
- [ ] **Staging test steps:** none visible yet. Migration 454 joins the "before deploying" list (Task 9).
- [ ] **Step 6:** Commit (migration, repo, types, test by path): "Published theme versions now keep the theme's name and preset and survive when that theme is deleted (migration 454, test DB only); the store's migrated design is recorded as its first version, and the 30-version prune is per business."

### Task 2: Library writes: publish without a stale working draft, Discard changes, delete rules, Add from the store design

**Files:**
- Create:
  - `lib/store/engine/migration-input.ts` (moved from `migrate-runner.ts`, M4 7);
  - `app/api/settings/online-store/themes/working-draft/reset/route.ts`.
- Modify:
  - `lib/store/engine/themes-repo.ts`: D40, D41, D42, D43, `has_changes`, M4 4/5/6;
  - `lib/store/engine/migrate-runner.ts` and `migrate.ts` (Quick header warning, M4 11);
  - `lib/store/engine/route-utils.ts`;
  - `app/api/settings/online-store/themes/route.ts`;
  - `app/api/settings/online-store/themes/[id]/route.ts`;
  - `lib/store/engine/types.ts` (`ThemeListRow = Omit<ThemeRow,'data'> & { has_changes: boolean }`).
- Test: extend `tests/db/store-themes.db.test.ts`, `tests/db/store-themes-api.db.test.ts`, `tests/db/store-theme-migrate.db.test.ts`, `tests/lib/store/engine/migrate.test.ts`.

**Interfaces:**
- Produces:
  - `listThemes(businessId): Promise<ThemeListRow[]>` (D40 `has_changes`).
  - `publishTheme`, unchanged in signature, with the D40 behaviour.
  - `resetWorkingDraft(businessId, userId): Promise<RepoResult<ThemeRow>>` (D41).
  - `deleteTheme`: new failure code `'working_locked'` (D42). `RepoResult` codes gain `'working_locked' | 'no_store_design'`.
  - `createTheme(businessId, userId, { name, preset?, duplicateOf?, source?: 'preset' | 'migrated', ctx })`:
    - the `migrate` option is gone. Under the lock, when no live theme exists, it calls `migrationInputFor(businessId, client)` and inserts the migrated live theme (M4 5, 6);
    - `source: 'migrated'` builds the D43 draft. With no business row the result is `no_store_design`.
  - `insertMigratedLiveLocked`: when the migrated data is too large, it inserts the Studio preset from `presetContextFor` instead and appends the warning "Your store design was too large to copy; the Studio theme was used instead" (M4 4).
  - `migrationInputFor(businessId, client?: PoolClient): Promise<MigrationInput | null>`, in `migration-input.ts`.
  - `route-utils` failures:
    - `working_locked` → 409, "This is the copy the editor works on. Use Discard changes instead.";
    - `no_store_design` → 409, "There is no store design to copy yet.".
  - POST `/themes`: body `source` is `'preset'` (default) or `'migrated'`; anything else gives 400.
  - GET `/themes` and GET `/themes/[id]`: `requireTenantPermission(…, 'settings', 'read')` (D53).
  - POST `/themes/working-draft/reset` → `{ theme }`.

- [ ] **Step 1: Write failing tests.**
  - `store-themes.db.test.ts`, describe `library (M5)`:
    1. **`N2: publishing a library draft refreshes a clean working draft`:**
       - live L, working draft W (no edits), draft X with different data;
       - `publishTheme(X)` → W's data equals X's, its preset is X's, and its name is `"<X name> (editing)"`;
       - then `publishTheme(W)` → X (live) still has X's data.
    2. **`N2: a working draft with edits is kept as a draft`:**
       - W saved with a heading change, then `publishTheme(X)`;
       - the old W row has `is_working: false`, its name ends with "(unpublished edits)", and it keeps the edit;
       - `getOrCreateWorkingDraft` returns a new id whose data equals X's.
    3. **`working-draft publish copies the preset`:**
       - force W's preset to `quick` with SQL, then publish W;
       - the live row's preset is `quick` and its name is unchanged.
    4. **`has_changes`:** false right after `getOrCreateWorkingDraft`; true after `saveTheme(W)` with different data; false for every other row.
    5. **`resetWorkingDraft`:** after an edit, a reset makes W's data equal the live data, changes `updated_at`, and turns `has_changes` false. With no W it returns `not_found`.
    6. **`delete refuses the working draft`:** `deleteTheme(W)` gives `working_locked`, and the row still exists. The live theme gives `live_locked`; a draft is deleted.
    7. **`migrated source`:**
       - on a business with a Grocery `store_theme` and an existing live theme, `createTheme({ source: 'migrated' })` → `role: 'draft'`, preset `grocery`, name "Premium Grocery (from your store)" (use the real `STORE_THEME_PRESETS.grocery.label`);
       - a business with no `business_settings` row → `no_store_design`.
    8. **`limit applies to every create`:** at 20 themes, the preset, duplicate and migrated sources each give `limit`, and the count stays 20.
    9. **`oversized migration falls back` (M4 4):** `migrationInputFor` is spied to return a `store_theme` whose Custom CSS and studio sections push the data over 512 KB. `getOrCreateWorkingDraft` succeeds with a live preset `studio`.
    10. **`no migration read when live exists` (M4 5):** spy `migrationInputFor`. `createTheme` on a business with a live theme never calls it.
  - `store-themes-api.db.test.ts`:
    - GET list and GET by id return 403 when `requireTenantPermission` is mocked to refuse `settings`/`read`; the mock records the module and action;
    - POST `{ source: 'migrated' }` → 201 draft; POST `{ source: 'x' }` → 400;
    - DELETE on W → 409 `working_locked`;
    - POST reset → 200, and 404 when there is no W;
    - a body `business_id` of another business on reset → the mocked tenant check's refusal (403), and nothing changes.
  - `migrate.test.ts`: a Quick fixture's warnings include the D54 Quick header text, and a Studio fixture's do not.
- [ ] **Step 2:** Run those files: FAIL.
- [ ] **Step 3:** Implement.
  - Move `MigrationInput` and `migrationInputFor` into `migration-input.ts`. Re-export them from `migrate-runner.ts` so the script keeps working. `themes-repo.ts` imports only `migration-input.ts`.
  - The D40 step runs in `publishTheme`'s swap branch, after the swap, using the old live data read before the swap.
- [ ] **Step 4:** Run `npx jest tests/lib/store`, the four engine DB files (`store-themes`, `store-themes-api`, `store-theme-migrate`, `store-theme-versions`) and `npx tsc --noEmit`: PASS.
- [ ] **Staging test steps** (with the API, until Task 5 adds the page; signed in as the engine test store's admin, from the console on `staging.khatario.com`):
  1. `fetch('/api/settings/online-store/themes').then(r=>r.json())` lists themes. The working draft row has `has_changes`.
  2. POST `/api/settings/online-store/themes` with `{ "source": "migrated" }` → a draft named "… (from your store)".
  3. DELETE the working draft's id → 409 with "Use Discard changes instead".
- [ ] **Step 5:** Commit: "Publishing a theme from the library refreshes or keeps aside the editor's working copy so it can never put the old design back; the working copy can be reset but not deleted, a theme can be added from the store's current design, theme reads need settings permission, and an oversized migrated design falls back to Studio."

### Task 3: Version API, read-only version previews and Restore as draft

**Files:**
- Create:
  - `lib/store/engine/preview-target.ts`;
  - `lib/store/engine/preview-url.ts`;
  - `app/api/settings/online-store/themes/versions/route.ts`;
  - `app/api/settings/online-store/themes/versions/[vid]/restore/route.ts`;
  - `app/api/settings/online-store/themes/versions/[vid]/preview-link/route.ts`;
  - `tests/db/store-theme-versions-api.db.test.ts`.
- Modify:
  - `lib/store/engine/preview-token.ts`;
  - `lib/store/engine/load-theme.ts`;
  - `lib/store/engine/page-loader.ts`;
  - `lib/store/preview-store.ts`;
  - `lib/store/engine/versions-repo.ts` (`restoreVersion`);
  - `app/api/settings/online-store/themes/[id]/preview-link/route.ts` (uses `preview-url.ts`, no behaviour change).
- Test: extend `tests/lib/store/engine/preview-token.test.ts` and `tests/db/store-engine-load.db.test.ts`.

**Interfaces:**
- Produces:
  - `PREVIEW_TTL = { editor, share, version: 2 * 3600_000 }`.
  - `signVersionPreview(businessId, versionId, ttlMs, now?)`, `verifyVersionPreview(token, businessId, now?)`, and `verifyPreviewToken(token, businessId, now?): { kind: 'theme' | 'version'; id: string } | null` (D47).
  - `resolvePreviewTarget(businessId, previewId, pt): Promise<{ theme: ThemeRow; version: boolean } | null>`. It catches a missing secret and returns null.
  - `loadEngineTheme(...)` returns `{ theme, preview, demo?, version? }`.
  - `loadEnginePage`: `editor = preview && !demo && !version && editor === '1'`.
  - `resolveOfflineStoreForPreview` resolves for a theme or a version target.
  - `storePreviewUrl(request: NextRequest, subdomain: string, path: string, previewId: string, token: string): string`. This is the host, protocol and port logic moved out of today's preview-link route.
  - `restoreVersion(businessId, userId, versionId): Promise<RepoResult<ThemeRow>>` (D48).
  - **Routes:**
    - `GET /themes/versions` → `{ versions: ThemeVersionSummary[] }` (`settings` read);
    - `POST /themes/versions/[vid]/restore` → 201 `{ theme }`;
    - `POST /themes/versions/[vid]/preview-link` with `{ path? }` → `{ url, expires_at }`. The path is checked with `isPreviewPath`, and the route returns 409 when there is no store subdomain, like the theme route.
    - The writes need `settings` update. All need the plan gate. Non-uuid `vid` → 404.

- [ ] **Step 1: Write failing tests.**
  - `preview-token.test.ts`:
    - a version token verifies with `verifyVersionPreview` for its business and id;
    - `verifyThemePreview(versionToken)` is null, and `verifyVersionPreview(themeToken)` is null;
    - `verifyPreviewToken` returns the right kind for each;
    - another business gives null; expiry at `now + ttl + 1` gives null;
    - `PREVIEW_TTL.version === 2 * 3600_000` and `PREVIEW_TTL.share === 7 * 24 * 3600_000`.
  - `store-engine-load.db.test.ts`:
    1. a version token with `preview_theme = versionId` → `loadEngineTheme` returns the version's data with `version: true`, even though `store_engine` is false;
    2. `loadEnginePage(..., { editor: '1' })` for that version → `editor: false`;
    3. a version token with a *theme* id in `preview_theme` → null (and the reverse);
    4. a version token signed for another business → null;
    5. an **unlaunched** store (seeded offline the way the existing offline-preview case in this file does) resolves through `resolveOfflineStoreForPreview` with a version token, and not with a tampered one.
  - `store-theme-versions-api.db.test.ts` (mocks as in `store-themes-api.db.test.ts`):
    1. GET lists versions newest first with names, and no `data` or `published_by` keys;
    2. **restore** → 201 draft named "Restored: <name>" with the version's preset and data. The theme count goes up by 1, and the version count is unchanged;
    3. **restore at 20 themes** → 409 `limit`;
    4. **foreign version:** restore and preview-link with the other business's version id → 404;
    5. **preview-link:** the URL contains `preview_theme=<vid>`, and its `pt` verifies with `verifyVersionPreview` to `vid`. `expires_at` is about 2 h ahead;
    6. a bad `path` → 400; a non-uuid vid → 404;
    7. a body `published_by` / `business_id` is ignored or refused: the new theme's `updated_by` is the session user.
- [ ] **Step 2:** Run them: FAIL.
- [ ] **Step 3:** Implement. `load-theme.ts` and `preview-store.ts` both call `resolvePreviewTarget`; remove their duplicated verify-then-get code.
- [ ] **Step 4:** Run `npx jest tests/lib/store`, every engine DB file and `npx tsc --noEmit`: PASS.
- [ ] **Staging test steps** (console, engine test store, after one publish):
  1. GET `/api/settings/online-store/themes/versions` lists it with your name.
  2. POST `…/versions/<id>/preview-link` → open the URL. The storefront shows that version with the Preview badge. Adding `&editor=1` shows no outlines.
  3. POST `…/versions/<id>/restore` → a new draft "Restored: …".
- [ ] **Step 5:** Commit: "Version history API: list the store's publishes with date and author, open any version read-only through a two-hour signed link bound to the store and version, and restore one as a new draft."

### Task 4: Client-safe library helpers, fetch client and the backup sweep

**Files:**
- Create:
  - `lib/store/engine/library.ts`;
  - `components/store/library/api.ts`;
  - `tests/lib/store/engine/library.test.ts`.
- Modify:
  - `lib/store/engine/editor/save-queue.ts` (D51);
  - `app/(app)/settings/online-store/themes/[id]/editor/page.tsx` (calls `sweepBackups` without a list).
- Test: extend `tests/lib/store/engine/editor-save-queue.test.ts` and `tests/lib/store/engine/editor-ops-client-safe.test.ts`.

**Interfaces:**
- Produces (`library.ts`, client-safe, imports only types and `shared.ts`):
  - `PRESET_CHOICES: Array<{ preset: ThemePreset; label: string; description: string; canvas: string; accent: string }>`, in the order Studio, Quick, Premium Grocery, Khatario, Blank;
  - `MIGRATED_CHOICE = { label: 'Your current store design', description: 'A copy of how your store looks today' }`;
  - `splitLibrary(rows: ThemeListRow[]): { live: ThemeListRow | null; working: ThemeListRow | null; drafts: ThemeListRow[] }`, with drafts sorted by `updated_at` descending;
  - `themeActions(row, { canEdit: boolean }): Set<'customise'|'preview'|'duplicate'|'rename'|'publish'|'discard'|'delete'|'history'>` (the D39 table);
  - `canAddTheme(count: number): boolean` (`< ENGINE_LIMITS.themesPerBusiness`);
  - `formatPublishedAt(iso: string): string` (`en-IN`, `Asia/Kolkata`, for example "31 Oct 2026, 4:05 pm");
  - `authorLabel(name: string | null): string` ("Set up automatically" for null);
  - `relativeEdited(iso: string, now: number): string` ("just now", "5 min ago", "3 h ago", "2 days ago", else the date).
- Produces (`components/store/library/api.ts`, fetch only; business from the session, `business_id` sent as `studio2/api.ts` does):
  - `listThemes`;
  - `createTheme({ name?, preset?, source?, duplicateOf? })`;
  - `renameTheme(id, name)`;
  - `deleteTheme(id)`;
  - `resetWorkingDraft()`;
  - `listVersions()`;
  - `restoreVersion(vid)`;
  - `versionPreviewLink(vid, path = '/')`.

  Each throws `Error(serverMessage)` on failure. Publish, the theme preview link and `openWorkingDraft` are re-exported from `studio2/api.ts`.
- Produces (`save-queue.ts`):
  - backups are `{ data, base, savedAt }`;
  - `sweepBackups(storage, businessId, { keepThemeIds?: string[]; now: number; maxAgeMs?: number })`;
  - `hasBackup(storage, businessId, themeId): boolean`;
  - `sweepOtherBackups` is removed (its one caller moves to `sweepBackups`).

- [ ] **Step 1: Write failing tests.**
  - `library.test.ts`:
    - `PRESET_CHOICES` has the 5 presets once each, and its `canvas`/`accent` equal `PRESET_LOOK[p].canvas`/`.accent`. This needs `require` of `presets/look` inside the test only;
    - `splitLibrary` puts live first, separates W, sorts drafts, and returns `live: null` for an empty list;
    - `themeActions`:
      - live → no `delete`, `publish` or `discard`, but has `history`;
      - W with `has_changes: false` → no `publish`, `discard` or `delete`; W with `has_changes: true` → `publish` and `discard`, but never `delete`;
      - a draft → `delete` and `publish`;
      - `canEdit: false` → only `preview` and `history`;
    - `canAddTheme(19)` is true and `canAddTheme(20)` false;
    - `formatPublishedAt('2026-10-31T10:35:00.000Z')` is `'31 Oct 2026, 4:05 pm'`;
    - `authorLabel(null)` is `'Set up automatically'`;
    - `relativeEdited` boundaries.
  - `editor-save-queue.test.ts`, with a fake storage:
    - `sweepBackups` with `keepThemeIds: [A]` removes this business's B and keeps A and the other business's keys;
    - without a list it removes only keys older than 14 days and legacy keys;
    - a malformed JSON value is removed;
    - `hasBackup` is true only for a stored key;
    - the backup JSON written by `schedule()` has a numeric `savedAt`.
  - `editor-ops-client-safe.test.ts`: `library.ts` and `components/store/library/api.ts` load with `pg`, `sanitize-html` and `crypto` mocked to throw.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement. `library.ts` must not import `presets/look.ts`: copy the five hex pairs, and the test keeps them equal.
- [ ] **Step 4:** Run `npx jest tests/lib/store` and `npx tsc --noEmit`: PASS.
- [ ] **Staging test steps:**
  1. Edit a draft offline (DevTools → Network → Offline), then close the tab.
  2. Open a different draft of the same store in the editor, then reopen the first. The "unsaved changes" banner still offers the edits.
- [ ] **Step 5:** Commit: "Shared rules for the theme library (which actions each theme gets, preset choices, dates and authors) and its fetch helpers; unsaved editor backups are no longer swept when you open another theme of the same store, only when that theme is gone or the backup is two weeks old."

### Task 5: The theme library page and its entry from Online store settings

**Files:**
- Create:
  - `app/(app)/settings/online-store/themes/page.tsx`;
  - `components/store/library/{ThemeLibrary,ThemeRowCard,AddThemeModal,ConfirmDialog,RenameDialog}.tsx`;
  - `e2e/store-theme-library.spec.ts` (scenarios written, not run).
- Modify: `app/(app)/settings/online-store/page.tsx` (the D52 "Themes (beta)" link).

**Interfaces:**
- Consumes: Task 4 (`library.ts`, `library/api.ts`), `studio2/api.ts` (`publishTheme`, `previewLink`, `openWorkingDraft`, `editorPath`), `usePermissions` (`canView('settings')`, `canModify('settings')`, `isPrimaryAdmin`; no user yet means loading, the N1 rule), `useAuth`, the app's toast hook (the one Studio 2 uses).
- Produces: `<ThemeLibrary businessId canEdit storeEngine onOpenHistory? />` (the history prop is filled in Task 6).
- **Behaviour (D39, D42, D43, D52):**
  - **Load:**
    - the list, and `GET /api/settings/online-store` (only `store_engine` is read);
    - `sweepBackups(storage, businessId, { keepThemeIds, now: Date.now() })`;
    - the D51 badge from `hasBackup`.
  - **Customise:**
    - on the live card, or on W: `openWorkingDraft` → `router.push(editorPath(id))`;
    - on a draft: `router.push(editorPath(id))`.
  - **Preview link:** `previewLink(businessId, id, 'share', '/')` → clipboard → toast "Preview link copied (works for 7 days)".
  - **Duplicate:** `createTheme({ duplicateOf })`. The new row appears at the top of the drafts.
  - **Rename:** a dialog with a 1–60 character input; the server's error is shown inline.
  - **Publish:** a confirm, "Publish '<name>'? Shoppers will see it now." When `store_engine` is off, it adds the D52 sentence. Then the list reloads.
  - **Discard changes:** a confirm, "Discard unpublished changes? Your working copy goes back to the live theme." → `resetWorkingDraft`.
  - **Delete:** the D42 confirm → `deleteTheme`.
  - **Add theme:** the modal with six choices and a name field, disabled at 20 (D43).
  - **Errors and buttons:** any action error is a toast with the server's message. Buttons are disabled while their request runs, so a double click cannot create two themes.
  - **Layout:**
    - works from 360 px up: cards stack, and actions go into a "⋯" menu below 640 px;
    - the editor link is hidden below 1024 px, with "Open the editor on a laptop or desktop" (the editor refuses narrow screens anyway).

- [ ] **Step 1: Write the e2e scenarios** (not run) in `e2e/store-theme-library.spec.ts`, reusing the login and store setup from `e2e/store-studio2.spec.ts`:
  - "library shows live card and working copy";
  - "add Grocery theme, rename, duplicate, delete the copy";
  - "publish a draft then customise keeps the published design" (N2);
  - "working copy has no Delete";
  - "add from current store design".
- [ ] **Step 2:** Implement the page and components. Keep display rules in `library.ts`, not in the components.
- [ ] **Step 3:** Run `npx jest tests/lib/store` and `npx tsc --noEmit`: PASS. Do not run the e2e spec or a dev server.
- [ ] **Staging test steps** (engine test store, `store_engine` on, admin):
  1. Settings → Online store → "Themes (beta)" opens the library. It shows the live card with "Working copy" when one exists, and "N of 20 themes".
  2. Add theme → Premium Grocery, named "Green test". It appears at the top of the drafts, labelled Premium Grocery.
  3. Rename it to "Green 2". Duplicate it, which gives "Copy of Green 2". Delete the copy: the confirm names it, and after Delete it is gone.
  4. Preview link on "Green 2" → paste it in a private window. The Grocery look shows, with the Preview badge.
  5. Publish "Green 2". It becomes the live card, and the old live theme is now a draft.
  6. Customise → the editor opens with the Green 2 design, not the old one (N2). Change a heading, go back to the library, and the working copy shows Publish and Discard changes.
  7. Discard changes → confirm → the working copy no longer shows Publish.
  8. The working copy has no Delete in any menu.
  9. Add theme → "Your current store design" → a draft "… (from your store)".
  10. As a staff user with settings view but not modify: only Preview link and History show.
  11. On a phone (390 px): cards stack, the ⋯ menu works, and Customise says to use a laptop.
  12. With `store_engine` off on another test store: the library shows the classic-store notice.
- [ ] **Step 4:** Commit: "Theme library page: see the live theme, its working copy and drafts, and customise, copy a 7-day preview link, duplicate, rename, publish, discard changes or delete a draft, or add a theme from any preset or your current store design; reachable from Online store settings."

### Task 6: Version history drawer in the library and in Studio 2

**Files:**
- Create: `components/store/library/VersionHistoryDrawer.tsx`.
- Modify:
  - `components/store/library/ThemeLibrary.tsx` (History on the live card opens the drawer);
  - `components/store/studio2/TopBar.tsx` (Back → "Themes", linking to `/settings/online-store/themes`; a new History button);
  - `components/store/studio2/Studio2Editor.tsx` (drawer state; restore flow);
  - `e2e/store-theme-library.spec.ts` (two scenarios, not run).

**Interfaces:**
- Produces: `<VersionHistoryDrawer open onClose canEdit onRestored(theme: ThemeRow) />`. It is a right-side drawer, full width below 640 px, with focus trapped and closed by Escape.
  - **On open:** it calls `listVersions()` and shows a spinner, then an empty state: "No publishes yet. Each time you publish, a version is saved here (the newest 30 are kept)."
  - **Each row:**
    - `formatPublishedAt(published_at)`;
    - `theme_name`, plus "(deleted)" when `!theme_exists`;
    - "by " + `authorLabel(published_by_name)`;
    - "Latest" on the first row.
  - **Preview:** it opens a blank tab synchronously in the click handler (so popup blockers allow it), then sets its location to `versionPreviewLink(vid)`. On failure it closes the tab and shows a toast.
  - **Restore as draft** (`canEdit` only) → `restoreVersion(vid)` → `onRestored(theme)` and the toast "Restored as '<name>'". A `limit` error shows the server text.
- **In the library,** `onRestored` reloads the list and highlights the new row for 3 s.
- **In Studio 2,** `onRestored` shows a toast with an "Open" action. "Open" flushes the save queue (as publish does) and then `router.push(editorPath(theme.id))`. With a failed flush it shows "Save your changes before leaving" and stays.
- **TopBar Props** gain `onHistory(): void`. The History button sits next to Preview, using the lucide `History` icon, labelled "History".

- [ ] **Step 1:** Add e2e scenarios (not run): "history lists a publish with author, preview opens read-only"; "restore as draft from the editor opens the restored draft".
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Run `npx jest tests/lib/store` and `npx tsc --noEmit`: PASS.
- [ ] **Staging test steps:**
  1. In the library, History on the live card lists the Task 5 publish of "Green 2" with today's date and your name, marked Latest. The migrated first version, if any, shows "Set up automatically".
  2. Preview on an older version opens a new tab showing that design with the Preview badge. Clicking around the store keeps the version, and there are no editor outlines.
  3. Restore as draft → toast "Restored as 'Restored: …'", and the new draft is highlighted in the list.
  4. In Studio 2, the top bar reads "Themes" (it opens the library) and has History. Restore there → Open → the editor shows the restored draft.
  5. Delete a draft that was once live. Its versions still show, marked "(deleted)", and Restore still works.
  6. After many publishes, the list never shows more than 30.
- [ ] **Step 4:** Commit: "Version history drawer in the theme library and the editor: every publish with date and author, a read-only preview of any version, and Restore as draft; the editor's Back now opens the theme library."

### Task 7: The editor when another tab deletes, publishes or resets its theme

**Files:**
- Modify:
  - `lib/store/engine/editor/save-queue.ts` (`gone`);
  - `lib/store/engine/editor/shell.ts` (`remoteThemeState`, labels);
  - `components/store/studio2/Studio2Editor.tsx`;
  - `components/store/studio2/PageSettings.tsx` (M3 Minor 5);
  - `app/(app)/settings/online-store/themes/[id]/editor/page.tsx` (404 text and the "Back to themes" link);
  - `components/store/studio2/api.ts` (`fetchTheme` throws a typed `ThemeGoneError` on 404).
- Test: extend `tests/lib/store/engine/editor-save-queue.test.ts` and `tests/lib/store/engine/editor-shell.test.ts`.

**Interfaces:**
- Produces:
  - `SaveStatus` gains `'gone'`. A PUT 404 with `code === 'not_found'` sets `stopped = 'gone'`, keeps `queued` and the backup, and releases the waiters. `retry()` does nothing once stopped.
  - `saveStatusLabel('gone')` is `'Not saved'`.
  - `remoteThemeState(local: { updatedAt: string; status: SaveStatus }, remote: { role: ThemeRole; updated_at: string } | null): 'same' | 'gone' | 'live' | 'changed'` (D50).
  - `class ThemeGoneError extends Error`.
- **Studio2Editor:**
  - On `gone`: the toast from D50, then `goToWorkingDraft(true)`.
    - When the gone theme is the working draft (it cannot be deleted, but it can be detached and then deleted), `openWorkingDraft` returns a new W, and the carry still applies.
  - **Visibility re-check (D50):**
    - throttled to once per 10 s;
    - skipped while leaving or while the queue is not `saved`/`pending`;
    - a network failure is ignored;
    - `live` and `gone` run `goToWorkingDraft(true)`; `changed` shows the existing conflict banner. The queue gets `markConflict()`, a new public method that sets `stopped = 'conflict'` and the status.
  - PageSettings gets `readOnly`, which disables its inputs and "Delete page". `onDelete` does nothing when `apply` returned null.

- [ ] **Step 1: Write failing tests.**
  - `editor-save-queue.test.ts`:
    - a PUT answering `{ status: 404, body: { code: 'not_found' } }` → status `gone`, `flush()` resolves, and the backup still holds the data;
    - a later `schedule()` does not PUT, and `retry()` does not PUT;
    - a 404 without a code is still `error` (unchanged);
    - `markConflict()` → status `conflict`, and no further PUT.
  - `editor-shell.test.ts`:
    - `remoteThemeState` returns `gone` for null, `live` for role live, and `changed` for a different `updated_at` while `saved`;
    - it returns `same` for a different `updated_at` while `pending` or `saving`, because our own save is in flight;
    - it returns `same` for an equal `updated_at`;
    - `saveStatusLabel('gone')` is `'Not saved'`.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx jest tests/lib/store` and `npx tsc --noEmit`: PASS.
- [ ] **Staging test steps** (two tabs on the same store):
  1. Tab A: open draft "Green 3" in the editor and change a heading. Tab B: delete "Green 3" in the library. Tab A: change another heading. A toast says it was deleted; the editor moves to the working copy and offers "Keep my changes".
  2. Tab A: editor on draft X, idle. Tab B: publish X. Switch back to tab A: it moves to the working copy (X is live).
  3. Tab A: editor on the working copy, idle. Tab B: Discard changes. Switch back to tab A: "This theme changed in another tab. Reload".
  4. Open an editor URL for a deleted theme: "This theme no longer exists." with "Back to themes".
  5. While publishing, the page settings inputs are disabled.
- [ ] **Step 5:** Commit: "The editor notices when another tab deletes, publishes or resets its theme, even when idle: deleted edits move to the working copy for you to keep or discard, and page settings lock while the editor is leaving."

### Task 8: Carry-over: shared preview links on unlaunched stores and the Share block

**Files:**
- Modify:
  - `app/api/public/store/[subdomain]/offers/route.ts`;
  - `app/api/public/store/[subdomain]/search/suggest/route.ts`;
  - `components/store/engine/product/ProductBlocks.tsx`;
  - `lib/store/engine/links.ts` (a new pure `shareUrl(href: string): string`).
- Test: extend `tests/lib/store/engine/catalog-links.test.ts`; create `tests/lib/store/engine/public-preview-routes.test.ts`.

**Interfaces:**
- Produces:
  - `shareUrl(href)` returns `origin + pathname`, dropping any query and hash. An unparsable `href` gives `''`, and the block then hides Share.
  - Offers and search-suggest resolve the store with `storeForPublicApi(subdomain, searchParams)` (`td`, then an engine theme or version preview), exactly like items.

- [ ] **Step 1: Write failing tests.**
  - `catalog-links.test.ts`: `shareUrl('https://a.khatario.com/products/<uuid>?preview_theme=x&pt=y#r')` is `'https://a.khatario.com/products/<uuid>'`, and `shareUrl('nope')` is `''`.
  - `public-preview-routes.test.ts`: mock `@/lib/store/engine/preview-access` `storeForPublicApi` and the data functions. Both routes call it with the request's `URLSearchParams` and return 404 when it returns null. Read each route first; keep its response shape.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx jest tests/lib/store` and `npx tsc --noEmit`: PASS.
- [ ] **Staging test steps:**
  1. On a store that is not launched, open a 7-day preview link. The header search shows suggestions, and Offers shows discounted products.
  2. On a product page in a preview, Share (or copy, on desktop) gives a link without `preview_theme` or `pt`.
- [ ] **Step 5:** Commit: "Preview links of a store that is not launched yet now show offers and search suggestions, and the product Share button never shares a preview token."

### Task 9: M5 staging checklist and project log

**Files:**
- Create: `docs/superpowers/plans/2026-10-31-store-engine-m5-staging-checklist.md`.
- Modify: `docs/project.log.md` (append only).

**Interfaces:**
- Consumes: the staging test steps of Tasks 1–8.

- [ ] **Step 1: Write the checklist**, in the M4 checklist's format.
  - **Before deploying (owner approval required):**
    - migrations 448/449, 450, 453 **and 454**, in that order, on staging;
    - M5's code must not reach staging before 454 runs, because publish writes `preset` and `theme_name`;
    - no script runs.
  - **One section per task**, with that task's staging steps, in order. Task 5's publish is the input for Task 6.
  - **"Two tabs" section:** Task 7.
  - **"Known limits":**
    - version previews last 2 hours;
    - the spec's per-theme versions route is replaced by the business timeline (D45);
    - the working copy cannot be deleted, only discarded (D42);
    - the deferred carry-over items listed in D54.
- [ ] **Step 2: Append the M5 entry to `docs/project.log.md`** (Asked / Decided / Shipped / Open, as the M4 entry).
  - Record D39–D54, migration 454 (test DB only), and the commits.
  - `docs/project.log.md` has another session's unstaged edits. Stage only the new entry:
    1. build the blob from `git show HEAD:docs/project.log.md` plus the entry;
    2. `git hash-object -w`;
    3. `git update-index --cacheinfo`.
  - Stage the checklist by path.
- [ ] **Step 3:** Commit: "Log store theme engine M5 (theme library and version history) and list what to check on staging, including migration 454 before the deploy."
