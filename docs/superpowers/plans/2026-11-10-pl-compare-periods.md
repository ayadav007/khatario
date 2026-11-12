# Compare Periods on the Profit & Loss Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Compare" tab to the Profit & Loss that shows the chosen period beside one to three other periods in the Standard layout, with the change in rupees and per cent when two periods are shown.

**Architecture:** A pure, import-free module holds the date rules and the change arithmetic, so both the server and the page can use it. A second module lines up several outputs of the existing report builder by account. A new API route runs that builder once per period; a new page renders the result. No accounting logic is added: every column is `buildProfitAndLoss` for its dates.

**Tech Stack:** Next.js App Router (TypeScript, React, Tailwind), PostgreSQL via `@/lib/db`, Jest (`tests/lib` unit, `tests/db` real-DB on `kh_phase2_test`).

**Spec:** [docs/superpowers/specs/2026-11-10-pl-compare-periods-design.md](../specs/2026-11-10-pl-compare-periods-design.md)

## Global Constraints

- **Needs the Schedule III change in the tree** (`components/reports/ProfitLossTabs.tsx`, `app/(app)/reports/profit-loss/layout.tsx`, `lib/reports/pl-request-scope.ts`). Stop and report if any of the three is missing.
- **Do not edit these files.** Import from them only: `lib/reports/profit-loss.ts`, `lib/accounting/pl-sections.ts`, `app/api/reports/profit-loss/route.ts`, `app/api/reports/profit-loss/pdf/**`, `app/api/reports/profit-loss/excel/**`, `app/api/reports/profit-loss/drilldown/**`, `app/(app)/reports/profit-loss/page.tsx`, `components/reports/ProfitLossDrilldownPanel.tsx`, `lib/export/profit-loss-excel.ts`, `templates/reports/profit_loss/**`, `lib/services/cogs-calculator.ts`. Also leave the Schedule III files alone, except `ProfitLossTabs.tsx`.
- Every figure in a column equals the Standard API's figure for the same dates and branch. Section totals and profits are copied from the builder's output, never re-added.
- Business and user come from the session through `resolvePlRequestScope`; never from the query string or body.
- All date arithmetic uses `Date.UTC` and the `getUTC*` readers on values built from the string parts. No local-time `Date` methods and no `toISOString()` on a local date.
- Round money with `Math.round(n * 100) / 100`. A "nil" amount is one whose absolute value is under 0.005.
- Labels, messages and test ids are exact as written in this plan and in spec section 4.
- No migration. Real-DB tests run only with `PHASE2_TEST_DATABASE_URL` pointing at `kh_phase2_test`.
- Commit only if the owner asked for commits in the session. Stage files by name; never `git add .`. Commit messages are one plain sentence saying what is now true.
- Another session may be working in the same checkout. Touch only the files a task names.

## Review Focus

1. **A period that ends on the last day of February, in a leap year or the year after one**: "Previous period" and "Same period last year" both land on the right month end. Tests in Task 1.
2. **An account that has entries in only one of the periods, including a sub-account whose parent has nothing in the other period**: it is listed once, with `–` in the empty period, under the right parent. Tests in Task 2.
3. **A compared amount that is nil or negative** (a loss last year, a profit this year): the per cent change is `–` for nil and is measured against the size of the earlier figure. Tests in Task 1.
4. **Bad input** (a date like `2026-13-01`, From after To, an unknown mode, a count of 4, a custom comparison with one date): a 400 with a plain message, not a 500 and not a query. Tests in Task 3.
5. **A single-branch view**: every column uses the same branch scope as the Standard report for that branch. Test in Task 3.

## File Structure

| File | Responsibility |
|---|---|
| `lib/reports/pl-compare-periods.ts` (new) | Date rules, request parsing, change arithmetic, period label. Pure, no imports, safe in a client component. |
| `lib/reports/profit-loss-compare.ts` (new) | Line up several `ProfitAndLoss` results; per-column notes; run the builder per period. Server only. |
| `app/api/reports/profit-loss/compare/route.ts` (new) | GET the comparison. |
| `app/(app)/reports/profit-loss/compare/page.tsx` (new) | The Compare screen. |
| `components/reports/ProfitLossTabs.tsx` (modify) | Third tab. |
| `lib/mobile-route-title.ts`, `lib/breadcrumb-utils.ts`, `e2e/routes.json`, `tests/lib/nav-active.test.ts` (modify) | Register the page. |

---

### Task 1: Period rules and change arithmetic

**Files:**
- Create: `lib/reports/pl-compare-periods.ts`
- Test: `tests/lib/reports/pl-compare-periods.test.ts`

**Interfaces:**
- Consumes: nothing. This file has no imports.
- Produces:

```ts
export type CompareMode = 'previous_period' | 'previous_year' | 'custom';
export interface Period { from: string; to: string }            // YYYY-MM-DD
export interface Change { amount: number; percent: number | null }
export class CompareInputError extends Error {}

export function isIsoDate(v: unknown): v is string;             // YYYY-MM-DD and a real calendar date
export function previousPeriod(p: Period): Period;
export function samePeriodLastYear(p: Period): Period;
export function comparisonPeriods(base: Period, mode: CompareMode, count: number, custom?: Period | null): Period[]; // most recent first
export function parseCompareRequest(q: {
  from_date: string; to_date: string;
  compare: string | null; count: string | null;
  compare_from: string | null; compare_to: string | null;
}): { mode: CompareMode; periods: Period[] };                    // periods[0] is the chosen period
export function changeBetween(base: number, compared: number): Change;
export function periodLabel(p: Period): string;                 // '1 Apr 2026 – 30 Sep 2026' (en dash, English short months)
```

Rules (spec section 5):
- `previousPeriod`: when `from` is the 1st of a month and `to` is the last day of a month, step both back by the number of months the period spans (inclusive), keeping first-day and last-day. Otherwise the new period has the same number of days and ends the day before `from`.
- `samePeriodLastYear`: each date moves to the same day and month one year earlier; a date that is the last day of its month moves to the last day of that month in the earlier year.
- `comparisonPeriods`: `previous_period` and `previous_year` apply their rule `count` times, each step from the previous result. `custom` returns `[custom]` and ignores `count`.
- `parseCompareRequest`: `compare` defaults to `previous_period` and `count` to `1` when null or empty. It throws `CompareInputError` with exactly these messages, checked in this order:

| Condition | Message |
|---|---|
| `from_date` or `to_date` (or, for custom, either custom date when present) is not an ISO date | `Dates must be in YYYY-MM-DD format.` |
| `from_date` after `to_date`, or `compare_from` after `compare_to` | `From date cannot be after To date.` |
| `compare` is not one of the three modes | `Compare with must be previous_period, previous_year or custom.` |
| `count` is not `1`, `2` or `3` (non-custom modes) | `Number of periods must be 1, 2 or 3.` |
| mode is `custom` and either custom date is missing | `A custom comparison needs both dates.` |

- `changeBetween`: `amount = r2(base − compared)`. `percent` is `null` when `compared` is nil; otherwise `amount ÷ |compared| × 100` rounded to one decimal.

- [ ] **Step 1: Write the failing tests**

```ts
const P = (from: string, to: string) => ({ from, to });

test('previous period steps back by whole months when the period is whole months', () => {
  expect(previousPeriod(P('2026-04-01', '2026-06-30'))).toEqual(P('2026-01-01', '2026-03-31'));
  expect(previousPeriod(P('2026-04-01', '2027-03-31'))).toEqual(P('2025-04-01', '2026-03-31'));
  expect(previousPeriod(P('2026-09-01', '2026-09-30'))).toEqual(P('2026-08-01', '2026-08-31'));
  expect(previousPeriod(P('2026-03-01', '2026-03-31'))).toEqual(P('2026-02-01', '2026-02-28'));
  expect(previousPeriod(P('2024-03-01', '2024-03-31'))).toEqual(P('2024-02-01', '2024-02-29'));
  expect(previousPeriod(P('2026-01-01', '2026-01-31'))).toEqual(P('2025-12-01', '2025-12-31'));
});
test('previous period steps back by days otherwise', () => {
  expect(previousPeriod(P('2026-10-01', '2026-10-15'))).toEqual(P('2026-09-16', '2026-09-30'));
  expect(previousPeriod(P('2026-04-01', '2026-11-10'))).toEqual(P('2025-08-20', '2026-03-31'));
  expect(previousPeriod(P('2026-03-01', '2026-03-01'))).toEqual(P('2026-02-28', '2026-02-28'));
});
test('same period last year keeps month ends', () => {
  expect(samePeriodLastYear(P('2026-04-01', '2026-09-30'))).toEqual(P('2025-04-01', '2025-09-30'));
  expect(samePeriodLastYear(P('2025-02-01', '2025-02-28'))).toEqual(P('2024-02-01', '2024-02-29'));
  expect(samePeriodLastYear(P('2024-02-01', '2024-02-29'))).toEqual(P('2023-02-01', '2023-02-28'));
  expect(samePeriodLastYear(P('2026-10-01', '2026-10-15'))).toEqual(P('2025-10-01', '2025-10-15'));
});
test('several periods, most recent first', () => {
  expect(comparisonPeriods(P('2026-07-01', '2026-07-31'), 'previous_period', 3)).toEqual([
    P('2026-06-01', '2026-06-30'), P('2026-05-01', '2026-05-31'), P('2026-04-01', '2026-04-30'),
  ]);
  expect(comparisonPeriods(P('2026-04-01', '2026-09-30'), 'previous_year', 2)).toEqual([
    P('2025-04-01', '2025-09-30'), P('2024-04-01', '2024-09-30'),
  ]);
  expect(comparisonPeriods(P('2026-04-01', '2026-09-30'), 'custom', 3, P('2026-01-01', '2026-01-15'))).toEqual([
    P('2026-01-01', '2026-01-15'),
  ]);
});
test('isIsoDate accepts only real dates', () => {
  expect(isIsoDate('2026-02-28')).toBe(true);
  expect(isIsoDate('2024-02-29')).toBe(true);
  expect(isIsoDate('2026-02-29')).toBe(false);
  expect(isIsoDate('2026-13-01')).toBe(false);
  expect(isIsoDate('2026-4-1')).toBe(false);
  expect(isIsoDate('abc')).toBe(false);
  expect(isIsoDate(null)).toBe(false);
});
test('parseCompareRequest defaults and results', () => {
  const base = { from_date: '2026-07-01', to_date: '2026-09-30', compare: null, count: null, compare_from: null, compare_to: null };
  expect(parseCompareRequest(base)).toEqual({ mode: 'previous_period', periods: [P('2026-07-01', '2026-09-30'), P('2026-04-01', '2026-06-30')] });
  expect(parseCompareRequest({ ...base, compare: 'previous_year', count: '2' }).periods).toHaveLength(3);
  expect(parseCompareRequest({ ...base, compare: 'custom', compare_from: '2026-04-01', compare_to: '2026-04-30' }).periods[1]).toEqual(P('2026-04-01', '2026-04-30'));
});
test('parseCompareRequest rejects bad input with the exact message', () => {
  const base = { from_date: '2026-07-01', to_date: '2026-09-30', compare: null, count: null, compare_from: null, compare_to: null };
  const msg = (q: any) => { try { parseCompareRequest(q); return null; } catch (e) { expect(e).toBeInstanceOf(CompareInputError); return (e as Error).message; } };
  expect(msg({ ...base, from_date: '2026-13-01' })).toBe('Dates must be in YYYY-MM-DD format.');
  expect(msg({ ...base, from_date: '2026-10-01' })).toBe('From date cannot be after To date.');
  expect(msg({ ...base, compare: 'weekly' })).toBe('Compare with must be previous_period, previous_year or custom.');
  expect(msg({ ...base, count: '4' })).toBe('Number of periods must be 1, 2 or 3.');
  expect(msg({ ...base, count: '0' })).toBe('Number of periods must be 1, 2 or 3.');
  expect(msg({ ...base, compare: 'custom', compare_from: '2026-04-01' })).toBe('A custom comparison needs both dates.');
  expect(msg({ ...base, compare: 'custom', compare_from: '2026-05-01', compare_to: '2026-04-01' })).toBe('From date cannot be after To date.');
  expect(msg({ ...base, compare: 'custom', compare_from: 'x', compare_to: '2026-04-01' })).toBe('Dates must be in YYYY-MM-DD format.');
});
test('changeBetween', () => {
  expect(changeBetween(1200, 1000)).toEqual({ amount: 200, percent: 20 });
  expect(changeBetween(800, 1000)).toEqual({ amount: -200, percent: -20 });
  expect(changeBetween(1000, 3000)).toEqual({ amount: -2000, percent: -66.7 });
  expect(changeBetween(100, 0)).toEqual({ amount: 100, percent: null });
  expect(changeBetween(0, 0)).toEqual({ amount: 0, percent: null });
  expect(changeBetween(50, -100)).toEqual({ amount: 150, percent: 150 });   // a loss became a profit
  expect(changeBetween(-50, 100)).toEqual({ amount: -150, percent: -150 }); // a profit became a loss
});
test('periodLabel', () => {
  expect(periodLabel(P('2026-04-01', '2026-09-30'))).toBe('1 Apr 2026 – 30 Sep 2026');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/lib/reports/pl-compare-periods.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `lib/reports/pl-compare-periods.ts`**

No imports. Month names come from a fixed array, not from the runtime's locale.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/lib/reports/pl-compare-periods.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (see Global Constraints)

Files: `lib/reports/pl-compare-periods.ts`, `tests/lib/reports/pl-compare-periods.test.ts`.
Message: `The dates for a previous period or the same period last year, and the change between two amounts, are worked out in one place.`

---

### Task 2: Line up several reports

**Files:**
- Create: `lib/reports/profit-loss-compare.ts`
- Test: `tests/lib/reports/profit-loss-compare.test.ts`

**Interfaces:**
- Consumes: `type ProfitAndLoss`, `type PlAccountNode`, `type ReportSection`, `REPORT_SECTIONS` from `@/lib/reports/profit-loss`; `type Period`, `periodLabel` from Task 1.
- Produces:

```ts
export interface CompareRow {
  id: string; account_code: string; account_name: string; is_active: boolean;
  amounts: number[];          // the account's own amount per column
  totals: number[];           // own amount plus sub-accounts per column
  children: CompareRow[];
}
export interface CompareSection {
  key: ReportSection; label: string;
  totals: number[];           // the builder's section total per column
  stock: null | { opening_stock: number[]; purchases: number[]; closing_stock: number[] };
  rows: CompareRow[];
}
export interface ComparedPl {
  sections: CompareSection[]; // REPORT_SECTIONS order
  gross_profit: number[]; operating_profit: number[]; net_profit: number[];
  profit_before_tax: number[]; ebit: number[]; ebitda: number[];
  elimination: { applied: boolean; net: number[] };
}
export function mergeProfitAndLoss(reports: ProfitAndLoss[], opts: { includeZero: boolean }): ComparedPl;
export function columnNotes(period: Period, report: ProfitAndLoss): string[];
```

Rules the signature does not fix:
- Section totals, the three profits and the three key figures are copied from each report; nothing is re-added.
- Rows are the union of account nodes across reports, matched by `id`. A node keeps the parent it has in any report. `amounts[i]` and `totals[i]` are the node's `amount` and `total` in report `i`, or `0` when the node is absent there. Rows and children are sorted by `account_code`.
- With `includeZero: false`, a row is dropped when every entry of `amounts` is nil and it has no remaining children.
- `stock` is filled only for `cost_of_goods_sold`, and only when at least one report has `periodic_cogs`; a report without it contributes `0`.
- `elimination.applied` is true when it is true in any report.
- `columnNotes` returns, in this order, each note that applies (label = `periodLabel(period)`):
  1. Financial years differ between `from` and `to` (a date before April belongs to the previous year's financial year): `<label> crosses a financial year end. Its opening stock and purchases belong to different years, so treat it as a management figure.`
  2. `report.periodic_cogs` is set, `report.cogs_detail` shows opening stock, closing stock or gross purchases above 0.01, and `cogs_detail.closingStock.source` is not `'snapshot'`: `<label>: ` followed by the Standard route's closing-stock warning, word for word (`app/api/reports/profit-loss/route.ts`, the message with code `closing_stock_not_formalized`). Copy the text; do not import from or edit that route.
  3. `|report.ledger_check.difference| >= 0.01`: `<label> differs from the ledger by ₹<absolute difference, two decimals>. Please report this.`

- [ ] **Step 1: Write the failing tests**

Mock `@/lib/db`, `@/lib/services/cogs-calculator` and `@/lib/inventory/cogs-posting` at the top, and copy the `row` helper, as `tests/lib/reports/schedule3-pl.test.ts` does.

```ts
const report = (rows: PlAccountRow[], periodic: any = null): ProfitAndLoss => ({
  ...assemblePl(rows, { consolidated: true, includeZero: true, periodic }),
  inventory_model: periodic ? 'periodic' : 'perpetual',
  cogs_detail: periodic,
});
const section = (m: ComparedPl, key: string) => m.sections.find((s) => s.key === key)!;

test('an account present in one period only is listed once', () => {
  const a = report([row('4101','income','4100','cr',1000), row('5213','expense','5200','dr',200)]);
  const b = report([row('4101','income','4100','cr',600), row('5213','expense','5200','dr',150), row('5215','expense','5200','dr',50)]);
  const m = mergeProfitAndLoss([a, b], { includeZero: false });
  expect(m.net_profit).toEqual([800, 400]);
  expect(m.gross_profit).toEqual([1000, 600]);
  const opex = section(m, 'operating_expense');
  expect(opex.totals).toEqual([200, 200]);
  expect(opex.rows.map((r) => r.account_code)).toEqual(['5213', '5215']);
  expect(opex.rows[1].amounts).toEqual([0, 50]);
  expect(section(m, 'operating_income').rows[0].amounts).toEqual([1000, 600]);
});
test('a sub-account that exists in one period stays under its parent', () => {
  const child = (amt: number) => row('5913','expense','5200','dr',amt,{ is_system: false, parent_account_id: 'acc-5213' });
  const a = report([row('5213','expense','5200','dr',200), child(30)]);
  const b = report([row('5213','expense','5200','dr',150)]);
  const rows = section(mergeProfitAndLoss([a, b], { includeZero: false }), 'operating_expense').rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].amounts).toEqual([200, 150]);
  expect(rows[0].totals).toEqual([230, 150]);
  expect(rows[0].children.map((c) => c.account_code)).toEqual(['5913']);
  expect(rows[0].children[0].amounts).toEqual([30, 0]);
});
test('rows nil in every period are dropped unless asked for', () => {
  const rows = [row('5213','expense','5200','dr',200), row('5214','expense','5200','dr',0)];
  const codes = (includeZero: boolean) =>
    section(mergeProfitAndLoss([report(rows), report(rows)], { includeZero }), 'operating_expense').rows.map((r) => r.account_code);
  expect(codes(false)).toEqual(['5213']);
  expect(codes(true)).toEqual(['5213', '5214']);
});
test('totals and profits are the builder\'s own', () => {
  const a = report([row('4101','income','4100','cr',1000), row('5104','expense','5100','dr',600), row('5205','expense','5200','dr',40), row('5210','expense','5200','dr',30)]);
  const b = report([row('4101','income','4100','cr',500), row('4203','income','4000','cr',20)]);
  const m = mergeProfitAndLoss([a, b], { includeZero: false });
  [a, b].forEach((r, i) => {
    expect(m.sections.map((s) => s.totals[i])).toEqual(REPORT_SECTIONS.map((k) => r.sections[k].total));
    expect(m.gross_profit[i]).toBe(r.gross_profit);
    expect(m.operating_profit[i]).toBe(r.operating_profit);
    expect(m.net_profit[i]).toBe(r.net_profit);
    expect(m.profit_before_tax[i]).toBe(r.earnings.profit_before_tax);
    expect(m.ebit[i]).toBe(r.earnings.ebit);
    expect(m.ebitda[i]).toBe(r.earnings.ebitda);
  });
});
test('periodic stock rows per period', () => {
  const per = (o: number, p: number, c: number) => ({ openingStock: { value: o }, purchases: { total: p }, closingStock: { value: c } });
  const m = mergeProfitAndLoss([report([], per(500, 900, 300)), report([], per(300, 700, 500))], { includeZero: false });
  expect(section(m, 'cost_of_goods_sold').stock).toEqual({ opening_stock: [500, 300], purchases: [900, 700], closing_stock: [300, 500] });
  expect(section(m, 'operating_income').stock).toBeNull();
});
test('inter-branch difference per period', () => {
  const a = report([row('4103','income','6000','cr',100), row('5103','expense','6000','dr',90)]);
  const m = mergeProfitAndLoss([a, report([])], { includeZero: false });
  expect(m.elimination).toEqual({ applied: true, net: [10, 0] });
});
test('column notes', () => {
  const clean = report([row('4101','income','4100','cr',1000)]);
  expect(columnNotes({ from: '2026-04-01', to: '2026-09-30' }, clean)).toEqual([]);
  expect(columnNotes({ from: '2026-01-01', to: '2026-06-30' }, clean)).toEqual([
    '1 Jan 2026 – 30 Jun 2026 crosses a financial year end. Its opening stock and purchases belong to different years, so treat it as a management figure.',
  ]);
  const off = { ...clean, ledger_check: { ...clean.ledger_check, difference: -5 } };
  expect(columnNotes({ from: '2026-04-01', to: '2026-09-30' }, off)).toEqual([
    '1 Apr 2026 – 30 Sep 2026 differs from the ledger by ₹5.00. Please report this.',
  ]);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/lib/reports/profit-loss-compare.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `mergeProfitAndLoss` and `columnNotes`**

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/lib/reports/profit-loss-compare.test.ts tests/lib/reports/profit-loss.test.ts`
Expected: PASS, both files.

- [ ] **Step 5: Commit** (see Global Constraints)

Files: `lib/reports/profit-loss-compare.ts`, `tests/lib/reports/profit-loss-compare.test.ts`.
Message: `Several Profit & Loss results can be lined up by account, keeping each period's own totals.`

---

### Task 3: The comparison API

**Files:**
- Modify: `lib/reports/profit-loss-compare.ts` (add `buildComparison`)
- Create: `app/api/reports/profit-loss/compare/route.ts`
- Modify: `tests/db/phase3c-identity-fallback.db.test.ts` (add the route to its table beside `reports/profit-loss/schedule-iii`)
- Test: `tests/db/profit-loss-compare.db.test.ts`

**Interfaces:**
- Consumes: `buildProfitAndLoss`, `type BranchScope` from `@/lib/reports/profit-loss`; `resolvePlRequestScope` from `@/lib/reports/pl-request-scope`; `parseCompareRequest`, `CompareInputError`, `type Period`, `type CompareMode` (Task 1); `mergeProfitAndLoss`, `columnNotes`, `type ComparedPl` (Task 2).
- Produces:

```ts
// lib/reports/profit-loss-compare.ts
export interface CompareColumn { from_date: string; to_date: string; notes: string[] }
export interface PlComparison extends ComparedPl {
  columns: CompareColumn[];
  inventory_model: 'periodic' | 'perpetual';
}
export async function buildComparison(opts: {
  businessId: string; branch: BranchScope; consolidated: boolean;
  periods: Period[]; includeZero: boolean;
}): Promise<PlComparison>;
```

- `buildComparison` calls `buildProfitAndLoss` once per period with `includeZero: true` and `financialYear: null` (the Standard page sends none), all at once with `Promise.all`, then `mergeProfitAndLoss(reports, { includeZero: opts.includeZero })`. `inventory_model` is the first report's. A failure of any period rejects the whole call.
- `GET /api/reports/profit-loss/compare`, query `from_date`, `to_date`, `compare`, `count`, `compare_from`, `compare_to`, `include_zero`, `branch_id`:
  1. `resolvePlRequestScope(request)`; return its response when it is one.
  2. `parseCompareRequest` with `scope.fromDate` and `scope.toDate`. A `CompareInputError` returns 400 `{ error: <message>, code: 'INVALID_COMPARE_REQUEST' }`.
  3. `buildComparison`, then respond with `{ branch: scope.branchInfo, is_consolidated: scope.consolidated, compare: <mode>, ...comparison }`.
  4. Any other error: 500 `{ error }`, as the Schedule III route does.

- [ ] **Step 1: Write the failing real-DB test**

Follow `tests/db/schedule3-pl.db.test.ts` (skip without `PHASE2_TEST_DATABASE_URL`, the mocks for `@/lib/jwt`, `@/lib/authorization` and `@/lib/subscription/feature-access`, the `get` helper, a new business with one branch `BR` and one user, cleanup of only that business in `afterAll`). Accounts `1101`, `4101`, `5213`, `5215`, all `is_system = true`. Journal vouchers:

| Date | Dr | Cr | Amount |
|---|---|---|---|
| 2026-08-15 | 1101 | 4101 | 1000 |
| 2026-08-20 | 5213 | 1101 | 200 |
| 2026-05-15 | 1101 | 4101 | 600 |
| 2026-05-20 | 5213 | 1101 | 150 |
| 2026-05-25 | 5215 | 1101 | 50 |

```ts
const PATH = '/api/reports/profit-loss/compare';
const q = { from_date: '2026-07-01', to_date: '2026-09-30' };

const cmp = await get(compare, PATH, q);
expect(cmp.status).toBe(200);
expect(cmp.json.compare).toBe('previous_period');
expect(cmp.json.columns.map((c: any) => [c.from_date, c.to_date])).toEqual([
  ['2026-07-01', '2026-09-30'], ['2026-04-01', '2026-06-30'],
]);
expect(cmp.json.net_profit).toEqual([800, 400]);
const opex = cmp.json.sections.find((s: any) => s.key === 'operating_expense');
expect(opex.rows.find((r: any) => r.account_code === '5215').amounts).toEqual([0, 50]);

// every column equals the Standard report for the same dates, consolidated and for one branch
for (const extra of [{}, { branch_id: BR }]) {
  const c = await get(compare, PATH, { ...q, ...extra });
  for (let i = 0; i < c.json.columns.length; i++) {
    const col = c.json.columns[i];
    const std = await get(profitLoss, '/api/reports/profit-loss', { from_date: col.from_date, to_date: col.to_date, ...extra });
    expect(c.json.net_profit[i]).toBe(std.json.net_profit);
    expect(c.json.gross_profit[i]).toBe(std.json.gross_profit);
    expect(c.json.operating_profit[i]).toBe(std.json.operating_profit);
    expect(c.json.sections.map((s: any) => s.totals[i])).toEqual(std.json.sections.map((s: any) => s.total));
  }
}

const year = await get(compare, PATH, { ...q, compare: 'previous_year' });
expect(year.json.columns[1]).toMatchObject({ from_date: '2025-07-01', to_date: '2025-09-30' });
expect(year.json.net_profit[1]).toBe(0);
expect((await get(compare, PATH, { ...q, count: '3' })).json.columns).toHaveLength(4);
const custom = await get(compare, PATH, { ...q, compare: 'custom', compare_from: '2026-05-01', compare_to: '2026-05-31' });
expect(custom.json.columns[1]).toMatchObject({ from_date: '2026-05-01', to_date: '2026-05-31' });
expect(custom.json.net_profit[1]).toBe(400);

for (const bad of [
  { from_date: '2026-13-01', to_date: '2026-09-30' },
  { from_date: '2026-10-01', to_date: '2026-09-30' },
  { ...q, compare: 'weekly' },
  { ...q, count: '4' },
  { ...q, compare: 'custom', compare_from: '2026-05-01' },
]) {
  const r = await get(compare, PATH, bad);
  expect(r.status).toBe(400);
  expect(r.json.code).toBe('INVALID_COMPARE_REQUEST');
}
const bare = await compare(new NextRequest(`http://localhost${PATH}?business_id=${B}&user_id=${U}`));
expect(bare.status).toBe(400);
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/db/profit-loss-compare.db.test.ts --runInBand`
Expected: FAIL, the route module is missing.

- [ ] **Step 3: Implement `buildComparison` and the route**

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/db/profit-loss-compare.db.test.ts tests/lib/reports/profit-loss-compare.test.ts --runInBand`
Expected: PASS.
Run: `npx jest tests/db/phase3c-identity-fallback.db.test.ts --runInBand`
Expected: the new entry passes. One older case on `dashboard/charts` (line ~466) is known to fail without this change; report it, do not fix it.

- [ ] **Step 5: Commit** (see Global Constraints)

Files: `lib/reports/profit-loss-compare.ts`, the route, the two test files.
Message: `The Profit & Loss can be fetched for a period beside one to three other periods.`

---

### Task 4: The Compare tab and page

**Files:**
- Create: `app/(app)/reports/profit-loss/compare/page.tsx`
- Modify: `components/reports/ProfitLossTabs.tsx`, `lib/mobile-route-title.ts`, `lib/breadcrumb-utils.ts`, `e2e/routes.json`, `tests/lib/nav-active.test.ts`

**Interfaces:**
- Consumes: the Task 3 response (`import type { PlComparison, CompareRow, CompareSection }` only; that module is server-only); `changeBetween`, `periodLabel`, `type CompareMode` from `@/lib/reports/pl-compare-periods` (client-safe values); `ProfitLossDrilldownPanel`, `type DrillTarget` (unchanged).
- Produces: page at `/reports/profit-loss/compare`.

Decisions:
- Model the page on `app/(app)/reports/profit-loss/schedule-iii/page.tsx`: `withPageAuth('reports', 'read', …)`, default dates, `buildApiUrl`, the `AbortController` in the fetch effect (abort in cleanup; no state is set by an aborted request), a local `inr`, loading, error and empty states, the table in an `overflow-x-auto` container inside its card. `MobileReportHeader` title: `Profit and Loss (Compare)`. No Print, PDF or Excel buttons.
- Controls (labels exact): `From Date`, `To Date`; select `Compare with` (`data-testid="plc-compare-with"`) with options `Previous period`, `Same period last year`, `Custom period`; select `Number of periods` (`plc-count`) with `1`, `2`, `3`, shown unless Custom is chosen; for Custom, `Compare From` (`plc-custom-from`) and `Compare To` (`plc-custom-to`); checkboxes `Show accounts with no transactions` and `Hide sub-accounts`; `Expand all` / `Collapse all`.
- No request is sent while Custom is chosen and either custom date is empty; the table area then shows `Choose both dates for the period to compare with.`
- A 400 from the API shows its `error` text above the table and keeps the controls on screen. Other failures use the same error state as the Schedule III page.
- Table (`data-testid="plc-table"`), minimum width 560px plus 140px for each column after the second. Header cells: `Account`, then `periodLabel` of each column (`plc-col-<i>`), then `Change (₹)` and `Change (%)` when exactly two columns are shown.
- Rows, in the order of spec section 4. For each section: a collapsible heading; on periodic books in Cost of Goods Sold the rows `Opening Stock`, `Add: Purchases (net of returns)`, `Less: Closing Stock` (closing shown negative); the account rows; `Total for <section label>` (`plc-section-total-<key>-<i>` on each amount, with `data-value`). Then `Gross Profit` after Cost of Goods Sold, `Operating Profit` after Operating Expense, `Net Profit/Loss` after Non Operating Expense (`plc-profit-gross-<i>`, `plc-profit-operating-<i>`, `plc-profit-net-<i>`), then a `Key figures` block with `Profit Before Tax`, `EBIT`, `EBITDA`.
- Account rows follow the Standard page: a parent shows its own amounts, then its children indented, then `Total for <account name>` with `totals`. With `Hide sub-accounts`, a parent shows `totals` and no children.
- A nil amount shows `–`; negatives are red.
- Change cells use `changeBetween(first, second)` on the two figures of the row. `Change (%)` shows one decimal and `%`, or `–` when `percent` is null. The Net Profit/Loss row's change cells carry `plc-change-amount-net` and `plc-change-percent-net`. No green or red meaning beyond red for a negative number.
- Clicking an account amount opens `ProfitLossDrilldownPanel` with `{ kind: 'account', label, accountIds, section: <section key> }` and that column's `fromDate` and `toDate`; `accountIds` is the account alone, or the account and all its descendants on a `Total for` row or a rolled-up parent. The three stock rows open the panel with kind `opening_stock`, `purchases` or `closing_stock` and that column's dates. Profit and key-figure rows are not clickable.
- Under the table, in this order: every note of every column, in column order; when `elimination.applied`, `Inter-branch sales and purchases are eliminated in the consolidated view.` followed, when any `elimination.net` is not nil, by ` A difference between the two sides stays in net profit.`; then `Each column is the Standard Profit & Loss for those dates.`
- `ProfitLossTabs`: add `{ href: '/reports/profit-loss/compare', label: 'Compare', testId: 'pl-tab-compare' }` as the third tab and mention it in the component's comment.
- `lib/mobile-route-title.ts`: `if (p === '/reports/profit-loss/compare') return 'P&L (Compare)';`
- `lib/breadcrumb-utils.ts`: `'/reports/profit-loss/compare': { label: 'Compare', parent: '/reports/profit-loss' },`
- `e2e/routes.json`: add `"/reports/profit-loss/compare"` where `e2e/generate-routes.mjs` would sort it (before `/reports/profit-loss/schedule-iii`).

- [ ] **Step 1: Write the failing test**

In `tests/lib/nav-active.test.ts`, beside the Schedule III assertion:

```ts
expect(active('/reports/profit-loss/compare')).toBe('/reports/profit-loss');
```

- [ ] **Step 2: Run it**

Run: `npx jest tests/lib/nav-active.test.ts`
Expected: PASS (the sidebar matches by prefix).

- [ ] **Step 3: Build the page, add the tab, register the route**

- [ ] **Step 4: Type-check the new and changed files**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "profit-loss/compare|ProfitLossTabs|pl-compare|profit-loss-compare"`
Expected: no output.

- [ ] **Step 5: Confirm the Standard and Schedule III pages are untouched**

Run: `git diff --stat -- "app/(app)/reports/profit-loss/page.tsx" app/api/reports/profit-loss/route.ts lib/reports/profit-loss.ts`
Expected: no output. If the Schedule III files are committed by then, also run `git diff --stat -- "app/(app)/reports/profit-loss/schedule-iii" app/api/reports/profit-loss/schedule-iii lib/reports/schedule3-pl.ts` and expect no output.

- [ ] **Step 6: Commit** (see Global Constraints)

Files: the page, `ProfitLossTabs.tsx`, the three registrations, `tests/lib/nav-active.test.ts`.
Message: `Profit & Loss has a Compare tab that shows two to four periods side by side with the change.`

---

### Task 5: Final checks and hand-over

- [ ] **Step 1: The Standard report is untouched**

Run: `git diff --stat -- lib/reports/profit-loss.ts lib/accounting/pl-sections.ts app/api/reports/profit-loss/route.ts app/api/reports/profit-loss/pdf app/api/reports/profit-loss/excel app/api/reports/profit-loss/drilldown "app/(app)/reports/profit-loss/page.tsx" components/reports/ProfitLossDrilldownPanel.tsx lib/export/profit-loss-excel.ts templates/reports/profit_loss lib/services/cogs-calculator.ts`
Expected: no output.

- [ ] **Step 2: Run every test this work touches**

Run: `npx jest tests/lib/reports tests/lib/nav-active.test.ts`
Run: `npx jest tests/db/profit-loss-compare.db.test.ts tests/db/schedule3-pl.db.test.ts tests/db/pl-tb-bs-agreement.db.test.ts --runInBand`
Expected: PASS. Report any failure with its output.

- [ ] **Step 3: Refresh the code graph**

Run: `graphify update .`

- [ ] **Step 4: Append the session entry to `docs/project.log.md` and move the roadmap card**

List the staging checklist below as open.

## Staging checklist (after deploy)

1. Reports → Profit and Loss shows three tabs. Standard and Schedule III look and total as before.
2. Compare, default dates: the tab opens on Same period last year, with two amount columns plus Change (₹) and Change (%). The second column's dates are the first column's, one year earlier. Then choose Previous period and check the columns change. Net Profit/Loss in the first column equals the Standard tab for the same dates.
3. Set the Standard tab to the second column's dates: its Net Profit/Loss equals that column.
4. A quarter (1 Apr–30 Jun) compares with 1 Jan–31 Mar, and the note about crossing a financial year end does not appear for either column; a period from January to June shows it.
5. Same period last year, 2 periods: three amount columns, no change columns.
6. Custom period with only one date filled shows "Choose both dates for the period to compare with." and sends no request; filling both shows the comparison.
7. Click an expense amount in the second column: the drill-down lists that period's vouchers and its total equals the cell.
8. An account used in only one of the periods appears once, with `–` in the other.
9. Pick one branch in the branch selector: both columns change, and still match the Standard tab for that branch.
10. Change the dates several times quickly: the table ends on the last dates chosen.
11. Time the request on the largest business with 4 periods; note the seconds in the project log.
12. Phone width: three tabs fit on one row; the table scrolls sideways inside its card.
13. Added after the final review. Click into From Date and type a new year slowly by keyboard: the table waits, shows "Enter complete dates to see the comparison." while the year is incomplete, and never switches to an error screen.
14. Added after the final review. On a business with an inactive parent account that has sub-accounts, tick "Hide sub-accounts": the rows in each column add up to the section total.
15. Added after the final review. Switch branch without reloading the page, then open a drill-down: note whether the table and the drill-down both follow the new branch (the other two tabs behave the same way).

## Changes made after the final review

Spec sections 4 and 6 hold the current rules.

- Any date before 1900, typed or worked out for a compared period, is refused with `Dates must be in or after the year 1900.` The page sends nothing while a date is incomplete, waits 0.4 seconds after the last change, and shows failures other than "no access" in place of the table with the controls kept.
- When lining up, a sub-account sits under its parent whenever any period shows it there, and a parent's `totals` are its own amount plus its sub-accounts' totals. Section totals and profits are still copied from the builder.
- On periodic books a comparison is refused when only some periods have a stock schedule.
- When the change in rupees is nil, both change cells show `–`.
