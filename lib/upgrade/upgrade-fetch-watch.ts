import { upgradeRequestFromResponse, type UpgradeRequest } from './upgrade-request';

let mountedDialogs = 0;

/** Every upgrade dialog calls this while it is on screen; returns the cleanup. */
export function markUpgradeDialogMounted(): () => void {
  mountedDialogs += 1;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    mountedDialogs = Math.max(0, mountedDialogs - 1);
  };
}

export function isAnyUpgradeDialogMounted(): boolean {
  return mountedDialogs > 0;
}

export interface UpgradeFetchWatchOptions {
  open(req: UpgradeRequest): void;
  isDialogOpen(): boolean;
  /** Pages that handle the reply themselves get this long to open their own popup first. */
  delayMs?: number;
  target?: { fetch: typeof fetch };
  origin?: string;
}

function requestUrlAndMethod(input: RequestInfo | URL, init?: RequestInit): { url: string; method: string } {
  if (typeof input === 'string') return { url: input, method: init?.method ?? 'GET' };
  if (input instanceof URL) return { url: input.href, method: init?.method ?? 'GET' };
  return { url: input.url, method: init?.method ?? input.method ?? 'GET' };
}

function isOwnApi(url: string, origin: string): boolean {
  if (url.startsWith('/')) return url.startsWith('/api/');
  try {
    const parsed = new URL(url);
    return parsed.origin === origin && parsed.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

/**
 * Wraps fetch so any "not in your plan" or "limit reached" reply to a write opens the upgrade
 * popup, even on screens that only show the error text. Returns the uninstall function.
 */
export function installUpgradeFetchWatch(opts: UpgradeFetchWatchOptions): () => void {
  const target = opts.target ?? (globalThis as unknown as { fetch: typeof fetch });
  const origin = opts.origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  const delayMs = opts.delayMs ?? 250;
  const original = target.fetch;

  const watched: typeof fetch = async (input, init) => {
    const response = await original.call(globalThis, input, init);
    if (response.status !== 403) return response;
    const { url, method } = requestUrlAndMethod(input, init);
    if (!isOwnApi(url, origin)) return response;

    void response
      .clone()
      .json()
      .then((body: unknown) => {
        const req = upgradeRequestFromResponse(
          method,
          response.status,
          body && typeof body === 'object' ? (body as Record<string, unknown>) : null,
        );
        if (!req) return;
        setTimeout(() => {
          if (!opts.isDialogOpen()) opts.open(req);
        }, delayMs);
      })
      .catch(() => undefined);
    return response;
  };

  target.fetch = watched;
  return () => {
    if (target.fetch === watched) target.fetch = original;
  };
}
