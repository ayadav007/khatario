# Store theme engine M5: carry-over

Findings from the M5 final review (`8b749698..4ed1b45f`) that were not fixed in the fix wave `2f2f623d`, plus residuals from the fix wave itself. Copied from the SDD workspace (`.superpowers/sdd/2026-10-31-store-engine-m5-library-history/`). **`file:line` refer to the code as reviewed at `4ed1b45f`**; lines have moved in `2f2f623d`, especially in `Studio2Editor.tsx`, `save-queue.ts`, `shell.ts`, `HeaderSearch.tsx`, `library.ts` and the theme routes.

Fixed in `2f2f623d` (not listed below): I1 (header search keeps the preview), I2 (a conflicted editor is read-only and an outdated backup is never offered), M1 (wrong banner and early sweep after a delete), M2 (theme GETs accept settings read or update).

**Re-review:** no scoped re-review file existed in the workspace when this was written, so there are no re-review residuals. The fix-wave report's own concerns are listed after the findings.

## Minor findings not fixed

Numbered as in the final review (M1 and M2 were fixed).

3. **The publish confirm contradicts itself while `store_engine` is off** (`lib/store/engine/library.ts:180-181`). "Publish 'Green 2'? Shoppers will see it now. Shoppers still see your classic store...". Fix: a different first sentence when the engine is off ("Publish 'Green 2'?").
4. **Publishing another draft silently detaches the working copy's edits** (`components/store/library/ThemeLibrary.tsx:372-378`, `library.ts:179`). With "Unpublished changes" on the working copy, publishing draft X turns those edits into a draft "... (unpublished edits)" with no warning; an editor tab on the working copy reloads onto that detached draft with no notice. Fix: when `split.working?.has_changes`, add "Your working copy's unpublished changes will be kept as a separate draft." to the confirm.
5. **Rename bumps the optimistic-lock token** (`lib/store/engine/themes-repo.ts:340`, `updated_at = NOW()`). Renaming a draft in the library while it is open in Studio makes the next autosave fail with 409, and now the editor goes read-only. Pre-existing since M1; the library makes it one click. Fix: rename leaves `updated_at` alone, or the save lock compares data only.
6. **ConfirmDialog, RenameDialog and AddThemeModal have no focus trap** (`components/store/library/ConfirmDialog.tsx:24-38`, same pattern in `RenameDialog.tsx`, `AddThemeModal.tsx`). Tab leaves the dialog for the page behind. The drawer traps focus; reuse its handler.
7. **Focus is not returned after the drawer opened from the phone menu** (`VersionHistoryDrawer.tsx:76`, `ThemeRowCard.tsx:203-205`). The menu item is unmounted on click, so the captured element is `<body>`. Fix: close the menu after calling `onAction`, or focus the menu button first.
8. **Any 404 from the theme GET is treated as "deleted"** (`components/store/studio2/api.ts:39`). A proxy 404 during a deploy makes the visibility re-check toast "deleted in another tab" and move to the working copy (pending edits are carried, nothing lost). Fix: require the JSON `code: 'not_found'`, as the PUT path does.
9. **The library sweeps backups by the AuthContext business while the list comes from the session business** (`ThemeLibrary.tsx:89`). After a business switch in another tab, this tab's sweep keeps only business B's theme ids under A's prefix and deletes A's unsaved offline backups on this device. Fix: skip the sweep unless the listed rows' `business_id` equals `businessId`.
10. **"Open" on a restored draft is a dead end while the editor is in `conflict`** (`Studio2Editor.tsx:543`). "Save your changes before leaving", every time; only Reload helps. Note: after the fix wave a conflicted editor is read-only, so the message is more misleading still. Fix: allow leaving in `conflict` (edits are in the backup), or say "Reload first".
11. **A first live theme created without a settings row records no version** (`themes-repo.ts:197-215`, `insertThemeLocked` live branch, reached from `createThemeLocked` and the "Main" fallback in `insertWorkingDraft`). D49 wants the first live design restorable; here it is not until the next publish. Edge case (no settings row means no store). Fix: record a version when `insertThemeLocked` inserts `role='live'`.
12. **Public `Cache-Control` now applies to token-bearing suggest responses of unlaunched stores** (`app/api/public/store/[subdomain]/search/suggest/route.ts:23`). A shared cache may store a catalog response under a URL that contains a 7-day preview token. Low risk (holders of the URL only). Fix: `private, no-store` when `preview_theme`, `pt` or `td` is present.

## Notes from the review (not findings)

- 454's backfill gives pre-454 versions the theme's *current* name and preset (R11 versions point at the live row), not the name at publish time. Acceptable for old rows.
- A theme share token plus `&editor=1` still opens editor mode for that theme (pre-M5, theme tokens only); version tokens are correctly excluded.
- The M4-era migration numbering clash (448) does not affect 454. See the staging checklist.

## Fix-wave residuals (`2f2f623d` report)

1. **Dropping outdated backups drops one rare legitimate case:** the browser closed while a save was in flight and that save landed. Only edits typed during that PUT (about a second) are lost, and the merchant is told. Judged acceptable against resurrecting an old design.
2. **A carried backup (base `''`) is offered without a base check, by design (D50).** Its banner now says Keep replaces the whole design.
3. **The read-only conflict also disables the page switcher and New page** (the existing read-only mode does that).
4. **UI wiring is checked by source checks only** (jest is node-only). The staging steps cover it.
5. **No RED run was recorded for the fix wave:** the implementation was written alongside the tests. The new exports could not pass against the old code.
6. **The working tree has other sessions' uncommitted changes** (branches, warehouses, stock transfers, gst, project log); none were staged.

## Task-report concerns still open

- **Migrate script and businesses with no settings row (Task 2):** an explicit `--business` for such a business now reports `not_found` and exits 1.
- **Old DB tests that delete `store_themes` but not `store_theme_versions` (Task 1)** leave versions with a null `theme_id` until their `businesses` rows are deleted; deleting a business still cascades.
- **Pre-upgrade offline backups are swept once (Task 4):** backups without a numeric `savedAt` are removed the first time the sweep runs (moot while no engine store is live).
- **Task 7:** the "This theme no longer exists." screen uses red error styling (grey might suit it); the visibility handler and PageSettings change are not unit-tested.
- **Task 5/6:** the editor's error and no-permission screens may still say "Back to Online store". With 20 themes, Restore toasts the server's limit text and the drawer stays open (by design).
- **M4 residuals still open** are in `2026-10-31-store-engine-m4-carryover.md` (for example one product query per category, two dark-canvas thresholds, Quick's header). The M5 spec's "M5 performance pass" did not pick them up.

## M5 rulings (from progress.md)

- **R11, R12 (carried from M3):** implementer per task, no local browser checks, no per-task review; one final whole-milestone review, one fix wave, a scoped re-review. Each task writes staging test steps instead of checking locally.
- **R16 (Task 1):** the migrated first version always records a null author ("Set up automatically") - it is the store's existing design, not that user's publish. Carried into Task 2.
- **R17 (Task 5):** a 7-day share link exposes an unpublished design outside the team, so the preview-link route keeps `settings:update` and the Preview link button is hidden for view-only users. Carried into Task 6.
- **R18 (final review):** the fix wave is I1, I2 (a conflicted editor stops accepting edits and its backup cannot resurrect a design older than the server's; narrowest sound fix), M1 (wrong banner and lost edits when opening the working copy fails after a delete), M2 (theme GETs accept `settings:read` OR `settings:update`, since the role API can store update without view). Other minors are carried over (above).
- **Task 2 note:** GETs now need settings read (resolved by M2). After a library publish an open editor on the working copy gets 409 (handled in Task 7, tightened by I2).
- **Task 7 note:** the wrong banner after a failed open following a delete (resolved by M1).
- **Task 8 note:** HeaderSearch product pick dropped preview params (resolved by I1).
- Task 9 (checklist and project log) was deferred until after the final review. The project log entry is separate; `docs/project.log.md` has another session's unstaged edits.

## Re-review notes on the fix wave (2f2f623d), non-blocking
- The conflict banner does not warn that an unsaved edit will be dropped on Reload; the merchant learns it after, from the "were not kept" notice.
- Review minor M5 is still open: a library rename bumps `updated_at`, so a rename during a pending edit in another tab drops that edit (the merchant is told after reload).
- If a save is refused because the theme went live and opening the working copy then fails, the edits are not stored for later (same gap as M1, on the "now live" path).
- The other three notes are in the re-review file, now removed with the SDD workspace; they restate findings already listed above.
