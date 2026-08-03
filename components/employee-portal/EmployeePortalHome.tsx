'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  HrAnniversariesCard,
  HrBirthdaysCard,
  HrHolidaysCard,
  HrInboxCard,
  HrQuickAccessGrid,
  HrQuickAccessSection,
  HrTimeTodayCard,
  HrWorkingRemotelyCard,
} from '@/components/hr/dashboard/HrQuickAccessCards';
import { useEmployeePortal } from './EmployeePortalContext';
import { getPortalCheckInLocation } from '@/lib/employee-portal/geolocation';

type DashboardData = {
  today: {
    date: string;
    attendance: {
      checked_in: boolean;
      checked_out: boolean;
      check_in_time: string | null;
    } | null;
  };
  holidays: Array<{ holiday_date: string; holiday_name: string }>;
  on_leave_today: Array<{ name: string; leave_name: string }>;
  celebrations: {
    birthdays: Array<{ name: string; when: string }>;
    anniversaries: Array<{ name: string; years: number; when: string }>;
  };
  pending_tasks: number;
  pending_approvals: number;
  is_manager: boolean;
};

export function EmployeePortalHome() {
  const { slug, session } = useEmployeePortal();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DashboardData | null>(null);
  const [clockProcessing, setClockProcessing] = useState(false);
  const [clockError, setClockError] = useState<string | null>(null);

  const base = `/${slug}/employees`;
  const ent = session!.entitlements;
  const inboxCount = (data?.pending_approvals ?? 0) + (data?.pending_tasks ?? 0);
  const inboxHref = data?.is_manager ? `${base}/team/approvals` : `${base}/todo`;

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/public/employee/portal/dashboard', { credentials: 'include' });
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  async function handleClock(action: 'check-in' | 'check-out') {
    if (!session) return;
    setClockProcessing(true);
    setClockError(null);
    try {
      let location: { lat: number; lng: number } | null = null;
      location = await getPortalCheckInLocation();
      const res = await fetch(`/api/employees/attendance/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: session.business.id,
          employee_id: session.employee.id,
          method: 'mobile_app',
          location_lat: location?.lat,
          location_lng: location?.lng,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setClockError(err.error ?? 'Could not update attendance');
        return;
      }
      await load();
    } finally {
      setClockProcessing(false);
    }
  }

  if (loading || !data) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  const att = data.today.attendance;
  const inboxDescription =
    data.is_manager && data.pending_approvals > 0
      ? `${data.pending_approvals} team approval${data.pending_approvals === 1 ? '' : 's'} waiting for you.`
      : data.pending_tasks > 0
        ? `${data.pending_tasks} open task${data.pending_tasks === 1 ? '' : 's'} in your to-do list.`
        : 'You are all caught up.';

  return (
    <div className="space-y-6">
      <HrQuickAccessSection>
        <HrQuickAccessGrid>
          <HrInboxCard
            count={inboxCount}
            actionHref={inboxHref}
            description={inboxDescription}
          />
          <HrHolidaysCard holidays={data.holidays} />
          <HrBirthdaysCard birthdays={data.celebrations.birthdays} />
          <HrWorkingRemotelyCard onLeaveToday={data.on_leave_today} />
          <HrAnniversariesCard anniversaries={data.celebrations.anniversaries} />
          {ent.attendance && att ? (
            <HrTimeTodayCard
              checkedIn={att.checked_in}
              checkedOut={att.checked_out}
              checkInTime={att.check_in_time}
              showActions
              processing={clockProcessing}
              error={clockError}
              onClockIn={() => void handleClock('check-in')}
              onClockOut={() => void handleClock('check-out')}
            />
          ) : null}
        </HrQuickAccessGrid>
      </HrQuickAccessSection>

      <div className="flex flex-wrap gap-3">
        {ent.leaves ? (
          <Link href={`${base}/leaves/new`}>
            <Button size="sm">Apply for leave</Button>
          </Link>
        ) : null}
        <Link href={`${base}/overtime/new`}>
          <Button size="sm" variant="secondary">
            Apply for overtime
          </Button>
        </Link>
      </div>
    </div>
  );
}
