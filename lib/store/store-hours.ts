/**
 * Store opening hours (business_settings.store_hours): one opening per day, `HH:MM` 24-hour, always
 * India time (Asia/Kolkata) whatever the server or shopper clock says. `null` for a day = closed all day;
 * `null` hours = not set, so nothing hours-related shows. Orders are still taken while closed.
 */

export type StoreDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type StoreDayHours = { open: string; close: string };
export type StoreHours = Record<StoreDay, StoreDayHours | null>;

export type StoreOpenState =
  | { state: 'open'; closesAt: string }
  | { state: 'closed'; opensAt: string; opensOn: 'today' | 'tomorrow' | StoreDay }
  | { state: 'unknown' };

/** Week order for settings and display, Monday first. */
export const STORE_DAYS: readonly StoreDay[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export const STORE_DAY_LABELS: Record<StoreDay, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  sun: 'Sun',
};

/** `Date.getUTCDay()` order (0 = Sunday). */
const BY_UTC_DAY: readonly StoreDay[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** India is UTC+5:30 all year (no daylight saving). */
const IST_OFFSET_MINUTES = 330;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function minutesOf(hhmm: string): number {
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
}

function sanitizeDay(raw: unknown): StoreDayHours | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { open, close } = raw as { open?: unknown; close?: unknown };
  if (typeof open !== 'string' || typeof close !== 'string') return null;
  if (!TIME.test(open) || !TIME.test(close)) return null;
  if (minutesOf(close) <= minutesOf(open)) return null;
  return { open, close };
}

/** Clean saved or client-sent hours: bad days become closed, unknown keys go; null when no day is valid. */
export function sanitizeStoreHours(raw: unknown): StoreHours | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out = {} as StoreHours;
  let any = false;
  for (const d of STORE_DAYS) {
    out[d] = sanitizeDay(src[d]);
    if (out[d]) any = true;
  }
  return any ? out : null;
}

/** Whether the store is open at `now`, read in India time, and when it next opens or closes. */
export function storeOpenState(hours: StoreHours | null, now: Date): StoreOpenState {
  if (!hours) return { state: 'unknown' };
  const ist = new Date(now.getTime() + IST_OFFSET_MINUTES * 60_000);
  const todayIndex = ist.getUTCDay();
  const minute = ist.getUTCHours() * 60 + ist.getUTCMinutes();

  const today = sanitizeDay(hours[BY_UTC_DAY[todayIndex]]);
  if (today) {
    const open = minutesOf(today.open);
    const close = minutesOf(today.close);
    if (minute >= open && minute < close) return { state: 'open', closesAt: today.close };
    if (minute < open) return { state: 'closed', opensAt: today.open, opensOn: 'today' };
  }
  for (let ahead = 1; ahead <= 7; ahead++) {
    const d = BY_UTC_DAY[(todayIndex + ahead) % 7];
    const next = sanitizeDay(hours[d]);
    if (next) return { state: 'closed', opensAt: next.open, opensOn: ahead === 1 ? 'tomorrow' : d };
  }
  return { state: 'unknown' };
}

/** `07:00` → `7 AM`, `21:30` → `9:30 PM`, `12:00` → `12 PM`. */
export function formatStoreTime(hhmm: string): string {
  const h = Number(hhmm.slice(0, 2));
  const m = hhmm.slice(3, 5);
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === '00' ? `${h12} ${suffix}` : `${h12}:${m} ${suffix}`;
}

/** The header badge: "Open · till 10 PM", "Closed · opens tomorrow 7 AM"; null when hours are unknown. */
export function openStatusLabel(state: StoreOpenState): string | null {
  if (state.state === 'open') return `Open · till ${formatStoreTime(state.closesAt)}`;
  if (state.state === 'closed') {
    const when =
      state.opensOn === 'today' ? '' : state.opensOn === 'tomorrow' ? 'tomorrow ' : `${STORE_DAY_LABELS[state.opensOn]} `;
    return `Closed · opens ${when}${formatStoreTime(state.opensAt)}`;
  }
  return null;
}

/** The cart and checkout notice while the store is closed; null when open or hours are unknown. */
export function closedNotice(state: StoreOpenState): string | null {
  if (state.state !== 'closed') return null;
  const when =
    state.opensOn === 'today' ? '' : state.opensOn === 'tomorrow' ? 'tomorrow ' : `on ${STORE_DAY_LABELS[state.opensOn]} `;
  return `We're closed now. Orders placed now are delivered after we open ${when}at ${formatStoreTime(state.opensAt)}.`;
}
