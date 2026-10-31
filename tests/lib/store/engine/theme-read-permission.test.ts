/**
 * Final review M2: theme and version GETs accept settings read OR update, because the role API can store
 * update without view. The helper tries each listed action; the refusal is the first one's.
 */
import { NextRequest } from 'next/server';

const allowed = new Set<string>();

jest.mock('@/lib/auth-helpers', () => ({
  requireTenantBusinessId: () => ({ ok: true, businessId: 'biz-1' }),
  getAuthenticatedUserId: () => 'user-1',
}));
jest.mock('@/lib/authorization', () => {
  class AuthorizationError extends Error {
    toNextResponse() {
      const { NextResponse } = jest.requireActual('next/server');
      return NextResponse.json({ error: this.message }, { status: 403 });
    }
  }
  return {
    AuthorizationError,
    authorize: jest.fn(async (_u: string, mod: string, action: string) => {
      if (!allowed.has(`${mod}:${action}`)) throw new AuthorizationError(`User does not have ${action} permission for ${mod}`);
    }),
  };
});

import { requireTenantPermission } from '@/lib/security/require-tenant-permission';
import { THEME_READ } from '@/lib/store/engine/route-utils';

const req = () => new NextRequest('http://localhost:3000/api/settings/online-store/themes');

describe('requireTenantPermission with several actions (theme GETs)', () => {
  beforeEach(() => allowed.clear());

  it('THEME_READ is settings read or update', () => {
    expect([...THEME_READ]).toEqual(['read', 'update']);
  });

  it('a role with update but not view may read themes', async () => {
    allowed.add('settings:update');
    expect(await requireTenantPermission(req(), null, 'settings', THEME_READ)).toEqual({
      ok: true,
      businessId: 'biz-1',
      userId: 'user-1',
    });
  });

  it('a role with view only may read themes', async () => {
    allowed.add('settings:read');
    expect((await requireTenantPermission(req(), null, 'settings', THEME_READ)).ok).toBe(true);
  });

  it('a role with neither is refused with the read message', async () => {
    const r = await requireTenantPermission(req(), null, 'settings', THEME_READ);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.response.status).toBe(403);
    expect((await r.response.json()).error).toBe('User does not have read permission for settings');
  });

  it('a single action still means exactly that action', async () => {
    allowed.add('settings:read');
    expect((await requireTenantPermission(req(), null, 'settings', 'update')).ok).toBe(false);
  });
});

describe('theme GET routes use THEME_READ', () => {
  const { readFileSync } = require('fs') as typeof import('fs');
  const { join } = require('path') as typeof import('path');
  it.each([
    'app/api/settings/online-store/themes/route.ts',
    'app/api/settings/online-store/themes/[id]/route.ts',
    'app/api/settings/online-store/themes/versions/route.ts',
  ])('%s', (file) => {
    const src = readFileSync(join(process.cwd(), file), 'utf8');
    expect(src).toContain("'settings', THEME_READ)");
    expect(src).not.toContain("'settings', 'read')");
  });
});
