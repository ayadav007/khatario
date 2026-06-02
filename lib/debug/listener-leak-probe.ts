/**
 * Event listener leak attribution (dev/staging only).
 *
 * Enable before hard reload:
 *   localStorage.setItem('khatario_debug_listeners', '1')
 * Optional verbose stacks on every add:
 *   localStorage.setItem('khatario:listener-probe-verbose', '1')
 *
 * Inspect: window.__KHATARIO_LISTENER_PROBE__.snapshot()
 * Top leakers: window.__KHATARIO_LISTENER_PROBE__.topLeakers(15)
 */

export const LISTENER_PROBE_STORAGE_KEY = 'khatario_debug_listeners';
const VERBOSE_KEY = 'khatario:listener-probe-verbose';
const REPORT_MS = 5000;

export type ListenerLeakPhase = 'render' | 'effect' | 'event' | 'navigation' | 'unknown';

export type SourceAttribution = {
  file: string;
  line: number;
  column: number;
  functionName: string;
  component: string | null;
  phase: ListenerLeakPhase;
  rawStackLine: string;
};

export type ListenerLeakBucket = {
  key: string;
  file: string;
  component: string | null;
  eventType: string;
  targetKind: string;
  phase: ListenerLeakPhase;
  adds: number;
  removes: number;
  duplicates: number;
  unmatchedRemoves: number;
  renderPhaseAdds: number;
  net: number;
  lastStack: string;
};

export type ListenerProbeRates = {
  addsPerSec: number;
  removesPerSec: number;
  netGrowthPerSec: number;
};

export type ListenerProbeSnapshot = {
  ts: number;
  enabled: boolean;
  totals: {
    adds: number;
    removes: number;
    net: number;
    activeEstimate: number;
    duplicates: number;
    unmatchedRemoves: number;
    renderPhaseAdds: number;
  };
  rates: ListenerProbeRates;
  byEvent: Record<string, { adds: number; removes: number; net: number }>;
  byTargetKind: Record<string, { adds: number; removes: number; net: number }>;
  topLeakers: ListenerLeakBucket[];
  recentRenderPhaseAdds: Array<{ ts: number; event: string; source: SourceAttribution }>;
  intervals: { active: number; created: number; cleared: number };
  observers: { resize: number; mutation: number; intersection: number };
  eventSources: { created: number; closed: number; active: number };
};

function shouldEnable(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(LISTENER_PROBE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function isVerbose(): boolean {
  try {
    return localStorage.getItem(VERBOSE_KEY) === '1';
  } catch {
    return false;
  }
}

function targetKind(target: EventTarget | null): string {
  if (target === window) return 'window';
  if (target === document) return 'document';
  if (target instanceof DocumentFragment) return 'documentFragment';
  if (target instanceof Element) {
    const id = target.id ? `#${target.id}` : '';
    const cls =
      typeof target.className === 'string' && target.className
        ? `.${target.className.split(/\s+/).slice(0, 2).join('.')}`
        : '';
    return `element:${target.tagName.toLowerCase()}${id}${cls}`;
  }
  if (target === null || target === undefined) return 'unknown';
  const name = (target as { constructor?: { name?: string } }).constructor?.name;
  return name ? `object:${name}` : 'object:EventTarget';
}

function detectPhase(stack: string): ListenerLeakPhase {
  if (
    stack.includes('commitHookEffectListMount') ||
    stack.includes('commitHookPassiveMountEffects') ||
    stack.includes('flushPassiveEffects') ||
    stack.includes('invokePassiveEffectMount')
  ) {
    return 'effect';
  }
  if (
    stack.includes('renderWithHooks') ||
    stack.includes('updateFunctionComponent') ||
    stack.includes('beginWork') ||
    stack.includes('performUnitOfWork')
  ) {
    return 'render';
  }
  if (stack.includes('popstate') || stack.includes('route') || stack.includes('navigation')) {
    return 'navigation';
  }
  return 'unknown';
}

function parseStack(skipFrames = 4): SourceAttribution {
  const stack = new Error().stack || '';
  const lines = stack.split('\n').slice(skipFrames);
  const fallback: SourceAttribution = {
    file: 'unknown',
    line: 0,
    column: 0,
    functionName: 'unknown',
    component: null,
    phase: detectPhase(stack),
    rawStackLine: lines[0]?.trim() || '',
  };

  for (const line of lines) {
    if (!line.trim()) continue;
    if (line.includes('listener-leak-probe')) continue;

    const compMatch = line.match(/\bat\s+([A-Z][A-Za-z0-9_$]+)\s/);
    const component = compMatch?.[1] ?? null;

    const webpack = line.match(/\/([^/]+\.(?:tsx|ts|jsx|js))[?:](\d+)(?::(\d+))?/);
    if (webpack) {
      return {
        file: webpack[1],
        line: Number(webpack[2]) || 0,
        column: Number(webpack[3]) || 0,
        functionName: component || 'anonymous',
        component,
        phase: detectPhase(stack),
        rawStackLine: line.trim(),
      };
    }

    const std = line.match(/\(([^)]+):(\d+):(\d+)\)/) || line.match(/at ([^ ]+):(\d+):(\d+)/);
    if (std) {
      const path = std[1];
      const file = path.split(/[/\\]/).pop() || path;
      return {
        file,
        line: Number(std[2]) || 0,
        column: Number(std[3]) || 0,
        functionName: component || 'anonymous',
        component,
        phase: detectPhase(stack),
        rawStackLine: line.trim(),
      };
    }
  }

  return fallback;
}

function bucketKey(source: SourceAttribution, eventType: string, targetKindStr: string): string {
  const loc = `${source.file}:${source.line}`;
  const comp = source.component ? `${source.component}@` : '';
  return `${comp}${loc}|${targetKindStr}|${eventType}`;
}

let installed = false;
let probeInstalledAt = 0;

let totalAdds = 0;
let totalRemoves = 0;
let duplicateAdds = 0;
let unmatchedRemoves = 0;
let renderPhaseAdds = 0;

let windowAdds = 0;
let windowRemoves = 0;
let lastReportAt = 0;
let lastReportNet = 0;

const buckets = new Map<string, ListenerLeakBucket>();
const recentRenderAdds: ListenerProbeSnapshot['recentRenderPhaseAdds'] = [];

/** Per-target active listener keys (target -> event -> Set<listenerKey>) */
const activeRegistry = new WeakMap<
  EventTarget,
  Map<string, Set<string>>
>();

const fnIdMap = new WeakMap<Function, number>();
let nextFnId = 1;

function listenerIdentity(listener: EventListenerOrEventListenerObject | null): string {
  if (listener === null) return 'null';
  if (typeof listener === 'function') {
    let id = fnIdMap.get(listener);
    if (id === undefined) {
      id = nextFnId++;
      fnIdMap.set(listener, id);
    }
    return `fn#${id}`;
  }
  return `obj:${String(listener)}`;
}

function optionsKey(options?: boolean | AddEventListenerOptions): string {
  if (options === undefined || options === false) return '';
  if (options === true) return '|capture';
  const capture = options.capture ? '|capture' : '';
  const once = options.once ? '|once' : '';
  const passive = options.passive ? '|passive' : '';
  return `${capture}${once}${passive}`;
}

function registryKey(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions): string {
  return `${type}|${listenerIdentity(listener)}${optionsKey(options)}`;
}

function getTargetMap(target: EventTarget): Map<string, Set<string>> {
  let map = activeRegistry.get(target);
  if (!map) {
    map = new Map();
    activeRegistry.set(target, map);
  }
  return map;
}

function activeEstimate(): number {
  // WeakMap cannot be iterated; track running estimate separately
  return activeCountEstimate;
}

let activeCountEstimate = 0;

function bumpBucket(
  source: SourceAttribution,
  eventType: string,
  targetKindStr: string,
  field: 'adds' | 'removes' | 'duplicates' | 'unmatchedRemoves' | 'renderPhaseAdds'
): void {
  const key = bucketKey(source, eventType, targetKindStr);
  let b = buckets.get(key);
  if (!b) {
    b = {
      key,
      file: source.file,
      component: source.component,
      eventType,
      targetKind: targetKindStr,
      phase: source.phase,
      adds: 0,
      removes: 0,
      duplicates: 0,
      unmatchedRemoves: 0,
      renderPhaseAdds: 0,
      net: 0,
      lastStack: source.rawStackLine,
    };
    buckets.set(key, b);
  }
  b[field] += 1;
  if (field === 'adds' || field === 'removes') {
    b.net = b.adds - b.removes;
  }
  b.lastStack = source.rawStackLine;
}

function recordByEvent(eventType: string, field: 'adds' | 'removes'): void {
  const map = byEventTotals;
  if (!map[eventType]) map[eventType] = { adds: 0, removes: 0, net: 0 };
  map[eventType][field] += 1;
  map[eventType].net = map[eventType].adds - map[eventType].removes;
}

function recordByTarget(kind: string, field: 'adds' | 'removes'): void {
  const map = byTargetTotals;
  if (!map[kind]) map[kind] = { adds: 0, removes: 0, net: 0 };
  map[kind][field] += 1;
  map[kind].net = map[kind].adds - map[kind].removes;
}

const byEventTotals: Record<string, { adds: number; removes: number; net: number }> = {};
const byTargetTotals: Record<string, { adds: number; removes: number; net: number }> = {};

let intervalCreated = 0;
let intervalCleared = 0;
let activeIntervals = 0;
let resizeObservers = 0;
let mutationObservers = 0;
let intersectionObservers = 0;
let eventSourcesCreated = 0;
let eventSourcesClosed = 0;
let activeEventSources = 0;

function topLeakers(limit = 15): ListenerLeakBucket[] {
  return [...buckets.values()]
    .sort((a, b) => b.net - a.net || b.adds - a.adds)
    .slice(0, limit);
}

function buildRates(): ListenerProbeRates {
  const elapsed = Math.max(1, (Date.now() - lastReportAt) / 1000);
  return {
    addsPerSec: windowAdds / elapsed,
    removesPerSec: windowRemoves / elapsed,
    netGrowthPerSec: (totalAdds - totalRemoves - lastReportNet) / elapsed,
  };
}

function snapshot(): ListenerProbeSnapshot {
  return {
    ts: Date.now(),
    enabled: true,
    totals: {
      adds: totalAdds,
      removes: totalRemoves,
      net: totalAdds - totalRemoves,
      activeEstimate: activeEstimate(),
      duplicates: duplicateAdds,
      unmatchedRemoves,
      renderPhaseAdds,
    },
    rates: buildRates(),
    byEvent: { ...byEventTotals },
    byTargetKind: { ...byTargetTotals },
    topLeakers: topLeakers(20),
    recentRenderPhaseAdds: [...recentRenderAdds].slice(-30),
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
  };
}

function printReport(): void {
  const now = Date.now();
  const net = totalAdds - totalRemoves;
  const deltaNet = net - lastReportNet;
  const elapsedSec = Math.max(1, Math.round((now - lastReportAt) / 1000));
  const rates = buildRates();

  const top = topLeakers(12)
    .filter((b) => b.adds > 0 || b.net > 0)
    .map((b) => {
      const comp = b.component ? `${b.component} ` : '';
      return (
        `  ${comp}${b.file}:${b.eventType}@${b.targetKind.split(':')[0]} ` +
        `adds=${b.adds} removes=${b.removes} net=${b.net} dup=${b.duplicates} ` +
        `phase=${b.phase}${b.renderPhaseAdds ? ` RENDER+${b.renderPhaseAdds}` : ''}`
      );
    })
    .join('\n');

  console.groupCollapsed(
    `[LISTENER-PROBE] ${elapsedSec}s | net=${net} (+${deltaNet}, ${rates.netGrowthPerSec.toFixed(0)}/s) ` +
      `adds=${rates.addsPerSec.toFixed(0)}/s removes=${rates.removesPerSec.toFixed(0)}/s ` +
      `active≈${activeCountEstimate} dup=${duplicateAdds} unmatchedRm=${unmatchedRemoves} ` +
      `renderAdds=${renderPhaseAdds}`
  );
  if (top) console.warn(top);
  if (renderPhaseAdds > 0) {
    console.error(
      '[LISTENER-PROBE] CRITICAL: addEventListener called during React render. See recentRenderPhaseAdds in snapshot().'
    );
  }
  console.groupEnd();

  lastReportNet = net;
  lastReportAt = now;
  windowAdds = 0;
  windowRemoves = 0;
}

/** Install global listener instrumentation. Idempotent. */
export function installListenerLeakProbe(): void {
  if (installed || typeof window === 'undefined' || !shouldEnable()) return;
  installed = true;
  probeInstalledAt = Date.now();
  lastReportAt = probeInstalledAt;

  const proto = EventTarget.prototype;
  const origAdd = proto.addEventListener;
  const origRemove = proto.removeEventListener;

  proto.addEventListener = function patchedAdd(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ) {
    const source = parseStack(5);
    const kind = targetKind(this);
    const rKey = registryKey(String(type), listener, options);
    const tMap = getTargetMap(this);
    let set = tMap.get(String(type));
    if (!set) {
      set = new Set();
      tMap.set(String(type), set);
    }

    totalAdds += 1;
    windowAdds += 1;
    recordByEvent(String(type), 'adds');
    recordByTarget(kind, 'adds');

    if (set.has(rKey)) {
      duplicateAdds += 1;
      bumpBucket(source, String(type), kind, 'duplicates');
    } else {
      set.add(rKey);
      activeCountEstimate += 1;
    }

    if (source.phase === 'render') {
      renderPhaseAdds += 1;
      bumpBucket(source, String(type), kind, 'renderPhaseAdds');
      recentRenderAdds.push({ ts: Date.now(), event: String(type), source });
      if (recentRenderAdds.length > 50) recentRenderAdds.shift();
      console.error(
        `[LISTENER-PROBE] addEventListener during RENDER: ${String(type)} on ${kind} at ${source.file}:${source.line}`,
        source.rawStackLine
      );
    } else {
      bumpBucket(source, String(type), kind, 'adds');
    }

    if (isVerbose()) {
      console.debug(`[LISTENER-PROBE] +${String(type)} ${kind} ${source.file}:${source.line} (${source.phase})`);
    }

    return origAdd.call(this, type, listener as EventListener, options);
  };

  proto.removeEventListener = function patchedRemove(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions
  ) {
    const source = parseStack(5);
    const kind = targetKind(this);
    const rKey = registryKey(String(type), listener, options);
    const tMap = getTargetMap(this);
    const set = tMap.get(String(type));

    totalRemoves += 1;
    windowRemoves += 1;
    recordByEvent(String(type), 'removes');
    recordByTarget(kind, 'removes');
    bumpBucket(source, String(type), kind, 'removes');

    if (!set || !set.has(rKey)) {
      unmatchedRemoves += 1;
      bumpBucket(source, String(type), kind, 'unmatchedRemoves');
      if (isVerbose()) {
        console.warn(
          `[LISTENER-PROBE] remove without matching add: ${String(type)} ${kind} ${listenerIdentity(listener)}`
        );
      }
    } else {
      set.delete(rKey);
      activeCountEstimate = Math.max(0, activeCountEstimate - 1);
    }

    return origRemove.call(this, type, listener as EventListener, options);
  };

  const origSetInterval = window.setInterval.bind(window);
  const origClearInterval = window.clearInterval.bind(window);

  window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    intervalCreated += 1;
    activeIntervals += 1;
    return origSetInterval(handler, timeout ?? 0, ...(args as []));
  }) as typeof window.setInterval;

  window.clearInterval = ((id?: number | NodeJS.Timeout) => {
    intervalCleared += 1;
    activeIntervals = Math.max(0, activeIntervals - 1);
    return origClearInterval(id);
  }) as typeof window.clearInterval;

  if (typeof ResizeObserver !== 'undefined') {
    const Orig = ResizeObserver;
    window.ResizeObserver = class PatchedResizeObserver extends Orig {
      constructor(callback: ResizeObserverCallback) {
        resizeObservers += 1;
        super(callback);
      }
    } as typeof ResizeObserver;
  }

  if (typeof MutationObserver !== 'undefined') {
    const Orig = MutationObserver;
    window.MutationObserver = class PatchedMutationObserver extends Orig {
      constructor(callback: MutationCallback) {
        mutationObservers += 1;
        super(callback);
      }
    } as typeof MutationObserver;
  }

  if (typeof IntersectionObserver !== 'undefined') {
    const Orig = IntersectionObserver;
    window.IntersectionObserver = class PatchedIntersectionObserver extends Orig {
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

  const reportTimer = origSetInterval(() => printReport(), REPORT_MS);

  const api = {
    snapshot,
    topLeakers,
    reset: () => {
      buckets.clear();
      for (const k of Object.keys(byEventTotals)) delete byEventTotals[k];
      for (const k of Object.keys(byTargetTotals)) delete byTargetTotals[k];
      totalAdds = 0;
      totalRemoves = 0;
      duplicateAdds = 0;
      unmatchedRemoves = 0;
      renderPhaseAdds = 0;
      activeCountEstimate = 0;
      lastReportNet = 0;
      windowAdds = 0;
      windowRemoves = 0;
      recentRenderAdds.length = 0;
    },
    disable: () => {
      origClearInterval(reportTimer);
      proto.addEventListener = origAdd;
      proto.removeEventListener = origRemove;
      installed = false;
    },
    installedAt: () => probeInstalledAt,
  };

  (window as unknown as { __KHATARIO_LISTENER_PROBE__?: typeof api }).__KHATARIO_LISTENER_PROBE__ =
    api;

  console.warn(
    '[LISTENER-PROBE] Active (early patch). snapshot(): window.__KHATARIO_LISTENER_PROBE__.snapshot() | ' +
      'Disable: localStorage.removeItem("khatario_debug_listeners") + hard reload.'
  );
}

/** Install as early as possible when the flag is set (module evaluation). */
if (typeof window !== 'undefined') {
  installListenerLeakProbe();
}
