/**
 * Khatario Staff punch: the phone's signature decides whose punch it is. Business and employee
 * come from the device row, never the body; a challenge works once; a changed body fails.
 */
import { generateKeyPairSync, sign } from 'crypto';

const mockQueryOne = jest.fn();
jest.mock('@/lib/db', () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
  queryRows: jest.fn().mockResolvedValue([]),
  queryOne: (...a: unknown[]) => mockQueryOne(...a),
}));
jest.mock('@/lib/subscription/feature-access', () => {
  class FeatureAccessDeniedError extends Error {}
  return { assertFeatureAccess: jest.fn().mockResolvedValue(undefined), FeatureAccessDeniedError };
});
const mockSites = jest.fn();
jest.mock('@/lib/hr/staff-app/sites', () => ({
  LEGACY_SITE_ID: 'policy-geofence',
  sitesForEmployee: (...a: unknown[]) => mockSites(...a),
}));
const mockCheckIn = jest.fn();
jest.mock('@/lib/hr/attendance-punch', () => {
  class AttendancePunchError extends Error {
    constructor(message: string, readonly code: string, readonly status = 400) {
      super(message);
    }
  }
  return { AttendancePunchError, recordCheckIn: (...a: unknown[]) => mockCheckIn(...a), recordCheckOut: jest.fn() };
});

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/staff-app/punch/route';
import { canonicalRequest } from '@/lib/hr/staff-app/device-auth';

const DEVICE = '11111111-1111-4111-8111-111111111111';
const EMP = '22222222-2222-4222-8222-222222222222';
const BIZ = '33333333-3333-4333-8333-333333333333';
const OTHER_BIZ = '44444444-4444-4444-8444-444444444444';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const SPKI = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');

const now = Date.now();
const evidence = {
  nonce: 'n'.repeat(32),
  action: 'check_in',
  samples: [0, 1, 2, 3, 4].map((i) => ({
    lat: 28.6139 + i * 0.000004,
    lng: 77.209 + i * 0.000003,
    accuracy_m: 8 + i,
    altitude_m: 216,
    timestamp_ms: now - 8000 + i * 1500,
    is_mocked: false,
  })),
  wifi: [],
  signals: { rooted: false, emulator: false, developer_options: false, adb_enabled: false },
  client_time_ms: now,
  // A client trying to punch for someone else:
  business_id: OTHER_BIZ,
  employee_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
};

function signedPost(body: object, opts: { tamper?: boolean; skipSignature?: boolean } = {}) {
  const raw = JSON.stringify(body);
  const ts = String(Date.now());
  const signature = sign('sha256', Buffer.from(canonicalRequest('POST', '/api/staff-app/punch', ts, raw)), privateKey).toString('base64');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (!opts.skipSignature) {
    headers['x-staff-device'] = DEVICE;
    headers['x-staff-timestamp'] = ts;
    headers['x-staff-signature'] = signature;
  }
  const sent = opts.tamper ? raw.replace('"check_in"', '"check_out"') : raw;
  return POST(new NextRequest('http://localhost/api/staff-app/punch', { method: 'POST', headers, body: sent }));
}

let challengeOk = true;
let revoked = false;

beforeEach(() => {
  challengeOk = true;
  revoked = false;
  mockQueryOne.mockReset().mockImplementation(async (sql: string) => {
    if (sql.includes('FROM staff_app_devices d')) {
      return {
        device_id: DEVICE,
        employee_id: EMP,
        business_id: BIZ,
        public_key: SPKI,
        revoked_at: revoked ? new Date() : null,
        active: true,
        employee_name: 'Asha',
        employee_code: 'E1',
        business_name: 'Shop',
      };
    }
    if (sql.includes('UPDATE staff_app_challenges')) return challengeOk ? { id: 'c1' } : null;
    if (sql.includes('INSERT INTO staff_attendance_punches')) return { id: 'p1' };
    return null;
  });
  mockSites.mockReset().mockResolvedValue([
    { id: 'site-1', name: 'Main shop', lat: 28.6139, lng: 77.209, radius_m: 150, require_wifi: false, bssids: [] },
  ]);
  mockCheckIn.mockReset().mockResolvedValue({ id: 'att-1' });
});

it('records the punch for the device owner, ignoring body business_id / employee_id', async () => {
  const res = await signedPost(evidence);
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.decision).toBe('accepted');
  expect(mockSites).toHaveBeenCalledWith(BIZ, EMP);
  expect(mockCheckIn).toHaveBeenCalledWith(
    expect.objectContaining({ employeeId: EMP, businessId: BIZ, method: 'staff_app' }),
  );
  const insert = mockQueryOne.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO staff_attendance_punches'))!;
  expect(insert[1].slice(0, 3)).toEqual([BIZ, EMP, DEVICE]);
});

it('refuses an unsigned request', async () => {
  const res = await signedPost(evidence, { skipSignature: true });
  expect(res.status).toBe(401);
  expect((await res.json()).code).toBe('STAFF_UNSIGNED');
  expect(mockCheckIn).not.toHaveBeenCalled();
});

it('refuses a body changed after signing', async () => {
  const res = await signedPost(evidence, { tamper: true });
  expect(res.status).toBe(401);
  expect((await res.json()).code).toBe('BAD_SIGNATURE');
  expect(mockCheckIn).not.toHaveBeenCalled();
});

it('refuses an unlinked phone', async () => {
  revoked = true;
  const res = await signedPost(evidence);
  expect(res.status).toBe(401);
  expect((await res.json()).code).toBe('DEVICE_REVOKED');
});

it('refuses a used or expired challenge', async () => {
  challengeOk = false;
  const res = await signedPost(evidence);
  expect(res.status).toBe(400);
  expect((await res.json()).code).toBe('CHALLENGE_INVALID');
  expect(mockCheckIn).not.toHaveBeenCalled();
});

it('scores a mocked location as rejected and records nothing', async () => {
  const mocked = { ...evidence, samples: evidence.samples.map((s) => ({ ...s, is_mocked: true })) };
  const res = await signedPost(mocked);
  const json = await res.json();
  expect(json.decision).toBe('rejected');
  expect(json.reasons.map((r: { code: string }) => r.code)).toContain('mock_location');
  expect(mockCheckIn).not.toHaveBeenCalled();
});

it('treats a sample without an explicit is_mocked=false as mocked', async () => {
  const unknown = { ...evidence, samples: evidence.samples.map(({ is_mocked: _m, ...s }) => s) };
  const json = await (await signedPost(unknown)).json();
  expect(json.decision).toBe('rejected');
});
