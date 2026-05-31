'use client';

/**
 * Diagnostic probe for Capacitor SQLite catalog churn.
 *
 * Enable: localStorage.setItem('khatario:sqlite-probe', '1')
 * Disable: localStorage.removeItem('khatario:sqlite-probe')
 *
 * Inspect: window.__KHATARIO_SQLITE__ in DevTools
 */

export type SqliteOp = 'query' | 'run' | 'execute';

export interface SqliteProbeEntry {
  op: SqliteOp;
  label: string;
  statementPreview: string;
  ts: number;
}

export interface SqliteProbeStats {
  startedAt: number;
  queries: number;
  runs: number;
  executes: number;
  executeSets: number;
  rowsWritten: number;
  byLabel: Record<string, { query: number; run: number; execute: number; executeSet: number }>;
  recent: SqliteProbeEntry[];
  lastIdleWindow?: {
    startedAt: number;
    durationMs: number;
    queries: number;
    runs: number;
  };
  lastUpsert?: CatalogUpsertMetrics;
}

export interface CatalogUpsertMetrics {
  kind: 'items' | 'customers';
  rows: number;
  bridgeCalls: number;
  priorBridgeCallsEstimate: number;
  durationMs: number;
  writesPerSec: number;
  ts: number;
}

const MAX_RECENT = 200;
const RECENT_DEDUPE_MS = 500;

let activeLabel: string | null = null;
let idleWindowStart: number | null = null;
let idleQueries = 0;
let idleRuns = 0;

function isEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem('khatario:sqlite-probe') === '1';
  } catch {
    return false;
  }
}

function getStats(): SqliteProbeStats {
  const g = window as unknown as { __KHATARIO_SQLITE__?: SqliteProbeStats };
  if (!g.__KHATARIO_SQLITE__) {
    g.__KHATARIO_SQLITE__ = {
      startedAt: Date.now(),
      queries: 0,
      runs: 0,
      executes: 0,
      executeSets: 0,
      rowsWritten: 0,
      byLabel: {},
      recent: [],
    };
  }
  return g.__KHATARIO_SQLITE__;
}

function statementPreview(statement: string): string {
  const oneLine = statement.replace(/\s+/g, ' ').trim();
  return oneLine.length > 120 ? `${oneLine.slice(0, 117)}…` : oneLine;
}

function bump(op: SqliteOp, label: string, statement: string): void {
  if (!isEnabled()) return;

  const stats = getStats();
  const bucket = stats.byLabel[label] ?? { query: 0, run: 0, execute: 0, executeSet: 0 };
  if (op === 'query') {
    stats.queries += 1;
    bucket.query += 1;
    idleQueries += 1;
  } else if (op === 'run') {
    stats.runs += 1;
    bucket.run += 1;
    idleRuns += 1;
  } else {
    stats.executes += 1;
    bucket.execute += 1;
  }
  stats.byLabel[label] = bucket;

  const preview = statementPreview(statement);
  const now = Date.now();
  const last = stats.recent[stats.recent.length - 1];
  if (
    !last ||
    last.label !== label ||
    last.op !== op ||
    last.statementPreview !== preview ||
    now - last.ts > RECENT_DEDUPE_MS
  ) {
    stats.recent.push({ op, label, statementPreview: preview, ts: now });
    if (stats.recent.length > MAX_RECENT) stats.recent.shift();
  }

  console.count(`[SQLite ${op}] ${label}`);
}

/** Tag the next async catalog work (sync engine, status refresh, search, etc.). */
export async function withSqliteLabel<T>(
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  const prev = activeLabel;
  activeLabel = label;
  try {
    return await fn();
  } finally {
    activeLabel = prev;
  }
}

export function resolveSqliteLabel(method: string, override?: string): string {
  if (override) return override;
  if (activeLabel) return `${activeLabel}/${method}`;
  return method;
}

export async function tracedSqliteQuery<T>(
  label: string,
  statement: string,
  fn: () => Promise<T>
): Promise<T> {
  bump('query', label, statement);
  return fn();
}

export async function tracedSqliteRun<T>(
  label: string,
  statement: string,
  fn: () => Promise<T>
): Promise<T> {
  bump('run', label, statement);
  return fn();
}

export async function tracedSqliteExecuteSet<T>(
  label: string,
  rowCount: number,
  fn: () => Promise<T>
): Promise<T> {
  if (isEnabled()) {
    const stats = getStats();
    stats.executeSets += 1;
    stats.rowsWritten += rowCount;
    const bucket = stats.byLabel[label] ?? { query: 0, run: 0, execute: 0, executeSet: 0 };
    bucket.executeSet += 1;
    stats.byLabel[label] = bucket;
    console.count(`[SQLite executeSet] ${label} (${rowCount} rows)`);
  }
  return fn();
}

/** Log batch upsert metrics when probe is enabled (compare bridge calls vs prior per-row runs). */
export function recordCatalogUpsertMetrics(metrics: Omit<CatalogUpsertMetrics, 'writesPerSec' | 'ts'>): void {
  if (!isEnabled()) return;

  const writesPerSec =
    metrics.durationMs > 0 ? (metrics.rows / metrics.durationMs) * 1000 : metrics.rows;
  const entry: CatalogUpsertMetrics = {
    ...metrics,
    writesPerSec,
    ts: Date.now(),
  };
  getStats().lastUpsert = entry;

  const reduction =
    metrics.priorBridgeCallsEstimate > 0
      ? (
          ((metrics.priorBridgeCallsEstimate - metrics.bridgeCalls) /
            metrics.priorBridgeCallsEstimate) *
          100
        ).toFixed(0)
      : '0';

  console.info(
    `[CatalogSQLite] upsert ${metrics.kind}: ${metrics.rows} rows, ` +
      `${metrics.bridgeCalls} bridge calls (was ~${metrics.priorBridgeCallsEstimate}, -${reduction}%), ` +
      `${metrics.durationMs}ms, ${writesPerSec.toFixed(0)} rows/s`
  );
}

export async function tracedSqliteExecute<T>(
  label: string,
  statements: string,
  fn: () => Promise<T>
): Promise<T> {
  bump('execute', label, statements);
  return fn();
}

/** Start a 60s idle window counter (call when dashboard is open and user is idle). */
export function startSqliteIdleWindow(durationMs = 60_000): () => void {
  idleWindowStart = Date.now();
  idleQueries = 0;
  idleRuns = 0;
  const stats = getStats();

  const timer = setTimeout(() => {
    if (idleWindowStart == null) return;
    stats.lastIdleWindow = {
      startedAt: idleWindowStart,
      durationMs,
      queries: idleQueries,
      runs: idleRuns,
    };
    console.info(
      `[SQLite idle ${durationMs / 1000}s] queries=${idleQueries} runs=${idleRuns} ` +
        `(q/s=${(idleQueries / (durationMs / 1000)).toFixed(2)}, ` +
        `w/s=${(idleRuns / (durationMs / 1000)).toFixed(2)})`
    );
    idleWindowStart = null;
  }, durationMs);

  return () => clearTimeout(timer);
}

export function getSqliteProbeStats(): SqliteProbeStats | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { __KHATARIO_SQLITE__?: SqliteProbeStats }).__KHATARIO_SQLITE__ ?? null;
}

export function resetSqliteProbeStats(): void {
  if (typeof window === 'undefined') return;
  const g = window as unknown as { __KHATARIO_SQLITE__?: SqliteProbeStats };
  g.__KHATARIO_SQLITE__ = {
    startedAt: Date.now(),
    queries: 0,
    runs: 0,
    executes: 0,
    executeSets: 0,
    rowsWritten: 0,
    byLabel: {},
    recent: [],
  };
  idleQueries = 0;
  idleRuns = 0;
}
