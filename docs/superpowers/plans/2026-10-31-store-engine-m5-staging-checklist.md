# Store theme engine M5 (theme library and version history): staging test checklist

What to check on `https://staging.khatario.com` once M5 is deployed there. **Nothing in this list has ever been checked in a browser**: M5 was built under ruling R11 (no local browser checks, no per-task review). Migration 454 has only ever run on the disposable DB `kh_phase2_test`. Each task ended with a "staging test steps" list; this is those lists, shortened, plus the fix-wave checks (commit `2f2f623d`). Where a fix-wave ruling changed an earlier step, the step below is the updated one.

Range: `8b749698..2f2f623d` (Tasks 1 to 8 at `55d6492a`, `48f752ce`, `fb511c67`, `90e23a7f`, `0d083cdb`, `017fb18c`, `87888bc7`, `4ed1b45f`; fix wave `2f2f623d`). Nothing is pushed.

Engine pages show only with `store_engine` on, or with a share preview link. Keep `store_engine` off for every real store throughout. Use an engine test store with `store_engine` on, plus a second test store with it off (section 5).

## Before deploying (owner approval required)

**Migration `database/migrations/454_store_theme_versions_library.sql` must run on staging AFTER 450 and 453 and BEFORE the M5 code is deployed.** The owner runs migrations; agents never do.

If the code ships first:

- Every **publish fails** (500 "Failed to publish theme"): it writes the new `preset` and `theme_name` columns. The transaction rolls back, so no half state.
- The **first Customise fails** for a store with no live theme yet, and so does any `POST /themes` on such a store.
- **Version history is down**: the versions list, restore and version preview-link all hit the new columns.
- **Silent data loss**: deleting a draft that was once live still cascades through the old foreign key and deletes its published versions, with no error. 454 changes that key to `ON DELETE SET NULL`.
- Theme-token previews and the live storefront are unaffected.

Running 454 before the new code is safe: it is idempotent, and old inserts leave the new columns NULL, which the app treats as "use the theme's current name/preset".

Checklist:

- [ ] **The owner approves** the migration run.
- [ ] Migrations run on staging in this order: 450, 453, **454**. Confirm 450 and 453 are already applied before 454.
- [ ] Other pending migrations the same push carries (see `docs/project.log.md`) are run too, or the push is held.
- [ ] Only then deploy the M5 code.
- [ ] No script runs for M5.
- [ ] `store_engine` is off for every real store after deploy.
- [ ] Pick an engine test store and a merchant login with settings permission (`.env` staging E2E keys).

**Migration-number clash for whoever merges.** `origin/main` (`9e140ceb`) has `448_stock_transfer_delivery_challan.sql`; local has `448_store_product_page_reviews.sql`. The local tree also has an untracked `455_stock_transfer_delivery_challan.sql` from another session. 454 itself does not clash (origin/main has nothing above 448), but both 448 files must be sorted out, and the run order on staging checked, before anything is merged or deployed.

## 1. Migration 454 and first version (Task 1)

- [ ] Nothing visible on its own. Covered by the sections below.
- [ ] After 454, on the engine test store, the first Customise (or first `POST /themes`) on a store with no live theme still works (this is the 500 you get if 454 is missing).
- [ ] The migrated first version shows no author (R16: "Set up automatically" in the drawer, section 6), even when it was created from the app by a logged-in user.

## 2. Library API and publish (Task 2)

Use the console on `staging.khatario.com`, signed in as the engine test store's admin. Needs 454 and the M5 code.

- [ ] `fetch('/api/settings/online-store/themes').then(r=>r.json())` lists the themes; each row has `has_changes`. The working draft's is `false` until you edit in Studio 2, then `true`.
- [ ] `POST /api/settings/online-store/themes` with `{source:'migrated'}` gives 201 and a draft named "... (from your store)".
- [ ] `DELETE /themes/<working draft id>` gives 409 "This is the copy the editor works on. Use Discard changes instead."
- [ ] Edit in Studio 2, then `POST /themes/working-draft/reset`: the response has the working draft with `has_changes` `false`, and an open editor tab shows the changed-in-another-tab conflict.
- [ ] N2: with no edits in Studio 2, publish the "(from your store)" draft through `/themes/<id>/publish`. The list shows the working draft as "<that name> (editing)". Open Customise and publish: the live store keeps that design, not the old one.
- [ ] A user with neither settings view nor update: GET `/themes` gives 403. (A user with update but not view is allowed since the fix wave, see section 9.)

## 3. Version history API and previews (Task 3)

After at least one publish, in the console.

- [ ] `GET /themes/versions` lists publishes newest first. Your publish shows `published_by_name` as your name; the migrated first version shows `null`; no row has `data`.
- [ ] `POST /themes/versions/<id>/preview-link` with `{}` returns a URL and an `expires_at` about 2 h ahead. The URL shows that version with the Preview badge. With `&editor=1` added: no section outlines, no editor bridge.
- [ ] Change `preview_theme` in that URL to a theme id, keeping `pt`: the badge disappears (live store, or not found if unlaunched).
- [ ] `POST /themes/versions/<id>/restore` gives 201 and a draft named "Restored: ...". GET `/themes` shows it; the live theme is unchanged; GET `/versions` has the same count.

## 4. Offline backups (Task 4)

- [ ] Edit a draft with DevTools Network set to Offline, then close the tab.
- [ ] Open a different draft of the same store in the editor, then reopen the first: the "unsaved changes" banner still offers the edits.
- [ ] One-off effect: backups written before this deploy have no `savedAt` and are swept the first time the sweep runs.

## 5. Theme library page (Task 5)

Engine test store, `store_engine` on, admin. Task 5's publish is the input for Task 6.

- [ ] Settings, Online store, "Themes (beta)" opens the library: live card (with "Working copy" when one exists) and "N of 20 themes".
- [ ] Add theme, Premium Grocery, named "Green test": it appears first in Drafts, labelled Premium Grocery.
- [ ] Rename it to "Green 2". Duplicate it ("Copy of Green 2"). Delete the copy: the confirm names it, and it is gone afterwards.
- [ ] Preview link on "Green 2", pasted in a private window: Grocery look with the Preview badge.
- [ ] **Publish "Green 2"**: it becomes the live card, the old live theme is a draft. (Input for section 6.)
- [ ] Customise opens the editor with the Green 2 design, not the old one (N2). Change a heading, go back to the library: the working copy shows Publish and Discard changes.
- [ ] Discard changes, confirm: the working copy no longer shows Publish.
- [ ] The working copy has no Delete in any menu.
- [ ] Add theme, "Your current store design": a draft "... (from your store)".
- [ ] **View-only staff (settings view, not update), R17:** the library shows History on the live card only, **no Preview link anywhere** (a 7-day link exposes an unpublished design outside the team, so it needs update), plus the "Ask an admin" notice. This replaces the original step that expected Preview link to show.
- [ ] Phone (390 px): cards stack, the menu with three dots works, Customise says to use a laptop.
- [ ] A second store with `store_engine` off: the library shows the classic-store notice, and the Publish confirm adds it. (Known wording issue, carry-over M3: the confirm then reads oddly.)

## 6. Version history drawer and editor Back (Task 6)

After section 5's "Green 2" publish.

- [ ] History on the live card: the drawer lists the "Green 2" publish with today's date and "by <you>", marked Latest. A migrated first version shows "by Set up automatically". Escape closes it and focus returns to History.
- [ ] Preview on an older version opens a new tab on that design with the Preview badge. Clicking around keeps the version; no editor outlines (also with `&editor=1`).
- [ ] Restore as draft: toast "Restored as 'Restored: ...'", the drawer closes, the new draft is highlighted at the top of Drafts for about 3 s.
- [ ] Customise: the editor's first top-bar link reads "Themes" and opens the library; a History button sits next to Preview. History, Restore as draft, toast "Open": the editor opens the restored draft.
- [ ] With an unsaved edit and DevTools offline: Restore then Open shows "Save your changes before leaving" and the editor stays.
- [ ] Delete a draft that was once live: its versions still show, marked "(deleted)", and Restore still works. (This is what 454's foreign key change protects.)
- [ ] After many publishes the list never shows more than 30.
- [ ] View-only staff: the library shows only History on the live card; the drawer lists versions without Preview or Restore.
- [ ] Phone (390 px): the drawer covers the full width.
- [ ] With 20 themes, Restore toasts the server's limit text and the drawer stays open (by design).

## 7. Two tabs (Task 7, updated by the fix wave)

Two tabs on the same store.

- [ ] Tab A: draft "Green 3" in the editor, change a heading. Tab B: library, delete "Green 3". Tab A: change another heading. A toast says it was deleted in another tab; the editor moves to the working copy and offers "Keep my changes".
- [ ] Tab A: editor on draft X, idle ("Saved"). Tab B: publish X. Back in tab A (wait over 10 s since its last check): it moves to the working copy (X is live).
- [ ] Tab A: editor on the working copy, idle. Tab B: Discard changes. Tab A: "This theme changed in another tab. Reload to keep editing." The editor is now read-only (section 9).
- [ ] Open `/settings/online-store/themes/<deleted id>/editor`: "This theme no longer exists." with "Back to themes" opening the library.
- [ ] Custom page with nothing selected: click Publish; Title, SEO title, SEO description and "Delete page" are disabled while publishing.
- [ ] Tab A: working copy, idle. Tab B: publish another draft. Tab A: "changed in another tab", read-only.
- [ ] A user without settings update: the no-permission screen links "Back to themes".

## 8. Unlaunched-store previews: search, offers, share (Task 8)

On a store that is **not launched**.

- [ ] Open a 7-day preview link (library, Copy preview link). Type two or more letters in the header search: suggestions appear. Open Offers (quick-theme offers sheet): discounted coupons appear.
- [ ] Repeat with a version preview link (Version history, Preview).
- [ ] Remove `pt` from the URL, or change one character: the page and the APIs answer 404 / store not found.
- [ ] Product page in a preview: Share (copies on desktop, share sheet on mobile) gives `https://<sub>.khatario.com/products/<id>` with no `preview_theme`, `pt` or `td`. The recipient gets "store not found" on an unlaunched store (expected).
- [ ] Clicking a suggestion is covered by fix I1 in section 9.

## 9. Fix wave (commit 2f2f623d: I1, I2, M1, M2)

**I1, header search keeps the preview**

- [ ] Library, a draft, Copy preview link (store not launched). Open it, type "ri" in the header search, click "Rice 5 kg": the product page opens, still in the preview (URL keeps `preview_theme` and `pt`).
- [ ] Same with a version preview link: the product opens.
- [ ] In a preview, type a word and press Enter, and pick a category suggestion: the catalog opens with the preview params kept.

**I2, a stale backup cannot put an old design back**

- [ ] Tab A: editor on the working copy, everything Saved. Tab B: library, publish another draft X. Back in tab A within 10 s (or before the re-check), change a heading: "This theme changed in another tab. Reload to keep editing."; the section tree and settings are disabled; undo and redo do nothing.
- [ ] Click Reload: the editor shows X's design with a warn banner "Changes that hadn't saved on this device were made before this theme changed elsewhere, so they were not kept." and **no** Keep my changes. The library shows no unsaved badge on the working copy; the live theme stays X.
- [ ] Regression: edit, close the tab before the save (or go offline, edit, close); reopen: the edits are restored and saved ("Restored changes that hadn't saved").
- [ ] Known side effect: the page switcher and New page are disabled while the editor is read-only.

**M1, deleted-theme fallback**

- [ ] Tab A: editor on draft "Green 3", change a heading. Tab B: delete "Green 3". In tab A set DevTools Network to Offline, then change another heading: banner "This theme was deleted and your working copy couldn't be opened. Your unsaved changes are kept on this device and will be offered on your working copy." with **Try again** (not "This theme is now live").
- [ ] Back online, Try again: the editor moves to the working copy and offers Keep my changes / Discard.
- [ ] Repeat, but go to Themes instead: the working copy shows the unsaved badge; Customise offers Keep my changes / Discard. Opening the deleted theme's editor URL says its unsaved changes are kept and to open the working copy from Themes.

**M2, theme GET permission**

- [ ] Settings, Roles: a role with Settings "update" ticked and "view" unticked; sign in as that staff user. The library lists themes (no "Ask an admin" notice), Version history lists versions, and Customise opens the editor and loads the theme.
- [ ] A role with neither: the library shows the "Ask an admin" notice; GET `/themes` answers 403.

## 10. Permissions matrix (R17, M2)

Run on the library, Version history, the editor and the console. Expected results after the fix wave.

| Role | Library page | Add, rename, duplicate, delete, publish, discard, restore | Preview link (share, 7 days) | History drawer | Version preview link | Customise (editor) |
|---|---|---|---|---|---|---|
| Owner / primary admin | opens | allowed | shown | opens, with Preview and Restore | works | opens |
| Staff, settings update (with view) | opens | allowed | shown | opens, with Preview and Restore | works | opens |
| Staff, settings view only | opens, "Ask an admin" notice | hidden | **hidden** (R17); route refuses without update | opens, no Preview or Restore | hidden | no-permission screen |
| Staff, settings update, **no** view | opens (M2) | allowed | shown | opens, with Preview and Restore | works | opens (GETs accept read OR update) |
| Staff, neither | "Ask an admin" notice | n/a | n/a | n/a | n/a | no-permission screen; GET `/themes` 403 |

- [ ] Each row checked on staging (a role with update but not view must be created in Settings, Roles).
- [ ] Write routes (POST, PUT, PATCH, DELETE, publish, both preview-link routes, working-draft, reset, restore) answer 403 for the view-only row when called from the console.
- [ ] A body or query `business_id` that differs from the session business is refused 403.

## Known limits

Expected gaps, not bugs. Do not report them from staging.

- **Version previews last 2 hours.** Theme share links last 7 days.
- **The spec's per-theme versions route is replaced** by the business-wide timeline (D45).
- **The working copy cannot be deleted, only discarded** (D42).
- **The migrated first version has no author** (R16): the drawer says "Set up automatically".
- **View-only users cannot preview unpublished drafts at all** (R17, intended).
- **A conflicted editor is read-only** (R18). Only Reload continues. The page switcher and New page are disabled with it.
- **Outdated backups are dropped.** One rare loss: the browser closes while a save is in flight and the save lands; edits typed during that PUT (about a second) are lost, and the merchant is told.
- **A carried backup (base empty) is offered without a base check by design** (D50); its banner says Keep replaces the whole design.
- **A shared product link from an unlaunched store's preview 404s for the recipient** (the token is not shared).
- **The editor's error and no-permission screens may still say "Back to Online store"** in places (Task 5 note).
- **Deferred minors (D54 and carry-over):** see `docs/superpowers/plans/2026-10-31-store-engine-m5-carryover.md`.
