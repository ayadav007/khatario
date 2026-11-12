# Customer Receivable Accounts by Category Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A customer can be assigned a receivable account under Accounts Receivable (Domestic Debtors, Foreign Debtors, ...), their documents post to it, and moving a customer transfers their balance that day.

**Architecture:** One module decides which accounts are receivable accounts and which one a customer uses. Every customer posting asks it; a reversal of a customer's receivable line is redirected to the customer's current account, so an old account is settled once by a transfer voucher and never touched again. Reports select receivable lines by account id set instead of by code pattern.

**Tech Stack:** Next.js route handlers, TypeScript, PostgreSQL (`pg`), Jest (`ts-jest`) with real-DB tests on `kh_phase2_test`.

**Spec:** `docs/superpowers/specs/2026-11-10-customer-receivable-accounts-design.md`. Read it before Task 1.

## Global Constraints

- Migration number is **468** (467 is taken by the Schedule III P&L plan). If 468 exists when you start, use the next free number and rename everywhere.
- Never run a migration against staging or production. DB tests apply the migration themselves on `kh_phase2_test` (localhost, port 5433).
- Business and user come from the session (`requireStrictSession`). Never read `business_id`, `user_id` or `created_by` from a request body.
- `customers.receivable_account_id` NULL means the control account (mapped `accounts_receivable_account_id`, else code `1103`).
- Rule 4.2 of the spec, verbatim: every receivable line written for a customer goes to that customer's current account; lines already written never move.
- Transfer voucher type is `receivable_transfer`; its `voucher_id` is the `customer_receivable_account_moves.id`; it is dated with the database's `CURRENT_DATE` (`currentReversalDate` in `lib/accounting/payment-reversal.ts`).
- Error codes, exact: `RECEIVABLE_ACCOUNT_INVALID` (400), `PERIOD_LOCKED` (400), `ACCOUNT_IN_USE_BY_CUSTOMERS` (400).
- Bulk move limit: 500 customers per request.
- Commit only if the owner has asked for commits in this run. Stage files by name; never `git add .`.
- Before exploring code, use the graph: `graphify explain "<symbol>"`. After changing code, run `graphify update .`.
- No browser checks on staging or production by the executor; UI is verified by typecheck, lint and the staging checklist the owner runs.

## Review Focus

1. **A posting that races a move.** An invoice saved while the customer is being moved must not leave a line in the old account. Expected: the resolver's `FOR KEY SHARE` lock and the move's `FOR UPDATE` lock on the customer row serialise them; test in Task 5. The resolver must not take `FOR SHARE`: two invoices for the same customer would then deadlock when each updates `customers.current_balance`.
2. **A receipt recorded at invoice time** (voucher type `payment` whose `voucher_id` is the invoice id, no `payments` row). Expected: `customerIdForVoucher` still finds the customer; test in Task 4.
3. **A customer whose saved account was deactivated directly in the database or moved out by an older code path.** Expected: postings fall back to the control account, no error; test in Task 3.
4. **A business whose receivable mapping points at an account that is not `1103`.** Expected: the set is built from the mapped account and reports agree; test in Task 2.
5. **Reversing a payment after a move** (`executePaymentReversal`). Expected: the credit to receivables is undone in the new account; test in Task 6.

## File Structure

| File | Responsibility |
|---|---|
| `database/migrations/468_customer_receivable_accounts.sql` (create) | Column on `customers`, table `customer_receivable_account_moves` |
| `lib/accounting/receivable-accounts.ts` (create) | Which accounts are receivable; which one a customer uses; target validation; in-use guard |
| `lib/accounting/customer-vouchers.ts` (create) | Voucher → customer mapping; a customer's balance per receivable account |
| `lib/accounting/receivable-account-move.ts` (create) | Move a customer and post the transfer |
| `lib/ledger-utils.ts`, `lib/accounting/advances.ts`, `lib/accounting/advance-service.ts`, `lib/credit-notes/refund.ts` (modify) | Post to the customer's account |
| `lib/ledger-reversal.ts` (modify) | Redirect a customer's receivable mirror line |
| `lib/reports/party-ledger-docs.ts`, `app/api/reports/party/statement/route.ts`, `lib/reports/balance-sheet.ts`, `lib/reports/cash-flow.ts`, `lib/reports/dashboard-cash-flow.ts` and their loaders (modify) | Read the set |
| `app/api/accounts/[id]/route.ts` (modify) | In-use guard |
| `app/api/customers/**` (modify, create) | Field on create, move endpoint, bulk endpoint, account list, list filter |
| `lib/reports/aging-report-route.ts` (modify) | Account per row, filter, subtotals |
| `components/customers/ReceivableAccountPicker.tsx`, `components/customers/BulkReceivableAccountDialog.tsx` (create) | UI |
| `tests/lib/accounting/receivable-accounts.test.ts`, `tests/db/customer-receivable-accounts.db.test.ts` (create) | Tests |

**DB test harness** (used from Task 2 on, built once in Task 2): copy from `tests/db/account-hierarchy-integrity.db.test.ts` the functions `readEnvFile`, `forceDisposableDatabase`, the `next/headers`, `@/lib/jwt` and `@/lib/platform-jwt` mocks, `session()`, `call()` and the `beforeAll` database check and business seeding. Copy from `tests/db/ageing-zoho-scenario.db.test.ts` the helpers `tx`, `invoice` and the credit-note block, and the `afterAll` purge with `withLedgerDelete(c, 'tenant_purge', …)`. Business name prefix: `CRA `. Tests in one file run in task order and share data; a test that names a customer not created in Task 2 (`CO`, `CZ`, `CM`) inserts it at its own start. Shared helpers, added when first needed: `arLines(voucherType, voucherId)` and `arLinesOfType(voucherType)` return `Array<{ account_id: string; debit: number; credit: number }>` for business `A`'s lines on `[AR, DOM, NORTH, FOR]` (the second for every voucher of that type, newest first); `bal(customerId)` returns `customerReceivableBalances` over those four accounts; `ledgerNet(accountId)` returns the account's raw `SUM(debit - credit)`. Run with:

```bash
npx jest tests/db/customer-receivable-accounts.db.test.ts --runInBand
```

---

### Task 1: Reproduce the "cannot create a sub-account under a sub-account" report

**Files:**
- Test: `tests/db/account-hierarchy-integrity.db.test.ts` (existing, read only)
- Modify: only what the reproduction points to

- [ ] **Step 1: Confirm the API allows three levels**

Run: `npx jest tests/db/account-hierarchy-integrity.db.test.ts --runInBand -t "posts a child ledger once"`
Expected: PASS. That test creates Parent → Child → Grand through `POST /api/accounts`.

- [ ] **Step 2: Try the screen once on localhost**

Start the dev server with `preview_start`, sign in with a local debug OTP phone (memory `test-login-accounts`), open `/accounts`, create an asset account under group 1100, tick "Make this a sub-account", pick `1103 Accounts Receivable`, save; then create another and pick the one just created as its parent.
Expected: either both save, or you have the exact step and message that fails.

- [ ] **Step 3: Act on the result**

If it fails: write a failing test for the cause (a pure-function test if it is in `ParentAccountPicker` option filtering or `AccountCreateForm` validation; a DB test if it is the route), fix it, run the test to PASS.
If it does not fail: change nothing, record "not reproduced on localhost" in `docs/project.log.md`, and ask the owner for the screen and the message. Continue with Task 2 either way.

---

### Task 2: Migration, the receivable set, and target validation

**Files:**
- Create: `database/migrations/468_customer_receivable_accounts.sql`
- Create: `lib/accounting/receivable-accounts.ts`
- Modify: `types/database.ts` (`Customer`: add `receivable_account_id?: string | null`)
- Test: `tests/lib/accounting/receivable-accounts.test.ts`, `tests/db/customer-receivable-accounts.db.test.ts`

**Interfaces:**
- Consumes: `descendantIds(links, accountId)` from `lib/accounting/account-hierarchy.ts`; `getMappedAccountId(businessId, key, code, name)` from `lib/account-mappings.ts`.
- Produces:

```ts
export class ReceivableAccountError extends Error {
  constructor(message: string, public code: string, public status = 400) { super(message); }
}
export type ReceivableAccountNode = {
  id: string; account_code: string; account_name: string;
  parent_account_id: string | null; is_active: boolean;
};
/** Control account, its descendants, and any account whose code starts with "1103". Pure. */
export function collectReceivableAccountIds(
  accounts: Array<{ id: string; account_code: string; parent_account_id: string | null }>,
  controlId: string,
): string[];
export async function receivableControlAccountId(businessId: string): Promise<string>;
export async function receivableAccountIds(businessId: string, client?: PoolClient): Promise<string[]>;
export async function listReceivableAccounts(businessId: string): Promise<{ controlAccountId: string; accounts: ReceivableAccountNode[] }>;
/** Returns the effective account id: `accountId`, or the control account when null. Throws RECEIVABLE_ACCOUNT_INVALID. */
export async function assertReceivableTarget(businessId: string, accountId: string | null, client?: PoolClient): Promise<string>;
```

- [ ] **Step 1: Write the migration**

The SQL in spec section 3, with `gen_random_uuid()` if the latest migrations use it instead of `uuid_generate_v4()` (check `database/migrations/46*.sql`). Header comment in the style of `466_…sql`: number, description, "Safe to run more than once", created date.

- [ ] **Step 2: Write the failing unit test**

```ts
import { collectReceivableAccountIds } from '@/lib/accounting/receivable-accounts';

const acc = (id: string, code: string, parent: string | null = null) => ({ id, account_code: code, parent_account_id: parent });

test('control account, descendants at any depth, and legacy 1103-prefixed codes', () => {
  const ids = collectReceivableAccountIds(
    [acc('ar', '1103'), acc('dom', 'DOM', 'ar'), acc('north', 'N1', 'dom'), acc('legacy', '110301'), acc('cash', '1101'), acc('tds', '1116')],
    'ar',
  );
  expect(new Set(ids)).toEqual(new Set(['ar', 'dom', 'north', 'legacy']));
});

test('a mapped control account that is not 1103 still anchors the set', () => {
  const ids = collectReceivableAccountIds([acc('m', '1190'), acc('kid', 'K', 'm'), acc('old', '1103')], 'm');
  expect(new Set(ids)).toEqual(new Set(['m', 'kid', 'old']));
});

test('a loop in parent links does not hang', () => {
  const ids = collectReceivableAccountIds([acc('ar', '1103', 'x'), acc('x', 'X', 'ar')], 'ar');
  expect(new Set(ids)).toEqual(new Set(['ar', 'x']));
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx jest tests/lib/accounting/receivable-accounts.test.ts`
Expected: FAIL, cannot find module.

- [ ] **Step 4: Implement `lib/accounting/receivable-accounts.ts`**

`receivableControlAccountId` uses `getMappedAccountId(businessId, 'accounts_receivable_account_id', '1103', 'Accounts Receivable')` and throws `ReceivableAccountError('Accounts Receivable account not found', 'RECEIVABLE_CONTROL_MISSING', 500)` when null. The async functions read `id, account_code, account_name, parent_account_id, is_active, account_type` from `accounts WHERE business_id = $1`, through `client` when given, else `queryRows`. `assertReceivableTarget` refuses an id that is not in the set, not active, or not `account_type = 'asset'`.

- [ ] **Step 5: Run the unit test to verify it passes**

Run: `npx jest tests/lib/accounting/receivable-accounts.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Create the DB test file with the harness and the first tests**

`beforeAll` also runs the migration twice (`tx((c) => c.query(migration468))` two times), creates businesses `A` and `B`, three customers `CD`, `CF`, `CU` in `A` and one in `B`, and through `POST /api/accounts` the accounts `Domestic Debtors` (parent `1103`), `North Zone` (parent Domestic) and `Foreign Debtors` (parent `1103`), all `account_type: 'asset'`, group `1100`, `nature: 'debit'`. Keep their ids as `DOM`, `NORTH`, `FOR`, and `AR` for `1103`.

```ts
test('three levels of sub-accounts are created and form the receivable set', async () => {
  expect(new Set(await receivableAccountIds(A))).toEqual(new Set([AR, DOM, NORTH, FOR]));
});

test('target validation', async () => {
  await expect(assertReceivableTarget(A, null)).resolves.toBe(AR);
  await expect(assertReceivableTarget(A, NORTH)).resolves.toBe(NORTH);
  const cash = await accountByCode(A, '1101');
  await expect(assertReceivableTarget(A, cash.id)).rejects.toMatchObject({ code: 'RECEIVABLE_ACCOUNT_INVALID' });
  const foreignAr = await accountByCode(B, '1103');
  await expect(assertReceivableTarget(A, foreignAr.id)).rejects.toMatchObject({ code: 'RECEIVABLE_ACCOUNT_INVALID' });
});
```

- [ ] **Step 7: Run the DB test**

Run the harness command. Expected: PASS, 2 tests.

- [ ] **Step 8: Commit** (if asked): the migration, `lib/accounting/receivable-accounts.ts`, `types/database.ts`, both test files.

---

### Task 3: Post customer documents to the customer's account

**Files:**
- Modify: `lib/accounting/receivable-accounts.ts`
- Modify: `lib/ledger-utils.ts` (`getDefaultAccounts` at line 109; callers at 450, 731, 1704, 2229, 2408)
- Modify: `lib/accounting/advances.ts` (`loadAdvanceAccounts`, line 195), `lib/accounting/advance-service.ts` (line 329), `lib/credit-notes/refund.ts` (line 110)
- Test: `tests/db/customer-receivable-accounts.db.test.ts`

**Interfaces:**
- Produces:

```ts
/** The customer's account when set, active and in the set; else the control account. Locks the customer row FOR KEY SHARE when `client` is given. */
export async function resolveCustomerReceivableAccountId(
  businessId: string, customerId: string | null | undefined, client?: PoolClient,
): Promise<string>;

// lib/ledger-utils.ts
export async function getDefaultAccounts(
  businessId: string,
  opts?: { customerId?: string | null; poolClient?: PoolClient },
): Promise<{ /* unchanged shape */ }>;

// lib/accounting/advances.ts
export async function loadAdvanceAccounts(client: PoolClient, businessId: string, customerId?: string | null): Promise<AdvanceAccounts>;
```

- [ ] **Step 1: Write the failing tests**

Set accounts directly for this task: `UPDATE customers SET receivable_account_id = $1` (`CD` → `DOM`, `CF` → `FOR`, `CU` stays NULL).

```ts
test('each customer document posts to the customer account', async () => {
  const i1 = await invoice('D1', CD, '2026-10-01', '2026-10-16', 1000);
  expect(await arLines('invoice', i1)).toEqual([{ account_id: DOM, debit: 1000, credit: 0 }]);

  const pay1 = await pay({ type: 'receivable', reference_type: 'invoice', reference_id: i1, amount: 400, payment_date: '2026-10-05' });
  expect(await arLines('payment', pay1.id)).toEqual([{ account_id: DOM, debit: 0, credit: 400 }]);

  const cn = await creditNote(CD, i1, '2026-10-06', 100);           // createCreditNoteLedgerEntries
  expect(await arLines('credit_note', cn)).toEqual([{ account_id: DOM, debit: 0, credit: 100 }]);

  const dn = await debitNote(CD, '2026-10-07', 50);                 // createDebitNoteLedgerEntries
  expect(await arLines('debit_note', dn)).toEqual([{ account_id: DOM, debit: 50, credit: 0 }]);

  const i2 = await invoice('F1', CF, '2026-10-02', '2026-10-17', 2000);
  expect((await arLines('invoice', i2))[0].account_id).toBe(FOR);

  const i3 = await invoice('U1', CU, '2026-10-03', '2026-10-18', 300);
  expect((await arLines('invoice', i3))[0].account_id).toBe(AR);
});

test('advance adjustment and credit-note refund use the customer account', async () => {
  // createAdvance + adjustAdvance as in ageing-zoho-scenario lines 221-229, for CF against invoice F1, amount 500
  expect((await arLinesOfType('advance_adjustment'))[0]).toMatchObject({ account_id: FOR, credit: 500 });
  // a second credit note of 100 for CD with no invoice link, then the refund function of lib/credit-notes/refund.ts, amount 100, mode 'cash'
  expect((await arLinesOfType('credit_note_refund'))[0]).toMatchObject({ account_id: DOM, debit: 100 });
});

test('a customer opening balance posts to the customer account', async () => {
  // insert customer CO with receivable_account_id = NORTH, then:
  await postOpeningBalanceLedgerEntry({ businessId: A, entityType: 'customer', entityId: CO, entityName: 'CO', openingBalance: 700, openingBalanceType: 'debit' });
  expect((await arLines('opening_balance', CO))[0]).toMatchObject({ account_id: NORTH, debit: 700 });
});

test('a saved account that is no longer valid falls back to the control account', async () => {
  await pool.query(`UPDATE accounts SET is_active = false WHERE id = $1`, [FOR]);
  expect(await resolveCustomerReceivableAccountId(A, CF)).toBe(AR);
  await pool.query(`UPDATE accounts SET is_active = true WHERE id = $1`, [FOR]);
});

test('the books stay balanced', async () => {
  const t = await pool.query(`SELECT SUM(debit)::float d, SUM(credit)::float c FROM ledger_entry_lines WHERE business_id = $1`, [A]);
  expect(t.rows[0].d).toBeCloseTo(t.rows[0].c, 2);
});
```

- [ ] **Step 2: Run to verify they fail**

Expected: FAIL, the first assertion gets `account_id` equal to `AR`.

- [ ] **Step 3: Implement**

`getDefaultAccounts`: after `accountsReceivable` is resolved, when `opts.customerId` is set, replace it with `getAccountById(businessId, await resolveCustomerReceivableAccountId(businessId, opts.customerId, opts.poolClient))`. Pass `{ customerId, poolClient }` at lines 731, 1704, 2229, 2408, and `{ customerId: entityId }` at line 450 when `entityType === 'customer'`. `loadAdvanceAccounts`: when `customerId` is given, `receivable` is the resolved account; `adjustAdvance` passes the advance row's customer id. `refund.ts` line 111: resolve with `room.customerId` and `client`.

- [ ] **Step 4: Run to verify they pass**, then run the neighbours that cover the same functions:

Run: `npx jest tests/db/ageing-zoho-scenario.db.test.ts tests/db/phase4-2-payment-settlement.db.test.ts tests/lib/accounting/advances.test.ts --runInBand`
Expected: PASS (the DB ones need `PHASE2_TEST_DATABASE_URL`; report if skipped).

- [ ] **Step 5: Commit** (if asked): the four `lib` files and the DB test.

---

### Task 4: Voucher-to-customer mapping and per-account balances

**Files:**
- Create: `lib/accounting/customer-vouchers.ts`
- Test: `tests/db/customer-receivable-accounts.db.test.ts`

**Interfaces:**
- Produces:

```ts
/** SELECT returning (voucher_type text, voucher_id uuid, customer_id uuid) for business $1. */
export const CUSTOMER_VOUCHERS_SQL: string;
export async function customerIdForVoucher(client: PoolClient, businessId: string, voucherType: string, voucherId: string): Promise<string | null>;
/** account_id → Dr − Cr of the customer's lines in those accounts. Accounts with no lines are absent. */
export async function customerReceivableBalances(client: PoolClient, businessId: string, customerId: string, accountIds: string[]): Promise<Map<string, number>>;
```

`CUSTOMER_VOUCHERS_SQL` is a `UNION ALL` of: `invoice` → `invoices.customer_id`; `payment` → `payments.customer_id`; `payment` whose id is an invoice id with no `payments` row of that id → that invoice's customer; `credit_note`; `debit_note`; `advance_adjustment` → `advance_adjustments.voucher_id` joined to `advance_payments.customer_id`; `credit_note_refund` → `credit_note_refunds.customer_id`; `opening_balance` → `customers.id`; `receivable_transfer` → `customer_receivable_account_moves.id`. Every branch filters `business_id = $1` and `customer_id IS NOT NULL`. This mirrors the joins in `lib/reports/party-ledger-docs.ts` lines 18–48.

- [ ] **Step 1: Write the failing tests**

```ts
test('every voucher the aging report attributes is attributed the same way here', async () => {
  const docs = await fetchPartyLedgerDocs({ businessId: A, partyType: 'customer', asOfDate: '2026-12-31' });
  await tx(async (c) => {
    for (const d of docs.filter((x) => x.partyId)) {
      expect(await customerIdForVoucher(c, A, d.voucherType, d.voucherId)).toBe(d.partyId);
    }
  });
});

test('a receipt taken at invoice time is found through the invoice', async () => {
  // insert one ledger line of voucher_type 'payment' with voucher_id = invoice D1's id (no payments row)
  await tx(async (c) => expect(await customerIdForVoucher(c, A, 'payment', inv.D1)).toBe(CD));
});

test('balances per account, and a voucher of another business is not found', async () => {
  await tx(async (c) => {
    const b = await customerReceivableBalances(c, A, CD, [AR, DOM, NORTH, FOR]);
    expect(b.get(DOM)).toBeCloseTo(await ledgerNet(DOM), 2);   // CD is the only customer posting to DOM so far
    expect(b.get(DOM)).toBeGreaterThan(0);
    expect(b.has(FOR)).toBe(false);
    expect(await customerIdForVoucher(c, B, 'invoice', inv.D1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail.** Expected: cannot find module.
- [ ] **Step 3: Implement the module.**
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit** (if asked): `lib/accounting/customer-vouchers.ts`, the DB test.

---

### Task 5: Move a customer and transfer the balance

**Files:**
- Create: `lib/accounting/receivable-account-move.ts`
- Test: `tests/db/customer-receivable-accounts.db.test.ts`

**Interfaces:**
- Consumes: `assertReceivableTarget`, `receivableAccountIds` (Task 2); `customerReceivableBalances` (Task 4); `insertVoucherLines` from `lib/accounting/voucher-posting.ts`; `assertPeriodNotLocked(businessId, null, date, 'receivable transfer')`; `currentReversalDate(client)`.
- Produces:

```ts
export type ReceivableMoveResult = {
  changed: boolean;                 // receivable_account_id was updated
  moveId: string | null;            // null when nothing was recorded
  toAccountId: string;              // effective account (control account when null was asked)
  transferDate: string | null;      // YYYY-MM-DD when a voucher was posted
  transfers: Array<{ fromAccountId: string; amount: number }>;  // signed Dr − Cr moved
  transferredAmount: number;        // sum of transfers
};
export async function moveCustomerReceivableAccount(p: {
  businessId: string; customerId: string; toAccountId: string | null; actorId: string | null; dryRun?: boolean;
}): Promise<ReceivableMoveResult>;
```

Behaviour is spec section 4.3. Details the spec leaves open: the customer row is read `WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL FOR UPDATE` (it must be `FOR UPDATE`, which waits for postings holding `FOR KEY SHARE`), and a missing row throws `ReceivableAccountError('Customer not found', 'NOT_FOUND', 404)`. `receivable_account_id` is stored as NULL when the target is the control account. A locked period is rethrown as `ReceivableAccountError(message, 'PERIOD_LOCKED')`. Voucher narration: `Receivable account changed - <customer name>`; reference: the customer name; `branchId: null`. `dryRun` computes the result and rolls back.

- [ ] **Step 1: Write the failing tests**

```ts
test('moving a customer with a balance posts one transfer and settles the old account', async () => {
  before = (await bal(CD)).get(DOM)!;                           // `let before: number` in the describe scope
  const r = await moveCustomerReceivableAccount({ businessId: A, customerId: CD, toAccountId: FOR, actorId: ownerA });
  expect(r).toMatchObject({ changed: true, toAccountId: FOR, transferredAmount: before, transfers: [{ fromAccountId: DOM, amount: before }] });
  await tx(async (c) => {
    const b = await customerReceivableBalances(c, A, CD, [AR, DOM, NORTH, FOR]);
    expect(b.get(DOM) ?? 0).toBeCloseTo(0, 2);
    expect(b.get(FOR)).toBeCloseTo(before, 2);
  });
  const v = await pool.query(`SELECT account_id, debit::float, credit::float FROM ledger_entry_lines WHERE business_id = $1 AND voucher_type = 'receivable_transfer' AND voucher_id = $2`, [A, r.moveId]);
  expect(v.rows).toHaveLength(2);
});

test('dry run changes nothing', async () => {
  const r = await moveCustomerReceivableAccount({ businessId: A, customerId: CD, toAccountId: DOM, actorId: ownerA, dryRun: true });
  expect(r.transferredAmount).toBeCloseTo(before, 2);
  const row = await pool.query(`SELECT receivable_account_id FROM customers WHERE id = $1`, [CD]);
  expect(row.rows[0].receivable_account_id).toBe(FOR);
});

test('moving back, and moving to the default, stay exact; same account with nothing to sweep records nothing', async () => {
  await moveCustomerReceivableAccount({ businessId: A, customerId: CD, toAccountId: DOM, actorId: ownerA });
  const toDefault = await moveCustomerReceivableAccount({ businessId: A, customerId: CD, toAccountId: null, actorId: ownerA });
  expect(toDefault.toAccountId).toBe(AR);
  const again = await moveCustomerReceivableAccount({ businessId: A, customerId: CD, toAccountId: null, actorId: ownerA });
  expect(again).toMatchObject({ changed: false, moveId: null, transferredAmount: 0 });
  await tx(async (c) => {
    const b = await customerReceivableBalances(c, A, CD, [AR, DOM, NORTH, FOR]);
    expect(b.get(AR)).toBeCloseTo(before, 2);
    expect((b.get(DOM) ?? 0) + (b.get(FOR) ?? 0)).toBeCloseTo(0, 2);
  });
});

test('a customer with no balance moves without a voucher', async () => {
  const r = await moveCustomerReceivableAccount({ businessId: A, customerId: CZ, toAccountId: NORTH, actorId: ownerA });
  expect(r).toMatchObject({ changed: true, transferDate: null, transferredAmount: 0 });
  expect(r.moveId).not.toBeNull();
});

test('a locked period refuses the move and changes nothing', async () => {
  // INSERT INTO period_locks as in tests/db/phase2-reversals.db.test.ts line 809, covering CURRENT_DATE; delete it afterwards
  await expect(moveCustomerReceivableAccount({ businessId: A, customerId: CU, toAccountId: DOM, actorId: ownerA }))
    .rejects.toMatchObject({ code: 'PERIOD_LOCKED' });
  const row = await pool.query(`SELECT receivable_account_id FROM customers WHERE id = $1`, [CU]);
  expect(row.rows[0].receivable_account_id).toBeNull();
});

test('other businesses are refused', async () => {
  await expect(moveCustomerReceivableAccount({ businessId: A, customerId: customerOfB, toAccountId: DOM, actorId: ownerA })).rejects.toMatchObject({ status: 404 });
  const arOfB = (await accountByCode(B, '1103')).id;
  await expect(moveCustomerReceivableAccount({ businessId: A, customerId: CU, toAccountId: arOfB, actorId: ownerA })).rejects.toMatchObject({ code: 'RECEIVABLE_ACCOUNT_INVALID' });
});

test('an invoice posted while a move is in flight lands in the new account or is transferred', async () => {
  await Promise.all([
    moveCustomerReceivableAccount({ businessId: A, customerId: CU, toAccountId: DOM, actorId: ownerA }),
    invoice('RACE', CU, '2026-10-20', '2026-11-04', 900),
  ]);
  await tx(async (c) => {
    const b = await customerReceivableBalances(c, A, CU, [AR, DOM, NORTH, FOR]);
    expect(b.get(AR) ?? 0).toBeCloseTo(0, 2);
    expect(b.get(DOM)).toBeCloseTo(300 + 900, 2);
  });
});
```

- [ ] **Step 2: Run to verify they fail.** Expected: cannot find module.
- [ ] **Step 3: Implement `moveCustomerReceivableAccount`.**
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit** (if asked): `lib/accounting/receivable-account-move.ts`, the DB test.

---

### Task 6: Redirect the reversal of a customer's receivable line

**Files:**
- Modify: `lib/ledger-reversal.ts` (`reverseVoucherLedgerEntries`, lines 22–71)
- Test: `tests/db/customer-receivable-accounts.db.test.ts`

**Interfaces:**
- Consumes: `receivableAccountIds(businessId, client)`, `resolveCustomerReceivableAccountId(businessId, customerId, client)`, `customerIdForVoucher(client, businessId, voucherType, voucherId)`.
- Produces: no signature change.

- [ ] **Step 1: Read the readers of `ledger_entry_reversals`** (`lib/accounting/payment-reversal.ts`, `lib/accounting/journal-corrections.ts`, `lib/inventory/fifo-costing.ts`, `lib/purchases/cancel-purchase.ts`, `lib/purchases/delete-draft-purchase.ts`, `app/api/journal-entries/[id]/route.ts`, `app/api/payments/restore/route.ts`). Expected: none compares the original line's `account_id` with the reversal line's. If one does, stop and report it before changing anything.

- [ ] **Step 2: Write the failing tests** (customer `CM`: invoice `M1` of 1000 in `DOM`, receipt of 400, then moved to `FOR`)

```ts
const bal = (customer: string) => tx((c) => customerReceivableBalances(c, A, customer, [AR, DOM, NORTH, FOR]));

test('editing an old invoice after a move leaves the old account settled', async () => {
  await tx(async (c) => {
    await reverseVoucherLedgerEntries(c, { businessId: A, voucherType: 'invoice', voucherId: inv.M1, reason: 'edit' });
    await createInvoiceLedgerEntries({ businessId: A, invoiceId: inv.M1, invoiceNumber: 'M1', invoiceDate: '2026-10-01', grandTotal: 1200,
      customerId: CM, isCashSale: false, branchId: BR, taxableValue: 1200, poolClient: c });
  });
  const b = await bal(CM);
  expect(b.get(DOM) ?? 0).toBeCloseTo(0, 2);
  expect(b.get(FOR)).toBeCloseTo(1200 - 400, 2);
});

test('cancelling an old invoice after a move takes it out of the new account', async () => {
  await tx((c) => reverseVoucherLedgerEntries(c, { businessId: A, voucherType: 'invoice', voucherId: inv.M1, reason: 'cancel' }));
  const b = await bal(CM);
  expect(b.get(DOM) ?? 0).toBeCloseTo(0, 2);
  expect(b.get(FOR)).toBeCloseTo(-400, 2);
});

test('reversing the receipt after a move undoes it in the new account', async () => {
  await tx((c) => reverseVoucherLedgerEntries(c, { businessId: A, voucherType: 'payment', voucherId: payM.id, reason: 'reversed' }));
  const b = await bal(CM);
  expect(b.get(FOR) ?? 0).toBeCloseTo(0, 2);
  expect(b.get(DOM) ?? 0).toBeCloseTo(0, 2);
});

test('a voucher with no customer mirrors on the original accounts', async () => {
  const vid = randomUUID();
  const cash = (await accountByCode(A, '1101')).id;
  await tx((c) => insertVoucherLines(c, { businessId: A, branchId: null, voucherId: vid, voucherType: 'journal', entryDate: '2026-10-10', reference: 'J',
    lines: [{ accountId: DOM, debit: 10, credit: 0, narration: 'j' }, { accountId: cash, debit: 0, credit: 10, narration: 'j' }] }));
  await tx((c) => reverseVoucherLedgerEntries(c, { businessId: A, voucherType: 'journal', voucherId: vid, reason: 'undo' }));
  const rows = await pool.query(`SELECT account_id, SUM(debit - credit)::float n FROM ledger_entry_lines WHERE voucher_id = $1 GROUP BY account_id`, [vid]);
  expect(rows.rows.map((r) => r.account_id).sort()).toEqual([DOM, cash].sort());
  expect(rows.rows.every((r) => Math.abs(r.n) < 0.005)).toBe(true);
});
```

- [ ] **Step 3: Run to verify they fail.** Expected: first test gets `DOM` = −1000.

- [ ] **Step 4: Implement**

In `reverseVoucherLedgerEntries`, before the loop: load the receivable set once; only if at least one selected line's account is in it, call `customerIdForVoucher`, and if a customer is found, resolve their current account. In the loop, a line whose account is in the set and whose voucher has a customer is mirrored on the current account; every other line is unchanged.

- [ ] **Step 5: Run to verify they pass**, then the reversal suites:

Run: `npx jest tests/db/phase2-reversals.db.test.ts tests/db/phase4-4-payment-reversal.db.test.ts tests/db/journal-reverse.db.test.ts --runInBand`
Expected: PASS. `phase4-4-payment-reversal` has one known flaky concurrent test (see `docs/project.log.md`, 10 Nov); rerun once before reporting it.

- [ ] **Step 6: Commit** (if asked): `lib/ledger-reversal.ts`, the DB test.

---

### Task 7: Reports read the receivable set

**Files:**
- Modify: `lib/reports/party-ledger-docs.ts` (line 11), `app/api/reports/party/statement/route.ts` (line 149)
- Modify: `lib/reports/balance-sheet.ts` (`BsAccountRow`, line 185), `app/api/reports/balance-sheet/route.ts` (query at line 110)
- Modify: `lib/reports/cash-flow.ts` (`CfAccount`, `WC_LABELS` use), `app/api/reports/cash-flow/route.ts` (line 151)
- Modify: `lib/reports/dashboard-cash-flow.ts` (`CashCounterAccount`, lines 79 and 92), `app/api/dashboard/cash-flow/route.ts`
- Modify: `app/api/admin/diagnostics/pl-validation/route.ts` (line 1071)
- Test: `tests/lib/reports/dashboard-cash-flow.test.ts`, the existing cash-flow and balance-sheet unit tests, `tests/db/customer-receivable-accounts.db.test.ts`

**Interfaces:**
- Consumes: `receivableAccountIds(businessId)`.
- Produces: `BsAccountRow.is_receivable?: boolean`; `CfAccount.receivable?: boolean`; `CashCounterAccount.receivable?: boolean`. `fetchPartyLedgerDocs` keeps its signature.

- [ ] **Step 1: Write the failing tests**

Unit, in the existing files for each pure module:

```ts
test('balance sheet receivables sums every flagged account', () => {
  const rows = [bsRow('1103', 100, { is_receivable: true }), bsRow('DOM', 250, { is_receivable: true }), bsRow('1101', 40)];
  expect(assembleBalanceSheet(rows, groups, { previousYearsProfit: 0, currentYearProfit: 0 }).assets.current.receivables).toBe(350);
});
test('without flags the figure is the 1103 line, as before', () => {
  expect(assembleBalanceSheet([bsRow('1103', 100)], groups, { previousYearsProfit: 0, currentYearProfit: 0 }).assets.current.receivables).toBe(100);
});
test('cash flow labels a flagged account as Trade receivables whatever its code', () => { /* CfAccount code 'DOM', receivable: true → line label 'Trade receivables' */ });
test('dashboard cash flow treats a flagged counter account as a customer account', () => { /* classifyCashMovement → 'sales' for money in, 'refunds' for money out */ });
```

DB, with the data left by Tasks 3–6 (customers spread over `AR`, `DOM`, `NORTH`, `FOR`):

```ts
test('aging, statement and balance sheet agree with the ledger across all receivable accounts', async () => {
  const ledger = await pool.query(`SELECT COALESCE(SUM(debit - credit), 0)::float n FROM ledger_entry_lines WHERE business_id = $1 AND account_id = ANY($2::uuid[])`, [A, [AR, DOM, NORTH, FOR]]);
  session(ownerA, A);
  const aging = await call(agingReceivables, 'GET', `/api/reports/aging/receivables?as_on_date=2026-12-31`, null);
  expect(aging.json.gl_balance).toBeCloseTo(ledger.rows[0].n, 2);
  expect((aging.json.totals as any).total_outstanding).toBeCloseTo(ledger.rows[0].n, 2);
  const bs = await call(getBalanceSheet, 'GET', `/api/reports/balance-sheet?as_on_date=2026-12-31`, null);
  expect((bs.json as any).assets.current.receivables).toBeCloseTo(ledger.rows[0].n, 2);
  // the statement for CD: closing balance equals bal(CD) summed over the four accounts, and no row has transaction_type 'receivable_transfer'
});
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement**

`party-ledger-docs.ts`: `CUSTOMER_SQL` drops the `accounts` join and filters `lel.account_id = ANY($5::uuid[])`; `fetchPartyLedgerDocs` passes `await receivableAccountIds(businessId)` as the fifth parameter for customers only (the supplier query keeps four). Statement route: the `NOT EXISTS` uses the same id array. Balance sheet: `receivables` is the sum of lines whose row has `is_receivable`, falling back to `byCode(ca, '1103')` when no row is flagged; the route adds `a.id = ANY($n::uuid[]) AS is_receivable`. Cash flow and dashboard cash flow: check the flag before the code pattern; the loaders set it. Diagnostics line 1071: `a.id = ANY($n::uuid[])`. The dashboard receivables and aging cards need no change: no other file under `app/api` or `lib` selects receivable lines by the code `1103` (confirm with `Grep` for `1103` before closing the task).

- [ ] **Step 4: Run to verify they pass**, then:

Run: `npx jest tests/lib/reports tests/db/dashboard-cash-flow.db.test.ts tests/db/pl-tb-bs-agreement.db.test.ts tests/db/ageing-zoho-scenario.db.test.ts --runInBand`
Expected: PASS.

- [ ] **Step 5: Commit** (if asked): the files listed above.

---

### Task 8: Protect accounts that customers use

**Files:**
- Modify: `lib/accounting/receivable-accounts.ts`
- Modify: `app/api/accounts/[id]/route.ts` (PATCH: `is_active` and `parent_account_id` handling near lines 257–270; DELETE near line 433)
- Test: `tests/db/customer-receivable-accounts.db.test.ts`

**Interfaces:**
- Produces:

```ts
/** Throws ReceivableAccountError('…', 'ACCOUNT_IN_USE_BY_CUSTOMERS') naming the number of customers. */
export async function assertReceivableAccountChangeAllowed(p: {
  businessId: string; accountId: string;
  change: { kind: 'deactivate' } | { kind: 'reparent'; newParentId: string | null };
}): Promise<void>;
```

Rule: *deactivate* is refused when any customer has `receivable_account_id = accountId`. *Re-parent* is refused when the account or any account under it is used by a customer and the new parent is not in the receivable set (NULL counts as outside, except for the control account itself).

- [ ] **Step 1: Write the failing tests**

```ts
test('an account in use cannot be deactivated or moved out from under receivables', async () => {
  session(ownerA, A);                                    // CF uses FOR; CZ uses NORTH (under DOM)
  const off = await call(patchAccount, 'PATCH', `/api/accounts/${FOR}`, { is_active: false }, FOR);
  expect(off).toMatchObject({ status: 400, json: { code: 'ACCOUNT_IN_USE_BY_CUSTOMERS' } });
  const del = await call(deleteAccount, 'DELETE', `/api/accounts/${FOR}`, null, FOR);
  expect(del.json.code).toBe('ACCOUNT_IN_USE_BY_CUSTOMERS');
  const out = await call(patchAccount, 'PATCH', `/api/accounts/${DOM}`, { parent_account_id: null }, DOM);
  expect(out.json.code).toBe('ACCOUNT_IN_USE_BY_CUSTOMERS');   // NORTH under it is in use
  const within = await call(patchAccount, 'PATCH', `/api/accounts/${NORTH}`, { parent_account_id: FOR }, NORTH);
  expect(within.status).toBe(200);
  const back = await call(patchAccount, 'PATCH', `/api/accounts/${NORTH}`, { parent_account_id: DOM }, NORTH);
  expect(back.status).toBe(200);                         // later tasks expect NORTH under DOM
  const still = await pool.query(`SELECT is_active, parent_account_id FROM accounts WHERE id = $1`, [FOR]);
  expect(still.rows[0].is_active).toBe(true);
});

test('an unused sub-account can still be deactivated', async () => {
  // create "Spare Debtors" under 1103, PATCH is_active false → 200
});
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement the guard and call it in PATCH and DELETE**, returning `{ error, code }` with the error's status, in the style of the existing `AccountRuleError` handling.
- [ ] **Step 4: Run to verify they pass**, plus `npx jest tests/db/account-hierarchy-integrity.db.test.ts --runInBand`.
- [ ] **Step 5: Commit** (if asked): the two files and the DB test.

---

### Task 9: Customer API

**Files:**
- Modify: `app/api/customers/route.ts` (GET filter near line 107; POST near lines 160–310)
- Modify: `app/api/customers/[id]/route.ts` (GET, near line 38)
- Create: `app/api/customers/receivable-accounts/route.ts` (GET)
- Create: `app/api/customers/[id]/receivable-account/route.ts` (POST)
- Create: `app/api/customers/receivable-account/route.ts` (POST, bulk)
- Test: `tests/db/customer-receivable-accounts.db.test.ts`

**Interfaces** (all use `requireStrictSession`; read routes `authorize(userId, 'customers', 'read', { businessId })`, write routes `'update'`; errors of class `ReceivableAccountError` become `{ error, code }` with its status):

| Route | Request | Response |
|---|---|---|
| `GET /api/customers/receivable-accounts` | none | `{ control_account_id, accounts: ReceivableAccountNode[] }` |
| `GET /api/customers?receivable_account_id=<id>` | id of an account in the set | customers whose effective account is that account or one under it; the control account's own id also matches customers with NULL |
| `GET /api/customers/[id]` | none | adds `receivable_account: { id, account_code, account_name }` (effective) and `receivable_account_moves: Array<{ id, to_account_id, to_account_name, transfer_date, transferred_amount, created_at }>`, newest first |
| `POST /api/customers` | optional `receivable_account_id` | validated with `assertReceivableTarget`; stored NULL when it is the control account; the opening balance then posts to it (Task 3) |
| `POST /api/customers/[id]/receivable-account` | `{ receivable_account_id: string \| null, dry_run?: boolean }` | `{ result: ReceivableMoveResult }` |
| `POST /api/customers/receivable-account` | `{ customer_ids: string[], receivable_account_id: string \| null }` | `{ results: Array<{ customer_id, ok: boolean, transferred_amount?: number, error?: string, code?: string }> }`; 400 `TOO_MANY_CUSTOMERS` above 500 ids; each customer in its own transaction |

`PUT /api/customers/[id]` is unchanged: `receivable_account_id` is not in `CUSTOMER_UPDATABLE`, so it stays ignored there.

- [ ] **Step 1: Write the failing tests**

```ts
test('the move endpoint previews, then moves, with the session business only', async () => {
  session(ownerA, A);
  const preview = await call(postMove, 'POST', `/api/customers/${CF}/receivable-account`, { receivable_account_id: DOM, dry_run: true }, CF);
  expect(preview.status).toBe(200);
  const amount = (preview.json.result as any).transferredAmount;
  const done = await call(postMove, 'POST', `/api/customers/${CF}/receivable-account`, { receivable_account_id: DOM, business_id: B }, CF);
  expect((done.json.result as any)).toMatchObject({ changed: true, transferredAmount: amount });
  session(ownerB, B);
  const foreign = await call(postMove, 'POST', `/api/customers/${CF}/receivable-account`, { receivable_account_id: null }, CF);
  expect(foreign.status).toBe(404);
});

test('bulk move reports each customer and does not stop at a failure', async () => {
  session(ownerA, A);
  const r = await call(postBulk, 'POST', '/api/customers/receivable-account', { customer_ids: [CU, customerOfB, CZ], receivable_account_id: FOR });
  const byId = new Map((r.json.results as any[]).map((x) => [x.customer_id, x]));
  expect(byId.get(CU).ok).toBe(true);
  expect(byId.get(customerOfB)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  expect(byId.get(CZ).ok).toBe(true);
  const many = await call(postBulk, 'POST', '/api/customers/receivable-account', { customer_ids: Array.from({ length: 501 }, () => randomUUID()), receivable_account_id: null });
  expect(many).toMatchObject({ status: 400, json: { code: 'TOO_MANY_CUSTOMERS' } });
});

test('create with an account, list filter, detail, and the account list', async () => {
  session(ownerA, A);
  const created = await call(postCustomer, 'POST', '/api/customers', { name: `CRA New ${tag}`, receivable_account_id: NORTH, opening_balance: 250, opening_balance_type: 'debit' });
  expect([200, 201]).toContain(created.status);
  const id = (created.json.customer as any).id;
  expect((await arLines('opening_balance', id))[0]).toMatchObject({ account_id: NORTH, debit: 250 });
  const bad = await call(postCustomer, 'POST', '/api/customers', { name: `CRA Bad ${tag}`, receivable_account_id: (await accountByCode(A, '1101')).id });
  expect(bad).toMatchObject({ status: 400, json: { code: 'RECEIVABLE_ACCOUNT_INVALID' } });
  const underDom = await call(getCustomers, 'GET', `/api/customers?receivable_account_id=${DOM}&limit=500`, null);
  expect((underDom.json.customers as any[]).some((c) => c.id === id)).toBe(true);       // NORTH is under DOM
  const detail = await call(getCustomer, 'GET', `/api/customers/${id}`, null, id);
  expect((detail.json.customer as any).receivable_account).toMatchObject({ id: NORTH });
  const list = await call(getReceivableAccounts, 'GET', '/api/customers/receivable-accounts', null);
  expect(list.json.control_account_id).toBe(AR);
});
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement the routes.** Check the response shape of `GET /api/customers/[id]` before adding fields, and keep it.
- [ ] **Step 4: Run to verify they pass**, plus `npx jest tests/db/phase3g-write-identity.db.test.ts --runInBand` if it covers customer writes.
- [ ] **Step 5: Commit** (if asked): the five route files and the DB test.

---

### Task 10: Aging by receivable account

**Files:**
- Modify: `lib/reports/aging-report-route.ts`
- Test: `tests/db/customer-receivable-accounts.db.test.ts`

**Interfaces:**
- Produces, for `partyType === 'customer'` only: each `aging[]` entry gains `receivable_account_id` and `receivable_account_name` (the customer's effective account today); the response gains `by_account: Array<{ account_id, account_code, account_name, total_outstanding, overdue }>`; query parameter `receivable_account_id` keeps customers whose effective account is that account or one under it and recomputes `totals` from the kept rows. `gl_balance` stays the whole ledger figure.

- [ ] **Step 1: Write the failing test**

```ts
test('aging carries the account, filters by it, and subtotals add up', async () => {
  session(ownerA, A);
  const all = await call(agingReceivables, 'GET', `/api/reports/aging/receivables?as_on_date=2026-12-31`, null);
  const rows = all.json.aging as any[];
  expect(rows.every((r) => typeof r.receivable_account_id === 'string')).toBe(true);
  const sub = (all.json.by_account as any[]).reduce((s, a) => s + a.total_outstanding, 0);
  expect(sub).toBeCloseTo((all.json.totals as any).total_outstanding, 2);
  const dom = await call(agingReceivables, 'GET', `/api/reports/aging/receivables?as_on_date=2026-12-31&receivable_account_id=${DOM}`, null);
  expect((dom.json.aging as any[]).every((r) => [DOM, NORTH].includes(r.receivable_account_id))).toBe(true);
  const bad = await call(agingReceivables, 'GET', `/api/reports/aging/receivables?as_on_date=2026-12-31&receivable_account_id=${(await accountByCode(A, '1101')).id}`, null);
  expect(bad).toMatchObject({ status: 400, json: { code: 'RECEIVABLE_ACCOUNT_INVALID' } });
});
```

- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement.** Unattributed rows (`party_id` null) are grouped under the control account.
- [ ] **Step 4: Run to verify it passes**, plus `tests/db/ageing-zoho-scenario.db.test.ts`.
- [ ] **Step 5: Commit** (if asked).

---

### Task 11: Customer screens

**Files:**
- Create: `components/customers/ReceivableAccountPicker.tsx`
- Modify: `app/(app)/customers/new/page.tsx` (form state near line 66, submit near line 325, field next to `credit_days` near line 617)
- Modify: `app/(app)/customers/[id]/edit/page.tsx` (state near line 58, load near line 108, submit near line 176)
- Modify: `components/customers/CustomerDetailPanel.tsx` (near line 330)
- Modify: `lib/offline/catalog/types.ts` (add `'receivable_account_id'` beside `'credit_days'`, line 56)

**Interfaces:**
- Consumes: `GET /api/customers/receivable-accounts`, `POST /api/customers/[id]/receivable-account` (Task 9).
- Produces:

```tsx
export function ReceivableAccountPicker(props: {
  value: string | null;                 // null = control account
  onChange: (accountId: string | null) => void;
  disabled?: boolean;
}): JSX.Element | null;                 // null when the business has no account under the control account
```

- [ ] **Step 1: Build the picker.** It fetches the account list once, renders a `<select>` with "Accounts Receivable (default)" first and the other active accounts indented by depth, in account-code order. Label: "Receivable account". Help text: "Sales to this customer are recorded in this account."
- [ ] **Step 2: New customer page.** Add the picker; send `receivable_account_id` in the create body.
- [ ] **Step 3: Edit customer page.** Add the picker. On save, when the value differs from the loaded one: call the move endpoint with `dry_run: true`; if `transferredAmount` is not 0, confirm with "₹{amount} will be transferred from {old account} to {new account}, dated today. Earlier entries are not changed." (use the app's existing confirm dialog); on confirm call the endpoint without `dry_run`, then save the other fields with the existing `PUT`. A `PERIOD_LOCKED` or `RECEIVABLE_ACCOUNT_INVALID` response shows its `error` text and leaves the form open.
- [ ] **Step 4: Detail panel.** A `FieldRow` "Receivable account" with code and name, shown when it is not the control account; under it the list of moves (date, account, amount) when there is at least one. When the customer's saved `receivable_account_id` is set but differs from `receivable_account.id`, show the warning "The saved receivable account is no longer available. New entries go to Accounts Receivable."
- [ ] **Step 5: Verify**

Run: `npm run typecheck` and `npm run lint`
Expected: no new errors.

- [ ] **Step 6: Commit** (if asked): the five files.

---

### Task 12: Customers list and aging screens

**Files:**
- Create: `components/customers/BulkReceivableAccountDialog.tsx`
- Modify: `app/(app)/customers/page.tsx` (filter state line 87; desktop table from line 486; rows at lines 408, 550, 655)
- Modify: `app/(app)/reports/aging/receivables/page.tsx`

**Interfaces:**
- Consumes: `ReceivableAccountPicker`; `POST /api/customers/receivable-account`; `GET /api/customers?receivable_account_id=`; aging response fields from Task 10.
- Produces:

```tsx
export function BulkReceivableAccountDialog(props: {
  open: boolean; customerIds: string[]; onClose: () => void; onDone: () => void;
}): JSX.Element | null;
```

- [ ] **Step 1: Customers list filter.** When the business has accounts under the control account, show a "Receivable account" select beside the existing filters; choosing one refetches with `receivable_account_id`.
- [ ] **Step 2: Selection and bulk action, desktop table only.** A checkbox column and a header checkbox for the current page; when at least one row is ticked, a bar shows "{n} selected" and a "Set receivable account" button that opens the dialog. The dialog has the picker and a Save button, posts the bulk request, then lists how many moved and, for each failure, the customer name and the `error` text. `onDone` clears the selection and refetches.
- [ ] **Step 3: Aging page.** A "Receivable account" select that passes `receivable_account_id`; a column showing each row's account name; a subtotal block from `by_account` when it has more than one entry.
- [ ] **Step 4: Verify**

Run: `npm run typecheck` and `npm run lint`
Expected: no new errors.

- [ ] **Step 5: Commit** (if asked): the three files.

---

### Task 13: Checklist, docs and full run

**Files:**
- Create: `docs/superpowers/plans/2026-11-10-customer-receivable-accounts-staging-checklist.md`
- Modify: `docs/project.log.md` (append), `docs/roadmap.md` (move the card), `docs/KHATARIO_USER_GUIDE.md` section 11 (a short "Customer categories" entry)

- [ ] **Step 1: Write the staging checklist** for the owner, in order: apply migration 468 (owner approval); create "Domestic Debtors" and "Foreign Debtors" under Accounts Receivable, and "USA" under Foreign; set them on two existing customers with balances and confirm the transfer message and amounts; raise an invoice and a receipt for each; check the balance sheet lines and total, the aging subtotals and filter, and both customer statements (no transfer row); edit an invoice dated before the move and check both accounts; cancel one; move a customer back to the default; try to deactivate an account in use; bulk-set five customers from the list.
- [ ] **Step 2: Run everything**

```bash
npx jest tests/lib tests/db/customer-receivable-accounts.db.test.ts tests/db/account-hierarchy-integrity.db.test.ts tests/db/ageing-zoho-scenario.db.test.ts tests/db/phase2-reversals.db.test.ts tests/db/pl-tb-bs-agreement.db.test.ts --runInBand
```

```bash
npm run typecheck
```

Expected: PASS and no type errors. Report any skipped DB suite and why.

- [ ] **Step 3: Update the code graph:** `graphify update .`
- [ ] **Step 4: Append the project-log entry and move the roadmap card** to **Now** with "built, not deployed; next: staging with migration 468 first, then the staging checklist".
- [ ] **Step 5: Commit** (if asked): the docs, by name.
