'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  getDashboardRefreshProbeStats,
  resetDashboardRefreshProbeStats,
  startDashboardIdleWindow,
  type DashboardRefreshProbeStats,
} from '@/lib/debug/dashboard-refresh-probe';

function setProbe(on: boolean): void {
  if (on) localStorage.setItem('khatario:dashboard-refresh-probe', '1');
  else localStorage.removeItem('khatario:dashboard-refresh-probe');
}

export default function DashboardRefreshDebugPage() {
  const [enabled, setEnabled] = useState(false);
  const [stats, setStats] = useState<DashboardRefreshProbeStats | null>(null);
  const [idleRunning, setIdleRunning] = useState(false);

  const refresh = useCallback(() => {
    setEnabled(localStorage.getItem('khatario:dashboard-refresh-probe') === '1');
    setStats(getDashboardRefreshProbeStats());
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 1000);
    return () => clearInterval(id);
  }, [refresh]);

  const startIdle = () => {
    resetDashboardRefreshProbeStats();
    setIdleRunning(true);
    const stop = startDashboardIdleWindow(60_000);
    setTimeout(() => {
      stop();
      setIdleRunning(false);
      refresh();
    }, 60_000);
  };

  const topCounts = Object.entries(stats?.counts ?? {}).sort((a, b) => b[1] - a[1]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-xl font-semibold text-text-primary">Dashboard refresh probe</h1>
      <p className="text-sm text-text-secondary">
        Enable, open Dashboard, stay idle 60s. Target: overview fetches ≈ 1, reconnects ≈ 0.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => { setProbe(!enabled); refresh(); }}>
          {enabled ? 'Disable probe' : 'Enable probe'}
        </Button>
        <Button variant="secondary" onClick={() => { resetDashboardRefreshProbeStats(); refresh(); }}>
          Reset
        </Button>
        <Button variant="secondary" onClick={startIdle} disabled={!enabled || idleRunning}>
          {idleRunning ? 'Idle test (60s)…' : 'Start 60s idle test'}
        </Button>
      </div>
      {stats && (
        <>
          <Card className="space-y-2 p-4">
            <div className="text-sm font-medium">Summary</div>
            <div className="grid grid-cols-2 gap-2 text-sm text-text-secondary">
              <div>Refresh key bumps: {stats.refreshKeyBumps}</div>
              <div>Reconnect events: {stats.reconnectEvents}</div>
              <div>Uptime: {Math.round((Date.now() - stats.startedAt) / 1000)}s</div>
            </div>
            {stats.lastIdleWindow && (
              <div className="mt-2 rounded border border-border bg-gray-50 p-2 text-sm">
                Idle {stats.lastIdleWindow.durationMs / 1000}s: overview=
                {stats.lastIdleWindow.overviewFetches}, rerenders=
                {stats.lastIdleWindow.rerenders}, reconnects={stats.lastIdleWindow.reconnects}
              </div>
            )}
          </Card>
          <Card className="space-y-2 p-4">
            <div className="text-sm font-medium">Counts</div>
            <ul className="max-h-64 overflow-y-auto space-y-1 font-mono text-xs text-text-muted">
              {topCounts.map(([k, v]) => (
                <li key={k}>{k}: {v}</li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
