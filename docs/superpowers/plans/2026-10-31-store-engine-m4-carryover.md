# Store theme engine M4: carry-over

Findings from the M4 final review (`1430209a..fbb140bd`) that were not fixed in the fix wave `9c19f04e`, plus residuals from the fix wave itself. Copied from the SDD workspace before it was deleted. `file:line` refer to the code as reviewed at `fbb140bd`; lines may have moved in `9c19f04e`.

Fixed in `9c19f04e` (not listed below): I1 (header survives a failed category query), I2 (`disc` narrows the engine home), `tmp-qa/` in `.gitignore`, parity redirect guard, `not_found` exit code, Khatario tagline, shared Grocery promo cards, Studio hero device filtering.

**Re-review:** no re-review file existed in the workspace when this was written, so there are no re-review residuals. The fix-wave report's own concerns are listed after the findings.

## Minor findings not fixed

1. **Khatario promo tiles ignore the device** (`lib/store/engine/migrate-packs.ts:155`). It takes `hero_slides` by raw index; the old code used the already device-filtered `heroSlides` (`StoreCatalogView.tsx:345-358`). Slides `[desktop A, mobile B, desktop C]` show tiles B and C on both devices after migration. Fix: filter by device before indexing, or warn.
2. **Grocery announcement colours and link target** (`lib/store/engine/migrate.ts:41`). Old text colour is `announcement_fg || rgba(255,255,255,0.88)` (`StoreGroceryChrome.tsx:32`); migrated is `chowkOnAccent(bg)`. External marquee links opened a new tab (`StoreGroceryChrome.tsx:46`), now the same tab. Fix: keep the old fallback, or list it as a warning.
3. **The script still loads `.env` and `.env.local`** (`lib/db.ts` `getPool`, called from `scripts/migrate-store-themes.mjs`). `DATABASE_URL` cannot come from them, but `DB_SSL` and `JWT_SECRET` can, so links signed by a local run fail on staging. Fix: turn dotenv off for the script, or document "run on the target server" (the checklist does).
4. **An oversized migrated theme blocks Studio 2 for that store** (`lib/store/engine/themes-repo.ts:91`, callers `:74`, `:176`). `insertMigratedLiveLocked` throws on `themeTooLarge`, so every POST and Studio 2 open fails with 500. Needs a crafted `store_theme`. Fix: fall back to the Studio preset and log a warning.
5. **The POST route always reads the migration input** (`app/api/settings/online-store/themes/route.ts:58`; `themes-repo.ts:74,90`). Two queries per theme create, and `migrateStoreTheme` runs even when a live theme already exists. Fix: check for a live theme first, under the lock.
6. **Nested pool reads while holding the advisory lock** (`themes-repo.ts:172`). Under a full pool this can stall until `connectionTimeoutMillis`. Fix: pass `client` through `migrationInputFor`.
7. **Import cycle `themes-repo.ts` <-> `migrate-runner.ts`.** Works because every use is at call time. Fix: move `migrationInputFor` and `MigrationInput` into their own module.
8. **Links on a `?engine=1` demo drop `engine=1`** (task 8). Harmless for the parity report; confusing by hand. Documented in the checklist. Fix: carry the flag in the demo's link builder.
9. **Category shelves run one product query per category** (`lib/store/engine/section-data.ts:228-232`), up to 12 per home view. Fix: M5 performance pass, one grouped query.
10. **Two dark-canvas thresholds** (`lib/store/engine/look.ts:66` uses `<= 0.42`; `root-class.ts:16` uses `< 0.4`). A canvas with luminance in (0.40, 0.42] gets light ink but no `is-dark`. Fix: one shared constant.
11. **Quick's engine header is not `QuickHeader`** (D29 scope). Missing: "Delivery in …" line, location and branch picker, menu chips row; Grocery's area picker (`StoreShell.tsx:425-426`) too. No migration warning lists it. Fix: M5, with a warning meanwhile.

## Fix-wave residuals (`9c19f04e` report)

- `/?disc=10` on the engine home does not scroll to the grid (the old store did). Same as `cat`.
- On Khatario homes the "Popular products" rail (`source: all`) is narrowed by `disc`, as it already is by `cat`.
- `catalogRedirect(true, …)` (filled catalog, `/?cat=X&disc=10`) still drops `disc` on the way to `/catalog/X` (`lib/store/engine/links.ts`). Not on any Offers path.
- The parity guard relies on Playwright routing redirected navigations (backed by a `request`-event and final-URL check). Never run; sub-frame navigations off-base (an embedded video) are aborted and render blank in a shot.
- Task 2 and 4 notes: the Category image block's `category` setting has no default (the picker fills it); `opacity-60` on a locked field also dims its info text; ESLint does not run on these paths with this repo's config, so the gate was jest plus tsc.
- Nothing has run in a browser; Playwright's Chromium on the staging machine is unchecked.

## M4 rulings (from progress.md)

- **R11, R12 (carried from M3, owner direction):** implementer per task, no local browser checks, no per-task review; one final whole-milestone review, one fix wave, a scoped re-review. Each task writes staging test steps instead of checking locally.
- **R14 (Task 5):** keep typed https menu links per D32, because the old store linked them. Cost: an off-store link survives migration, which the merchant typed.
- **R15 (final review):** the fix wave is I1, I2, plus the cheap minors: `tmp-qa/` in `.gitignore`, parity script refuses redirects off allowed hosts, `not_found` exits non-zero, Khatario preset gets the tagline line, Grocery promo cards shared from one place, Studio hero device filtering matches the old hero. Other minors are carried over (above).
- Task 4 settled: `phone_kit` is on by default for every preset, the merchant can switch it off, Quick is forced on.
- Task 9 (checklist and project log) was deferred until after the final review. The project log entry is separate; `docs/project.log.md` has another session's unstaged edits.
