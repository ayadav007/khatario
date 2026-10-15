/**
 * One-to-one face match: the check-in photos against this employee's own enrolled templates —
 * never a search across other employees. Turns per-photo results into the evidence risk.ts
 * scores. Pure.
 */
import type { FaceAnalysis } from '@/lib/hr/staff-app/face/engine';
import type { FaceEvidence } from '@/lib/hr/staff-app/risk';

/** SFace's published cosine threshold (OpenCV Zoo) for "same person". */
export const SFACE_SAME_PERSON = 0.363;
/** A turned-head photo must be turned at least this much (yawRatio), and more than the straight one. */
const TURN_MIN_YAW = 0.2;
const TURN_MARGIN = 0.1;

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** A photo that was sent: what it was taken for, and what the engine found (null = unreadable). */
export type PhotoResult = { label: string; analysis: FaceAnalysis | null };

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function buildFaceEvidence(input: {
  livenessProblem: string | null;
  photos: PhotoResult[];
  templates: ArrayLike<number>[];
  engineAvailable: boolean;
  replayed: boolean;
}): FaceEvidence {
  const usable = input.photos.filter((p) => p.analysis?.embedding && p.analysis.faces === 1);
  const evidence: FaceEvidence = {
    liveness_problem: input.livenessProblem,
    engine_available: input.engineAvailable,
    photos_sent: input.photos.length,
    photos_with_face: usable.length,
    multiple_faces: input.photos.some((p) => (p.analysis?.faces ?? 0) > 1),
    similarity: null,
    consistent: true,
    pose_seen: null,
    replayed: input.replayed,
  };
  if (!input.engineAvailable || usable.length === 0) return evidence;

  const embeddings = usable.map((p) => p.analysis!.embedding!);
  if (input.templates.length > 0) {
    const best = embeddings.map((e) => Math.max(...input.templates.map((t) => cosine(e, t))));
    evidence.similarity = Math.round(median(best) * 1000) / 1000;
  }
  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      if (cosine(embeddings[i], embeddings[j]) < SFACE_SAME_PERSON) evidence.consistent = false;
    }
  }

  const turned = usable.filter((p) => p.label === 'turn_left' || p.label === 'turn_right');
  if (turned.length > 0) {
    const straight = usable.filter((p) => !turned.includes(p)).map((p) => Math.abs(p.analysis!.yaw ?? 0));
    const base = straight.length ? Math.min(...straight) : 0;
    evidence.pose_seen = turned.some((p) => {
      const yaw = Math.abs(p.analysis!.yaw ?? 0);
      return yaw >= TURN_MIN_YAW && yaw >= base + TURN_MARGIN;
    });
  }
  return evidence;
}
