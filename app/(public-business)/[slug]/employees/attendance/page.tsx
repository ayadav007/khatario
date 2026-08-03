'use client';

import { useEffect, useState } from 'react';
import { format, subDays } from 'date-fns';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Loader2 } from 'lucide-react';
import { useEmployeePortal } from '@/components/employee-portal/EmployeePortalContext';
import { getPortalCheckInLocation } from '@/lib/employee-portal/geolocation';
import { AttendanceLogLine } from '@/components/hr/AttendanceLogLine';
import { AttendanceRegularizationForm } from '@/components/hr/AttendanceRegularizationForm';
import { attendanceDateYmd, isSameAttendanceDate } from '@/lib/hr/attendance-date';
import {
  REGULARIZATION_REQUEST_TYPE_LABELS,
  type RegularizationRequestRow,
  type RegularizationSettings,
} from '@/lib/hr/attendance-regularization-shared';

type AttendanceRecord = {
  date: string;
  check_in_time?: string | null;
  check_out_time?: string | null;
  status?: string;
  check_in_location_lat?: number | string | null;
  check_in_location_lng?: number | string | null;
  check_out_location_lat?: number | string | null;
  check_out_location_lng?: number | string | null;
};

export default function EmployeePortalAttendancePage() {
  const { session } = useEmployeePortal();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [todayRecord, setTodayRecord] = useState<AttendanceRecord | null>(null);
  const [processing, setProcessing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [regSettings, setRegSettings] = useState<RegularizationSettings | null>(null);
  const [regRequests, setRegRequests] = useState<RegularizationRequestRow[]>([]);
  const [regularizeDate, setRegularizeDate] = useState<string | null>(null);

  const load = async () => {
    if (!session) return;
    setLoading(true);
    const start = format(subDays(new Date(), 30), 'yyyy-MM-dd');
    const end = attendanceDateYmd();
    const params = new URLSearchParams({
      business_id: session.business.id,
      employee_id: session.employee.id,
      start_date: start,
      end_date: end,
    });
    const [attRes, regRes] = await Promise.all([
      fetch(`/api/employees/attendance?${params}`, { credentials: 'include' }),
      fetch('/api/employees/attendance-regularization', { credentials: 'include' }),
    ]);
    if (attRes.ok) {
      const data = await attRes.json();
      const rows: AttendanceRecord[] = data.attendance ?? data.records ?? [];
      setRecords(rows);
      const today = attendanceDateYmd();
      setTodayRecord(rows.find((r) => isSameAttendanceDate(r.date, today)) ?? null);
    }
    if (regRes.ok) {
      const data = await regRes.json();
      setRegSettings(data.settings ?? null);
      setRegRequests(data.requests ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [session]);

  const checkInOut = async (action: 'check-in' | 'check-out') => {
    if (!session) return;
    setProcessing(true);
    setActionError(null);
    try {
      const location = await getPortalCheckInLocation();
      const res = await fetch(`/api/employees/attendance/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: session.employee.id,
          location_lat: location?.lat,
          location_lng: location?.lng,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setActionError(data.error || 'Action failed');
      }
      await load();
    } finally {
      setProcessing(false);
    }
  };

  const submitRegularization = async (dateYmd: string, payload: Parameters<
    React.ComponentProps<typeof AttendanceRegularizationForm>['onSubmit']
  >[0]) => {
    const res = await fetch('/api/employees/attendance-regularization', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attendance_date: dateYmd,
        ...payload,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to submit');
    setRegularizeDate(null);
    await load();
  };

  const pendingForDate = (dateYmd: string) =>
    regRequests.filter(
      (r) => r.attendance_date.slice(0, 10) === dateYmd.slice(0, 10) && r.status === 'pending',
    );

  const todayCheckedIn = !!todayRecord?.check_in_time;
  const todayCheckedOut = !!todayRecord?.check_out_time;

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-lg font-semibold text-gray-900">Attendance</h1>
        <p className="text-sm text-text-secondary">Check in, view history, and request corrections</p>
      </div>
      <Card className="space-y-3 p-4">
        <p className="text-lg font-semibold text-gray-900">Today</p>
        <p className="text-sm text-text-secondary">
          {todayCheckedIn
            ? todayCheckedOut
              ? 'You have completed attendance for today'
              : 'You are checked in'
            : 'Not checked in'}
        </p>
        {todayRecord ? (
          <div className="space-y-2 rounded-lg border border-border bg-gray-50 p-3">
            <AttendanceLogLine
              kind="check_in"
              time={todayRecord.check_in_time}
              lat={todayRecord.check_in_location_lat}
              lng={todayRecord.check_in_location_lng}
            />
            {todayRecord.check_out_time ? (
              <AttendanceLogLine
                kind="check_out"
                time={todayRecord.check_out_time}
                lat={todayRecord.check_out_location_lat}
                lng={todayRecord.check_out_location_lng}
              />
            ) : null}
          </div>
        ) : null}
        {!todayCheckedIn && (
          <Button className="w-full" disabled={processing} onClick={() => void checkInOut('check-in')}>
            Check in
          </Button>
        )}
        {todayCheckedIn && !todayCheckedOut && (
          <Button className="w-full" disabled={processing} onClick={() => void checkInOut('check-out')}>
            Check out
          </Button>
        )}
        {actionError ? <p className="text-sm text-red-700">{actionError}</p> : null}
      </Card>

      <div className="space-y-2">
        <p className="text-sm font-medium text-text-secondary">Last 30 days</p>
        {records.map((r) => {
          const dateYmd = String(r.date).slice(0, 10);
          const pending = pendingForDate(dateYmd);
          const recordOrNull = r.check_in_time || r.check_out_time ? r : null;
          return (
            <Card key={r.date} className="space-y-2 p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <span className="font-medium text-text-primary">{format(new Date(r.date), 'dd MMM yyyy')}</span>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-text-secondary">{r.status ?? '—'}</span>
                  {regSettings?.enabled ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setRegularizeDate(regularizeDate === dateYmd ? null : dateYmd)}
                    >
                      Regularize
                    </Button>
                  ) : null}
                </div>
              </div>
              {pending.length > 0 ? (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  Pending:{' '}
                  {pending
                    .map(
                      (p) =>
                        REGULARIZATION_REQUEST_TYPE_LABELS[
                          p.request_type as keyof typeof REGULARIZATION_REQUEST_TYPE_LABELS
                        ],
                    )
                    .join(', ')}
                </p>
              ) : null}
              {r.check_in_time || r.check_out_time ? (
                <div className="space-y-2 border-t border-border pt-2">
                  {r.check_in_time ? (
                    <AttendanceLogLine
                      kind="check_in"
                      time={r.check_in_time}
                      lat={r.check_in_location_lat}
                      lng={r.check_in_location_lng}
                      compact
                    />
                  ) : null}
                  {r.check_out_time ? (
                    <AttendanceLogLine
                      kind="check_out"
                      time={r.check_out_time}
                      lat={r.check_out_location_lat}
                      lng={r.check_out_location_lng}
                      compact
                    />
                  ) : null}
                </div>
              ) : null}
              {regularizeDate === dateYmd && regSettings ? (
                <AttendanceRegularizationForm
                  dateYmd={dateYmd}
                  record={recordOrNull}
                  settings={regSettings}
                  onCancel={() => setRegularizeDate(null)}
                  onSubmit={async (payload) => submitRegularization(dateYmd, payload)}
                />
              ) : null}
            </Card>
          );
        })}
        {regSettings?.enabled ? (
          <Card className="space-y-3 p-3 text-sm">
            <p className="font-medium text-text-primary">Regularize another date</p>
            <input
              type="date"
              className="input w-full"
              max={attendanceDateYmd()}
              value={regularizeDate && !records.some((r) => String(r.date).slice(0, 10) === regularizeDate) ? regularizeDate : ''}
              onChange={(e) => setRegularizeDate(e.target.value || null)}
            />
            {regularizeDate &&
            !records.some((r) => String(r.date).slice(0, 10) === regularizeDate) ? (
              <AttendanceRegularizationForm
                dateYmd={regularizeDate}
                record={null}
                settings={regSettings}
                onCancel={() => setRegularizeDate(null)}
                onSubmit={async (payload) => submitRegularization(regularizeDate, payload)}
              />
            ) : null}
          </Card>
        ) : null}
      </div>
    </div>
  );
}
