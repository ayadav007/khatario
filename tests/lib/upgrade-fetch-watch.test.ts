import { installUpgradeFetchWatch } from '@/lib/upgrade/upgrade-fetch-watch';
import { isUpgradeSnoozed, snoozeUpgrade } from '@/lib/upgrade/upgrade-snooze';
import type { UpgradeRequest } from '@/lib/upgrade/upgrade-request';

const ORIGIN = 'https://staging.khatario.com';

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function setup(response: Response, dialogOpen = false) {
  const target = { fetch: jest.fn(async () => response.clone()) as unknown as typeof fetch };
  const opened: UpgradeRequest[] = [];
  const uninstall = installUpgradeFetchWatch({
    open: (req) => opened.push(req),
    isDialogOpen: () => dialogOpen,
    target,
    origin: ORIGIN,
  });
  return { target, opened, uninstall };
}

const limitReply = { code: 'SUBSCRIPTION_LIMIT_EXCEEDED', limit_type: 'estimates', limit: 20, current: 20 };

describe('installUpgradeFetchWatch', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('opens the popup after a short wait for a limit reply on a write', async () => {
    const { target, opened } = setup(reply(403, limitReply));
    await target.fetch('/api/estimates', { method: 'POST' });
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(249);
    expect(opened).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(1);
    expect(opened).toEqual([{ variant: 'limit', limitType: 'estimates', limit: 20, current: 20 }]);
  });

  it('stays quiet when the page already opened a popup', async () => {
    const { target, opened } = setup(reply(403, limitReply), true);
    await target.fetch('/api/estimates', { method: 'POST' });
    await jest.advanceTimersByTimeAsync(300);
    expect(opened).toHaveLength(0);
  });

  it('ignores reads', async () => {
    const { target, opened } = setup(reply(403, { code: 'FEATURE_NOT_IN_PLAN', feature: 'eway_bill' }));
    await target.fetch('/api/settings/document-language');
    await jest.advanceTimersByTimeAsync(300);
    expect(opened).toHaveLength(0);
  });

  it('ignores other sites', async () => {
    const { target, opened } = setup(reply(403, limitReply));
    await target.fetch('https://example.com/api/estimates', { method: 'POST' });
    await jest.advanceTimersByTimeAsync(300);
    expect(opened).toHaveLength(0);
  });

  it('watches full same-site URLs and Request objects', async () => {
    const { target, opened } = setup(reply(403, limitReply));
    await target.fetch(`${ORIGIN}/api/estimates`, { method: 'POST' });
    await target.fetch(new Request(`${ORIGIN}/api/estimates`, { method: 'POST' }));
    await jest.advanceTimersByTimeAsync(300);
    expect(opened).toHaveLength(2);
  });

  it('leaves the reply readable for the caller', async () => {
    const { target } = setup(reply(403, limitReply));
    const res = await target.fetch('/api/estimates', { method: 'POST' });
    await expect(res.json()).resolves.toEqual(limitReply);
  });

  it('restores the original fetch on uninstall', () => {
    const original = jest.fn() as unknown as typeof fetch;
    const target = { fetch: original };
    const uninstall = installUpgradeFetchWatch({ open: () => {}, isDialogOpen: () => false, target, origin: ORIGIN });
    expect(target.fetch).not.toBe(original);
    uninstall();
    expect(target.fetch).toBe(original);
  });
});

describe('upgrade snooze', () => {
  function memoryStore() {
    const map = new Map<string, string>();
    return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
  }

  it('lasts until the end of the day', () => {
    const store = memoryStore();
    snoozeUpgrade('limit:users', new Date(2026, 10, 2, 9, 0), store);
    expect(isUpgradeSnoozed('limit:users', new Date(2026, 10, 2, 23, 59), store)).toBe(true);
    expect(isUpgradeSnoozed('limit:users', new Date(2026, 10, 3, 0, 1), store)).toBe(false);
    expect(isUpgradeSnoozed('feature:eway_bill', new Date(2026, 10, 2, 10, 0), store)).toBe(false);
  });
});
