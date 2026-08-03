'use client';

export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  List,
  Loader2,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

type LeaveEvent = {
  event_kind: 'leave';
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  total_days: number;
  status: 'pending' | 'approved';
  leave_name: string;
  employee_code: string;
  employee_name: string;
};

type AttendanceEvent = {
  event_kind: 'attendance';
  id: string;
  employee_id: string;
  date: string;
  status: 'absent' | 'half_day';
  employee_code: string;
  employee_name: string;
};

type DayEvent = LeaveEvent | AttendanceEvent;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function eventChipClass(event: DayEvent): string {
  if (event.event_kind === 'leave') {
    return event.status === 'approved'
      ? 'bg-green-100 text-green-800'
      : 'bg-amber-100 text-amber-800';
  }
  if (event.status === 'half_day') {
    return 'bg-blue-100 text-blue-800';
  }
  return 'bg-red-100 text-red-800';
}

function eventChipLabel(event: DayEvent): string {
  const first = event.employee_name.split(' ')[0];
  if (event.event_kind === 'attendance') {
    return event.status === 'half_day' ? `${first} ½` : `${first} ✕`;
  }
  return first;
}

function eventChipTitle(event: DayEvent): string {
  if (event.event_kind === 'leave') {
    return `${event.employee_name} — ${event.leave_name} (${event.status})`;
  }
  return `${event.employee_name} — ${event.status === 'half_day' ? 'Half day' : 'Absent'}`;
}

function statusChipClass(status: string): string {
  switch (status) {
    case 'approved':
      return 'bg-green-50 text-green-800 border-green-200';
    case 'pending':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'absent':
      return 'bg-red-50 text-red-800 border-red-200';
    case 'half_day':
      return 'bg-blue-50 text-blue-800 border-blue-200';
    default:
      return 'bg-gray-50 text-gray-700 border-border';
  }
}

export default function LeaveCalendarPage() {
  const { business, user } = useAuth();
  const { status: authStatus } = useAuthorizationGuard({
    resource: 'leave_requests',
    action: 'read',
    skipCheck: !user?.id || !business?.id,
  });

  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [eventsByDate, setEventsByDate] = useState<Record<string, DayEvent[]>>({});
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<Date>(() => new Date());

  const rangeStart = useMemo(
    () => format(startOfWeek(startOfMonth(month), { weekStartsOn: 0 }), 'yyyy-MM-dd'),
    [month],
  );
  const rangeEnd = useMemo(
    () => format(endOfWeek(endOfMonth(month), { weekStartsOn: 0 }), 'yyyy-MM-dd'),
    [month],
  );

  const fetchCalendar = useCallback(async () => {
    if (!business?.id || !user?.id) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        user_id: user.id,
        start_date: rangeStart,
        end_date: rangeEnd,
      });
      const res = await fetch(`/api/employees/leave-calendar?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEventsByDate(data.events_by_date || {});
      }
    } catch (error) {
      console.error('Error fetching leave calendar:', error);
    } finally {
      setLoading(false);
    }
  }, [business?.id, user?.id, rangeStart, rangeEnd]);

  useEffect(() => {
    fetchCalendar();
  }, [fetchCalendar]);

  const gridDays = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(month), { weekStartsOn: 0 }),
        end: endOfWeek(endOfMonth(month), { weekStartsOn: 0 }),
      }),
    [month],
  );

  const selectedKey = format(selectedDay, 'yyyy-MM-dd');
  const selectedEvents = eventsByDate[selectedKey] || [];

  const monthStats = useMemo(() => {
    let leaves = 0;
    let absences = 0;
    for (const events of Object.values(eventsByDate)) {
      for (const e of events) {
        if (e.event_kind === 'leave') leaves += 1;
        else absences += 1;
      }
    }
    return { leaves, absences };
  }, [eventsByDate]);

  if (authStatus === 'loading') {
    return (
      <div className="flex h-[calc(100vh-100px)] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (authStatus === 'denied') {
    return <AccessDenied module="leave_requests" action="read" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Team Calendar</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Approved/pending leave and attendance (absent, half day) in one view
          </p>
        </div>
        <Link href="/employees/leaves">
          <Button variant="secondary">
            <List className="mr-2 h-4 w-4" />
            List View
          </Button>
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-secondary">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
          Approved leave
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
          Pending leave
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
          Absent
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
          Half day
        </span>
        <span>
          {monthStats.leaves} leave · {monthStats.absences} attendance mark
          {monthStats.absences === 1 ? '' : 's'}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-text-primary">
              {format(month, 'MMMM yyyy')}
            </h2>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setMonth((m) => subMonths(m, 1))}
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  const today = new Date();
                  setMonth(startOfMonth(today));
                  setSelectedDay(today);
                }}
              >
                Today
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setMonth((m) => addMonths(m, 1))}
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
            </div>
          ) : (
            <>
              <div className="mb-1 grid grid-cols-7 gap-1">
                {WEEKDAYS.map((day) => (
                  <div
                    key={day}
                    className="py-1 text-center text-xs font-medium text-text-muted"
                  >
                    {day}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {gridDays.map((day) => {
                  const key = format(day, 'yyyy-MM-dd');
                  const dayEvents = eventsByDate[key] || [];
                  const inMonth = isSameMonth(day, month);
                  const selected = isSameDay(day, selectedDay);

                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedDay(day)}
                      className={clsx(
                        'min-h-[88px] rounded-lg border p-1.5 text-left transition-colors',
                        inMonth ? 'border-border bg-surface' : 'border-transparent bg-gray-50/50 opacity-50',
                        selected && 'ring-2 ring-primary-500 ring-offset-1',
                        isToday(day) && !selected && 'border-primary-300',
                      )}
                    >
                      <span
                        className={clsx(
                          'inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium',
                          isToday(day) ? 'bg-gray-900 text-white' : 'text-text-primary',
                        )}
                      >
                        {format(day, 'd')}
                      </span>
                      <div className="mt-1 space-y-0.5">
                        {dayEvents.slice(0, 3).map((event, idx) => (
                          <div
                            key={`${event.event_kind}-${event.id}-${key}-${idx}`}
                            className={clsx(
                              'truncate rounded px-1 py-0.5 text-[10px] font-medium leading-tight',
                              eventChipClass(event),
                            )}
                            title={eventChipTitle(event)}
                          >
                            {eventChipLabel(event)}
                          </div>
                        ))}
                        {dayEvents.length > 3 && (
                          <div className="text-[10px] text-text-muted">
                            +{dayEvents.length - 3} more
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </Card>

        <Card>
          <div className="mb-3 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-text-muted" />
            <h2 className="text-sm font-semibold text-text-primary">
              {format(selectedDay, 'EEEE, d MMM yyyy')}
            </h2>
          </div>

          {selectedEvents.length === 0 ? (
            <p className="text-sm text-text-secondary">Nothing recorded for this day.</p>
          ) : (
            <ul className="space-y-3">
              {selectedEvents.map((event, idx) => (
                <li
                  key={`${event.event_kind}-${event.id}-${selectedKey}-${idx}`}
                  className="rounded-lg border border-border p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-text-primary">{event.employee_name}</p>
                      <p className="text-xs font-mono text-text-secondary">{event.employee_code}</p>
                    </div>
                    <span
                      className={clsx(
                        'shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                        statusChipClass(
                          event.event_kind === 'leave' ? event.status : event.status,
                        ),
                      )}
                    >
                      {event.event_kind === 'leave' ? event.status : event.status.replace('_', ' ')}
                    </span>
                  </div>
                  {event.event_kind === 'leave' ? (
                    <>
                      <p className="mt-2 text-sm text-text-primary">{event.leave_name}</p>
                      <p className="text-xs text-text-secondary">
                        {format(new Date(event.start_date), 'dd MMM')} –{' '}
                        {format(new Date(event.end_date), 'dd MMM yyyy')} · {event.total_days} day
                        {event.total_days === 1 ? '' : 's'}
                      </p>
                    </>
                  ) : (
                    <p className="mt-2 text-sm text-text-secondary">
                      Marked on attendance register
                      {event.status === 'half_day' ? ' (half day)' : ' (absent)'}.
                      {!selectedEvents.some(
                        (e) =>
                          e.event_kind === 'leave' &&
                          e.employee_id === event.employee_id &&
                          e.status === 'approved',
                      ) ? (
                        <span className="mt-1 block text-xs text-amber-700">
                          No approved leave request — may count as LWP in payroll.
                        </span>
                      ) : null}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
