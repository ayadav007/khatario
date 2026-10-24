/**
 * POST /api/customers/[id]/send-reminder must scope to the session business, require
 * customers read permission, and pass the WhatsApp plan gate before any message is sent.
 */
const mockQueryOne = jest.fn();
const mockQueryRows = jest.fn();
jest.mock('@/lib/db', () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
  queryRows: (...a: unknown[]) => mockQueryRows(...a),
}));
const mockSend = jest.fn();
jest.mock('@/lib/reminder-message-processor', () => ({
  sendReminderMessage: (...a: unknown[]) => mockSend(...a),
}));
const mockCheckLimit = jest.fn();
jest.mock('@/lib/subscription', () => ({
  checkLimit: (...a: unknown[]) => mockCheckLimit(...a),
  hasWhatsAppBotAddon: jest.fn(),
  hasWhatsAppSendMessageAddon: jest.fn(),
}));
jest.mock('@/lib/permissions', () => ({ checkUserPermission: jest.fn() }));
jest.mock('@/lib/security/require-operational-subscription', () => ({
  requireOperationalSubscription: jest.fn().mockResolvedValue({ status: 'active' }),
  operationalSubscriptionErrorResponse: () => null,
}));
const mockFeature = jest.fn();
jest.mock('@/lib/subscription/feature-access', () => {
  class FeatureAccessDeniedError extends Error {
    toResponse() {
      return { code: 'FEATURE_NOT_IN_PLAN' };
    }
    toNextResponse() {
      const { NextResponse } = jest.requireActual('next/server');
      return NextResponse.json({ error: 'Feature not in plan' }, { status: 403 });
    }
  }
  return {
    assertFeatureAccess: (...a: unknown[]) => mockFeature(...a),
    assertReportAccess: jest.fn(),
    FeatureAccessDeniedError,
  };
});
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
jest.mock('@/lib/enforce-access', () => ({
  enforceAccess: jest.fn(),
  enforceAccessErrorResponse: () => null,
}));
jest.mock('@/lib/auth-helpers', () => ({
  ...jest.requireActual('@/lib/auth-helpers'),
  assertSessionValidForCookieAuth: jest.fn().mockResolvedValue(undefined),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/customers/[id]/send-reminder/route';

const USER = '11111111-1111-4111-8111-111111111111';
const BIZ = '22222222-2222-4222-8222-222222222222';
const OTHER_BIZ = '33333333-3333-4333-8333-333333333333';
const CUSTOMER = '55555555-5555-4555-8555-555555555555';

const session = { 'x-authenticated-user-id': USER, 'x-authenticated-business-id': BIZ };

function post(body: Record<string, unknown>, headers: Record<string, string> = session) {
  const req = new NextRequest(`http://localhost/api/customers/${CUSTOMER}/send-reminder`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return POST(req, { params: { id: CUSTOMER } });
}

beforeEach(() => {
  mockQueryOne.mockReset().mockImplementation(async (sql: string) => {
    if (sql.includes('seat_type')) return { seat_type: null };
    if (sql.includes('FROM customers')) return { id: CUSTOMER, name: 'Ravi', phone: '+919999999999' };
    return null;
  });
  mockQueryRows.mockReset().mockResolvedValue([{ id: 'inv-1', invoice_number: 'INV-1' }]);
  mockSend.mockReset().mockResolvedValue({ success: true });
  mockCheckLimit.mockReset().mockResolvedValue({ allowed: true, current: 0, limit: -1 });
  mockFeature.mockReset().mockResolvedValue(undefined);
  mockAuthorize.mockReset().mockResolvedValue(undefined);
});

function customerLookupBusiness() {
  const call = mockQueryOne.mock.calls.find(([sql]) => String(sql).includes('FROM customers'));
  return call?.[1]?.[1];
}

it('sends for the session business and checks customers read permission', async () => {
  const res = await post({ business_id: BIZ });
  expect(res.status).toBe(200);
  expect((await res.json()).sent).toBe(1);
  expect(mockAuthorize).toHaveBeenCalledWith(USER, 'customers', 'read', expect.objectContaining({ businessId: BIZ }));
  expect(customerLookupBusiness()).toBe(BIZ);
  expect(mockSend).toHaveBeenCalledWith('inv-1', BIZ, expect.any(String), true, 'manual');
});

it('uses the session business when the body has none', async () => {
  const res = await post({});
  expect(res.status).toBe(200);
  expect(customerLookupBusiness()).toBe(BIZ);
});

it('rejects another business_id in the body without sending', async () => {
  const res = await post({ business_id: OTHER_BIZ });
  expect(res.status).toBe(403);
  expect(mockQueryOne.mock.calls.some(([sql]) => String(sql).includes('FROM customers'))).toBe(false);
  expect(mockSend).not.toHaveBeenCalled();
});

it('requires a signed-in session', async () => {
  const res = await post({ business_id: BIZ }, {});
  expect(res.status).toBe(401);
  expect(mockSend).not.toHaveBeenCalled();
});

it('blocks users without customers read permission', async () => {
  mockAuthorize.mockRejectedValue(new (jest.requireMock('@/lib/authorization').AuthorizationError)());
  const res = await post({ business_id: BIZ });
  expect(res.status).toBe(403);
  expect(mockSend).not.toHaveBeenCalled();
});

it('blocks businesses without WhatsApp on their plan', async () => {
  mockFeature.mockRejectedValue(new (jest.requireMock('@/lib/subscription/feature-access').FeatureAccessDeniedError)());
  const res = await post({ business_id: BIZ });
  expect(res.status).toBe(403);
  expect(mockSend).not.toHaveBeenCalled();
});

it('blocks WhatsApp agent seats from sending reminders', async () => {
  mockQueryOne.mockImplementation(async (sql: string) =>
    sql.includes('seat_type') ? { seat_type: 'connect' } : null,
  );
  const res = await post({ business_id: BIZ });
  expect(res.status).toBe(403);
  expect(mockSend).not.toHaveBeenCalled();
});
