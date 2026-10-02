/**
 * Remembered sweep position at the wrap point, against an in-memory due list that applies the
 * same (reminder_time, id) keyset bounds as the batch query. Deterministic: no DB, no clock.
 */
type Row = { id: string; time: string };

let due: Row[] = [];
const failing = new Set<string>();
const visited: string[] = [];

const mockQueryRows = jest.fn(async (_sql: string, params: unknown[]) => {
  const [afterTime, afterId, upToTime, upToId, limit] = params as [
    string | null,
    string | null,
    string | null,
    string | null,
    number,
  ];
  const cmp = (r: Row, time: string, id: string) =>
    r.time < time ? -1 : r.time > time ? 1 : r.id < id ? -1 : r.id > id ? 1 : 0;
  return due
    .filter((r) => afterTime === null || cmp(r, afterTime, afterId!) > 0)
    .filter((r) => upToTime === null || cmp(r, upToTime, upToId!) <= 0)
    .sort((a, b) => cmp(a, b.time, b.id))
    .slice(0, limit)
    .map((r) => ({ id: r.id, business_id: 'b1', status: 'pending', sweep_reminder_time: r.time }));
});
jest.mock('@/lib/db', () => ({ queryRows: (...a: [string, unknown[]]) => mockQueryRows(...a) }));
jest.mock('@/lib/services/todoReminderService', () => ({
  triggerTodoReminder: async (todo: { id: string }) => {
    visited.push(todo.id);
    if (failing.has(todo.id)) throw new Error('persistent failure');
    due = due.filter((r) => r.id !== todo.id);
    return { status: 'delivered' };
  },
}));
jest.mock('@/lib/todo-reminders/reminderLog', () => ({ logTodoReminder: jest.fn() }));

import {
  sweepDueTodoReminders,
  resetSweepPositionsForTests,
} from '@/lib/todo-reminders/sweepDueTodoReminders';

beforeEach(() => {
  resetSweepPositionsForTests();
  due = [];
  failing.clear();
  visited.length = 0;
});

it('a run that stops at the wrap point makes the next run start at the head, not repeat the tail', async () => {
  const P = { id: 'p', time: '2026-10-02 10:00:00+00' };
  const T1 = { id: 't1', time: '2026-10-02 10:01:00+00' };
  const T2 = { id: 't2', time: '2026-10-02 10:02:00+00' };
  const HEAD = { id: 'h', time: '2026-10-02 09:00:00+00' };
  due = [P, T1, T2];
  failing.add(T1.id).add(T2.id);

  // Saves position P: one full batch, then the batch limit.
  const first = await sweepDueTodoReminders({ batchSize: 1, maxBatches: 1 });
  expect(first.stoppedReason).toBe('batch_limit');
  expect(visited).toEqual(['p']);

  // A reminder becomes due behind P.
  due.push(HEAD);

  // Resumes after P, visits the tail, reaches the wrap point and stops before the head.
  visited.length = 0;
  const atWrap = await sweepDueTodoReminders({ batchSize: 3, maxBatches: 1 });
  expect(atWrap).toMatchObject({ stoppedReason: 'batch_limit', failed: 2, processed: 0 });
  expect(visited).toEqual(['t1', 't2']);

  // Must start at the head instead of resuming after P and repeating the failing tail.
  visited.length = 0;
  const next = await sweepDueTodoReminders({ batchSize: 3, maxBatches: 1 });
  expect(visited[0]).toBe('h');
  expect(next.processed).toBe(1);
  expect(due.map((r) => r.id)).not.toContain('h');
});
