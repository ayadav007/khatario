'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDownLeft,
  ArrowUpRight,
  FileText,
  Package,
  Plus,
  RotateCcw,
  ShoppingCart,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type Action = { label: string; href: string; icon: LucideIcon };

const SALES: Action[] = [
  { label: 'Invoice', href: '/invoices/new', icon: FileText },
  { label: 'Payment in', href: '/payments/in', icon: ArrowDownLeft },
  { label: 'Credit note', href: '/credit-notes/new', icon: RotateCcw },
  { label: 'Quotation', href: '/invoices/new?type=proforma_invoice', icon: FileText },
];

const PURCHASES: Action[] = [
  { label: 'Purchase', href: '/purchases/new', icon: ShoppingCart },
  { label: 'Payment out', href: '/payments/out', icon: ArrowUpRight },
  { label: 'Expense', href: '/expenses/new', icon: Wallet },
];

const ALSO: Action[] = [
  { label: 'Customer', href: '/customers/new', icon: Users },
  { label: 'Item', href: '/items/new', icon: Package },
];

function ActionGrid({ items, tone }: { items: Action[]; tone: 'sales' | 'neutral' }) {
  const circle =
    tone === 'sales'
      ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'
      : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200';

  return (
    <div className="grid grid-cols-4 gap-y-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <LauncherLink key={item.href + item.label} item={item} circle={circle} icon={Icon} />
        );
      })}
    </div>
  );
}

function LauncherLink({
  item,
  circle,
  icon: Icon,
}: {
  item: Action;
  circle: string;
  icon: LucideIcon;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.push(item.href)}
      className="flex flex-col items-center gap-1.5 text-center"
    >
      <span className={`flex h-12 w-12 items-center justify-center rounded-full ${circle}`}>
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <span className="line-clamp-2 text-xs leading-tight text-text-primary">{item.label}</span>
    </button>
  );
}

/** Phone create menu. Desktop keeps QuickActionsFAB. */
export function MobileCreateSheet() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="lg:hidden">
      {open ? (
        <div className="fixed inset-0 z-40">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40"
            aria-label="Close create menu"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-surface px-4 pb-[calc(var(--mobile-nav-h,4rem)+env(safe-area-inset-bottom,0px)+1rem)] pt-3 shadow-large">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-text-primary">Create</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-9 w-9 items-center justify-center text-text-secondary"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-3 text-xs font-medium text-text-secondary">Sales</p>
            <ActionGrid items={SALES} tone="sales" />
            <p className="mb-3 mt-5 text-xs font-medium text-text-secondary">Purchases</p>
            <ActionGrid items={PURCHASES} tone="neutral" />
            <p className="mb-3 mt-5 text-xs font-medium text-text-secondary">Also</p>
            <ActionGrid items={ALSO} tone="neutral" />
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mobile-fab"
        aria-label="Create"
        aria-expanded={open}
      >
        <Plus className="h-7 w-7" />
      </button>
    </div>
  );
}
