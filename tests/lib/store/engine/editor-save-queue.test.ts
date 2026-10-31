import {
  AUTOSAVE_MS,
  RETRY_MS,
  SaveQueue,
  backupKey,
  readBackup,
  hasBackup,
  sweepBackups,
  type PutResult,
  type SaveStatus,
} from '@/lib/store/engine/editor/save-queue';
import type { ThemeData, ThemeRow } from '@/lib/store/engine/types';

const d = (n: number) => ({ n }) as unknown as ThemeData;
const row = (updated_at: string, n = 0) =>
  ({ id: 't1', updated_at, data: d(n) }) as unknown as ThemeRow;
const ok = (updated_at: string): PutResult => ({ status: 200, body: { theme: row(updated_at) } });

function memStorage(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  return {
    m,
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

async function tick(n = 10) {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

function setup(putImpl: jest.Mock) {
  const storage = memStorage();
  const statuses: Array<[SaveStatus, string | undefined]> = [];
  const onSaved = jest.fn();
  const q = new SaveQueue('b1', 't1', 'v0', {
    put: putImpl,
    storage,
    onStatus: (s, m) => statuses.push([s, m]),
    onSaved,
  });
  return { q, storage, statuses, onSaved };
}

describe('SaveQueue', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('exposes constants and key', () => {
    expect(AUTOSAVE_MS).toBe(1000);
    expect(RETRY_MS).toBe(5000);
    expect(backupKey('b1', 't1')).toBe('kh-theme-unsaved:b1:t1');
  });

  it('debounces 1000 ms and saves the latest data once', async () => {
    const put = jest.fn().mockResolvedValue(ok('v1'));
    const { q, statuses, onSaved } = setup(put);
    q.schedule(d(1));
    jest.advanceTimersByTime(500);
    q.schedule(d(2));
    jest.advanceTimersByTime(999);
    expect(put).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await tick();
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith('t1', d(2), 'v0');
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(statuses.map((s) => s[0])).toEqual(['pending', 'saving', 'saved']);
  });

  it('immediate saves without waiting', async () => {
    const put = jest.fn().mockResolvedValue(ok('v1'));
    const { q } = setup(put);
    q.schedule(d(1), true);
    await tick();
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('queues edits made during a save and chains updated_at', async () => {
    let release!: (r: PutResult) => void;
    const put = jest
      .fn()
      .mockImplementationOnce(() => new Promise<PutResult>((r) => (release = r)))
      .mockResolvedValueOnce(ok('v2'));
    const { q, statuses } = setup(put);
    q.schedule(d(1), true);
    await tick();
    q.schedule(d(2));
    q.schedule(d(3));
    expect(put).toHaveBeenCalledTimes(1);
    release(ok('v1'));
    await tick();
    // Typing went on during the save: the next one waits for the debounce again.
    expect(put).toHaveBeenCalledTimes(1);
    expect(statuses[statuses.length - 1][0]).toBe('pending');
    jest.advanceTimersByTime(AUTOSAVE_MS - 1);
    await tick();
    expect(put).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    await tick();
    expect(put).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenLastCalledWith('t1', d(3), 'v1');
    expect(statuses[statuses.length - 1][0]).toBe('saved');
  });

  it('chains straight away when the newest queued edit was immediate', async () => {
    let release!: (r: PutResult) => void;
    const put = jest
      .fn()
      .mockImplementationOnce(() => new Promise<PutResult>((r) => (release = r)))
      .mockResolvedValueOnce(ok('v2'));
    const { q } = setup(put);
    q.schedule(d(1), true);
    await tick();
    q.schedule(d(2));
    q.schedule(d(3), true);
    release(ok('v1'));
    await tick();
    expect(put).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenLastCalledWith('t1', d(3), 'v1');
  });

  it('a flush waiting on a chained save sends it without the debounce', async () => {
    let release!: (r: PutResult) => void;
    const put = jest
      .fn()
      .mockImplementationOnce(() => new Promise<PutResult>((r) => (release = r)))
      .mockResolvedValueOnce(ok('v2'));
    const { q } = setup(put);
    q.schedule(d(1), true);
    await tick();
    q.schedule(d(2));
    let done = false;
    void q.flush().then(() => (done = true));
    release(ok('v1'));
    await tick();
    expect(put).toHaveBeenCalledTimes(2);
    await tick();
    expect(done).toBe(true);
  });

  it('stops on conflict and keeps the backup', async () => {
    const put = jest
      .fn()
      .mockResolvedValue({ status: 409, body: { error: 'x', code: 'conflict' } });
    const { q, storage, statuses } = setup(put);
    q.schedule(d(1), true);
    await tick();
    expect(statuses[statuses.length - 1][0]).toBe('conflict');
    q.schedule(d(2), true);
    jest.advanceTimersByTime(10000);
    await tick();
    expect(put).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.m.get('kh-theme-unsaved:b1:t1') as string)).toEqual({
      data: d(2),
      base: 'v0',
      savedAt: expect.any(Number),
    });
    q.retry();
    await tick();
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('reports locked on live_locked', async () => {
    const put = jest
      .fn()
      .mockResolvedValue({ status: 409, body: { error: 'x', code: 'live_locked' } });
    const { q, statuses } = setup(put);
    q.schedule(d(1), true);
    await tick();
    expect(statuses[statuses.length - 1][0]).toBe('locked');
  });

  it('reports error with the body message for 413 and other failures', async () => {
    const put = jest
      .fn()
      .mockResolvedValueOnce({ status: 413, body: { error: 'too big', code: 'too_large' } })
      .mockResolvedValueOnce({ status: 500, body: {} });
    const { q, statuses } = setup(put);
    q.schedule(d(1), true);
    await tick();
    expect(statuses[statuses.length - 1]).toEqual(['error', 'too big']);
    q.retry();
    await tick();
    expect(put).toHaveBeenCalledTimes(2);
    expect(statuses[statuses.length - 1][0]).toBe('error');
  });

  it('keeps a backup and retries after a network failure', async () => {
    const put = jest.fn().mockRejectedValueOnce(new Error('net')).mockResolvedValueOnce(ok('v1'));
    const { q, storage, statuses } = setup(put);
    q.schedule(d(1), true);
    await tick();
    expect(statuses[statuses.length - 1][0]).toBe('offline');
    expect(storage.m.has('kh-theme-unsaved:b1:t1')).toBe(true);
    jest.advanceTimersByTime(RETRY_MS);
    await tick();
    expect(put).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenLastCalledWith('t1', d(1), 'v0');
    expect(statuses[statuses.length - 1][0]).toBe('saved');
    expect(storage.m.has('kh-theme-unsaved:b1:t1')).toBe(false);
  });

  it('clears the backup after a clean save', async () => {
    const put = jest.fn().mockResolvedValue(ok('v1'));
    const { q, storage } = setup(put);
    q.schedule(d(1));
    expect(storage.m.has('kh-theme-unsaved:b1:t1')).toBe(true);
    jest.advanceTimersByTime(AUTOSAVE_MS);
    await tick();
    expect(storage.m.has('kh-theme-unsaved:b1:t1')).toBe(false);
  });

  it('flush saves pending data now and resolves when idle', async () => {
    const put = jest.fn().mockResolvedValue(ok('v1'));
    const { q } = setup(put);
    q.schedule(d(1));
    const p = q.flush();
    await tick();
    await p;
    expect(put).toHaveBeenCalledTimes(1);
    await q.flush();
  });

  it('dispose clears timers and ignores late responses', async () => {
    let release!: (r: PutResult) => void;
    const put = jest.fn().mockImplementation(() => new Promise<PutResult>((r) => (release = r)));
    const { q, statuses, onSaved } = setup(put);
    q.schedule(d(1), true);
    await tick();
    q.dispose();
    release(ok('v1'));
    await tick();
    expect(onSaved).not.toHaveBeenCalled();
    expect(statuses[statuses.length - 1][0]).toBe('saving');
    q.schedule(d(2));
    jest.advanceTimersByTime(5000);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('a save that lands after dispose still clears the backup (leaving right after an edit)', async () => {
    let release!: (r: PutResult) => void;
    const put = jest.fn().mockImplementation(() => new Promise<PutResult>((r) => (release = r)));
    const { q, storage, onSaved } = setup(put);
    q.schedule(d(1));
    void q.flush();
    q.dispose();
    expect(storage.m.has('kh-theme-unsaved:b1:t1')).toBe(true);
    release(ok('v1'));
    await tick();
    expect(storage.m.has('kh-theme-unsaved:b1:t1')).toBe(false);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('a save that lands after dispose re-bases a still-queued backup on the new updated_at', async () => {
    let release!: (r: PutResult) => void;
    const put = jest.fn().mockImplementation(() => new Promise<PutResult>((r) => (release = r)));
    const { q, storage } = setup(put);
    q.schedule(d(1), true);
    await tick();
    q.schedule(d(2));
    q.dispose();
    release(ok('v1'));
    await tick();
    expect(put).toHaveBeenCalledTimes(1);
    expect(readBackup(storage, 'b1', 't1', 'v1')).toEqual({ data: d(2), stale: false });
  });

  it('a failed save after dispose keeps the backup', async () => {
    let fail!: (e: Error) => void;
    const put = jest.fn().mockImplementation(() => new Promise<PutResult>((_, rej) => (fail = rej)));
    const { q, storage } = setup(put);
    q.schedule(d(1), true);
    await tick();
    q.dispose();
    fail(new Error('net'));
    await tick();
    expect(readBackup(storage, 'b1', 't1', 'v0')).toEqual({ data: d(1), stale: false });
  });

  it('does not stack retry timers across repeated network failures', async () => {
    const put = jest
      .fn()
      .mockRejectedValueOnce(new Error('net'))
      .mockRejectedValueOnce(new Error('net'))
      .mockResolvedValue(ok('v1'));
    const { q } = setup(put);
    q.schedule(d(1), true);
    await tick();
    q.schedule(d(1), true);
    await tick();
    expect(put).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(RETRY_MS);
    await tick();
    expect(put).toHaveBeenCalledTimes(3);
    jest.advanceTimersByTime(RETRY_MS * 3);
    await tick();
    expect(put).toHaveBeenCalledTimes(3);
  });

  it('keeps an edit made during a failing PUT and saves it on retry', async () => {
    let fail!: (e: Error) => void;
    const put = jest
      .fn()
      .mockImplementationOnce(() => new Promise<PutResult>((_, rej) => (fail = rej)))
      .mockResolvedValueOnce(ok('v1'));
    const { q, storage } = setup(put);
    q.schedule(d(1), true);
    await tick();
    q.schedule(d(2));
    fail(new Error('net'));
    await tick();
    expect(JSON.parse(storage.m.get('kh-theme-unsaved:b1:t1') as string).data).toEqual(d(2));
    jest.advanceTimersByTime(RETRY_MS);
    await tick();
    expect(put).toHaveBeenLastCalledWith('t1', d(2), 'v0');
  });

  it('reports error for a 200 with a null body or no theme', async () => {
    const put = jest
      .fn()
      .mockResolvedValueOnce({ status: 200, body: null })
      .mockResolvedValueOnce({ status: 200, body: {} });
    const { q, statuses } = setup(put);
    q.schedule(d(1), true);
    await tick();
    expect(statuses[statuses.length - 1]).toEqual(['error', 'Unexpected response from the server']);
    q.retry();
    await tick();
    expect(put).toHaveBeenCalledTimes(2);
    expect(statuses[statuses.length - 1][0]).toBe('error');
  });

  it('survives a throwing onSaved', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const put = jest.fn().mockResolvedValueOnce(ok('v1')).mockResolvedValueOnce(ok('v2'));
    const statuses: SaveStatus[] = [];
    const q = new SaveQueue('b1', 't1', 'v0', {
      put,
      storage: null,
      onStatus: (s) => statuses.push(s),
      onSaved: () => {
        throw new Error('boom');
      },
    });
    q.schedule(d(1), true);
    await tick();
    expect(statuses[statuses.length - 1]).toBe('saved');
    q.schedule(d(2), true);
    await tick();
    expect(put).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenLastCalledWith('t1', d(2), 'v1');
    spy.mockRestore();
  });

  it('a 404 not_found stops as gone, keeps the backup and releases a flush', async () => {
    const put = jest.fn().mockResolvedValue({ status: 404, body: { error: 'Theme not found', code: 'not_found' } });
    const { q, storage, statuses } = setup(put);
    q.schedule(d(1));
    const flushed = q.flush();
    await tick();
    await expect(flushed).resolves.toBeUndefined();
    expect(statuses[statuses.length - 1]).toEqual(['gone', 'Theme not found']);
    expect(JSON.parse(storage.m.get('kh-theme-unsaved:b1:t1') as string).data).toEqual(d(1));
    await expect(q.flush()).resolves.toBeUndefined();
  });

  it('after gone, schedule and retry do not PUT', async () => {
    const put = jest.fn().mockResolvedValue({ status: 404, body: { code: 'not_found' } });
    const { q, storage, statuses } = setup(put);
    q.schedule(d(1), true);
    await tick();
    expect(statuses[statuses.length - 1][0]).toBe('gone');
    q.schedule(d(2), true);
    jest.advanceTimersByTime(10000);
    await tick();
    q.retry();
    await tick();
    expect(put).toHaveBeenCalledTimes(1);
    expect(statuses[statuses.length - 1][0]).toBe('gone');
    expect(JSON.parse(storage.m.get('kh-theme-unsaved:b1:t1') as string).data).toEqual(d(2));
  });

  it('a 404 without a code is still an error', async () => {
    const put = jest.fn().mockResolvedValue({ status: 404, body: { error: 'Not here' } });
    const { q, statuses } = setup(put);
    q.schedule(d(1), true);
    await tick();
    expect(statuses[statuses.length - 1]).toEqual(['error', 'Not here']);
    q.retry();
    await tick();
    expect(put).toHaveBeenCalledTimes(2);
  });

  it('markConflict stops the queue with the conflict status', async () => {
    const put = jest.fn().mockResolvedValue(ok('v1'));
    const { q, statuses } = setup(put);
    q.markConflict();
    expect(statuses[statuses.length - 1][0]).toBe('conflict');
    q.schedule(d(1), true);
    jest.advanceTimersByTime(10000);
    await tick();
    q.retry();
    await tick();
    expect(put).not.toHaveBeenCalled();
    await expect(q.flush()).resolves.toBeUndefined();
  });

  it('markConflict cancels a pending debounced save', async () => {
    const put = jest.fn().mockResolvedValue(ok('v1'));
    const { q, statuses } = setup(put);
    q.schedule(d(1));
    q.markConflict();
    jest.advanceTimersByTime(10000);
    await tick();
    expect(put).not.toHaveBeenCalled();
    expect(statuses[statuses.length - 1][0]).toBe('conflict');
  });

  it('keeps the original message when scheduling after a stop', async () => {
    const put = jest
      .fn()
      .mockResolvedValue({ status: 409, body: { error: 'changed elsewhere', code: 'conflict' } });
    const { q, statuses } = setup(put);
    q.schedule(d(1), true);
    await tick();
    q.schedule(d(2));
    expect(statuses.filter((s) => s[0] === 'conflict')).toEqual([['conflict', 'changed elsewhere']]);
  });

  it('works when storage throws or is null', async () => {
    const put = jest.fn().mockResolvedValue(ok('v1'));
    const boom = () => {
      throw new Error('x');
    };
    const bad = { getItem: boom, setItem: boom, removeItem: boom };
    const q = new SaveQueue('b1', 't1', 'v0', { put, storage: bad, onStatus: () => {}, onSaved: () => {} });
    q.schedule(d(1), true);
    await tick();
    expect(put).toHaveBeenCalledTimes(1);
    expect(readBackup(bad, 'b1', 't1', 'v0')).toBeNull();
    expect(readBackup(null, 'b1', 't1', 'v0')).toBeNull();
  });
});

describe('readBackup', () => {
  it('marks a backup stale when the server moved on', () => {
    const s = memStorage({ 'kh-theme-unsaved:b1:t1': JSON.stringify({ data: d(1), base: 'v0' }) });
    expect(readBackup(s, 'b1', 't1', 'v0')).toEqual({ data: d(1), stale: false });
    expect(readBackup(s, 'b1', 't1', 'v9')).toEqual({ data: d(1), stale: true });
  });

  it('ignores corrupt JSON and wrong shapes', () => {
    expect(readBackup(memStorage({ 'kh-theme-unsaved:b1:t1': '{nope' }), 'b1', 't1', 'v0')).toBeNull();
    expect(readBackup(memStorage({ 'kh-theme-unsaved:b1:t1': '{"data":{}}' }), 'b1', 't1', 'v0')).toBeNull();
    expect(readBackup(memStorage(), 'b1', 't1', 'v0')).toBeNull();
  });
});

describe('sweepBackups', () => {
  function listStorage(seed: Record<string, string>) {
    const s = memStorage(seed);
    return {
      ...s,
      get length() {
        return s.m.size;
      },
      key: (i: number) => Array.from(s.m.keys())[i] ?? null,
    };
  }
  const uuid = '0f8b2c4e-1d2a-4b3c-9e8f-123456789abc';
  const now = 1_800_000_000_000;
  const DAY = 24 * 60 * 60 * 1000;
  const bk = (savedAt: number) => JSON.stringify({ data: {}, base: 'v', savedAt });

  it("with a list, drops this business's other themes and legacy keys, keeping the listed theme and other businesses", () => {
    const s = listStorage({
      'kh-theme-unsaved:b1:A': bk(now),
      'kh-theme-unsaved:b1:B': bk(now),
      'kh-theme-unsaved:b2:C': bk(now),
      [`kh-theme-unsaved:${uuid}`]: 'legacy',
      'kh-theme-unsaved:not-a-uuid': 'unknown',
      'something-else': 'x',
    });
    sweepBackups(s, 'b1', { keepThemeIds: ['A'], now });
    expect(Array.from(s.m.keys()).sort()).toEqual(
      ['kh-theme-unsaved:b1:A', 'kh-theme-unsaved:b2:C', 'kh-theme-unsaved:not-a-uuid', 'something-else'].sort(),
    );
  });

  it('without a list, drops only backups older than 14 days and legacy keys', () => {
    const s = listStorage({
      'kh-theme-unsaved:b1:new': bk(now - 13 * DAY),
      'kh-theme-unsaved:b1:old': bk(now - 15 * DAY),
      'kh-theme-unsaved:b2:old': bk(now - 15 * DAY),
      [`kh-theme-unsaved:${uuid}`]: 'legacy',
    });
    sweepBackups(s, 'b1', { now });
    expect(Array.from(s.m.keys()).sort()).toEqual(['kh-theme-unsaved:b1:new', 'kh-theme-unsaved:b2:old']);
  });

  it('honours maxAgeMs', () => {
    const s = listStorage({ 'kh-theme-unsaved:b1:t': bk(now - 2 * DAY) });
    sweepBackups(s, 'b1', { now, maxAgeMs: DAY });
    expect(s.m.size).toBe(0);
  });

  it('removes a malformed value, and one without a numeric savedAt', () => {
    const s = listStorage({
      'kh-theme-unsaved:b1:a': '{nope',
      'kh-theme-unsaved:b1:b': JSON.stringify({ data: {}, base: 'v' }),
    });
    sweepBackups(s, 'b1', { now });
    expect(s.m.size).toBe(0);
  });

  it('copes with missing or failing storage', () => {
    expect(() => sweepBackups(null, 'b1', { now })).not.toThrow();
    const boom = () => {
      throw new Error('denied');
    };
    expect(() =>
      sweepBackups({ length: 1, key: boom, removeItem: boom, getItem: boom } as unknown as Storage, 'b1', { now }),
    ).not.toThrow();
  });
});

describe('hasBackup', () => {
  it('is true only for a stored key', () => {
    const s = memStorage({ 'kh-theme-unsaved:b1:t1': '{}' });
    expect(hasBackup(s, 'b1', 't1')).toBe(true);
    expect(hasBackup(s, 'b1', 't2')).toBe(false);
    expect(hasBackup(s, 'b2', 't1')).toBe(false);
    expect(hasBackup(null, 'b1', 't1')).toBe(false);
  });
});

describe('backup JSON', () => {
  it('carries a numeric savedAt', () => {
    const put = jest.fn(() => new Promise<PutResult>(() => {}));
    const { storage, q } = setup(put as unknown as jest.Mock);
    q.schedule(d(1));
    const parsed = JSON.parse(storage.m.get('kh-theme-unsaved:b1:t1') as string);
    expect(typeof parsed.savedAt).toBe('number');
    expect(parsed.base).toBe('v0');
    q.dispose();
  });
});
