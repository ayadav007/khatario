'use client';

import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { SizeChart } from '@/lib/store/product-extras';
import { useMounted, useOverlay } from './useOverlay';

type Props = {
  chart: SizeChart;
  open: boolean;
  onClose: () => void;
};

/** Size chart: bottom sheet on phones, centred dialog from 768 px. */
export function SizeChartSheet({ chart, open, onClose }: Props) {
  const mounted = useMounted();
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  useOverlay(open, onClose, closeRef);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[130] flex items-end justify-center bg-black/50 md:items-center md:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[85vh] w-full flex-col overflow-hidden rounded-t-2xl bg-[var(--paper,#fff)] text-gray-900 shadow-xl md:max-w-2xl md:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-gray-200 py-1 pl-4 pr-1">
          <h2 id={titleId} className="text-base font-semibold">
            Size chart
          </h2>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close size chart"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full text-gray-600 hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto pb-[env(safe-area-inset-bottom)]">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                {chart.columns.map((c, i) => (
                  <th
                    key={i}
                    scope="col"
                    className={
                      'whitespace-nowrap border-b border-gray-200 bg-gray-50 px-3 py-2.5 text-left font-semibold text-gray-700' +
                      (i === 0 ? ' sticky left-0 z-10' : '')
                    }
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chart.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, i) =>
                    i === 0 ? (
                      <th
                        key={i}
                        scope="row"
                        className="sticky left-0 whitespace-nowrap border-b border-r border-gray-100 border-r-gray-200 bg-[var(--paper,#fff)] px-3 py-2.5 text-left font-semibold"
                      >
                        {cell}
                      </th>
                    ) : (
                      <td key={i} className="whitespace-nowrap border-b border-gray-100 px-3 py-2.5 tabular-nums text-gray-700">
                        {cell}
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>,
    document.body,
  );
}
