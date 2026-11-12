# Schedule III Profit & Loss View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate "Schedule III" tab to the Profit & Loss report that shows the same ledger in the Schedule III (Division I) layout, without editing the existing report.

**Architecture:** A new pure module maps each income/expense account to a Schedule III line; a second pure module assembles the statement from the account movements the existing loader already returns, plus stock-account movements. A new API route and a new page sit under the existing `/reports/profit-loss` paths, and a nested layout adds the two tabs, so the existing page file is never opened. An optional per-account override column comes last.

**Tech Stack:** Next.js App Router (TypeScript), PostgreSQL via `@/lib/db`, Jest (`tests/lib` unit, `tests/db` real-DB on `kh_phase2_test`).

**Spec:** [docs/superpowers/specs/2026-11-10-schedule-iii-pl-view-design.md](../specs/2026-11-10-schedule-iii-pl-view-design.md)

## Global Constraints

- **Do not edit these files.** Import from them only: `lib/reports/profit-loss.ts`, `lib/accounting/pl-sections.ts`, `app/api/reports/profit-loss/route.ts`, `app/api/reports/profit-loss/pdf/**`, `app/api/reports/profit-loss/excel/**`, `app/api/reports/profit-loss/drilldown/**`, `app/(app)/reports/profit-loss/page.tsx`, `components/reports/ProfitLossDrilldownPanel.tsx`, `lib/export/profit-loss-excel.ts`, `templates/reports/profit_loss/**`, `lib/services/cogs-calculator.ts`.
- Report-only. No change to posting, account codes, voucher types or existing ledger lines.
- Profit for the period must equal the Standard report's net profit for the same inputs, to the paisa.
- Business and user come from `getBusinessIdFromRequest` / `getUserIdFromRequest`; never from the query string or body.
- Migrations are written, not applied. Apply only to the disposable DB `kh_phase2_test`. Never staging or production.
- Real-DB tests run only with `PHASE2_TEST_DATABASE_URL` pointing at `kh_phase2_test`.
- Commit only if the owner asked for commits in the session. Stage files by name; never `git add .`. Commit messages are one plain sentence saying what is now true.
- Labels on screen use the exact text in the spec, section 4.
- Round every amount with `Math.round(n * 100) / 100`.

## Review Focus

1. **Stock written off or adjusted on perpetual books** (5106, `stock_adjustment`, landed cost): the write-off must not be counted twice; profit still equals Standard. Test in Task 2 (case c).
2. **User-created account with no parent, or with a stale or computed-only line stored**: it lands on the default line and is never dropped from the statement. Tests in Task 1.
3. **Books that hold balances on both 5101 and 5104** (inventory model switched mid-year), on either model: profit still equals Standard. Test in Task 2 (invariant).
4. **Previous-year column for a first-year business, and for 29 February**: all rows show nil without an error; 29 Feb maps to 28 Feb. Tests in Task 4.
5. **Branch view with inter-branch accounts**: they show under Revenue and Purchases; the consolidated view removes them and shows the difference row. Test in Task 2 (case e).

## File Structure

| File | Responsibility |
|---|---|
| `lib/accounting/schedule3-lines.ts` (new) | Line names, labels, seeded-code map, placement rule. Pure. |
| `lib/reports/schedule3-pl.ts` (new) | Assemble the statement (pure), load stock movements and overrides, build the report. |
| `lib/reports/pl-request-scope.ts` (new) | Auth, plan, branch and date resolution for the new route. |
| `app/api/reports/profit-loss/schedule-iii/route.ts` (new) | GET the statement for current and previous period. |
| `app/(app)/reports/profit-loss/layout.tsx` (new) | Renders the tabs above both pages. |
| `components/reports/ProfitLossTabs.tsx` (new) | The two tab links. |
| `app/(app)/reports/profit-loss/schedule-iii/page.tsx` (new) | The Schedule III screen. |
| `database/migrations/467_accounts_schedule3_line.sql` (new) | Override column. Use the next free number if 467 is taken. |
| `lib/accounting/schedule3-column.ts` (new) | "Has the column been added" check. |
| `components/accounts/Schedule3LineSelect.tsx` (new) | Override dropdown. |
| `app/api/accounts/[id]/route.ts`, `app/(app)/accounts/[id]/page.tsx` (modify) | Save and show the override. |
| `lib/mobile-route-title.ts`, `lib/breadcrumb-utils.ts`, `e2e/routes.json` (modify) | Register the new page. |

---

### Task 1: Schedule III line for an account

**Files:**
- Create: `lib/accounting/schedule3-lines.ts`
- Test: `tests/lib/accounting/schedule3-lines.test.ts`

**Interfaces:**
- Consumes: `effectivePlSection`, `SYSTEM_PL_SECTIONS`, `type PlAccountLike` from `@/lib/accounting/pl-sections`.
- Produces:

```ts
export const SCHEDULE3_LINES = [
  'revenue_from_operations', 'other_income',
  'materials_consumed', 'purchases_stock_in_trade', 'changes_in_inventories',
  'employee_benefits', 'finance_costs', 'depreciation_amortisation', 'other_expenses',
  'exceptional_items', 'current_tax', 'deferred_tax',
] as const;
export type Schedule3Line = (typeof SCHEDULE3_LINES)[number];
export type Schedule3Placement = Schedule3Line | 'stock_cost' | 'elimination';
export const SCHEDULE3_LINE_LABELS: Record<Schedule3Line, string>;        // spec section 4 text
export const ASSIGNABLE_SCHEDULE3_LINES: readonly Schedule3Line[];        // all except materials_consumed, changes_in_inventories
export const SCHEDULE3_LOCKED_CODES: ReadonlySet<string>;                 // 4103 5101 5102 5103 5104
export const SYSTEM_SCHEDULE3_PLACEMENTS: Readonly<Record<string, Schedule3Placement>>; // spec section 5 table; 5104 → 'stock_cost'; 4103, 5103 → 'elimination'
export const CREDIT_LINES: ReadonlySet<Schedule3Line>;                    // revenue_from_operations, other_income
export function isAssignableSchedule3Line(v: unknown): v is Schedule3Line;
export function schedule3Amount(line: Schedule3Line, debit: number, credit: number): number; // credit − debit on CREDIT_LINES, else debit − credit
export interface Schedule3AccountLike extends PlAccountLike {
  id: string;
  parent_account_id: string | null;
  schedule3_line?: string | null;
}
export function effectiveSchedule3Placement(
  a: Schedule3AccountLike,
  byId: ReadonlyMap<string, Schedule3AccountLike>
): Schedule3Placement;
```

- [ ] **Step 1: Write the failing tests**

Use a helper `acc(code, type, extra?)` returning a `Schedule3AccountLike` with `id: 'acc-' + code`, `is_system: true` for codes in `SYSTEM_PL_SECTIONS`, `group_code: '5200'` for expenses and `'4100'` for income unless overridden.

```ts
const place = (a: Schedule3AccountLike, others: Schedule3AccountLike[] = []) =>
  effectiveSchedule3Placement(a, new Map([a, ...others].map((x) => [x.id, x])));

test('seeded codes use the fixed table', () => {
  expect(place(acc('4101', 'income'))).toBe('revenue_from_operations');
  expect(place(acc('4102', 'income'))).toBe('other_income');
  expect(place(acc('5212', 'expense'))).toBe('employee_benefits');
  expect(place(acc('5205', 'expense'))).toBe('finance_costs');
  expect(place(acc('5204', 'expense'))).toBe('depreciation_amortisation');
  expect(place(acc('5210', 'expense'))).toBe('current_tax');
  expect(place(acc('5211', 'expense'))).toBe('deferred_tax');
  expect(place(acc('5105', 'expense'))).toBe('purchases_stock_in_trade');
  expect(place(acc('5217', 'expense'))).toBe('other_expenses');
  expect(place(acc('5104', 'expense'))).toBe('stock_cost');
  expect(place(acc('4103', 'income'))).toBe('elimination');
});
test('every seeded P&L code has a placement', () => {
  for (const code of Object.keys(SYSTEM_PL_SECTIONS)) expect(SYSTEM_SCHEDULE3_PLACEMENTS[code]).toBeDefined();
});
test('user account with no parent takes the section default', () => {
  expect(place(acc('5901', 'expense', { is_system: false }))).toBe('other_expenses');
  expect(place(acc('5902', 'expense', { is_system: false, group_code: '5100' }))).toBe('other_expenses');
  expect(place(acc('4901', 'income', { is_system: false, group_code: '4200' }))).toBe('other_income');
  expect(place(acc('4902', 'income', { is_system: false, pl_section: 'operating_expense' }))).toBe('other_income');
  expect(place(acc('5903', 'expense', { is_system: false, pl_section: 'operating_income' }))).toBe('revenue_from_operations');
});
test('sub-account follows its nearest placed parent', () => {
  const parent = acc('5205', 'expense');
  const mid = acc('5910', 'expense', { is_system: false, parent_account_id: parent.id });
  const leaf = acc('5911', 'expense', { is_system: false, parent_account_id: mid.id });
  expect(place(leaf, [mid, parent])).toBe('finance_costs');
});
test('stored line wins, unless it is not assignable or the code is locked', () => {
  expect(place(acc('5217', 'expense', { schedule3_line: 'finance_costs' }))).toBe('finance_costs');
  expect(place(acc('5901', 'expense', { is_system: false, schedule3_line: 'changes_in_inventories' }))).toBe('other_expenses');
  expect(place(acc('5901', 'expense', { is_system: false, schedule3_line: 'nonsense' }))).toBe('other_expenses');
  expect(place(acc('5104', 'expense', { schedule3_line: 'other_expenses' }))).toBe('stock_cost');
});
test('a parent loop ends at the section default', () => {
  const a = acc('5920', 'expense', { is_system: false, parent_account_id: 'acc-5921' });
  const b = acc('5921', 'expense', { is_system: false, parent_account_id: 'acc-5920' });
  expect(place(a, [b])).toBe('other_expenses');
});
test('amount sign', () => {
  expect(schedule3Amount('other_income', 10, 100)).toBe(90);
  expect(schedule3Amount('other_expenses', 100, 10)).toBe(90);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/lib/accounting/schedule3-lines.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `lib/accounting/schedule3-lines.ts`**

Rule order is spec section 5. A stored line is ignored when it is not in `ASSIGNABLE_SCHEDULE3_LINES` or the account's code is in `SCHEDULE3_LOCKED_CODES`. The seeded-code rule applies when `is_system !== false`, as `effectivePlSection` does. The parent walk checks rules 1 and 2 on each ancestor and keeps a `Set` of visited ids. Section default: `elimination` → `'elimination'`; `operating_income` → `revenue_from_operations`; `other_income` → `other_income`; `operating_expense` → `other_income` for an income account, else `other_expenses`; `cost_of_goods_sold` and `other_expense` → `other_expenses`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/lib/accounting/schedule3-lines.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit** (see Global Constraints)

Files: `lib/accounting/schedule3-lines.ts`, `tests/lib/accounting/schedule3-lines.test.ts`.
Message: `Each income and expense account now resolves to a Schedule III line.`

---

### Task 2: Assemble the statement

**Files:**
- Create: `lib/reports/schedule3-pl.ts`
- Test: `tests/lib/reports/schedule3-pl.test.ts`

**Interfaces:**
- Consumes: Task 1 exports; `assemblePl`, `type PlAccountRow` from `@/lib/reports/profit-loss`; `effectivePlSection`; `type COGSCalculation` from `@/lib/services/cogs-calculator`.
- Produces:

```ts
export type Schedule3AccountRow = PlAccountRow & { schedule3_line: string | null };
export interface StockMovement { code: string; purchases: number; movement: number } // spec section 6: P(code), M(code)
export interface S3Row { id: string | null; account_code: string | null; label: string; amount: number } // id null = computed row
export interface S3LineBlock { key: Schedule3Line; label: string; amount: number; rows: S3Row[] }
export interface Schedule3Statement {
  lines: Record<Schedule3Line, S3LineBlock>;
  total_income: number;
  total_expenses: number;
  elimination_net: number;
  profit_before_exceptional_and_tax: number; // total_income − total_expenses + elimination_net
  profit_before_tax: number;                 // above − exceptional_items
  tax_expense: number;                       // current_tax + deferred_tax
  profit_for_period: number;                 // profit_before_tax − tax_expense
  stock_basis: 'periodic' | 'perpetual';
}
export function assembleSchedule3(
  rows: Schedule3AccountRow[],
  opts: { consolidated: boolean; periodic?: COGSCalculation | null; stock?: StockMovement[] }
): Schedule3Statement;
```

Rules the signature does not fix:
- `stock_basis` is `'periodic'` when `opts.periodic` is given, else `'perpetual'`.
- Elimination: consolidated → those rows leave every line and `elimination_net = Σ(credit − debit)`. Branch view → an income account goes to `revenue_from_operations`, an expense account to `purchases_stock_in_trade`, and `elimination_net = 0`.
- Periodic: drop a row when its code is `5101` or `5102` **and** `effectivePlSection(row) === 'cost_of_goods_sold'` (the same test `assemblePl` uses). Add computed rows `Purchases (net of returns)` = `periodic.purchases.total` on `purchases_stock_in_trade`; `Opening stock` = `+openingStock.value` and `Less: closing stock` = `−closingStock.value` on `changes_in_inventories`. Rows placed `stock_cost` are listed as account rows on `changes_in_inventories`.
- Perpetual: formulas in spec section 6. Computed rows: `Raw material consumed` on `materials_consumed`; `Purchases taken into stock` on `purchases_stock_in_trade`; `Decrease / (increase) in stock` on `changes_in_inventories`. Rows placed `stock_cost` are not listed. A missing `stock` is treated as all zeros.
- Account rows inside a line are flat, sorted by `account_code`, labelled `account_name`; rows under 0.005 in absolute value are left out. Computed rows come first.

- [ ] **Step 1: Write the failing tests**

Use the `row(code, type, group, side, amount, extra)` helper from `tests/lib/reports/profit-loss.test.ts` (copy it; add `schedule3_line: null`).

```ts
const s = (rows, opts) => assembleSchedule3(rows, { consolidated: true, ...opts });
const amt = (st, key) => st.lines[key].amount;

test('a) perpetual trader', () => {
  const st = s([row('4101','income','4100','cr',1000), row('5104','expense','5100','dr',600),
                row('5212','expense','5200','dr',100), row('5210','expense','5200','dr',30)],
               { stock: [{ code: '1104', purchases: 800, movement: 200 }] });
  expect(amt(st,'purchases_stock_in_trade')).toBe(800);
  expect(amt(st,'changes_in_inventories')).toBe(-200);
  expect(amt(st,'employee_benefits')).toBe(100);
  expect(st.total_expenses).toBe(700);
  expect(st.profit_before_tax).toBe(300);
  expect(st.profit_for_period).toBe(270);
  expect(st.stock_basis).toBe('perpetual');
});
test('b) manufacturer', () => {
  const st = s([row('5104','expense','5100','dr',50)],
               { stock: [{ code: '1160', purchases: 100, movement: 30 }, { code: '1162', purchases: 0, movement: 20 }] });
  expect(amt(st,'materials_consumed')).toBe(70);
  expect(amt(st,'purchases_stock_in_trade')).toBe(0);
  expect(amt(st,'changes_in_inventories')).toBe(-20);
});
test('c) stock write-off is counted once', () => {
  const st = s([row('5104','expense','5100','dr',60), row('5106','expense','5100','dr',5)],
               { stock: [{ code: '1104', purchases: 100, movement: 35 }] });
  expect(amt(st,'purchases_stock_in_trade')).toBe(100);
  expect(amt(st,'changes_in_inventories')).toBe(-40);
  expect(amt(st,'other_expenses')).toBe(5);
  expect(st.total_expenses).toBe(65);
});
test('d) periodic books use the stock schedule', () => {
  const periodic = { openingStock: { value: 500 }, purchases: { total: 900 }, closingStock: { value: 300 } } as any;
  const st = s([row('5101','expense','5100','dr',950), row('5102','expense','5100','cr',50)], { periodic });
  expect(amt(st,'purchases_stock_in_trade')).toBe(900);
  expect(amt(st,'changes_in_inventories')).toBe(200);
  expect(st.lines.purchases_stock_in_trade.rows.every((r) => r.id === null)).toBe(true);
  expect(st.stock_basis).toBe('periodic');
});
test('e) inter-branch accounts', () => {
  const rows = [row('4103','income','6000','cr',100), row('5103','expense','6000','dr',90)];
  const all = assembleSchedule3(rows, { consolidated: true });
  expect(all.elimination_net).toBe(10);
  expect(all.total_income).toBe(0);
  expect(all.profit_for_period).toBe(10);
  const branch = assembleSchedule3(rows, { consolidated: false });
  expect(amt(branch,'revenue_from_operations')).toBe(100);
  expect(amt(branch,'purchases_stock_in_trade')).toBe(90);
  expect(branch.elimination_net).toBe(0);
});
test('f) profit equals the Standard report for every seeded code, both models, both views', () => {
  const rows = Object.keys(SYSTEM_PL_SECTIONS).map((code, i) =>
    row(code, code.startsWith('4') ? 'income' : 'expense',
        ['4103','5103'].includes(code) ? '6000' : code.startsWith('4') ? '4100' : code.startsWith('51') ? '5100' : '5200',
        code.startsWith('4') ? 'cr' : 'dr', 1000 + i * 7));
  rows.push(row('5901','expense','5200','dr',333,{ is_system: false }), row('4901','income','4200','cr',444,{ is_system: false }));
  const periodic = { openingStock: { value: 500 }, purchases: { total: 900 }, closingStock: { value: 300 } } as any;
  const stock = [{ code: '1104', purchases: 1234.56, movement: -78.9 }, { code: '1160', purchases: 10, movement: 99 }];
  for (const consolidated of [true, false]) {
    expect(assembleSchedule3(rows, { consolidated, stock }).profit_for_period)
      .toBe(assemblePl(rows, { consolidated }).net_profit);
    expect(assembleSchedule3(rows, { consolidated, periodic }).profit_for_period)
      .toBe(assemblePl(rows, { consolidated, periodic }).net_profit);
  }
});
test('g) no stock figures: cost stays in changes in inventories', () => {
  const st = s([row('5104','expense','5100','dr',60)], {});
  expect(amt(st,'changes_in_inventories')).toBe(60);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/lib/reports/schedule3-pl.test.ts`
Expected: FAIL, `assembleSchedule3` is not exported.

- [ ] **Step 3: Implement `assembleSchedule3` in `lib/reports/schedule3-pl.ts`**

Build `byId` once and call `effectiveSchedule3Placement` per row. Mock `@/lib/db`, `@/lib/services/cogs-calculator` and `@/lib/inventory/cogs-posting` at the top of the test file, as `tests/lib/reports/profit-loss.test.ts` does.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/lib/reports/schedule3-pl.test.ts tests/lib/reports/profit-loss.test.ts`
Expected: PASS, both files.

- [ ] **Step 5: Commit** (see Global Constraints)

Files: `lib/reports/schedule3-pl.ts`, `tests/lib/reports/schedule3-pl.test.ts`.
Message: `The Schedule III statement is assembled from the same account movements as the Profit & Loss and reaches the same profit.`

---

### Task 3: Load stock movements and build the report

**Files:**
- Modify: `lib/reports/schedule3-pl.ts`
- Test: `tests/db/schedule3-pl.db.test.ts`

**Interfaces:**
- Consumes: `loadPlAccounts`, `assemblePl`, `type BuildPlOptions` from `@/lib/reports/profit-loss`; `getInventoryModel` from `@/lib/inventory/cogs-posting`; `calculateCOGS` from `@/lib/services/cogs-calculator`; `INVENTORY_ACCOUNT_CODES` from `@/lib/inventory/stock-class`; `previousFinancialYear`.
- Produces:

```ts
export const STOCK_PURCHASE_VOUCHER_TYPES = ['purchase', 'purchase_return', 'debit_note'] as const;
export async function loadStockMovements(opts: BuildPlOptions): Promise<StockMovement[]>;
export async function loadSchedule3Overrides(businessId: string): Promise<Map<string, string>>; // account id → stored line
export interface Schedule3Report { statement: Schedule3Statement; standard_net_profit: number; difference: number }
export async function buildSchedule3(opts: BuildPlOptions): Promise<Schedule3Report>;
```

- `loadStockMovements`: one query over `ledger_entry_lines` joined to `accounts` on `account_code = ANY(INVENTORY_ACCOUNT_CODES)`, with the same date filter, `voucher_type <> 'year_close'` and branch clause as `loadPlAccounts`. `purchases` = `SUM(debit − credit) FILTER (WHERE voucher_type = ANY(STOCK_PURCHASE_VOUCHER_TYPES))`; `movement` = `SUM(debit − credit)`.
- `loadSchedule3Overrides`: reads `to_jsonb(a) ->> 'schedule3_line'` so it works before the Task 6 migration.
- `buildSchedule3`: `loadPlAccounts` → attach overrides → `getInventoryModel`. Periodic: `calculateCOGS(businessId, fromDate, toDate, fy, previousFinancialYear(fy))` inside the same try/catch as `buildProfitAndLoss`; perpetual: `loadStockMovements`. `standard_net_profit = assemblePl(rows, { consolidated, periodic }).net_profit`; `difference = profit_for_period − standard_net_profit`.

- [ ] **Step 1: Write the failing real-DB test**

Copy the setup of `tests/db/pl-tb-bs-agreement.db.test.ts` (skip without `PHASE2_TEST_DATABASE_URL`, new business, branch and user, cleanup in `afterAll`). Give its `post` helper a `voucherType` argument. Accounts with codes `1101`, `1104`, `2101`, `4101`, `5104`, `5106`, `5212`, all in September 2026:

| Voucher type | Dr | Cr | Amount |
|---|---|---|---|
| `purchase` | 1104 | 2101 | 800 |
| `purchase_return` | 2101 | 1104 | 50 |
| `invoice` | 1101 | 4101 | 1000 |
| `invoice` | 5104 | 1104 | 600 |
| `stock_adjustment` | 5106 | 1104 | 20 |
| `journal` | 5212 | 1101 | 100 |

```ts
const opts = { businessId: B, fromDate: '2026-04-01', toDate: '2026-09-30', branch: { kind: 'all' } as const, consolidated: true };
const stock = await loadStockMovements(opts);
expect(stock).toEqual([{ code: '1104', purchases: 750, movement: 130 }]);
const r = await buildSchedule3(opts);
expect(r.statement.lines.purchases_stock_in_trade.amount).toBe(750);
expect(r.statement.lines.changes_in_inventories.amount).toBe(-150);
expect(r.statement.lines.other_expenses.amount).toBe(20);
expect(r.statement.profit_for_period).toBe(280);
expect(r.difference).toBe(0);
expect(r.standard_net_profit).toBe((await buildProfitAndLoss(opts)).net_profit);
// a branch the business does not have sees nothing
expect(await loadStockMovements({ ...opts, branch: { kind: 'branches', branchIds: [randomUUID()], includeUnbranched: false } })).toEqual([]);
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/db/schedule3-pl.db.test.ts --runInBand`
Expected: FAIL, `loadStockMovements` is not exported.

- [ ] **Step 3: Implement the three functions**

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/db/schedule3-pl.db.test.ts tests/lib/reports/schedule3-pl.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit** (see Global Constraints)

Files: `lib/reports/schedule3-pl.ts`, `tests/db/schedule3-pl.db.test.ts`.
Message: `The Schedule III report reads purchases and stock change from the stock ledgers.`

---

### Task 4: API route with a previous-year column

**Files:**
- Create: `lib/reports/pl-request-scope.ts`, `app/api/reports/profit-loss/schedule-iii/route.ts`
- Modify: `lib/reports/schedule3-pl.ts` (add `shiftYearBack`), `tests/db/phase3c-identity-fallback.db.test.ts` (add the route to its route table beside `reports/profit-loss`)
- Test: `tests/lib/reports/schedule3-pl.test.ts`, `tests/db/schedule3-pl.db.test.ts`

**Interfaces:**
- Consumes: `buildSchedule3`, `type Schedule3Statement` (Task 3); `type BranchScope`, `previousFinancialYear`.
- Produces:

```ts
// lib/reports/schedule3-pl.ts
export function shiftYearBack(iso: string): string; // '2026-09-30' → '2025-09-30'; '2024-02-29' → '2023-02-28'

// lib/reports/pl-request-scope.ts
export interface PlRequestScope {
  businessId: string; userId: string;
  fromDate: string; toDate: string; financialYear: string | null;
  branch: BranchScope; consolidated: boolean;
  branchInfo: { id: string; name: string; branch_code: string | null; gstin: string | null } | null;
}
export async function resolvePlRequestScope(request: NextRequest): Promise<PlRequestScope | NextResponse>;
```

`resolvePlRequestScope` repeats the checks of `app/api/reports/profit-loss/route.ts` lines 49–150 in the same order with the same status codes and bodies: missing business 400, missing user 400, `checkEmployeeAccessBoundary` 403, `assertReportAccess(businessId, 'advanced')`, branch resolution, `authorize(userId, 'report.financial', 'read', …)`, default dates. The existing route keeps its own copy.

Response of `GET /api/reports/profit-loss/schedule-iii` (query: `from_date`, `to_date`, `financial_year`, `branch_id`):

```ts
{
  period: { from_date: string; to_date: string; financial_year: string | null };
  previous_period: { from_date: string; to_date: string };
  branch: PlRequestScope['branchInfo'];
  is_consolidated: boolean;
  current: Schedule3Statement;
  previous: Schedule3Statement;
  agreement: { standard_net_profit: number; difference: number }; // current period
}
```

The previous period is `shiftYearBack` of both dates with `previousFinancialYear(financialYear) ?? null`. Errors return `{ error }` with status 500, as the existing route does.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/lib/reports/schedule3-pl.test.ts
test('shiftYearBack', () => {
  expect(shiftYearBack('2026-09-30')).toBe('2025-09-30');
  expect(shiftYearBack('2024-02-29')).toBe('2023-02-28');
  expect(shiftYearBack('2026-04-01')).toBe('2025-04-01');
});
```

In `tests/db/schedule3-pl.db.test.ts`, add the mocks for `@/lib/jwt`, `@/lib/authorization` and `@/lib/subscription/feature-access` and the `get` helper from `tests/db/pl-tb-bs-agreement.db.test.ts`, then:

```ts
const q = { from_date: '2026-04-01', to_date: '2026-09-30' };
const s3 = await get(scheduleIII, '/api/reports/profit-loss/schedule-iii', q);
const std = await get(profitLoss, '/api/reports/profit-loss', q);
expect(s3.status).toBe(200);
expect(s3.json.current.profit_for_period).toBe(std.json.net_profit);
expect(s3.json.agreement).toEqual({ standard_net_profit: std.json.net_profit, difference: 0 });
expect(s3.json.previous_period).toEqual({ from_date: '2025-04-01', to_date: '2025-09-30' });
expect(s3.json.previous.profit_for_period).toBe(0);
expect(s3.json.previous.total_income).toBe(0);
// a query-string business is ignored: no session headers → 400
const bare = await scheduleIII(new NextRequest(`http://localhost/api/reports/profit-loss/schedule-iii?business_id=${B}&user_id=${U}`));
expect(bare.status).toBe(400);
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/lib/reports/schedule3-pl.test.ts tests/db/schedule3-pl.db.test.ts --runInBand`
Expected: FAIL, `shiftYearBack` and the route module are missing.

- [ ] **Step 3: Implement `shiftYearBack`, `resolvePlRequestScope` and the route**

`shiftYearBack` works on the string parts, not `Date`, so a server in IST cannot shift the day.

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/lib/reports/schedule3-pl.test.ts tests/db/schedule3-pl.db.test.ts tests/db/phase3c-identity-fallback.db.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit** (see Global Constraints)

Files: the two new files, `lib/reports/schedule3-pl.ts`, the three test files.
Message: `The Schedule III statement is served for a period and the same dates a year earlier.`

---

### Task 5: The Schedule III tab and page

**Files:**
- Create: `components/reports/ProfitLossTabs.tsx`, `app/(app)/reports/profit-loss/layout.tsx`, `app/(app)/reports/profit-loss/schedule-iii/page.tsx`
- Modify: `lib/mobile-route-title.ts` (after line 156), `lib/breadcrumb-utils.ts` (after line 39), `e2e/routes.json` (after line 158), `tests/lib/nav-active.test.ts`

**Interfaces:**
- Consumes: the Task 4 response; `ProfitLossDrilldownPanel` and `type DrillTarget` (unchanged); `SCHEDULE3_LINE_LABELS`, `CREDIT_LINES`.
- Produces: page at `/reports/profit-loss/schedule-iii`; `ProfitLossTabs` (no props).

Decisions:
- `ProfitLossTabs` is a client component using `usePathname`. It renders two links, `Standard` → `/reports/profit-loss` (`data-testid="pl-tab-standard"`) and `Schedule III` → `/reports/profit-loss/schedule-iii` (`data-testid="pl-tab-schedule-iii"`), with `aria-current="page"` on the active one. On any other path (the validation page) it renders nothing.
- `layout.tsx` renders `<ProfitLossTabs />` then `{children}`. Nothing else.
- The page is wrapped `withPageAuth('reports', 'read', …)`, uses the same default dates and `buildApiUrl` call pattern as the Standard page, and `MobileReportHeader` with title `Profit and Loss (Schedule III)`. No Print, PDF or Excel buttons.
- Table columns: `Particulars`, current period end date, previous period end date (format `dd MMM yyyy`). Rows and labels: spec section 4. Roman-numbered rows are bold. A nil amount shows `–`.
- A line row expands to its `rows`. Match current and previous rows by `id`, or by `label` when `id` is null; a row present on one side only shows `–` on the other.
- Clicking an account row's current amount opens `ProfitLossDrilldownPanel` with `{ kind: 'account', label, accountIds: [id], section }`, where `section` is `'operating_income'` for lines in `CREDIT_LINES` and `'operating_expense'` otherwise (the panel uses it only for the sign). Computed rows are not clickable.
- Under the table, in this order:
  - `Schedule III (Division I) layout under the Companies Act, 2013. Same books as the Standard tab; only the grouping differs.`
  - When `current.stock_basis === 'perpetual'`: `Changes in inventories is worked out as cost of goods sold less purchases taken into stock.`
  - `Earnings per share is not shown because share details are not kept in Khatario.`
  - `data-testid="s3-agreement"`: `Agrees with the Standard Profit & Loss.` when `|difference| < 0.01`, else `Differs from the Standard Profit & Loss by ₹<difference>. Please report this.`
- `data-testid` on amounts: `s3-line-<key>` for each line, `s3-profit-for-period` for row XV, each with `data-value`.
- `lib/mobile-route-title.ts`: `if (p === '/reports/profit-loss/schedule-iii') return 'P&L (Schedule III)';`
- `lib/breadcrumb-utils.ts`: `'/reports/profit-loss/schedule-iii': { label: 'Schedule III', parent: '/reports/profit-loss' },`
- `e2e/routes.json`: add `"/reports/profit-loss/schedule-iii"`.

- [ ] **Step 1: Write the failing test**

In `tests/lib/nav-active.test.ts`, beside the existing `/reports/profit-loss` assertion:

```ts
expect(active('/reports/profit-loss/schedule-iii')).toBe('/reports/profit-loss');
```

- [ ] **Step 2: Run it**

Run: `npx jest tests/lib/nav-active.test.ts`
Expected: PASS if the sidebar matches by prefix. If it fails, the sidebar would not highlight Profit & Loss on the new tab: fix the matcher that test covers so a sub-path keeps its parent active, and re-run.

- [ ] **Step 3: Build the tabs, layout and page; register the route**

- [ ] **Step 4: Type-check the new files**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "schedule-iii|ProfitLossTabs|profit-loss/layout|schedule3"`
Expected: no output.

- [ ] **Step 5: Confirm the Standard page is untouched**

Run: `git diff --stat -- "app/(app)/reports/profit-loss/page.tsx" app/api/reports/profit-loss/route.ts lib/reports/profit-loss.ts`
Expected: no output.

- [ ] **Step 6: Commit** (see Global Constraints)

Files: the three new files, the three registrations, `tests/lib/nav-active.test.ts`.
Message: `Profit & Loss has a Schedule III tab beside the Standard view.`

---

### Task 6: Let the owner move an account to another line (database and API)

**Files:**
- Create: `database/migrations/467_accounts_schedule3_line.sql`, `lib/accounting/schedule3-column.ts`
- Modify: `app/api/accounts/[id]/route.ts` (field sets at lines 22–35; validation beside the `pl_section` block at line 241; activity log beside line 345; the GET select)
- Test: `tests/db/accounts-schedule3-line.db.test.ts`

**Interfaces:**
- Consumes: `isAssignableSchedule3Line`, `ASSIGNABLE_SCHEDULE3_LINES`, `SCHEDULE3_LOCKED_CODES`, `SCHEDULE3_LINE_LABELS`; `buildSchedule3`.
- Produces: column `accounts.schedule3_line VARCHAR(40) NULL`; `hasSchedule3LineColumn(): Promise<boolean>` (same shape as `hasPlSectionColumn` in `lib/accounting/pl-section-column.ts`); `PATCH /api/accounts/[id]` accepts `schedule3_line: string | null`; `GET /api/accounts/[id]` returns `schedule3_line`.

Migration (re-runnable, no backfill; NULL means "use the default"):

```sql
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS schedule3_line VARCHAR(40);
COMMENT ON COLUMN accounts.schedule3_line IS
  'Schedule III Profit & Loss line chosen by the owner; NULL = default rule in lib/accounting/schedule3-lines.ts. Reports only.';
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_schedule3_line_check;
ALTER TABLE accounts ADD CONSTRAINT accounts_schedule3_line_check CHECK (
  schedule3_line IS NULL OR (
    account_type IN ('income', 'expense') AND schedule3_line IN (
      'revenue_from_operations', 'other_income', 'purchases_stock_in_trade', 'employee_benefits',
      'finance_costs', 'depreciation_amortisation', 'other_expenses', 'exceptional_items',
      'current_tax', 'deferred_tax')));
```

PATCH rules for `schedule3_line`, in this order:

| Case | Result |
|---|---|
| `null` or `''` | Stored as NULL |
| Account is not income or expense | 400 `INVALID_SCHEDULE3_LINE` |
| Value not in `ASSIGNABLE_SCHEDULE3_LINES` | 400 `INVALID_SCHEDULE3_LINE` |
| Account code in `SCHEDULE3_LOCKED_CODES` | 400 `SCHEDULE3_LINE_LOCKED` |
| Column missing | 409 `SCHEDULE3_LINE_UNAVAILABLE`, message `Changing the Schedule III line needs database migration 467.` |

Add `schedule3_line` to `EDITABLE_FIELDS` and to `SYSTEM_EDITABLE_FIELDS` (a seeded account such as Bank Charges may be moved; its Standard section stays locked). Activity log text: `Moved <code> <name> in Schedule III to <label, or "default">`.

- [ ] **Step 1: Apply the migration to `kh_phase2_test` only, then write the failing test**

Follow the mocks and request helper of `tests/db/account-hierarchy-integrity.db.test.ts`. New business with accounts `5217` (system), `5104` (system), `1101` (asset), `5901` (user expense, 250 debit in the period against `1101`).

```ts
expect((await patch(id5901, { schedule3_line: 'finance_costs' })).status).toBe(200);
const r = await buildSchedule3(opts);
expect(r.statement.lines.finance_costs.amount).toBe(250);
expect(r.statement.lines.other_expenses.amount).toBe(0);
expect(r.difference).toBe(0);
expect((await patch(id5217, { schedule3_line: 'finance_costs' })).status).toBe(200);          // system account allowed
expect((await patch(id5901, { schedule3_line: 'changes_in_inventories' })).json.code).toBe('INVALID_SCHEDULE3_LINE');
expect((await patch(id5104, { schedule3_line: 'other_expenses' })).json.code).toBe('SCHEDULE3_LINE_LOCKED');
expect((await patch(id1101, { schedule3_line: 'other_expenses' })).json.code).toBe('INVALID_SCHEDULE3_LINE');
expect((await patch(id5901, { schedule3_line: null })).status).toBe(200);
expect((await buildSchedule3(opts)).statement.lines.other_expenses.amount).toBe(250);
expect((await getAccount(id5901)).json.schedule3_line ?? null).toBeNull();
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx jest tests/db/accounts-schedule3-line.db.test.ts --runInBand`
Expected: FAIL on the first PATCH (field not accepted).

- [ ] **Step 3: Implement `hasSchedule3LineColumn` and the route changes**

- [ ] **Step 4: Run to verify it passes**

Run: `npx jest tests/db/accounts-schedule3-line.db.test.ts tests/db/account-hierarchy-integrity.db.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit** (see Global Constraints)

Files: the migration, `lib/accounting/schedule3-column.ts`, `app/api/accounts/[id]/route.ts`, the test.
Message: `An account can be moved to another Schedule III line without changing the Standard Profit & Loss; migration 467 is written and not applied.`

---

### Task 7: Line picker on the account page

**Files:**
- Create: `components/accounts/Schedule3LineSelect.tsx`
- Modify: `app/(app)/accounts/[id]/page.tsx` (below the P&L section block that ends at line 239)

**Interfaces:**
- Consumes: `ASSIGNABLE_SCHEDULE3_LINES`, `SCHEDULE3_LINE_LABELS`, `SCHEDULE3_LOCKED_CODES`; PATCH from Task 6.
- Produces: `Schedule3LineSelect({ value, onChange, disabled }: { value: Schedule3Line | ''; onChange: (v: Schedule3Line | '') => void; disabled?: boolean })`.

Decisions:
- Model the component on `components/accounts/PlSectionSelect.tsx`. Label `Schedule III line`. First option `Default` (value `''`), then the assignable lines by label.
- Show it only for income and expense accounts. For a code in `SCHEDULE3_LOCKED_CODES`, show the text `This account is placed by the system in the Schedule III view.` and no picker.
- Button `Save line` sends `PATCH { schedule3_line: value || null }` the way `savePlSection` does. Success text: `Saved. The Schedule III tab uses the new line.` Failure shows the API's `error`.
- The existing P&L section picker and its Save button are not changed.

- [ ] **Step 1: Build the component and add it to the page**

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "Schedule3LineSelect|accounts/\[id\]/page"`
Expected: no output.

- [ ] **Step 3: Commit** (see Global Constraints)

Files: `components/accounts/Schedule3LineSelect.tsx`, `app/(app)/accounts/[id]/page.tsx`.
Message: `The account page lets the owner choose the Schedule III line.`

---

### Task 8: Final checks and hand-over

- [ ] **Step 1: The Standard report is untouched**

Run: `git diff --stat -- lib/reports/profit-loss.ts lib/accounting/pl-sections.ts app/api/reports/profit-loss/route.ts app/api/reports/profit-loss/pdf app/api/reports/profit-loss/excel app/api/reports/profit-loss/drilldown "app/(app)/reports/profit-loss/page.tsx" components/reports/ProfitLossDrilldownPanel.tsx lib/export/profit-loss-excel.ts templates/reports/profit_loss lib/services/cogs-calculator.ts`
Expected: no output. If commits were made, run the same with `git diff --stat <first-commit>^ HEAD --`.

- [ ] **Step 2: Run every test this work touches**

Run: `npx jest tests/lib/accounting/schedule3-lines.test.ts tests/lib/reports tests/lib/export/profit-loss-excel.test.ts tests/lib/nav-active.test.ts`
Run: `npx jest tests/db/schedule3-pl.db.test.ts tests/db/accounts-schedule3-line.db.test.ts tests/db/pl-tb-bs-agreement.db.test.ts tests/db/account-hierarchy-integrity.db.test.ts tests/db/phase3c-identity-fallback.db.test.ts --runInBand`
Expected: PASS. Report any failure with its output.

- [ ] **Step 3: Refresh the code graph**

Run: `graphify update .`

- [ ] **Step 4: Append the session entry to `docs/project.log.md` and move the roadmap card**

State that migration 467 is written and not applied, and list the staging checklist below as open.

## Staging checklist (after deploy, migration 467 applied with the owner's approval)

1. Open Reports → Profit and Loss. The page looks and totals exactly as before; two tabs sit above it.
2. Schedule III tab, current financial year: the last line reads "Agrees with the Standard Profit & Loss." and row XV equals Net Profit/Loss on the Standard tab.
3. Change the dates on both tabs to last financial year: the two profits still match.
4. Pick one branch in the branch selector: profits match; inter-branch sales appear under Revenue from operations.
5. Expand Employee benefits expense, click Salaries & Wages: the drill-down lists the vouchers and its total equals the row.
6. On a business with stock: Purchases of stock-in-trade equals the purchases taken into stock for the period, and a stock write-off appears once, under Other expenses.
7. Open an expense account such as "Loan interest", set Schedule III line to Finance costs, save. The amount moves from Other expenses to Finance costs; row XV and the Standard tab do not change.
8. Open Cost of Goods Sold (5104): no picker, only the "placed by the system" text.
9. Phone width: tabs fit on one row and the table scrolls sideways inside its card, not the page.
10. Added after the final review. A manufacturing business with raw-material opening stock: Cost of materials consumed equals opening raw material + purchases − closing raw material, and is not short by the opening stock.
11. Added after the final review. Pick a branch that receives stock transfers from another branch: the goods received show under Purchases of stock-in-trade, not as a decrease in stock.

## Changes made after the final review

The stock rules in Task 2 and Task 3 above were amended; spec section 6 holds the current rules.

- Purchase voucher types are `purchase` and `purchase_return`. `debit_note` was removed (a customer document here). A single-branch view also counts `inter_branch_receipt`.
- Stock movement leaves out `opening_stock` and `opening_balance` vouchers.
- On periodic books the closing-stock row is the balancing figure, so the three rows add up to the Standard report's rounded cost.
