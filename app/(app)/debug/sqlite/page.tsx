'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  getSqliteProbeStats,
  resetSqliteProbeStats,
  startSqliteIdleWindow,
  type SqliteProbeStats,
} from '@/lib/debug/sqlite-probe';

function enableProbe(): void {
  localStorage.setItem('khatario:sqlite-probe', '1');
}

function disableProbe(): void {
  localStorage.removeItem('khatario:sqlite-probe');
}

export default function SqliteDebugPage() {
  const [enabled, setEnabled] = useState(false);
  const [stats, setStats] = useState<SqliteProbeStats | null>(null);
  const [idleRunning, setIdleRunning] = useState(false);

  const refresh = useCallback(() => {
    setEnabled(localStorage.getItem('khatario:sqlite-probe') === '1');
    setStats(getSqliteProbeStats());
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 1000);
    return () => clearInterval(id);
  }, [refresh]);

  const toggleProbe = () => {
    if (enabled) {
      disableProbe();
    } else {
      enableProbe();
    }
    refresh();
  };

  const startIdleTest = () => {
    resetSqliteProbeStats();
    setIdleRunning(true);
    const stop = startSqliteIdleWindow(60_000);
    setTimeout(() => {
      stop();
      setIdleRunning(false);
      refresh();
    }, 60_000);
  };

  const byLabel = stats?.byLabel ?? {};
  const labels = Object.entries(byLabel).sort(
    (a, b) => b[1].query + b[1].run - (a[1].query + a[1].run)
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-xl font-semibold text-text-primary">SQLite probe</h1>
      <p className="text-sm text-text-secondary">
        All native CapacitorSQLite traffic routes through the offline catalog driver on Android.
        Enable the probe, open Dashboard, stay idle 60s, then inspect counts below.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button onClick={toggleProbe}>{enabled ? 'Disable probe' : 'Enable probe'}</Button>
        <Button variant="secondary" onClick={() => { resetSqliteProbeStats(); refresh(); }}>
          Reset counters
        </Button>
        <Button variant="secondary" onClick={startIdleTest} disabled={!enabled || idleRunning}>
          {idleRunning ? 'Idle test running (60s)…' : 'Start 60s idle test'}
        </Button>
      </div>

      {stats && (
        <>
          <Card className="p-4 space-y-2">
            <div className="text-sm font-medium text-text-primary">Totals</div>
            <div className="grid grid-cols-2 gap-2 text-sm text-text-secondary">
              <div>Queries: {stats.queries}</div>
              <div>Runs (writes): {stats.runs}</div>
              <div>Execute sets: {stats.executeSets ?? 0}</div>
              <div>Rows written: {stats.rowsWritten ?? 0}</div>
              <div>Executes: {stats.executes}</div>
              <div>Uptime: {Math.round((Date.now() - stats.startedAt) / 1000)}s</div>
            </div>
            {stats.lastUpsert && (
              <div className="mt-2 rounded border border-green-200 bg-green-50 p-2 text-sm text-green-800">
                Last upsert ({stats.lastUpsert.kind}): {stats.lastUpsert.rows} rows,{' '}
                {stats.lastUpsert.bridgeCalls} bridge calls
                (was ~{stats.lastUpsert.priorBridgeCallsEstimate}),{' '}
                {stats.lastUpsert.durationMs}ms,{' '}
                {stats.lastUpsert.writesPerSec.toFixed(0)} rows/s
              </div>
            )}
            {stats.lastIdleWindow && (
              <div className="mt-2 rounded border border-border bg-gray-50 p-2 text-sm">
                Last idle window ({stats.lastIdleWindow.durationMs / 1000}s):{' '}
                {stats.lastIdleWindow.queries} queries, {stats.lastIdleWindow.runs} writes
                {' — '}
                q/s={(stats.lastIdleWindow.queries / (stats.lastIdleWindow.durationMs / 1000)).toFixed(2)}
                , w/s={(stats.lastIdleWindow.runs / (stats.lastIdleWindow.durationMs / 1000)).toFixed(2)}
              </div>
            )}
          </Card>

          <Card className="p-4 space-y-2">
            <div className="text-sm font-medium text-text-primary">By label</div>
            {labels.length === 0 ? (
              <p className="text-sm text-text-muted">No operations yet.</p>
            ) : (
              <ul className="space-y-1 text-sm font-mono">
                {labels.map(([label, counts]) => (
                  <li key={label} className="text-text-secondary">
                    {label}: query={counts.query} run={counts.run}
                    {(counts.executeSet ?? 0) > 0 ? ` executeSet=${counts.executeSet}` : ''}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-4 space-y-2">
            <div className="text-sm font-medium text-text-primary">Recent (deduped)</div>
            <ul className="max-h-64 overflow-y-auto space-y-1 text-xs font-mono text-text-muted">
              {[...(stats.recent ?? [])].reverse().slice(0, 40).map((e, i) => (
                <li key={`${e.ts}-${i}`}>
                  [{e.op}] {e.label}: {e.statementPreview}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
