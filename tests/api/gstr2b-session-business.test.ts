/**
 * GSTR-2B reconcile and decision take the business from the session. A business_id in the body or query is
 * optional and, when present, must match the session; every query and write uses the session business.
 */
import { NextRequest } from 'next/server';

const poolQuery = jest.fn();
const release = jest.fn();
const reconcile = jest.fn();
const recordDecision = jest.fn();
const getEligibleITC = jest.fn();
const listMissingReferences = jest.fn();

jest.mock('@/lib/db', () => ({
  getPool: () => ({
    query: (...a: unknown[]) => poolQuery(...a),
    connect: async () => ({ query: (...a: unknown[]) => poolQuery(...a), release }),
  }),
}));
jest.mock('@/lib/subscription/feature-access', () => ({
  assertReportAccess: jest.fn().mockResolvedValue(undefined),
  FeatureAccessDeniedError: class extends Error {},
}));
jest.mock('@/lib/security/require-operational-subscription', () => ({
  assertOperationalSubscription: jest.fn().mockResolvedValue({ ok: true }),
}));
jest.mock('@/lib/authorization', () => ({ authorize: jest.fn().mockResolvedValue(undefined), AuthorizationError: class extends Error {} }));
jest.mock('@/lib/gst/period-freshness', () => ({
  markGstReadinessStale: jest.fn().mockResolvedValue(undefined),
  markReturnReconciled: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/gst/gstr2b-reconciliation', () => ({
  GSTR2BReconciliationEngine: class {
    reconcile = (...a: unknown[]) => reconcile(...a);
    recordDecision = (...a: unknown[]) => recordDecision(...a);
    getEligibleITC = (...a: unknown[]) => getEligibleITC(...a);
    listMissingReferences = (...a: unknown[]) => listMissingReferences(...a);
  },
}));

import { GET as reconcileGet, POST as reconcilePost } from '@/app/api/gst/gstr2b/reconcile/route';
import { GET as decisionGet, POST as decisionPost } from '@/app/api/gst/gstr2b/decision/route';

const headers = { 'content-type': 'application/json', 'x-authenticated-user-id': 'user-1', 'x-authenticated-business-id': 'biz-session' };

const post = (path: string, body: Record<string, unknown>) =>
  new NextRequest(`http://localhost${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
const get = (path: string, query: Record<string, string>) =>
  new NextRequest(`http://localhost${path}?${new URLSearchParams(query)}`, { headers });

beforeEach(() => {
  jest.clearAllMocks();
  reconcile.mockResolvedValue({ matches: [], missing_references: [] });
  recordDecision.mockResolvedValue(undefined);
  getEligibleITC.mockResolvedValue(0);
  listMissingReferences.mockResolvedValue([]);
  poolQuery.mockImplementation(async (sql: string, params: unknown[]) =>
    sql.includes('SELECT 1 FROM gstr2b_reconciliation') && !(params[0] === 'r1' && params[1] === 'biz-session') ? { rows: [] } : sql.includes('SELECT 1 FROM gstr2b_reconciliation') ? { rows: [{ '?column?': 1 }] } : { rows: [] }
  );
});

describe('POST /api/gst/gstr2b/reconcile', () => {
  const url = '/api/gst/gstr2b/reconcile';
  test('no business_id: uses the session business', async () => {
    const res = await reconcilePost(post(url, { filing_period: '2026-11' }));
    expect(res.status).toBe(200);
    expect(reconcile).toHaveBeenCalledWith('biz-session', '2026-11');
  });
  test('a matching business_id still works', async () => {
    const res = await reconcilePost(post(url, { filing_period: '2026-11', business_id: 'biz-session' }));
    expect(res.status).toBe(200);
  });
  test('a mismatching business_id is 403 and nothing runs', async () => {
    const res = await reconcilePost(post(url, { filing_period: '2026-11', business_id: 'biz-other' }));
    expect(res.status).toBe(403);
    expect(reconcile).not.toHaveBeenCalled();
  });
  test('missing filing_period is 400', async () => {
    const res = await reconcilePost(post(url, {}));
    expect(res.status).toBe(400);
    expect(reconcile).not.toHaveBeenCalled();
  });
});

describe('GET /api/gst/gstr2b/reconcile', () => {
  const url = '/api/gst/gstr2b/reconcile';
  test('no business_id: queries the session business', async () => {
    const res = await reconcileGet(get(url, { filing_period: '2026-11' }));
    expect(res.status).toBe(200);
    const calls = poolQuery.mock.calls.filter((c) => Array.isArray(c[1]));
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c[1][0]).toBe('biz-session');
    expect(listMissingReferences.mock.calls[0][1]).toBe('biz-session');
  });
  test('a mismatching business_id is 403 and nothing is queried', async () => {
    const res = await reconcileGet(get(url, { filing_period: '2026-11', business_id: 'biz-other' }));
    expect(res.status).toBe(403);
    expect(poolQuery).not.toHaveBeenCalled();
  });
  test('missing filing_period is 400', async () => {
    const res = await reconcileGet(get(url, {}));
    expect(res.status).toBe(400);
    expect(poolQuery).not.toHaveBeenCalled();
  });
});

describe('POST /api/gst/gstr2b/decision', () => {
  const url = '/api/gst/gstr2b/decision';
  const ok = { reconciliation_id: 'r1', decision: 'ITC_ELIGIBLE_THIS_PERIOD' };
  test('no business_id: records the decision for the session business', async () => {
    const res = await decisionPost(post(url, ok));
    expect(res.status).toBe(200);
    expect(recordDecision).toHaveBeenCalledWith('biz-session', expect.objectContaining({ reconciliation_id: 'r1', decided_by_user_id: 'user-1' }));
    expect(poolQuery.mock.calls[0][1]).toEqual(['r1', 'biz-session']);
  });
  test('a mismatching business_id is 403 and nothing is written', async () => {
    const res = await decisionPost(post(url, { ...ok, business_id: 'biz-other' }));
    expect(res.status).toBe(403);
    expect(recordDecision).not.toHaveBeenCalled();
  });
  test('a reconciliation_id of another business is 404 and nothing is written', async () => {
    const res = await decisionPost(post(url, { reconciliation_id: 'r-foreign', decision: 'IGNORE' }));
    expect(res.status).toBe(404);
    expect(recordDecision).not.toHaveBeenCalled();
    expect(poolQuery.mock.calls[0][1]).toEqual(['r-foreign', 'biz-session']);
  });
  test('an owned reconciliation_id records the decision exactly once', async () => {
    const res = await decisionPost(post(url, ok));
    expect(res.status).toBe(200);
    expect(recordDecision).toHaveBeenCalledTimes(1);
  });
  test('missing decision is 400', async () => {
    const res = await decisionPost(post(url, { reconciliation_id: 'r1' }));
    expect(res.status).toBe(400);
    expect(recordDecision).not.toHaveBeenCalled();
  });
});

describe('GET /api/gst/gstr2b/decision (eligible ITC)', () => {
  const url = '/api/gst/gstr2b/decision';
  test('no business_id: uses the session business', async () => {
    const res = await decisionGet(get(url, { filing_period: '2026-11' }));
    expect(res.status).toBe(200);
    expect(getEligibleITC).toHaveBeenCalledWith('biz-session', '2026-11');
  });
  test('a mismatching business_id is 403', async () => {
    const res = await decisionGet(get(url, { filing_period: '2026-11', business_id: 'biz-other' }));
    expect(res.status).toBe(403);
    expect(getEligibleITC).not.toHaveBeenCalled();
  });
  test('missing filing_period is 400', async () => {
    const res = await decisionGet(get(url, {}));
    expect(res.status).toBe(400);
    expect(getEligibleITC).not.toHaveBeenCalled();
  });
});
