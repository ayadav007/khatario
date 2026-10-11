'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Search } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import type { AttendanceMatrixCellKind } from '@/lib/hr/attendance-matrix';

type MatrixDay = {
  date: string;
  day: number;
  weekday: string;
  isSunday: boolean;
};

type MatrixCell = {
  kind: AttendanceMatrixCellKind;
  label: string;
};

type MatrixWorker = {
  id: string;
  code: string;
  name: string;
  cells: MatrixCell[];
  days: number;
  totalHoursLabel: string;
};

const CELL_CLASS: Record<AttendanceMatrixCellKind, string> = {
  present: 'bg-emerald-100 text-emerald-800',
  overtime: 'bg-amber-100 text-amber-800',
  half_day: 'bg-sky-100 text-sky-800',
  absent: 'bg-rose-100 text-rose-700',
  leave: 'bg-fuchsia-100 text-fuchsia-800',
  off: 'text-slate-400',
  empty: '',
};

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(value: string, delta: number) {
  const [year, month] = value.split('-').map(Number);
  const next = new Date(year, month - 1 + delta, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(value: string) {
  const [year, month] = value.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

export function AttendanceHistoryMatrix() {
  const [month, setMonth] = useState(currentMonthValue);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<MatrixDay[]>([]);
  const [workers, setWorkers] = useState<MatrixWorker[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/employees/attendance/matrix?month=${month}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not load attendance matrix');
        return data as { days: MatrixDay[]; workers: MatrixWorker[] };
      })
      .then((data) => {
        if (cancelled) return;
        setDays(data.days || []);
        setWorkers(data.workers || []);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDays([]);
        setWorkers([]);
        setError(err instanceof Error ? err.message : 'Could not load attendance matrix');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [month]);

  const visibleWorkers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return workers;
    return workers.filter(
      (worker) =>
        worker.name.toLowerCase().includes(query) || worker.code.toLowerCase().includes(query),
    );
  }, [workers, search]);

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Attendance history</h2>
            <p className="text-sm text-text-secondary">
              Day-by-day marks for the month, with worked days and total hours.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <LegendChip className="bg-emerald-100 text-emerald-800" label="P: 8h Present" />
            <LegendChip className="bg-amber-100 text-amber-800" label=">8: Overtime" />
            <LegendChip className="bg-sky-100 text-sky-800" label="HD: 4h Half day" />
            <LegendChip className="bg-rose-100 text-rose-700" label="A: Absent" />
            <LegendChip className="bg-fuchsia-100 text-fuchsia-800" label="L: Leave" />
            <LegendChip className="bg-slate-100 text-slate-500" label="–: Weekly off" />
          </div>
        </div>
      </Card>

      <Card padding="sm">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              type="text"
              placeholder="Search by name or code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setMonth((m) => shiftMonth(m, -1))} aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <label className="text-sm font-medium text-text-primary">
              <span className="sr-only">Month</span>
              <input
                type="month"
                value={month}
                onChange={(e) => e.target.value && setMonth(e.target.value)}
                className="input h-10"
                aria-label={monthLabel(month)}
              />
            </label>
            <Button type="button" variant="outline" size="sm" onClick={() => setMonth((m) => shiftMonth(m, 1))} aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
          </div>
        ) : error ? (
          <p className="py-8 text-center text-sm text-rose-700">{error}</p>
        ) : visibleWorkers.length === 0 ? (
          <p className="py-8 text-center text-sm text-text-secondary">No employees to show for this month.</p>
        ) : (
          <div className="max-w-full overflow-x-auto">
            <table className="min-w-max border-separate border-spacing-0 text-xs">
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 min-w-[148px] bg-slate-900 px-3 py-2 text-left font-semibold text-white">
                    Worker
                  </th>
                  {days.map((day) => (
                    <th
                      key={day.date}
                      className={`w-9 min-w-9 px-1 py-1 text-center font-medium ${
                        day.isSunday ? 'bg-rose-50 text-rose-600' : 'bg-slate-800 text-slate-100'
                      }`}
                    >
                      <div>{day.weekday}</div>
                      <div className="text-[11px]">{day.day}</div>
                    </th>
                  ))}
                  <th className="sticky right-[5.5rem] z-20 min-w-[3.5rem] bg-slate-900 px-2 py-2 text-right font-semibold text-white">
                    Days
                  </th>
                  <th className="sticky right-0 z-20 min-w-[5.5rem] bg-slate-900 px-2 py-2 text-right font-semibold text-white">
                    Total Hours
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleWorkers.map((worker, index) => {
                  const stripe = index % 2 === 0 ? 'bg-white' : 'bg-slate-50';
                  return (
                    <tr key={worker.id}>
                      <th className={`sticky left-0 z-10 min-w-[148px] border-b border-border px-3 py-2 text-left ${stripe}`}>
                        <div className="font-medium text-text-primary">{worker.name}</div>
                        <div className="font-mono text-[11px] text-text-secondary">{worker.code}</div>
                      </th>
                      {worker.cells.map((cell, cellIndex) => (
                        <td key={days[cellIndex]?.date ?? cellIndex} className={`border-b border-border px-0.5 py-1 text-center ${stripe}`}>
                          {cell.label ? (
                            <span
                              className={`inline-flex min-w-[1.6rem] items-center justify-center rounded px-1 py-0.5 font-semibold ${CELL_CLASS[cell.kind]}`}
                            >
                              {cell.label}
                            </span>
                          ) : null}
                        </td>
                      ))}
                      <td className={`sticky right-[5.5rem] z-10 min-w-[3.5rem] border-b border-border px-2 py-2 text-right font-medium text-text-primary ${stripe}`}>
                        {worker.days}
                      </td>
                      <td className={`sticky right-0 z-10 min-w-[5.5rem] border-b border-border px-2 py-2 text-right font-semibold text-text-primary ${stripe}`}>
                        {worker.totalHoursLabel}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function LegendChip({ label, className }: { label: string; className: string }) {
  return <span className={`rounded-full px-2 py-1 font-medium ${className}`}>{label}</span>;
}
