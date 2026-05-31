'use client';

import { useRef } from 'react';

/**
 * TEMPORARY diagnostic for the navigation-freeze / 99% CPU re-render loop.
 *
 * Drop `useRenderLoopProbe('<Name>')` at the top of a component/provider. When a
 * component renders abnormally often (a runaway loop), it logs via console.error
 * (kept alive in production via next.config `removeConsole.exclude=['error']`) and
 * records the event on `window.__KHATARIO_RENDER_LOOP__` for inspection.
 *
 * The TOPMOST component in the provider tree that trips this is closest to the
 * setState driving the loop. Remove all probes once the culprit is fixed.
 */
const WINDOW_MS = 1000;
/** Renders within WINDOW_MS to be flagged as a loop (normal renders are far below this). */
const THRESHOLD = 30;
const LOG_THROTTLE_MS = 1000;

interface RenderLoopEvent {
  label: string;
  count: number;
  ts: number;
}

export function useRenderLoopProbe(label: string): void {
  const times = useRef<number[]>([]);
  const lastLog = useRef(0);

  if (typeof window === 'undefined') return;

  const now = Date.now();
  const arr = times.current;
  arr.push(now);
  while (arr.length > 0 && now - arr[0] > WINDOW_MS) arr.shift();

  if (arr.length >= THRESHOLD && now - lastLog.current > LOG_THROTTLE_MS) {
    lastLog.current = now;
    // console.error intentionally: survives production build (see next.config.mjs).
    console.error(
      `[RENDER-LOOP] "${label}" rendered ${arr.length}x in last ${WINDOW_MS}ms`
    );
    const g = window as unknown as { __KHATARIO_RENDER_LOOP__?: RenderLoopEvent[] };
    if (!g.__KHATARIO_RENDER_LOOP__) g.__KHATARIO_RENDER_LOOP__ = [];
    g.__KHATARIO_RENDER_LOOP__.push({ label, count: arr.length, ts: now });
  }
}
