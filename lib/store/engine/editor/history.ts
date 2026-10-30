// Generic undo/redo history. Pure: every function returns a new object and never
// mutates its input. Imports nothing from the engine.

export const HISTORY_LIMIT = 100;
export const MERGE_MS = 1000;

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  lastKey: string | null;
  lastAt: number;
}

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], lastKey: null, lastAt: 0 };
}

/**
 * Record a new present state. A non-null `mergeKey` equal to the previous record's key,
 * within MERGE_MS of it, replaces `present` without adding an undo step (continuous typing).
 * `lastAt` updates on every record, so a long run of edits keeps merging.
 */
export function record<T>(h: History<T>, next: T, mergeKey: string | null, now: number): History<T> {
  if (next === h.present) return h;
  const merge = mergeKey !== null && mergeKey === h.lastKey && now - h.lastAt < MERGE_MS;
  const past = merge ? h.past : [...h.past, h.present].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [], lastKey: mergeKey, lastAt: now };
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  return {
    past: h.past.slice(0, -1),
    present: h.past[h.past.length - 1],
    future: [h.present, ...h.future],
    lastKey: null,
    lastAt: h.lastAt,
  };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  return {
    past: [...h.past, h.present].slice(-HISTORY_LIMIT),
    present: h.future[0],
    future: h.future.slice(1),
    lastKey: null,
    lastAt: h.lastAt,
  };
}

export function canUndo(h: History<unknown>): boolean {
  return h.past.length > 0;
}

export function canRedo(h: History<unknown>): boolean {
  return h.future.length > 0;
}
