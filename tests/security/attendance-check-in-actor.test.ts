/**
 * POST /api/employees/attendance/check-in: self-service always passes the location rule, whatever
 * `method` says; manual entries need attendance permission and stay inside the session's business.
 */
const mockQueryOne = jest.fn();
jest.mock('@/lib/db', () => ({
  query: jest.fn(),
  queryRows: jest.fn().mockResolvedValue([]),
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
}));
const mockAuthorize = jest.fn();
jest.mock('@/lib/authorization', () => {
  class AuthorizationError extends Error {
    toNextResponse() {
      const { NextResponse } = jest.requireActual('next/server');
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  return { authorize: (...a: unknown[]) => mockAuthorize(...a), AuthorizationError };
});
const mockPortal = jest.fn();
jest.mock('@/lib/employee-portal/session', () => ({
  getEmployeePortalSessionFromRequest: (...a: unknown[]) => mockPortal(...a),
}));
jest.mock('@/lib/employee-portal/portal-api-guard', () => ({
  assertPortalFeatureForRequest: jest.fn().mockResolvedValue(undefined),
}));
const mockLocation = jest.fn();
jest.mock('@/lib/hr/staff-app/sites', () => ({
  validateSelfServiceLocation: (...a: unknown[]) => mockLocation(...a),
}));
const mockCheckIn = jest.fn();
jest.mock('@/lib/hr/attendance-punch', () => {
  class AttendancePunchError extends Error {
    constructor(message: string, readonly code: string, readonly status = 400) {
      super(message);
    }
  }
  return { AttendancePunchError, recordCheckIn: (...a: unknown[]) => mockCheckIn(...a) };
});

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/employees/attendance/check-in/route';

const EMP = '11111111-1111-4111-8111-111111111111';
const MANAGER = '22222222-2222-4222-8222-222222222222';
const BIZ = '33333333-3333-4333-8333-333333333333';
const OTHER_BIZ = '44444444-4444-4444-8444-444444444444';
const OUTSIDER = '55555555-5555-4555-8555-555555555555';

function post(body: Record<string, unknown>, headers: Record<string, string>) {
  return POST(
    new NextRequest('http://localhost/api/employees/attendance/check-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  );
}

const jwt = (userId: string) => ({ 'x-authenticated-user-id': userId, 'x-authenticated-business-id': BIZ });

beforeEach(() => {
  mockQueryOne.mockReset().mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.includes('FROM employees WHERE id')) {
      if (params[0] === OUTSIDER) return { business_id: OTHER_BIZ, default_shift_id: null };
      return { business_id: BIZ, default_shift_id: null };
    }
    return null;
  });
  mockAuthorize.mockReset().mockResolvedValue(undefined);
  mockPortal.mockReset().mockResolvedValue(null);
  mockLocation.mockReset().mockResolvedValue({ ok: false, error: 'Check-in must be at one of your office locations.' });
  mockCheckIn.mockReset().mockResolvedValue({ id: 'att-1' });
});

it('portal check-in with method "manual" still has to pass the location rule', async () => {
  mockPortal.mockResolvedValue({ employee_id: EMP, business_id: BIZ });
  const res = await post({ method: 'manual', location_lat: 12.9, location_lng: 77.5 }, { 'x-employee-portal-session': '1' });
  expect(res.status).toBe(400);
  expect(mockLocation).toHaveBeenCalledWith(BIZ, EMP, 12.9, 77.5);
  expect(mockCheckIn).not.toHaveBeenCalled();
});

it('an employee checking themself in is self-service, even with method "manual"', async () => {
  const res = await post({ employee_id: EMP, method: 'manual' }, jwt(EMP));
  expect(res.status).toBe(400);
  expect(mockAuthorize).not.toHaveBeenCalled();
  expect(mockCheckIn).not.toHaveBeenCalled();
});

it('self-service inside the site is recorded as mobile_app', async () => {
  mockLocation.mockResolvedValue({ ok: true });
  const res = await post({ method: 'manual', location_lat: 12.9, location_lng: 77.5 }, jwt(EMP));
  expect(res.status).toBe(200);
  expect(mockCheckIn).toHaveBeenCalledWith(expect.objectContaining({ employeeId: EMP, businessId: BIZ, method: 'mobile_app' }));
});

it('a manager marking someone else needs attendance permission, and skips the location rule', async () => {
  const res = await post({ employee_id: EMP, method: 'manual' }, jwt(MANAGER));
  expect(res.status).toBe(200);
  expect(mockAuthorize).toHaveBeenCalledWith(MANAGER, 'attendance', 'create', { businessId: BIZ });
  expect(mockLocation).not.toHaveBeenCalled();
  expect(mockCheckIn).toHaveBeenCalledWith(expect.objectContaining({ employeeId: EMP, method: 'manual' }));
});

it('cannot check in an employee of another business', async () => {
  const res = await post({ employee_id: OUTSIDER, method: 'manual' }, jwt(MANAGER));
  expect(res.status).toBe(404);
  expect(mockCheckIn).not.toHaveBeenCalled();
});

it('refuses a request with no session, whatever the body says', async () => {
  const res = await post({ employee_id: EMP, business_id: BIZ }, {});
  expect(res.status).toBe(401);
  expect(mockCheckIn).not.toHaveBeenCalled();
});

it('without permission a manager gets 403', async () => {
  const { AuthorizationError } = jest.requireMock('@/lib/authorization');
  mockAuthorize.mockRejectedValue(new AuthorizationError('no'));
  const res = await post({ employee_id: EMP }, jwt(MANAGER));
  expect(res.status).toBe(403);
});
