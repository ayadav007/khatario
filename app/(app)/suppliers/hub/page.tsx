'use client';

export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  BarChart3,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Inbox,
  Loader2,
  Package,
  Plus,
  Search,
  Sparkles,
  Store,
  TrendingDown,
  Users,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useToastContext } from '@/contexts/ToastContext';
import { HubInboxCard } from '@/components/suppliers/hub/HubInboxCard';
import { NewOrderSheet } from '@/components/suppliers/hub/NewOrderSheet';
import { BuyerInsightsCard } from '@/components/suppliers/hub/BuyerInsightsCard';
import type { HubHome, InboxItem } from '@/lib/supplier-hub-home';

type HomeResponse = Omit<HubHome, 'buying' | 'selling'> & {
  buying: HubHome['buying'] | null;
  selling: HubHome['selling'] | null;
  access: { buying: boolean; selling: boolean };
};

type Side = 'buying' | 'selling';
const SIDE_KEY = 'supplier-hub-side';

function Tile({
  href,
  icon: Icon,
  label,
  value,
  hint,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: number | null;
  hint?: string;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-[5.5rem] flex-col justify-between rounded-2xl border border-gray-200 bg-white p-3 transition-colors hover:border-primary-300"
    >
      <div className="flex items-center justify-between">
        <Icon className="h-5 w-5 text-primary-600" />
        {value != null && value > 0 && (
          <span className="rounded-full bg-primary-600 px-2 py-0.5 text-xs font-semibold text-white">{value}</span>
        )}
      </div>
      <div>
        <p className="text-sm font-medium text-text-primary">{label}</p>
        {hint && <p className="text-xs text-text-secondary">{hint}</p>}
      </div>
    </Link>
  );
}

function Welcome({ canBuy, canSell }: { canBuy: boolean; canSell: boolean }) {
  const steps = [
    ['Find your supplier', 'Search the wholesalers and distributors you already buy from.'],
    ['They accept', 'Nothing is shared until both of you agree.'],
    ['Bills and orders come here', 'Their bill becomes your purchase in one tap. No typing.'],
  ];
  return (
    <Card padding="lg" className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">Buy and sell with your trade partners, without the typing</h2>
        <p className="mt-1 text-sm text-text-secondary">Connect once. After that, orders, bills and stock stay in step on both sides.</p>
      </div>
      <ol className="space-y-3">
        {steps.map(([title, text], i) => (
          <li key={title} className="flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-50 text-sm font-semibold text-primary-700">
              {i + 1}
            </span>
            <span>
              <span className="block font-medium text-text-primary">{title}</span>
              <span className="block text-sm text-text-secondary">{text}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-2 sm:flex-row">
        {canBuy && (
          <Link href="/suppliers/hub/find" className="sm:flex-1">
            <Button className="w-full">Find your supplier</Button>
          </Link>
        )}
        {canSell && (
          <Link href="/suppliers/catalog" className="sm:flex-1">
            <Button variant="secondary" className="w-full">
              I sell to shops: publish my catalog
            </Button>
          </Link>
        )}
      </div>
    </Card>
  );
}

/** Supplier Hub home: what is waiting on this business, then the buying and selling shortcuts. */
export default function SupplierHubHomePage() {
  const toast = useToastContext();
  const [home, setHome] = useState<HomeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [side, setSide] = useState<Side>('buying');
  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/suppliers/hub/home', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load the Supplier Hub');
      setHome(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load the Supplier Hub');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SIDE_KEY);
      if (saved === 'buying' || saved === 'selling') setSide(saved);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const both = !!home?.roles.buying && !!home?.roles.selling;
  const shownSide: Side = both ? side : home?.roles.selling && !home?.roles.buying ? 'selling' : 'buying';
  const pickSide = (s: Side) => {
    setSide(s);
    try {
      localStorage.setItem(SIDE_KEY, s);
    } catch {
      /* storage unavailable */
    }
  };

  const act = async (item: InboxItem, choice?: 'accept' | 'decline') => {
    const a = item.action;
    setBusyKey(item.key);
    try {
      let res: Response;
      if (a.kind === 'order') {
        res = await fetch(`/api/supply-orders/${a.orderId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: a.orderAction, lines: [] }),
        });
      } else if (a.kind === 'request' && choice) {
        res = await fetch(`/api/suppliers/hub/connection-requests/${a.requestId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: choice }),
        });
      } else {
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'That did not go through. Try again.');
      toast.success(
        a.kind === 'order'
          ? a.orderAction === 'confirm'
            ? `Order confirmed. ${item.partner} will bill it.`
            : `Sent to ${item.partner} to confirm.`
          : choice === 'accept'
            ? `Connected with ${item.partner}.`
            : 'Request declined.'
      );
      // Drop the card at once, then refresh the counts behind it.
      setHome((h) => (h ? { ...h, inbox: h.inbox.filter((i) => i.key !== item.key) } : h));
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'That did not go through. Try again.');
    } finally {
      setBusyKey(null);
    }
  };

  const checkLowStock = async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/supply-orders/suggest', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not check');
      toast.success(
        data.lines ? `${data.lines} low item${data.lines === 1 ? '' : 's'} added to suggested orders` : 'No shop is low on your items right now'
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not check');
    } finally {
      setChecking(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }
  if (!home) {
    return (
      <Card padding="lg" className="mx-auto max-w-md text-center">
        <p className="text-text-secondary">The Supplier Hub could not load.</p>
        <Button className="mt-3" onClick={() => { setLoading(true); load(); }}>
          Try again
        </Button>
      </Card>
    );
  }

  const firstTime = !home.roles.buying && !home.roles.selling;
  const visibleInbox = home.inbox;
  const b = home.buying;
  const s = home.selling;

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-24">
      <PageHeader
        title="Supplier Hub"
        subtitle={
          firstTime
            ? 'Orders, bills and stock with your trade partners, in one place.'
            : home.inbox.length
              ? `${home.inbox.length} thing${home.inbox.length === 1 ? '' : 's'} waiting for you.`
              : 'You are all caught up.'
        }
      />

      {firstTime ? (
        <Welcome canBuy={home.access.buying} canSell={home.access.selling} />
      ) : (
        <>
          <section aria-labelledby="hub-needs-you" className="space-y-3">
            <h2 id="hub-needs-you" className="text-base font-semibold text-text-primary">
              Needs you
            </h2>
            {visibleInbox.length === 0 ? (
              <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4">
                <CheckCircle2 className="h-6 w-6 shrink-0 text-green-600" />
                <div>
                  <p className="font-medium text-text-primary">All caught up</p>
                  <p className="text-sm text-text-secondary">New bills, orders and requests will show up here.</p>
                </div>
              </div>
            ) : (
              <ul className="space-y-3">
                {visibleInbox.map((item) => (
                  <HubInboxCard key={item.key} item={item} busy={busyKey === item.key} onAct={act} />
                ))}
              </ul>
            )}
          </section>

          {both && (
            <div className="inline-flex w-full rounded-xl bg-gray-100 p-1 sm:w-auto" role="tablist" aria-label="Buying or selling">
              {(['buying', 'selling'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={shownSide === k}
                  onClick={() => pickSide(k)}
                  className={`flex-1 rounded-lg px-5 py-2 text-sm font-medium transition-colors sm:flex-none ${
                    shownSide === k ? 'bg-white text-text-primary shadow-sm' : 'text-text-secondary'
                  }`}
                >
                  {k === 'buying' ? 'Buying' : 'Selling'}
                </button>
              ))}
            </div>
          )}

          {shownSide === 'buying' && b && (
            <section className="space-y-3" aria-label="Buying">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Tile href="/supply-orders?role=buyer" icon={Package} label="Orders" value={b.openOrders} hint="Open" />
                <Tile href="/purchases/incoming" icon={Inbox} label="Incoming bills" value={b.billsToReceive} hint="To receive" />
                <Tile href="/purchases/new-arrivals" icon={Sparkles} label="New arrivals" value={b.newCollections} hint="Last 14 days" />
                <Tile href="/suppliers" icon={Store} label="My suppliers" hint={`${b.suppliers} connected`} />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button className="sm:flex-1" onClick={() => setNewOrderOpen(true)} disabled={b.partners.length === 0}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  New order
                </Button>
                <Link href="/suppliers/hub/find" className="sm:flex-1">
                  <Button variant="secondary" className="w-full">
                    <Search className="mr-1.5 h-4 w-4" />
                    Find suppliers
                  </Button>
                </Link>
              </div>
            </section>
          )}

          {shownSide === 'selling' && s && (
            <section className="space-y-3" aria-label="Selling">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Tile href="/supply-orders?role=vendor" icon={Package} label="Orders" value={s.openOrders} hint="Open" />
                <Tile
                  href="/suppliers/dashboard"
                  icon={TrendingDown}
                  label="Shops low on stock"
                  value={s.buyersLow}
                  hint={`${s.buyersSharing} of ${s.buyers} share stock`}
                />
                <Tile href="/suppliers/catalog" icon={BookOpen} label="My catalog" hint={`${s.catalogItems} items listed`} />
                <Tile href="/suppliers/dashboard/analytics" icon={BarChart3} label="Area report" hint="Where you sell" />
              </div>
              <Button variant="secondary" className="w-full sm:w-auto" onClick={checkLowStock} disabled={checking}>
                <Users className="mr-1.5 h-4 w-4" />
                {checking ? 'Checking…' : 'Check shops’ low stock now'}
              </Button>
              <BuyerInsightsCard insights={s.insights} buyers={s.buyers} />
            </section>
          )}

          {!both && home.access.selling && !home.roles.selling && (
            <Link href="/suppliers/catalog" className="flex items-center justify-between rounded-2xl border border-dashed border-gray-300 p-4 text-sm hover:border-primary-300">
              <span>
                <span className="block font-medium text-text-primary">Do you also sell to shops?</span>
                <span className="block text-text-secondary">Publish your catalog so your buyers can order from you here.</span>
              </span>
              <ChevronRight className="h-4 w-4 text-text-muted" />
            </Link>
          )}
        </>
      )}

      {b && <NewOrderSheet open={newOrderOpen} onClose={() => setNewOrderOpen(false)} partners={b.partners} />}
    </div>
  );
}
