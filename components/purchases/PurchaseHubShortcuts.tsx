'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Filter, Inbox, Package, Sparkles } from 'lucide-react';

type Counts = { bills: number; orders: number };

/**
 * Supplier Hub shortcuts on the Purchases page, on every screen size, with how many
 * bills are waiting to be received and how many orders need the buyer.
 */
export function PurchaseHubShortcuts({ onOpenFilters }: { onOpenFilters?: () => void }) {
  const [counts, setCounts] = useState<Counts>({ bills: 0, orders: 0 });

  useEffect(() => {
    let alive = true;
    const count = (url: string, key: 'bills' | 'orders') =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => (Array.isArray(d?.[key]) ? d[key].length : 0))
        .catch(() => 0);
    Promise.all([
      count('/api/purchases/incoming-bills?status=pending', 'bills'),
      count('/api/supply-orders?role=buyer&group=action', 'orders'),
    ]).then(([bills, orders]) => {
      if (alive) setCounts({ bills, orders });
    });
    return () => {
      alive = false;
    };
  }, []);

  const chip =
    'inline-flex shrink-0 items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50';
  const badge = 'rounded-full bg-primary-600 px-2 py-0.5 text-xs font-semibold text-white';

  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
      <Link href="/purchases/incoming" className={chip}>
        <Inbox className="h-4 w-4" />
        Incoming bills
        {counts.bills > 0 && <span className={badge}>{counts.bills}</span>}
      </Link>
      <Link href="/supply-orders" className={chip}>
        <Package className="h-4 w-4" />
        Supplier orders
        {counts.orders > 0 && <span className={badge}>{counts.orders}</span>}
      </Link>
      <Link href="/purchases/new-arrivals" className={chip}>
        <Sparkles className="h-4 w-4" />
        New arrivals
      </Link>
      {onOpenFilters && (
        <button type="button" onClick={onOpenFilters} className={`${chip} md:hidden`} aria-label="Filters">
          <Filter className="h-4 w-4" />
          Filters
        </button>
      )}
    </div>
  );
}
