/**
 * Credit approve / reject take the business from the session. A business_id in the body is optional and,
 * when present, must match the session; the SQL always uses the session business.
 */
import { NextRequest } from 'next/server';

const clientQuery = jest.fn();
const release = jest.fn();
jest.mock('@/lib/db', () => ({
  getPool: () => ({ connect: async () => ({ query: (...a: unknown[]) => clientQuery(...a), release }) }),
  queryOne: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/subscription/feature-access', () => ({ denyIfFeatureMissing: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/permissions', () => ({ checkUserPermission: jest.fn().mockResolvedValue(true) }));
jest.mock('@/lib/authorization', () => ({ authorize: jest.fn(), AuthorizationError: class extends Error {} }));
jest.mock('@/lib/credit-alerts', () => ({ checkAndSendCreditAlerts: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/credit-utils', () => ({ calculateCreditMetrics: jest.fn() }));

import { POST as approve } from '@/app/api/credit-approvals/approve/route';
import { POST as reject } from '@/app/api/credit-approvals/reject/route';

function req(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/credit-approvals/x', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-authenticated-user-id': 'user-1',
      'x-authenticated-business-id': 'biz-session',
    },
    body: JSON.stringify(body),
  });
}

const approval = { id: 'a1', status: 'pending', reference_type: 'invoice', reference_id: 'i1', entity_type: 'customer', entity_id: 'c1' };

beforeEach(() => {
  jest.clearAllMocks();
  clientQuery.mockImplementation(async (sql: string) => {
    if (sql.startsWith('SELECT * FROM credit_approvals')) return { rows: [approval] };
    if (sql.includes('UPDATE credit_approvals')) return { rows: [{ ...approval, status: 'done' }] };
    return { rows: [] };
  });
});

describe.each([
  ['approve', approve, {}],
  ['reject', reject, { rejection_reason: 'Over the limit' }],
] as const)('credit-approvals/%s', (_name, handler, extra) => {
  test('no business_id in the body: uses the session business and succeeds', async () => {
    const res = await handler(req({ approval_id: 'a1', ...extra }));
    expect(res.status).toBe(200);
    const select = clientQuery.mock.calls.find((c) => String(c[0]).startsWith('SELECT * FROM credit_approvals'))!;
    expect(select[1]).toEqual(['a1', 'biz-session']);
    const note = clientQuery.mock.calls.find((c) => String(c[0]).includes('INSERT INTO notifications'))!;
    expect(note[1][0]).toBe('biz-session');
  });

  test('a business_id that matches the session still works', async () => {
    const res = await handler(req({ approval_id: 'a1', business_id: 'biz-session', ...extra }));
    expect(res.status).toBe(200);
  });

  test('a business_id that does not match the session is refused with 403 and touches nothing', async () => {
    const res = await handler(req({ approval_id: 'a1', business_id: 'biz-other', ...extra }));
    expect(res.status).toBe(403);
    expect(clientQuery).not.toHaveBeenCalled();
  });

  test('missing approval_id is 400', async () => {
    const res = await handler(req({ ...extra }));
    expect(res.status).toBe(400);
    expect(clientQuery).not.toHaveBeenCalled();
  });
});
