/**
 * Real-PostgreSQL test: the import API routes (upload, preview, commit, undo, problem rows, history).
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database.
 * Creates its own businesses, users, roles and plan and removes only those.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { NextRequest } from 'next/server';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

const headerBag: { current: Record<string, string> } = { current: {} };
(global as unknown as { __irtHeaders: typeof headerBag }).__irtHeaders = headerBag;

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({
    get: (name: string) =>
      (global as unknown as { __irtHeaders: { current: Record<string, string> } }).__irtHeaders.current[
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
import { POST as uploadRoute } from '@/app/api/import/[section]/upload/route';
import { POST as previewRoute } from '@/app/api/import/[section]/preview/route';
import { POST as commitRoute } from '@/app/api/import/[section]/commit/route';
import { POST as undoRoute } from '@/app/api/import/[section]/undo/route';
import { GET as problemRowsRoute } from '@/app/api/import/[section]/problem-rows/route';
import { GET as historyRoute } from '@/app/api/import/history/route';

const PREFIX = 'Imp routes ';
const csvFile = (lines: string[], name = 'c.csv') =>
  new File([lines.join('\n') + '\n'], name, { type: 'text/csv' });

d('import routes (real DB)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const tag = randomUUID().slice(0, 8);
  const PLAN = `test_imprt_${tag}`;
  const A = { id: randomUUID(), branch: randomUUID(), admin: randomUUID(), reader: randomUUID(), role: randomUUID() };
  const O = { id: randomUUID(), branch: randomUUID(), admin: randomUUID() };

  type Who = 'admin' | 'reader' | 'other' | 'nobody';
  const sessionFor = (who: Who): Record<string, string> => {
    if (who === 'nobody') return {};
    const [user, biz] =
      who === 'admin' ? [A.admin, A.id] : who === 'reader' ? [A.reader, A.id] : [O.admin, O.id];
    return {
      'x-authenticated-user-id': user,
      'x-authenticated-business-id': biz,
      'x-authenticated-session-version': '1',
    };
  };

  type Handler = (req: NextRequest, ctx: { params: { section: string } }) => Promise<Response>;
  async function call(
    handler: Handler,
    opts: { who?: Who; section?: string; method?: string; query?: string; json?: unknown; form?: FormData }
  ) {
    const who = opts.who ?? 'admin';
    headerBag.current = sessionFor(who);
    const section = opts.section ?? 'customers';
    const method = opts.method ?? 'POST';
    const headers: Record<string, string> = { ...headerBag.current };
    let body: BodyInit | undefined;
    if (opts.json !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(opts.json);
    } else if (opts.form) {
      body = opts.form;
    }
    const res = await handler(
      new NextRequest(`http://localhost/api/import/${section}/x${opts.query ?? ''}`, { method, headers, body }),
      { params: { section } }
    );
    const bytes = Buffer.from(await res.clone().arrayBuffer());
    const text = await res.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }
    return { status: res.status, json, text, bytes, headers: res.headers };
  }

  const upload = (lines: string[], extra: Record<string, string> = {}, opts: { who?: Who; section?: string } = {}) => {
    const form = new FormData();
    form.append('file', csvFile(lines));
    if (!('source_app' in extra)) form.append('source_app', 'other');
    for (const [k, v] of Object.entries(extra)) form.append(k, v);
    return call(uploadRoute as Handler, { ...opts, form });
  };
  const preview = (runId: string, matches: unknown, extra: Record<string, unknown> = {}, who: Who = 'admin') =>
    call(previewRoute as Handler, {
      who,
      json: { run_id: runId, column_matches: matches, value_matches: {}, date_order: 'dmy', ...extra },
    });
  const commit = (runId: string, extra: Record<string, unknown> = {}, section = 'customers') =>
    call(commitRoute as Handler, { section, json: { run_id: runId, ...extra } });
  const undo = (runId: string, extra: Record<string, unknown> = {}) =>
    call(undoRoute as Handler, { json: { run_id: runId, ...extra } });
  const history = (query = '', who: Who = 'admin') =>
    call(historyRoute as unknown as Handler, { who, method: 'GET', query });

  const customerCount = async (bizId: string) =>
    (await pool.query(`SELECT COUNT(*)::int AS n FROM customers WHERE business_id = $1 AND deleted_at IS NULL`, [bizId]))
      .rows[0].n as number;

  /** Upload, preview with the guessed matches, and commit to the end; returns the run id. */
  async function importAll(lines: string[], section = 'customers') {
    const up = await upload(lines, {}, { section });
    expect(up.status).toBe(200);
    const pv = await call(previewRoute as Handler, {
      section,
      json: { run_id: up.json.runId, column_matches: up.json.guesses, value_matches: {}, date_order: 'dmy' },
    });
    expect(pv.status).toBe(200);
    for (let i = 0; i < 20; i++) {
      const r = await commit(up.json.runId, {}, section);
      expect(r.status).toBe(200);
      if (r.json.done) return up.json.runId as string;
    }
    throw new Error('commit did not finish');
  }

  async function purge(businessIds: string[]) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      for (const id of businessIds) {
        await c.query(`DELETE FROM import_runs WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM import_column_matches WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM customers WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM suppliers WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM activity_logs WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM user_branches WHERE user_id IN (SELECT id FROM users WHERE business_id = $1)`, [id]);
        await c.query(`DELETE FROM branches WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM users WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM user_roles WHERE business_id = $1)`, [id]);
        await c.query(`DELETE FROM user_roles WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM business_module_subscriptions WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM business_modules WHERE business_id = $1`, [id]);
        await c.query(`DELETE FROM businesses WHERE id = $1`, [id]);
      }
      await c.query(`DELETE FROM subscription_plan_limits WHERE plan_id LIKE 'test_imprt_%'`);
      await c.query(`DELETE FROM subscription_plan_features WHERE plan_id LIKE 'test_imprt_%'`);
      await c.query(`DELETE FROM subscription_plans WHERE id LIKE 'test_imprt_%'`);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async function seedBusiness(id: string, branch: string, admin: string, phonePrefix: string, label: string) {
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
       VALUES ($1, $2, '27AAAPA1234A1ZT', '27', 'regular', 'billing')`,
      [id, `${PREFIX}${tag} ${label}`]
    );
    await pool.query(
      `INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`,
      [id]
    );
    await pool.query(
      `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date)
       VALUES ($1, 'billing', $2, 'active', CURRENT_DATE, CURRENT_DATE + 30)`,
      [id, PLAN]
    );
    await pool.query(
      `INSERT INTO branches (id, business_id, name, state_code, is_primary, is_default, is_active)
       VALUES ($1, $2, 'Main', '27', true, true, true)`,
      [branch, id]
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version, is_active)
       VALUES ($1, $2, 'Admin', $3, true, 1, true)`,
      [admin, id, `${phonePrefix}${Date.now().toString().slice(-8)}`]
    );
  }

  beforeAll(async () => {
    pool = getPool();
    const orphans = await pool.query<{ id: string }>(`SELECT id FROM businesses WHERE name LIKE $1`, [`${PREFIX}%`]);
    await purge(orphans.rows.map((r) => r.id));

    const plan = await pool.query<{ plan_id: string }>(
      `SELECT plan_id FROM subscription_plan_features
        WHERE enabled = true AND feature_id IN ('supplier_management', 'purchase_suppliers') LIMIT 1`
    );
    if (!plan.rows[0]) throw new Error('No plan grants supplier_management (or purchase_suppliers)');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`CREATE TEMP TABLE tmp_plan ON COMMIT DROP AS SELECT * FROM subscription_plans WHERE id = $1`, [plan.rows[0].plan_id]);
      await c.query(`UPDATE tmp_plan SET id = $1, name = $1, display_name = $1, is_active = false`, [PLAN]);
      await c.query(`INSERT INTO subscription_plans SELECT * FROM tmp_plan`);
      await c.query(
        `INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
         SELECT $1, feature_id, enabled FROM subscription_plan_features WHERE plan_id = $2`,
        [PLAN, plan.rows[0].plan_id]
      );
      await c.query(`INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value) VALUES ($1, 'max_customers', 100000)`, [PLAN]);
      await c.query(`INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value) VALUES ($1, 'max_suppliers', 100000)`, [PLAN]);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }

    await seedBusiness(A.id, A.branch, A.admin, '81', 'A');
    await seedBusiness(O.id, O.branch, O.admin, '82', 'O');

    // A second user in business A whose role can only view customers: no create, nothing on suppliers or items.
    await pool.query(
      `INSERT INTO permission_modules (module_key, module_name, is_active) VALUES ('customers', 'customers', true)
       ON CONFLICT (module_key) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO user_roles (id, business_id, role_name, role_key, is_system_role) VALUES ($1, $2, 'Customers viewer', 'imprt_viewer', false)`,
      [A.role, A.id]
    );
    await pool.query(
      `INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
       VALUES ($1, 'customers', true, false, false, false, false)`,
      [A.role]
    );
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, role_id, auth_session_version, is_active)
       VALUES ($1, $2, 'Viewer', $3, false, $4, 1, true)`,
      [A.reader, A.id, `83${Date.now().toString().slice(-8)}`, A.role]
    );
  });

  afterAll(async () => {
    try {
      if (pool) await purge([A.id, O.id]);
    } finally {
      await closePool();
    }
  });

  let flowRunId = '';

  test('upload → preview → commit loop → history → undo', async () => {
    const up = await upload(['Name,City', 'Route One,Pune', 'Route Two,Pune', 'Route Three,Pune']);
    expect(up.status).toBe(200);
    expect(up.json).toMatchObject({ headers: ['Name', 'City'], rowCount: 3, guesses: { 0: 'name', 1: 'city' } });
    flowRunId = up.json.runId;

    const pv = await preview(flowRunId, up.json.guesses);
    expect(pv.status).toBe(200);
    expect(pv.json).toMatchObject({ ready: 3, needsAttention: 0, alreadyExists: 0 });

    let done = false;
    for (let i = 0; i < 5 && !done; i++) {
      const r = await commit(flowRunId);
      expect(r.status).toBe(200);
      done = r.json.done;
      if (done) expect(r.json).toMatchObject({ saved: 3, total: 3 });
    }
    expect(done).toBe(true);
    expect(await customerCount(A.id)).toBe(3);

    const h = await history('?section=customers');
    expect(h.status).toBe(200);
    expect(h.json.runs.find((r: any) => r.id === flowRunId)).toMatchObject({ status: 'done', saved: 3, fileName: 'c.csv' });

    const u = await undo(flowRunId);
    expect(u.status).toBe(200);
    expect(u.json).toEqual({ removed: 3, kept: [] });
    expect(await customerCount(A.id)).toBe(0);
  });

  test('business_id and user_id in the body or form are ignored', async () => {
    const up = await upload(['Name,City', 'Spoof One,Pune'], { business_id: O.id, user_id: O.admin });
    expect(up.status).toBe(200);
    const pv = await preview(up.json.runId, up.json.guesses, { business_id: O.id, user_id: O.admin });
    expect(pv.status).toBe(200);
    expect((await commit(up.json.runId, { business_id: O.id, user_id: O.admin })).status).toBe(200);
    expect(await customerCount(A.id)).toBe(1);
    expect(await customerCount(O.id)).toBe(0);
    const run = await pool.query(`SELECT business_id, created_by FROM import_runs WHERE id = $1`, [up.json.runId]);
    expect(run.rows[0]).toEqual({ business_id: A.id, created_by: A.admin });
    expect((await undo(up.json.runId, { business_id: O.id })).status).toBe(200);
  });

  test('a user without customers create gets 403 on upload, preview, commit and undo', async () => {
    const form = new FormData();
    form.append('file', csvFile(['Name,City', 'Nope,Pune']));
    const up = await call(uploadRoute as Handler, { who: 'reader', form });
    expect(up.status).toBe(403);
    expect(await customerCount(A.id)).toBe(0);
    const mine = await upload(['Name,City', 'Reader Try,Pune']);
    expect((await preview(mine.json.runId, mine.json.guesses, {}, 'reader')).status).toBe(403);
    expect((await call(commitRoute as Handler, { who: 'reader', json: { run_id: mine.json.runId } })).status).toBe(403);
    expect((await call(undoRoute as Handler, { who: 'reader', json: { run_id: mine.json.runId } })).status).toBe(403);
  });

  test('no session is 401', async () => {
    const form = new FormData();
    form.append('file', csvFile(['Name,City', 'Anon,Pune']));
    expect((await call(uploadRoute as Handler, { who: 'nobody', form })).status).toBe(401);
    expect((await history('', 'nobody')).status).toBe(401);
  });

  test('unknown section is 404', async () => {
    const form = new FormData();
    form.append('file', csvFile(['Name,City', 'x,y']));
    const res = await call(uploadRoute as Handler, { section: 'invoices', form });
    expect(res.status).toBe(404);
    expect((await history('?section=invoices')).status).toBe(404);
    expect((await call(uploadRoute as Handler, { section: 'constructor', form })).status).toBe(404);
  });

  test('a pdf upload is 400 UNSUPPORTED_TYPE with the message', async () => {
    const form = new FormData();
    form.append('file', new File(['%PDF-1.4'], 'list.pdf', { type: 'application/pdf' }));
    const res = await call(uploadRoute as Handler, { form });
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: 'Upload an Excel (.xlsx) or CSV file.', code: 'UNSUPPORTED_TYPE' });
  });

  test('a file over 10 MB is 400 TOO_LARGE before it is read', async () => {
    const form = new FormData();
    form.append('file', new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.csv', { type: 'text/csv' }));
    const res = await call(uploadRoute as Handler, { form });
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: 'This file is larger than 10 MB.', code: 'TOO_LARGE' });
  });

  test('a Content-Length above 11 MB is 400 TOO_LARGE without reading the body', async () => {
    headerBag.current = sessionFor('admin');
    const res = await (uploadRoute as Handler)(
      new NextRequest('http://localhost/api/import/customers/upload', {
        method: 'POST',
        headers: { ...headerBag.current, 'content-length': String(11 * 1024 * 1024 + 1), 'content-type': 'multipart/form-data; boundary=x' },
        body: 'x',
      }),
      { params: { section: 'customers' } }
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'This file is larger than 10 MB.', code: 'TOO_LARGE' });
  });

  test('a missing file, a text "file" and an unknown source_app are 400 BAD_REQUEST', async () => {
    const none = new FormData();
    none.append('source_app', 'other');
    expect((await call(uploadRoute as Handler, { form: none })).json).toEqual({ error: 'Invalid request', code: 'BAD_REQUEST' });
    const text = new FormData();
    text.append('file', 'Name,City');
    expect((await call(uploadRoute as Handler, { form: text })).status).toBe(400);
    expect((await upload(['Name,City', 'x,y'], { source_app: 'excel' })).json).toEqual({ error: 'Invalid request', code: 'BAD_REQUEST' });
  });

  test('malformed preview bodies are 400 BAD_REQUEST', async () => {
    const up = await upload(['Name,City', 'Bad Body,Pune']);
    const bad = { error: 'Invalid request', code: 'BAD_REQUEST' };
    for (const matches of [{ 5: 'name' }, { x: 'name' }, { 0: 'not_a_field' }, { 0: 7 }, [], 'name']) {
      const res = await preview(up.json.runId, matches);
      expect({ matches, status: res.status, json: res.json }).toEqual({ matches, status: 400, json: bad });
    }
    expect((await preview(up.json.runId, up.json.guesses, { date_order: 'ymd' })).json).toEqual(bad);
    expect((await preview(up.json.runId, up.json.guesses, { value_matches: { state: 'x' } })).json).toEqual(bad);
    expect((await preview(up.json.runId, up.json.guesses, { value_matches: { state: { a: 1 } } })).json).toEqual(bad);
    expect((await call(previewRoute as Handler, { who: 'admin', json: [1] })).status).toBe(400);
  });

  test('a run id that is not a UUID, or belongs to another business or section, is 404 NOT_FOUND', async () => {
    const expected = { error: 'This import was not found.', code: 'NOT_FOUND' };
    const up = await upload(['Name,City', 'Other Biz,Pune']);
    const id = up.json.runId;
    expect((await commit('not-a-uuid')).json).toEqual(expected);
    expect((await undo('not-a-uuid')).json).toEqual(expected);
    expect((await preview('not-a-uuid', {})).status).toBe(404);
    // The other business's admin has full rights on its own customers but cannot see this run.
    expect((await preview(id, up.json.guesses, {}, 'other')).json).toEqual(expected);
    expect((await call(commitRoute as Handler, { who: 'other', json: { run_id: id } })).status).toBe(404);
    expect((await call(undoRoute as Handler, { who: 'other', json: { run_id: id } })).status).toBe(404);
    expect((await call(problemRowsRoute as Handler, { who: 'other', method: 'GET', query: `?run_id=${id}` })).status).toBe(404);
    // A customers run reached through the suppliers URL.
    expect((await call(previewRoute as Handler, { section: 'suppliers', json: { run_id: id, column_matches: up.json.guesses, value_matches: {}, date_order: 'dmy' } })).json).toEqual(expected);
    expect((await call(undoRoute as Handler, { section: 'suppliers', json: { run_id: id } })).json).toEqual(expected);
    expect((await commit(id, {}, 'suppliers')).json).toEqual(expected);
    expect((await call(problemRowsRoute as Handler, { section: 'suppliers', method: 'GET', query: `?run_id=${id}` })).status).toBe(404);
    expect((await call(problemRowsRoute as Handler, { method: 'GET' })).status).toBe(404);
  });

  test('preview refuses a required field with no column: commit then answers 400 MISSING_REQUIRED', async () => {
    const up = await upload(['Name,City', 'No Name,Pune']);
    const pv = await preview(up.json.runId, { 0: null, 1: 'city' });
    expect(pv.json.missingRequired).toEqual(['Customer name']);
    const res = await commit(up.json.runId);
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: 'Match a column to every required field first.', code: 'MISSING_REQUIRED' });
  });

  test('committing a run that was never previewed is 409 NOT_COMMITTABLE; a finished one the same', async () => {
    const up = await upload(['Name,City', 'Never Previewed,Pune']);
    const res = await commit(up.json.runId);
    expect(res.status).toBe(409);
    expect(res.json).toEqual({ error: 'This import cannot be continued. Start a new import.', code: 'NOT_COMMITTABLE' });
    const doneId = await importAll(['Name,City', 'Finished One,Pune']);
    expect((await commit(doneId)).status).toBe(409);
    expect((await undo(doneId)).status).toBe(200);
    const again = await undo(doneId);
    expect(again.status).toBe(409);
    expect(again.json).toEqual({ error: 'This import cannot be undone.', code: 'NOT_UNDOABLE' });
  });

  test('a commit while another import of the list holds the lock is 409 IMPORT_BUSY', async () => {
    const up = await upload(['Name,City', 'Busy One,Pune']);
    await preview(up.json.runId, up.json.guesses);
    const holder = await pool.connect();
    try {
      await holder.query(`SELECT pg_advisory_lock(hashtext('import:' || $1::text || ':' || 'customers'))`, [A.id]);
      const res = await commit(up.json.runId);
      expect(res.status).toBe(409);
      expect(res.json).toEqual({
        error: 'Another import for this list is running. Wait for it to finish.',
        code: 'IMPORT_BUSY',
      });
    } finally {
      await holder.query(`SELECT pg_advisory_unlock(hashtext('import:' || $1::text || ':' || 'customers'))`, [A.id]);
      holder.release();
    }
    expect((await commit(up.json.runId)).status).toBe(200);
    await undo(up.json.runId);
  });

  test('an unexpected error is a plain 500 and the real message is not sent', async () => {
    const up = await upload(['Name,City', 'Boom,Pune']);
    await preview(up.json.runId, up.json.guesses);
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const run = await import('@/lib/import/run');
    const commitSpy = jest.spyOn(run, 'commitNextBatch').mockRejectedValue(new Error('secret db detail'));
    try {
      const res = await commit(up.json.runId);
      expect(res.status).toBe(500);
      expect(res.json).toEqual({ error: 'Import failed' });
      expect(res.text).not.toMatch(/secret/);
      expect(spy).toHaveBeenCalled();
    } finally {
      commitSpy.mockRestore();
      spy.mockRestore();
    }
    await pool.query(`DELETE FROM import_runs WHERE id = $1`, [up.json.runId]);
  });

  test('problem rows come back as a UTF-8 csv attachment with a BOM', async () => {
    const id = await importAll(['Name,GSTIN', 'राम स्टोर्स,27BAD', 'Fine Row,']);
    const res = await call(problemRowsRoute as Handler, { method: 'GET', query: `?run_id=${id}` });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="import-problems.csv"');
    // Response.text() drops a leading BOM, so check the bytes.
    expect([...res.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = res.text.trim().split(/\r?\n/);
    expect(lines[0]).toBe('Name,GSTIN,Row,Reason');
    expect(lines[1]).toMatch(/^राम स्टोर्स,27BAD,2,/);
    // Reading needs only `read`: the viewer can download it, an unauthenticated caller cannot.
    expect((await call(problemRowsRoute as Handler, { who: 'reader', method: 'GET', query: `?run_id=${id}` })).status).toBe(200);
    expect((await call(problemRowsRoute as Handler, { who: 'nobody', method: 'GET', query: `?run_id=${id}` })).status).toBe(401);
  });

  test('history without a section lists only modules the user can read', async () => {
    const suppliersRun = await importAll(['Name,City', 'History Supplier,Pune'], 'suppliers');
    const adminAll = await history();
    expect(adminAll.status).toBe(200);
    const sections = new Set(adminAll.json.runs.map((r: any) => r.section));
    expect(sections).toEqual(new Set(['customers', 'suppliers']));
    expect(adminAll.json.runs.some((r: any) => r.id === suppliersRun)).toBe(true);

    const viewerAll = await history('', 'reader');
    expect(viewerAll.status).toBe(200);
    expect(viewerAll.json.runs.length).toBeGreaterThan(0);
    expect(viewerAll.json.runs.every((r: any) => r.section === 'customers')).toBe(true);
    expect(viewerAll.json.runs.some((r: any) => r.id === suppliersRun)).toBe(false);

    // Asking for a module the viewer cannot read is a refusal, and customers is allowed.
    expect((await history('?section=suppliers', 'reader')).status).toBe(403);
    expect((await history('?section=customers', 'reader')).status).toBe(200);
    // The other business sees none of it.
    expect((await history('', 'other')).json).toEqual({ runs: [] });
  });
});
