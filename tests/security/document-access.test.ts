jest.mock('@/lib/db', () => ({ queryOne: jest.fn() }));
jest.mock('@/lib/authorization', () => ({
  authorize: jest.fn().mockResolvedValue(undefined),
  AuthorizationError: class AuthorizationError extends Error {
    toNextResponse() {
      const { NextResponse } = require('next/server');
      return NextResponse.json({ error: this.message }, { status: 403 });
    }
  },
}));

import { NextRequest } from 'next/server';
import { queryOne } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireDocumentReadAccess } from '@/lib/document-access';

const BUSINESS_A = '11111111-1111-4111-8111-111111111111';
const USER_A = '22222222-2222-4222-8222-222222222222';
const DOC_ID = '33333333-3333-4333-8333-333333333333';

function request(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/documents/x/y/preview', { headers });
}

const authed = () =>
  request({ 'x-authenticated-business-id': BUSINESS_A, 'x-authenticated-user-id': USER_A });

describe('requireDocumentReadAccess', () => {
  beforeEach(() => {
    (queryOne as jest.Mock).mockReset();
    (authorize as jest.Mock).mockReset().mockResolvedValue(undefined);
  });

  it('rejects unknown tables without touching the database', async () => {
    const res = await requireDocumentReadAccess(authed(), 'users', DOC_ID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(400);
    expect(queryOne).not.toHaveBeenCalled();
  });

  it('rejects requests without a session', async () => {
    const res = await requireDocumentReadAccess(request(), 'invoices', DOC_ID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(401);
  });

  it('scopes the lookup to the session business and 404s other tenants', async () => {
    (queryOne as jest.Mock).mockResolvedValue(null);
    const res = await requireDocumentReadAccess(authed(), 'credit_notes', DOC_ID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(404);
    expect((queryOne as jest.Mock).mock.calls[0][1]).toEqual([DOC_ID, BUSINESS_A]);
    expect((queryOne as jest.Mock).mock.calls[0][0]).toContain('business_id = $2');
  });

  it('runs RBAC for tables with a module and returns 403 when denied', async () => {
    (queryOne as jest.Mock).mockResolvedValue({ id: DOC_ID, branch_id: null });
    (authorize as jest.Mock).mockRejectedValue(new (AuthorizationError as any)('nope'));
    const res = await requireDocumentReadAccess(authed(), 'invoices', DOC_ID);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(403);
  });

  it('allows tenant-owned documents; challans rely on tenant scoping only', async () => {
    (queryOne as jest.Mock).mockResolvedValue({ id: DOC_ID });
    const res = await requireDocumentReadAccess(authed(), 'delivery_challans', DOC_ID);
    expect(res).toEqual({ ok: true, table: 'delivery_challans', businessId: BUSINESS_A, userId: USER_A });
    expect(authorize).not.toHaveBeenCalled();
  });
});
