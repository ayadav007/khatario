/**
 * An owner signed in to both the business console and the employee portal in one browser:
 * console pages keep the owner's session on ESS APIs; portal pages keep the employee's.
 */
import { NextRequest } from 'next/server';

jest.mock('@/lib/platform-jwt', () => ({ getPlatformSessionFromRequest: jest.fn(async () => null) }));
jest.mock('@/lib/jwt', () => ({
  clearSessionCookie: jest.fn(),
  shouldRotateTokens: jest.fn(async () => ({
    rotate: false,
    payload: { userId: '11111111-1111-4111-8111-111111111111', businessId: '22222222-2222-4222-8222-222222222222', sv: 1 },
  })),
}));

import { middleware } from '../../middleware';

const PORTAL_HEADER = 'x-middleware-request-x-employee-portal-session';

function attendanceRequest(referer?: string, host = 'staging.khatario.com') {
  const headers: Record<string, string> = {
    host,
    cookie: 'khatario_employee_portal=portal-token; khatario_session=owner-token',
  };
  if (referer) headers.referer = referer;
  // The Next origin is internal behind nginx; the public host comes from the Host header.
  return new NextRequest('http://localhost:3000/api/employees/attendance?start_date=2026-10-23', { headers });
}

describe('employee portal cookie vs business console session', () => {
  it('a console page keeps the owner session', async () => {
    const res = await middleware(attendanceRequest('https://staging.khatario.com/employees/attendance'));
    expect(res.headers.get(PORTAL_HEADER)).toBeNull();
    expect(res.headers.get('x-middleware-request-x-authenticated-user-id')).toBe('11111111-1111-4111-8111-111111111111');
  });

  it('a portal page uses the employee portal session', async () => {
    const res = await middleware(attendanceRequest('https://staging.khatario.com/shalini-traders/employees/attendance'));
    expect(res.headers.get(PORTAL_HEADER)).toBe('1');
  });

  it('a request without a Referer keeps the old portal preference', async () => {
    const res = await middleware(attendanceRequest());
    expect(res.headers.get(PORTAL_HEADER)).toBe('1');
  });

  it('a Referer from another site is not treated as the console', async () => {
    const res = await middleware(attendanceRequest('https://evil.example/employees/attendance'));
    expect(res.headers.get(PORTAL_HEADER)).toBe('1');
  });
});
