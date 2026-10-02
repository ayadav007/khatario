/**
 * Release 4 notification state: GET/stream merge, popup derivation from popup_dismissed_at,
 * dismissal, missed-reminder summary, and re-fired reminders (same id, new seq).
 */
import {
  NotificationStore,
  popupKey,
  presentPopups,
  type ClientNotification,
} from '@/lib/notifications/client/notification-store';
import type { StreamNotificationPayload } from '@/lib/notifications/client/stream-client';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function row(n: number, over: Partial<ClientNotification> = {}): ClientNotification {
  return {
    id: id(n),
    type: 'general',
    title: `t${n}`,
    message: `m${n}`,
    is_read: false,
    created_at: '2026-10-02T05:00:00.000Z',
    seq: String(n),
    popup_dismissed_at: null,
    reference_id: null,
    ...over,
  };
}

const reminder = (n: number, over: Partial<ClientNotification> = {}) =>
  row(n, { type: 'todo_reminder', reference_id: `todo-${n}`, ...over });

function event(n: number, seq: number, over: Partial<StreamNotificationPayload> = {}): StreamNotificationPayload {
  return {
    type: 'todo_reminder',
    notificationId: id(n),
    title: `t${n}@${seq}`,
    message: `m${n}`,
    reference_id: `todo-${n}`,
    reference_type: 'todo',
    timestamp: Date.parse('2026-10-02T06:00:00Z'),
    seq: String(seq),
    ...over,
  };
}

let store: NotificationStore;
beforeEach(() => {
  store = new NotificationStore();
});

describe('initial list and popups', () => {
  it('pops every unread, undismissed reminder from the first GET (no age filter, no skip-first-load)', () => {
    const max = store.applyList([
      reminder(3, { created_at: '2026-09-01T00:00:00.000Z' }),
      reminder(2, { popup_dismissed_at: '2026-10-01T00:00:00Z' }),
      reminder(1, { is_read: true }),
      row(4),
    ]);
    expect(max).toBe('4');
    expect(store.getSnapshot().popups.map((p) => p.key)).toEqual([popupKey(id(3), '3')]);
    expect(store.getSnapshot().unreadNotificationCount).toBe(3);
  });

  it('returns 0 for an empty list and null when rows have no seq (pre-Release-2 database)', () => {
    expect(store.applyList([])).toBe('0');
    expect(store.applyList([row(1, { seq: undefined })])).toBeNull();
  });

  it('does not pop the same occurrence again on later GETs (poll, wake, panel open)', () => {
    store.applyList([reminder(1)]);
    const first = store.getSnapshot().popups;
    store.applyList([reminder(1)]);
    store.applyList([reminder(1)]);
    expect(store.getSnapshot().popups).toBe(first);
    expect(store.getSnapshot().popups).toHaveLength(1);
  });

  it('summarizes more than three pending reminders', () => {
    store.applyList([reminder(1), reminder(2), reminder(3)]);
    expect(presentPopups(store.getSnapshot().popups).mode).toBe('individual');
    store.applyEvent(event(4, 4), '4');
    const view = presentPopups(store.getSnapshot().popups);
    expect(view.mode).toBe('summary');
    expect(view.popups).toHaveLength(4);
    expect(presentPopups([]).mode).toBe('none');
  });
});

describe('dismissal', () => {
  it('removes the popup locally and returns the occurrence to persist', () => {
    store.applyList([reminder(1), reminder(2)]);
    const items = store.dismiss([popupKey(id(1), '1')]);
    expect(items).toEqual([{ id: id(1), seq: '1' }]);
    expect(store.getSnapshot().popups.map((p) => p.notificationId)).toEqual([id(2)]);
  });

  it('a GET taken before the server saved the dismissal does not bring it back', () => {
    store.applyList([reminder(1)]);
    store.dismiss([popupKey(id(1), '1')]);
    store.applyList([reminder(1)]);
    expect(store.getSnapshot().popups).toHaveLength(0);
  });

  it('a fresh session (reload) respects popup_dismissed_at from the server', () => {
    store.applyList([reminder(1, { popup_dismissed_at: '2026-10-02T05:01:00Z' })]);
    expect(store.getSnapshot().popups).toHaveLength(0);
  });

  it('dismissal in another tab removes the popup here too', () => {
    store.applyList([reminder(1)]);
    store.dismiss([popupKey(id(1), '1')]); // what onRemoteDismiss does
    expect(store.getSnapshot().popups).toHaveLength(0);
  });

  it('marking read (here or via a GET) closes the popup', () => {
    store.applyList([reminder(1), reminder(2)]);
    store.markRead(id(1));
    expect(store.getSnapshot().popups.map((p) => p.notificationId)).toEqual([id(2)]);
    store.applyList([reminder(1, { is_read: true }), reminder(2, { is_read: true })]);
    expect(store.getSnapshot().popups).toHaveLength(0);
  });

  it('mark all read clears popups and the unread count', () => {
    store.applyList([reminder(1), row(2)]);
    store.markAllRead();
    expect(store.getSnapshot()).toMatchObject({ unreadNotificationCount: 0, popups: [] });
    expect(store.getSnapshot().notifications.every((n) => n.is_read)).toBe(true);
  });
});

describe('re-fired reminders (same notification id, new seq)', () => {
  it('pops again after dismissal and replaces the list entry instead of duplicating it', () => {
    store.applyList([reminder(1, { is_read: true }), row(2)]);
    store.applyEvent(event(1, 1000000000001), '1000000000001');
    const s = store.getSnapshot();
    expect(s.notifications.filter((n) => n.id === id(1))).toHaveLength(1);
    expect(s.notifications[0]).toMatchObject({ id: id(1), seq: '1000000000001', is_read: false, title: 't1@1000000000001' });
    expect(s.notifications).toHaveLength(2);
    expect(s.unreadNotificationCount).toBe(2);
    expect(s.popups.map((p) => p.key)).toEqual([popupKey(id(1), '1000000000001')]);

    store.dismiss([popupKey(id(1), '1000000000001')]);
    store.applyEvent(event(1, 1000000000002), '1000000000002');
    expect(store.getSnapshot().popups.map((p) => p.key)).toEqual([popupKey(id(1), '1000000000002')]);
    expect(store.getSnapshot().notifications.filter((n) => n.id === id(1))).toHaveLength(1);
  });

  it('a newer occurrence replaces an older open popup for the same reminder', () => {
    store.applyList([reminder(1)]);
    store.applyEvent(event(1, 50), '50');
    expect(store.getSnapshot().popups.map((p) => p.key)).toEqual([popupKey(id(1), '50')]);
  });

  it('a GET taken before the re-fire does not roll the row back or close the new popup', () => {
    store.applyList([reminder(1, { is_read: true })]);
    store.applyEvent(event(1, 50), '50');
    store.applyList([reminder(1, { is_read: true, seq: '1' })]);
    const s = store.getSnapshot();
    expect(s.notifications[0]).toMatchObject({ seq: '50', is_read: false });
    expect(s.popups.map((p) => p.key)).toEqual([popupKey(id(1), '50')]);
  });
});

describe('GET and stream share one de-duplication path', () => {
  it('a stream event for a row the poll already applied changes nothing', () => {
    store.applyList([reminder(7)]);
    const before = store.getSnapshot();
    store.applyEvent(event(7, 7), '7');
    expect(store.getSnapshot()).toBe(before);
  });

  it('a poll after a stream event keeps one entry and one popup', () => {
    store.applyEvent(event(7, 7), '7');
    store.applyList([reminder(7)]);
    const s = store.getSnapshot();
    expect(s.notifications.filter((n) => n.id === id(7))).toHaveLength(1);
    expect(s.popups).toHaveLength(1);
  });

  it('keeps stream rows newer than the GET snapshot', () => {
    store.applyList([row(1)]);
    store.applyEvent(event(9, 9, { type: 'general' }), '9');
    store.applyList([row(1), row(2)]);
    expect(store.getSnapshot().notifications.map((n) => n.seq)).toEqual(['9', '1', '2']);
  });

  it('notifies subscribers on change only', () => {
    const listener = jest.fn();
    const off = store.subscribe(listener);
    store.applyEvent(event(1, 1, { type: 'general' }), '1');
    expect(listener).toHaveBeenCalledTimes(1);
    store.applyEvent(event(1, 1, { type: 'general' }), '1');
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });
});
