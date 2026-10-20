'use client';

import React, { useEffect, useState } from 'react';
import { financialYearStartFor } from '@/lib/reports/balance-sheet';

function displayDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  if (!year || !month || !day) return iso;
  return `${day}/${month}/${year}`;
}

/**
 * Shows the date the existing opening-balance voucher uses.
 * The date is not submitted. Posting still uses the server financial-year start.
 */
export function OpeningAsOfDate({ businessId }: { businessId: string }) {
  const [label, setLabel] = useState('');

  useEffect(() => {
    let cancelled = false;
    const today = new Date().toISOString().slice(0, 10);
    (async () => {
      let iso = financialYearStartFor(today);
      try {
        const res = await fetch(`/api/financial-years?business_id=${encodeURIComponent(businessId)}`);
        if (res.ok) {
          const data = await res.json();
          const current = (data.years || []).find(
            (year: { is_closed?: boolean; start_date?: string; end_date?: string }) =>
              !year.is_closed &&
              year.start_date &&
              year.end_date &&
              String(year.start_date).slice(0, 10) <= today &&
              String(year.end_date).slice(0, 10) >= today,
          );
          if (current?.start_date) iso = String(current.start_date).slice(0, 10);
        }
      } catch {
        /* The Indian financial-year start remains the display fallback. */
      }
      if (!cancelled) setLabel(displayDate(iso));
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  return (
    <div>
      <label htmlFor="opening-as-of" className="mb-1 block text-sm font-medium text-text-secondary">
        As of date
      </label>
      <input id="opening-as-of" className="input w-full bg-gray-50" value={label} readOnly aria-readonly="true" />
      <p className="mt-1 text-xs text-text-secondary">
        Opening balances are posted on the first day of this financial year. Another date cannot be chosen here.
      </p>
    </div>
  );
}
