'use client';

/**
 * Lightweight always-on dashboard render counter (no localStorage gate).
 * Inspect: window.__KHATARIO_DASHBOARD_RENDERS__
 */

export type DashboardRenderCounter = {
  total: number;
  startedAt: number;
  lastAt: number;
  perSecond: number;
};

let total = 0;
let startedAt = 0;
let lastAt = 0;
const windowMs = 5000;
const recent: number[] = [];

function publish(): void {
  if (typeof window === 'undefined') return;
  const now = Date.now();
  if (startedAt === 0) startedAt = now;
  while (recent.length > 0 && now - recent[0] > windowMs) recent.shift();
  const payload: DashboardRenderCounter = {
    total,
    startedAt,
    lastAt,
    perSecond: recent.length / (windowMs / 1000),
  };
  (window as unknown as { __KHATARIO_DASHBOARD_RENDERS__?: DashboardRenderCounter }).__KHATARIO_DASHBOARD_RENDERS__ =
    payload;
}

export function bumpDashboardRenderCounter(): void {
  const now = Date.now();
  total += 1;
  lastAt = now;
  recent.push(now);
  publish();
}

export function getDashboardRenderCounter(): DashboardRenderCounter | null {
  if (typeof window === 'undefined') return null;
  publish();
  return (window as unknown as { __KHATARIO_DASHBOARD_RENDERS__?: DashboardRenderCounter }).__KHATARIO_DASHBOARD_RENDERS__ ?? null;
}
