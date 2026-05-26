/**
 * @jest-environment node
 */
import {
  saveDashboardSnapshot,
  loadDashboardSnapshot,
  clearDashboardSnapshotsForUser,
} from '@/lib/dashboard-snapshot';

function installLocalStorageMock() {
  const store = new Map<string, string>();
  const mock = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    get length() {
      return store.size;
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
  };
  Object.defineProperty(global, 'localStorage', { value: mock, writable: true });
  Object.defineProperty(global, 'window', { value: global, writable: true });
}

describe('dashboard snapshot', () => {
  beforeEach(() => {
    installLocalStorageMock();
    localStorage.clear();
  });

  it('round-trips overview data', () => {
    const data = { sales: 100, purchases: 40, profit: 60 };
    saveDashboardSnapshot('b1', 'u1', '2024-01-01_2024-01-01', data);
    const loaded = loadDashboardSnapshot('b1', 'u1', '2024-01-01_2024-01-01');
    expect(loaded?.data).toEqual(data);
    expect(loaded?.timestamp).toBeGreaterThan(0);
  });

  it('clears per-user snapshots', () => {
    saveDashboardSnapshot('b1', 'u1', 'range-a', { sales: 1 });
    saveDashboardSnapshot('b1', 'u1', 'range-b', { sales: 2 });
    clearDashboardSnapshotsForUser('b1', 'u1');
    expect(loadDashboardSnapshot('b1', 'u1', 'range-a')).toBeNull();
  });
});
