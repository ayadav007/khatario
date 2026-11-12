/**
 * Real-PostgreSQL test: import runs (draft, preview, batched commit, undo, history).
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 * Creates its own businesses (and test plans) and removes only those.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

// enforceAccess reads the request headers; outside a route the test supplies the session ones.
const headerBag: { current: Record<string, string> } = { current: {} };
(global as unknown as { __irHeaders: typeof headerBag }).__irHeaders = headerBag;

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({
    get: (name: string) =>
      (global as unknown as { __irHeaders: { current: Record<string, string> } }).__irHeaders.current[
        name.toLowerCase()
      ] ?? null,
  })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));

jest.mock('@/lib/jwt', () => ({
  clearSessionCookie: jest.fn(),
  shouldRotateTokens: jest.fn(async () => ({ rotate: false, payload: null })),
}));
jest.mock('@/lib/platform-jwt', () => ({ getPlatformSessionFromRequest: jest.fn(async () => null) }));

import { getPool, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { SECTIONS } from '@/lib/import/sections';
import {
  commitNextBatch,
  createDraftRun,
  ImportRunError,
  listRuns,
  previewRun,
  problemRowsCsv,
  undoRun,
} from '@/lib/import/run';

// 27AAAPA1234A1ZT carries a correct check character.
const GSTIN_A = '27AAAPA1234A1ZT';
const PREFIX = 'Imp run ';

const csv = (lines: string[]) => Buffer.from(lines.join('\n') + '\n', 'utf8');
const runCode = (code: string) => expect.objectContaining({ code });

d('import runs (real DB)', () => {
  jest.setTimeout(180000);

  let pool: Pool;
  const tag = randomUUID().slice(0, 8);
  const BIG_PLAN = `test_imprun_${tag}`;
  const SMALL_PLAN = `test_imprun_s_${tag}`;
  const MID_PLAN = `test_imprun_m_${tag}`;

  type Biz = { id: string; branch: string; user: string; ctx: { businessId: string; userId: string } };
  const newBiz = (): Biz => {
    const id = randomUUID();
    const user = randomUUID();
    return { id, branch: randomUUID(), user, ctx: { businessId: id, userId: user } };
  };
  const A = newBiz(); // main business
  const O = newBiz(); // another business
  const L = newBiz(); // business on a plan with a customer limit of 2
  const M = newBiz(); // business on a plan with a customer limit of 300
  const N = newBiz(); // business whose subscription has ended
  const D = newBiz(); // business with an active subscription but the billing module switched off

  const useSession = (b: Biz) => {
    headerBag.current = {
      'x-authenticated-user-id': b.user,
      'x-authenticated-business-id': b.id,
      'x-authenticated-session-version': '1',
    };
  };

  async function seedBusiness(b: Biz, planId: string, phonePrefix: string) {
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
       VALUES ($1, $2, $3, '27', 'regular', 'billing')`,
      [b.id, `${PREFIX}${tag} ${phonePrefix}`, GSTIN_A]
    );
    await pool.query(
      `INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`,
      [b.id]
    );
    await pool.query(
      `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date)
       VALUES ($1, 'billing', $2, 'active', CURRENT_DATE, CURRENT_DATE + 30)`,
      [b.id, planId]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [b.branch, b.id]
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version, is_active)
       VALUES ($1, $2, 'Admin', $3, true, 1, true)`,
      [b.user, b.id, `${phonePrefix}${Date.now().toString().slice(-8)}`]
    );
  }

  async function purge(businessIds: string[], planIds: string[]) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await withLedgerDelete(c, 'admin:seed_demo', null, async () => {
        await c.query(`DELETE FROM ledger_entry_lines WHERE business_id = ANY($1::uuid[])`, [businessIds]);
        await c.query(`DELETE FROM ledger_entries WHERE business_id = ANY($1::uuid[])`, [businessIds]);
      });
      for (const id of businessIds) {
        await c.query(`DELETE FROM import_runs WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM import_column_matches WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id = $1)`, [id]);
        await c.query(`DELETE FROM invoices WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM customers WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM items WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM activity_logs WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM user_branches WHERE user_id IN (SELECT id FROM users WHERE business_id = $1)`, [id]);
        await c.query(`DELETE FROM branches WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM users WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM business_module_subscriptions WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM business_modules WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM businesses WHERE id = $1`, [id]);
      }
      if (planIds.length) await c.query(`DELETE FROM subscription_plans WHERE id = ANY($1::text[])`, [planIds]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  /** A copy of a plan that allows customers, with only the given customer limit. */
  async function copyPlan(fromPlan: string, newPlan: string, maxCustomers: number) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`CREATE TEMP TABLE tmp_plan ON COMMIT DROP AS SELECT * FROM subscription_plans WHERE id = $1`, [fromPlan]);
      await c.query(`UPDATE tmp_plan SET id = $1, name = $1, display_name = $1, is_active = false`, [newPlan]);
      await c.query(`INSERT INTO subscription_plans SELECT * FROM tmp_plan`);
      await c.query(
        `INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
         SELECT $1, feature_id, enabled FROM subscription_plan_features WHERE plan_id = $2`,
        [newPlan, fromPlan]
      );
      await c.query(
        `INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value) VALUES ($1, 'max_customers', $2)`,
        [newPlan, maxCustomers]
      );
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  const customerCount = async (b: Biz) =>
    (await pool.query(`SELECT COUNT(*)::int AS n FROM customers WHERE business_id = $1 AND deleted_at IS NULL`, [b.id]))
      .rows[0].n as number;
  const runRow = async (id: string) => (await pool.query(`SELECT * FROM import_runs WHERE id = $1`, [id])).rows[0];
  const problemRows = async (id: string) =>
    (
      await pool.query<{ row_number: number; status: string; reasons: string[]; cells: string[] }>(
        `SELECT row_number, status, reasons, cells FROM import_run_problems WHERE run_id = $1 ORDER BY row_number`,
        [id]
      )
    ).rows;
  const recordCount = async (id: string) =>
    (await pool.query(`SELECT COUNT(*)::int AS n FROM import_run_records WHERE run_id = $1`, [id])).rows[0].n as number;

  async function commitAll(b: Biz, runId: string) {
    for (let i = 0; i < 100; i++) {
      const r = await commitNextBatch(b.ctx, runId);
      if (r.done) return r;
    }
    throw new Error('commit did not finish');
  }

  /** Draft and preview with the guessed matches. */
  async function draftAndPreview(b: Biz, lines: string[], fileName = 'c.csv') {
    const draft = await createDraftRun(b.ctx, { section: 'customers', sourceApp: 'other', fileName, buffer: csv(lines) });
    const preview = await previewRun(b.ctx, draft.runId, { columnMatches: draft.guesses, valueMatches: {}, dateOrder: 'dmy' });
    return { draft, preview };
  }

  beforeAll(async () => {
    pool = getPool();
    const orphans = await pool.query<{ id: string }>(`SELECT id FROM businesses WHERE name LIKE $1`, [`${PREFIX}%`]);
    const orphanPlans = await pool.query<{ id: string }>(`SELECT id FROM subscription_plans WHERE id LIKE 'test_imprun_%'`);
    if (orphans.rows.length || orphanPlans.rows.length) {
      await purge(orphans.rows.map((r) => r.id), orphanPlans.rows.map((r) => r.id));
    }
    const plan = await pool.query<{ plan_id: string }>(
      `SELECT plan_id FROM subscription_plan_features
        WHERE enabled = true AND feature_id IN ('supplier_management', 'purchase_suppliers') LIMIT 1`
    );
    if (!plan.rows[0]) throw new Error('No plan grants supplier_management (or purchase_suppliers)');
    await copyPlan(plan.rows[0].plan_id, BIG_PLAN, 100000);
    await copyPlan(plan.rows[0].plan_id, SMALL_PLAN, 2);
    await copyPlan(plan.rows[0].plan_id, MID_PLAN, 300);
    await seedBusiness(A, BIG_PLAN, '81');
    await seedBusiness(L, SMALL_PLAN, '82');
    await seedBusiness(M, MID_PLAN, '83');
    await seedBusiness(N, BIG_PLAN, '84');
    await seedBusiness(D, BIG_PLAN, '85');
    // Billing switched off with another module on (with no module on, billing is derived again).
    await pool.query(`UPDATE business_modules SET enabled = false WHERE business_id = $1`, [D.id]);
    await pool.query(
      `INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'hr', true, 'test')`,
      [D.id]
    );
    await pool.query(
      `UPDATE business_module_subscriptions SET status = 'cancelled', end_date = CURRENT_DATE - 1 WHERE business_id = $1`,
      [N.id]
    );
    useSession(A);
  });

  afterAll(async () => {
    try {
      if (pool) await purge([A.id, L.id, M.id, N.id, D.id], [BIG_PLAN, SMALL_PLAN, MID_PLAN]);
    } finally {
      await closePool();
    }
  });

  let firstRunId = '';

  test('draft → preview counts', async () => {
    await pool.query(`INSERT INTO customers (business_id, name, gstin) VALUES ($1, 'Existing Co', $2)`, [A.id, GSTIN_A]);
    const buffer = csv([
      'Name,GSTIN,Phone',
      'Alpha Traders,,9876500001',
      'Bad Gst,27XXXX,9876500002',
      'Copy Of Existing,' + GSTIN_A + ',9876500003',
      'Delta Stores,,+91 98765 00001',
    ]);
    const d0 = await createDraftRun(A.ctx, { section: 'customers', sourceApp: 'other', fileName: 'c.csv', buffer });
    firstRunId = d0.runId;
    expect(d0.guesses).toEqual({ 0: 'name', 1: 'gstin', 2: 'phone' });
    expect(d0.rowCount).toBe(4);
    expect(d0.samples).toEqual([
      ['Alpha Traders', '', '9876500001'],
      ['Bad Gst', '27XXXX', '9876500002'],
      ['Copy Of Existing', GSTIN_A, '9876500003'],
    ]);
    expect(d0.needsDateOrder).toBe(false);
    expect(d0.fields.map((f) => f.key)).toContain('name');

    const p = await previewRun(A.ctx, d0.runId, { columnMatches: d0.guesses, valueMatches: {}, dateOrder: 'dmy' });
    expect(p).toMatchObject({ ready: 1, needsAttention: 1, alreadyExists: 2, missingRequired: [], unmatched: [] });
    expect(p.limit.allowed).toBe(true);
    expect(p.problems.find((x) => x.rowNumber === 3)).toMatchObject({ status: 'needs_attention' });
    expect(p.problems.find((x) => x.rowNumber === 4)!.reasons[0]).toBe('Already exists: Existing Co, matched on GSTIN');
    expect(p.problems.find((x) => x.rowNumber === 5)!.reasons[0]).toMatch(/Same as row 2 in this file/);
  });

  test('commit saves ready rows only and records them', async () => {
    const r = await commitNextBatch(A.ctx, firstRunId);
    expect(r).toEqual({ done: true, processed: 4, total: 4, saved: 1, skipped: 2, failed: 1 });
    expect(await recordCount(firstRunId)).toBe(1);
    const run = await runRow(firstRunId);
    expect(run.status).toBe('done');
    expect(run.draft_rows).toBeNull();
    expect(run.row_numbers).toBeNull();
    expect((await problemRows(firstRunId)).map((x) => [x.row_number, x.status])).toEqual([
      [3, 'needs_attention'],
      [4, 'already_exists'],
      [5, 'already_exists'],
    ]);
    const rec = (await pool.query(`SELECT * FROM import_run_records WHERE run_id = $1`, [firstRunId])).rows[0];
    expect(rec).toMatchObject({ record_table: 'customers', row_number: 2, business_id: A.id });
    const log = await pool.query(
      `SELECT description FROM activity_logs WHERE business_id = $1 AND entity_id = $2`,
      [A.id, firstRunId]
    );
    expect(log.rows.map((x) => x.description)).toEqual(['Imported 1 customers from c.csv']);
    await expect(commitNextBatch(A.ctx, firstRunId)).rejects.toEqual(runCode('NOT_COMMITTABLE'));
  });

  test('row numbers come from the file when a blank line sits between data rows', async () => {
    const { preview } = await draftAndPreview(A, ['Name,GSTIN', 'Blank Gap One,', '', ',', 'Blank Gap Bad,27BAD']);
    expect(preview.problems).toEqual([
      { rowNumber: 5, status: 'needs_attention', reasons: ['"GSTIN" is not a valid GSTIN: 27BAD'] },
    ]);
  });

  test('commit resumes after an interruption without saving a row twice', async () => {
    const before = await customerCount(A);
    const lines = ['Name,City'];
    for (let i = 0; i < 450; i++) lines.push(`Bulk Customer ${i},Pune`);
    const { draft, preview } = await draftAndPreview(A, lines, 'bulk.csv');
    expect(preview.ready).toBe(450);
    const first = await commitNextBatch(A.ctx, draft.runId);
    expect(first).toMatchObject({ done: false, processed: 200, total: 450, saved: 200 });
    expect((await runRow(draft.runId)).status).toBe('committing');
    // Crash: nobody calls again for a while. Then the client resumes.
    const last = await commitAll(A, draft.runId);
    expect(last).toMatchObject({ done: true, processed: 450, total: 450, saved: 450, skipped: 0, failed: 0 });
    expect((await customerCount(A)) - before).toBe(450);
    expect(await recordCount(draft.runId)).toBe(450);
  });

  test('a saveRow that throws marks the run failed; the next call resumes without duplicates', async () => {
    const before = await customerCount(A);
    const def = SECTIONS.customers;
    const original = def.saveRow.bind(def);
    let calls = 0;
    const spy = jest.spyOn(def, 'saveRow').mockImplementation(async (ctx, values) => {
      calls += 1;
      if (calls === 3) throw new Error('database went away');
      return original(ctx, values);
    });
    try {
      const { draft } = await draftAndPreview(A, ['Name,City', 'Fail A,Pune', 'Fail B,Pune', 'Fail C,Pune', 'Fail D,Pune', 'Fail E,Pune']);
      await expect(commitNextBatch(A.ctx, draft.runId)).rejects.toThrow('database went away');
      const run = await runRow(draft.runId);
      expect(run.status).toBe('failed');
      expect(run.cursor).toBe(2);
      expect(await recordCount(draft.runId)).toBe(2);
      const r = await commitAll(A, draft.runId);
      expect(r).toMatchObject({ done: true, saved: 5, failed: 0, skipped: 0 });
      expect((await customerCount(A)) - before).toBe(5);
      expect(await recordCount(draft.runId)).toBe(5);
    } finally {
      spy.mockRestore();
    }
  });

  test('a connection error from saveRow still marks the run failed', async () => {
    const spy = jest
      .spyOn(SECTIONS.customers, 'saveRow')
      .mockRejectedValue(Object.assign(new Error('terminating connection'), { code: '08006' }));
    try {
      const { draft } = await draftAndPreview(A, ['Name,City', 'Conn One,Pune', 'Conn Two,Pune']);
      await expect(commitNextBatch(A.ctx, draft.runId)).rejects.toThrow('terminating connection');
      expect(await runRow(draft.runId)).toMatchObject({ status: 'failed', cursor: 0 });
      expect(await problemRows(draft.runId)).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  test('an item HSN longer than its column needs attention at preview', async () => {
    const draft = await createDraftRun(A.ctx, {
      section: 'items',
      sourceApp: 'other',
      fileName: 'i.csv',
      buffer: csv(['Item name,HSN', 'Long Hsn Item,12345678901', 'Short Hsn Item,0902']),
    });
    const p = await previewRun(A.ctx, draft.runId, { columnMatches: draft.guesses, valueMatches: {}, dateOrder: 'dmy' });
    expect(p).toMatchObject({ ready: 1, needsAttention: 1 });
    expect(p.problems).toEqual([
      { rowNumber: 2, status: 'needs_attention', reasons: ['"HSN" is longer than 10 characters'] },
    ]);
    await pool.query(`DELETE FROM import_runs WHERE id = $1`, [draft.runId]);
  });

  test('a row that breaks a unique index at commit fails with a reason and the next rows are saved', async () => {
    const barcode = `89${Date.now()}`;
    await pool.query(
      `INSERT INTO items (business_id, name, barcode, deleted_at) VALUES ($1, 'Deleted Barcode Item', $2, now())`,
      [A.id, barcode]
    );
    const draft = await createDraftRun(A.ctx, {
      section: 'items',
      sourceApp: 'other',
      fileName: 'b.csv',
      buffer: csv(['Item name,Barcode', `Barcode Clash,${barcode}`, 'After Clash One,', 'After Clash Two,']),
    });
    const p = await previewRun(A.ctx, draft.runId, { columnMatches: draft.guesses, valueMatches: {}, dateOrder: 'dmy' });
    expect(p.ready).toBe(3);
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
    let r;
    try {
      r = await commitAll(A, draft.runId);
    } finally {
      quiet.mockRestore();
    }
    expect(r).toMatchObject({ done: true, saved: 2, failed: 1, skipped: 0 });
    expect((await runRow(draft.runId)).status).toBe('done');
    expect(await problemRows(draft.runId)).toEqual([
      {
        row_number: 2,
        status: 'failed',
        reasons: ['Barcode is already used by another item (it may be deleted).'],
        cells: [`Barcode Clash`, barcode],
      },
    ]);
    const saved = await pool.query(
      `SELECT name FROM items WHERE business_id = $1 AND name LIKE 'After Clash%' AND deleted_at IS NULL ORDER BY name`,
      [A.id]
    );
    expect(saved.rows.map((x) => x.name)).toEqual(['After Clash One', 'After Clash Two']);
  });

  test('a run that failed while finishing (every row processed) is finished by the next call', async () => {
    const { draft } = await draftAndPreview(A, ['Name,City', 'Finish Fail,Pune']);
    // As if the last batch processed every row and the finishing transaction then failed.
    await pool.query(`UPDATE import_runs SET status = 'failed', cursor = 1, counts = $2 WHERE id = $1`, [
      draft.runId,
      JSON.stringify({ total: 1, saved: 0, skipped: 0, failed: 1 }),
    ]);
    expect(await commitNextBatch(A.ctx, draft.runId)).toEqual({
      done: true,
      processed: 1,
      total: 1,
      saved: 0,
      skipped: 0,
      failed: 1,
    });
    expect(await runRow(draft.runId)).toMatchObject({ status: 'done', draft_rows: null });
  });

  test('a crash after a save but before its bookkeeping is caught by findExisting on resume', async () => {
    const before = await customerCount(A);
    const { draft } = await draftAndPreview(A, ['Name,City', 'Ghost One,Pune', 'Ghost Two,Pune']);
    // Ghost One was saved by the service, then the process died before the run recorded it.
    await SECTIONS.customers.saveRow(A.ctx, { name: 'Ghost One' });
    const r = await commitAll(A, draft.runId);
    expect(r).toMatchObject({ saved: 1, skipped: 1 });
    expect((await customerCount(A)) - before).toBe(2);
  });

  test('a second concurrent commit on the same business and section is IMPORT_BUSY', async () => {
    const def = SECTIONS.customers;
    const original = def.saveRow.bind(def);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    let entered: () => void = () => {};
    const inSave = new Promise<void>((resolve) => (entered = resolve));
    const spy = jest.spyOn(def, 'saveRow').mockImplementation(async (ctx, values) => {
      entered();
      await gate;
      return original(ctx, values);
    });
    try {
      const one = await draftAndPreview(A, ['Name,City', 'Busy One,Pune']);
      const two = await draftAndPreview(A, ['Name,City', 'Busy Two,Pune']);
      const running = commitNextBatch(A.ctx, one.draft.runId);
      await inSave;
      await expect(commitNextBatch(A.ctx, two.draft.runId)).rejects.toEqual(runCode('IMPORT_BUSY'));
      await expect(commitNextBatch(A.ctx, one.draft.runId)).rejects.toEqual(runCode('IMPORT_BUSY'));
      release();
      await expect(running).resolves.toMatchObject({ done: true, saved: 1 });
      // The lock was released: the other run goes through now.
      await expect(commitNextBatch(A.ctx, two.draft.runId)).resolves.toMatchObject({ done: true, saved: 1 });
    } finally {
      release();
      spy.mockRestore();
    }
  });

  test('undo removes unused records and keeps used ones with a reason', async () => {
    const { draft } = await draftAndPreview(A, ['Name,City', 'Undo One,Pune', 'Undo Two,Pune', 'Undo Three,Pune']);
    await commitAll(A, draft.runId);
    const used = await pool.query<{ id: string }>(
      `SELECT id FROM customers WHERE business_id = $1 AND name = 'Undo Two'`,
      [A.id]
    );
    await pool.query(
      `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, status, document_type, branch_id)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 'draft', 'tax_invoice', $5)`,
      [randomUUID(), A.id, used.rows[0].id, `IMP-${randomUUID().slice(0, 8)}`, A.branch]
    );
    const r = await undoRun(A.ctx, draft.runId);
    expect(r).toEqual({ removed: 2, kept: [{ label: 'Undo Two', reason: 'Used in invoices' }], done: true });
    expect((await runRow(draft.runId)).status).toBe('done');
    const live = await pool.query(
      `SELECT name FROM customers WHERE business_id = $1 AND name LIKE 'Undo %' AND deleted_at IS NULL`,
      [A.id]
    );
    expect(live.rows.map((x) => x.name)).toEqual(['Undo Two']);
    const undone = await pool.query(
      `SELECT COUNT(*)::int AS n FROM import_run_records WHERE run_id = $1 AND undone_at IS NOT NULL`,
      [draft.runId]
    );
    expect(undone.rows[0].n).toBe(2);
  });

  test('undo of a run whose records are all unused marks it undone', async () => {
    const { draft } = await draftAndPreview(A, ['Name,City', 'Gone One,Pune', 'Gone Two,Pune']);
    await commitAll(A, draft.runId);
    expect(await undoRun(A.ctx, draft.runId)).toEqual({ removed: 2, kept: [], done: true });
    expect((await runRow(draft.runId)).status).toBe('undone');
    await expect(undoRun(A.ctx, draft.runId)).rejects.toEqual(runCode('NOT_UNDOABLE'));
  });

  test('an undo of 2,500 records takes two calls and ends undone', async () => {
    const { draft } = await draftAndPreview(A, ['Name,City', 'Big Undo Seed,Pune'], 'bigundo.csv');
    await commitAll(A, draft.runId);
    // 2,500 more records on the same run, written directly: the commit path is tested elsewhere.
    await pool.query(
      `WITH c AS (
         INSERT INTO customers (business_id, name) SELECT $1, 'Big Undo ' || g FROM generate_series(1, 2500) g RETURNING id, name
       )
       INSERT INTO import_run_records (run_id, business_id, record_table, record_id, row_number)
       SELECT $2, $1, 'customers', id, 2 + substring(name FROM 10)::int FROM c`,
      [A.id, draft.runId]
    );
    const first = await undoRun(A.ctx, draft.runId);
    expect(first).toEqual({ removed: 2000, kept: [], done: false });
    expect((await runRow(draft.runId)).status).toBe('done');
    const second = await undoRun(A.ctx, draft.runId);
    expect(second).toEqual({ removed: 501, kept: [], done: true });
    expect((await runRow(draft.runId)).status).toBe('undone');
    const left = await pool.query(
      `SELECT COUNT(*)::int AS n FROM customers WHERE business_id = $1 AND name LIKE 'Big Undo%' AND deleted_at IS NULL`,
      [A.id]
    );
    expect(left.rows[0].n).toBe(0);
  });

  test('a kept record does not stop a long undo from finishing', async () => {
    const { draft } = await draftAndPreview(A, ['Name,City', 'Kept Long Seed,Pune'], 'keptlong.csv');
    await commitAll(A, draft.runId);
    await pool.query(
      `WITH c AS (
         INSERT INTO customers (business_id, name) SELECT $1, 'Kept Long ' || g FROM generate_series(1, 2100) g RETURNING id, name
       )
       INSERT INTO import_run_records (run_id, business_id, record_table, record_id, row_number)
       SELECT $2, $1, 'customers', id, 2 + substring(name FROM 11)::int FROM c`,
      [A.id, draft.runId]
    );
    // The newest row is used, so the first call keeps it; the second call must not see it again.
    const newest = await pool.query<{ id: string }>(`SELECT id FROM customers WHERE business_id = $1 AND name = 'Kept Long 2100'`, [A.id]);
    await pool.query(
      `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, status, document_type, branch_id)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 'draft', 'tax_invoice', $5)`,
      [randomUUID(), A.id, newest.rows[0].id, `IMP-${randomUUID().slice(0, 8)}`, A.branch]
    );
    expect(await undoRun(A.ctx, draft.runId)).toEqual({
      removed: 1999,
      kept: [{ label: 'Kept Long 2100', reason: 'Used in invoices' }],
      done: false,
    });
    expect(await undoRun(A.ctx, draft.runId)).toEqual({ removed: 101, kept: [], done: true });
    expect((await runRow(draft.runId)).status).toBe('done');
    // A new undo starts from the top again and retries the kept record.
    expect(await undoRun(A.ctx, draft.runId)).toEqual({
      removed: 0,
      kept: [{ label: 'Kept Long 2100', reason: 'Used in invoices' }],
      done: true,
    });
  });

  test('another business cannot read, commit or undo the run', async () => {
    const opts = { columnMatches: { 0: 'name' }, valueMatches: {}, dateOrder: 'dmy' as const };
    await expect(previewRun(O.ctx, firstRunId, opts)).rejects.toEqual(runCode('NOT_FOUND'));
    await expect(commitNextBatch(O.ctx, firstRunId)).rejects.toEqual(runCode('NOT_FOUND'));
    await expect(undoRun(O.ctx, firstRunId)).rejects.toEqual(runCode('NOT_FOUND'));
    await expect(problemRowsCsv(O.ctx, firstRunId)).rejects.toEqual(runCode('NOT_FOUND'));
    expect(await listRuns(O.ctx)).toEqual([]);
    await expect(commitNextBatch(A.ctx, 'not-a-uuid')).rejects.toBeInstanceOf(ImportRunError);
  });

  test('missing required column blocks commit', async () => {
    const draft = await createDraftRun(A.ctx, {
      section: 'customers',
      sourceApp: 'other',
      fileName: 'm.csv',
      buffer: csv(['Name,Phone', 'No Name Match,9876511111']),
    });
    const p = await previewRun(A.ctx, draft.runId, { columnMatches: { 0: null, 1: 'phone' }, valueMatches: {}, dateOrder: 'dmy' });
    expect(p.missingRequired).toEqual(['Customer name']);
    await expect(commitNextBatch(A.ctx, draft.runId)).rejects.toEqual(runCode('MISSING_REQUIRED'));
    expect((await runRow(draft.runId)).status).toBe('draft');
  });

  test('a commit before any preview is refused', async () => {
    const draft = await createDraftRun(A.ctx, {
      section: 'customers',
      sourceApp: 'other',
      fileName: 'n.csv',
      buffer: csv(['Name,City', 'Never Previewed,Pune']),
    });
    await expect(commitNextBatch(A.ctx, draft.runId)).rejects.toEqual(runCode('NOT_COMMITTABLE'));
  });

  test(`a header set to "Don't import" stays unmatched on the next upload`, async () => {
    const one = await createDraftRun(A.ctx, {
      section: 'customers',
      sourceApp: 'other',
      fileName: 'skip.csv',
      buffer: csv(['Name,Address', 'Skip Header One,Some street']),
    });
    // Without a saved choice, 'Address' is matched by its alias.
    expect(one.guesses).toEqual({ 0: 'name', 1: 'address' });
    await previewRun(A.ctx, one.runId, { columnMatches: { 0: 'name', 1: null }, valueMatches: {}, dateOrder: 'dmy' });
    await commitAll(A, one.runId);
    const two = await createDraftRun(A.ctx, {
      section: 'customers',
      sourceApp: 'other',
      fileName: 'skip2.csv',
      buffer: csv(['Name,Address', 'Skip Header Two,Other street']),
    });
    expect(two.guesses).toEqual({ 0: 'name', 1: null });
  });

  test('a run left committing can be undone', async () => {
    const { draft } = await draftAndPreview(A, ['Name,City', 'Stuck One,Pune', 'Stuck Two,Pune']);
    await commitAll(A, draft.runId);
    // As if the process died mid-run and the run was never marked failed.
    await pool.query(`UPDATE import_runs SET status = 'committing' WHERE id = $1`, [draft.runId]);
    expect(await undoRun(A.ctx, draft.runId)).toEqual({ removed: 2, kept: [], done: true });
    const run = await runRow(draft.runId);
    expect(run).toMatchObject({ status: 'undone', draft_rows: null, row_numbers: null });
  });

  test('a partial undo of a failed run leaves it done; undoing again retries the kept record', async () => {
    const def = SECTIONS.customers;
    const original = def.saveRow.bind(def);
    let calls = 0;
    const spy = jest.spyOn(def, 'saveRow').mockImplementation(async (ctx, values) => {
      calls += 1;
      if (calls === 3) throw new Error('database went away');
      return original(ctx, values);
    });
    let runId = '';
    try {
      const { draft } = await draftAndPreview(A, ['Name,City', 'Partial One,Pune', 'Partial Two,Pune', 'Partial Three,Pune']);
      runId = draft.runId;
      await expect(commitNextBatch(A.ctx, runId)).rejects.toThrow('database went away');
    } finally {
      spy.mockRestore();
    }
    expect((await runRow(runId)).status).toBe('failed');
    const used = await pool.query<{ id: string }>(`SELECT id FROM customers WHERE business_id = $1 AND name = 'Partial One'`, [A.id]);
    const invoiceId = randomUUID();
    await pool.query(
      `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date, status, document_type, branch_id)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, 'draft', 'tax_invoice', $5)`,
      [invoiceId, A.id, used.rows[0].id, `IMP-${randomUUID().slice(0, 8)}`, A.branch]
    );
    expect(await undoRun(A.ctx, runId)).toEqual({ removed: 1, kept: [{ label: 'Partial One', reason: 'Used in invoices' }], done: true });
    expect(await runRow(runId)).toMatchObject({ status: 'done', draft_rows: null, row_numbers: null });

    await pool.query(`DELETE FROM invoices WHERE id = $1`, [invoiceId]);
    expect(await undoRun(A.ctx, runId)).toEqual({ removed: 1, kept: [], done: true });
    expect((await runRow(runId)).status).toBe('undone');
  });

  test("problem rows go to their own table with the user's row numbers", async () => {
    const lines = ['Name,City'];
    const existing: string[] = [];
    for (let i = 0; i < 450; i++) {
      lines.push(`Half Customer ${i},Pune`);
      if (i % 2 === 1) existing.push(`Half Customer ${i}`);
    }
    await pool.query(
      `INSERT INTO customers (business_id, name) SELECT $1, unnest($2::text[])`,
      [A.id, existing]
    );
    const before = await customerCount(A);
    const { draft, preview } = await draftAndPreview(A, lines, 'half.csv');
    expect(preview).toMatchObject({ ready: 225, alreadyExists: 225 });
    const r = await commitAll(A, draft.runId);
    expect(r).toMatchObject({ done: true, processed: 450, saved: 225, skipped: 225, failed: 0 });
    expect((await customerCount(A)) - before).toBe(225);
    const problems = await problemRows(draft.runId);
    // Data row i sits on file row i + 2; the odd ones already existed.
    expect(problems.map((p) => p.row_number)).toEqual(Array.from({ length: 225 }, (_, k) => 2 * k + 3));
    expect(problems.every((p) => p.status === 'already_exists')).toBe(true);
    expect(problems[0]).toMatchObject({
      cells: ['Half Customer 1', 'Pune'],
      reasons: ['Already exists: Half Customer 1, matched on name'],
    });
    const csvLines = (await problemRowsCsv(A.ctx, draft.runId)).trim().split(/\r?\n/);
    expect(csvLines).toHaveLength(226);
    expect(csvLines[1]).toBe('Half Customer 1,Pune,3,"Already exists: Half Customer 1, matched on name"');
  });

  test('saved column matches are reused on the next upload', async () => {
    const lines = ['Client,Mobile', 'Saved Match One,9876522222'];
    const one = await createDraftRun(A.ctx, { section: 'customers', sourceApp: 'other', fileName: 's.csv', buffer: csv(lines) });
    expect(one.guesses[0]).toBeNull();
    await previewRun(A.ctx, one.runId, { columnMatches: { 0: 'name', 1: 'phone' }, valueMatches: {}, dateOrder: 'dmy' });
    await commitAll(A, one.runId);
    const two = await createDraftRun(A.ctx, {
      section: 'customers',
      sourceApp: 'other',
      fileName: 's2.csv',
      buffer: csv(['Client,Mobile', 'Saved Match Two,9876533333']),
    });
    expect(two.guesses).toEqual({ 0: 'name', 1: 'phone' });
  });

  test('problem rows csv escapes formulas', async () => {
    const { draft } = await draftAndPreview(A, ['Name,GSTIN', '"=HYPERLINK(""http://x"")",27BAD', 'Fine Row,']);
    await commitAll(A, draft.runId);
    const out = await problemRowsCsv(A.ctx, draft.runId);
    const lines = out.trim().split(/\r?\n/);
    expect(lines[0]).toBe('Name,GSTIN,Row,Reason');
    expect(lines[1]).toBe(`"'=HYPERLINK(""http://x"")",27BAD,2,"""GSTIN"" is not a valid GSTIN: 27BAD"`);
    expect(lines).toHaveLength(2);
  });

  test('a previewed draft gives every problem row in the csv, rebuilt on each preview', async () => {
    const lines = ['Name,GSTIN'];
    for (let i = 0; i < 60; i++) lines.push(`Preview Bad ${i},27BAD${i}`);
    lines.push('Preview Fine,');
    const { draft, preview } = await draftAndPreview(A, lines, 'pv.csv');
    expect(preview).toMatchObject({ ready: 1, needsAttention: 60 });
    expect(preview.problems).toHaveLength(50);
    const out = (await problemRowsCsv(A.ctx, draft.runId)).trim().split(/\r?\n/);
    expect(out).toHaveLength(61);
    expect(out[0]).toBe('Name,GSTIN,Row,Reason');
    expect(out[1]).toBe('Preview Bad 0,27BAD0,2,"""GSTIN"" is not a valid GSTIN: 27BAD0"');
    expect(out[60]).toMatch(/^Preview Bad 59,27BAD59,61,/);

    // A later preview replaces the list: without the GSTIN column every row is ready.
    await previewRun(A.ctx, draft.runId, { columnMatches: { 0: 'name', 1: null }, valueMatches: {}, dateOrder: 'dmy' });
    expect((await problemRowsCsv(A.ctx, draft.runId)).trim().split(/\r?\n/)).toEqual(['Name,GSTIN,Row,Reason']);
    await pool.query(`DELETE FROM import_runs WHERE id = $1`, [draft.runId]);
  });

  test('history lists committed runs newest first, without drafts', async () => {
    const runs = await listRuns(A.ctx, 'customers');
    expect(runs.length).toBeGreaterThan(3);
    expect(runs.every((r) => r.section === 'customers')).toBe(true);
    const stamps = runs.map((r) => r.createdAt);
    expect([...stamps].sort().reverse()).toEqual(stamps);
    const first = runs.find((r) => r.id === firstRunId)!;
    expect(first).toMatchObject({
      status: 'done',
      fileName: 'c.csv',
      sourceApp: 'other',
      saved: 1,
      skipped: 2,
      failed: 1,
      processed: 4,
      total: 4,
      createdByName: 'Admin',
    });
    const drafts = await pool.query(`SELECT id FROM import_runs WHERE business_id = $1 AND status = 'draft'`, [A.id]);
    expect(drafts.rows.length).toBeGreaterThan(0);
    for (const row of drafts.rows) expect(runs.some((r) => r.id === row.id)).toBe(false);
  });

  test('drafts older than 24 hours are removed when a new draft starts', async () => {
    const old = await createDraftRun(A.ctx, { section: 'customers', sourceApp: 'other', fileName: 'old.csv', buffer: csv(['Name,City', 'Old,Pune']) });
    await pool.query(`UPDATE import_runs SET created_at = now() - interval '25 hours' WHERE id = $1`, [old.runId]);
    await createDraftRun(A.ctx, { section: 'customers', sourceApp: 'other', fileName: 'new.csv', buffer: csv(['Name,City', 'New,Pune']) });
    expect(await runRow(old.runId)).toBeUndefined();
  });

  describe('items access', () => {
    afterAll(() => useSession(A));

    test('a business without an active subscription is refused items at preview and at commit', async () => {
      useSession(N);
      const draft = await createDraftRun(N.ctx, {
        section: 'items',
        sourceApp: 'other',
        fileName: 'n.csv',
        buffer: csv(['Item name,Unit', 'No Plan Item,PCS']),
      });
      const p = await previewRun(N.ctx, draft.runId, { columnMatches: draft.guesses, valueMatches: {}, dateOrder: 'dmy' });
      expect(p.ready).toBe(1);
      expect(p.limit.allowed).toBe(false);
      expect(p.limit.message).toBeTruthy();
      await expect(commitNextBatch(N.ctx, draft.runId)).rejects.toEqual(
        expect.objectContaining({ code: 'LIMIT_REACHED', message: p.limit.message })
      );
      expect((await runRow(draft.runId)).status).toBe('draft');
      const items = await pool.query(`SELECT COUNT(*)::int AS n FROM items WHERE business_id = $1`, [N.id]);
      expect(items.rows[0].n).toBe(0);
    });

    test('the module check the items route made (enforceAccess) refuses at preview and at commit', async () => {
      useSession(D);
      const draft = await createDraftRun(D.ctx, {
        section: 'items',
        sourceApp: 'other',
        fileName: 'd.csv',
        buffer: csv(['Item name,Unit', 'Module Off Item,PCS']),
      });
      const p = await previewRun(D.ctx, draft.runId, { columnMatches: draft.guesses, valueMatches: {}, dateOrder: 'dmy' });
      expect(p.limit.allowed).toBe(false);
      expect(p.limit.message).toBeTruthy();
      await expect(commitNextBatch(D.ctx, draft.runId)).rejects.toEqual(
        expect.objectContaining({ code: 'LIMIT_REACHED', message: p.limit.message })
      );
      const items = await pool.query(`SELECT COUNT(*)::int AS n FROM items WHERE business_id = $1`, [D.id]);
      expect(items.rows[0].n).toBe(0);
    });
  });

  describe('items access check', () => {
    test('a session revoked after preview is refused at commit for items, as the items route did', async () => {
      useSession(A);
      const draft = await createDraftRun(A.ctx, {
        section: 'items',
        sourceApp: 'other',
        fileName: 'r.csv',
        buffer: csv(['Item name,Unit', 'Revoked Session Item,PCS']),
      });
      const p = await previewRun(A.ctx, draft.runId, { columnMatches: draft.guesses, valueMatches: {}, dateOrder: 'dmy' });
      expect(p.limit.allowed).toBe(true);
      await pool.query(`UPDATE users SET auth_session_version = 2 WHERE id = $1`, [A.user]);
      try {
        await expect(commitNextBatch(A.ctx, draft.runId)).rejects.toEqual(runCode('LIMIT_REACHED'));
      } finally {
        await pool.query(`UPDATE users SET auth_session_version = 1 WHERE id = $1`, [A.user]);
      }
      const items = await pool.query(`SELECT COUNT(*)::int AS n FROM items WHERE business_id = $1 AND name = 'Revoked Session Item'`, [A.id]);
      expect(items.rows[0].n).toBe(0);
      await pool.query(`DELETE FROM import_runs WHERE id = $1`, [draft.runId]);
    });
  });

  describe('plan limit', () => {
    beforeAll(() => useSession(L));
    afterAll(() => useSession(A));

    test('preview refuses a file over the limit and commit is refused', async () => {
      const { draft, preview } = await draftAndPreview(L, ['Name,City', 'Lim One,Pune', 'Lim Two,Pune', 'Lim Three,Pune']);
      expect(preview.limit.allowed).toBe(false);
      expect(preview.limit.message).toBeTruthy();
      await expect(commitNextBatch(L.ctx, draft.runId)).rejects.toEqual(runCode('LIMIT_REACHED'));
    });

    test('the limit reached mid-run fails the rest of the rows with a message', async () => {
      const { draft, preview } = await draftAndPreview(L, ['Name,City', 'Mid One,Pune', 'Mid Two,Pune']);
      expect(preview.limit.allowed).toBe(true);
      // While the batch runs someone else adds a customer, using up the last place.
      const def = SECTIONS.customers;
      const original = def.saveRow.bind(def);
      let calls = 0;
      const spy = jest.spyOn(def, 'saveRow').mockImplementation(async (ctx, values) => {
        const r = await original(ctx, values);
        calls += 1;
        if (calls === 1) await pool.query(`INSERT INTO customers (business_id, name) VALUES ($1, 'Added Elsewhere')`, [L.id]);
        return r;
      });
      let r;
      try {
        r = await commitAll(L, draft.runId);
      } finally {
        spy.mockRestore();
      }
      expect(r).toMatchObject({ done: true, saved: 1, failed: 1 });
      const problems = await problemRows(draft.runId);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatchObject({ row_number: 3, status: 'failed' });
      expect(problems[0].reasons[0]).toMatch(/limit/);
    });

    test('a later batch that starts with the limit used up fails its rows without saving', async () => {
      useSession(M);
      const lines = ['Name,City'];
      for (let i = 0; i < 250; i++) lines.push(`Room Customer ${i},Pune`);
      const { draft, preview } = await draftAndPreview(M, lines, 'room.csv');
      expect(preview.limit.allowed).toBe(true);
      expect(await commitNextBatch(M.ctx, draft.runId)).toMatchObject({ done: false, processed: 200, saved: 200 });
      // Someone else uses the last 100 places before batch 2.
      await pool.query(
        `INSERT INTO customers (business_id, name) SELECT $1, 'Elsewhere ' || g FROM generate_series(1, 100) g`,
        [M.id]
      );
      const spy = jest.spyOn(SECTIONS.customers, 'saveRow');
      let r;
      try {
        r = await commitNextBatch(M.ctx, draft.runId);
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
        useSession(L);
      }
      expect(r).toMatchObject({ done: true, processed: 250, saved: 200, failed: 50 });
      const problems = await problemRows(draft.runId);
      expect(problems).toHaveLength(50);
      expect(problems[0].row_number).toBe(202);
      expect(problems.every((p) => p.status === 'failed' && /limit/.test(p.reasons[0]))).toBe(true);
    });
  });
});
