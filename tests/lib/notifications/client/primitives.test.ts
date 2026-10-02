import {
  backoffDelay,
  BoundedSet,
  CursorStore,
  parseRetryAfter,
  type KeyValueStorage,
} from '@/lib/notifications/client/primitives';
import { MemoryStorage } from './client-harness';

const A = { businessId: 'biz-a', userId: 'user-1' };
const B = { businessId: 'biz-b', userId: 'user-1' };

describe('backoffDelay', () => {
  it('starts near 1s, doubles, caps at 60s, and stays within ±20% jitter', () => {
    const bases = [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000];
    bases.forEach((base, attempt) => {
      expect(backoffDelay(attempt, () => 0)).toBe(Math.round(base * 0.8));
      expect(backoffDelay(attempt, () => 1)).toBe(Math.min(60000, Math.round(base * 1.2)));
      for (let i = 0; i < 50; i += 1) {
        const d = backoffDelay(attempt, Math.random);
        expect(d).toBeGreaterThanOrEqual(Math.round(base * 0.8));
        expect(d).toBeLessThanOrEqual(Math.min(60000, Math.round(base * 1.2)));
      }
    });
    expect(backoffDelay(1000, () => 1)).toBe(60000);
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds and HTTP dates', () => {
    const now = Date.parse('2026-10-02T10:00:00Z');
    expect(parseRetryAfter('30', now)).toBe(30000);
    expect(parseRetryAfter(' 5 ', now)).toBe(5000);
    expect(parseRetryAfter('Fri, 02 Oct 2026 10:00:12 GMT', now)).toBe(12000);
    expect(parseRetryAfter('Fri, 02 Oct 2026 09:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter('soon', now)).toBeNull();
  });
});

describe('CursorStore', () => {
  it('persists per session (business + user) and isolates sessions', () => {
    const storage = new MemoryStorage();
    const a = new CursorStore(storage, A);
    a.advance('1000000000010');
    expect(new CursorStore(storage, A).read()).toBe('1000000000010');
    expect(new CursorStore(storage, B).read()).toBeNull();
    expect(new CursorStore(storage, { businessId: 'biz-a', userId: 'user-2' }).read()).toBeNull();
  });

  it('only moves forward on advance, compares as bigint, and lets resync move it back', () => {
    const c = new CursorStore(new MemoryStorage(), A);
    c.advance('9');
    c.advance('10');
    c.advance('2');
    expect(c.read()).toBe('10');
    c.advance('999999999999999999');
    expect(c.read()).toBe('999999999999999999');
    c.set('5');
    expect(c.read()).toBe('5');
  });

  it('takes the furthest value written by another tab', () => {
    const storage = new MemoryStorage();
    const tab1 = new CursorStore(storage, A);
    const tab2 = new CursorStore(storage, A);
    tab1.advance('20');
    expect(tab2.advance('15')).toBe('20');
    expect(tab2.read()).toBe('20');
  });

  it('ignores junk values and works without storage', () => {
    const storage = new MemoryStorage();
    const c = new CursorStore(storage, A);
    storage.setItem(c.key, 'garbage');
    expect(c.read()).toBeNull();
    c.advance('abc');
    expect(c.read()).toBeNull();

    const throwing: KeyValueStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    };
    const m = new CursorStore(throwing, A);
    m.advance('3');
    expect(m.read()).toBe('3');
    expect(new CursorStore(null, A).read()).toBeNull();
  });
});

describe('BoundedSet', () => {
  it('keeps at most max entries, forgetting the oldest', () => {
    const s = new BoundedSet(3);
    ['1', '2', '3', '4'].forEach((k) => s.add(k));
    expect(s.size).toBe(3);
    expect(s.has('1')).toBe(false);
    s.add('2'); // refresh
    s.add('5');
    expect(s.has('2')).toBe(true);
    expect(s.has('3')).toBe(false);
  });
});
