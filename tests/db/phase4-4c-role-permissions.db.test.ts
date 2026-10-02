/**
 * Phase 4.4C: role permission management takes actor and business only from the verified session,
 * scopes roles to that business, validates against the active permission catalog, refuses grants
 * beyond the actor's own authority, and writes permissions + audit atomically.
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
import { middleware } from '../../middleware';
import { GET as getRolePerms, POST as postRolePerms } from '@/app/api/roles/[id]/permissions/route';
import {
  GET as getSettingsRolePerms,
  PATCH as patchSettingsRolePerms,
} from '@/app/api/settings/roles/[id]/permissions/route';
import { POST as createRoleRoute } from '@/app/api/settings/roles/route';
import { POST as debugFixUser } from '@/app/api/debug/fix-user/route';

type Flags = { module_key: string; can_view: boolean; can_add: boolean; can_modify: boolean; can_delete: boolean; can_share: boolean };

d('Phase 4.4C role permission management (real DB)', () => {
  jest.setTimeout(120000);

  let pool: Pool;
  const B = randomUUID();
  const B2 = randomUUID();
  const O = randomUUID(); // primary admin of B
  const S = randomUUID(); // settings administrator of B (no payments create)
  const U = randomUUID(); // ordinary user of B
  const O2 = randomUUID(); // primary admin of B2
  const P = randomUUID(); // B primary_admin role
  const ADMIN = randomUUID();
  const CLERK = randomUUID();
  const TARGET = randomUUID();
  const R2 = randomUUID(); // B2 custom role
  const tag = B.slice(0, 8);
  const INACTIVE = `zz_inactive_${tag}`;
  const FAIL_FN = `zz_fail_audit_${tag}`;

  type Session = { user: string; business: string } | null;

  const req = (path: string, method: string, body: unknown, session: Session, host = 'localhost') => {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'x-user-id': O };
    if (session) {
      headers['x-authenticated-user-id'] = session.user;
      headers['x-authenticated-business-id'] = session.business;
      headers['x-authenticated-session-version'] = '1';
    }
    const sep = path.includes('?') ? '&' : '?';
    return new NextRequest(`http://${host}${path}${sep}user_id=${O}&business_id=${B2}`, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(body),
    });
  };
  const call = async (res: Response | Promise<Response>) => {
    const r = await res;
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  const as = (user: string, business = B): Session => ({ user, business });
  const spoof = { user_id: O, created_by: O, created_by_user_id: O, updated_by_user_id: O, business_id: B2 };

  const getRoles = (id: string, s: Session) => call(getRolePerms(req(`/api/roles/${id}/permissions`, 'GET', null, s), { params: { id } }));
  const postRoles = (id: string, permissions: unknown, s: Session, extra: Record<string, unknown> = {}) =>
    call(postRolePerms(req(`/api/roles/${id}/permissions`, 'POST', { ...extra, permissions }, s), { params: { id } }));
  const getSettings = (id: string, s: Session) =>
    call(getSettingsRolePerms(req(`/api/settings/roles/${id}/permissions`, 'GET', null, s), { params: { id } }));
  const patchSettings = (id: string, permissions: unknown, s: Session, extra: Record<string, unknown> = {}) =>
    call(patchSettingsRolePerms(req(`/api/settings/roles/${id}/permissions`, 'PATCH', { ...extra, permissions }, s), { params: { id } }));
  const createRole = (body: Record<string, unknown>, s: Session) => call(createRoleRoute(req('/api/settings/roles', 'POST', body, s)));

  const grants = (...ids: string[]) => ids.map((permission_id) => ({ permission_id, granted: true }));

  async function permsOf(roleId: string): Promise<Flags[]> {
    return (
      await pool.query<Flags>(
        `SELECT module_key, can_view, can_add, can_modify, can_delete, can_share
           FROM role_permissions WHERE role_id = $1 ORDER BY module_key`,
        [roleId]
      )
    ).rows;
  }
  async function auditsOf(roleId: string) {
    return (
      await pool.query(
        `SELECT user_id, action, details FROM user_activity_logs WHERE entity_id = $1 ORDER BY created_at, id`,
        [roleId]
      )
    ).rows;
  }
  async function setPerms(roleId: string, rows: Array<[string, boolean, boolean, boolean, boolean, boolean]>) {
    await pool.query(`DELETE FROM role_permissions WHERE role_id = $1`, [roleId]);
    for (const [m, v, a, u, del, e] of rows) {
      await pool.query(
        `INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [roleId, m, v, a, u, del, e]
      );
    }
  }
  const resetTarget = async () => {
    await setPerms(TARGET, [['invoices', true, false, false, false, false]]);
    await pool.query(`DELETE FROM user_activity_logs WHERE entity_id = $1`, [TARGET]);
  };

  beforeAll(async () => {
    pool = getPool();
    for (const [key, name] of [
      ['settings', 'Settings'],
      ['invoices', 'Sales / Invoices'],
      ['customers', 'Customers'],
      ['payments', 'Payments'],
    ]) {
      await pool.query(
        `INSERT INTO permission_modules (module_key, module_name, is_active) VALUES ($1, $2, true) ON CONFLICT (module_key) DO NOTHING`,
        [key, name]
      );
    }
    await pool.query(`INSERT INTO permission_modules (module_key, module_name, is_active) VALUES ($1, 'Inactive test', false)`, [INACTIVE]);

    await pool.query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular'), ($3, $4, '27AAAPA1234A1Z5', '27', 'regular')`,
      [B, `P44C ${tag}`, B2, `P44C-2 ${tag}`]
    );
    await pool.query(
      `INSERT INTO user_roles (id, business_id, role_name, role_key, is_system_role) VALUES
         ($1, $6, 'Primary Admin', 'primary_admin', true),
         ($2, $6, 'Settings Admin', 'settings_admin_custom', false),
         ($3, $6, 'Clerk', 'clerk_custom', false),
         ($4, $6, 'Target', 'target_custom', false),
         ($5, $7, 'Other Biz Role', 'other_custom', false)`,
      [P, ADMIN, CLERK, TARGET, R2, B, B2]
    );
    await setPerms(P, [
      ['settings', true, true, true, true, true],
      ['invoices', true, true, true, true, true],
      ['customers', true, true, true, true, true],
      ['payments', true, true, true, true, true],
    ]);
    await setPerms(ADMIN, [
      ['settings', true, true, true, false, false],
      ['invoices', true, true, true, false, false],
      ['customers', true, false, false, false, false],
      ['payments', true, false, false, false, false],
    ]);
    await setPerms(CLERK, [['invoices', true, false, false, false, false]]);
    await setPerms(R2, [['invoices', true, false, false, false, false]]);

    const phone = Date.now().toString().slice(-7);
    await pool.query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, role_id) VALUES
         ($1, $5, 'Owner', $6, true, $9),
         ($2, $5, 'Settings Admin', $7, false, $10),
         ($3, $5, 'Clerk', $8, false, $11),
         ($4, $12, 'Other Owner', $13, true, NULL)`,
      [O, S, U, O2, B, `81${phone}1`, `81${phone}2`, `81${phone}3`, P, ADMIN, CLERK, B2, `81${phone}4`]
    );
  });

  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(`DROP TRIGGER IF EXISTS ${FAIL_FN} ON user_activity_logs`).catch(() => {});
      await pool.query(`DROP FUNCTION IF EXISTS ${FAIL_FN}()`).catch(() => {});
      await pool.query(`DELETE FROM users WHERE business_id IN ($1, $2)`, [B, B2]);
      await pool.query(`DELETE FROM businesses WHERE id IN ($1, $2)`, [B, B2]);
      await pool.query(`DELETE FROM permission_modules WHERE module_key = $1`, [INACTIVE]);
    } finally {
      await closePool();
    }
  });

  beforeEach(resetTarget);

  test('1 no session identity: every GET and mutation route returns 401 and nothing changes', async () => {
    const before = await permsOf(TARGET);
    const results = await Promise.all([
      getRoles(TARGET, null),
      postRoles(TARGET, grants('invoices_create'), null, spoof),
      getSettings(TARGET, null),
      patchSettings(TARGET, [{ module_key: 'invoices', can_add: true }], null, spoof),
      createRole({ ...spoof, role_name: `NoSession ${tag}` }, null),
    ]);
    for (const r of results) expect(r.status).toBe(401);
    expect(await permsOf(TARGET)).toEqual(before);
    expect((await pool.query(`SELECT 1 FROM user_roles WHERE role_name = $1`, [`NoSession ${tag}`])).rowCount).toBe(0);
  });

  test('1b a stale session version is refused', async () => {
    const r = await call(
      postRolePerms(
        new NextRequest(`http://localhost/api/roles/${TARGET}/permissions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-authenticated-user-id': O,
            'x-authenticated-business-id': B,
            'x-authenticated-session-version': '999',
          },
          body: JSON.stringify({ permissions: grants('invoices_create') }),
        }),
        { params: { id: TARGET } }
      )
    );
    expect(r.status).toBe(401);
    expect(r.json.code).toBe('SESSION_REVOKED');
  });

  test('2 store-host request without a verified session is denied even with spoofed identity headers', async () => {
    const before = await permsOf(TARGET);
    const raw = new NextRequest(`https://shop.khatario.com/api/roles/${TARGET}/permissions?user_id=${O}&business_id=${B}`, {
      method: 'POST',
      headers: {
        host: 'shop.khatario.com',
        'content-type': 'application/json',
        'x-user-id': O,
        'x-authenticated-user-id': O,
        'x-authenticated-business-id': B,
        'x-authenticated-session-version': '1',
      },
    });
    const mw = await middleware(raw);
    const overridden = (mw.headers.get('x-middleware-override-headers') ?? '').split(',').filter(Boolean);
    const forwarded: Record<string, string> = {};
    for (const [k, v] of raw.headers) forwarded[k] = v;
    if (overridden.length) {
      for (const k of Object.keys(forwarded)) if (!overridden.includes(k)) delete forwarded[k];
      for (const k of overridden) {
        const v = mw.headers.get(`x-middleware-request-${k}`);
        if (v != null) forwarded[k] = v;
      }
    }
    expect(forwarded['x-authenticated-user-id']).toBeUndefined();

    const body = JSON.stringify({ ...spoof, permissions: grants('invoices_create', 'payments_create', 'settings_update') });
    const routed = (p: string) =>
      new NextRequest(`https://shop.khatario.com${p}?user_id=${O}&business_id=${B}`, { method: 'POST', headers: forwarded, body });
    expect((await call(postRolePerms(routed(`/api/roles/${TARGET}/permissions`), { params: { id: TARGET } }))).status).toBe(401);
    expect((await call(createRoleRoute(routed('/api/settings/roles')))).status).toBe(401);
    expect(await permsOf(TARGET)).toEqual(before);
  });

  test('3 a user without settings permissions cannot read or modify a role, including their own', async () => {
    const before = await permsOf(TARGET);
    expect((await postRoles(TARGET, grants('invoices_read', 'invoices_create'), as(U))).status).toBe(403);
    expect((await patchSettings(TARGET, [{ module_key: 'invoices', can_add: true }], as(U))).status).toBe(403);
    expect((await postRoles(CLERK, grants('invoices_read', 'settings_update'), as(U))).status).toBe(403);
    expect((await getRoles(TARGET, as(U))).status).toBe(403);
    expect((await getSettings(TARGET, as(U))).status).toBe(403);
    expect(await permsOf(TARGET)).toEqual(before);
    expect(await permsOf(CLERK)).toEqual([
      { module_key: 'invoices', can_view: true, can_add: false, can_modify: false, can_delete: false, can_share: false },
    ]);
  });

  test('4 an authorized administrator can modify an eligible role in their business (POST replace, PATCH merge, GET)', async () => {
    const r = await postRoles(TARGET, grants('invoices_read', 'invoices_create', 'customers_read'), as(S));
    expect(r.status).toBe(200);
    expect(await permsOf(TARGET)).toEqual([
      { module_key: 'customers', can_view: true, can_add: false, can_modify: false, can_delete: false, can_share: false },
      { module_key: 'invoices', can_view: true, can_add: true, can_modify: false, can_delete: false, can_share: false },
    ]);

    const p = await patchSettings(TARGET, [{ module_key: 'customers', can_view: false }], as(S));
    expect(p.status).toBe(200);
    expect(await permsOf(TARGET)).toEqual([
      { module_key: 'invoices', can_view: true, can_add: true, can_modify: false, can_delete: false, can_share: false },
    ]);

    const g = await getRoles(TARGET, as(S));
    expect(g.status).toBe(200);
    expect(g.json.permissions.find((x: any) => x.permission_id === 'invoices_create').granted).toBe(true);
    expect(g.json.permissions.find((x: any) => x.permission_id === 'customers_read').granted).toBe(false);
    expect(g.json.permissions.some((x: any) => x.module_key === INACTIVE)).toBe(false);
    const gs = await getSettings(TARGET, as(S));
    expect(gs.status).toBe(200);
    expect(gs.json.permissions).toEqual(expect.arrayContaining([{ permission_id: 'invoices_create', granted: true }]));
  });

  test('5 a role from another business returns 404 on every route and is unchanged', async () => {
    const before = await permsOf(R2);
    for (const s of [as(S), as(O)]) {
      expect((await getRoles(R2, s)).status).toBe(404);
      expect((await getSettings(R2, s)).status).toBe(404);
      expect((await postRoles(R2, grants('invoices_read', 'invoices_create'), s)).status).toBe(404);
      expect((await patchSettings(R2, [{ module_key: 'invoices', can_add: true }], s)).status).toBe(404);
    }
    expect((await postRoles('not-a-uuid', grants('invoices_read'), as(O))).status).toBe(404);
    expect(await permsOf(R2)).toEqual(before);
    expect(await auditsOf(R2)).toHaveLength(0);
  });

  test('6 the primary_admin role cannot be modified, even by the primary admin', async () => {
    const before = await permsOf(P);
    const a = await postRoles(P, grants('invoices_read'), as(O));
    expect(a.status).toBe(403);
    expect(a.json.code).toBe('PRIMARY_ADMIN_ROLE_PROTECTED');
    const b = await patchSettings(P, [{ module_key: 'settings', can_view: false }], as(O));
    expect(b.status).toBe(403);
    expect(await permsOf(P)).toEqual(before);
  });

  test('7 unknown, inactive, malformed or unsupported permissions are rejected with 400 and nothing is written', async () => {
    const before = await permsOf(TARGET);
    const cases: unknown[] = [
      grants('nope_module_create'),
      grants('invoices_approve'),
      grants(`${INACTIVE}_read`),
      grants('invoices'),
      [{ permission_id: 'invoices_create', granted: 'yes' }],
      [{ permission_id: 'invoices_create', granted: true }, { permission_id: 'invoices_create', granted: false }],
      'invoices_create',
      [null],
    ];
    for (const c of cases) {
      const r = await postRoles(TARGET, c, as(O));
      expect(r.status).toBe(400);
      expect(r.json.code).toBe('INVALID_PERMISSIONS');
    }
    const mixed = await postRoles(TARGET, [...grants('invoices_create'), ...grants('nope_module_create')], as(O));
    expect(mixed.status).toBe(400);
    expect(mixed.json.details.errors.join(' ')).toMatch(/nope_module_create/);

    for (const c of [
      [{ module_key: 'nope_module', can_view: true }],
      [{ module_key: INACTIVE, can_view: true }],
      [{ module_key: 'invoices', can_approve: true }],
      [{ module_key: 'invoices', can_add: 'true' }],
      [{ module_key: 'invoices' }, { module_key: 'invoices' }],
    ]) {
      expect((await patchSettings(TARGET, c, as(O))).status).toBe(400);
    }
    expect(await permsOf(TARGET)).toEqual(before);
    expect(await auditsOf(TARGET)).toHaveLength(0);
  });

  test('8 spoofed body, query and x-user-id identity are ignored: the session actor and business are used', async () => {
    // Every request carries ?user_id=O&business_id=B2 and x-user-id: O; the body names O and B2 too.
    const denied = await postRoles(TARGET, grants('invoices_read', 'payments_create'), as(S), spoof);
    expect(denied.status).toBe(403);
    expect(denied.json.code).toBe('PERMISSION_GRANT_EXCEEDS_AUTHORITY');

    const ok = await patchSettings(TARGET, [{ module_key: 'invoices', can_view: true, can_add: true }], as(S), spoof);
    expect(ok.status).toBe(200);
    const audits = await auditsOf(TARGET);
    expect(audits).toHaveLength(1);
    expect(audits[0].user_id).toBe(S);
    expect((await pool.query(`SELECT business_id FROM user_activity_logs WHERE entity_id = $1`, [TARGET])).rows[0].business_id).toBe(B);
    expect(await permsOf(R2)).toEqual([
      { module_key: 'invoices', can_view: true, can_add: false, can_modify: false, can_delete: false, can_share: false },
    ]);
  });

  test('9 a non-primary admin cannot grant flags they do not hold; existing flags they lack may be kept; the primary admin can grant', async () => {
    const r = await postRoles(TARGET, grants('invoices_read', 'payments_create'), as(S));
    expect(r.status).toBe(403);
    expect(r.json.details.permissions).toEqual(['payments_create']);
    const p = await patchSettings(TARGET, [{ module_key: 'settings', can_view: true, can_delete: true }], as(S));
    expect(p.status).toBe(403);
    expect(p.json.details.permissions).toEqual(['settings_delete']);
    expect(await permsOf(TARGET)).toEqual([
      { module_key: 'invoices', can_view: true, can_add: false, can_modify: false, can_delete: false, can_share: false },
    ]);

    expect((await postRoles(TARGET, grants('invoices_read', 'payments_create'), as(O))).status).toBe(200);
    // S lacks payments_create but re-saving it unchanged is not a grant.
    expect((await postRoles(TARGET, grants('invoices_read', 'invoices_create', 'payments_create'), as(S))).status).toBe(200);
    expect(await permsOf(TARGET)).toEqual([
      { module_key: 'invoices', can_view: true, can_add: true, can_modify: false, can_delete: false, can_share: false },
      { module_key: 'payments', can_view: false, can_add: true, can_modify: false, can_delete: false, can_share: false },
    ]);
  });

  test('10 the audit row records the session actor and the before/after change list', async () => {
    const r = await postRoles(TARGET, grants('invoices_create', 'customers_read'), as(S), spoof);
    expect(r.status).toBe(200);
    const [audit] = await auditsOf(TARGET);
    expect(audit.user_id).toBe(S);
    expect(audit.action).toBe('update_role_permissions');
    expect(audit.details.role_name).toBe('Target');
    expect(audit.details.changes).toEqual([
      { module_key: 'customers', action: 'read', from: false, to: true },
      { module_key: 'invoices', action: 'read', from: true, to: false },
      { module_key: 'invoices', action: 'create', from: false, to: true },
    ]);
    expect(r.json.changes).toEqual(audit.details.changes);
  });

  test('11 a failure partway through the save leaves the original permissions unchanged', async () => {
    await pool.query(
      `CREATE OR REPLACE FUNCTION ${FAIL_FN}() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         IF NEW.entity_id = '${TARGET}'::uuid THEN RAISE EXCEPTION 'forced audit failure'; END IF;
         RETURN NEW;
       END $$`
    );
    await pool.query(`CREATE TRIGGER ${FAIL_FN} BEFORE INSERT ON user_activity_logs FOR EACH ROW EXECUTE FUNCTION ${FAIL_FN}()`);
    try {
      const before = await permsOf(TARGET);
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const r = await postRoles(TARGET, grants('invoices_create', 'customers_read', 'payments_read'), as(O));
      errSpy.mockRestore();
      expect(r.status).toBe(500);
      expect(JSON.stringify(r.json)).not.toMatch(/forced audit failure/);
      expect(await permsOf(TARGET)).toEqual(before);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS ${FAIL_FN} ON user_activity_logs`);
      await pool.query(`DROP FUNCTION IF EXISTS ${FAIL_FN}()`);
    }
  });

  test('12 concurrent saves end in one complete requested state, never a mixture', async () => {
    const X = grants('invoices_read', 'invoices_create', 'invoices_update', 'customers_read');
    const Y = grants('payments_read', 'payments_create', 'settings_read');
    const asState = (ids: string[]) => ids.slice().sort();
    const stateOf = (rows: Flags[]) => {
      const ids: string[] = [];
      const names: Array<[keyof Flags, string]> = [
        ['can_view', 'read'],
        ['can_add', 'create'],
        ['can_modify', 'update'],
        ['can_delete', 'delete'],
        ['can_share', 'export'],
      ];
      for (const r of rows) for (const [f, a] of names) if (r[f]) ids.push(`${r.module_key}_${a}`);
      return ids.sort();
    };
    for (let i = 0; i < 3; i++) {
      const [a, b] = await Promise.all([postRoles(TARGET, X, as(O)), postRoles(TARGET, Y, as(O))]);
      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      const final = stateOf(await permsOf(TARGET));
      expect([asState(X.map((x) => x.permission_id)), asState(Y.map((y) => y.permission_id))]).toContainEqual(final);
    }
  });

  test('13 role creation ignores body business and actor fields and creates only in the session business', async () => {
    const name = `Cashier ${tag}`;
    const r = await createRole({ ...spoof, created_by_user_id: O2, role_name: name, description: 'Front desk' }, as(S));
    expect(r.status).toBe(200);
    const rows = (await pool.query(`SELECT id, business_id FROM user_roles WHERE role_name = $1`, [name])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].business_id).toBe(B);
    const [audit] = await auditsOf(rows[0].id);
    expect(audit.user_id).toBe(S);
    expect(audit.action).toBe('create_role');
    // Default permissions: view only, limited to modules the creator can view.
    const perms = await permsOf(rows[0].id);
    expect(perms.every((p) => p.can_view && !p.can_add && !p.can_modify && !p.can_delete && !p.can_share)).toBe(true);
    expect(perms.map((p) => p.module_key)).toEqual(['customers', 'invoices', 'payments', 'settings']);

    expect((await createRole({ role_name: `Clerk made ${tag}` }, as(U))).status).toBe(403);
  });

  test('14 role creation with permissions beyond the creator authority, or invalid permissions, creates nothing', async () => {
    const name = `Escalate ${tag}`;
    const r = await createRole(
      { role_name: name, permissions: [{ module_key: 'payments', can_view: true, can_add: true }] },
      as(S)
    );
    expect(r.status).toBe(403);
    expect(r.json.details.permissions).toEqual(['payments_create']);
    const bad = await createRole({ role_name: name, permissions: [{ module_key: 'nope_module', can_view: true }] }, as(S));
    expect(bad.status).toBe(400);
    expect((await pool.query(`SELECT 1 FROM user_roles WHERE role_name = $1`, [name])).rowCount).toBe(0);

    const ok = await createRole(
      { role_name: name, permissions: [{ module_key: 'payments', can_view: true, can_add: true }] },
      as(O)
    );
    expect(ok.status).toBe(200);
    expect(await permsOf(ok.json.role.id)).toEqual([
      { module_key: 'payments', can_view: true, can_add: true, can_modify: false, can_delete: false, can_share: false },
    ]);
  });

  test('debug fix-user endpoint can no longer make a user primary admin or grant permissions', async () => {
    const before = await permsOf(P);
    const r = await call(debugFixUser());
    expect(r.status).toBe(404);
    expect((await pool.query(`SELECT is_primary_admin FROM users WHERE id = $1`, [U])).rows[0].is_primary_admin).toBe(false);
    expect(await permsOf(P)).toEqual(before);
  });
});
