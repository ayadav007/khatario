/**
 * Leave and overtime approvals act as the signed-in user only. A user id in the request body
 * (updated_by_user_id / approved_by) must never change who is authorized or recorded.
 */
import { NextRequest } from 'next/server';

const queryOne = jest.fn();
const query = jest.fn();
jest.mock('@/lib/db', () => ({ queryOne: (...a: unknown[]) => queryOne(...a), query: (...a: unknown[]) => query(...a) }));
jest.mock('@/lib/authorization', () => {
  class AuthorizationError extends Error {
    toNextResponse() {
      const { NextResponse } = jest.requireActual('next/server');
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  return { authorize: jest.fn(), AuthorizationError };
});
jest.mock('@/lib/hr/manager-scope', () => ({ canActOnLeaveRequest: jest.fn(), canApproveForEmployee: jest.fn() }));
jest.mock('@/lib/hr/leave-attendance-sync', () => ({ syncApprovedLeaveToAttendance: jest.fn() }));
jest.mock('@/lib/hr/leave/leave-request-approval', () => ({
  decideLeaveRequestApproval: jest.fn(),
  listLeaveRequestApprovals: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/lib/hr/shift-overtime/ot-request-approval', () => ({ decideOtRequestApproval: jest.fn() }));
jest.mock('@/lib/hr/shift-overtime/ot-policy', () => ({ getOtPolicy: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/hr/hr-approval-settings', () => ({ getHrApprovalSettings: jest.fn().mockResolvedValue({}) }));
jest.mock('@/lib/hr/shift-overtime/ot-payroll', () => ({ finalizeApprovedOtRequest: jest.fn() }));
jest.mock('@/lib/employee-portal/portal-api-guard', () => ({
  resolveActorContext: jest.fn(async (req: NextRequest) => {
    const userId = req.headers.get('x-authenticated-user-id');
    const businessId = req.headers.get('x-authenticated-business-id');
    return userId && businessId ? { userId, businessId, isPortal: false } : null;
  }),
  assertPortalFeatureForRequest: jest.fn(),
  blockPortalAdminAction: jest.fn(() => null),
}));

import { PATCH as patchLeave } from '@/app/api/employees/leave-requests/[id]/route';
import { PATCH as patchOvertime } from '@/app/api/employees/overtime-requests/[id]/route';
import { canActOnLeaveRequest, canApproveForEmployee } from '@/lib/hr/manager-scope';
import { authorize, AuthorizationError } from '@/lib/authorization';

const OWNER = 'owner-user';
const STAFF = 'staff-user';

function req(body: Record<string, unknown>, sessionUser: string | null = STAFF) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (sessionUser) {
    headers['x-authenticated-user-id'] = sessionUser;
    headers['x-authenticated-business-id'] = 'biz-1';
  }
  return new NextRequest('http://localhost/api/x', { method: 'PATCH', headers, body: JSON.stringify(body) });
}

beforeEach(() => {
  jest.clearAllMocks();
  queryOne.mockResolvedValue({ status: 'pending', employee_id: 'emp-9', business_id: 'biz-1', start_date: '2026-10-20', end_date: '2026-10-20', total_days: 1 });
});

describe('leave approval', () => {
  it('authorizes and records the session user, not a user named in the body', async () => {
    (canActOnLeaveRequest as jest.Mock).mockResolvedValue(true);
    const res = await patchLeave(req({ action: 'approve', updated_by_user_id: OWNER, approved_by: OWNER }), { params: { id: 'lr-1' } });
    expect(res.status).toBe(200);
    expect(canActOnLeaveRequest).toHaveBeenCalledWith(STAFF, 'lr-1', 'biz-1');
    const update = query.mock.calls.find(([sql]) => String(sql).includes("status = 'approved'"));
    expect(update?.[1][0]).toBe(STAFF);
  });

  it('refuses a staff user who may not act, even when the body names the owner', async () => {
    (canActOnLeaveRequest as jest.Mock).mockResolvedValue(false);
    const res = await patchLeave(req({ action: 'reject', updated_by_user_id: OWNER }), { params: { id: 'lr-1' } });
    expect(res.status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it('needs a signed-in session', async () => {
    const res = await patchLeave(req({ action: 'approve', updated_by_user_id: OWNER }, null), { params: { id: 'lr-1' } });
    expect(res.status).toBe(401);
  });
});

describe('overtime approval', () => {
  it('checks permission for the session user before a reject', async () => {
    (canApproveForEmployee as jest.Mock).mockResolvedValue(false);
    (authorize as jest.Mock).mockRejectedValue(new AuthorizationError('no'));
    const res = await patchOvertime(req({ action: 'reject', updated_by_user_id: OWNER }), { params: { id: 'ot-1' } });
    expect(res.status).toBe(403);
    expect(authorize).toHaveBeenCalledWith(STAFF, 'leave_requests', 'update', { businessId: 'biz-1' });
  });

  it('records the session user as approver', async () => {
    (canApproveForEmployee as jest.Mock).mockResolvedValue(true);
    const res = await patchOvertime(req({ action: 'approve', updated_by_user_id: OWNER }), { params: { id: 'ot-1' } });
    expect(res.status).toBe(200);
    const update = queryOne.mock.calls.find(([sql]) => String(sql).includes("status = 'approved'"));
    expect(update?.[1]).toEqual(['ot-1', STAFF]);
  });
});
