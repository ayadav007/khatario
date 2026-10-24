'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { InsightCardData } from './useAssistantChat';

function Card({ card, wide }: { card: InsightCardData; wide: boolean }) {
  return (
    <div
      className={`${wide ? 'w-full' : 'w-[260px] shrink-0 snap-start'} rounded-xl border border-slate-200 bg-white p-3 text-slate-800 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100`}
      data-testid="assistant-insight-card"
    >
      <h3 className="text-sm font-semibold leading-snug">{card.title}</h3>
      {card.subtitle ? <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{card.subtitle}</p> : null}
      {card.rows.length ? (
        <dl className="mt-2 divide-y divide-slate-100 dark:divide-slate-700">
          {card.rows.map((r, i) => (
            <div key={`${r.label}-${i}`} className="flex items-start justify-between gap-3 py-1.5">
              <dt className="min-w-0 text-xs text-slate-600 dark:text-slate-300">
                <span className="block truncate">{r.label}</span>
                {r.hint ? <span className="block text-[11px] text-slate-400">{r.hint}</span> : null}
              </dt>
              <dd className="shrink-0 text-right text-sm font-semibold tabular-nums">{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : card.empty ? (
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{card.empty}</p>
      ) : null}
      {card.link ? (
        <Link
          href={card.link.url}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 hover:underline dark:text-primary-300"
        >
          View {card.link.label.toLowerCase()} <ArrowRight className="h-3 w-3" />
        </Link>
      ) : null}
    </div>
  );
}

export function InsightCards({ cards }: { cards: InsightCardData[] }) {
  if (!cards.length) return null;
  if (cards.length === 1) return <Card card={cards[0]} wide />;
  return (
    <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
      {cards.map((c, i) => (
        <Card key={`${c.title}-${i}`} card={c} wide={false} />
      ))}
    </div>
  );
}
