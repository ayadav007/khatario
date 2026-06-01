'use client';

/**
 * Dashboard refresh / refetch diagnostics.
 *
 * Enable: localStorage.setItem('khatario:dashboard-refresh-probe', '1')
 * Inspect: window.__KHATARIO_DASHBOARD_REFRESH__
 */

export type DashboardRefreshKind =
  | 'overview-fetch'
  | 'sales-trend-fetch'
  | 'sales-chart-fetch'
  | 'cash-flow-fetch'
  | 'dashboard-rerender'
  | 'sales-chart-rerender'
  | 'cash-flow-rerender'
  | 'sales-insights-rerender'
  | 'kpi-strip-rerender'
  | 'refresh-key-bump'
  | 'network-reconnect';

export interface DashboardRefreshProbeStats {
  startedAt: number;
  counts: Record<string, number>;
  refreshKeyBumps: number;
  reconnectEvents: number;
  lastIdleWindow?: {
    startedAt: number;
    durationMs: number;
    overviewFetches: number;
    rerenders: number;
    reconnects: number;
  };
  recent: Array<{ kind: DashboardRefreshKind; detail?: string; ts: number }>;
}

const MAX_RECENT = 100;
let idleOverview = 0;
let idleRerenders = 0;
let idleReconnects = 0;
let idleWindowStart: number | null = null;

function enabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem('khatario:dashboard-refresh-probe') === '1';
  } catch {
    return false;
  }
}

function stats(): DashboardRefreshProbeStats {
  const g = window as unknown as { __KHATARIO_DASHBOARD_REFRESH__?: DashboardRefreshProbeStats };
  if (!g.__KHATARIO_DASHBOARD_REFRESH__) {
    g.__KHATARIO_DASHBOARD_REFRESH__ = {
      startedAt: Date.now(),
      counts: {},
      refreshKeyBumps: 0,
      reconnectEvents: 0,
      recent: [],
    };
  }
  return g.__KHATARIO_DASHBOARD_REFRESH__;
}

export function probeDashboardRefresh(
  kind: DashboardRefreshKind,
  detail?: string
): void {
  if (!enabled()) return;

  const key = detail ? `${kind}:${detail}` : kind;
  const s = stats();
  s.counts[key] = (s.counts[key] ?? 0) + 1;
  s.recent.push({ kind, detail, ts: Date.now() });
  if (s.recent.length > MAX_RECENT) s.recent.shift();

  if (kind === 'refresh-key-bump') s.refreshKeyBumps += 1;
  if (kind === 'network-reconnect') {
    s.reconnectEvents += 1;
    idleReconnects += 1;
  }
  if (kind === 'overview-fetch') idleOverview += 1;
  if (kind === 'dashboard-rerender') idleRerenders += 1;

  console.count(`[DashboardRefresh] ${key}`);
}

export function probeDashboardRefreshKeyBump(reason: string): void {
  probeDashboardRefresh('refresh-key-bump', reason);
}

export function probeNetworkReconnectDispatched(source: string): void {
  probeDashboardRefresh('network-reconnect', source);
}

export function startDashboardIdleWindow(durationMs = 60_000): () => void {
  idleOverview = 0;
  idleRerenders = 0;
  idleReconnects = 0;
  idleWindowStart = Date.now();

  const timer = setTimeout(() => {
    if (idleWindowStart == null) return;
    const s = stats();
    s.lastIdleWindow = {
      startedAt: idleWindowStart,
      durationMs,
      overviewFetches: idleOverview,
      rerenders: idleRerenders,
      reconnects: idleReconnects,
    };
    console.info(
      `[Dashboard idle ${durationMs / 1000}s] overview=${idleOverview}, ` +
        `rerenders=${idleRerenders}, reconnects=${idleReconnects}`
    );
    idleWindowStart = null;
  }, durationMs);

  return () => clearTimeout(timer);
}

export function getDashboardRefreshProbeStats(): DashboardRefreshProbeStats | null {
  if (typeof window === 'undefined') return null;
  return stats();
}

export function resetDashboardRefreshProbeStats(): void {
  if (typeof window === 'undefined') return;
  const g = window as unknown as { __KHATARIO_DASHBOARD_REFRESH__?: DashboardRefreshProbeStats };
  g.__KHATARIO_DASHBOARD_REFRESH__ = {
    startedAt: Date.now(),
    counts: {},
    refreshKeyBumps: 0,
    reconnectEvents: 0,
    recent: [],
  };
  idleOverview = 0;
  idleRerenders = 0;
  idleReconnects = 0;
}
