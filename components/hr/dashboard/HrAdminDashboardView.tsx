'use client';

import {
  UserPlus,
  Users,
  CalendarCheck,
  ClipboardList,
  Wallet,
  Network,
  Inbox,
  Megaphone,
  LogOut,
  FileBarChart,
  CalendarRange,
  ArrowRight,
} from 'lucide-react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { STACK_PAGE_CLASS, STACK_SECTION_CLASS } from '@/lib/page-layout';
import {
  HrInboxCard,
  HrQuickAccessGrid,
  HrQuickAccessSection,
  HrStatCard,
} from '@/components/hr/dashboard/HrQuickAccessCards';

export type HrAdminOverview = {
  headcount: number;
  pending_invites: number;
  pending_leaves: number;
  present_today: number;
  absent_today: number;
  in_probation: number;
  pending_exit_approvals: number;
  active_announcements: number;
  birthdays_this_week: number;
  new_joiners_this_month: number;
  date: string;
  notifications: Array<{ type: string; label: string; count: number; href: string }>;
};

type Props = {
  businessName: string;
  userName: string;
  overview: HrAdminOverview | null;
  loading: boolean;
  error: string | null;
};

const QUICK_LINKS: Array<{
  href: string;
  label: string;
  description: string;
  icon: typeof Users;
}> = [
  {
    href: '/employees',
    label: 'People',
    description: 'Directory & profiles',
    icon: Users,
  },
  {
    href: '/employees/org-chart',
    label: 'Org chart',
    description: 'Reporting structure',
    icon: Network,
  },
  {
    href: '/employees/manager',
    label: 'Manager hub',
    description: 'Team approvals',
    icon: Inbox,
  },
  {
    href: '/employees/attendance',
    label: 'Attendance',
    description: 'Daily presence',
    icon: CalendarCheck,
  },
  {
    href: '/employees/leaves',
    label: 'Leaves',
    description: 'Requests & balances',
    icon: ClipboardList,
  },
  {
    href: '/employees/salary/payments',
    label: 'Payroll',
    description: 'Salary & payslips',
    icon: Wallet,
  },
  {
    href: '/hr/engagement',
    label: 'Engagement',
    description: 'Announcements',
    icon: Megaphone,
  },
  {
    href: '/hr/exits',
    label: 'Exits',
    description: 'Resignations & F&F',
    icon: LogOut,
  },
  {
    href: '/hr/reports',
    label: 'Reports',
    description: 'HR analytics',
    icon: FileBarChart,
  },
  {
    href: '/employees/leaves/calendar',
    label: 'Leave calendar',
    description: 'Team leave view',
    icon: CalendarRange,
  },
];

export function HrAdminDashboardView({
  overview,
  loading,
  error,
}: Props) {
  const inboxTotal =
    (overview?.pending_leaves ?? 0) +
    (overview?.pending_exit_approvals ?? 0) +
    (overview?.pending_invites ?? 0);

  const primaryNotification = overview?.notifications[0];

  return (
    <div className={STACK_PAGE_CLASS}>
      <ListPageHeader
        title="HR Dashboard"
        description={`Team overview · ${overview?.date ?? 'Today'}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/employees/manager/approvals">
              <Button size="sm" variant="secondary">
                <Inbox className="mr-2 h-4 w-4" />
                Approvals
                {inboxTotal > 0 ? (
                  <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-800">
                    {inboxTotal}
                  </span>
                ) : null}
              </Button>
            </Link>
            <Link href="/employees/new">
              <Button size="sm">
                <UserPlus className="mr-2 h-4 w-4" />
                Add employee
              </Button>
            </Link>
          </div>
        }
      />

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {loading || !overview ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
        </div>
      ) : (
        <div className={STACK_SECTION_CLASS}>
          {overview.notifications.length > 0 ? (
            <Card padding="sm" className="border-amber-200 bg-amber-50">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                Needs attention
              </p>
              <ul className="mt-2 space-y-1.5">
                {overview.notifications.slice(0, 5).map((n) => (
                  <li key={`${n.type}-${n.href}`}>
                    <Link
                      href={n.href}
                      className="flex items-center justify-between gap-2 text-sm text-amber-900 hover:underline"
                    >
                      <span>
                        {n.label}
                        {n.count > 0 ? ` (${n.count})` : ''}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 opacity-70" />
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <HrQuickAccessSection title="Today">
            <HrQuickAccessGrid>
              <HrInboxCard
                count={inboxTotal}
                actionHref={primaryNotification?.href ?? '/employees/leaves'}
                description={
                  inboxTotal > 0
                    ? `${overview.pending_leaves} leave, ${overview.pending_exit_approvals} exit, ${overview.pending_invites} invite action${inboxTotal === 1 ? '' : 's'} pending.`
                    : 'No pending HR actions right now.'
                }
              />
              <HrStatCard
                title="Present today"
                value={overview.present_today}
                description={`${overview.absent_today} absent · ${overview.headcount} active employees`}
                href="/employees/attendance"
                actionLabel="View attendance"
              />
              <HrStatCard
                title="Pending leaves"
                value={overview.pending_leaves}
                valueClassName="text-amber-700"
                href="/employees/leaves"
                actionLabel="Review leaves"
              />
              <HrStatCard
                title="In probation"
                value={overview.in_probation}
                description="Employees still in probation"
                href="/employees"
                actionLabel="View people"
              />
              <HrStatCard
                title="Birthdays this week"
                value={overview.birthdays_this_week}
                description="Celebrate your team this week"
              />
              <HrStatCard
                title="New joiners (month)"
                value={overview.new_joiners_this_month}
                href="/employees"
                actionLabel="View employees"
              />
              <HrStatCard
                title="Active announcements"
                value={overview.active_announcements}
                href="/hr/engagement"
                actionLabel="Open engagement"
              />
              <HrStatCard
                title="Exit approvals"
                value={overview.pending_exit_approvals}
                valueClassName={
                  overview.pending_exit_approvals > 0 ? 'text-amber-700' : undefined
                }
                href="/hr/exits"
                actionLabel="Review exits"
              />
            </HrQuickAccessGrid>
          </HrQuickAccessSection>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">Go to</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {QUICK_LINKS.map((link) => {
                const Icon = link.icon;
                return (
                  <Link key={link.href} href={link.href} className="group">
                    <Card padding="sm" className="flex h-full items-start gap-3 transition-colors hover:bg-gray-50">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-text-secondary group-hover:bg-gray-200">
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-text-primary">
                          {link.label}
                        </span>
                        <span className="mt-0.5 block text-xs text-text-secondary">
                          {link.description}
                        </span>
                      </span>
                      <ArrowRight className="ml-auto mt-1 h-4 w-4 shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100" />
                    </Card>
                  </Link>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
