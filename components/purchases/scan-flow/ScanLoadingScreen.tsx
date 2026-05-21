'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';

const TIPS = [
  'Any Party / Item tagged New will be created and added to your books.',
  'Discounts, GST rates and HSN codes are extracted automatically.',
  'IGST vs CGST+SGST is detected from the invoice — no manual entry needed.',
  'Always verify the extracted details before saving.',
  'Got a multi-page invoice? Add all pages before proceeding.',
];

interface Props {
  startedAt: number; // Date.now() when extraction started
}

export function ScanLoadingScreen({ startedAt }: Props) {
  const [elapsed, setElapsed] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);
  const tipTimer = useRef<ReturnType<typeof setInterval>>();
  const elapsedTimer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    elapsedTimer.current = setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 100);
    tipTimer.current = setInterval(() => {
      setTipIndex(i => (i + 1) % TIPS.length);
    }, 3000);
    return () => {
      clearInterval(elapsedTimer.current);
      clearInterval(tipTimer.current);
    };
  }, [startedAt]);

  const seconds = (elapsed / 1000).toFixed(1);

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-background px-8">
      {/* Animated icon */}
      <div className="mb-8 flex h-24 w-24 items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-800">
        <svg
          className="h-12 w-12 animate-pulse text-text-muted"
          viewBox="0 0 48 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect x="6" y="4" width="36" height="40" rx="4" stroke="currentColor" strokeWidth="2.5" />
          <rect x="13" y="14" width="22" height="2.5" rx="1.25" fill="currentColor" />
          <rect x="13" y="21" width="16" height="2.5" rx="1.25" fill="currentColor" />
          <rect x="13" y="28" width="19" height="2.5" rx="1.25" fill="currentColor" />
          <circle cx="34" cy="34" r="9" fill="currentColor" fillOpacity="0.08" stroke="currentColor" strokeWidth="2" />
          <circle
            cx="34"
            cy="34"
            r="9"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="56.5"
            strokeDashoffset="14"
            className="origin-center animate-spin"
            style={{ animationDuration: '1.2s' }}
          />
        </svg>
      </div>

      <p className="mb-1 text-xl font-semibold text-text-primary">Reading invoice…</p>
      <p className="mb-6 text-2xl font-bold tabular-nums text-primary-600 dark:text-primary-400">
        {seconds}s
      </p>

      {/* Tips carousel */}
      <div className="w-full max-w-xs rounded-xl bg-slate-50 px-4 py-3 dark:bg-slate-800/60">
        <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-600">
          <Sparkles className="h-3.5 w-3.5" />
          Quick Tip
        </div>
        <p
          key={tipIndex}
          className="animate-scan-fade-up text-sm leading-snug text-text-secondary"
        >
          Any Party / Item tagged{' '}
          {tipIndex === 0 ? (
            <span className="rounded bg-green-100 px-1 py-0.5 text-xs font-bold text-green-800 dark:bg-green-900/40 dark:text-green-300">
              New
            </span>
          ) : null}{' '}
          {TIPS[tipIndex].replace('Any Party / Item tagged New will be', 'will be')}
        </p>
        {/* Dots */}
        <div className="mt-2 flex justify-center gap-1">
          {TIPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 w-1.5 rounded-full transition-colors ${
                i === tipIndex ? 'bg-primary-500' : 'bg-slate-300 dark:bg-slate-600'
              }`}
            />
          ))}
        </div>
      </div>

      <p className="mt-6 text-xs text-text-muted">Powered by Mira AI</p>

      <p className="mt-8 px-4 text-center text-xs text-text-muted">
        Please check the details wisely before proceeding, as{' '}
        <span className="font-medium text-amber-600">AI can make mistakes.</span>
      </p>
    </div>
  );
}
