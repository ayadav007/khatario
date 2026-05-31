'use client';

/**
 * TEMPORARY diagnostic for runaway JS event listener accumulation.
 *
 * Enable in browser console or before load:
 *   localStorage.setItem('khatario_debug_listeners', '1')
 * then hard-reload.
 *
 * Inspect: window.__KHATARIO_LISTENER_PROBE__
 * Reset counts: window.__KHATARIO_LISTENER_PROBE__.reset()
 */

const STORAGE_KEY = 'khatario_debug_listeners';
const REPORT_MS = 5000;
const SPIKE_DELTA = 250;
const TRACE_EVERY = 50;

type ListenerBucket = {
  registered: number;
  removed: number;
  net: number;
};

type ProbeSnapshot = {
  ts: number;
  totals: {
    registered: number;
    removed: number;
    net: number;
  };
  byKind: Record<string, ListenerBucket>;
  byEvent: Record<string, ListenerBucket>;
  intervals: { active: number; created: number; cleared: number };
  observers: { resize: number; mutation: number; intersection: number };
  eventSources: { created: number; closed: number; active: number };
  recentSpikes: Array<{ ts: number; delta: number; kind: string; event: string }>;
};

function shouldEnable(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function targetKind(target: EventTarget | null): string {
  if (target === window) return 'window';
  if (target === document) return 'document';
  if (target instanceof DocumentFragment) return 'documentFragment';
  if (target instanceof Element) return `element:${target.tagName.toLowerCase()}`;
  if (target === null || target === undefined) return 'unknown';
  const name = (target as { constructor?: { name?: string } }).constructor?.name;
  return name ? `object:${name}` : 'object:EventTarget';
}

function bump(map: Record<string, ListenerBucket>, key: string, field: 'registered' | 'removed') {
  if (!map[key]) map[key] = { registered: 0, removed: 0, net: 0 };
  map[key][field] += 1;
  map[key].net = map[key].registered - map[key].removed;
}

let installed = false;

export function installListenerLeakProbe(): void {
  if (installed || typeof window === 'undefined' || !shouldEnable()) return;
  installed = true;

  const byKind: Record<string, ListenerBucket> = {};
  const byEvent: Record<string, ListenerBucket> = {};
  let totalRegistered = 0;
  let totalRemoved = 0;
  let intervalCreated = 0;
  let intervalCleared = 0;
  let activeIntervals = 0;
  let resizeObservers = 0;
  let mutationObservers = 0;
  let intersectionObservers = 0;
  let eventSourcesCreated = 0;
  let eventSourcesClosed = 0;
  let activeEventSources = 0;
  let lastReportNet = 0;
  let lastReportAt = Date.now();
  const recentSpikes: ProbeSnapshot['recentSpikes'] = [];
  let traceCounter = 0;

  const snapshot = (): ProbeSnapshot => ({
    ts: Date.now(),
    totals: {
      registered: totalRegistered,
      removed: totalRemoved,
      net: totalRegistered - totalRemoved,
    },
    byKind,
    byEvent,
    intervals: { active: activeIntervals, created: intervalCreated, cleared: intervalCleared },
    observers: {
      resize: resizeObservers,
      mutation: mutationObservers,
      intersection: intersectionObservers,
    },
    eventSources: {
      created: eventSourcesCreated,
      closed: eventSourcesClosed,
      active: activeEventSources,
    },
    recentSpikes: [...recentSpikes].slice(-20),
  });

  const maybeTrace = (label: string) => {
    traceCounter += 1;
    if (traceCounter % TRACE_EVERY === 0) {
      console.warn(`[LISTENER-PROBE] ${label} (net=${totalRegistered - totalRemoved})`);
      console.trace();
    }
  };

  const proto = EventTarget.prototype;
  const origAdd = proto.addEventListener;
  const origRemove = proto.removeEventListener;

  proto.addEventListener = function patchedAdd(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ) {
    const kind = targetKind(this);
    totalRegistered += 1;
    bump(byKind, kind, 'registered');
    bump(byEvent, String(type), 'registered');
    maybeTrace(`addEventListener ${String(type)} on ${kind}`);
    return origAdd.call(this, type, listener as EventListener, options);
  };

  proto.removeEventListener = function patchedRemove(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions
  ) {
    const kind = targetKind(this);
    totalRemoved += 1;
    bump(byKind, kind, 'removed');
    bump(byEvent, String(type), 'removed');
    return origRemove.call(this, type, listener as EventListener, options);
  };

  const origSetInterval = window.setInterval.bind(window);
  const origClearInterval = window.clearInterval.bind(window);

  window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    intervalCreated += 1;
    activeIntervals += 1;
    const id = origSetInterval(handler, timeout ?? 0, ...(args as []));
    return id;
  }) as typeof window.setInterval;

  window.clearInterval = ((id?: number | NodeJS.Timeout) => {
    intervalCleared += 1;
    activeIntervals = Math.max(0, activeIntervals - 1);
    return origClearInterval(id);
  }) as typeof window.clearInterval;

  if (typeof ResizeObserver !== 'undefined') {
    const OrigResizeObserver = ResizeObserver;
    window.ResizeObserver = class PatchedResizeObserver extends OrigResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeObservers += 1;
        super(callback);
      }
    } as typeof ResizeObserver;
  }

  if (typeof MutationObserver !== 'undefined') {
    const OrigMutationObserver = MutationObserver;
    window.MutationObserver = class PatchedMutationObserver extends MutationObserver {
      constructor(callback: MutationCallback) {
        mutationObservers += 1;
        super(callback);
      }
    } as typeof MutationObserver;
  }

  if (typeof IntersectionObserver !== 'undefined') {
    const OrigIntersectionObserver = IntersectionObserver;
    window.IntersectionObserver = class PatchedIntersectionObserver extends IntersectionObserver {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        intersectionObservers += 1;
        super(callback, options);
      }
    } as typeof IntersectionObserver;
  }

  if (typeof EventSource !== 'undefined') {
    const OrigEventSource = EventSource;
    window.EventSource = class PatchedEventSource extends OrigEventSource {
      constructor(url: string | URL, eventSourceInitDict?: EventSourceInit) {
        super(url, eventSourceInitDict);
        eventSourcesCreated += 1;
        activeEventSources += 1;
        this.addEventListener('error', () => {
          /* track close via property when possible */
        });
      }
      close(): void {
        if (this.readyState !== EventSource.CLOSED) {
          eventSourcesClosed += 1;
          activeEventSources = Math.max(0, activeEventSources - 1);
        }
        super.close();
      }
    } as typeof EventSource;
  }

  const reportTimer = origSetInterval(() => {
    const now = Date.now();
    const net = totalRegistered - totalRemoved;
    const delta = net - lastReportNet;
    if (delta >= SPIKE_DELTA) {
      const topKinds = Object.entries(byKind)
        .sort((a, b) => b[1].net - a[1].net)
        .slice(0, 5)
        .map(([k, v]) => `${k}=${v.net}`)
        .join(', ');
      const spike = { ts: now, delta, kind: topKinds, event: '' };
      recentSpikes.push(spike);
      console.error(
        `[LISTENER-PROBE] net +${delta} in ${Math.round((now - lastReportAt) / 1000)}s (net=${net}). Top: ${topKinds}`
      );
    }
    lastReportNet = net;
    lastReportAt = now;
  }, REPORT_MS);

  const api = {
    snapshot,
    reset: () => {
      for (const key of Object.keys(byKind)) delete byKind[key];
      for (const key of Object.keys(byEvent)) delete byEvent[key];
      totalRegistered = 0;
      totalRemoved = 0;
      lastReportNet = 0;
      recentSpikes.length = 0;
      traceCounter = 0;
    },
    disable: () => {
      origClearInterval(reportTimer);
      installed = false;
    },
  };

  (window as unknown as { __KHATARIO_LISTENER_PROBE__?: typeof api }).__KHATARIO_LISTENER_PROBE__ =
    api;

  console.warn(
    '[LISTENER-PROBE] Active. Stats at window.__KHATARIO_LISTENER_PROBE__.snapshot(). Disable: localStorage.removeItem("khatario_debug_listeners") + reload.'
  );
}
