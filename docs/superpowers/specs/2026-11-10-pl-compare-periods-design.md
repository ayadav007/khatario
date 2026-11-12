# Compare periods on the Profit & Loss: design

Date: 2026-11-10. Status: written for owner review, nothing built.

## 1. What the owner asked, and what is assumed

Said by the owner:

- "we want people to be able to compare two period's P&L. i think Tally has this feature".
- Earlier in the same work: "make sure we are not changing anything in our current p&L report".

Assumed, and open to correction:

- The comparison uses the Standard layout (sections, gross profit, operating profit, net profit), because that is the report people read every day. The Schedule III tab already shows the previous year.
- "Two periods" is the main case. Up to three earlier periods are allowed when they follow a pattern (previous months, previous years), as Zoho Books and Tally allow.
- People want to see the change between the two periods in rupees and in per cent, not only the two amounts.
- It is a screen first. PDF and Excel come later.

Success means: a user picks a period, picks what to compare it with, and sees both side by side with the change; every figure in a column equals what the Standard tab shows for those dates.

## 2. What other products do

- **Tally:** side-by-side columns in the same statement. "Auto Column" repeats the report monthly, quarterly and so on; "New Column" adds one column with its own settings. A variance column is documented for budgets and scenarios; none was found for plain periods.
- **Zoho Books:** a "Compare With" setting on the report: previous periods or previous years, with a number of periods. Users have asked for amount and percentage change columns.

## 3. Approaches considered

| | Approach | Verdict |
|---|---|---|
| A | A third tab, "Compare", with its own page and API. The API runs the existing report builder once per period and lines the results up. | **Chosen.** The Standard report is not edited, and each column is the Standard report's own output, so the two cannot disagree. |
| B | A "Compare with" control on the Standard page, as Zoho has. | Rejected. It means editing the page and API the owner wants left alone. |
| C | Tally-style automatic columns first (monthly, quarterly, any number of columns). | Later. The stated need is two periods. Approach A's API already takes a list of periods, so automatic columns can be added without changing it. |

## 4. The screen

Path: `/reports/profit-loss/compare`. Tabs above the report become **Standard | Schedule III | Compare**.

Controls:

- **Period:** From and To, with the same defaults as the Standard tab (start of the financial year to today).
- **Compare with:** one of
  - `Previous period`
  - `Same period last year`
  - `Custom period` (shows a second From and To)

  The tab opens on `Same period last year` (owner's choice, 2026-11-10). With the default dates, `Previous period` would compare 1 Apr – today with a stretch that straddles the previous year end.
- **Number of periods:** 1, 2 or 3. Shown for the first two choices only; a custom period is always one.
- `Show accounts with no transactions` and `Hide sub-accounts`, as on the Standard tab.

Table:

| Column | Shown |
|---|---|
| Account | Always |
| The chosen period | Always, first |
| Each compared period | Most recent first |
| Change (₹) | Only when exactly two periods are shown |
| Change (%) | Only when exactly two periods are shown |

- Column headings are the dates, for example `1 Apr 2026 – 30 Sep 2026`.
- Rows are the Standard report's rows in the same order: Operating Income, Cost of Goods Sold, **Gross Profit**, Operating Expense, **Operating Profit**, Non Operating Income, Non Operating Expense, **Net Profit/Loss**, then Key figures (Profit Before Tax, EBIT, EBITDA). Accounts sit under their section, sub-accounts indented, with a total per section.
- An account is listed when it has an amount in any shown period. A period where it has none shows `–`.
- On periodic books, Opening Stock, Purchases and Closing Stock appear in Cost of Goods Sold for each period.
- Clicking an amount opens the existing drill-down panel for that account and that column's dates.
- Sections collapse and expand; one Expand all / Collapse all control.
- Phone width: the table scrolls sideways inside its card.
- The comparison loads 0.4 seconds after the last change to a control, and not at all while a date is incomplete. A failure other than "no access" is shown in place of the table, with the controls still on screen.

Change columns:

- Change (₹) = chosen period − compared period.
- Change (%) = Change (₹) ÷ the compared period's amount (ignoring its sign) × 100, to one decimal. It shows `–` when the compared amount is nil.
- Both are shown for every row, including the profit rows.
- No green or red for "good" or "bad": a higher expense and a higher income are both simply higher. Negative numbers are red, as elsewhere.

Under the table:

- A note for any period that crosses 31 March: `<dates> crosses a financial year end. Its opening stock and purchases belong to different years, so treat it as a management figure.`
- A note for any period whose total does not agree with the ledger: `<dates> differs from the ledger by ₹<amount>. Please report this.`
- On periodic books, a note for any period whose closing stock does not come from a year-end snapshot, with the Standard tab's wording for that warning.
- When inter-branch accounts were eliminated: `Inter-branch sales and purchases are eliminated in the consolidated view.` and, when the two sides differ in any shown period, ` A difference between the two sides stays in net profit.` (The Standard tab also names the amount; with several periods there is no single amount to name.)
- `Each column is the Standard Profit & Loss for those dates.`

## 5. Which dates "Previous period" and "Same period last year" mean

**Previous period** (repeated for 2 or 3 periods):

- When the chosen period starts on the first day of a month and ends on the last day of a month, step back by that many whole months. April–June gives January–March; a full financial year gives the financial year before; September gives August.
- Otherwise step back by the number of days in the period. 1–15 October gives 16–30 September.

**Same period last year** (repeated for 2 or 3 years):

- The same day and month one year earlier.
- A date that is the last day of its month maps to the last day of that month in the earlier year, so a period ending 28 Feb 2025 compares with one ending 29 Feb 2024.

**Custom period:** any From and To with From not after To. It may overlap the chosen period.

## 6. How it is built

| Piece | Responsibility | Depends on |
|---|---|---|
| `lib/reports/profit-loss-compare.ts` (new, pure) | The date rules of section 5; lining up several reports by account; the change figures | Types from `lib/reports/profit-loss.ts` |
| `app/api/reports/profit-loss/compare/route.ts` (new) | Checks access, works out the periods, runs the existing builder once per period, returns the lined-up result | `resolvePlRequestScope`, `buildProfitAndLoss` |
| `app/(app)/reports/profit-loss/compare/page.tsx` (new) | The screen of section 4 | The API; the existing drill-down panel |
| `components/reports/ProfitLossTabs.tsx` (changed) | Adds the third tab | — |
| `lib/mobile-route-title.ts`, `lib/breadcrumb-utils.ts`, `e2e/routes.json` (changed) | Register the page | — |

Rules:

- **No new accounting.** Every column is `buildProfitAndLoss` for that period, the function behind the Standard tab, called with the same branch and consolidation settings. The compare code only arranges its output.
- **Lining up:** accounts are matched across periods by account id. Each period is built with zero-amount accounts included so the trees have the same shape; rows that are nil in every shown period are then dropped unless `Show accounts with no transactions` is on. A sub-account sits under its parent whenever any period shows it there (an inactive parent is absent from a period in which it has no entries). A parent's "Total for" figure in each period is its own amount plus its sub-accounts' totals in the lined-up tree; section totals and profits are still the builder's own. (Amended after the final review.)
- **Access:** the same checks as the Standard report, through `resolvePlRequestScope` (reports module, `report.financial` read, advanced reports plan, branch access). Business and user come from the session. The new paths sit under the existing `/reports/profit-loss` and `/api/reports/profit-loss` plan prefixes.
- **Request:** `from_date`, `to_date`, `compare` (`previous_period`, `previous_year` or `custom`), `count` (1–3), `compare_from`, `compare_to`, `include_zero`.
- **Bad input:** a date that is not `YYYY-MM-DD`, From after To, an unknown `compare`, a `count` outside 1–3, a missing custom date, or any date before the year 1900 (typed or worked out for a compared period) returns 400 with a plain message. No more than four periods are ever built.
- **Failure:** if any one period fails to build, the whole request fails; a half-filled comparison is worse than none. On periodic books this includes a period whose stock schedule could not be worked out when the others could.
- **Speed:** each period is one run of the builder. Two to four runs per request is expected to be acceptable but has not been measured; check on staging with the largest business. If it is slow, the later fix is one grouped query for all periods.

Depends on the Schedule III change being committed first: it supplies the tabs, the layout file and `resolvePlRequestScope`.

Files of the Standard report are not edited: `lib/reports/profit-loss.ts`, `lib/accounting/pl-sections.ts`, `app/api/reports/profit-loss/route.ts` and its PDF, Excel and drill-down routes, `app/(app)/reports/profit-loss/page.tsx`, `components/reports/ProfitLossDrilldownPanel.tsx`, `lib/export/profit-loss-excel.ts`, `templates/reports/profit_loss/**`.

## 7. Tests

- **Date rules (unit):** whole-month stepping (quarter, full year, single month, a period ending in February), day stepping, leap years, three steps back.
- **Lining up (unit):** an account present in only one period; a sub-account under a parent; a section with nothing in one period; rows nil everywhere dropped, and kept when asked.
- **Change (unit):** rupee and per cent change, a nil compared amount, a negative compared amount, a profit that turns into a loss.
- **API (real database, `kh_phase2_test`):** for a seeded business, each column's section totals and three profit figures equal the Standard API's response for the same dates; no session returns 400; each bad input returns 400.
- **Staging:** the checklist in the implementation plan, including phone width and the drill-down from a compared column.

## 8. Not in this piece of work

- PDF and Excel of the comparison.
- Automatic columns (monthly, quarterly) and more than four periods.
- Comparison in the Schedule III layout.
- Branches or businesses side by side.
- Budget against actual.
- Saving a comparison for reuse.
- The Flutter phone app.

## 9. Choices the owner may want to change

- The tab is called `Compare`.
- Change columns appear only with two periods. With three or four, only the amounts are shown.
- Change (%) is measured against the compared (earlier) period.
- A custom comparison is one period, not several.
- The change columns carry no good-or-bad colour.
