/**
 * The last print jobs on this device, for Printer diagnostics and support ("why didn't it print?").
 * Kept in localStorage; holds no bill contents, only printer, size, result and timing.
 */

export type PrintJobLogEntry = {
  at: string;
  printer: string;
  driver: string;
  language: string;
  bytes: number;
  ok: boolean;
  ms: number;
  error?: string;
};

const KEY = 'khatario.print-jobs';
const MAX = 50;

function store(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function listPrintJobs(): PrintJobLogEntry[] {
  try {
    const raw = store()?.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordPrintJob(entry: PrintJobLogEntry): void {
  try {
    const next = [entry, ...listPrintJobs()].slice(0, MAX);
    store()?.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full or blocked: the log is best-effort */
  }
}

export function clearPrintJobs(): void {
  try {
    store()?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
