'use client';

/**
 * P1 runtime isolation experiment — continuous JS wakeup reduction.
 *
 * Flip flags below to A/B CPU impact on Dashboard idle.
 * Inspect: window.__KHATARIO_RUNTIME__
 *
 * Also enable via localStorage:
 *   localStorage.setItem('khatario:runtime-probe', '1')
 */

/** Skip EventSource, SSE debounce refetch, and 30s notification poll. Keep mount fetch only. */
export const DISABLE_NOTIFICATION_SSE = true;

/** Freeze promotion carousels on first slide (no setInterval). */
export const DISABLE_PROMOTION_CAROUSELS = true;

export interface RuntimeWakeupCounters {
  timersFired: number;
  eventSourceMessages: number;
  fetchNotifications: number;
  sqliteQueries: number;
  sqliteIdleQueries: number;
}

export interface RuntimeWakeupRates {
  timersPerSec: number;
  eventSourceMessagesPerSec: number;
  fetchNotificationsPerSec: number;
  sqliteQueriesPerSec: number;
  sqliteIdleQueriesPerSec: number;
}

export interface RuntimeWakeupSnapshot {
  startedAt: number;
  idlePhaseStartedAt: number | null;
  elapsedSec: number;
  idleElapsedSec: number | null;
  counters: RuntimeWakeupCounters;
  idleCounters: RuntimeWakeupCounters;
  rates: RuntimeWakeupRates;
  idleRates: RuntimeWakeupRates | null;
  flags: {
    disableNotificationSse: boolean;
    disablePromotionCarousels: boolean;
  };
}

const STORAGE_KEY = 'khatario:runtime-probe';

let probeInstalled = false;
let idlePhaseActive = false;
let idlePhaseStartedAt: number | null = null;
let startedAt = 0;

function ensureStarted(): void {
  if (startedAt === 0) startedAt = Date.now();
}

const counters: RuntimeWakeupCounters = {
  timersFired: 0,
  eventSourceMessages: 0,
  fetchNotifications: 0,
  sqliteQueries: 0,
  sqliteIdleQueries: 0,
};

const idleCounters: RuntimeWakeupCounters = {
  timersFired: 0,
  eventSourceMessages: 0,
  fetchNotifications: 0,
  sqliteQueries: 0,
  sqliteIdleQueries: 0,
};

function isProbeStorageEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Probe runs only when explicitly enabled via localStorage (not from isolation flags). */
export function isRuntimeProbeEnabled(): boolean {
  return isProbeStorageEnabled();
}

export function isNotificationSseDisabled(): boolean {
  return DISABLE_NOTIFICATION_SSE;
}

export function isPromotionCarouselsDisabled(): boolean {
  return DISABLE_PROMOTION_CAROUSELS;
}

/** Bisect: localStorage.setItem('khatario:disable-dashboard-charts', '1') + reload */
export function isDashboardChartsDisabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem('khatario:disable-dashboard-charts') === '1';
  } catch {
    return false;
  }
}

export function isRuntimeIdlePhase(): boolean {
  return idlePhaseActive;
}

function bumpCounter(key: keyof RuntimeWakeupCounters): void {
  if (!isRuntimeProbeEnabled()) return;
  ensureStarted();
  counters[key] += 1;
  if (idlePhaseActive) {
    idleCounters[key] += 1;
  }
}

export function recordTimerFired(): void {
  bumpCounter('timersFired');
}

export function recordEventSourceMessage(): void {
  bumpCounter('eventSourceMessages');
}

export function recordFetchNotifications(_source?: string): void {
  bumpCounter('fetchNotifications');
}

export function recordSqliteQuery(): void {
  bumpCounter('sqliteQueries');
}

export function recordSqliteIdleQuery(): void {
  bumpCounter('sqliteIdleQueries');
  if (isRuntimeProbeEnabled()) {
    console.count('[SQLite idle query]');
  }
}

function perSec(count: number, ms: number): number {
  if (ms <= 0) return 0;
  return count / (ms / 1000);
}

function buildRates(c: RuntimeWakeupCounters, ms: number): RuntimeWakeupRates {
  return {
    timersPerSec: perSec(c.timersFired, ms),
    eventSourceMessagesPerSec: perSec(c.eventSourceMessages, ms),
    fetchNotificationsPerSec: perSec(c.fetchNotifications, ms),
    sqliteQueriesPerSec: perSec(c.sqliteQueries, ms),
    sqliteIdleQueriesPerSec: perSec(c.sqliteIdleQueries, ms),
  };
}

export function getRuntimeWakeupSnapshot(): RuntimeWakeupSnapshot {
  ensureStarted();
  const now = Date.now();
  const elapsedSec = (now - startedAt) / 1000;
  const idleElapsedSec =
    idlePhaseStartedAt != null ? (now - idlePhaseStartedAt) / 1000 : null;

  return {
    startedAt,
    idlePhaseStartedAt,
    elapsedSec,
    idleElapsedSec,
    counters: { ...counters },
    idleCounters: { ...idleCounters },
    rates: buildRates(counters, now - startedAt),
    idleRates:
      idlePhaseStartedAt != null
        ? buildRates(idleCounters, now - idlePhaseStartedAt)
        : null,
    flags: {
      disableNotificationSse: DISABLE_NOTIFICATION_SSE,
      disablePromotionCarousels: DISABLE_PROMOTION_CAROUSELS,
    },
  };
}

export function markRuntimeIdlePhase(): void {
  if (idlePhaseActive) return;
  idlePhaseActive = true;
  idlePhaseStartedAt = Date.now();
  for (const key of Object.keys(idleCounters) as Array<keyof RuntimeWakeupCounters>) {
    idleCounters[key] = 0;
  }
  if (isRuntimeProbeEnabled()) {
    console.info(
      '[RuntimeProbe] Idle phase started — SQLite idle queries will console.count as [SQLite idle query]'
    );
  }
}

export function resetRuntimeWakeupCounters(): void {
  for (const key of Object.keys(counters) as Array<keyof RuntimeWakeupCounters>) {
    counters[key] = 0;
    idleCounters[key] = 0;
  }
  idlePhaseActive = false;
  idlePhaseStartedAt = null;
}

function wrapTimerHandler(handler: TimerHandler): TimerHandler {
  if (typeof handler !== 'function') return handler;
  return (...args: unknown[]) => {
    recordTimerFired();
    return (handler as (...a: unknown[]) => unknown)(...args);
  };
}

/** Patch timers to count wakeups. Safe to call once. */
export function installRuntimeWakeupProbe(): void {
  if (probeInstalled || typeof window === 'undefined' || !isRuntimeProbeEnabled()) return;
  probeInstalled = true;
  ensureStarted();

  const origSetInterval = window.setInterval.bind(window);
  const origSetTimeout = window.setTimeout.bind(window);

  window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    return origSetInterval(wrapTimerHandler(handler), timeout ?? 0, ...(args as []));
  }) as typeof window.setInterval;

  window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    return origSetTimeout(wrapTimerHandler(handler), timeout ?? 0, ...(args as []));
  }) as typeof window.setTimeout;

  const api = {
    snapshot: getRuntimeWakeupSnapshot,
    reset: resetRuntimeWakeupCounters,
    markIdle: markRuntimeIdlePhase,
    isIdlePhase: () => idlePhaseActive,
  };

  (window as unknown as { __KHATARIO_RUNTIME__?: typeof api }).__KHATARIO_RUNTIME__ = api;

  console.info(
    '[RuntimeProbe] Active. Stats: window.__KHATARIO_RUNTIME__.snapshot(). ' +
      `SSE disabled=${DISABLE_NOTIFICATION_SSE}, promotions disabled=${DISABLE_PROMOTION_CAROUSELS}`
  );
}
