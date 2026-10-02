/**
 * User management routes take actor and business only from the verified session, scope every
 * read and write to that business, and refuse privilege escalation to Primary Admin.
 * Runs only when PHASE2_TEST_DATABASE_URL points at a disposable database. Uses the real
 * `authorize` (RBAC + PBAC) against seeded roles.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import { NextRequest } from 'next/server';

const url = process.env.PHASE2_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const d = url ? describe : describe.skip;

jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: () => null })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));
jest.mock('@/lib/jwt', () => ({
  clearSessionCookie: jest.fn(),
  shouldRotateTokens: jest.fn(async () => ({ rotate: false, payload: null })),
}));
jest.mock('@/lib/platform-jwt', () => ({ getPlatformSessionFromRequest: jest.fn(async () => null) }));

import { getPool, closePool } from '@/lib/db';
import { GET as listUsers, POST as createUser } from '@/app/api/settings/users/route';
import {
  GET as getUser,
  PATCH as patchUser,
  DELETE as deleteUser,
} from '@/app/api/settings/users/[id]/route';
import { DELETE as deactivateRoleRoute } from '@/app/api/settings/roles/[id]/route';

d('Settings users route hardening (real DB)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const B = randomUUID();
  const B2 = randomUUID();
  const O = randomUUID(); // primary admin of B
  const M = randomUUID(); // user manager of B (settings view/add/modify/delete)
  const U = randomUUID(); // clerk of B (invoices view only)
  const V = randomUUID(); // victim clerk of B
  const O2 = randomUUID(); // primary admin of B2
  const PA = randomUUID();
  const MGR = randomUUID();
  const CLERK = randomUUID();
  const R2 = randomUUID();
  const UNUSED = randomUUID(); // custom role with no users
  const tag = B.slice(0, 8);

  type Session = { user: string; business: string } | null;
  const as = (user: string, business = B): Session => ({ user, business });

  const req = (path: string, method: string, body: unknown, session: Session) => {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-user-id': O };
    if (session) {
      headers['x-authenticated-user-id'] = session.user;
      headers['x-authenticated-business-id'] = session.business;
      headers['x-authenticated-session-version'] = '1';
    }
    const sep = path.includes('?') ? '&' : '?';
    return new NextRequest(`http://localhost${path}${sep}user_id=${O}&business_id=${B2}&deleted_by_user_id=${O}`, {
      method,
      headers,
      body: method === 'GET' || method === 'DELETE' ? undefined : JSON.stringify(body),
    });
  };
  const call = async (res: Response | Promise<Response>) => {
    const r = await res;
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  const spoof = { created_by_user_id: O, created_by: O, updated_by_user_id: O, business_id: B2 };

  const post = (body: Record<string, unknown>, s: Session) => call(createUser(req('/api/settings/users', 'POST', body, s)));
  const list = (s: Session) => call(listUsers(req('/api/settings/users', 'GET', null, s)));
  const get = (id: string, s: Session) => call(getUser(req(`/api/settings/users/${id}`, 'GET', null, s), { params: { id } }));
  const patch = (id: string, body: Record<string, unknown>, s: Session) =>
    call(patchUser(req(`/api/settings/users/${id}`, 'PATCH', body, s), { params: { id } }));
  const del = (id: string, s: Session) => call(deleteUser(req(`/api/settings/users/${id}`, 'DELETE', null, s), { params: { id } }));
  const deactivate = (id: string, s: Session) =>
    call(deactivateRoleRoute(req(`/api/settings/roles/${id}`, 'DELETE', null, s), { params: { id } }));
  const roleActive = async (id: string) =>
    (await pool.query<{ is_active: boolean }>(`SELECT is_active FROM user_roles WHERE id = $1`, [id])).rows[0]?.is_active;

  async function setPerms(roleId: string, rows: Array<[string, boolean, boolean, boolean, boolean, boolean]>) {
    await pool.query(`DELETE FROM role_permissions WHERE role_id = $1`, [roleId]);
    for (const [m, v, a, u, dl, e] of rows) {
      await pool.query(
        `INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [roleId, m, v, a, u, dl, e]
      );
    }
  }
  const roleOf = async (id: string) =>
    (await pool.query<{ role_id: string | null }>(`SELECT role_id FROM users WHERE id = $1`, [id])).rows[0]?.role_id;
  const exists = async (id: string) => ((await pool.query(`SELECT 1 FROM users WHERE id = $1`, [id])).rowCount ?? 0) > 0;

  beforeAll(async () => {
    pool = getPool();
    for (const [key, name] of [
      ['settings', 'Settings'],
      ['invoices', 'Sales / Invoices'],
    ]) {
      await pool.query(
        `INSERT INTO permission_modules (module_key, module_name, is_active) VALUES ($1, $2, true) ON CONFLICT (module_key) DO NOTHING`,
        [key, name]
      );
    }
    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular'), ($3, $4, '27AAAPA1234A1Z5', '27', 'regular')`,
      [B, `SUH ${tag}`, B2, `SUH-2 ${tag}`]
    );
    await pool.query(
      `INSERT INTO user_roles (id, business_id, role_name, role_key, is_system_role) VALUES
         ($1, $5, 'Primary Admin', 'primary_admin', true),
         ($2, $5, 'User Manager', 'user_manager_custom', false),
         ($3, $5, 'Clerk', 'clerk_custom', false),
         ($4, $6, 'Other Biz Role', 'other_custom', false),
         ($7, $5, 'Unused', 'unused_custom', false)`,
      [PA, MGR, CLERK, R2, B, B2, UNUSED]
    );
    await setPerms(PA, [
      ['settings', true, true, true, true, true],
      ['invoices', true, true, true, true, true],
    ]);
    await setPerms(MGR, [
      ['settings', true, true, true, true, false],
      ['invoices', true, false, false, false, false],
    ]);
    await setPerms(CLERK, [['invoices', true, false, false, false, false]]);
    await setPerms(R2, [['invoices', true, false, false, false, false]]);

    const phone = Date.now().toString().slice(-7);
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, role_id) VALUES
         ($1, $6, 'Owner', $8, true, $13),
         ($2, $6, 'Manager', $9, false, $14),
         ($3, $6, 'Clerk', $10, false, $15),
         ($4, $6, 'Victim', $11, false, $15),
         ($5, $7, 'Other Owner', $12, true, NULL)`,
      [O, M, U, V, O2, B, B2, `82${phone}1`, `82${phone}2`, `82${phone}3`, `82${phone}4`, `82${phone}5`, PA, MGR, CLERK]
    );
    await pool.query(
      `INSERT INTO business_settings (business_id, user_management_enabled) VALUES ($1, true)
       ON CONFLICT (business_id) DO UPDATE SET user_management_enabled = true`,
      [B]
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DELETE FROM user_activity_logs WHERE business_id IN ($1, $2)`, [B, B2]).catch(() => {});
      await pool.query(`DELETE FROM users WHERE business_id IN ($1, $2)`, [B, B2]);
      await pool.query(`DELETE FROM businesses WHERE id IN ($1, $2)`, [B, B2]);
    } finally {
      await closePool();
    }
  });

  test('no session identity: every route returns 401', async () => {
    const results = await Promise.all([
      list(null),
      post({ ...spoof, name: 'X', phone: '9000000001', password: 'x', role_id: CLERK }, null),
      get(V, null),
      patch(V, { ...spoof, role_id: MGR }, null),
      del(V, null),
    ]);
    for (const r of results) expect(r.status).toBe(401);
    expect(await roleOf(V)).toBe(CLERK);
    expect(await exists(V)).toBe(true);
  });

  test('a clerk cannot create users even when the body names the owner as creator', async () => {
    const r = await post({ ...spoof, name: `Spoof ${tag}`, phone: '9000000002', password: 'x', role_id: CLERK }, as(U));
    expect(r.status).toBe(403);
    expect((await pool.query(`SELECT 1 FROM users WHERE name = $1`, [`Spoof ${tag}`])).rowCount).toBe(0);
  });

  test('create uses the session business, so another business role is rejected', async () => {
    const r = await post({ ...spoof, name: `Cross ${tag}`, phone: '9000000003', password: 'x', role_id: R2 }, as(M));
    expect(r.status).toBe(400);
  });

  test('a non-primary admin cannot create a Primary Admin', async () => {
    const r = await post({ name: `Escalate ${tag}`, phone: '9000000004', password: 'x', role_id: PA }, as(M));
    expect(r.status).toBe(403);
    expect(r.json.code).toBe('PRIMARY_ADMIN_ROLE_PROTECTED');
  });

  test('GET by id: self allowed, others need settings:read, other business is not found', async () => {
    expect((await get(U, as(U))).status).toBe(200);
    expect((await get(V, as(U))).status).toBe(403);
    expect((await get(V, as(M))).status).toBe(200);
    expect((await get(O2, as(M))).status).toBe(404);
  });

  test('list is scoped to the session business, not the query business_id', async () => {
    const r = await list(as(M));
    expect(r.status).toBe(200);
    const ids = (r.json.users as Array<{ id: string }>).map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining([O, M, U, V]));
    expect(ids).not.toContain(O2);
  });

  test('PATCH refuses spoofed actor, foreign roles, Primary Admin escalation and owner edits', async () => {
    expect((await patch(V, { ...spoof, role_id: MGR }, as(U))).status).toBe(403);
    expect((await patch(V, { role_id: R2 }, as(M))).status).toBe(400);
    const esc = await patch(V, { role_id: PA }, as(M));
    expect(esc.status).toBe(403);
    expect(esc.json.code).toBe('PRIMARY_ADMIN_ROLE_PROTECTED');
    const owner = await patch(O, { password: 'takeover' }, as(M));
    expect(owner.status).toBe(403);
    expect(owner.json.code).toBe('PRIMARY_ADMIN_PROTECTED');
    expect((await patch(O2, { name: 'x' }, as(M))).status).toBe(404);
    expect(await roleOf(V)).toBe(CLERK);

    const ok = await patch(V, { role_id: MGR }, as(M));
    expect(ok.status).toBe(200);
    expect(await roleOf(V)).toBe(MGR);
    await pool.query(`UPDATE users SET role_id = $1 WHERE id = $2`, [CLERK, V]);
  });

  test('DELETE needs settings:delete, blocks self and primary admin, and is business-scoped', async () => {
    expect((await del(V, as(U))).status).toBe(403);
    expect(await exists(V)).toBe(true);
    const self = await del(M, as(M));
    expect(self.status).toBe(403);
    expect(self.json.code).toBe('SELF_DELETE_FORBIDDEN');
    expect((await del(O, as(M))).status).toBe(403);
    expect((await del(O2, as(M))).status).toBe(404);
    expect(await exists(O2)).toBe(true);

    expect((await del(V, as(M))).status).toBe(200);
    expect(await exists(V)).toBe(false);
  });

  test('deactivating a role: custom and unused only, needs settings:delete, business-scoped', async () => {
    expect((await deactivate(UNUSED, null)).status).toBe(401);
    expect((await deactivate(UNUSED, as(U))).status).toBe(403);
    expect((await deactivate(PA, as(M))).status).toBe(403);
    const inUse = await deactivate(CLERK, as(M));
    expect(inUse.status).toBe(409);
    expect(inUse.json.code).toBe('ROLE_IN_USE');
    expect((await deactivate(R2, as(M))).status).toBe(404);
    expect(await roleActive(R2)).toBe(true);

    expect((await deactivate(UNUSED, as(M))).status).toBe(200);
    expect(await roleActive(UNUSED)).toBe(false);
    expect((await deactivate(UNUSED, as(M))).status).toBe(404);
  });
});
