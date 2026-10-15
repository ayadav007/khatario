/**
 * Liveness challenge: the server picks three actions in a random order with each check-in
 * challenge; the phone watches for them with ML Kit (eye-open and smile probability, head angle)
 * and reports what it saw. The report is only as honest as the phone, so the server also checks
 * the photos taken during the actions (match.ts). Pure.
 */
import { randomInt } from 'crypto';

export const LIVENESS_STEPS = ['blink', 'turn_left', 'turn_right', 'smile'] as const;
export type LivenessStep = (typeof LIVENESS_STEPS)[number];

export type LivenessChallenge = {
  steps: LivenessStep[];
  /** Photos the phone should send: one before, one while turned, one after. */
  photos: number;
  timeout_ms: number;
};

export type LivenessReport = {
  steps: string[];
  completed: string[];
  passed: boolean;
  duration_ms: number;
  frames: number;
  /** Times ML Kit's tracking id changed, i.e. a different face came into view. */
  face_changes: number;
};

export const LIVENESS_STEP_COUNT = 3;
export const LIVENESS_TIMEOUT_MS = 25_000;
/** Faster than this is not a person following three prompts. */
const MIN_DURATION_MS = 1200;
const MIN_FRAMES = 8;

/** Three of the four actions, shuffled. Any three include at least one head turn. */
export function newLivenessChallenge(rand: (max: number) => number = randomInt): LivenessChallenge {
  const pool: LivenessStep[] = [...LIVENESS_STEPS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return { steps: pool.slice(0, LIVENESS_STEP_COUNT), photos: 3, timeout_ms: LIVENESS_TIMEOUT_MS };
}

export function parseLivenessChallenge(raw: unknown): LivenessChallenge | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const steps = (Array.isArray(o.steps) ? o.steps : []).filter((s): s is LivenessStep =>
    (LIVENESS_STEPS as readonly string[]).includes(String(s)),
  );
  if (steps.length === 0) return null;
  return { steps, photos: Number(o.photos) || 3, timeout_ms: Number(o.timeout_ms) || LIVENESS_TIMEOUT_MS };
}

export function parseLivenessReport(raw: unknown): LivenessReport | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v : []).slice(0, 10).map((s) => String(s).slice(0, 20));
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    steps: list(o.steps),
    completed: list(o.completed),
    passed: o.passed === true,
    duration_ms: n(o.duration_ms),
    frames: n(o.frames),
    face_changes: n(o.face_changes),
  };
}

/** Null when the report shows the asked-for actions done in order by one face; else a short code. */
export function livenessProblem(challenge: LivenessChallenge, report: LivenessReport | null): string | null {
  if (!report) return 'no_report';
  if (!report.passed) return 'not_passed';
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((s, i) => s === b[i]);
  if (!same(report.steps, challenge.steps) || !same(report.completed, challenge.steps)) return 'wrong_steps';
  if (report.face_changes > 0) return 'face_changed';
  if (report.frames < MIN_FRAMES) return 'too_few_frames';
  if (report.duration_ms < MIN_DURATION_MS || report.duration_ms > challenge.timeout_ms + 5000) return 'timing';
  return null;
}
