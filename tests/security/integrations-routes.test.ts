/**
 * /api/integrations routes: the business and user come only from requireTenantPermission,
 * unknown and coming-soon ids are 404, and no response carries the request password.
 */
const permission = jest.fn();
jest.mock('@/lib/security/require-tenant-permission', () => ({
  requireTenantPermission: (...a: unknown[]) => permission(...a),
}));
const list = jest.fn();
const get = jest.fn();
const save = jest.fn();
const disconnect = jest.fn();
jest.mock('@/lib/integrations/service', () => ({
  listConnections: (...a: unknown[]) => list(...a),
  getConnection: (...a: unknown[]) => get(...a),
  saveConnection: (...a: unknown[]) => save(...a),
  disconnect: (...a: unknown[]) => disconnect(...a),
}));

import { NextRequest, NextResponse } from 'next/server';
import { GET as LIST } from '@/app/api/integrations/route';
import { GET, PUT, DELETE } from '@/app/api/integrations/[id]/route';

const VIEW = {
  provider: 'shiprocket', connected: true, config: { email: 'a@b.c' },
  secretsSet: ['password'], webhookConfigured: false, lastVerifiedAt: null,
};
const OK = { ok: true, businessId: 'SESSION_BIZ', userId: 'U1' };

function req(method: string, body?: unknown, qs = '') {
  return new NextRequest(`http://localhost/api/integrations/x${qs}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}
const ctx = (id: string) => ({ params: { id } });
const refused = () => ({ ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) });

beforeEach(() => {
  jest.resetAllMocks();
  permission.mockResolvedValue(OK);
});

test('list returns the session business connections', async () => {
  list.mockResolvedValue([VIEW]);
  const res = await LIST(req('GET', undefined, '?business_id=OTHER'));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ connections: [VIEW] });
  expect(list).toHaveBeenCalledWith('SESSION_BIZ');
  expect(permission).toHaveBeenCalledWith(expect.anything(), 'OTHER', 'settings', ['read', 'update']);
});

test('GET one returns the connection or null', async () => {
  get.mockResolvedValue(null);
  const res = await GET(req('GET'), ctx('shiprocket'));
  expect(await res.json()).toEqual({ connection: null });
  expect(get).toHaveBeenCalledWith('SESSION_BIZ', 'shiprocket');
});

test('PUT passes the session business and user, never the body business', async () => {
  save.mockResolvedValue({ ok: true, connection: VIEW });
  const res = await PUT(req('PUT', { business_id: 'OTHER', values: { email: 'a@b.c', password: 'p' } }), ctx('shiprocket'));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ connection: VIEW });
  expect(save).toHaveBeenCalledWith('SESSION_BIZ', 'shiprocket', { email: 'a@b.c', password: 'p' }, 'U1');
});

test.each([
  ['list', () => LIST(req('GET'))],
  ['get', () => GET(req('GET'), ctx('shiprocket'))],
  ['put', () => PUT(req('PUT', { values: {} }), ctx('shiprocket'))],
  ['delete', () => DELETE(req('DELETE'), ctx('shiprocket'))],
])('a refused permission on %s is returned as is and the service is not called', async (_n, call) => {
  permission.mockResolvedValue(refused());
  const res = await call();
  expect(res.status).toBe(403);
  for (const m of [list, get, save, disconnect]) expect(m).not.toHaveBeenCalled();
});

test.each([['INVALID', 400], ['REJECTED', 400], ['UNREACHABLE', 502], ['TOKEN_TAKEN', 409]])('%s -> %i', async (code, status) => {
  save.mockResolvedValue({ ok: false, code, error: 'msg' });
  const res = await PUT(req('PUT', { values: { email: 'a@b.c' } }), ctx('shiprocket'));
  expect(res.status).toBe(status);
  expect(await res.json()).toEqual({ error: 'msg', code });
});

test.each(['nope', 'delhivery'])('unknown id %s is 404 on every method', async (id) => {
  for (const res of [
    await GET(req('GET'), ctx(id)),
    await PUT(req('PUT', { values: {} }), ctx(id)),
    await DELETE(req('DELETE'), ctx(id)),
  ]) expect(res.status).toBe(404);
  for (const m of [get, save, disconnect]) expect(m).not.toHaveBeenCalled();
});

test.each([[[1]], ['str'], [null], [undefined]])('values %p is 400', async (values) => {
  const res = await PUT(req('PUT', { values }), ctx('shiprocket'));
  expect(res.status).toBe(400);
  expect(save).not.toHaveBeenCalled();
});

test('a body that is not JSON is 400', async () => {
  const res = await PUT(req('PUT', '{not json'), ctx('shiprocket'));
  expect(res.status).toBe(400);
  expect(save).not.toHaveBeenCalled();
});

test('DELETE succeeds and uses the session business', async () => {
  disconnect.mockResolvedValue({ ok: true });
  const res = await DELETE(req('DELETE'), ctx('shiprocket'));
  expect(await res.json()).toEqual({ ok: true });
  expect(disconnect).toHaveBeenCalledWith('SESSION_BIZ', 'shiprocket');
});

test('DELETE in flight is 409 with the count', async () => {
  disconnect.mockResolvedValue({ ok: false, code: 'IN_FLIGHT', count: 3 });
  const res = await DELETE(req('DELETE'), ctx('shiprocket'));
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({
    error: '3 parcel(s) are still with Shiprocket. Disconnect once they are delivered or returned.',
    code: 'IN_FLIGHT',
    count: 3,
  });
});

test('responses never include the request password', async () => {
  save.mockResolvedValue({ ok: false, code: 'REJECTED', error: 'nope' });
  const res = await PUT(req('PUT', { values: { email: 'a@b.c', password: 'SECRET-PW' } }), ctx('shiprocket'));
  expect(await res.text()).not.toContain('SECRET-PW');
});

test('an unexpected error is 500, logs only the message, never the body', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
  save.mockRejectedValue(new Error('boom'));
  const res = await PUT(req('PUT', { values: { password: 'SECRET-PW' } }), ctx('shiprocket'));
  expect(res.status).toBe(500);
  expect(await res.json()).toEqual({ error: 'Could not save the integration' });
  expect(JSON.stringify(spy.mock.calls)).not.toContain('SECRET-PW');
  spy.mockRestore();
});
