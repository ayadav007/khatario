'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Loader2, Search, Check } from 'lucide-react';
import { useToastContext } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import { clsx } from 'clsx';

type AttendanceStatus = 'present' | 'absent' | 'half_day' | 'leave';

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
};

type Summary = {
  present: number;
  absent: number;
  pending: number;
  total: number;
};

type FilterMode = 'all' | 'pending';

const STATUS_OPTIONS: { value: AttendanceStatus; label: string; short: string }[] = [
  { value: 'present', label: 'Present', short: 'P' },
  { value: 'absent', label: 'Absent', short: 'A' },
  { value: 'half_day', label: 'Half day', short: '½' },
  { value: 'leave', label: 'Leave', short: 'L' },
];

function statusButtonClass(status: AttendanceStatus, selected: boolean): string {
  if (!selected) {
    return 'border-border bg-white text-text-secondary hover:bg-gray-50 active:bg-gray-100';
  }
  switch (status) {
    case 'present':
      return 'border-green-600 bg-green-50 text-green-800 font-semibold';
    case 'absent':
      return 'border-red-600 bg-red-50 text-red-800 font-semibold';
    case 'half_day':
      return 'border-amber-600 bg-amber-50 text-amber-900 font-semibold';
    case 'leave':
      return 'border-blue-600 bg-blue-50 text-blue-800 font-semibold';
  }
}

export function ManagerTeamRollCall() {
  const { business } = useAuth();
  const toast = useToastContext();

  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [team, setTeam] = useState<TeamRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rollCallScope, setRollCallScope] = useState<'team' | 'all'>('team');

  const loadTeam = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    setForbidden(false);
    try {
      const params = new URLSearchParams({ date });
      const res = await fetch(`/api/employees/manager/attendance?${params}`, {
        credentials: 'include',
      });
      if (res.status === 403) {
        setForbidden(true);
        setTeam([]);
        setSummary(null);
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to load team');
      }
      const data = await res.json();
      setRollCallScope(data.scope === 'all' ? 'all' : 'team');
      setTeam(data.team ?? []);
      setSummary(data.summary ?? null);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not load team');
    } finally {
      setLoading(false);
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
    if (!business?.id || savingId === employeeId) return;

    setTeam((prev) =>
      prev.map((row) =>
        row.id === employeeId
          ? {
              ...row,
              attendance_status: status,
              is_late: extras?.is_late ?? row.is_late,
              late_excused: extras?.late_excused ?? row.late_excused,
            }
          : row,
      ),
    );
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
      if (!res.ok) {
        throw new Error(data.error || 'Could not save');
      }
      toast.success(`${name.split(' ')[0]} — ${status.replace('_', ' ')}`);
      void loadTeam();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
      void loadTeam();
    } finally {
      setSavingId(null);
    }
  };

  const filteredTeam = useMemo(() => {
    let rows = team;
    if (filter === 'pending') {
      rows = rows.filter((r) => !r.attendance_status);
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
  }, [team, filter, search]);

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
  const pageDescription =
    rollCallScope === 'all'
      ? 'Tap P, A, ½, or L for each employee — saves automatically'
      : 'Tap a status for each person — saves automatically';

  return (
    <div className="pb-24 lg:pb-6">
      <MobileDuplicatePageChrome title={pageTitle} description={pageDescription} />

      {/* Sticky summary + search (mobile-first) */}
      <div className="sticky top-0 z-20 -mx-4 border-b border-border bg-surface px-4 py-3 lg:mx-0 lg:rounded-xl lg:border lg:px-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="text-sm font-semibold text-text-primary">
            <span className="sr-only">Date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-lg border border-border bg-white px-2 py-1 text-sm font-semibold text-text-primary"
            />
          </label>
          {summary ? (
            <p className="text-xs text-text-secondary">
              <span className="font-medium text-green-700">{summary.present} in</span>
              {' · '}
              <span className="font-medium text-text-primary">{summary.pending} left</span>
              {' · '}
              {summary.total} total
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
            {summary && summary.pending > 0 ? ` (${summary.pending})` : ''}
          </button>
        </div>
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
      ) : (
        <ul className="mt-3 space-y-3">
          {filteredTeam.map((member) => {
            const current = member.attendance_status;
            const isSaving = savingId === member.id;

            return (
              <li
                key={member.id}
                className="rounded-xl border border-border bg-white p-3 shadow-sm"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-text-primary">{member.name}</p>
                    <p className="text-xs text-text-muted">
                      {member.employee_code}
                      {member.designation ? ` · ${member.designation}` : ''}
                    </p>
                  </div>
                  {current && !isSaving ? (
                    <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-green-700">
                      <Check className="h-3.5 w-3.5" />
                      Saved
                    </span>
                  ) : isSaving ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-text-muted" />
                  ) : null}
                </div>

                <div className="grid grid-cols-4 gap-2">
                  {STATUS_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      disabled={isSaving}
                      onClick={() => void markStatus(member.id, opt.value, member.name)}
                      className={clsx(
                        'min-h-[44px] rounded-lg border text-sm transition-colors disabled:opacity-50',
                        statusButtonClass(opt.value, current === opt.value),
                      )}
                      aria-label={`${member.name} — ${opt.label}`}
                      aria-pressed={current === opt.value}
                    >
                      <span className="md:hidden">{opt.short}</span>
                      <span className="hidden md:inline">{opt.label}</span>
                    </button>
                  ))}
                </div>

                {current === 'present' && (
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
                      disabled={isSaving}
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
                        disabled={isSaving}
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
    </div>
  );
}
