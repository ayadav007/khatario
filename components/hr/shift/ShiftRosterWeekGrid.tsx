'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { format, addDays, parseISO } from 'date-fns';
import { ChevronLeft, ChevronRight, Loader2, Save, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import type { RosterCell, ShiftRosterSettings } from '@/lib/hr/shift-overtime/shift-roster-shared';

type EmployeeRow = {
  id: string;
  employee_code: string;
  employee_name: string;
  department: string | null;
  default_shift_id: string | null;
};

type ShiftOption = {
  id: string;
  shift_name: string;
  start_time: string;
  end_time: string;
};

type Props = {
  department?: string;
  branchId?: string;
};

function cellKey(employeeId: string, date: string) {
  return `${employeeId}|${date}`;
}

export function ShiftRosterWeekGrid({ department, branchId }: Props) {
  const { business } = useAuth();
  const toast = useToastContext();
  const [weekStart, setWeekStart] = useState(() => {
    const d = new Date();
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return format(d, 'yyyy-MM-dd');
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [days, setDays] = useState<string[]>([]);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [shifts, setShifts] = useState<ShiftOption[]>([]);
  const [cells, setCells] = useState<Record<string, RosterCell>>({});
  const [draft, setDraft] = useState<Record<string, RosterCell>>({});
  const [settings, setSettings] = useState<ShiftRosterSettings | null>(null);

  const load = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        week_start: weekStart,
      });
      if (department) params.set('department', department);
      if (branchId) params.set('branch_id', branchId);
      const res = await fetch(`/api/hr/shifts/roster?${params}`, { credentials: 'include' });
      if (!res.ok) {
        toast.error((await res.json()).error ?? 'Failed to load roster');
        return;
      }
      const data = await res.json();
      setDays(data.days ?? []);
      setEmployees(data.employees ?? []);
      setShifts(data.shifts ?? []);
      setCells(data.cells ?? {});
      setDraft(data.cells ?? {});
      setSettings(data.settings ?? null);
    } finally {
      setLoading(false);
    }
  }, [business?.id, weekStart, department, branchId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(() => JSON.stringify(cells) !== JSON.stringify(draft), [cells, draft]);

  function setCell(employeeId: string, date: string, value: string) {
    const key = cellKey(employeeId, date);
    if (value === '') {
      setDraft((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      return;
    }
    if (value === '__off__') {
      setDraft((prev) => ({
        ...prev,
        [key]: { shift_id: null, is_day_off: true },
      }));
      return;
    }
    setDraft((prev) => ({
      ...prev,
      [key]: { shift_id: value, is_day_off: false },
    }));
  }

  async function handleSave() {
    if (!business?.id) return;
    setSaving(true);
    try {
      const entries = Object.entries(draft).map(([key, cell]) => {
        const [employee_id, roster_date] = key.split('|');
        return {
          employee_id,
          roster_date,
          shift_id: cell.shift_id,
          is_day_off: cell.is_day_off,
        };
      });
      const res = await fetch('/api/hr/shifts/roster', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id, entries }),
      });
      if (!res.ok) {
        toast.error((await res.json()).error ?? 'Save failed');
        return;
      }
      toast.success('Roster saved');
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function handleFillDefaults() {
    if (!business?.id) return;
    setSaving(true);
    try {
      const res = await fetch('/api/hr/shifts/roster', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          action: 'fill_defaults',
          week_start: weekStart,
          department,
          branch_id: branchId,
        }),
      });
      if (!res.ok) {
        toast.error((await res.json()).error ?? 'Fill failed');
        return;
      }
      const data = await res.json();
      toast.success(`Filled ${data.filled} roster cells from defaults`);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function toggleAutoAbsent(checked: boolean) {
    if (!business?.id || !settings) return;
    const res = await fetch('/api/hr/shifts/roster', {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_id: business.id,
        settings: { ...settings, auto_mark_absent: checked },
      }),
    });
    if (res.ok) {
      setSettings((await res.json()).settings);
      toast.success('Roster settings updated');
    }
  }

  function shiftLabel(id: string) {
    const s = shifts.find((x) => x.id === id);
    if (!s) return id;
    return `${s.shift_name} (${s.start_time?.slice(0, 5)}–${s.end_time?.slice(0, 5)})`;
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setWeekStart(format(addDays(parseISO(weekStart), -7), 'yyyy-MM-dd'))}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium text-text-primary">
            {days[0] ? format(parseISO(days[0]), 'dd MMM') : ''} –{' '}
            {days[6] ? format(parseISO(days[6]), 'dd MMM yyyy') : ''}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => setWeekStart(format(addDays(parseISO(weekStart), 7), 'yyyy-MM-dd'))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={saving} onClick={() => void handleFillDefaults()}>
            <Wand2 className="mr-2 h-4 w-4" />
            Fill from defaults
          </Button>
          <Button type="button" disabled={saving || !dirty} onClick={() => void handleSave()}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Save roster
          </Button>
        </div>
      </div>

      {settings ? (
        <Card className="flex flex-wrap items-center gap-4 p-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={settings.auto_mark_absent}
              onChange={(e) => void toggleAutoAbsent(e.target.checked)}
            />
            Auto-mark absent when rostered but no check-in (after grace period)
          </label>
        </Card>
      ) : null}

      {employees.length === 0 ? (
        <p className="text-sm text-text-secondary">No active employees match the filter.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-white">
          <table className="min-w-[900px] w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-gray-50">
                <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2 text-left font-semibold">Employee</th>
                {days.map((d) => (
                  <th key={d} className="min-w-[120px] px-2 py-2 text-left font-semibold">
                    {format(parseISO(d), 'EEE dd')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.id} className="border-b border-border">
                  <td className="sticky left-0 z-10 bg-white px-3 py-2">
                    <div className="font-medium text-text-primary">{emp.employee_name}</div>
                    <div className="text-text-muted">{emp.employee_code}</div>
                  </td>
                  {days.map((d) => {
                    const key = cellKey(emp.id, d);
                    const cell = draft[key];
                    const value = cell?.is_day_off ? '__off__' : cell?.shift_id ?? '';
                    return (
                      <td key={d} className="px-1 py-1">
                        <select
                          className="input w-full min-w-[110px] py-1 text-xs"
                          value={value}
                          onChange={(e) => setCell(emp.id, d, e.target.value)}
                        >
                          <option value="">—</option>
                          <option value="__off__">Off</option>
                          {shifts.map((s) => (
                            <option key={s.id} value={s.id}>
                              {shiftLabel(s.id)}
                            </option>
                          ))}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
