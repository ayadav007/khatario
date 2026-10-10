'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Loader2, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { shiftYmd } from '@/lib/hr/staff-wage';
import { useToastContext } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import { clsx } from 'clsx';

type AttendanceStatus = 'present' | 'absent' | 'half_day' | 'leave' | 'off';

type TeamRow = {
  id: string;
  employee_code: string;
  name: string;
  designation: string | null;
  attendance_id: string | null;
  attendance_status: AttendanceStatus | null;
  is_late?: boolean | null;
  late_excused?: boolean | null;
  late_minutes?: number | null;
  pay_basis?: 'daily' | 'monthly' | null;
  rate?: number | null;
};

type FilterMode = 'all' | 'pending';

const FULL_STATUS_OPTIONS: { value: AttendanceStatus; label: string; short: string }[] = [
  { value: 'present', label: 'Present', short: 'P' },
  { value: 'absent', label: 'Absent', short: 'A' },
  { value: 'half_day', label: 'Half day', short: '½' },
  { value: 'leave', label: 'Leave', short: 'L' },
  { value: 'off', label: 'Off', short: 'O' },
];

const SIMPLE_STATUS_OPTIONS = FULL_STATUS_OPTIONS.filter(
  (o) => o.value === 'present' || o.value === 'absent' || o.value === 'half_day' || o.value === 'off',
);

function statusButtonClass(status: AttendanceStatus, selected: boolean): string {
  if (!selected) {
    return 'border-border bg-white text-text-secondary hover:bg-gray-50 active:bg-gray-100';
  }
  switch (status) {
    case 'present':
      return 'border-green-700 bg-green-600 text-white font-semibold shadow-sm';
    case 'absent':
      return 'border-red-700 bg-red-600 text-white font-semibold shadow-sm';
    case 'half_day':
      return 'border-amber-700 bg-amber-500 text-white font-semibold shadow-sm';
    case 'leave':
      return 'border-blue-700 bg-blue-600 text-white font-semibold shadow-sm';
    case 'off':
      return 'border-gray-700 bg-gray-600 text-white font-semibold shadow-sm';
  }
}

export function ManagerTeamRollCall({
  /** Present / Absent only (Billing Staff Lite register). */
  simpleStatuses = false,
}: {
  simpleStatuses?: boolean;
} = {}) {
  const { business } = useAuth();
  const toast = useToastContext();

  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [team, setTeam] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [rollCallScope, setRollCallScope] = useState<'team' | 'all'>('team');
  const [canViewWages, setCanViewWages] = useState(false);
  const [draft, setDraft] = useState<Record<string, AttendanceStatus>>({});
  const [viewMode, setViewMode] = useState<'list' | 'roll'>('list');
  const [rollIndex, setRollIndex] = useState(0);
  const saveSeq = useRef<Record<string, number>>({});
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const statusOptions = simpleStatuses ? SIMPLE_STATUS_OPTIONS : FULL_STATUS_OPTIONS;

  const loadTeam = useCallback(async (silent = false) => {
    if (!business?.id) return;
    const draftAtStart = draftRef.current;
    if (!silent) {
      setLoading(true);
      setForbidden(false);
      setDraft({});
    }
    try {
      const params = new URLSearchParams({ date });
      const res = await fetch(`/api/employees/manager/attendance?${params}`, {
        credentials: 'include',
      });
      if (res.status === 403) {
        setForbidden(true);
        setTeam([]);
        setDraft({});
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load team');
      }
      const data = await res.json();
      setRollCallScope(data.scope === 'all' ? 'all' : 'team');
      setCanViewWages(data.can_view_wages === true);
      setTeam(data.team ?? []);
      if (silent) {
        setDraft((current) => {
          const next = { ...current };
          for (const [id, status] of Object.entries(draftAtStart)) {
            if (current[id] === status) delete next[id];
          }
          return next;
        });
      }
    } catch (err: unknown) {
      if (!silent) toast.error(err instanceof Error ? err.message : 'Could not load team');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [business?.id, date, toast]);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

  const markStatus = async (
    employeeId: string,
    status: AttendanceStatus,
    name: string,
    extras?: { is_late?: boolean; late_excused?: boolean },
  ) => {
    if (simpleStatuses) {
      setDraft((prev) => ({ ...prev, [employeeId]: status }));
      return;
    }
    if (!business?.id) return;

    const requestSeq = (saveSeq.current[employeeId] ?? 0) + 1;
    saveSeq.current[employeeId] = requestSeq;

    let previous: TeamRow | undefined;
    setTeam((prev) => {
      previous = prev.find((row) => row.id === employeeId);
      return prev.map((row) =>
        row.id === employeeId
          ? {
              ...row,
              attendance_status: status,
              is_late: extras?.is_late ?? (status === 'present' ? row.is_late : false),
              late_excused: extras?.late_excused ?? (status === 'present' ? row.late_excused : false),
            }
          : row,
      );
    });
    setSavingId(employeeId);

    try {
      const res = await fetch('/api/employees/manager/attendance', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: employeeId,
          date,
          status,
          ...extras,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (saveSeq.current[employeeId] !== requestSeq) return;
      if (!res.ok) {
        throw new Error(data.error || 'Could not save');
      }
      const saved = data.attendance as
        | { status?: AttendanceStatus; is_late?: boolean; late_excused?: boolean; late_minutes?: number }
        | undefined;
      setTeam((prev) =>
        prev.map((row) =>
          row.id === employeeId
            ? {
                ...row,
                attendance_status: saved?.status ?? status,
                is_late: saved?.is_late ?? row.is_late,
                late_excused: saved?.late_excused ?? row.late_excused,
                late_minutes: saved?.late_minutes ?? row.late_minutes,
              }
            : row,
        ),
      );
    } catch (err: unknown) {
      if (saveSeq.current[employeeId] !== requestSeq) return;
      if (previous) {
        setTeam((prev) => prev.map((row) => (row.id === employeeId ? previous : row)));
      }
      toast.error(err instanceof Error ? err.message : `${name.split(' ')[0]} — save failed`);
    } finally {
      if (saveSeq.current[employeeId] === requestSeq) setSavingId(null);
    }
  };

  const statusOf = (member: TeamRow): AttendanceStatus | null =>
    draft[member.id] ?? member.attendance_status;

  const markedCount = team.filter((member) => statusOf(member)).length;

  const saveRegister = async () => {
    const marks = team
      .map((member) => ({ employee_id: member.id, status: statusOf(member) }))
      .filter((mark): mark is { employee_id: string; status: AttendanceStatus } => !!mark.status);
    if (marks.length === 0) {
      toast.error('Mark at least one person');
      return;
    }
    setSavingAll(true);
    try {
      const res = await fetch('/api/employees/manager/attendance', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, marks }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save');
      toast.success(`Attendance saved · ${marks.length}`);
      void loadTeam(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSavingAll(false);
    }
  };

  const markAllPresent = () => {
    setDraft((prev) => {
      const next = { ...prev };
      for (const member of team) {
        if ((prev[member.id] ?? member.attendance_status) === 'leave') continue;
        next[member.id] = 'present';
      }
      return next;
    });
  };

  const liveSummary = useMemo(() => {
    let present = 0;
    let absent = 0;
    let half = 0;
    let off = 0;
    let leave = 0;
    let pending = 0;
    for (const member of team) {
      const status = draft[member.id] ?? member.attendance_status;
      if (!status) pending++;
      else if (status === 'present') present++;
      else if (status === 'absent') absent++;
      else if (status === 'half_day') half++;
      else if (status === 'off') off++;
      else if (status === 'leave') leave++;
    }
    return { present, absent, half, off, leave, pending, total: team.length };
  }, [team, draft]);

  const filteredTeam = useMemo(() => {
    let rows = team;
    if (filter === 'pending') {
      rows = rows.filter((r) => {
        const chosen = draft[r.id] ?? r.attendance_status;
        if (!chosen) return true;
        // Keep someone you just tapped so P can be changed to A without leaving the list.
        return draft[r.id] != null && draft[r.id] !== r.attendance_status;
      });
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.employee_code.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [team, filter, search, draft]);

  const shiftDate = (days: number) => {
    if (simpleStatuses && Object.keys(draftRef.current).length > 0) {
      toast.warning('Unsaved attendance was cleared');
    }
    setDate((current) => shiftYmd(current, days));
  };

  const dateLabel = useMemo(() => {
    try {
      return format(new Date(`${date}T12:00:00`), 'EEE, d MMM yyyy');
    } catch {
      return date;
    }
  }, [date]);

  if (forbidden) {
    return (
      <div className="mx-auto max-w-lg space-y-4 py-12 text-center">
        <p className="text-text-primary font-medium">Cannot mark attendance</p>
        <p className="text-sm text-text-secondary">
          You need permission to mark attendance, or there are no active employees to show.
        </p>
      </div>
    );
  }

  const pageTitle = rollCallScope === 'all' ? 'Mark attendance' : 'Team roll call';
  const pageDescription = simpleStatuses
    ? 'Mark P, A, half, or Off, then save the day'
    : rollCallScope === 'all'
      ? 'Tap P, A, ½, L, or O for each employee — saves automatically'
      : 'Tap a status for each person — saves automatically';

  return (
    <div className="pb-24 lg:pb-6">
      <MobileDuplicatePageChrome title={pageTitle} description={pageDescription} />

      {/* Sticky summary + search (mobile-first) */}
      <div className="sticky top-0 z-20 -mx-4 border-b border-border bg-surface px-4 py-3 lg:mx-0 lg:rounded-xl lg:border lg:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous day"
              onClick={() => shiftDate(-1)}
              className="rounded-lg border border-border p-1.5"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <label className="text-sm font-semibold text-text-primary">
              <span className="sr-only">Date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => {
                  if (simpleStatuses && Object.keys(draftRef.current).length > 0) {
                    toast.warning('Unsaved attendance was cleared');
                  }
                  setDate(e.target.value);
                }}
                className="rounded-lg border border-border bg-white px-2 py-1 text-sm font-semibold text-text-primary"
              />
            </label>
            <button
              type="button"
              aria-label="Next day"
              onClick={() => shiftDate(1)}
              className="rounded-lg border border-border p-1.5"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          {!loading && team.length > 0 ? (
            <p className="text-xs text-text-secondary">
              <span className="font-medium text-green-700">{liveSummary.present} present</span>
              {' · '}
              <span className="font-medium text-red-700">{liveSummary.absent} absent</span>
              {liveSummary.half > 0 ? ` · ${liveSummary.half} half` : ''}
              {liveSummary.off > 0 ? ` · ${liveSummary.off} off` : ''}
              {liveSummary.leave > 0 ? ` · ${liveSummary.leave} leave` : ''}
              {' · '}
              <span className="font-medium text-text-primary">{liveSummary.pending} left</span>
            </p>
          ) : null}
        </div>

        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <input
            type="search"
            placeholder="Search name or code"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input w-full pl-9 text-base"
            autoComplete="off"
          />
        </div>

        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={clsx(
              'rounded-full px-3 py-1 text-xs font-medium border',
              filter === 'all'
                ? 'border-gray-400 bg-gray-100 text-text-primary'
                : 'border-border bg-white text-text-secondary',
            )}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setFilter('pending')}
            className={clsx(
              'rounded-full px-3 py-1 text-xs font-medium border',
              filter === 'pending'
                ? 'border-amber-500 bg-amber-50 text-amber-900'
                : 'border-border bg-white text-text-secondary',
            )}
          >
            Not marked
            {liveSummary.pending > 0 ? ` (${liveSummary.pending})` : ''}
          </button>
        </div>
        {simpleStatuses ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={markAllPresent}
              className="rounded-full border border-violet-300 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-900"
            >
              Mark all present
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={clsx(
                'rounded-full border px-3 py-1 text-xs font-medium',
                viewMode === 'list' ? 'border-gray-500 bg-gray-100' : 'border-border bg-white',
              )}
            >
              List
            </button>
            <button
              type="button"
              onClick={() => {
                setRollIndex(0);
                setViewMode('roll');
              }}
              className={clsx(
                'rounded-full border px-3 py-1 text-xs font-medium',
                viewMode === 'roll' ? 'border-gray-500 bg-gray-100' : 'border-border bg-white',
              )}
            >
              Roll-call
            </button>
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
        </div>
      ) : team.length === 0 ? (
        <p className="py-12 text-center text-sm text-text-secondary">
          {rollCallScope === 'team'
            ? 'No active direct reports. Assign a reporting manager on employee profiles.'
            : 'No active employees found.'}
        </p>
      ) : filteredTeam.length === 0 ? (
        <p className="py-12 text-center text-sm text-text-secondary">
          {filter === 'pending' ? 'Everyone is marked for this day.' : 'No matches.'}
        </p>
      ) : simpleStatuses && viewMode === 'roll' ? (
        <RollCallCard
          member={filteredTeam[Math.min(rollIndex, filteredTeam.length - 1)]}
          status={statusOf(filteredTeam[Math.min(rollIndex, filteredTeam.length - 1)])}
          index={Math.min(rollIndex, filteredTeam.length - 1)}
          total={filteredTeam.length}
          showRate={canViewWages}
          onStatus={(status) => {
            const member = filteredTeam[Math.min(rollIndex, filteredTeam.length - 1)];
            void markStatus(member.id, status, member.name);
          }}
          onPrev={() => setRollIndex((current) => Math.max(0, current - 1))}
          onNext={() => setRollIndex((current) => Math.min(filteredTeam.length - 1, current + 1))}
        />
      ) : (
        <ul className="mt-3 space-y-3">
          {filteredTeam.map((member) => {
            const current = statusOf(member);
            const isSaving = savingId === member.id;
            const unsaved = simpleStatuses && draft[member.id] != null && draft[member.id] !== member.attendance_status;

            return (
              <li
                key={member.id}
                className={clsx(
                  'rounded-xl border border-border bg-white shadow-sm',
                  simpleStatuses ? 'p-3 sm:flex sm:items-center sm:justify-between sm:gap-4' : 'p-3',
                )}
              >
                <div
                  className={clsx(
                    'flex items-start justify-between gap-2',
                    simpleStatuses ? 'mb-3 min-w-0 sm:mb-0 sm:flex-1' : 'mb-3',
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-text-primary">{member.name}</p>
                    <p className="text-xs text-text-muted">
                      {member.employee_code}
                      {member.designation ? ` · ${member.designation}` : ''}
                      {canViewWages && member.rate
                        ? ` · ₹${member.rate}/${member.pay_basis === 'daily' ? 'day' : 'month'}`
                        : ''}
                    </p>
                  </div>
                  {isSaving ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-text-muted" />
                  ) : unsaved ? (
                    <span className="shrink-0 text-xs font-medium text-amber-800">Not saved</span>
                  ) : null}
                </div>

                <div
                  className={clsx(
                    'grid gap-2',
                    simpleStatuses ? 'grid-cols-4 sm:w-64 sm:shrink-0' : 'grid-cols-5',
                  )}
                >
                  {statusOptions.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => void markStatus(member.id, opt.value, member.name)}
                      className={clsx(
                        'min-h-[44px] rounded-lg border px-1 py-1.5 text-sm transition-colors',
                        statusButtonClass(opt.value, current === opt.value),
                      )}
                      aria-label={`${member.name} — ${opt.label}`}
                      aria-pressed={current === opt.value}
                    >
                      <span className="block text-base leading-none">{opt.short}</span>
                      <span className={clsx('mt-0.5 block text-[10px] leading-none', current === opt.value ? 'text-white/90' : 'text-text-muted')}>
                        {opt.label}
                      </span>
                    </button>
                  ))}
                </div>

                {!simpleStatuses && current === 'present' && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {member.is_late && !member.late_excused ? (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-900">
                        Late{member.late_minutes ? ` · ${member.late_minutes}m` : ''}
                      </span>
                    ) : null}
                    {member.late_excused ? (
                      <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs text-blue-800">
                        Late excused
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() =>
                        void markStatus(member.id, 'present', member.name, {
                          is_late: !member.is_late,
                          late_excused: false,
                        })
                      }
                      className="rounded-md border border-border px-2 py-1 text-xs text-text-secondary hover:bg-gray-50"
                    >
                      {member.is_late && !member.late_excused ? 'Clear late' : 'Mark late'}
                    </button>
                    {member.is_late && !member.late_excused ? (
                      <button
                        type="button"
                        onClick={() =>
                          void markStatus(member.id, 'present', member.name, {
                            is_late: true,
                            late_excused: true,
                          })
                        }
                        className="rounded-md border border-border px-2 py-1 text-xs text-text-secondary hover:bg-gray-50"
                      >
                        Excuse late
                      </button>
                    ) : null}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 hidden text-xs text-text-muted md:block">{dateLabel}</p>

      {simpleStatuses && canViewWages ? <StaffWagePanel date={date} /> : null}

      {simpleStatuses ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-white p-3 lg:static lg:mt-4 lg:border-0 lg:bg-transparent lg:p-0">
          <button
            type="button"
            disabled={savingAll}
            onClick={() => void saveRegister()}
            className="w-full rounded-xl bg-violet-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-60 lg:w-auto"
          >
            {savingAll ? 'Saving…' : `Save attendance · ${markedCount}/${team.length}`}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function inr(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

function RollCallCard({
  member,
  status,
  index,
  total,
  showRate,
  onStatus,
  onPrev,
  onNext,
}: {
  member: TeamRow;
  status: AttendanceStatus | null;
  index: number;
  total: number;
  showRate: boolean;
  onStatus: (status: AttendanceStatus) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mt-4 rounded-2xl border border-border bg-white p-4">
      <p className="text-xs text-text-muted">{index + 1} of {total}</p>
      <p className="mt-1 text-xl font-semibold text-text-primary">{member.name}</p>
      <p className="text-sm text-text-secondary">
        {member.employee_code}
        {showRate && member.rate
          ? ` · ₹${member.rate}/${member.pay_basis === 'daily' ? 'day' : 'month'}`
          : ''}
      </p>
      <div className="mt-4 grid grid-cols-4 gap-2">
        {SIMPLE_STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onStatus(opt.value)}
            className={clsx(
              'min-h-[48px] rounded-lg border px-1 py-1.5 text-sm',
              statusButtonClass(opt.value, status === opt.value),
            )}
          >
            <span className="block text-base leading-none">{opt.short}</span>
            <span className={clsx('mt-0.5 block text-[10px] leading-none', status === opt.value ? 'text-white/90' : 'text-text-muted')}>
              {opt.label}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-4 flex justify-between">
        <button type="button" onClick={onPrev} className="text-sm font-medium text-text-secondary">Previous</button>
        <button type="button" onClick={onNext} className="text-sm font-medium text-text-secondary">Next</button>
      </div>
    </div>
  );
}

type WageLine = {
  employee_id: string;
  name: string;
  pay_basis: 'daily' | 'monthly';
  gross: number;
  present_days: number;
  half_days: number;
};

type OpenPayable = {
  accrual_id: string;
  name: string;
  period_kind: 'week' | 'month';
  period_start: string;
  period_end: string;
  due: number;
};

function StaffWagePanel({ date }: { date: string }) {
  const toast = useToastContext();
  const [period, setPeriod] = useState<'week' | 'month'>('week');
  const [loading, setLoading] = useState(true);
  const [earned, setEarned] = useState(0);
  const [closed, setClosed] = useState(false);
  const [lines, setLines] = useState<WageLine[]>([]);
  const [open, setOpen] = useState<OpenPayable[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/employees/staff-wages?date=${date}&period=${period}`, {
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not load wages');
      if (!data.can_view_wages) return;
      setEarned(Number(data.earned_total ?? 0));
      setClosed(data.already_closed === true);
      setLines(data.lines ?? []);
      setOpen(data.open_payables ?? []);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not load wages');
    } finally {
      setLoading(false);
    }
  }, [date, period, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const closePeriod = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/employees/staff-wages/close', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, period }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not post');
      toast.success('Posted to Salaries & Wages and Salary Payable');
      void load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not post');
    } finally {
      setBusy(false);
    }
  };

  const pay = async (row: OpenPayable) => {
    setBusy(true);
    try {
      const res = await fetch('/api/employees/staff-wages/pay', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accrual_id: row.accrual_id,
          amount: row.due,
          payment_date: date,
          payment_mode: 'cash',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not pay');
      toast.success(`Paid ${row.name}`);
      void load();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not pay');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-6 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-text-primary">Wages in the books</h2>
        <div className="flex gap-2">
          <button type="button" onClick={() => setPeriod('week')} className={clsx('rounded-full border px-3 py-1 text-xs', period === 'week' ? 'bg-gray-100' : 'bg-white')}>Week</button>
          <button type="button" onClick={() => setPeriod('month')} className={clsx('rounded-full border px-3 py-1 text-xs', period === 'month' ? 'bg-gray-100' : 'bg-white')}>Month</button>
        </div>
      </div>
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin text-text-muted" />
      ) : (
        <>
          <p className="text-sm text-text-secondary">
            {closed ? 'This period is already posted.' : `Earned so far ${inr(earned)}. Closing posts the expense and leaves unpaid wages in Salary Payable.`}
          </p>
          <ul className="space-y-1 text-sm">
            {lines.filter((line) => line.gross > 0).map((line) => (
              <li key={line.employee_id} className="flex justify-between gap-2">
                <span>{line.name}</span>
                <span>
                  {line.pay_basis === 'daily' ? `${line.present_days} + ${line.half_days} half · ` : 'Monthly · '}
                  {inr(line.gross)}
                </span>
              </li>
            ))}
          </ul>
          {!closed ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void closePeriod()}
              className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
            >
              Post {period} to books
            </button>
          ) : null}
          {open.length > 0 ? (
            <ul className="space-y-2">
              {open.map((row) => (
                <li key={row.accrual_id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                  <span>
                    {row.name} · due {inr(row.due)}
                    <span className="block text-xs text-text-muted">{row.period_start} to {row.period_end}</span>
                  </span>
                  <button type="button" disabled={busy} onClick={() => void pay(row)} className="text-sm font-medium text-violet-800">
                    Pay cash
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}
