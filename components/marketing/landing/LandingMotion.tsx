'use client';

import { clsx } from 'clsx';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { usePrefersReducedMotion } from '@/hooks/usePrefersReducedMotion';

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/** Number that eases from its previous value to `target` whenever `target` changes. */
export function useAnimatedNumber(target: number, durationMs = 500): number {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);

  useEffect(() => {
    if (reduced) {
      fromRef.current = target;
      setValue(target);
      return;
    }
    const from = fromRef.current;
    if (from === target) return;
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / durationMs);
      const next = from + (target - from) * easeOutCubic(k);
      fromRef.current = next;
      setValue(next);
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs, reduced]);

  return value;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SegmentOption<T extends string> = { id: T; label: ReactNode };

/** Pill switch whose highlight slides to the selected option. */
export function LandingSegmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel: string;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const active = wrap.querySelector<HTMLElement>('[aria-checked="true"]');
      if (active) setPill({ left: active.offsetLeft, width: active.offsetWidth });
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(wrap);
    return () => ro?.disconnect();
  }, [value, options.length]);

  return (
    <div
      ref={wrapRef}
      role="radiogroup"
      aria-label={ariaLabel}
      className={clsx('relative inline-flex max-w-full items-center rounded-xl border border-slate-200 bg-white p-1 shadow-sm', className)}
    >
      {pill && (
        <span
          aria-hidden
          className="absolute bottom-1 top-1 rounded-lg bg-primary-600 shadow-sm transition-all duration-300 ease-out motion-reduce:transition-none"
          style={{ left: pill.left, width: pill.width }}
        />
      )}
      {options.map((o) => {
        const selected = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.id)}
            className={clsx(
              'relative z-10 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-semibold transition-colors sm:px-5 sm:text-[15px]',
              selected ? 'text-white' : 'text-slate-600 hover:text-slate-900',
              !pill && selected && 'bg-primary-600',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
