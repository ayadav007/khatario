/**
 * Face check for one punch: liveness report against the challenge, the photos through the engine,
 * one-to-one match with this employee's templates, and a replay check on the photo hashes.
 */
import { analyzeFacePhoto, FaceEngineUnavailable } from '@/lib/hr/staff-app/face/engine';
import {
  livenessProblem,
  LIVENESS_STEPS,
  parseLivenessReport,
  type LivenessChallenge,
} from '@/lib/hr/staff-app/face/liveness';
import { buildFaceEvidence, type PhotoResult } from '@/lib/hr/staff-app/face/match';
import { activeTemplates, parseFacePhotos, photosSeenBefore, type FacePhoto } from '@/lib/hr/staff-app/face/store';
import type { FaceEvidence } from '@/lib/hr/staff-app/risk';

export const PUNCH_PHOTO_LABELS = ['start', 'end', ...LIVENESS_STEPS] as const;
const MAX_PUNCH_PHOTOS = 4;

/** Runs every photo through the engine; an unreadable photo becomes a null analysis. */
export async function analyzePhotos(photos: FacePhoto[]): Promise<{ results: PhotoResult[]; engineAvailable: boolean }> {
  const results: PhotoResult[] = [];
  for (const p of photos) {
    try {
      results.push({ label: p.label, analysis: await analyzeFacePhoto(p.jpeg) });
    } catch (error) {
      if (error instanceof FaceEngineUnavailable) {
        console.error('[staff-app face]', error.message);
        return { results: [], engineAvailable: false };
      }
      results.push({ label: p.label, analysis: null });
    }
  }
  return { results, engineAvailable: true };
}

export type PunchFaceCheck = { evidence: FaceEvidence; photos: FacePhoto[] };

/**
 * `face` is the punch body's `{ liveness, photos }`. Null when the employee has no approved face
 * (any more). Throws StaffAuthError on a malformed photo.
 */
export async function checkPunchFace(
  employeeId: string,
  challenge: LivenessChallenge,
  face: unknown,
): Promise<PunchFaceCheck | null> {
  const f = (face && typeof face === 'object' ? face : {}) as Record<string, unknown>;
  const photos = parseFacePhotos(f.photos, PUNCH_PHOTO_LABELS, MAX_PUNCH_PHOTOS);
  const problem = livenessProblem(challenge, parseLivenessReport(f.liveness));
  const templates = await activeTemplates(employeeId);
  if (templates.length === 0) return null;
  const [replayed, analysed] = await Promise.all([
    photosSeenBefore(employeeId, photos.map((p) => p.sha256)),
    analyzePhotos(photos),
  ]);
  const evidence = buildFaceEvidence({
    livenessProblem: problem,
    photos: analysed.results,
    templates,
    engineAvailable: analysed.engineAvailable,
    replayed: replayed || new Set(photos.map((p) => p.sha256)).size < photos.length,
  });
  return { evidence, photos };
}
