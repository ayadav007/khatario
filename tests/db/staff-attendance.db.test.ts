/**
 * Khatario Staff end to end on a real database (migrations 383 + 384): owner makes a pairing code,
 * the phone links with its key, check-in is signed and scored, office Wi-Fi is suggested from
 * accepted check-ins, a manager rejects a doubtful one, and the face check is enrolled, approved,
 * matched and purged. The ONNX engine is replaced by a stand-in here (its own tests cover it).
 * Opt-in, disposable DB only:
 *   STAFF_DB_TEST=1 npx jest tests/db/staff-attendance.db.test.ts --runInBand
 * (or set PHASE2_TEST_DATABASE_URL). Connection details come from .env with the database forced
 * to kh_phase2_test; migrations 383 and 384 must be applied there.
 */
import { generateKeyPairSync, randomUUID, sign } from 'crypto';
import { config as loadEnv } from 'dotenv';

const TEST_DB = 'kh_phase2_test';
const enabled = !!process.env.PHASE2_TEST_DATABASE_URL || process.env.STAFF_DB_TEST === '1';
if (process.env.PHASE2_TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.PHASE2_TEST_DATABASE_URL;
} else if (enabled) {
  const env: Record<string, string> = {};
  loadEnv({ path: '.env', processEnv: env });
  const auth = `${encodeURIComponent(env.DB_USER || 'postgres')}:${encodeURIComponent(env.DB_PASSWORD || '')}`;
  process.env.DATABASE_URL = `postgresql://${auth}@localhost:${env.DB_PORT || '5432'}/${TEST_DB}`;
  process.env.DB_SSL = 'false';
}

// Subscription setup is covered elsewhere; here every business has attendance.
jest.mock('@/lib/subscription/feature-access', () => {
  class FeatureAccessDeniedError extends Error {}
  return { assertFeatureAccess: jest.fn().mockResolvedValue(undefined), FeatureAccessDeniedError };
});
const mockAuthorize = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/authorization', () => {
  class AuthorizationError extends Error {}
  return { authorize: (...a: unknown[]) => mockAuthorize(...a), AuthorizationError };
});

/**
 * Stand-in face engine: a fake JPEG's 4th byte is the person (0 = no face), its 5th the head turn
 * (×100), the rest makes each photo unique. The same person always gets nearly the same template.
 */
jest.mock('@/lib/hr/staff-app/face/engine', () => {
  const actual = jest.requireActual('@/lib/hr/staff-app/face/engine');
  return {
    ...actual,
    analyzeFacePhoto: async (jpeg: Buffer) => {
      const person = jpeg[3];
      if (person === 0) return { faces: 0, face: null, embedding: null, yaw: null };
      let seed = person * 7919;
      const v = Array.from({ length: 128 }, (_, i) => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648 - 0.5 + ((jpeg[6 + (i % 50)] % 7) - 3) * 0.004;
      });
      const n = Math.hypot(...v);
      return {
        faces: 1,
        face: { box: { x: 0, y: 0, w: 120, h: 150 }, landmarks: [], score: 0.93 },
        embedding: Float32Array.from(v.map((x) => x / n)),
        yaw: jpeg[4] / 100,
      };
    },
  };
});

import { NextRequest } from 'next/server';
import { closePool, query, queryOne } from '@/lib/db';
import { canonicalRequest } from '@/lib/hr/staff-app/device-auth';
import { createSite, setEmployeeSites, sitesForEmployee, wifiSuggestions } from '@/lib/hr/staff-app/sites';
import { POST as pairPOST } from '@/app/api/staff-app/pair/route';
import { POST as challengePOST } from '@/app/api/staff-app/challenge/route';
import { POST as punchPOST } from '@/app/api/staff-app/punch/route';
import { POST as codePOST } from '@/app/api/employees/[id]/staff-app/route';
import { GET as reviewGET, POST as reviewPOST } from '@/app/api/employees/attendance/reviews/route';
import { GET as faceGET, POST as facePOST } from '@/app/api/employees/[id]/staff-app/face/route';
import { POST as enrollPOST } from '@/app/api/staff-app/face/enroll/route';
import { GET as statusGET } from '@/app/api/staff-app/status/route';

const run = enabled ? describe : describe.skip;

run('Khatario Staff (kh_phase2_test)', () => {
  jest.setTimeout(60000);

  const B = randomUUID();
  const OWNER = randomUUID();
  const EMP = randomUUID();
  const tag = B.slice(0, 6);
  const OFFICE = { lat: 28.6139, lng: 77.209 };
  const ROUTER = 'a4:2b:b0:11:22:33';
  const ownerHeaders = { 'x-authenticated-user-id': OWNER, 'x-authenticated-business-id': B };

  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const SPKI = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  let deviceId = '';
  let siteId = '';

  /** A request signed by the phone's key; `null` body = GET. */
  function signed(path: string, body: object | null) {
    const raw = body == null ? '' : JSON.stringify(body);
    const method = body == null ? 'GET' : 'POST';
    const ts = String(Date.now());
    const sig = sign('sha256', Buffer.from(canonicalRequest(method, path, ts, raw)), privateKey).toString('base64');
    return new NextRequest(`http://localhost${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-staff-device': deviceId, 'x-staff-timestamp': ts, 'x-staff-signature': sig },
      body: body == null ? undefined : raw,
    });
  }

  function samples(lat: number, lng: number, wobble = true) {
    const now = Date.now();
    return [0, 1, 2, 3, 4].map((i) => ({
      lat: lat + (wobble ? i * 0.000004 : 0),
      lng: lng + (wobble ? i * 0.000003 : 0),
      accuracy_m: wobble ? 8 + i : 3,
      altitude_m: 216 + i,
      timestamp_ms: now - 8000 + i * 1500,
      is_mocked: false,
    }));
  }

  async function punch(action: string, s: object[], wifi: object[] = []) {
    const ch = await (await challengePOST(signed('/api/staff-app/challenge', {}))).json();
    expect(ch.nonce).toBeTruthy();
    const res = await punchPOST(
      signed('/api/staff-app/punch', {
        nonce: ch.nonce,
        action,
        samples: s,
        wifi,
        signals: { rooted: false, emulator: false, developer_options: false, adb_enabled: false },
        client_time_ms: Date.now(),
      }),
    );
    return { status: res.status, json: await res.json(), nonce: ch.nonce as string };
  }

  beforeAll(async () => {
    await query(`INSERT INTO businesses (id, name) VALUES ($1, $2)`, [B, `Staff test ${tag}`]);
    await query(`INSERT INTO users (id, business_id, name, phone) VALUES ($1, $2, 'Owner', $3)`, [OWNER, B, `90${tag}01`]);
    await query(`INSERT INTO users (id, business_id, name, phone) VALUES ($1, $2, 'Asha', $3)`, [EMP, B, `90${tag}02`]);
    await query(`INSERT INTO employees (id, business_id, employee_code) VALUES ($1, $2, $3)`, [EMP, B, `E-${tag}`]);
  });

  afterAll(async () => {
    await query('DELETE FROM employee_attendance WHERE employee_id = $1', [EMP]);
    await query('DELETE FROM employees WHERE id = $1', [EMP]);
    await query('DELETE FROM attendance_sites WHERE business_id = $1', [B]);
    await query('DELETE FROM users WHERE business_id = $1', [B]);
    await query('DELETE FROM businesses WHERE id = $1', [B]);
    await closePool();
  });

  it('owner adds a site; the employee may use it', async () => {
    const site = await createSite(B, OWNER, { name: 'Main shop', ...OFFICE, radius_m: 150, require_wifi: false, wifi: [] });
    siteId = site.id;
    expect((await sitesForEmployee(B, EMP)).map((s) => s.id)).toEqual([siteId]);
    // Assigning a site that is not this business's is ignored.
    expect(await setEmployeeSites(B, EMP, [siteId, randomUUID()])).toEqual([siteId]);
  });

  it('a pairing code links the phone once', async () => {
    const codeRes = await codePOST(
      new NextRequest(`http://localhost/api/employees/${EMP}/staff-app`, { method: 'POST', headers: ownerHeaders }),
      { params: { id: EMP } },
    );
    expect(codeRes.status).toBe(200);
    const { code, qr } = await codeRes.json();
    expect(qr).toMatch(/^KHSTAFF1:[A-Z0-9]{10}$/);

    const pair = (c: string) =>
      pairPOST(
        new NextRequest('http://localhost/api/staff-app/pair', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.${tag.length}.1` },
          body: JSON.stringify({ code: c, public_key: SPKI, hardware_backed: true, device: { model: 'Test phone' } }),
        }),
      );
    const first = await pair(code);
    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.employee.name).toBe('Asha');
    deviceId = body.device_id;

    const again = await pair(code);
    expect(again.status).toBe(400);
  });

  it('a check-in at the office is accepted and recorded; the challenge cannot be replayed', async () => {
    const r = await punch('check_in', samples(OFFICE.lat, OFFICE.lng), [{ bssid: ROUTER, ssid: 'ShopWiFi' }]);
    expect(r.status).toBe(200);
    expect(r.json.decision).toBe('accepted');
    const att = await queryOne('SELECT check_in_method FROM employee_attendance WHERE employee_id = $1', [EMP]);
    expect(att?.check_in_method).toBe('staff_app');

    const replay = await punchPOST(
      signed('/api/staff-app/punch', {
        nonce: r.nonce,
        action: 'check_out',
        samples: samples(OFFICE.lat, OFFICE.lng),
        wifi: [],
        signals: {},
        client_time_ms: Date.now(),
      }),
    );
    expect(replay.status).toBe(400);
  });

  it('routers seen at accepted check-ins are suggested to the owner', async () => {
    const s = await wifiSuggestions(B, siteId);
    expect(s).toEqual([expect.objectContaining({ bssid: ROUTER, ssid: 'ShopWiFi', employees: 1 })]);
  });

  it('a frozen-GPS check-out goes to review, and rejecting it clears the check-out', async () => {
    const r = await punch('check_out', samples(OFFICE.lat, OFFICE.lng, false));
    expect(r.json.decision).toBe('review');
    const done = await queryOne('SELECT check_out_time FROM employee_attendance WHERE employee_id = $1', [EMP]);
    expect(done?.check_out_time).not.toBeNull();

    const pending = await queryOne<{ id: string }>(
      `SELECT id FROM staff_attendance_punches WHERE employee_id = $1 AND decision = 'review'`,
      [EMP],
    );
    const res = await reviewPOST(
      new NextRequest('http://localhost/api/employees/attendance/reviews', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...ownerHeaders },
        body: JSON.stringify({ punch_id: pending!.id, decision: 'rejected' }),
      }),
    );
    expect(res.status).toBe(200);
    const after = await queryOne('SELECT check_out_time FROM employee_attendance WHERE employee_id = $1', [EMP]);
    expect(after?.check_out_time).toBeNull();
  });

  it('a check-out from far away is rejected and leaves attendance alone', async () => {
    const r = await punch('check_out', samples(28.7, 77.3));
    expect(r.json.decision).toBe('rejected');
    expect(r.json.reasons.map((x: { code: string }) => x.code)).toContain('outside_site');
    const after = await queryOne('SELECT check_out_time FROM employee_attendance WHERE employee_id = $1', [EMP]);
    expect(after?.check_out_time).toBeNull();
  });

  describe('face check', () => {
    let photoCounter = 0;
    /** A fake JPEG of `person` (0 = no face), head turned by `yaw`. Every call is a new photo. */
    function photo(person: number, yaw = 0): string {
      photoCounter++;
      const buf = Buffer.alloc(700);
      buf.set([0xff, 0xd8, 0xff, person, Math.round(yaw * 100), 0]);
      for (let i = 6; i < buf.length; i++) buf[i] = (photoCounter * 31 + i * 17) % 256;
      return buf.toString('base64');
    }
    const ownerFace = (method: 'GET' | 'POST', body?: object) => {
      const req = new NextRequest(`http://localhost/api/employees/${EMP}/staff-app/face`, {
        method,
        headers: { 'content-type': 'application/json', ...ownerHeaders },
        body: body ? JSON.stringify(body) : undefined,
      });
      return (method === 'GET' ? faceGET : facePOST)(req, { params: { id: EMP } });
    };
    const live = (steps: string[], over: object = {}) => ({
      steps,
      completed: steps,
      passed: true,
      duration_ms: 5200,
      frames: 70,
      face_changes: 0,
      ...over,
    });
    const shots = (person: number, steps: string[]) => [
      { label: 'start', jpeg: photo(person, 0.03) },
      { label: steps.find((s) => s.startsWith('turn_'))!, jpeg: photo(person, 0.45) },
      { label: 'end', jpeg: photo(person, 0.02) },
    ];
    const codesOf = (json: { reasons: { code: string }[] }) => json.reasons.map((x) => x.code);

    async function facePunch(action: string, faceFor: (steps: string[]) => object) {
      const ch = await (await challengePOST(signed('/api/staff-app/challenge', {}))).json();
      expect(ch.face?.steps).toHaveLength(3);
      const res = await punchPOST(
        signed('/api/staff-app/punch', {
          nonce: ch.nonce,
          action,
          samples: samples(OFFICE.lat, OFFICE.lng),
          wifi: [{ bssid: ROUTER }],
          signals: { rooted: false, emulator: false, developer_options: false, adb_enabled: false },
          client_time_ms: Date.now(),
          face: faceFor(ch.face.steps),
        }),
      );
      return { status: res.status, json: await res.json() };
    }

    it('no face check is asked for before the manager sets it up', async () => {
      const ch = await (await challengePOST(signed('/api/staff-app/challenge', {}))).json();
      expect(ch.face).toBeNull();
    });

    it('manager opens setup; the phone must agree to the terms, then sends the angles', async () => {
      const opened = await (await ownerFace('POST', { action: 'open' })).json();
      expect(opened.pending.status).toBe('open');

      const status = await (await statusGET(signed('/api/staff-app/status', null))).json();
      expect(status.face.enrollment.id).toBe(opened.pending.id);
      expect(status.face.enrolled).toBe(false);

      const angles = [
        { label: 'front', jpeg: photo(1) },
        { label: 'left', jpeg: photo(1, 0.4) },
        { label: 'right', jpeg: photo(1, 0.4) },
      ];
      const enroll = (body: object) =>
        enrollPOST(signed('/api/staff-app/face/enroll', { enrollment_id: opened.pending.id, ...body }));
      const consent = { version: '2026-10', accepted: true };

      const noConsent = await enroll({ photos: angles });
      expect(noConsent.status).toBe(400);
      expect((await noConsent.json()).code).toBe('CONSENT_REQUIRED');

      const mixed = await enroll({ consent, photos: [angles[0], { label: 'left', jpeg: photo(2) }, angles[2]] });
      expect((await mixed.json()).code).toBe('FACE_INCONSISTENT');

      const ok = await enroll({ consent, photos: angles });
      expect(ok.status).toBe(200);

      // Not live until the manager approves.
      const ch = await (await challengePOST(signed('/api/staff-app/challenge', {}))).json();
      expect(ch.face).toBeNull();
    });

    it('manager sees the photos and approves; the photos are then deleted', async () => {
      const view = await (await ownerFace('GET')).json();
      expect(view.pending.status).toBe('captured');
      expect(view.pending.photos.map((p: { label: string }) => p.label)).toEqual(['front', 'left', 'right']);
      expect(view.pending.photos[0].data_url).toMatch(/^data:image\/jpeg;base64,/);

      const approved = await (await ownerFace('POST', { action: 'approve', enrollment_id: view.pending.id })).json();
      expect(approved.enrolled.angles).toBe(3);
      expect(approved.pending).toBeNull();
      const photos = await queryOne<{ n: string }>('SELECT COUNT(*) AS n FROM staff_face_photos WHERE employee_id = $1', [EMP]);
      expect(Number(photos!.n)).toBe(0);
    });

    it('someone else at the phone goes to review with their photos; rejecting deletes the photos', async () => {
      const r = await facePunch('check_out', (steps) => ({ liveness: live(steps), photos: shots(2, steps) }));
      expect(r.json.decision).toBe('review');
      expect(r.json.face_checked).toBe(true);
      expect(codesOf(r.json)).toContain('face_mismatch');

      const list = await (
        await reviewGET(new NextRequest('http://localhost/api/employees/attendance/reviews', { headers: ownerHeaders }))
      ).json();
      const review = list.reviews.find((x: { id: string }) => x.id === r.json.punch_id);
      expect(review.photos).toHaveLength(3);
      expect(review.face_similarity).toBeLessThan(0.4);

      const res = await reviewPOST(
        new NextRequest('http://localhost/api/employees/attendance/reviews', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...ownerHeaders },
          body: JSON.stringify({ punch_id: review.id, decision: 'rejected' }),
        }),
      );
      expect(res.status).toBe(200);
      const left = await queryOne<{ n: string }>('SELECT COUNT(*) AS n FROM staff_face_photos WHERE punch_id = $1', [review.id]);
      expect(Number(left!.n)).toBe(0);
    });

    it('failed liveness and an unseen face are rejected outright', async () => {
      const wrongOrder = await facePunch('check_out', (steps) => ({
        liveness: live(steps, { completed: [...steps].reverse() }),
        photos: shots(1, steps),
      }));
      expect(wrongOrder.json.decision).toBe('rejected');
      expect(codesOf(wrongOrder.json)).toContain('liveness_failed');

      const dark = await facePunch('check_out', (steps) => ({ liveness: live(steps), photos: shots(0, steps) }));
      expect(dark.json.decision).toBe('rejected');
      expect(codesOf(dark.json)).toContain('face_missing');
    });

    it('the employee is accepted, and the same photos cannot be sent again', async () => {
      let sent: object[] = [];
      const ok = await facePunch('check_out', (steps) => {
        sent = shots(1, steps);
        return { liveness: live(steps), photos: sent };
      });
      expect(ok.json.decision).toBe('accepted');
      const row = await queryOne<{ face_similarity: number; liveness_passed: boolean }>(
        'SELECT face_similarity, liveness_passed FROM staff_attendance_punches WHERE id = $1',
        [ok.json.punch_id],
      );
      expect(row!.face_similarity).toBeGreaterThan(0.9);
      expect(row!.liveness_passed).toBe(true);

      const replay = await facePunch('check_out', (steps) => ({ liveness: live(steps), photos: sent }));
      expect(codesOf(replay.json)).toContain('photo_replay');
    });

    it('when the employee leaves, their face data is deleted', async () => {
      await query('UPDATE employees SET is_active = false WHERE id = $1', [EMP]);
      const t = await queryOne<{ n: string }>('SELECT COUNT(*) AS n FROM employee_face_templates WHERE employee_id = $1', [EMP]);
      expect(Number(t!.n)).toBe(0);
      const e = await queryOne<{ status: string }>(
        'SELECT status FROM employee_face_enrollments WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 1',
        [EMP],
      );
      expect(e!.status).toBe('deleted');
    });
  });
});
