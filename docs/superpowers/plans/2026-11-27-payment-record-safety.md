# Payment Record Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Khatario's own payment records hard to duplicate, impossible to lose when a business is deleted, tied to the period they paid for, and reproducible on a fresh database: audit findings SUB-14, SUB-15, SUB-36 and SUB-41.

**Architecture:** One migration adds database constraints that back the rules the code already follows. Deleting a business first copies its payment rows into an archive table that has no link to the business. Payment completion writes the paid period onto the payment row inside the transaction it already runs. The base plan rows and the limit registry move to where a fresh database and the production setup script will pick them up.

**Tech Stack:** PostgreSQL migrations (plain SQL), TypeScript library code under `lib/`, Jest real-database suites on `kh_phase2_test`, one bash script.

**Spec:** `docs/qa/subscription-billing-audit-2026-11-26.md`, section D, findings SUB-14, SUB-15, SUB-36, SUB-41.

## Global Constraints

- Tests and migrations run only on the local disposable database `kh_phase2_test`. Migration files are written, never applied to staging or production. In tests a migration is executed as SQL text through node-pg, so every migration here is plain SQL that works as one multi-statement query.
- A migration must never fail a deploy because of existing data: where a constraint could be violated by rows already present, the migration checks first and skips that constraint with a `RAISE NOTICE` naming what blocked it.
- Every migration is idempotent (`IF NOT EXISTS`, guarded `DO` blocks).
- New database tests go in `tests/db/payment-record-safety.db.test.ts`, with the header and helpers modelled on `tests/db/billing-money-path.db.test.ts`.
- Run with `PHASE2_TEST_DATABASE_URL=postgresql://postgres:<local password>@127.0.0.1:5433/kh_phase2_test DB_SSL=false npx jest <file> --runInBand --forceExit`.
- No existing payment row is modified or deleted by a migration.
- Stage files by name; the controller commits after each task's review.

## Review Focus

1. **Live data that already breaks a new constraint** (two completed rows with one gateway payment id, a billing cycle value outside the three allowed): the migration must finish and say what it skipped. Pinned in Task 1.
2. **A second, different business completing a payment with a payment id already used**: refused by the database, and the webhook reports it instead of crashing in a loop. Pinned in Task 1.
3. **Deleting a business with payments and a partner commission**: the delete succeeds or fails exactly as before, and the payment rows are readable in the archive afterwards. Pinned in Task 2.
4. **A payment completed before this change** (no period columns): reports and the admin billing screen still work. Pinned in Task 3.
5. **A database that already has the base plans**: adding them to the schema file changes nothing there. Pinned in Task 4.

## File Structure

| File | Responsibility |
| --- | --- |
| `database/migrations/479_billing_record_constraints.sql` (new) | Unique completed payment reference; billing cycle check on module subscriptions; archive table |
| `lib/platform-billing-archive.ts` (new) | Copy a business's payment rows to the archive |
| `lib/admin-business-ops.ts` (`deleteBusinessCompletely`) | Call the archive step before purging |
| `lib/platform-subscription-checkout.ts`, `lib/platform-addon-checkout.ts` | Write the paid period on the payment row |
| `database/schema.sql` | Base plan rows and limit registry present on a fresh database |
| `scripts/setup-khatario-production.sh` | Copy `platform_limits` with the rest of the catalogue |
| `tests/db/payment-record-safety.db.test.ts` (new) | Tests for every task |

---

### Task 1: Database constraints for payment rows (SUB-15, SUB-41)

**Files:**
- Create: `database/migrations/479_billing_record_constraints.sql`
- Modify: `lib/platform-billing.ts` (terminal error list), `lib/platform-subscription-checkout.ts` and `lib/platform-addon-checkout.ts` (only if needed to surface the unique violation as a terminal error)
- Test: `tests/db/payment-record-safety.db.test.ts`

**Interfaces:**
- Migration 479 creates, each guarded:
  - `CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_tx_completed_payment_ref ON billing_transactions (payment_method, payment_reference) WHERE status = 'completed' AND payment_reference IS NOT NULL AND payment_method IN ('razorpay', 'easebuzz')` — skipped with a notice when duplicates already exist.
  - `ALTER TABLE business_module_subscriptions ADD CONSTRAINT bms_billing_cycle_check CHECK (billing_cycle IS NULL OR billing_cycle IN ('monthly', 'yearly', 'three_year'))` — skipped with a notice when a row violates it or the constraint exists.
  - Table `billing_transactions_archive` (Task 2 uses it): every column of `billing_transactions` as plain columns with no foreign keys, plus `archived_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`, `business_name TEXT`, `business_gstin TEXT`, `archive_reason TEXT NOT NULL`; primary key `id`; index on `business_id`.
- A unique violation on `uq_billing_tx_completed_payment_ref` raised inside payment completion is a terminal error named `PAYMENT_REFERENCE_ALREADY_USED`: the transaction rolls back, the webhook event is marked `ignored` with that note, the function returns `{ ok: true, error }` (Razorpay) or outcome `ignored` (Easebuzz), and the event is listed by `findIgnoredSuccessEvents` (extend its note filter).

- [ ] **Step 1: Write the failing tests**

```ts
it('migration 479 runs twice without error', async () => {
  await runMigration479(); await runMigration479();
});
it('a second completed row with the same gateway payment id is refused by the database', async () => {
  const a = await pendingCheckout(bizA, 'billing_growth', 499);
  const b = await pendingCheckout(bizB, 'billing_growth', 499);
  await query(`UPDATE billing_transactions SET status='completed', payment_reference='pay_same' WHERE id=$1`, [a]);
  await expect(query(`UPDATE billing_transactions SET status='completed', payment_reference='pay_same' WHERE id=$1`, [b]))
    .rejects.toMatchObject({ code: '23505' });
});
it('pending and failed rows may share a reference', async () => {
  const a = await pendingCheckout(bizA, 'billing_growth', 499);
  const b = await pendingCheckout(bizA, 'billing_growth', 499);
  await query(`UPDATE billing_transactions SET payment_reference='plink_x' WHERE id = ANY($1)`, [[a, b]]);
});
it('a webhook that would reuse a payment id is ignored, not retried', async () => {
  const first = await paidAndActivated(bizA, 'billing_growth', { payId: 'pay_reuse' });
  const tx = await pendingCheckout(bizB, 'billing_growth', 499);
  const r = await hook('payment.captured', 'pay_reuse', 'captured', notesFor(bizB, tx, 'billing_growth'), { amountPaise: 49900, exactPayId: true });
  expect(r).toMatchObject({ ok: true });
  expect((await txRow(tx)).status).toBe('pending');
  expect(await moduleRow(bizB, 'billing')).toBeNull();
  expect(await webhookEventStatus('pay_reuse', bizB)).toBe('ignored');
});
it('the migration skips the unique index when duplicates already exist', async () => {
  await query(`DROP INDEX IF EXISTS uq_billing_tx_completed_payment_ref`);
  // two completed rows sharing a reference, inserted while the index is absent
  await insertCompletedPair(bizA, bizB, 'pay_dup_old');
  await runMigration479();
  expect(await indexExists('uq_billing_tx_completed_payment_ref')).toBe(false);
  await deleteRows('pay_dup_old'); await runMigration479();
  expect(await indexExists('uq_billing_tx_completed_payment_ref')).toBe(true);
});
it('an unknown billing cycle is refused on module subscriptions', async () => {
  await expect(query(`UPDATE business_module_subscriptions SET billing_cycle='weekly' WHERE business_id=$1`, [bizA]))
    .rejects.toMatchObject({ code: '23514' });
});
```

- [ ] **Step 2: Run.** Expected: FAIL (file missing).
- [ ] **Step 3: Write migration 479 and the terminal-error handling.**
- [ ] **Step 4: Run, plus `tests/db/billing-money-path.db.test.ts` and the two mocked webhook suites.** Expected: PASS.

### Task 2: Payment rows survive the deletion of a business (SUB-15)

**Files:**
- Create: `lib/platform-billing-archive.ts`
- Modify: `lib/admin-business-ops.ts` (`deleteBusinessCompletely`, about lines 141-190)
- Test: `tests/db/payment-record-safety.db.test.ts`

**Interfaces:**
- Produces:

```ts
/** Copies every billing_transactions row of the business into billing_transactions_archive. Idempotent per row. Returns the number of rows archived. */
export async function archiveBusinessBillingTransactions(
  client: PoolClient, businessId: string, reason: string,
): Promise<number>;
```

- It runs `INSERT INTO billing_transactions_archive (…) SELECT bt.*, CURRENT_TIMESTAMP, b.name, b.gstin, $2 FROM billing_transactions bt JOIN businesses b ON b.id = bt.business_id WHERE bt.business_id = $1 ON CONFLICT (id) DO NOTHING`, with an explicit column list in both halves (no `SELECT *`), on the caller's transaction client.
- `deleteBusinessCompletely` calls it with reason `'business_deleted'` inside its existing transaction, before the first delete. If the archive table does not exist (migration 479 not applied), the delete is refused with the error `Run migration 479 before deleting a business: payment records must be archived first.` and nothing is deleted.
- The admin billing list (`listPlatformBillingTransactions` in `lib/platform-billing.ts`) is unchanged; add `listArchivedBillingTransactions(limit = 50, offset = 0)` to `lib/platform-billing-archive.ts` for later use. No UI in this task.

- [ ] **Step 1: Write the failing tests**

```ts
it('deleting a business keeps its payment rows in the archive', async () => {
  const tx = await paidAndActivated(biz, 'billing_growth');
  await deleteBusinessCompletely({ businessId: biz, adminId });   // real signature: read it
  expect(await count(`billing_transactions WHERE id = $1`, [tx])).toBe(0);
  const a = await queryOne(`SELECT status, total_amount::text, business_name, archive_reason FROM billing_transactions_archive WHERE id = $1`, [tx]);
  expect(a).toMatchObject({ status: 'completed', total_amount: '499.00', archive_reason: 'business_deleted' });
  expect(a.business_name).toContain('…'); // the test business name
});
it('archiving twice does not duplicate', async () => {
  const tx = await paidAndActivated(biz, 'billing_growth');
  const c = await getPool().connect();
  try { expect(await archiveBusinessBillingTransactions(c, biz, 'test')).toBe(1);
        expect(await archiveBusinessBillingTransactions(c, biz, 'test')).toBe(0); } finally { c.release(); }
});
it('a failed delete leaves no archive rows behind', async () => {
  // force the purge to fail after the archive step; the surrounding transaction rolls back
});
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, plus `tests/lib/admin/tenant-purge.test.ts`.** Expected: PASS.

### Task 3: A payment row records the period it paid for (SUB-15)

**Files:**
- Modify: `lib/platform-subscription-checkout.ts` (`completeSubscriptionCheckoutPayment`), `lib/platform-addon-checkout.ts` (`completeAddonCheckoutPayment`)
- Test: `tests/db/payment-record-safety.db.test.ts`

**Interfaces:**
- Inside the completion transaction, after the plan change (and after any free-month extension), the payment row gets `period_start` = the module row's `start_date` and `period_end` = its final `end_date`. For the add-on, `period_start` = the day the paid month starts and `period_end` = the add-on's `end_date`.
- Rows completed earlier keep null periods; nothing back-fills them.

- [ ] **Step 1: Write the failing tests**

```ts
it('a completed subscription payment records its period', async () => {
  const tx = await paidAndActivated(biz, 'billing_growth');
  const m = await moduleRow(biz, 'billing');
  expect(await queryOne(`SELECT period_start::text, period_end::text FROM billing_transactions WHERE id=$1`, [tx]))
    .toEqual({ period_start: m.start_date, period_end: m.end_date });
});
it('free months are inside the recorded period', async () => {
  const coupon = await makeCoupon({ type: 'free_months', value: 3 });
  const tx = await pendingCheckout(biz, 'billing_growth', 499, { couponId: coupon });
  await hook('payment.captured', uniquePay(), 'captured', notesFor(biz, tx, 'billing_growth'), { amountPaise: 49900 });
  const m = await moduleRow(biz, 'billing');
  expect((await queryOne(`SELECT period_end::text FROM billing_transactions WHERE id=$1`, [tx])).period_end).toBe(m.end_date);
});
it('an add-on payment records its month', async () => {
  const tx = await payAddon(biz);
  const a = await addon(biz);
  expect((await queryOne(`SELECT period_end::text FROM billing_transactions WHERE id=$1`, [tx])).period_end).toBe(a.end_date);
});
```

- [ ] **Step 2: Run.** Expected: FAIL (nulls).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, plus `tests/db/billing-money-path.db.test.ts`.** Expected: PASS.

### Task 4: A fresh database and the production setup get the whole catalogue (SUB-14, SUB-36)

**Files:**
- Modify: `database/schema.sql` (append, after the `subscription_plans` and `platform_limits`-related definitions it already contains), `scripts/setup-khatario-production.sh:104-111`
- Test: `tests/lib/schema-base-plans.test.ts` (no database)

**Interfaces:**
- `database/schema.sql` gains one block, placed where the `subscription_plans` table already exists in the file, inserting the four base plan ids the old migrations expect (`free`, `professional`, `business`, `enterprise`) with the names, prices, `features` JSON and `sort_order` from `database/seed_subscriptions.sql`, using `ON CONFLICT (id) DO NOTHING`, so migrations 075, 076, 130, 143, 237, 238 and 255 no longer fail on a fresh database and an existing database is untouched.
- `scripts/setup-khatario-production.sh`: add `platform_limits` to the list of copied catalogue tables, before `subscription_plan_limits`.

- [ ] **Step 1: Write the failing test** (reads files only):

```ts
it('schema.sql seeds the four base plans without overwriting', () => {
  const sql = readFileSync('database/schema.sql', 'utf8');
  const block = sql.slice(sql.indexOf('-- Base subscription plans'));
  for (const id of ['free', 'professional', 'business', 'enterprise']) expect(block).toContain(`'${id}'`);
  expect(block).toMatch(/ON CONFLICT \(id\) DO NOTHING/);
});
it('the production setup copies platform_limits before the plan limits', () => {
  const sh = readFileSync('scripts/setup-khatario-production.sh', 'utf8');
  expect(sh.indexOf('platform_limits')).toBeGreaterThan(-1);
  expect(sh.indexOf('platform_limits')).toBeLessThan(sh.indexOf('subscription_plan_limits'));
});
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Then prove the fresh-database claim on a scratch database on the local server only: `createdb kh_fresh_check`, load `database/schema.sql` with `psql -f` (statement by statement), run `node scripts/run-pending-migrations.js` against it with `DB_NAME=kh_fresh_check`, record which migrations still fail and why, `dropdb kh_fresh_check`. The seven plan-seed failures must be gone; list any that remain (they are outside this task) in the report.
- [ ] **Step 4: Run the test file and `bash -n scripts/setup-khatario-production.sh`.** Expected: PASS, no syntax error.

---

## After the last task

- Migration 479 needs owner approval before staging. On staging and production, read its notices: a skipped unique index means duplicate completed payments exist and need a look.
- Production check still owed from the audit: `SELECT count(*) FROM platform_limits;` must not be 0.
- Append the project log entry and update the audit report's status table.

## Owner decisions inside this plan

| Task | Decision taken here | Alternative |
| --- | --- | --- |
| 1 | Uniqueness applies to completed gateway payments only (Razorpay, Easebuzz); manual and coupon rows are not constrained. | Constrain every payment method. |
| 2 | Deleting a business keeps a copy of its payment rows, with the business name and GSTIN, in an archive that nothing else links to. | Refuse to delete a business that has payments. |
| 3 | Older payment rows are left without a period; nothing is back-filled. | Back-fill from subscription history. |
