'use client';

import { useEffect, useState } from 'react';
import {
  Home,
  User,
  Inbox,
  Users,
  Wallet,
  CheckSquare,
  Megaphone,
  Clock,
  Calendar,
  Receipt,
} from 'lucide-react';
import { useEmployeePortal } from './EmployeePortalContext';
import { EmployeePortalChangePassword } from './EmployeePortalChangePassword';
import {
  HrWorkspaceShell,
  type HrShellNavItem,
} from '@/components/hr/dashboard/HrWorkspaceShell';
import { usePathname } from 'next/navigation';
import type { HrDashboardTab } from '@/components/hr/dashboard/HrDashboardTabs';

function buildInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function EmployeePortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { slug, session, logout } = useEmployeePortal();
  const [inboxBadge, setInboxBadge] = useState(0);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/public/employee/portal/dashboard', {
          credentials: 'include',
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const total =
          (data.pending_approvals ?? 0) + (data.pending_tasks ?? 0);
        setInboxBadge(total);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  if (!session) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-8">
        <div className="w-full max-w-md">{children}</div>
      </div>
    );
  }

  if (session.must_change_password) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-8">
        <EmployeePortalChangePassword forced />
      </div>
    );
  }

  const base = `/${slug}/employees`;
  const ent = session.entitlements;
  const isManager = session.is_manager ?? false;

  const navItems: HrShellNavItem[] = [
    { key: 'home', label: 'Home', href: base, icon: Home },
    { key: 'me', label: 'Me', href: `${base}/profile`, icon: User },
    {
      key: 'inbox',
      label: 'Inbox',
      href: isManager ? `${base}/team/approvals` : `${base}/todo`,
      icon: Inbox,
      badge: inboxBadge,
    },
  ];

  if (isManager && ent.team) {
    navItems.push({
      key: 'team',
      label: 'My team',
      href: `${base}/team`,
      icon: Users,
      children: [
        { key: 'team-home', label: 'Summary', href: `${base}/team` },
        { key: 'leaves', label: 'Leaves', href: `${base}/team/approvals` },
        { key: 'attendance', label: 'Attendance', href: `${base}/attendance` },
        ...(ent.expenses
          ? [{ key: 'expenses', label: 'Expenses & travel', href: `${base}/expenses` }]
          : []),
        { key: 'profile', label: 'Profile', href: `${base}/profile` },
      ],
    });
  }

  if (ent.payslips) {
    navItems.push({
      key: 'finances',
      label: 'My finances',
      href: `${base}/payslips`,
      icon: Wallet,
    });
  }

  navItems.push({
    key: 'todo',
    label: 'To do',
    href: `${base}/todo`,
    icon: CheckSquare,
  });

  if (ent.attendance) {
    navItems.push({
      key: 'attendance',
      label: 'Attendance',
      href: `${base}/attendance`,
      icon: Clock,
    });
  }

  if (ent.leaves) {
    navItems.push({
      key: 'leaves',
      label: 'Leave',
      href: `${base}/leaves`,
      icon: Calendar,
    });
  }

  if (ent.expenses && !isManager) {
    navItems.push({
      key: 'expenses',
      label: 'Expenses',
      href: `${base}/expenses`,
      icon: Receipt,
    });
  }

  navItems.push({
    key: 'feed',
    label: 'Feed',
    href: `${base}/engagement`,
    icon: Megaphone,
  });

  const tabs: HrDashboardTab[] = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      href: base,
      active: pathname === base || pathname === `${base}/`,
    },
    {
      id: 'updates',
      label: 'Updates',
      href: `${base}/engagement`,
      icon: 'heart',
      active: Boolean(pathname?.startsWith(`${base}/engagement`)),
    },
  ];

  return (
    <HrWorkspaceShell
      brandLabel="Khatario"
      companyName={session.business.name}
      userName={session.employee.name}
      userInitials={buildInitials(session.employee.name)}
      navItems={navItems}
      tabs={tabs}
      basePath={base}
      onLogout={() => void logout()}
      fullViewport
    >
      {children}
    </HrWorkspaceShell>
  );
}
