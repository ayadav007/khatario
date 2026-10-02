import { BoundedSet, isSeq } from './primitives';
import type { StreamNotificationPayload } from './stream-client';

export interface ClientNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  seq?: string | null;
  popup_dismissed_at?: string | null;
  /** reference_id, reference_type, read_at, … (kept loose: pages declare their own row types). */
  [key: string]: unknown;
}

/** One reminder occurrence; a re-fire (same notification, new seq) is a new popup. */
export type ReminderPopup = {
  key: string;
  notificationId: string;
  seq: string | null;
  title: string;
  message: string;
  todoId: string;
  createdAt: string;
};

export type NotificationSnapshot = {
  notifications: ClientNotification[];
  unreadNotificationCount: number;
  popups: ReminderPopup[];
};

const EMPTY: NotificationSnapshot = { notifications: [], unreadNotificationCount: 0, popups: [] };
const MAX_LIST = 100;
const MAX_POPUPS = 50;

export const popupKey = (id: string, seq: string | null | undefined) => `${id}:${seq ?? 'legacy'}`;

function seqGte(a: string | null | undefined, b: string | null | undefined): boolean {
  return isSeq(a) && isSeq(b) && BigInt(a) >= BigInt(b);
}

function normalize(row: ClientNotification): ClientNotification {
  const read = row.is_read !== undefined ? !!row.is_read : (row as { read?: boolean }).read === true;
  const seq = row.seq == null ? null : String(row.seq);
  return { ...row, is_read: read, seq };
}

function toPopup(n: ClientNotification): ReminderPopup {
  return {
    key: popupKey(n.id, n.seq),
    notificationId: n.id,
    seq: n.seq ?? null,
    title: n.title || 'Reminder',
    message: n.message || n.title || 'You have a task reminder',
    todoId: (n.reference_id as string) || '',
    createdAt: n.created_at,
  };
}

/** More pending reminder popups than this are shown as one summary instead of a stack. */
export const MAX_INDIVIDUAL_POPUPS = 3;

export function presentPopups(popups: ReminderPopup[]): { mode: 'none' | 'individual' | 'summary'; popups: ReminderPopup[] } {
  if (popups.length === 0) return { mode: 'none', popups };
  return { mode: popups.length > MAX_INDIVIDUAL_POPUPS ? 'summary' : 'individual', popups };
}

const isPopupCandidate = (n: ClientNotification) =>
  n.type === 'todo_reminder' && !n.is_read && !n.popup_dismissed_at;

/**
 * Notification list + reminder popups for one session. GET results (initial load, resync,
 * polling, wake) and stream events go through here, so both paths de-duplicate the same way:
 * list rows by id (newest seq wins), popups by notification id + seq.
 */
export class NotificationStore {
  private state: NotificationSnapshot = EMPTY;
  private readonly listeners = new Set<() => void>();
  private readonly popupsSeen = new BoundedSet(500);
  private readonly dismissed = new BoundedSet(500);

  getSnapshot = (): NotificationSnapshot => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  reset(): void {
    this.popupsSeen.clear();
    this.dismissed.clear();
    this.set(EMPTY);
  }

  /**
   * Authoritative list from GET /api/notifications. Rows the stream delivered after that GET
   * was taken (higher seq) are kept. Returns the highest seq in the list ('0' when empty), or
   * null when the rows carry no seq (database without Release 2).
   */
  applyList(rows: ClientNotification[]): string | null {
    const incoming = rows.map(normalize);
    const seqs = incoming.map((r) => r.seq).filter(isSeq);
    const maxSeq = seqs.length ? seqs.reduce((m, s) => (BigInt(s) > BigInt(m) ? s : m)) : null;
    const prev = this.state.notifications;
    const prevById = new Map(prev.map((r) => [r.id, r]));
    const incomingIds = new Set(incoming.map((r) => r.id));

    const newer = maxSeq
      ? prev.filter((r) => !incomingIds.has(r.id) && isSeq(r.seq) && BigInt(r.seq) > BigInt(maxSeq))
      : [];
    const merged = [
      ...newer,
      ...incoming.map((r) => {
        const local = prevById.get(r.id);
        // A re-fire the stream already delivered is newer than this snapshot of the row.
        return local && isSeq(local.seq) && isSeq(r.seq) && BigInt(local.seq) > BigInt(r.seq) ? local : r;
      }),
    ];
    const byId = new Map(merged.map((r) => [r.id, r]));

    let popups = this.state.popups.filter((p) => {
      const row = byId.get(p.notificationId);
      if (!row) return true;
      if (isSeq(p.seq) && isSeq(row.seq) && BigInt(row.seq) < BigInt(p.seq)) return true;
      return isPopupCandidate(row);
    });
    for (const row of merged) {
      if (!isPopupCandidate(row)) continue;
      popups = this.addPopup(popups, row);
    }

    const sameList = sameRows(prev, merged);
    const samePopups = sameItems(this.state.popups, popups);
    if (!sameList || !samePopups) {
      this.set({
        notifications: sameList ? prev : merged,
        unreadNotificationCount: countUnread(merged),
        popups: samePopups ? this.state.popups : popups,
      });
    }
    return incoming.length === 0 ? '0' : maxSeq;
  }

  /** A stream (or relayed) `message` event. */
  applyEvent(payload: StreamNotificationPayload, seq: string | null): void {
    const id = payload.notificationId;
    if (typeof id !== 'string' || !id) return;
    const prev = this.state.notifications;
    const existing = prev.find((r) => r.id === id);
    if (existing && seq && seqGte(existing.seq, seq)) return; // already known (GET or earlier event)

    const row: ClientNotification = {
      ...(existing ?? {}),
      id,
      type: payload.type || existing?.type || 'general',
      title: payload.title ?? existing?.title ?? '',
      message: payload.message ?? existing?.message ?? '',
      is_read: false,
      read_at: null,
      created_at: new Date(typeof payload.timestamp === 'number' ? payload.timestamp : Date.now()).toISOString(),
      seq,
      popup_dismissed_at: null,
      reference_id: payload.reference_id ?? existing?.reference_id ?? null,
      reference_type: payload.reference_type ?? existing?.reference_type ?? null,
    };
    const notifications = [row, ...prev.filter((r) => r.id !== id)].slice(0, MAX_LIST);
    const popups = row.type === 'todo_reminder' ? this.addPopup(this.state.popups, row) : this.state.popups;
    this.set({ notifications, unreadNotificationCount: countUnread(notifications), popups });
  }

  markRead(id: string): void {
    const now = new Date().toISOString();
    const notifications = this.state.notifications.map((n) => (n.id === id ? { ...n, is_read: true, read_at: now } : n));
    this.set({
      notifications,
      unreadNotificationCount: countUnread(notifications),
      popups: this.state.popups.filter((p) => p.notificationId !== id),
    });
  }

  markAllRead(): void {
    const now = new Date().toISOString();
    const notifications = this.state.notifications.map((n) => (n.is_read ? n : { ...n, is_read: true, read_at: now }));
    this.set({ notifications, unreadNotificationCount: 0, popups: [] });
  }

  /** Removes popups locally; returns the occurrences to persist server-side. */
  dismiss(keys: string[]): { id: string; seq: string }[] {
    const wanted = new Set(keys);
    const removed = this.state.popups.filter((p) => wanted.has(p.key));
    for (const k of keys) this.dismissed.add(k);
    if (removed.length) {
      this.set({ ...this.state, popups: this.state.popups.filter((p) => !wanted.has(p.key)) });
    }
    return removed.filter((p) => isSeq(p.seq)).map((p) => ({ id: p.notificationId, seq: p.seq as string }));
  }

  private addPopup(popups: ReminderPopup[], row: ClientNotification): ReminderPopup[] {
    const key = popupKey(row.id, row.seq);
    if (this.popupsSeen.has(key) || this.dismissed.has(key)) return popups;
    this.popupsSeen.add(key);
    const next = [...popups.filter((p) => p.notificationId !== row.id), toPopup(row)];
    return next.slice(-MAX_POPUPS);
  }

  private set(next: NotificationSnapshot): void {
    this.state = next;
    for (const l of [...this.listeners]) l();
  }
}

function sameItems<T>(a: T[], b: T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Same rows as far as the UI is concerned (polling usually returns an unchanged list). */
function sameRows(a: ClientNotification[], b: ClientNotification[]): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i];
      return (
        x.id === y.id &&
        x.is_read === y.is_read &&
        x.seq === y.seq &&
        x.popup_dismissed_at === y.popup_dismissed_at &&
        x.title === y.title &&
        x.message === y.message
      );
    })
  );
}

function countUnread(list: ClientNotification[]): number {
  return list.reduce((n, r) => n + (r.is_read ? 0 : 1), 0);
}
