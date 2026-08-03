'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ChevronRight, Shield, User } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { clsx } from 'clsx';

function resolveRoleLabel(
  isPrimaryAdmin: boolean,
  user: { role_name?: string; role?: string } | null,
): string {
  if (isPrimaryAdmin) return 'Primary Admin';
  if (user?.role_name) return user.role_name;
  if (user?.role === 'admin') return 'Admin';
  return 'User';
}

export function MobileAccountCard({ className }: { className?: string }) {
  const { user, business, isPrimaryAdmin } = useAuth();
  const [hasEmployeeProfile, setHasEmployeeProfile] = useState(false);

  useEffect(() => {
    if (!user?.id || !business?.id) {
      setHasEmployeeProfile(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/employees/${user.id}?business_id=${business.id}`,
          { credentials: 'include' },
        );
        if (!cancelled) setHasEmployeeProfile(res.ok);
      } catch {
        if (!cancelled) setHasEmployeeProfile(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, business?.id]);

  if (!user) return null;

  const roleLabel = resolveRoleLabel(isPrimaryAdmin, user as { role_name?: string; role?: string });
  const initial = user.name?.trim().charAt(0)?.toUpperCase() || '?';

  return (
    <section
      id="account"
      className={clsx(
        'rounded-xl border border-border bg-white p-4 shadow-sm dark:bg-surface',
        className,
      )}
      aria-label="Your account"
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gray-100 text-lg font-bold text-gray-900"
          aria-hidden
        >
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-semibold text-text-primary">{user.name}</p>
          {user.email ? (
            <p className="truncate text-sm text-text-secondary">{user.email}</p>
          ) : user.phone ? (
            <p className="truncate text-sm text-text-secondary">{user.phone}</p>
          ) : null}
          {business?.name ? (
            <p className="mt-0.5 truncate text-xs text-text-muted">{business.name}</p>
          ) : null}
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-gray-50 px-2.5 py-1 text-xs font-medium text-text-primary">
            <Shield className="h-3.5 w-3.5 text-text-muted" aria-hidden />
            {roleLabel}
          </div>
        </div>
      </div>

      <div className="mt-4 divide-y divide-border rounded-lg border border-border">
        {hasEmployeeProfile ? (
          <Link
            href={`/employees/${user.id}`}
            className="flex items-center justify-between px-3 py-2.5 text-sm text-text-primary active:bg-slate-50"
          >
            <span className="inline-flex items-center gap-2">
              <User className="h-4 w-4 text-text-muted" />
              My employee profile
            </span>
            <ChevronRight className="h-4 w-4 text-text-muted" />
          </Link>
        ) : null}
        <Link
          href="/settings"
          className="flex items-center justify-between px-3 py-2.5 text-sm text-text-primary active:bg-slate-50"
        >
          <span>Settings</span>
          <ChevronRight className="h-4 w-4 text-text-muted" />
        </Link>
      </div>
    </section>
  );
}
