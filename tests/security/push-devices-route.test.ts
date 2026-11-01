/**
 * Device registration routes: the owner of a token is the authenticated identity, never the
 * body. Business devices need the middleware session; customer devices need the store cookie of
 * that shop. The registry is mocked; its real SQL is covered in tests/db/push-dispatch.db.test.ts.
 */
const mockRegister = jest.fn();
const mockRevoke = jest.fn();
jest.mock('@/lib/push/device-registry', () => ({
  registerPushDevice: (...a: unknown[]) => mockRegister(...a),
  revokePushDevice: (...a: unknown[]) => mockRevoke(...a),
}));

const mockQueryOne = jest.fn();
jest.mock('@/lib/db', () => ({
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
  query: jest.fn(),
  queryRows: jest.fn(),
}));

const mockResolveStore = jest.fn();
jest.mock('@/lib/store/resolve-store', () => ({ resolveStoreBySubdomain: (...a: unknown[]) => mockResolveStore(...a) }));

import { NextRequest } from 'next/server';
import { POST as bizPOST, DELETE as bizDELETE } from '@/app/api/push/devices/route';
import { POST as custPOST, DELETE as custDELETE } from '@/app/api/public/store/[subdomain]/push/devices/route';
import { signStoreCustomer, STORE_CUSTOMER_COOKIE } from '@/lib/store/customer-session';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '55555555-5555-4555-8555-555555555555';
const BIZ_X = '22222222-2222-4222-8222-222222222222';
const BIZ_Y = '33333333-3333-4333-8333-333333333333';
const CUST = '66666666-6666-4666-8666-666666666666';
const TOKEN = 'fcm-token-0123456789-abcdefghijklmnopqrstuvwxyz';

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret';
  mockRegister.mockReset().mockResolvedValue({ ok: true, deviceId: 'dev-1' });
  mockRevoke.mockReset().mockResolvedValue(true);
  mockQueryOne.mockReset().mockImplementation(async (sql: string, params: unknown[]) => {
    if (/auth_session_version/.test(sql)) return params[0] === USER_A ? { auth_session_version: '3' } : null;
    if (/FROM users u/.test(sql)) return params[0] === USER_A && params[1] === BIZ_X ? { one: 1 } : null;
    throw new Error(`unexpected queryOne: ${sql}`);
  });
  mockResolveStore.mockReset().mockImplementation(async (sub: string) => (sub === 'ganesh' ? { business_id: BIZ_X } : null));
});

function session(method: string, body: unknown, over: Record<string, string> = {}) {
  return new NextRequest('http://localhost/api/push/devices', {
    method,
    headers: {
      'x-authenticated-user-id': USER_A,
      'x-authenticated-business-id': BIZ_X,
      'x-authenticated-session-version': '3',
      'content-type': 'application/json',
      ...over,
    },
    body: JSON.stringify(body),
  });
}

describe('POST/DELETE /api/push/devices (business audience)', () => {
  it('refuses without a verified session, even with a legacy x-user-id header', async () => {
    const req = new NextRequest('http://localhost/api/push/devices', {
      method: 'POST',
      headers: { 'x-user-id': USER_A, 'content-type': 'application/json' },
      body: JSON.stringify({ token: TOKEN, app_id: 'com.khatario.app' }),
    });
    expect((await bizPOST(req)).status).toBe(401);
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('registers for the session user as audience business; body user_id and audience are ignored', async () => {
    const res = await bizPOST(
      session('POST', { token: TOKEN, app_id: 'com.khatario.app', user_id: USER_B, audience: 'customer', customer_id: CUST, device_label: 'Pixel 7' }),
    );
    expect(res.status).toBe(200);
    expect(mockRegister).toHaveBeenCalledWith(
      expect.objectContaining({ audience: 'business', userId: USER_A, token: TOKEN, appId: 'com.khatario.app', deviceLabel: 'Pixel 7' }),
    );
    expect(mockRegister.mock.calls[0][0]).not.toHaveProperty('customerId');
  });

  it('returns 400 when the registry rejects the input', async () => {
    mockRegister.mockResolvedValueOnce({ ok: false, error: 'Unknown app id' });
    const res = await bizPOST(session('POST', { token: TOKEN, app_id: 'com.evil.app' }));
    expect(res.status).toBe(400);
  });

  it('revokes only the session user’s token on logout', async () => {
    const res = await bizDELETE(session('DELETE', { token: TOKEN }));
    expect(res.status).toBe(200);
    expect(mockRevoke).toHaveBeenCalledWith(TOKEN, { audience: 'business', userId: USER_A });
  });

  it('rejects a revoked session', async () => {
    const res = await bizPOST(session('POST', { token: TOKEN, app_id: 'com.khatario.app' }, { 'x-authenticated-session-version': '2' }));
    expect(res.status).toBe(401);
  });
});

function storeReq(method: string, body: unknown, cookie?: string) {
  return new NextRequest('http://localhost/api/public/store/ganesh/push/devices', {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie: `${STORE_CUSTOMER_COOKIE}=${cookie}` } : {}) },
    body: JSON.stringify(body),
  });
}

describe('POST/DELETE /api/public/store/[subdomain]/push/devices (customer audience)', () => {
  it('needs the store customer cookie of that shop', async () => {
    const res = await custPOST(storeReq('POST', { token: TOKEN, app_id: 'com.khatario.app' }), { params: { subdomain: 'ganesh' } });
    expect(res.status).toBe(401);
    const other = await custPOST(storeReq('POST', { token: TOKEN, app_id: 'com.khatario.app' }, signStoreCustomer(BIZ_Y, CUST)), {
      params: { subdomain: 'ganesh' },
    });
    expect(other.status).toBe(401);
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it('registers as audience customer for the cookie’s customer and shop', async () => {
    const res = await custPOST(
      storeReq('POST', { token: TOKEN, app_id: 'com.khatario.app', user_id: USER_A, business_id: BIZ_Y }, signStoreCustomer(BIZ_X, CUST)),
      { params: { subdomain: 'ganesh' } },
    );
    expect(res.status).toBe(200);
    expect(mockRegister).toHaveBeenCalledWith(
      expect.objectContaining({ audience: 'customer', customerId: CUST, businessId: BIZ_X, token: TOKEN }),
    );
    expect(mockRegister.mock.calls[0][0]).not.toHaveProperty('userId');
  });

  it('revokes with the customer and shop from the cookie', async () => {
    const res = await custDELETE(storeReq('DELETE', { token: TOKEN }, signStoreCustomer(BIZ_X, CUST)), { params: { subdomain: 'ganesh' } });
    expect(res.status).toBe(200);
    expect(mockRevoke).toHaveBeenCalledWith(TOKEN, { audience: 'customer', customerId: CUST, businessId: BIZ_X });
  });

  it('404s for an unknown store', async () => {
    const res = await custPOST(storeReq('POST', { token: TOKEN, app_id: 'com.khatario.app' }, signStoreCustomer(BIZ_X, CUST)), {
      params: { subdomain: 'nope' },
    });
    expect(res.status).toBe(404);
  });
});
