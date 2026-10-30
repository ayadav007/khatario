# Store engine M2: items carried into M3 and M5

From the M2 final review (item M5, the Home-only contract list, plus the parked M2 and M4) and the re-review of its fix wave (N1-N5, all minor). The M3 plan must address the M5 list; N2 belongs to M5 (theme library).

## Final review M2. The localStorage backup is written synchronously on every keystroke
`save-queue.ts:69` and `:191-200`: `JSON.stringify` of the whole theme plus `setItem` per `schedule()`.
- A theme near the 512 KB cap, for example one with Custom HTML, adds milliseconds of main-thread work per key.
- Fix: write the backup on the debounce tick and on `visibilitychange` or `pagehide`, not on every call.

## Final review M3. A section that once threw keeps showing the failed card after the merchant fixes it
`components/store/engine/SectionBoundary.tsx:30-47` with `SectionFrame.tsx:63`.
- `failed` is never reset, and the instance survives `router.refresh()` because it has the same key and position.
- Scenario: a setting makes a client section throw. The merchant undoes it, but the red card stays until a full reload.
- Fix: pass a reset key, such as a hash of `section.settings` or the refresh rev, and reset in `componentDidUpdate`.

## Final review M4. "+" in the preview inserts at the server's order, not the editor's
- `EditorBridge.tsx:111-114` (`data-section-index` from the last rendered save) → `Studio2Editor.tsx:309-311` → `addSection(..., index)` on `history.present`.
- Scenario: the merchant drags a section (its save is in flight, or offline) and clicks "+" in the not-yet-refreshed preview. The new section lands one slot off.
- Fix: send the neighbour section id with `add-at` and resolve the index in the editor. Or ignore `add-at` while status is not `saved`.

## Final review M5. Things hard-coded to Home that M3 must change
- `Studio2Editor.tsx:35` and `:60`: `templateKey: 'home'` is a type literal and a const.
- `tree.ts:10`: the group title is "Home".
- `bridge.ts:14-18`: preview messages carry no template key. R4 lets ids repeat across templates, so after a page switch a late `select` or `add-at` from the old frame would act on a same-id section of the new template. Add `template` to `ready`, `select` and `add-at`, and drop mismatches.
- `app/api/settings/online-store/themes/[id]/preview-link/route.ts:45`: the URL is always `/`. It needs a path for product, catalog and pages.
- `lib/store/engine/home-page.ts:52`: `editor` is computed only in the home loader.
- `fields.ts:91-97`: link options are Home and categories only, with no product or page links.


## Re-review N1 (Minor). The "You can't edit the store design" notice flashes on a hard load
- **Where:**
  - `hooks/usePermissions.ts:139-144`: when `user` is null, `loading` becomes false and is never set back to true when the user arrives.
  - `AuthContext` starts with `user = null`.
  - The (app) layout (`WebAccessGate`, `ModuleShellGuard`) renders children before auth has loaded.
- **Scenario:**
  1. A staff member with `settings` modify permission reloads the editor URL.
  2. Before auth resolves, `canEdit === false`, so the page shows "You can't edit … Ask an admin" with a Back link.
  3. That stays until `/api/settings/permissions` returns, and then the editor loads.
  4. A primary admin sees it only until `user` loads.
- **Effect:** it corrects itself, but it is misleading, and a click on Back during the flash leaves the page.
- **Fix:** treat `!user?.id` as loading (`canEdit = permissionsLoading || !user?.id ? null : …`).

## Re-review N2 (Minor). R11 publish can overwrite a library theme with a stale working draft (seam for M5)
- **Where:** `themes-repo.ts` publish. The copy path copies only `data` onto whatever row is live. A non-working-draft publish (swap) leaves the existing working draft W holding the *old* live data.
- **Scenario (needs M5's library or the API):**
  1. Theme X is published from the library. The old live row is demoted, and W stays `is_working` with the old design.
  2. The merchant opens Customise, which gives W, not a copy of X, and clicks Publish.
  3. X's row is overwritten in place with W's data. X keeps its own name and preset, so the name and preset no longer match the data.
  4. X's design survives only in `store_theme_versions`.
- **Before R11:** W itself became live and X was demoted intact.
- **Fix in M5:** when a non-working draft goes live, re-copy the new live data into W, or clear `is_working` on W. Optionally copy `preset` too.

## Re-review N3 (Minor). The M6 sweep deletes other businesses' and other themes' unrecoverable backups
- **Where:** the editor `page.tsx` `sweepOtherBackups()`. The key `kh-theme-unsaved:<themeId>` carries no business id.
- **Scenario:**
  1. The user edits business A's working draft while offline, or after a conflict, so the backup is the only copy, and closes the tab.
  2. Later, in the same browser, they open business B's editor, or another theme of A in M5.
  3. A's backup is deleted, so its unsaved edits are lost without notice.
- **Rating:** Minor. It needs a multi-business user plus an unsaved backup. Edits in a conflict or offline state have already been shown as an error. This is known and accepted in the fix report.
- **Better fix:** sweep only keys whose backup is older than N days, or only keys for theme ids listed for the current business (themes list or `fetchTheme` 404).

## Re-review N4 (Minor). A late flush from a disposed queue can clobber the next editor's backup for the same theme
- **Where:** `save-queue.ts:130-138`. After dispose, a 200 calls `removeBackup()`, or `writeBackup(this.queued)`, on the shared key `kh-theme-unsaved:<id>`.
- **Scenario:**
  1. The width crosses 1024 px, or StrictMode remounts the editor for the same theme while the old queue's flush PUT is in flight.
  2. The user types in the new editor, so the new queue writes the backup.
  3. The old PUT then returns 200 and deletes the backup, or overwrites it with older data.
  4. If the new queue then hits a 409 (its base came from the pre-flush fetch, as in I1's variant), the conflict copy exists only until the next keystroke rewrites it. If the tab closes first, it is lost.
- **Rating:** Minor. The window is a single round trip, and any later keystroke rewrites the backup (`schedule` writes before the `stopped` check).

## Re-review N5 (Minor). `CheckedTextInput` rough edges
- **Where:** `SettingField.tsx` `CheckedTextInput`.
  - An invalid edit of a previously valid link leaves the *old* valid link stored and live, while the box shows the new text with the hint. The hint is honest, but "Saved" still shows.
  - The local `draft` shadows an undo or redo while focused, or while an invalid draft is shown.
  - For `video_url`, the hint "Use a full https:// address" is wrong for `https://m.youtube.com/...`, where the host is the problem.
- **Fix:** a per-rule hint, for example "Use a YouTube or Vimeo link". Reset `draft` when `value` changes from outside.

---

