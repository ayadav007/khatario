'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Loader2, PartyPopper } from 'lucide-react';
import { clsx } from 'clsx';
import { splitHolidayDate } from '@/components/hr/dashboard/HrQuickAccessCards';
import { useEmployeePortal } from './EmployeePortalContext';

type HolidayCard = {
  id: string;
  holiday_date: string;
  holiday_name: string;
  description: string | null;
};

function todayYmd() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function EmployeePortalHolidays() {
  const { slug } = useEmployeePortal();
  const router = useRouter();
  const params = useSearchParams();
  const parsedYear = Number(params.get('year'));
  const year =
    Number.isInteger(parsedYear) && parsedYear >= 2000 && parsedYear <= 2100
      ? parsedYear
      : new Date().getFullYear();
  const [loading, setLoading] = useState(true);
  const [holidays, setHolidays] = useState<HolidayCard[]>([]);
  const today = todayYmd();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/public/employee/portal/holidays?year=${year}`, {
          credentials: 'include',
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setHolidays(data.holidays ?? []);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [year]);

  function goToYear(nextYear: number) {
    router.push(`/${slug}/employees/holidays?year=${nextYear}`);
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-text-primary">Holidays</h1>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-white text-text-primary"
            aria-label="Previous year"
            onClick={() => goToYear(year - 1)}
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
          <span className="min-w-[4.5rem] text-center text-base font-semibold tabular-nums text-text-primary">
            {year}
          </span>
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-white text-text-primary"
            aria-label="Next year"
            onClick={() => goToYear(year + 1)}
          >
            <ChevronRight className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
        </div>
      ) : holidays.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-amber-100 bg-amber-50 px-6 py-12 text-center">
          <PartyPopper className="mb-3 h-8 w-8 text-amber-600" aria-hidden />
          <p className="text-base font-medium text-text-primary">No holidays in {year}</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {holidays.map((holiday) => {
            const parts = splitHolidayDate(holiday.holiday_date);
            if (!parts) return null;
            const date = holiday.holiday_date.slice(0, 10);
            const isPast = date < today;
            const isToday = date === today;
            return (
              <li key={holiday.id}>
                <article
                  className={clsx(
                    'h-full rounded-2xl border px-5 py-5 shadow-sm',
                    isToday && 'border-amber-300 bg-gradient-to-b from-amber-100 to-white ring-2 ring-amber-200',
                    !isToday && !isPast && 'border-amber-100 bg-gradient-to-b from-amber-50 to-white',
                    isPast && 'border-border bg-white',
                  )}
                >
                  <p
                    className={clsx(
                      'text-6xl font-semibold leading-none tabular-nums',
                      isPast ? 'text-text-secondary' : 'text-amber-950',
                    )}
                  >
                    {parts.day}
                  </p>
                  <p className={clsx('mt-2 text-sm font-medium', isPast ? 'text-text-muted' : 'text-amber-800')}>
                    {parts.month}
                  </p>
                  <p className="mt-3 text-lg font-semibold text-text-primary">{holiday.holiday_name}</p>
                  {holiday.description ? (
                    <p className="mt-1 text-sm leading-relaxed text-text-secondary">{holiday.description}</p>
                  ) : null}
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
