/**
 * Face data in the database (migration 384): enrolled templates, short-lived photos for a
 * manager, and deleting all of it. Every query is scoped by employee and business taken from the
 * device row or the owner's session.
 */
import { createHash } from 'crypto';
import { query, queryOne, queryRows } from '@/lib/db';
import { MAX_PHOTO_BYTES } from '@/lib/hr/staff-app/face/engine';
import { StaffAuthError } from '@/lib/hr/staff-app/device-auth';

/** Bump when the consent text in the app (faceConsentText in phone/lib/staff/face/face_capture.dart) changes. */
export const FACE_CONSENT_VERSION = '2026-10';
/** Photos a manager has not looked at are deleted after this. */
export const FACE_PHOTO_KEEP_MS = 14 * 24 * 3_600_000;

export type FacePhoto = { label: string; jpeg: Buffer; sha256: string };

/** `[{ label, jpeg: base64 }]` from the phone → decoded photos. Unknown labels and oversized photos are refused. */
export function parseFacePhotos(raw: unknown, labels: readonly string[], max: number): FacePhoto[] {
  const list = Array.isArray(raw) ? raw : [];
  if (list.length > max) throw new StaffAuthError('Too many photos.', 'BAD_REQUEST', 400);
  return list.map((p) => {
    const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
    const label = String(o.label ?? '');
    const b64 = typeof o.jpeg === 'string' ? o.jpeg : '';
    if (!labels.includes(label) || !/^[A-Za-z0-9+/=]+$/.test(b64)) {
      throw new StaffAuthError('A face photo was not readable. Try again.', 'BAD_REQUEST', 400);
    }
    const jpeg = Buffer.from(b64, 'base64');
    if (jpeg.length < 500 || jpeg.length > MAX_PHOTO_BYTES || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
      throw new StaffAuthError('A face photo was not readable. Try again.', 'BAD_REQUEST', 400);
    }
    return { label, jpeg, sha256: createHash('sha256').update(jpeg).digest('hex') };
  });
}

/** The employee's templates from their approved enrollment. Empty = no face check for them. */
export async function activeTemplates(employeeId: string): Promise<number[][]> {
  const rows = await queryRows<{ embedding: number[] }>(
    `SELECT t.embedding FROM employee_face_templates t
     JOIN employee_face_enrollments e ON e.id = t.enrollment_id AND e.status = 'active'
     WHERE t.employee_id = $1`,
    [employeeId],
  );
  return rows.map((r) => r.embedding.map(Number));
}

export async function hasActiveFace(employeeId: string): Promise<boolean> {
  const row = await queryOne(
    `SELECT 1 FROM employee_face_enrollments WHERE employee_id = $1 AND status = 'active'`,
    [employeeId],
  );
  return !!row;
}

/** True when any of these exact photos came with an earlier punch by this employee. */
export async function photosSeenBefore(employeeId: string, hashes: string[]): Promise<boolean> {
  if (hashes.length === 0) return false;
  const row = await queryOne(
    `SELECT 1 FROM staff_attendance_punches
     WHERE employee_id = $1 AND face_photo_hashes && $2::text[] LIMIT 1`,
    [employeeId, hashes],
  );
  return !!row;
}

export async function saveFacePhotos(
  businessId: string,
  employeeId: string,
  owner: { punchId: string } | { enrollmentId: string },
  photos: FacePhoto[],
): Promise<void> {
  const punchId = 'punchId' in owner ? owner.punchId : null;
  const enrollmentId = 'enrollmentId' in owner ? owner.enrollmentId : null;
  for (const p of photos) {
    await query(
      `INSERT INTO staff_face_photos (business_id, employee_id, enrollment_id, punch_id, label, jpeg, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP + ($7 || ' milliseconds')::interval)`,
      [businessId, employeeId, enrollmentId, punchId, p.label, p.jpeg, String(FACE_PHOTO_KEEP_MS)],
    );
  }
}

export type StoredPhoto = { id: string; label: string; data_url: string };

function toStored(rows: { id: string; label: string; jpeg: Buffer }[]): StoredPhoto[] {
  return rows.map((r) => ({ id: r.id, label: r.label, data_url: `data:image/jpeg;base64,${r.jpeg.toString('base64')}` }));
}

export async function enrollmentPhotos(businessId: string, enrollmentId: string): Promise<StoredPhoto[]> {
  return toStored(
    await queryRows(
      `SELECT id, label, jpeg FROM staff_face_photos
       WHERE business_id = $1 AND enrollment_id = $2 AND expires_at > CURRENT_TIMESTAMP ORDER BY created_at`,
      [businessId, enrollmentId],
    ),
  );
}

/** Photos for punches waiting in the review queue, keyed by punch id. */
export async function punchPhotos(businessId: string, punchIds: string[]): Promise<Record<string, StoredPhoto[]>> {
  if (punchIds.length === 0) return {};
  const rows = await queryRows<{ id: string; punch_id: string; label: string; jpeg: Buffer }>(
    `SELECT id, punch_id, label, jpeg FROM staff_face_photos
     WHERE business_id = $1 AND punch_id = ANY($2::uuid[]) AND expires_at > CURRENT_TIMESTAMP ORDER BY created_at`,
    [businessId, punchIds],
  );
  const out: Record<string, StoredPhoto[]> = {};
  for (const r of rows) (out[r.punch_id] ??= []).push(...toStored([r]));
  return out;
}

export async function deletePunchPhotos(businessId: string, punchId: string): Promise<void> {
  await query('DELETE FROM staff_face_photos WHERE business_id = $1 AND punch_id = $2', [businessId, punchId]);
}

export async function purgeExpiredFacePhotos(): Promise<void> {
  await query('DELETE FROM staff_face_photos WHERE expires_at <= CURRENT_TIMESTAMP');
}

/**
 * Removes every template and photo of the employee (they left, or withdrew consent). The
 * enrollment rows stay as a record that face data existed and when it was removed.
 */
export async function deleteFaceData(businessId: string, employeeId: string, by: string | null): Promise<void> {
  await query('DELETE FROM staff_face_photos WHERE business_id = $1 AND employee_id = $2', [businessId, employeeId]);
  await query('DELETE FROM employee_face_templates WHERE business_id = $1 AND employee_id = $2', [businessId, employeeId]);
  await query(
    `UPDATE employee_face_enrollments
     SET status = 'deleted', quality = NULL, decided_by = COALESCE(decided_by, $3), decided_at = CURRENT_TIMESTAMP
     WHERE business_id = $1 AND employee_id = $2 AND status IN ('open', 'captured', 'active')`,
    [businessId, employeeId, by],
  );
}
