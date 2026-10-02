/**
 * Release 4: POST /api/notifications/popups/dismiss is scoped to the session user and business,
 * and GET /api/notifications returns seq + popup_dismissed_at (old shape before migration 337).
 */
const mockQueryOne = jest.fn();
const mockQuery = jest.fn();
const mockQueryRows = jest.fn();
jest.mock('@/lib/db', () => ({
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
  query: (...a: unknown[]) => mockQuery(...a),
  queryRows: (...a: unknown[]) => mockQueryRows(...a),
}));
jest.mock('@/lib/queue/redis', () => ({ getRedisConnection: () => null }));

import { NextRequest } from 'next/server';
import { POST as dismissPOST } from '@/app/api/notifications/popups/dismiss/route';

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER_USER = '55555555-5555-4555-8555-555555555555';
const BIZ = '22222222-2222-4222-8222-222222222222';
const BIZ_Y = '33333333-3333-4333-8333-333333333333';
const NOTE = '44444444-4444-4444-8444-444444444444';

let member = true;

function req(body: unknown, opts: { session?: boolean; business?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-user-id': OTHER_USER };
  if (opts.session !== false) {
    headers['x-authenticated-user-id'] = USER;
    headers['x-authenticated-business-id'] = opts.business ?? BIZ;
    headers['x-authenticated-session-version'] = '3';
  }
  return new NextRequest('http://localhost/api/notifications/popups/dismiss', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  member = true;
  mockQueryOne.mockReset().mockImplementation(async (sql: string, params: string[]) => {
    if (/auth_session_version/.test(sql)) return { auth_session_version: '3' };
    if (/user_businesses/.test(sql)) return member && params[1] === BIZ ? { one: 1 } : null;
    throw new Error(`unexpected ${sql}`);
  });
  mockQueryRows.mockReset().mockResolvedValue([{ id: NOTE }]);
});

describe('POST /api/notifications/popups/dismiss', () => {
  it('updates only the session user’s rows in the session business, up to the seen seq', async () => {
    const res = await dismissPOST(req({ items: [{ id: NOTE, seq: '1000000000004' }], user_id: OTHER_USER, business_id: BIZ_Y }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, dismissed: [NOTE] });
    const [sql, params] = mockQueryRows.mock.calls[0];
    expect(params).toEqual([BIZ, USER, [NOTE], ['1000000000004']]);
    expect(sql).toMatch(/n\.business_id = \$1/);
    expect(sql).toMatch(/n\.user_id = \$2/);
    expect(sql).toMatch(/n\.seq <= d\.seq/);
    expect(sql).toMatch(/popup_dismissed_at = NOW\(\)/);
  });

  it('requires a session (ignores x-user-id)', async () => {
    const res = await dismissPOST(req({ items: [{ id: NOTE, seq: '4' }] }, { session: false }));
    expect(res.status).toBe(401);
    expect(mockQueryRows).not.toHaveBeenCalled();
  });

  it('refuses a business the user does not belong to', async () => {
    const res = await dismissPOST(req({ items: [{ id: NOTE, seq: '4' }] }, { business: BIZ_Y }));
    expect(res.status).toBe(403);
    expect(mockQueryRows).not.toHaveBeenCalled();
  });

  it.each([
    ['no items', {}],
    ['empty items', { items: [] }],
    ['more than 50 items', { items: Array.from({ length: 51 }, () => ({ id: NOTE, seq: '1' })) }],
    ['bad id', { items: [{ id: 'nope', seq: '1' }] }],
    ['bad seq', { items: [{ id: NOTE, seq: '-1' }] }],
    ['missing seq', { items: [{ id: NOTE }] }],
  ])('rejects malformed input: %s', async (_label, body) => {
    const res = await dismissPOST(req(body));
    expect(res.status).toBe(400);
    expect(mockQueryRows).not.toHaveBeenCalled();
  });
});

describe('GET /api/notifications', () => {
  let GET: (r: NextRequest) => Promise<Response>;

  beforeAll(async () => {
    jest.doMock('@/lib/auth-helpers', () => ({
      ...jest.requireActual('@/lib/auth-helpers'),
      requirePortalSession: async () => null,
    }));
    ({ GET } = await import('@/app/api/notifications/route'));
  });

  const getReq = () =>
    new NextRequest(`http://localhost/api/notifications?business_id=${BIZ}&limit=20`, {
      headers: {
        'x-authenticated-user-id': USER,
        'x-authenticated-business-id': BIZ,
        'x-authenticated-session-version': '3',
      },
    });

  let latest: string | null | Error;
  let order: string[];

  beforeEach(() => {
    latest = '1000000000042';
    order = [];
    mockQueryOne.mockReset().mockImplementation(async (sql: string) => {
      if (/GREATEST/.test(sql)) {
        order.push('cursor');
        if (latest instanceof Error) throw latest;
        return { seq: latest };
      }
      throw new Error(`unexpected ${sql}`);
    });
    const listed = mockQueryRows.getMockImplementation();
    mockQueryRows.mockImplementation(async (...a: unknown[]) => {
      order.push('list');
      return listed?.(...a);
    });
  });

  it('returns seq and popup_dismissed_at', async () => {
    mockQueryRows.mockResolvedValueOnce([{ id: NOTE, seq: '7', popup_dismissed_at: null, is_read: false }]);
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect((await res.json()).notifications[0]).toMatchObject({ seq: '7', popup_dismissed_at: null });
    expect(mockQueryRows.mock.calls[0][0]).toMatch(/seq::text AS seq, popup_dismissed_at/);
  });

  it('returns the latest visible seq as stream_cursor, read for the session scope before the list', async () => {
    mockQueryRows.mockImplementationOnce(async () => {
      order.push('list');
      return [{ id: NOTE, seq: '1000000000007', is_read: true }];
    });
    const res = await GET(getReq());
    const body = await res.json();
    expect(body.stream_cursor).toBe('1000000000042');
    expect(order).toEqual(['cursor', 'list']);
    const [sql, params] = mockQueryOne.mock.calls[0];
    expect(params).toEqual([BIZ, USER]);
    expect(sql).toMatch(/user_id = \$2/);
    expect(sql).toMatch(/user_id IS NULL/);
    const [listSql, listParams] = mockQueryRows.mock.calls[0];
    expect(listSql).toMatch(/ORDER BY created_at DESC\s+LIMIT \$3/);
    expect(listParams).toEqual([BIZ, USER, 20]);
  });

  it("returns stream_cursor '0' when nothing is visible yet", async () => {
    latest = null;
    mockQueryRows.mockResolvedValueOnce([]);
    const body = await (await GET(getReq())).json();
    expect(body).toMatchObject({ notifications: [], stream_cursor: '0' });
  });

  it('falls back to the old columns when the database has no seq yet', async () => {
    mockQueryRows
      .mockRejectedValueOnce(Object.assign(new Error('column "seq" does not exist'), { code: '42703' }))
      .mockResolvedValueOnce([{ id: NOTE, is_read: false }]);
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notifications).toEqual([{ id: NOTE, is_read: false }]);
    expect(body.stream_cursor).toBeNull();
    expect(mockQueryRows.mock.calls[1][0]).not.toMatch(/seq/);
  });

  it('reports no stream cursor when the seq column is missing', async () => {
    latest = Object.assign(new Error('column "seq" does not exist'), { code: '42703' });
    mockQueryRows.mockResolvedValueOnce([{ id: NOTE, is_read: false }]);
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect((await res.json()).stream_cursor).toBeNull();
    expect(mockQueryRows).toHaveBeenCalledTimes(1);
    expect(mockQueryRows.mock.calls[0][0]).not.toMatch(/seq/);
  });

  it('does not hide other database errors', async () => {
    mockQueryRows.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: '57014' }));
    const res = await GET(getReq());
    expect(res.status).toBe(500);
    expect(mockQueryRows).toHaveBeenCalledTimes(1);
  });
});
