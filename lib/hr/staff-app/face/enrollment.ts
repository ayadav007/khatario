/**
 * Manager-supervised face enrollment:
 *  1. A manager opens an enrollment for the employee (owner side). Only they can start one,
 *     so a re-enrollment always needs the manager too.
 *  2. The employee's linked phone shows the consent text; on "I agree" it takes 3–5 angles and
 *     sends them signed. The server makes the templates and keeps the photos for the manager.
 *  3. The manager looks at the photos and approves (templates go live, any earlier ones are
 *     removed) or rejects. Photos are deleted either way.
 */
import { getPool, query, queryOne } from '@/lib/db';
import { StaffAuthError, type StaffDevice } from '@/lib/hr/staff-app/device-auth';
import { analyzePhotos } from '@/lib/hr/staff-app/face/check';
import { cosine, SFACE_SAME_PERSON } from '@/lib/hr/staff-app/face/match';
import { FACE_MODEL_ID } from '@/lib/hr/staff-app/face/models';
import {
  enrollmentPhotos,
  FACE_CONSENT_VERSION,
  parseFacePhotos,
  saveFacePhotos,
  type StoredPhoto,
} from '@/lib/hr/staff-app/face/store';

export const ENROLL_ANGLES = ['front', 'left', 'right', 'up', 'down'] as const;
export const MIN_ENROLL_ANGLES = 3;
/** How long the phone has to take the photos after the manager opens an enrollment. */
export const ENROLL_WINDOW_MS = 30 * 60_000;

export class FaceEnrollmentError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export type EnrollmentRow = {
  id: string;
  status: string;
  expires_at: Date;
  consent_version: string | null;
  consent_at: Date | null;
  captured_at: Date | null;
  quality: unknown;
  decided_at: Date | null;
  created_at: Date;
};

const COLUMNS = 'id, status, expires_at, consent_version, consent_at, captured_at, quality, decided_at, created_at';

async function expireStale(employeeId: string): Promise<void> {
  await query(
    `UPDATE employee_face_enrollments SET status = 'expired'
     WHERE employee_id = $1 AND status = 'open' AND expires_at <= CURRENT_TIMESTAMP`,
    [employeeId],
  );
}

/** Drops an unfinished enrollment (open or captured) with its templates and photos. */
async function cancelPending(businessId: string, employeeId: string, by: string): Promise<void> {
  const rows = await query<{ id: string }>(
    `UPDATE employee_face_enrollments SET status = 'cancelled', quality = NULL, decided_by = $3, decided_at = CURRENT_TIMESTAMP
     WHERE business_id = $1 AND employee_id = $2 AND status IN ('open', 'captured') RETURNING id`,
    [businessId, employeeId, by],
  );
  const ids = rows.rows.map((r) => r.id);
  if (ids.length) {
    await query('DELETE FROM employee_face_templates WHERE enrollment_id = ANY($1::uuid[])', [ids]);
    await query('DELETE FROM staff_face_photos WHERE enrollment_id = ANY($1::uuid[])', [ids]);
  }
}

export type FaceStatus = {
  enrolled: { since: Date; angles: number } | null;
  pending: (EnrollmentRow & { photos: StoredPhoto[] }) | null;
};

/** Owner view: the approved face (if any) and an enrollment in progress with its photos. */
export async function faceStatus(businessId: string, employeeId: string): Promise<FaceStatus> {
  await expireStale(employeeId);
  const active = await queryOne<{ decided_at: Date; angles: string }>(
    `SELECT e.decided_at, (SELECT COUNT(*) FROM employee_face_templates t WHERE t.enrollment_id = e.id) AS angles
     FROM employee_face_enrollments e WHERE e.business_id = $1 AND e.employee_id = $2 AND e.status = 'active'`,
    [businessId, employeeId],
  );
  const pending = await queryOne<EnrollmentRow>(
    `SELECT ${COLUMNS} FROM employee_face_enrollments
     WHERE business_id = $1 AND employee_id = $2 AND status IN ('open', 'captured')`,
    [businessId, employeeId],
  );
  return {
    enrolled: active ? { since: active.decided_at, angles: Number(active.angles) } : null,
    pending: pending
      ? { ...pending, photos: pending.status === 'captured' ? await enrollmentPhotos(businessId, pending.id) : [] }
      : null,
  };
}

/** Manager starts (or restarts) an enrollment. The employee needs a linked phone to finish it. */
export async function openEnrollment(businessId: string, employeeId: string, userId: string): Promise<EnrollmentRow> {
  const device = await queryOne(
    'SELECT 1 FROM staff_app_devices WHERE business_id = $1 AND employee_id = $2 AND revoked_at IS NULL',
    [businessId, employeeId],
  );
  if (!device) throw new FaceEnrollmentError('Link the Khatario Staff app on their phone first.');
  await cancelPending(businessId, employeeId, userId);
  const row = await queryOne<EnrollmentRow>(
    `INSERT INTO employee_face_enrollments (business_id, employee_id, opened_by, expires_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP + ($4 || ' milliseconds')::interval)
     RETURNING ${COLUMNS}`,
    [businessId, employeeId, userId, String(ENROLL_WINDOW_MS)],
  );
  return row!;
}

export async function cancelEnrollment(businessId: string, employeeId: string, userId: string): Promise<void> {
  await cancelPending(businessId, employeeId, userId);
}

/** Phone view: an enrollment waiting for this phone's photos, and whether a face is already approved. */
export async function phoneFaceStatus(device: StaffDevice): Promise<{
  enrolled: boolean;
  enrollment: { id: string; expires_at: Date; angles: readonly string[]; consent_version: string } | null;
  waiting_for_manager: boolean;
}> {
  await expireStale(device.employee_id);
  const rows = await query<{ id: string; status: string; expires_at: Date }>(
    `SELECT id, status, expires_at FROM employee_face_enrollments
     WHERE business_id = $1 AND employee_id = $2 AND status IN ('open', 'captured', 'active')`,
    [device.business_id, device.employee_id],
  );
  const open = rows.rows.find((r) => r.status === 'open');
  return {
    enrolled: rows.rows.some((r) => r.status === 'active'),
    enrollment: open
      ? { id: open.id, expires_at: open.expires_at, angles: ENROLL_ANGLES, consent_version: FACE_CONSENT_VERSION }
      : null,
    waiting_for_manager: rows.rows.some((r) => r.status === 'captured'),
  };
}

/** Body: `{ enrollment_id, consent: { version, accepted }, photos: [{ label: angle, jpeg }] }`. */
export async function captureEnrollment(device: StaffDevice, raw: unknown): Promise<{ angles: string[] }> {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const consent = (b.consent && typeof b.consent === 'object' ? b.consent : {}) as Record<string, unknown>;
  if (consent.accepted !== true || consent.version !== FACE_CONSENT_VERSION) {
    throw new StaffAuthError('Please read and agree to the face check terms first.', 'CONSENT_REQUIRED', 400);
  }
  const photos = parseFacePhotos(b.photos, ENROLL_ANGLES, ENROLL_ANGLES.length);
  const labels = photos.map((p) => p.label);
  if (new Set(labels).size !== labels.length || !labels.includes('front') || labels.length < MIN_ENROLL_ANGLES) {
    throw new StaffAuthError(`Take at least ${MIN_ENROLL_ANGLES} different angles, including straight on.`, 'BAD_REQUEST', 400);
  }

  const enrollment = await queryOne<{ id: string }>(
    `SELECT id FROM employee_face_enrollments
     WHERE id = $1 AND business_id = $2 AND employee_id = $3 AND status = 'open' AND expires_at > CURRENT_TIMESTAMP`,
    [String(b.enrollment_id ?? ''), device.business_id, device.employee_id],
  );
  if (!enrollment) {
    throw new StaffAuthError('Face setup has expired. Ask your manager to start it again.', 'ENROLLMENT_CLOSED', 400);
  }

  const { results, engineAvailable } = await analyzePhotos(photos);
  if (!engineAvailable) {
    throw new StaffAuthError('Face setup is not available right now. Try again later.', 'FACE_UNAVAILABLE', 503);
  }
  for (const r of results) {
    if (!r.analysis?.embedding || r.analysis.faces !== 1) {
      throw new StaffAuthError(
        `Your face was not clear in the "${r.label}" photo. Use good light, one face only, and try again.`,
        'FACE_NOT_CLEAR',
        400,
      );
    }
  }
  const front = results.find((r) => r.label === 'front')!.analysis!.embedding!;
  const similarities = results.filter((r) => r.label !== 'front').map((r) => cosine(front, r.analysis!.embedding!));
  const minSimilarity = Math.min(...similarities);
  if (minSimilarity < SFACE_SAME_PERSON) {
    throw new StaffAuthError('The photos do not look like the same person. Try again.', 'FACE_INCONSISTENT', 400);
  }

  const quality = {
    min_similarity: Math.round(minSimilarity * 1000) / 1000,
    angles: Object.fromEntries(results.map((r) => [r.label, { score: Math.round(r.analysis!.face!.score * 1000) / 1000 }])),
    model: FACE_MODEL_ID,
  };
  const claimed = await queryOne(
    `UPDATE employee_face_enrollments
     SET status = 'captured', device_id = $2, consent_version = $3, consent_at = CURRENT_TIMESTAMP,
         captured_at = CURRENT_TIMESTAMP, quality = $4
     WHERE id = $1 AND status = 'open' RETURNING id`,
    [enrollment.id, device.device_id, FACE_CONSENT_VERSION, JSON.stringify(quality)],
  );
  if (!claimed) throw new StaffAuthError('Face setup has expired. Ask your manager to start it again.', 'ENROLLMENT_CLOSED', 400);
  for (const r of results) {
    await query(
      `INSERT INTO employee_face_templates (business_id, employee_id, enrollment_id, angle, model, embedding, detector_score)
       VALUES ($1, $2, $3, $4, $5, $6::real[], $7)`,
      [
        device.business_id,
        device.employee_id,
        enrollment.id,
        r.label,
        FACE_MODEL_ID,
        Array.from(r.analysis!.embedding!),
        r.analysis!.face!.score,
      ],
    );
  }
  await saveFacePhotos(device.business_id, device.employee_id, { enrollmentId: enrollment.id }, photos);
  return { angles: labels };
}

/** Manager's verdict on captured photos. Approving replaces any earlier face. */
export async function decideEnrollment(
  businessId: string,
  employeeId: string,
  userId: string,
  enrollmentId: string,
  approve: boolean,
): Promise<boolean> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const row = await client.query(
      `SELECT id FROM employee_face_enrollments
       WHERE id = $1 AND business_id = $2 AND employee_id = $3 AND status = 'captured' FOR UPDATE`,
      [enrollmentId, businessId, employeeId],
    );
    if (row.rowCount === 0) {
      await client.query('ROLLBACK');
      return false;
    }
    if (approve) {
      const old = await client.query<{ id: string }>(
        `UPDATE employee_face_enrollments SET status = 'replaced', decided_at = CURRENT_TIMESTAMP
         WHERE business_id = $1 AND employee_id = $2 AND status = 'active' RETURNING id`,
        [businessId, employeeId],
      );
      if (old.rowCount) {
        await client.query('DELETE FROM employee_face_templates WHERE enrollment_id = ANY($1::uuid[])', [
          old.rows.map((r) => r.id),
        ]);
      }
    } else {
      await client.query('DELETE FROM employee_face_templates WHERE enrollment_id = $1', [enrollmentId]);
    }
    await client.query(
      `UPDATE employee_face_enrollments SET status = $2, decided_by = $3, decided_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [enrollmentId, approve ? 'active' : 'rejected', userId],
    );
    await client.query('DELETE FROM staff_face_photos WHERE enrollment_id = $1', [enrollmentId]);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
