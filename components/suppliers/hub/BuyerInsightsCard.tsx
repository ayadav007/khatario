'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { SellerInsights } from '@/lib/supplier-hub-home';
import { inr } from './HubInboxCard';

const SHOW = 3;

/** For a supplier: how much of what shops ask for it supplies, and which shops have gone quiet. */
export function BuyerInsightsCard({ insights, buyers }: { insights: SellerInsights; buyers: number }) {
  const [all, setAll] = useState(false);
  if (buyers === 0) return null;
  const fill = insights.fillRate;
  const quiet = all ? insights.quietBuyers : insights.quietBuyers.slice(0, SHOW);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4" aria-labelledby="hub-your-buyers">
      <h3 id="hub-your-buyers" className="font-semibold text-text-primary">
        Your buyers
      </h3>

      <dl className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-gray-50 p-3">
          <dt className="text-xs text-text-secondary">Sold to them, 90 days</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-text-primary">{inr(insights.sales90)}</dd>
        </div>
        <div className="rounded-xl bg-gray-50 p-3">
          <dt className="text-xs text-text-secondary">Of what they asked, you supplied</dt>
          <dd
            className={`mt-1 text-lg font-semibold tabular-nums ${
              fill == null ? 'text-text-muted' : fill >= 0.9 ? 'text-green-700' : fill >= 0.7 ? 'text-amber-700' : 'text-red-700'
            }`}
          >
            {fill == null ? '—' : `${Math.round(fill * 100)}%`}
          </dd>
          {fill == null && <p className="text-xs text-text-muted">Shows once shops order from you.</p>}
        </div>
      </dl>

      <div className="mt-4">
        <p className="text-sm font-medium text-text-primary">
          {insights.quietBuyers.length === 0 ? 'Every shop has bought in the last 30 days.' : 'Not billed in 30 days or more'}
        </p>
        {insights.quietBuyers.length > 0 && (
          <ul className="mt-2 divide-y divide-gray-100">
            {quiet.map((b) => {
              const body = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-text-primary">{b.name}</span>
                    <span className="block text-xs text-text-secondary">
                      {b.daysQuiet == null ? 'Not billed yet' : `Last bill ${b.daysQuiet} days ago`}
                    </span>
                  </span>
                  {b.customerId && <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />}
                </>
              );
              return (
                <li key={b.buyerBusinessId}>
                  {b.customerId ? (
                    <Link href={`/customers/${b.customerId}`} className="flex items-center gap-3 py-2.5 hover:bg-gray-50">
                      {body}
                    </Link>
                  ) : (
                    <div className="flex items-center gap-3 py-2.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {insights.quietBuyers.length > SHOW && (
          <button type="button" className="mt-1 text-sm font-medium text-primary-600 hover:underline" onClick={() => setAll((v) => !v)}>
            {all ? 'Show fewer' : `Show all ${insights.quietBuyers.length}`}
          </button>
        )}
      </div>
    </section>
  );
}
