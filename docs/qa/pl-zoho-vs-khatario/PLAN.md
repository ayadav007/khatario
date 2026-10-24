# Plan: make Khatario's Profit & Loss work like Zoho Books

Status: draft for review. Nothing in this plan has been built yet.

Evidence: [REPORT.md](./REPORT.md) is the 30-Sep-2026 test, with journal QA-PL-0930 posted in both systems.

## 1. Goal

For the same postings, Khatario's P&L should:

1. **Agree with its own ledger.** Net profit equals the sum of all income and expense postings for the period, and the balance sheet's current-year profit equals the P&L net profit.
2. **Use Zoho's sections:** Operating Income, Cost of Goods Sold, Gross Profit, Operating Expense, Operating Profit, Non Operating Income, Non Operating Expense, Net Profit. Like Zoho there is no separate Tax section (D7).
3. **Let the user choose the section for every account,** the way Zoho's account type does, instead of guessing it from group names and hard-coded account codes.
4. **Show a screen that adds up.** Every line on screen sums to the section total, and the totals produce the profits shown.

Out of scope: cash-basis P&L, comparison columns, budgets in the P&L, and Other Comprehensive Income. Zoho has all of these; they are listed as later phases in section 9.

## 2. What is wrong today (summary of the test)

| # | Problem | Where | Effect on the test day |
|---|---|---|---|
| P1 | "Indirect Expenses" matches `includes('direct')`, so indirect expenses are counted as cost of goods sold | `app/api/reports/profit-loss/route.ts` line 405 | Gross profit understated by 25,036 |
| P2 | Ledger depreciation (5204) is excluded from every section. The depreciation line comes only from the asset calculator, and only when `financial_year` is passed (the screen never passes it) | same file, lines 352–359 and 409 | 3,010 missing; P&L ≠ balance sheet |
| P3 | Inactive accounts are ignored by the P&L and the trial balance | P&L lines 210 and 227; `app/api/reports/trial-balance/route.ts` line 130; `app/api/reports/balance-sheet/route.ts` lines 141, 158, 174 | 3,015 missing; trial balance unbalanced |
| P4 | No non-operating income section; all income is above gross profit | P&L lines 477–482 and 448 | Gross profit inflated by 13,068 |
| P5 | Screen shows an Opening + Purchases − Closing block, but gross profit uses the direct-expense accounts, so the screen doesn't add up | `app/(app)/reports/profit-loss/page.tsx` lines 524–575 | About 43,000 unexplained on screen |
| P6 | Other Expenses and Tax are chosen only by hard-coded codes (5205–5209, 5210/5211). A custom account can never reach them | P&L lines 397–400 | Custom finance-cost accounts land in operating expense |
| P7 | Inter-branch 4103/5103 are kept in the all-branches view and removed in the single-branch view (backwards) | P&L lines 233–234 | Gross profit and expenses inflated in consolidated; branch P&L doesn't match the branch ledger |
| P8 | Sub-accounts are listed flat | P&L and page | Presentation only |
| P9 | A second, document-based P&L can disagree with the ledger P&L | `app/api/reports/expense/profit-loss/route.ts` | Two different "profit" numbers in the product |

Root cause: Khatario only stores `account_type` = income or expense. The P&L section is guessed afterwards from text and codes. Zoho stores the section as the account type: `income`, `other_income`, `cost_of_goods_sold`, `expense` or `other_expense`.

## 3. Design overview

Add one field per account, `accounts.pl_section`. Every P&L calculation reads only that field. Posting code is not affected: vouchers, account codes and existing ledger lines stay exactly as they are. Only reporting changes.

| `pl_section` | Zoho type | Report position | Allowed `account_type` |
|---|---|---|---|
| `operating_income` | income | Operating Income | income (or expense, for contra) |
| `cost_of_goods_sold` | cost_of_goods_sold | Cost of Goods Sold | expense (or income, for contra) |
| `operating_expense` | expense | Operating Expense | expense (or income, for contra) |
| `other_income` | other_income | Non Operating Income | income |
| `other_expense` | other_expense | Non Operating Expense (includes income tax, D7) | expense |
| `elimination` | — | Inter-branch; see phase 1 step 4 | income / expense |

Contra lines follow Zoho's sign rule. In income sections an amount is credit − debit; in cost and expense sections it is debit − credit. A contra account (for example Discount Received in Operating Expense) simply shows as a negative line, as Zoho shows Purchase Discounts.

Formulas, matching Zoho:

- Gross Profit = Operating Income − Cost of Goods Sold
- Operating Profit = Gross Profit − Operating Expense
- Net Profit = Operating Profit + Non Operating Income − Non Operating Expense

Invariant: Net Profit equals Σ(credit − debit) over every income and expense account for the period. That includes inactive accounts and excludes year-close vouchers. It must equal the balance sheet's current-year profit.

## 4. Decisions (decided 01-Oct-2026: "like Zoho")

| ID | Question | Decision |
|---|---|---|
| D1 | Can the user change `pl_section` on system accounts? | No. As in Zoho, system accounts keep their section; custom accounts can be changed. |
| D2 | Where do 4201 General Income and 4202 Interest Income go? | Operating Income (Zoho's General Income and Interest Income) |
| D3 | Where does 4102 Discount Received go? | Operating Expense, shown negative (Zoho's Purchase Discounts) |
| D4 | Where does 5207 Bad Debts go? | Operating Expense (Zoho's Bad Debt) |
| D5 | Where do 5208/5209 provisions go? | Operating Expense (Zoho's default for expense accounts) |
| D6 | Where does 5299 Round Off go? | Operating Income, signed (Zoho books rounding to Other Charges) |
| D7 | Keep the separate Tax section? | No. 5210/5211 go to Non Operating Expense, as Zoho has no tax section. The API still returns `tax` and `profit_before_tax` for existing consumers. |
| D8 | Periodic-inventory businesses | Zoho has no periodic inventory. The Opening + Purchases − Closing schedule is kept for periodic businesses, with the other cost-of-goods-sold accounts listed under it so the section adds up. Perpetual businesses show only ledger accounts, as in Zoho. |
| D9 | What happens to the document-based P&L (P9)? | Zoho has one P&L. The document-based report is relabelled "Sales vs purchases summary" and no longer called profit. |

## 5. Phases

### Phase 1: make the P&L agree with the ledger (small, ship first)

This phase fixes P1, P2, P3 and P7 without the new field, so the numbers are right immediately.

1. **P1:** classify Direct as `group_code = '5100'` or the codes 5101/5102/5104–5106, and nothing else. Remove the group-name text match. Match the Sales group by `group_code = '4100'`, not by name.
2. **P2:** treat 5204 as a normal operating-expense account from the ledger. Remove `getTotalDepreciation` and the provisions service from the arithmetic; they stay in the response as information only. Depreciation runs already post to the ledger: `postDepreciationVoucher` in `lib/accounting/fixed-asset-posting.ts` debits the expense account and credits 1202. Adding the calculator's figure on top would count it twice whenever `financial_year` is passed.
3. **P3:** the P&L, trial balance and balance sheet select accounts that are active **or** have ledger lines up to the report date. Inactive accounts are marked "(inactive)" on screen.
4. **P7:** the consolidated view removes 4103/5103 from the sections and shows one "Inter-branch (eliminated)" note. If the net is non-zero (an unmatched transfer), it is shown as a line so net profit still matches the ledger. The branch view keeps them: 4103 under Operating Income, 5103 under Cost of Goods Sold.
5. Add an invariant test: P&L net = ledger sum = balance sheet current-year profit.

Files: `app/api/reports/profit-loss/route.ts`, `app/api/reports/trial-balance/route.ts`, `app/api/reports/balance-sheet/route.ts`, `app/api/reports/profit-loss/drilldown/route.ts`.

### Phase 2: the account field and backfill (migration 334)

1. `ALTER TABLE accounts ADD COLUMN pl_section VARCHAR(30)`, with a CHECK on the six values and the allowed type/section pairs. Balance-sheet accounts stay NULL.
2. Backfill in the same migration, every business, idempotent, only where `pl_section IS NULL`:

| Accounts | `pl_section` |
|---|---|
| 4101, any account in group 4100 | operating_income |
| 4201, 4202 (D2), 5299 (D6) | operating_income |
| 4102 (D3) | operating_expense |
| 4203, 4204, 4205, any other account in group 4200 | other_income |
| other income accounts in group 4000 (custom) | operating_income |
| 5101, 5102, 5104, 5105, 5106, any account in group 5100 | cost_of_goods_sold |
| 5201–5204, 5212–5217, 5207–5209 (D4, D5), any account in group 5200 or 5000 not listed elsewhere | operating_expense |
| 5205, 5206, 5218, 5210, 5211 (D7) | other_expense |
| 4103, 5103, any account in group 6000 | elimination |

3. A `BEFORE INSERT OR UPDATE` trigger fills `pl_section` when it isn't provided or no longer fits the type: system code map first, then the group (4100/4000 → operating_income, 4200 → other_income, 5100 → cost_of_goods_sold, 5200/5000 → operating_expense, 6000 → elimination).
4. The seed functions are left unchanged; the trigger gives every seeded account its section.
5. Account APIs (`app/api/accounts/route.ts` POST and `app/api/accounts/[id]/route.ts` PATCH) accept and validate `pl_section` against `account_type`, and add it to the editable fields (D1). Changes are written to the audit log.
6. Shared helper `lib/accounting/pl-sections.ts` holds the enum, labels, the allowed combinations, and the default-from-group rule. The migration backfill, the API and the UI all use it.

### Phase 3: one P&L engine

1. New `lib/reports/profit-loss.ts`, with `buildProfitAndLoss(businessId, { from, to, branch, includeZero })`:
   - One SQL query that groups ledger lines by account for the period. It skips year-close lines, applies the branch filter, and includes inactive accounts that have activity.
   - Sections come from `pl_section` and the amount signs follow section 3.
   - Child accounts are nested under their parent, with a parent sub-total equal to its own lines plus its children (Zoho's "sub-account" total).
   - Returns `sections[]` (key, label, accounts tree, total), `gross_profit`, `operating_profit`, `net_profit`, `elimination`, `ledger_check`, and the inventory block in D8. The API also derives legacy `profit_before_tax` and `tax` (5210 + 5211) for older consumers.
   - Inventory block: perpetual businesses get no separate schedule; the cost-of-goods-sold section is just its accounts, as in Zoho. Periodic businesses keep `calculateCOGS`, and the section lists Opening, Purchases and Closing plus the other cost-of-goods-sold accounts, so the section total is what gross profit uses.
2. `app/api/reports/profit-loss/route.ts` becomes a thin wrapper: authorisation, branch resolution, then the engine. Legacy fields (`income.sales`, `expenses.direct`/`indirect`/`other_expenses`, `cogs`) are produced from the sections for one release, so the PDF, the validation page and the admin diagnostics keep working.
3. Move to the engine: the PDF route, the drill-down (section and sub-total drill), `app/api/admin/diagnostics/pl-validation`, and the cash-flow net-profit starting figure (`lib/reports/cash-flow.ts`, which must equal the P&L net profit).
4. P9: relabel the document-based report (D9).

### Phase 4: screens

1. **Chart of accounts** (`app/(app)/accounts/new/page.tsx`, the edit page, and the list `app/(app)/accounts/page.tsx`):
   - A "Shows in Profit & Loss as" picker, visible for income and expense accounts. It is pre-filled from the chosen group and shows a one-line hint per option.
   - A section column and filter on the list.
2. **P&L page** (`app/(app)/reports/profit-loss/page.tsx`):
   - Zoho layout: Operating Income, Cost of Goods Sold, **Gross Profit**, Operating Expense, **Operating Profit**, Non Operating Income, Non Operating Expense, **Net Profit/Loss**.
   - "Collapse sub-accounts" toggle, plus "Show zero balances" (off by default).
   - Inactive accounts tagged.
   - A footer check, "Agrees with ledger", shown as green, or red with the difference.
   - Every amount drills down to ledger lines, as today.
3. PDF and Excel export follow the same layout.

### Phase 5: tests

1. **Unit tests**, `tests/lib/accounting/pl-sections.test.ts`:
   - defaults from each group;
   - allowed and blocked type/section pairs;
   - the backfill mapping table above, applied to the seeded chart.
2. **Engine tests**, `tests/lib/reports/profit-loss.test.ts`, using a fake query client:
   - **QA-PL-0930 golden fixture:** the exact lines from the staging test, with the expected section totals in section 6;
   - **contra lines:** 4102 negative in operating expense, 5102 negative in cost of goods sold;
   - **inactive account:** included;
   - **depreciation:** 5204 included, and the asset calculator ignored;
   - **inter-branch:** eliminated in consolidated, kept in the branch view;
   - **sub-accounts:** nested, with a parent sub-total;
   - **year-close lines:** excluded;
   - **invariant:** net = ledger sum.
3. **Trial balance and balance sheet tests:** an inactive account with a balance keeps the trial balance balanced, and balance-sheet current-year profit = P&L net.
4. **Playwright e2e** (`e2e/`): the P&L page renders the sections, every section's lines add up to its total, and the collapse toggle works.
5. Run the full jest suite and compare with the known 11 pre-existing failures.

### Phase 6: staging verification

1. Apply migration 334 on staging. Confirm it actually executed (`schema_migrations` success plus `SELECT pl_section, count(*) FROM accounts GROUP BY 1`) before calling it done.
2. Re-run the QA scripts against Shalini Traders and Tandoor Studio for 30-Sep-2026 and compare with section 6.
3. Re-check October 2026 (the GST test month) against Zoho's October P&L, which was captured earlier in `gst3/zoho/pl_oct.json`.
4. Production only after the user approves, following `docs/SERVER_INFRASTRUCTURE.md`.

## 6. Acceptance figures for the 30-Sep-2026 test

These assume the recommended decisions. "Paired" means lines that exist in both systems; Zoho-only lines (Shipping, Discount, Uncategorized) and Khatario-only lines are listed separately.

| Section | Zoho (paired lines) | Khatario after the change (paired lines) | Khatario-only lines added | Khatario section total |
|---|---:|---:|---|---:|
| Operating Income | 24,023 (incl. Other Charges 1,008) | 24,023 (incl. 5299 1,008, D6) | — | 24,023 |
| Cost of Goods Sold | 8,013 | 8,013 | — | 8,013 |
| Operating Expense | 44,108 (incl. Purchase Discounts −1,012) | 44,108 (incl. 4102 −1,012) | 5208 4,004 + 5209 4,005 | 52,117 |
| Non Operating Income | 2,019 | 2,019 | 4203 1,011 + 4204 1,013 | 4,043 |
| Non Operating Expense | 16,012 (incl. Income Tax 4,006) | 16,012 (incl. 5210 4,006, D7) | 5211 4,007 | 20,019 |
| **Net profit, whole journal** | −45,108 | | | **−52,084** (equals the ledger and the balance-sheet movement) |

These Khatario figures are asserted by the golden test in `tests/lib/reports/profit-loss.test.ts`.

The two whole-journal net figures differ only because each system has lines the other lacks. That is expected; every paired line must sit in the same section with the same amount.

Inter-branch 4103/5103 (5,001 / 5,002) are eliminated in the consolidated view and shown as one note with net −1.

## 7. Order, size and risk

| Phase | Size | Risk | Can ship alone |
|---|---|---|---|
| 1 Ledger agreement | Small, about 1 day | Low; numbers move to match the balance sheet | Yes, and it should go first |
| 2 Field and migration | Small–medium | Medium: the migration touches every business; mitigated by idempotent backfill and the trigger | Yes (no visible change on its own) |
| 3 Engine | Medium | Medium: several consumers; legacy fields kept for one release | With phase 4 |
| 4 Screens | Medium | Low | With phase 3 |
| 5 Tests | Medium | — | Runs alongside each phase |
| 6 Staging check | Small | — | — |

Risks:

- **Reported profit changes for existing businesses** when gross profit, operating profit or net profit move (P1, P2, P3, P4). Mitigation: a release note, plus the "Agrees with ledger" footer showing the new numbers are the ledger's numbers.
- **Locked or filed periods:** reports only, no postings change, so no period-lock impact.
- **Custom groups with unusual names** are handled by the backfill using group codes, never names. Anything the backfill can't place falls back to the group default and is listed in a migration notice.

## 8. What stays as it is

- Posting logic, account codes, voucher types and existing ledger lines.
- The balance sheet's current-year profit calculation, which is already correct.
- Year-end close (`lib/accounting/year-close.ts`), which already closes all income/expense accounts.

## 9. Later (Zoho features not in this plan)

- Cash-basis P&L (Zoho's "Report Basis").
- "Compare with" previous period or year columns.
- Budget vs actual on the P&L.
- Department or project tags as columns.
- Schedule III (Indian statutory) layout as an alternative view, using the same sections plus a mapping.
