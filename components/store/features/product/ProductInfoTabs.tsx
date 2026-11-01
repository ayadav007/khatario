'use client';

import { useId, useState } from 'react';
import { ChevronDown, Ruler } from 'lucide-react';
import clsx from 'clsx';
import type { SizeChart, StoreTab } from '@/lib/store/product-extras';
import { SizeChartSheet } from './SizeChartSheet';

type Props = {
  description: string | null;
  tabs: StoreTab[];
  sizeChart: SizeChart | null;
};

/** Description, merchant tabs and a size chart link: tabs from 768 px, an accordion below. */
export function ProductInfoTabs({ description, tabs, sizeChart }: Props) {
  const baseId = useId();
  const [active, setActive] = useState(0);
  const [openSections, setOpenSections] = useState<Set<number>>(() => new Set([0]));
  const [chartOpen, setChartOpen] = useState(false);

  const sections: StoreTab[] = [
    ...(description?.trim() ? [{ title: 'Description', body: description.trim() }] : []),
    ...(tabs ?? []).filter((t) => t.title?.trim() && t.body?.trim()),
  ];
  const chart = sizeChart && sizeChart.columns.length > 0 && sizeChart.rows.length > 0 ? sizeChart : null;
  if (sections.length === 0 && !chart) return null;

  const current = Math.min(active, Math.max(0, sections.length - 1));
  const tabId = (i: number) => `${baseId}-tab-${i}`;
  const panelId = (i: number) => `${baseId}-panel-${i}`;
  const body = (text: string) => (
    <div className="whitespace-pre-line break-words text-sm leading-relaxed text-gray-700">{text}</div>
  );

  const chartButton = (className: string) =>
    chart ? (
      <button
        type="button"
        onClick={() => setChartOpen(true)}
        aria-haspopup="dialog"
        className={clsx('flex min-h-[44px] items-center gap-2 text-sm font-semibold text-gray-900', className)}
      >
        <Ruler className="h-4 w-4 text-gray-500" aria-hidden />
        Size chart
      </button>
    ) : null;

  return (
    <section aria-label="Product details">
      {/* Phones: accordion, first section open. */}
      <div className="divide-y divide-gray-200 border-y border-gray-200 md:hidden">
        {sections.map((s, i) => {
          const open = openSections.has(i);
          return (
            <div key={`${s.title}-${i}`}>
              <h3>
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={`${panelId(i)}-m`}
                  onClick={() =>
                    setOpenSections((prev) => {
                      const next = new Set(prev);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      return next;
                    })
                  }
                  className="flex min-h-[48px] w-full items-center justify-between gap-3 py-2 text-left text-sm font-semibold text-gray-900"
                >
                  {s.title}
                  <ChevronDown
                    className={clsx('h-4 w-4 shrink-0 text-gray-500 transition-transform', open && 'rotate-180')}
                    aria-hidden
                  />
                </button>
              </h3>
              <div id={`${panelId(i)}-m`} hidden={!open} className="pb-4">
                {body(s.body)}
              </div>
            </div>
          );
        })}
        {chart ? <div>{chartButton('w-full py-2')}</div> : null}
      </div>

      {/* 768 px and up: tabs. */}
      <div className="hidden md:block">
        <div className="flex items-end gap-1 border-b border-gray-200">
          {sections.length > 0 ? (
            <div
              role="tablist"
              aria-label="Product details"
              className="flex min-w-0 flex-1 gap-1 overflow-x-auto"
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                e.preventDefault();
                const next = (current + (e.key === 'ArrowRight' ? 1 : -1) + sections.length) % sections.length;
                setActive(next);
                document.getElementById(tabId(next))?.focus();
              }}
            >
              {sections.map((s, i) => (
                <button
                  key={`${s.title}-${i}`}
                  id={tabId(i)}
                  type="button"
                  role="tab"
                  aria-selected={i === current}
                  aria-controls={panelId(i)}
                  tabIndex={i === current ? 0 : -1}
                  onClick={() => setActive(i)}
                  className={clsx(
                    '-mb-px min-h-[44px] whitespace-nowrap border-b-2 px-4 text-sm font-semibold transition-colors',
                    i === current
                      ? 'border-[var(--primary)] text-gray-900'
                      : 'border-transparent text-gray-500 hover:text-gray-800',
                  )}
                >
                  {s.title}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex-1" />
          )}
          {chartButton('shrink-0 px-3')}
        </div>
        {sections.map((s, i) => (
          <div
            key={`${s.title}-${i}`}
            id={panelId(i)}
            role="tabpanel"
            aria-labelledby={tabId(i)}
            hidden={i !== current}
            tabIndex={0}
            className="py-4"
          >
            {body(s.body)}
          </div>
        ))}
      </div>

      {chart ? <SizeChartSheet chart={chart} open={chartOpen} onClose={() => setChartOpen(false)} /> : null}
    </section>
  );
}
