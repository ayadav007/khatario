/**
 * Client-side reminder defaults (no API/DB changes).
 * Uses UTC instants (Date.getTime()) for arithmetic; display with formatInTimeZone + business TZ.
 */

const MS_2_MIN = 2 * 60 * 1000;
const MS_5_MIN = 5 * 60 * 1000;
const MS_10_MIN = 10 * 60 * 1000;
const MS_1_HOUR = 60 * 60 * 1000;

/** Every reminder must be at least this far in the future (prod safety). */
export const MIN_REMINDER_LEAD_MS = MS_2_MIN;

function clampToMinLead(candidate: Date, now: Date): Date {
  const min = new Date(now.getTime() + MIN_REMINDER_LEAD_MS);
  return candidate.getTime() < min.getTime() ? min : candidate;
}

/**
 * Smart default when the user did not pick a preset/custom time.
 * Rules: diff = due - now
 * - past due → now + 5 min (then clamp ≥ now+2 min)
 * - due within 2 min → now + 2 min
 * - diff > 1h → due − 1h
 * - diff > 10m → now + 5m
 * - else → at due
 * Final: never before now + 2 min.
 */
export function computeSmartReminderUtc(dueUtc: Date, nowUtc: Date = new Date()): Date {
  const due = dueUtc.getTime();
  const now = nowUtc.getTime();
  const diff = due - now;

  let candidate: Date;

  if (diff <= 0) {
    candidate = new Date(now + MS_5_MIN);
  } else if (diff <= MS_2_MIN) {
    candidate = new Date(now + MS_2_MIN);
  } else if (diff > MS_1_HOUR) {
    candidate = new Date(due - MS_1_HOUR);
  } else if (diff > MS_10_MIN) {
    candidate = new Date(now + MS_5_MIN);
  } else {
    candidate = new Date(due);
  }

  return clampToMinLead(candidate, nowUtc);
}

export type ReminderPreset = 'smart' | 'at_due' | 'm10' | 'm30' | 'h1' | 'custom';

/** Preset relative to due (all times are UTC instants). */
export function reminderFromPresetUtc(
  dueUtc: Date,
  preset: Exclude<ReminderPreset, 'smart' | 'custom'>,
  nowUtc: Date = new Date()
): Date {
  let raw: Date;
  switch (preset) {
    case 'at_due':
      raw = new Date(dueUtc.getTime());
      break;
    case 'm10':
      raw = new Date(dueUtc.getTime() - 10 * 60 * 1000);
      break;
    case 'm30':
      raw = new Date(dueUtc.getTime() - 30 * 60 * 1000);
      break;
    case 'h1':
      raw = new Date(dueUtc.getTime() - MS_1_HOUR);
      break;
    default:
      raw = new Date(dueUtc.getTime());
  }
  // "At due time" must match `due` when due is still in the future. The global
  // min-lead clamp would nudge e.g. 7:48 → 7:49 if "now" is within 2 min of due.
  if (preset === 'at_due' && raw.getTime() >= nowUtc.getTime()) {
    return raw;
  }
  return clampToMinLead(raw, nowUtc);
}

/** Enforce min lead for an explicit user-chosen instant (e.g. custom datetime-local). */
export function applyMinLeadToUserChoice(chosenUtc: Date, nowUtc: Date = new Date()): Date {
  return clampToMinLead(chosenUtc, nowUtc);
}

const SAME_INSTANT_MS = 60_000;

/** "At due time" in UI when reminder and due match within tolerance. */
export function isReminderAtDueTime(
  reminderIso: string,
  dueIso: string,
  toleranceMs: number = SAME_INSTANT_MS
): boolean {
  const a = new Date(reminderIso).getTime();
  const b = new Date(dueIso).getTime();
  return Math.abs(a - b) <= toleranceMs;
}

export const reminderSourceKey = (todoId: string) =>
  `khatario_todo_reminder_src_${todoId}`;

export type ReminderConfigSource = 'auto' | 'user';

export function setReminderConfigSource(
  todoId: string,
  source: ReminderConfigSource
): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(reminderSourceKey(todoId), source);
  } catch {
    /* ignore */
  }
}

/**
 * - `user`: explicit preset/custom; reschedule keeps reminder unless client sends new one.
 * - `auto`: quick-add smart; reschedule recalculates with `computeSmartReminderUtc` when due changes.
 * - missing key: treat as `user` so legacy todos are not shifted unexpectedly.
 */
export function getReminderConfigSource(todoId: string): ReminderConfigSource {
  if (typeof window === 'undefined') return 'user';
  try {
    const v = sessionStorage.getItem(reminderSourceKey(todoId));
    if (v === 'auto' || v === 'user') return v;
  } catch {
    /* ignore */
  }
  return 'user';
}
