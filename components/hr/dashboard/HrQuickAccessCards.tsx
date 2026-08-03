'use client';

import Link from 'next/link';
import { clsx } from 'clsx';
import {
  Cake,
  PartyPopper,
  Award,
  Home,
  Monitor,
  Clock,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';

function QuickAccessCardShell({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={clsx(
        'flex min-h-[200px] flex-col rounded-card border border-border bg-white shadow-sm',
        className,
      )}
    >
      {children}
    </div>
  );
}

function CardTitleRow({
  title,
  icon: Icon,
  iconClassName,
}: {
  title: string;
  icon?: LucideIcon;
  iconClassName?: string;
}) {
  return (
    <div className="flex items-center gap-2 px-4 pt-4">
      {Icon ? <Icon className={clsx('h-4 w-4 shrink-0', iconClassName)} aria-hidden /> : null}
      <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
    </div>
  );
}

function EmptyIllustration({
  icon: Icon,
  message,
  tone = 'neutral',
}: {
  icon: LucideIcon;
  message: string;
  tone?: 'neutral' | 'amber' | 'teal' | 'blue';
}) {
  const toneClasses = {
    neutral: 'bg-gray-50 text-text-muted',
    amber: 'bg-amber-50 text-amber-700',
    teal: 'bg-teal-50 text-teal-700',
    blue: 'bg-blue-50 text-blue-700',
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 pb-5 pt-2 text-center">
      <div
        className={clsx(
          'mb-3 flex h-16 w-16 items-center justify-center rounded-full',
          toneClasses[tone],
        )}
      >
        <Icon className="h-8 w-8 opacity-80" aria-hidden />
      </div>
      <p className="text-sm text-text-secondary">{message}</p>
    </div>
  );
}

export function HrInboxCard({
  count,
  actionHref,
  actionLabel = 'Take action',
  description,
}: {
  count: number;
  actionHref: string;
  actionLabel?: string;
  description: string;
}) {
  return (
    <QuickAccessCardShell>
      <CardTitleRow title="Inbox" />
      <div className="flex flex-1 flex-col px-4 pb-4 pt-2">
        <p className="text-4xl font-bold tabular-nums text-gray-900">{count}</p>
        <Link href={actionHref} className="mt-3 inline-flex">
          <Button size="sm">{actionLabel}</Button>
        </Link>
        <p className="mt-3 text-xs leading-relaxed text-text-secondary">{description}</p>
      </div>
    </QuickAccessCardShell>
  );
}

export function HrHolidaysCard({
  holidays,
}: {
  holidays: Array<{ holiday_date: string; holiday_name: string }>;
}) {
  const next = holidays[0];
  return (
    <QuickAccessCardShell>
      <CardTitleRow title="Holidays" icon={PartyPopper} iconClassName="text-amber-600" />
      {next ? (
        <div className="flex flex-1 flex-col justify-center px-4 pb-5 pt-2">
          <p className="text-sm font-medium text-text-primary">{next.holiday_name}</p>
          <p className="mt-1 text-xs text-text-secondary">
            {new Date(next.holiday_date).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
            })}
          </p>
          {holidays.length > 1 ? (
            <p className="mt-2 text-xs text-text-muted">+{holidays.length - 1} more upcoming</p>
          ) : null}
        </div>
      ) : (
        <EmptyIllustration icon={PartyPopper} message="No holidays" tone="amber" />
      )}
    </QuickAccessCardShell>
  );
}

export function HrBirthdaysCard({
  birthdays,
}: {
  birthdays: Array<{ name: string; when: string }>;
}) {
  const today = birthdays.filter((b) => b.when === 'today');
  return (
    <QuickAccessCardShell>
      <CardTitleRow title="Celebrating birthdays" icon={Cake} iconClassName="text-teal-600" />
      {today.length > 0 ? (
        <ul className="flex-1 space-y-2 px-4 pb-4 pt-2 text-sm text-text-secondary">
          {today.map((b) => (
            <li key={b.name} className="truncate font-medium text-text-primary">
              {b.name}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyIllustration icon={Cake} message="No birthdays today" tone="teal" />
      )}
    </QuickAccessCardShell>
  );
}

export function HrWorkingRemotelyCard({
  onLeaveToday,
}: {
  onLeaveToday: Array<{ name: string; leave_name: string }>;
}) {
  return (
    <QuickAccessCardShell>
      <CardTitleRow title="On leave today" icon={Home} iconClassName="text-text-muted" />
      {onLeaveToday.length > 0 ? (
        <ul className="flex-1 space-y-2 px-4 pb-4 pt-2 text-sm">
          {onLeaveToday.slice(0, 4).map((p) => (
            <li key={p.name} className="truncate">
              <span className="font-medium text-text-primary">{p.name}</span>
              <span className="text-text-secondary"> · {p.leave_name}</span>
            </li>
          ))}
          {onLeaveToday.length > 4 ? (
            <li className="text-xs text-text-muted">+{onLeaveToday.length - 4} more</li>
          ) : null}
        </ul>
      ) : (
        <EmptyIllustration
          icon={Monitor}
          message="Everyone's at office! None in team is on leave today."
          tone="blue"
        />
      )}
    </QuickAccessCardShell>
  );
}

export function HrAnniversariesCard({
  anniversaries,
}: {
  anniversaries: Array<{ name: string; years: number; when: string }>;
}) {
  const today = anniversaries.filter((a) => a.when === 'today');
  return (
    <QuickAccessCardShell>
      <CardTitleRow
        title="Celebrating work anniversaries"
        icon={Award}
        iconClassName="text-amber-600"
      />
      {today.length > 0 ? (
        <ul className="flex-1 space-y-2 px-4 pb-4 pt-2 text-sm text-text-secondary">
          {today.map((a) => (
            <li key={a.name}>
              <span className="font-medium text-text-primary">{a.name}</span>
              <span> · {a.years} yr{a.years === 1 ? '' : 's'}</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyIllustration icon={Award} message="No work anniversaries today" tone="amber" />
      )}
    </QuickAccessCardShell>
  );
}

export function HrTimeTodayCard({
  checkedIn,
  checkedOut,
  checkInTime,
  onClockIn,
  onClockOut,
  processing,
  error,
  showActions,
}: {
  checkedIn: boolean;
  checkedOut: boolean;
  checkInTime: string | null;
  onClockIn?: () => void;
  onClockOut?: () => void;
  processing?: boolean;
  error?: string | null;
  showActions?: boolean;
}) {
  let status = 'Not checked in yet';
  if (checkedIn && checkedOut) status = 'Attendance completed for today';
  else if (checkedIn) status = checkInTime ? `Checked in at ${checkInTime.slice(0, 5)}` : 'You are checked in';

  return (
    <QuickAccessCardShell className="overflow-hidden">
      <div className="border-b border-border bg-gray-100 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-text-secondary" aria-hidden />
          <h3 className="text-sm font-semibold text-text-primary">Time today</h3>
        </div>
      </div>
      <div className="flex flex-1 flex-col px-4 pb-4 pt-3">
        <p className="text-sm text-text-secondary">{status}</p>
        {showActions && !checkedIn && onClockIn ? (
          <Button className="mt-3 w-full" size="sm" disabled={processing} onClick={onClockIn}>
            Clock in
          </Button>
        ) : null}
        {showActions && checkedIn && !checkedOut && onClockOut ? (
          <Button className="mt-3 w-full" size="sm" disabled={processing} onClick={onClockOut}>
            Clock out
          </Button>
        ) : null}
        {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
      </div>
    </QuickAccessCardShell>
  );
}

export function HrStatCard({
  title,
  value,
  description,
  href,
  actionLabel,
  icon: Icon,
  valueClassName,
}: {
  title: string;
  value: number | string;
  description?: string;
  href?: string;
  actionLabel?: string;
  icon?: LucideIcon;
  valueClassName?: string;
}) {
  return (
    <QuickAccessCardShell>
      <CardTitleRow title={title} icon={Icon} iconClassName="text-text-muted" />
      <div className="flex flex-1 flex-col px-4 pb-4 pt-2">
        <p className={clsx('text-4xl font-bold tabular-nums text-gray-900', valueClassName)}>
          {value}
        </p>
        {description ? (
          <p className="mt-2 text-xs leading-relaxed text-text-secondary">{description}</p>
        ) : null}
        {href && actionLabel ? (
          <Link href={href} className="mt-3 inline-flex">
            <Button size="sm" variant="secondary">
              {actionLabel}
            </Button>
          </Link>
        ) : null}
      </div>
    </QuickAccessCardShell>
  );
}

export function HrQuickAccessGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
  );
}

export function HrQuickAccessSection({
  title = 'Quick access',
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
      </div>
      {children}
    </section>
  );
}
