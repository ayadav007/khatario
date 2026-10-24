'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { ManagerTeamRollCall } from '@/components/hr/ManagerTeamRollCall';

/**
 * Default mark-attendance: name list with Present / Absent (saves on tap).
 * Detailed one-employee form: /employees/attendance/mark/advanced
 */
export default function MarkAttendancePage() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-secondary">
          Tap P, A, half, or Off, then save the day.
        </p>
        <Link
          href="/employees/attendance/mark/advanced"
          className="text-sm font-medium text-text-secondary underline-offset-2 hover:text-text-primary hover:underline"
        >
          Advanced (times &amp; notes)
        </Link>
      </div>
      <ManagerTeamRollCall simpleStatuses />
    </div>
  );
}
