/**
 * POST /api/employees takes the business from the session. A business_id in the body is optional and,
 * when present, must match the session; every check and write uses the session business.
 */
import { NextRequest } from 'next/server';

const mockQueryOne = jest.fn();
const mockQuery = jest.fn();
jest.mock('@/lib/db', () => ({
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
  queryRows: jest.fn().mockResolvedValue([]),
  query: (...a: unknown[]) => mockQuery(...a),
}));
const mockCheckLimit = jest.fn();
jest.mock('@/lib/subscription', () => ({ checkLimit: (...a: unknown[]) => mockCheckLimit(...a) }));
const mockAuthorize = jest.fn();
jest.mock('@/lib/authorization', () => ({
  authorize: (...a: unknown[]) => mockAuthorize(...a),
  AuthorizationError: class extends Error {},
}));
jest.mock('@/lib/field-permission-filter', () => ({
  filterFieldsByPermission: jest.fn(async (rows: unknown) => rows),
  rejectRestrictedFieldUpdates: jest.fn().mockResolvedValue({ rejected: [] }),
}));
jest.mock('@/lib/subscription/feature-access', () => ({ hasFeatureAccess: jest.fn().mockResolvedValue(false) }));
jest.mock('@/lib/hr/employee-settings', () => ({ generateNextEmployeeCode: jest.fn().mockResolvedValue('EMP001') }));
jest.mock('@/lib/hr/employee-login-options', () => ({
  resolveEmployeeLoginDecision: jest.fn().mockResolvedValue({ ok: true, mode: 'none' }),
}));
jest.mock('@/lib/hr/manager-scope', () => ({ wouldCreateReportingCycle: jest.fn().mockResolvedValue(false) }));
jest.mock('@/lib/hr/employee-access-scope', () => ({
  buildEmployeeScopeSql: jest.fn(),
  getActorEmployeeId: jest.fn(),
  resolveEmployeeListScope: jest.fn(),
}));
jest.mock('@/lib/employee-portal/invite', () => ({ sendEmployeePortalInvite: jest.fn() }));

import { POST } from '@/app/api/employees/route';

function req(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/employees', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-authenticated-user-id': 'user-1',
      'x-authenticated-business-id': 'biz-session',
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCheckLimit.mockResolvedValue({ allowed: true });
  mockQuery.mockResolvedValue({ rows: [] });
  mockQueryOne.mockImplementation(async (sql: string) => {
    if (sql.includes('INSERT INTO users')) return { id: 'emp-1' };
    if (sql.includes('INSERT INTO employees')) return { id: 'emp-1', employee_code: 'EMP001' };
    if (sql.includes('FROM employees e')) return { id: 'emp-1', employee_code: 'EMP001', user_name: 'Asha' };
    return null;
  });
});

describe('POST /api/employees', () => {
  test('no business_id in the body: creates under the session business', async () => {
    const res = await POST(req({ name: 'Asha', phone: '9876543210' }));
    expect(res.status).toBe(201);
    expect(mockAuthorize).toHaveBeenCalledWith('user-1', 'employees', 'create', { businessId: 'biz-session' });
    expect(mockCheckLimit).toHaveBeenCalledWith('biz-session', 'employees');
    const userInsert = mockQueryOne.mock.calls.find((c) => String(c[0]).includes('INSERT INTO users'))!;
    expect(userInsert[1][0]).toBe('biz-session');
    const empInsert = mockQueryOne.mock.calls.find((c) => String(c[0]).includes('INSERT INTO employees'))!;
    expect(empInsert[1][1]).toBe('biz-session');
  });

  test('a business_id that matches the session still works', async () => {
    const res = await POST(req({ business_id: 'biz-session', name: 'Asha', phone: '9876543210' }));
    expect(res.status).toBe(201);
  });

  test('a business_id that does not match the session is 403 and nothing is written', async () => {
    const res = await POST(req({ business_id: 'biz-other', name: 'Asha', phone: '9876543210' }));
    expect(res.status).toBe(403);
    expect(mockAuthorize).not.toHaveBeenCalled();
    expect(mockQueryOne).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('missing name or phone is 400', async () => {
    const a = await POST(req({ phone: '9876543210' }));
    expect(a.status).toBe(400);
    expect((await a.json()).error).toBe('name and phone are required');
    const b = await POST(req({ name: 'Asha' }));
    expect(b.status).toBe(400);
    expect(mockQueryOne).not.toHaveBeenCalled();
  });
});
