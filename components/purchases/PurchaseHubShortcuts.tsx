'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Filter, Inbox, Package, Sparkles, Store } from 'lucide-react';
import { useCapabilityCheck } from '@/hooks/useCapability';
import { useLayoutData } from '@/contexts/LayoutDataContext';

type Counts = { waiting: number; bills: number; proposals: number; arrivals: number };

/**
 * Supplier Hub shortcuts on the Purchases page, on every screen size: the hub itself with how
 * much is waiting on the buyer, then bills to receive, orders to confirm and new arrivals.
 */
export function PurchaseHubShortcuts({ onOpenFilters }: { onOpenFilters?: () => void }) {
  const { hasCapability, snapshotLoaded } = useCapabilityCheck();
  const { supplierHubVisible } = useLayoutData();
  const hubOn =
    supplierHubVisible === true &&
    (!snapshotLoaded || hasCapability('purchase_supplier_hub', 'view'));
  const [counts, setCounts] = useState<Counts>({ waiting: 0, bills: 0, proposals: 0, arrivals: 0 });

  useEffect(() => {
    if (!hubOn) return;
    let alive = true;
    fetch('/api/suppliers/hub/home')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.buying) return;
        const buyingInbox = (d.inbox || []).filter((i: { side: string }) => i.side === 'buying');
        setCounts({
          waiting: buyingInbox.length,
          bills: d.buying.billsToReceive || 0,
          proposals: buyingInbox.filter((i: { kind: string }) => i.kind === 'order_to_confirm').length,
          arrivals: d.buying.newCollections || 0,
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [hubOn]);

  const chip =
    'inline-flex shrink-0 items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50';
  const badge = 'rounded-full bg-primary-600 px-2 py-0.5 text-xs font-semibold text-white';

  if (!hubOn && !onOpenFilters) return null;

  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
      {hubOn && (
        <>
          <Link href="/suppliers/hub" className={`${chip} border-primary-200 text-primary-700`}>
            <Store className="h-4 w-4" />
            Supplier Hub
            {counts.waiting > 0 && <span className={badge}>{counts.waiting}</span>}
          </Link>
          <Link href="/purchases/incoming" className={chip}>
            <Inbox className="h-4 w-4" />
            Incoming bills
            {counts.bills > 0 && <span className={badge}>{counts.bills}</span>}
          </Link>
          <Link href="/supply-orders?role=buyer" className={chip}>
            <Package className="h-4 w-4" />
            Supplier orders
            {counts.proposals > 0 && <span className={badge}>{counts.proposals}</span>}
          </Link>
          <Link href="/purchases/new-arrivals" className={chip}>
            <Sparkles className="h-4 w-4" />
            New arrivals
            {counts.arrivals > 0 && <span className={badge}>{counts.arrivals}</span>}
          </Link>
        </>
      )}
      {onOpenFilters && (
        <button type="button" onClick={onOpenFilters} className={`${chip} md:hidden`} aria-label="Filters">
          <Filter className="h-4 w-4" />
          Filters
        </button>
      )}
    </div>
  );
}
