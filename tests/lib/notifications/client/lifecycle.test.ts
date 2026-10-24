/**
 * browserLifecycle wiring: online/offline, visibilitychange, bfcache restore, and the
 * Capacitor App resume/pause events (JS plugin already in the APK), including cleanup.
 */
const capListeners = new Map<string, () => void>();
const removed: string[] = [];
jest.mock(
  '@capacitor/app',
  () => ({
    App: {
      addListener: jest.fn(async (name: string, fn: () => void) => {
        capListeners.set(name, fn);
        return { remove: async () => void removed.push(name) };
      }),
    },
  }),
  { virtual: false }
);

import { browserLifecycle, type LifecycleSignal } from '@/lib/notifications/client/lifecycle';

class FakeDocument extends EventTarget {
  visibilityState: 'visible' | 'hidden' = 'visible';
}

const g = globalThis as unknown as Record<string, unknown>;

beforeEach(() => {
  capListeners.clear();
  removed.length = 0;
  g.window = Object.assign(new EventTarget(), { Capacitor: { isNativePlatform: () => true } });
  g.document = new FakeDocument();
});

afterEach(() => {
  delete g.window;
  delete g.document;
});

const flush = () => new Promise((r) => setImmediate(r));

it('maps browser and Capacitor events to lifecycle signals and removes them all', async () => {
  const signals: LifecycleSignal[] = [];
  const lifecycle = browserLifecycle();
  const off = lifecycle.subscribe((s) => signals.push(s));
  await flush();

  const win = g.window as EventTarget;
  const doc = g.document as FakeDocument;
  win.dispatchEvent(new Event('offline'));
  win.dispatchEvent(new Event('online'));
  doc.visibilityState = 'hidden';
  doc.dispatchEvent(new Event('visibilitychange'));
  expect(lifecycle.isVisible()).toBe(false);
  doc.visibilityState = 'visible';
  doc.dispatchEvent(new Event('visibilitychange'));
  win.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
  win.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));
  capListeners.get('pause')!();
  capListeners.get('resume')!();

  expect(signals).toEqual(['offline', 'online', 'hidden', 'visible', 'resume', 'hidden', 'resume']);

  off();
  await flush();
  expect(removed.sort()).toEqual(['pause', 'resume']);
  win.dispatchEvent(new Event('online'));
  doc.dispatchEvent(new Event('visibilitychange'));
  expect(signals).toHaveLength(7);
});

it('removes Capacitor listeners that register after unsubscribe', async () => {
  const off = browserLifecycle().subscribe(() => {});
  off();
  await flush();
  expect(removed.sort()).toEqual(['pause', 'resume']);
});

it('skips Capacitor outside the native shell', async () => {
  (g.window as { Capacitor?: unknown }).Capacitor = undefined;
  const off = browserLifecycle().subscribe(() => {});
  await flush();
  expect(capListeners.size).toBe(0);
  off();
});
