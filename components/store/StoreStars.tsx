'use client';

import { Star } from 'lucide-react';
import clsx from 'clsx';

export function StoreStars({
  value,
  count,
  size = 'sm',
  onRate,
}: {
  value: number;
  count?: number;
  size?: 'sm' | 'md';
  onRate?: (n: number) => void;
}) {
  const cls = size === 'md' ? 'h-4 w-4' : 'h-3 w-3';
  return (
    <div className="flex items-center gap-1">
      <div className="flex">
        {[1, 2, 3, 4, 5].map((n) => {
          const fill = value >= n - 0.25;
          const star = (
            <Star
              className={clsx(cls, fill ? 'fill-amber-400 text-amber-400' : 'text-gray-300')}
              strokeWidth={1.6}
            />
          );
          if (!onRate) return <span key={n}>{star}</span>;
          return (
            <button key={n} type="button" className="p-0.5" aria-label={`Rate ${n} stars`} onClick={() => onRate(n)}>
              {star}
            </button>
          );
        })}
      </div>
      {typeof count === 'number' && count > 0 ? (
        <span className="text-[10px] tabular-nums text-gray-500">
          {value.toFixed(1)} ({count})
        </span>
      ) : null}
    </div>
  );
}
