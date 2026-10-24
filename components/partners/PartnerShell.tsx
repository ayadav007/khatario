'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BadgePercent,
  LayoutDashboard,
  IndianRupee,
  Users,
  Link2,
  LogOut,
  Wallet,
  BookOpen,
  UserCog,
  Landmark,
} from 'lucide-react';
import { clsx } from 'clsx';

const NAV = [
  { href: '/partners', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/partners/deals', label: 'Deals', icon: Users },
  { href: '/partners/earnings', label: 'Earnings', icon: IndianRupee },
  { href: '/partners/payouts', label: 'Payouts', icon: Wallet },
  { href: '/partners/kit', label: 'Sales kit', icon: BookOpen },
  { href: '/partners/link', label: 'My link', icon: Link2 },
  { href: '/partners/team', label: 'Team', icon: UserCog },
  { href: '/partners/profile', label: 'Payout profile', icon: Landmark },
];

export function PartnerShell({
  children,
  partnerName,
}: {
  children: React.ReactNode;
  partnerName?: string;
}) {
  const pathname = usePathname();

  async function logout() {
    await fetch('/api/partners/auth/logout', { method: 'POST', credentials: 'include' });
    window.location.href = '/partners/login';
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <BadgePercent className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-900">Khatario Partners</div>
              {partnerName ? (
                <div className="text-xs text-slate-500">{partnerName}</div>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
          >
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-2">
          {NAV.map((item) => {
            const active =
              item.href === '/partners'
                ? pathname === '/partners'
                : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium',
                  active
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'text-slate-600 hover:bg-slate-100',
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
