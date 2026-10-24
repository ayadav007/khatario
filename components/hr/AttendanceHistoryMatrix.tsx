'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Search } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import {
  monthCalendarSummary,
  type AttendanceCalendarCode,
  type AttendanceMatrixCellKind,
} from '@/lib/hr/attendance-matrix';

type MatrixDay = {
  date: string;
  day: number;
  weekday: string;
  isSunday: boolean;
};

type MatrixCell = {
  kind: AttendanceMatrixCellKind;
  label: string;
  hours: number;
  countsAsDay: boolean;
  calendarCode: AttendanceCalendarCode;
  missingOutPunch: boolean;
  earlyMinutes: number;
  lateMinutes: number;
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

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

function shortMonthLabel(value: string) {
  const [year, month] = value.split('-').map(Number);
  const name = new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
  return `${name}-${year}`;
}

function weekdayIndex(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day).getDay();
}

export function AttendanceHistoryMatrix() {
  const [month, setMonth] = useState(currentMonthValue);
  const [search, setSearch] = useState('');
  const [employeeId, setEmployeeId] = useState('');
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

  useEffect(() => {
    if (!visibleWorkers.some((worker) => worker.id === employeeId)) {
      setEmployeeId(visibleWorkers[0]?.id ?? '');
    }
  }, [visibleWorkers, employeeId]);

  const selectedWorker = visibleWorkers.find((worker) => worker.id === employeeId) ?? visibleWorkers[0];

  return (
    <div className="space-y-3">
      <div className="md:hidden">
        <MobileMonthCalendar
          month={month}
          onMonthChange={setMonth}
          search={search}
          onSearch={setSearch}
          workers={visibleWorkers}
          selected={selectedWorker}
          onSelect={setEmployeeId}
          days={days}
          loading={loading}
          error={error}
        />
      </div>

      <div className="hidden space-y-3 md:block">
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
          <DesktopToolbar
            search={search}
            onSearch={setSearch}
            month={month}
            onMonthChange={setMonth}
          />
          {loading ? (
            <LoadingState />
          ) : error ? (
            <p className="py-8 text-center text-sm text-rose-700">{error}</p>
          ) : visibleWorkers.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-secondary">No employees to show for this month.</p>
          ) : (
            <WorkerMatrix days={days} workers={visibleWorkers} />
          )}
        </Card>
      </div>
    </div>
  );
}

function MobileMonthCalendar({
  month,
  onMonthChange,
  search,
  onSearch,
  workers,
  selected,
  onSelect,
  days,
  loading,
  error,
}: {
  month: string;
  onMonthChange: (value: string) => void;
  search: string;
  onSearch: (value: string) => void;
  workers: MatrixWorker[];
  selected?: MatrixWorker;
  onSelect: (id: string) => void;
  days: MatrixDay[];
  loading: boolean;
  error: string | null;
}) {
  const summary = selected ? monthCalendarSummary(selected.cells, days.length) : null;
  const leadingBlanks = days[0] ? weekdayIndex(days[0].date) : 0;

  return (
    <div className="space-y-3 rounded-2xl bg-sky-50 p-3">
      <div>
        <h2 className="text-xl font-semibold text-sky-700">Monthly Attendance</h2>
        <p className="text-sm text-text-secondary">Overview of attendance during a month.</p>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          type="text"
          placeholder="Search by name or code..."
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {workers.length > 1 ? (
        <label className="block text-sm font-medium text-text-secondary">
          Employee
          <select
            className="input mt-1 h-11 w-full text-base"
            value={selected?.id ?? ''}
            onChange={(e) => onSelect(e.target.value)}
          >
            {workers.map((worker) => (
              <option key={worker.id} value={worker.id}>
                {worker.name} ({worker.code})
              </option>
            ))}
          </select>
        </label>
      ) : selected ? (
        <p className="text-sm font-medium text-text-primary">
          {selected.name} <span className="font-mono text-text-secondary">{selected.code}</span>
        </p>
      ) : null}

      <div className="flex items-center justify-between">
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-sky-200 bg-white text-sky-700"
          onClick={() => onMonthChange(shiftMonth(month, -1))}
          aria-label="Previous month"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <label className="relative text-base font-semibold tracking-wide text-text-primary">
          <span>{shortMonthLabel(month)}</span>
          <input
            type="month"
            value={month}
            onChange={(e) => e.target.value && onMonthChange(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label={monthLabel(month)}
          />
        </label>
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-sky-200 bg-white text-sky-700"
          onClick={() => onMonthChange(shiftMonth(month, 1))}
          aria-label="Next month"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {loading ? (
        <LoadingState />
      ) : error ? (
        <p className="py-8 text-center text-sm text-rose-700">{error}</p>
      ) : !selected || !summary ? (
        <p className="py-8 text-center text-sm text-text-secondary">No employees to show for this month.</p>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-2">
            <StatCard label="Total Days" value={summary.totalDaysLabel} valueClass="text-slate-800" />
            <StatCard label="Presents" value={summary.presentsLabel} valueClass="text-cyan-700" />
            <StatCard label="Absents" value={summary.absentsLabel} valueClass="text-rose-600" />
            <StatCard label="Leaves" value={summary.leavesLabel} valueClass="text-fuchsia-700" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <StatCard label="In Office Hrs" value={summary.officeHoursLabel} valueClass="text-sky-800" />
            <StatCard label="Early-In Hrs" value={summary.earlyLabel} valueClass="text-emerald-600" />
            <StatCard label="Late-In Hrs" value={summary.lateLabel} valueClass="text-amber-600" />
          </div>

          <div className="grid grid-cols-7 gap-1.5 pt-1">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className="flex justify-center">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-800 text-[10px] font-semibold text-white">
                  {label}
                </span>
              </div>
            ))}
            {Array.from({ length: leadingBlanks }, (_, index) => (
              <div key={`blank-${index}`} />
            ))}
            {days.map((day, index) => {
              const cell = selected.cells[index];
              return <DayBubble key={day.date} day={day.day} cell={cell} />;
            })}
          </div>

          <p className="flex items-center gap-2 pt-1 text-xs text-text-secondary">
            <span className="h-2 w-2 rounded-full bg-red-500" />
            Out punch missing
          </p>
        </>
      )}
    </div>
  );
}

function DayBubble({ day, cell }: { day: number; cell?: MatrixCell }) {
  const code = cell?.calendarCode ?? '';
  const missing = Boolean(cell?.missingOutPunch);
  let tone = 'border border-slate-200 bg-white text-slate-500';
  if (missing) tone = 'bg-red-500 text-white';
  else if (code === 'P') tone = 'bg-cyan-600 text-white';
  else if (code === 'P/A') tone = 'bg-cyan-800 text-white';
  else if (code === 'A') tone = 'bg-rose-500 text-white';
  else if (code === 'L') tone = 'bg-fuchsia-500 text-white';
  else if (code === 'W') tone = 'bg-slate-400 text-white';
  else if (code === 'H') tone = 'bg-emerald-500 text-white';

  return (
    <div className={`flex aspect-square flex-col items-center justify-center rounded-full text-center ${tone}`}>
      <span className="text-[10px] font-medium leading-none">{String(day).padStart(2, '0')}</span>
      {code ? <span className="mt-0.5 text-[9px] font-semibold leading-none">{code}</span> : null}
    </div>
  );
}

function StatCard({ label, value, valueClass }: { label: string; value: string; valueClass: string }) {
  return (
    <div className="rounded-xl bg-white px-1.5 py-2 text-center shadow-sm">
      <div className="text-[10px] leading-tight text-slate-500">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${valueClass}`}>{value}</div>
    </div>
  );
}

function DesktopToolbar({
  search,
  onSearch,
  month,
  onMonthChange,
}: {
  search: string;
  onSearch: (value: string) => void;
  month: string;
  onMonthChange: (value: string) => void;
}) {
  return (
    <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          type="text"
          placeholder="Search by name or code..."
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="pl-9"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onMonthChange(shiftMonth(month, -1))} aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <label className="text-sm font-medium text-text-primary">
          <span className="sr-only">Month</span>
          <input
            type="month"
            value={month}
            onChange={(e) => e.target.value && onMonthChange(e.target.value)}
            className="input h-10"
            aria-label={monthLabel(month)}
          />
        </label>
        <Button type="button" variant="outline" size="sm" onClick={() => onMonthChange(shiftMonth(month, 1))} aria-label="Next month">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function WorkerMatrix({ days, workers }: { days: MatrixDay[]; workers: MatrixWorker[] }) {
  return (
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
          {workers.map((worker, index) => {
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
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
    </div>
  );
}

function LegendChip({ label, className }: { label: string; className: string }) {
  return <span className={`rounded-full px-2 py-1 font-medium ${className}`}>{label}</span>;
}
