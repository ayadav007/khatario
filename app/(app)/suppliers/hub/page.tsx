'use client';

export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Eye,
  Inbox,
  Loader2,
  Package,
  Plus,
  Search,
  ShoppingCart,
  Sparkles,
  Store,
  TrendingDown,
  Users,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { HubInboxCard } from '@/components/suppliers/hub/HubInboxCard';
import { NewOrderSheet } from '@/components/suppliers/hub/NewOrderSheet';
import { BuyerInsightsCard } from '@/components/suppliers/hub/BuyerInsightsCard';
import { ConnectBuyerDialog } from '@/components/suppliers/hub/ConnectBuyerDialog';
import { headingFont } from '@/components/suppliers/hub/DirectoryUi';
import type { HubHome, InboxItem } from '@/lib/supplier-hub-home';

type HomeResponse = Omit<HubHome, 'buying' | 'selling'> & {
  buying: HubHome['buying'] | null;
  selling: HubHome['selling'] | null;
  access: { buying: boolean; selling: boolean };
};

/** Fixed Khatario colours: the hub is a shared marketplace, so it ignores each business's portal theme. */
const panelClass = 'rounded-[20px] border border-[#E6E1D6] bg-white';
const primaryBtn =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-[#032B23] px-4 text-sm font-semibold text-white hover:bg-[#021f19] disabled:opacity-50';
const outlineBtn =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-[#C9D3CF] bg-white px-4 text-sm font-semibold text-text-primary hover:border-[#45625c] disabled:opacity-50';

const accentBtn =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-[#F58220] px-4 text-sm font-bold text-[#011310] hover:bg-[#f8a35a]';

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
      className="flex min-h-[6rem] flex-col justify-between gap-3 rounded-2xl bg-[#F7F3EA] p-3.5 transition-colors hover:bg-[#EFE8D9]"
    >
      <div className="flex items-center justify-between">
        <Icon className="h-5 w-5 text-[#0F5C46]" />
        {value != null && value > 0 && (
          <span className="rounded-full bg-[#F58220] px-2 py-0.5 text-xs font-bold text-[#011310]">{value}</span>
        )}
      </div>
      <div>
        <p className="text-sm font-semibold text-text-primary">{label}</p>
        {hint && <p className="text-xs text-text-secondary">{hint}</p>}
      </div>
    </Link>
  );
}

function PanelHeader({
  id,
  icon: Icon,
  title,
  text,
}: {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  text: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#E6EFEB] text-[#0F5C46]"
        aria-hidden
      >
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <h2 id={id} className={`${headingFont} text-xl font-bold text-text-primary`}>
          {title}
        </h2>
        <p className="text-sm text-text-secondary">{text}</p>
      </div>
    </div>
  );
}

const STEPS = [
  ['Find your supplier', 'Search the wholesalers and distributors you already buy from.'],
  ['They accept', 'Nothing is shared until both of you agree.'],
  ['Bills and orders come here', 'Their bill becomes your purchase in one tap. No typing.'],
];

function HowItWorks() {
  return (
    <section aria-labelledby="hub-how" className="flex flex-col gap-4 rounded-[20px] bg-[#032B23] p-6 text-white">
      <h2 id="hub-how" className={`${headingFont} text-lg font-bold`}>
        How it works
      </h2>
      <ol className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-4">
        {STEPS.map(([title, text], i) => (
          <li key={title} className="flex items-start gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#F58220] text-[13px] font-bold text-[#011310]">
              {i + 1}
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-[15px] font-semibold">{title}</span>
              <span className="text-[13px] leading-snug text-[#CFDDD8]">{text}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Supplier Hub home: what is waiting on this business, then the buying and selling shortcuts. */
export default function SupplierHubHomePage() {
  const toast = useToastContext();
  const router = useRouter();
  const { business } = useAuth();
  const [query, setQuery] = useState('');
  const [home, setHome] = useState<HomeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [connectRequestId, setConnectRequestId] = useState<string | null>(null);
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
      } else if (a.kind === 'standing' && choice) {
        res = await fetch(`/api/supply-orders/standing/${a.standingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: choice }),
        });
      } else if (a.kind === 'money') {
        res = await fetch('/api/suppliers/hub/money-notices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notice_id: a.noticeId, action: 'record' }),
        });
      } else if (a.kind === 'request' && choice === 'accept') {
        setConnectRequestId(a.requestId);
        setBusyKey(null);
        return;
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
          : a.kind === 'standing'
            ? choice === 'accept'
              ? `Standing order with ${item.partner} is running.`
              : 'Standing order declined.'
            : a.kind === 'money'
            ? `Receipt from ${item.partner} recorded.`
            : choice === 'accept'
              ? `Connected with ${item.partner}.`
              : 'Request declined.',
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
        data.lines
          ? `${data.lines} low item${data.lines === 1 ? '' : 's'} added to suggested orders`
          : 'No shop is low on your items right now',
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not check');
    } finally {
      setChecking(false);
    }
  };

  function search(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    router.push(q ? `/suppliers/hub/find?q=${encodeURIComponent(q)}` : '/suppliers/hub/find');
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-[#032B23]" />
      </div>
    );
  }
  if (!home) {
    return (
      <div className={`${panelClass} mx-auto max-w-md p-6 text-center`}>
        <p className="text-text-secondary">The Supplier Hub could not load.</p>
        <button
          type="button"
          className={`${primaryBtn} mt-3`}
          onClick={() => {
            setLoading(true);
            load();
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  const firstTime = !home.roles.buying && !home.roles.selling;
  const visibleInbox = home.inbox;
  const b = home.buying;
  const s = home.selling;
  const status = firstTime
    ? 'Buy from your distributors and sell to your shops, with bills, orders and stock in step on both sides.'
    : visibleInbox.length
      ? `${visibleInbox.length} thing${visibleInbox.length === 1 ? '' : 's'} waiting for you.`
      : 'You are all caught up.';
  const stats = [
    b && { label: b.suppliers === 1 ? 'supplier connected' : 'suppliers connected', value: b.suppliers },
    s && { label: s.buyers === 1 ? 'shop buys from you' : 'shops buy from you', value: s.buyers },
    s && { label: s.catalogItems === 1 ? 'item in your catalogue' : 'items in your catalogue', value: s.catalogItems },
  ].filter(Boolean) as Array<{ label: string; value: number }>;

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-24">
      <section className="overflow-hidden rounded-3xl bg-[#032B23] text-white">
        <div className="flex flex-col gap-6 px-5 py-6 sm:px-8 sm:py-8 lg:px-10 lg:pb-10">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="flex max-w-2xl flex-1 basis-[26rem] flex-col gap-3">
              <p className="text-sm font-semibold text-[#d9dfde]">Supplier Hub</p>
              <h1 className={`${headingFont} text-3xl font-bold leading-tight tracking-tight sm:text-[2.6rem]`}>
                Buy from distributors. Sell to shops.
              </h1>
              <p className="text-base leading-relaxed text-[#d9dfde] sm:text-[17px]">{status}</p>
            </div>
            {!firstTime && stats.length > 0 && (
              <dl className="flex flex-wrap gap-x-8 gap-y-3">
                {stats.map((st) => (
                  <div key={st.label} className="flex flex-col">
                    <dt className="order-2 text-[13px] text-[#CFDDD8]">{st.label}</dt>
                    <dd className={`${headingFont} order-1 text-3xl font-bold tabular-nums`}>{st.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          {home.access.buying && (
            <form
              role="search"
              onSubmit={search}
              className="flex flex-col gap-1.5 rounded-2xl bg-white p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.18)] sm:flex-row"
            >
              <label className="flex min-h-[52px] flex-1 items-center gap-2.5 px-3.5">
                <Search className="h-5 w-5 shrink-0 text-[#45625c]" aria-hidden="true" />
                <span className="sr-only">Find suppliers</span>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Find suppliers by product, brand, name or GSTIN"
                  className="min-w-0 flex-1 border-0 bg-transparent text-base text-text-primary outline-none placeholder:text-[#6B7A75] focus:ring-0"
                />
              </label>
              <button
                type="submit"
                className="min-h-[52px] whitespace-nowrap rounded-xl bg-[#032B23] px-7 text-[15px] font-semibold text-white hover:bg-[#021f19] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#032B23]"
              >
                Find suppliers
              </button>
            </form>
          )}
        </div>
      </section>

      {firstTime ? (
        <>
          <HowItWorks />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-4">
            {home.access.buying && (
              <div className={`${panelClass} flex flex-col gap-4 p-6`}>
                <PanelHeader
                  id="hub-start-buying"
                  icon={ShoppingCart}
                  title="I buy from distributors"
                  text="Connect with the wholesalers and distributors you buy from."
                />
                <Link href="/suppliers/hub/find" className={`${primaryBtn} mt-auto`}>
                  <Search className="h-4 w-4" aria-hidden="true" />
                  Find your supplier
                </Link>
              </div>
            )}
            {home.access.selling && (
              <div className={`${panelClass} flex flex-col gap-4 p-6`}>
                <PanelHeader
                  id="hub-start-selling"
                  icon={Store}
                  title="I sell to shops"
                  text="Publish your catalogue so shops can find you and order."
                />
                <Link href="/suppliers/catalog" className={`${accentBtn} mt-auto`}>
                  Publish my catalogue
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <section aria-labelledby="hub-needs-you" className="space-y-3">
            <h2 id="hub-needs-you" className={`${headingFont} text-[22px] font-bold text-text-primary`}>
              Needs you
            </h2>
            {visibleInbox.length === 0 ? (
              <div className={`${panelClass} flex items-center gap-3 p-4`}>
                <CheckCircle2 className="h-6 w-6 shrink-0 text-[#0F7A5A]" />
                <div>
                  <p className="font-semibold text-text-primary">All caught up</p>
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

          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,24rem),1fr))] items-start gap-5">
            {b && (
              <section aria-labelledby="hub-buying" className={`${panelClass} flex flex-col gap-4 p-5 sm:p-6`}>
                <PanelHeader
                  id="hub-buying"
                  icon={ShoppingCart}
                  title="Buying"
                  text="From the distributors and wholesalers you buy from."
                />
                <div className="grid grid-cols-2 gap-3">
                  <Tile
                    href="/supply-orders?role=buyer"
                    icon={Package}
                    label="Orders"
                    value={b.openOrders}
                    hint="Open"
                  />
                  <Tile
                    href="/purchases/incoming"
                    icon={Inbox}
                    label="Incoming bills"
                    value={b.billsToReceive}
                    hint="To receive"
                  />
                  <Tile
                    href="/purchases/new-arrivals"
                    icon={Sparkles}
                    label="New arrivals"
                    value={b.newCollections}
                    hint="Last 14 days"
                  />
                  <Tile href="/suppliers" icon={Store} label="My suppliers" hint={`${b.suppliers} connected`} />
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Link href="/suppliers/hub/find" className={`${primaryBtn} sm:flex-1`}>
                    <Search className="h-4 w-4" aria-hidden="true" />
                    Find suppliers
                  </Link>
                  <button
                    type="button"
                    className={`${outlineBtn} sm:flex-1`}
                    onClick={() => setNewOrderOpen(true)}
                    disabled={b.partners.length === 0}
                    title={b.partners.length === 0 ? 'Connect with a supplier first' : undefined}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    New order
                  </button>
                </div>
              </section>
            )}

            {s && (
              <section aria-labelledby="hub-selling" className={`${panelClass} flex flex-col gap-4 p-5 sm:p-6`}>
                <PanelHeader id="hub-selling" icon={Store} title="Selling" text="To the shops that buy from you." />
                {home.roles.selling ? (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <Tile
                        href="/supply-orders?role=vendor"
                        icon={Package}
                        label="Orders"
                        value={s.openOrders}
                        hint="Open"
                      />
                      <Tile
                        href="/suppliers/dashboard"
                        icon={TrendingDown}
                        label="Shops low on stock"
                        value={s.buyersLow}
                        hint={`${s.buyersSharing} of ${s.buyers} share stock`}
                      />
                      <Tile
                        href="/suppliers/catalog"
                        icon={BookOpen}
                        label="My catalogue"
                        hint={`${s.catalogItems} ${s.catalogItems === 1 ? 'item' : 'items'} listed`}
                      />
                      <Tile
                        href="/suppliers/dashboard/analytics"
                        icon={BarChart3}
                        label="Area report"
                        hint="Where you sell"
                      />
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button
                        type="button"
                        className={`${outlineBtn} sm:flex-1`}
                        onClick={checkLowStock}
                        disabled={checking}
                      >
                        <Users className="h-4 w-4" aria-hidden="true" />
                        {checking ? 'Checking…' : 'Check shops’ low stock'}
                      </button>
                      {business?.id && (
                        <Link href={`/suppliers/hub/${business.id}`} className={`${outlineBtn} sm:flex-1`}>
                          <Eye className="h-4 w-4" aria-hidden="true" />
                          See my profile
                        </Link>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col gap-3 rounded-2xl bg-[#F7F3EA] p-4">
                    <p className="text-sm text-text-primary">
                      Do you also sell to shops? Publish your catalogue so they can find you and order here.
                    </p>
                    <Link href="/suppliers/catalog" className={`${accentBtn} w-fit`}>
                      Publish my catalogue
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </Link>
                  </div>
                )}
              </section>
            )}
          </div>

          {s && home.roles.selling && <BuyerInsightsCard insights={s.insights} buyers={s.buyers} />}
        </>
      )}

      {b && <NewOrderSheet open={newOrderOpen} onClose={() => setNewOrderOpen(false)} partners={b.partners} />}
      {connectRequestId && (
        <ConnectBuyerDialog
          requestId={connectRequestId}
          onClose={() => setConnectRequestId(null)}
          onConnected={(name) => {
            toast.success(`Connected with ${name}.`);
            setHome((h) => (h ? { ...h, inbox: h.inbox.filter((i) => i.key !== `request-${connectRequestId}`) } : h));
            setConnectRequestId(null);
            load();
          }}
        />
      )}
    </div>
  );
}
