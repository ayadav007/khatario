/**
 * One Khatario Staff check-in or check-out: consume the challenge, score the evidence,
 * record attendance when it passes, and keep the evidence either way.
 */
import { query, queryOne } from '@/lib/db';
import { AttendancePunchError, recordCheckIn, recordCheckOut } from '@/lib/hr/attendance-punch';
import {
  evaluatePunchRisk,
  normalizeBssid,
  type DeviceSignals,
  type LocationSample,
  type RiskReason,
  type RiskResult,
  type WifiSighting,
} from '@/lib/hr/staff-app/risk';
import { LEGACY_SITE_ID, sitesForEmployee } from '@/lib/hr/staff-app/sites';
import type { StaffDevice } from '@/lib/hr/staff-app/device-auth';
import { StaffAuthError } from '@/lib/hr/staff-app/device-auth';
import { checkPunchFace, type PunchFaceCheck } from '@/lib/hr/staff-app/face/check';
import { parseLivenessChallenge, type LivenessChallenge } from '@/lib/hr/staff-app/face/liveness';
import { deletePunchPhotos, saveFacePhotos } from '@/lib/hr/staff-app/face/store';

export const CHALLENGE_TTL_MS = 2 * 60_000;
const MAX_SAMPLES = 20;
const MAX_WIFI = 60;

export type PunchBody = {
  nonce: string;
  action: 'check_in' | 'check_out';
  samples: LocationSample[];
  wifi: WifiSighting[];
  signals: DeviceSignals;
  client_time_ms: number;
  /** `{ liveness, photos }` when the challenge asked for a face check; checked in face/check.ts. */
  face: unknown;
};

function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v);
}

export function parsePunchBody(raw: unknown): PunchBody {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const action = b.action;
  if (action !== 'check_in' && action !== 'check_out') {
    throw new StaffAuthError('action must be check_in or check_out', 'BAD_REQUEST', 400);
  }
  const nonce = typeof b.nonce === 'string' ? b.nonce : '';
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(nonce)) {
    throw new StaffAuthError('Check-in code is missing. Try again.', 'CHALLENGE_INVALID', 400);
  }
  const samples: LocationSample[] = (Array.isArray(b.samples) ? b.samples : []).slice(0, MAX_SAMPLES).map((s) => {
    const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
    const altitude = o.altitude_m == null ? null : num(o.altitude_m);
    return {
      lat: num(o.lat),
      lng: num(o.lng),
      accuracy_m: Math.max(0, num(o.accuracy_m) || 0),
      altitude_m: altitude != null && Number.isFinite(altitude) ? altitude : null,
      timestamp_ms: num(o.timestamp_ms) || 0,
      // Anything other than an explicit false counts as mocked.
      is_mocked: o.is_mocked !== false,
    };
  });
  const wifi: WifiSighting[] = [];
  for (const w of (Array.isArray(b.wifi) ? b.wifi : []).slice(0, MAX_WIFI)) {
    const o = (w && typeof w === 'object' ? w : {}) as Record<string, unknown>;
    const bssid = normalizeBssid(String(o.bssid ?? ''));
    if (!bssid) continue;
    wifi.push({
      bssid,
      ssid: o.ssid == null ? null : String(o.ssid).slice(0, 64),
      rssi: Number.isFinite(num(o.rssi)) ? num(o.rssi) : null,
    });
  }
  const sig = (b.signals && typeof b.signals === 'object' ? b.signals : {}) as Record<string, unknown>;
  const signals: DeviceSignals = {
    rooted: sig.rooted === true,
    emulator: sig.emulator === true,
    developer_options: sig.developer_options === true,
    adb_enabled: sig.adb_enabled === true,
    hints: (Array.isArray(sig.hints) ? sig.hints : []).slice(0, 20).map((h) => String(h).slice(0, 40)),
  };
  return { nonce, action, samples, wifi, signals, client_time_ms: num(b.client_time_ms) || 0, face: b.face ?? null };
}

/** Single use: a second punch with the same challenge fails. Returns the face check it asked for, if any. */
export async function consumeChallenge(deviceId: string, nonce: string): Promise<LivenessChallenge | null> {
  const row = await queryOne<{ id: string; liveness: unknown }>(
    `UPDATE staff_app_challenges SET used_at = CURRENT_TIMESTAMP
     WHERE nonce = $1 AND device_id = $2 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
     RETURNING id, liveness`,
    [nonce, deviceId],
  );
  if (!row) {
    throw new StaffAuthError('Check-in code expired. Try again.', 'CHALLENGE_INVALID', 400);
  }
  return parseLivenessChallenge(row.liveness);
}

export type PunchOutcome = {
  decision: RiskResult['decision'];
  risk_score: number;
  reasons: Omit<RiskReason, 'points' | 'hard'>[];
  site: { id: string | null; name: string; distance_m: number | null } | null;
  wifi_matched: boolean;
  /** Whether a face check ran with this punch. */
  face_checked: boolean;
  attendance: unknown | null;
  punch_id: string;
};

export async function handleStaffPunch(device: StaffDevice, body: PunchBody, ipAddress: string | null): Promise<PunchOutcome> {
  const liveness = await consumeChallenge(device.device_id, body.nonce);
  let face: PunchFaceCheck | null = null;
  if (liveness) face = await checkPunchFace(device.employee_id, liveness, body.face);

  const [sites, last] = await Promise.all([
    sitesForEmployee(device.business_id, device.employee_id),
    queryOne<{ lat: string; lng: string; created_at: Date }>(
      `SELECT lat, lng, created_at FROM staff_attendance_punches
       WHERE employee_id = $1 AND decision = 'accepted' AND lat IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      [device.employee_id],
    ),
  ]);

  const risk = evaluatePunchRisk({
    samples: body.samples,
    wifi: body.wifi,
    signals: body.signals,
    client_time_ms: body.client_time_ms,
    server_now: new Date(),
    sites,
    last_punch: last ? { lat: Number(last.lat), lng: Number(last.lng), at: new Date(last.created_at) } : null,
    face: face?.evidence ?? null,
  });

  let decision = risk.decision;
  const reasons = [...risk.reasons];
  let attendance: { id: string } | null = null;

  if (decision !== 'rejected') {
    const params = {
      employeeId: device.employee_id,
      businessId: device.business_id,
      method: 'staff_app',
      lat: risk.position?.lat ?? null,
      lng: risk.position?.lng ?? null,
      deviceInfo: `staff_app:${device.device_id}`,
      ipAddress,
    };
    try {
      attendance = (await (body.action === 'check_in' ? recordCheckIn(params) : recordCheckOut(params))) as {
        id: string;
      };
    } catch (error) {
      if (!(error instanceof AttendancePunchError)) throw error;
      decision = 'rejected';
      reasons.push({ code: error.code.toLowerCase(), message: error.message, points: 0, hard: true });
    }
  }

  const siteId = risk.site && risk.site.id !== LEGACY_SITE_ID ? risk.site.id : null;
  const punch = await queryOne<{ id: string }>(
    `INSERT INTO staff_attendance_punches (
      business_id, employee_id, device_id, attendance_id, action, decision, risk_score, reasons,
      site_id, distance_m, lat, lng, accuracy_m, wifi_matched, samples, wifi, signals, ip_address,
      face_similarity, liveness_passed, face_photo_hashes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
    RETURNING id`,
    [
      device.business_id,
      device.employee_id,
      device.device_id,
      attendance?.id ?? null,
      body.action,
      decision,
      decision === 'rejected' ? Math.max(risk.score, 70) : risk.score,
      JSON.stringify(reasons),
      siteId,
      risk.distance_m,
      risk.position?.lat ?? null,
      risk.position?.lng ?? null,
      risk.position?.accuracy_m ?? null,
      risk.wifi_matched,
      JSON.stringify(body.samples),
      JSON.stringify(body.wifi),
      JSON.stringify(body.signals),
      ipAddress,
      face?.evidence.similarity ?? null,
      face ? face.evidence.liveness_problem === null : null,
      face ? face.photos.map((p) => p.sha256) : null,
    ],
  );
  // The manager reviewing this punch needs to see the face; the photos go once they decide.
  if (face && decision === 'review' && face.photos.length > 0) {
    await saveFacePhotos(device.business_id, device.employee_id, { punchId: punch!.id }, face.photos);
  }

  return {
    decision,
    risk_score: risk.score,
    reasons: reasons.map(({ code, message }) => ({ code, message })),
    site: risk.site ? { id: siteId, name: risk.site.name, distance_m: risk.distance_m } : null,
    wifi_matched: risk.wifi_matched,
    face_checked: face !== null,
    attendance,
    punch_id: punch!.id,
  };
}

/** Manager verdict on a punch that needed review. Rejecting undoes what the punch recorded. */
export async function resolvePunchReview(
  businessId: string,
  reviewerId: string,
  punchId: string,
  verdict: 'approved' | 'rejected',
): Promise<boolean> {
  const punch = await queryOne<{ id: string; action: string; attendance_id: string | null }>(
    `UPDATE staff_attendance_punches
     SET review_decision = $3, reviewed_by = $4, reviewed_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2 AND decision = 'review' AND review_decision IS NULL
     RETURNING id, action, attendance_id`,
    [punchId, businessId, verdict, reviewerId],
  );
  if (!punch) return false;
  await deletePunchPhotos(businessId, punch.id);
  if (verdict === 'rejected' && punch.attendance_id) {
    if (punch.action === 'check_in') {
      await query(
        `UPDATE employee_attendance
         SET status = 'absent', check_in_time = NULL, check_in_method = NULL, is_late = false, late_minutes = 0,
             notes = TRIM(BOTH ' ' FROM CONCAT(notes, ' Staff app check-in rejected by manager.')),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [punch.attendance_id],
      );
    } else {
      await query(
        `UPDATE employee_attendance
         SET check_out_time = NULL, check_out_method = NULL,
             notes = TRIM(BOTH ' ' FROM CONCAT(notes, ' Staff app check-out rejected by manager.')),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [punch.attendance_id],
      );
    }
  }
  return true;
}
