'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState, useCallback, type ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Check, Clock, Link2, Loader2, Lock, MessageCircle, Phone, Send } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useMobileHeaderTitleOverride } from '@/contexts/MobileHeaderTitleContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { useToastContext } from '@/contexts/ToastContext';
import { buildApiUrl } from '@/lib/api-helpers';
import {
  CategoryChip,
  GstinBadge,
  ProductTile,
  SupplierAvatar,
  formatPlace,
  headingFont,
  supplierTint,
} from '@/components/suppliers/hub/DirectoryUi';
import { replyLabel, type SupplierTrust } from '@/lib/suppliers-hub';

interface Listing {
  id: string;
  item_id: string;
  audience: string;
  display_name: string | null;
  moq: string | null;
  lead_time_text: string | null;
  price_display: string;
  from_amount: string | null;
  item_name: string;
  item_unit: string;
  item_code: string | null;
  item_mrp: string | null;
  item_image_url: string | null;
  item_brand: string | null;
  category_name: string | null;
}

interface ProfilePayload {
  business: {
    id: string;
    name: string;
    city: string | null;
    state: string | null;
    gstin: string | null;
    phone: string | null;
    logo_url: string | null;
    created_at: string;
  };
  discovery: {
    visibility: string;
    profile_summary: string | null;
    featured_categories: string[];
    cover_image_url: string | null;
  };
  viewer: {
    is_linked: boolean;
    pending_request_id: string | null;
    pending_request_message: string | null;
    pending_request_at: string | null;
    supplier_record_id: string | null;
  };
  buyers_count: number;
  listings: Listing[];
  trust: SupplierTrust | null;
}

const STEPS = [
  { title: 'Ask to connect', body: 'Send a request with an optional note.' },
  { title: 'They accept', body: 'You see the items they keep for connected shops, and their new arrivals.' },
  { title: 'Bills arrive by themselves', body: 'Every bill they raise lands in your purchases, ready to save.' },
];

const rupees = (v: string | number) => `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function monthYear(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

/** wa.me wants the full international number without symbols; Indian 10-digit numbers get 91. */
function whatsappHref(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `https://wa.me/91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `https://wa.me/${digits.replace(/^0+/, '')}`;
  return null;
}

const cardClass = 'rounded-2xl border border-[#E6E1D6] bg-white';
const outlineLink =
  'inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#C9D3CF] text-sm font-semibold text-text-primary hover:border-[#45625c]';

export default function SupplierHubProfilePage() {
  const params = useParams();
  const businessId = params.businessId as string;
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [data, setData] = useState<ProfilePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [shareLowStock, setShareLowStock] = useState(true);
  /** First order to send with the request: supplier item id -> quantity typed. */
  const [firstOrder, setFirstOrder] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState('');

  useMobileHeaderTitleOverride(data?.business.name);

  const { status: authStatus } = useAuthorizationGuard({
    resource: 'purchases',
    action: 'read',
    skipCheck: !user?.id || !business?.id,
  });

  const load = useCallback(async () => {
    if (!business?.id || !businessId) return;
    setLoading(true);
    try {
      const url = buildApiUrl(`/api/suppliers/hub/profile/${businessId}`);
      const res = await fetch(url, { cache: 'no-store' });
      if (res.status === 404) {
        setData(null);
        return;
      }
      if (!res.ok) throw new Error('Failed to load profile');
      setData(await res.json());
    } catch {
      setData(null);
      toast.error('Could not load supplier profile');
    } finally {
      setLoading(false);
    }
  }, [business?.id, businessId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function requestConnection() {
    if (!businessId) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/suppliers/hub/connection-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplier_business_id: businessId,
          message: msg.trim() || null,
          share_low_stock: shareLowStock,
          lines: Object.entries(firstOrder)
            .filter(([, q]) => Number(q) > 0)
            .map(([vendor_item_id, q]) => ({ vendor_item_id, qty: Number(q) })),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error || 'Request failed');
        return;
      }
      toast.success(
        j.order
          ? 'Request and first order sent. The order reaches them when they accept.'
          : j.existing
            ? 'You already have a pending request.'
            : 'Connection request sent.'
      );
      setMsg('');
      setFirstOrder({});
      load();
    } finally {
      setSubmitting(false);
    }
  }

  const listings = useMemo(() => data?.listings ?? [], [data]);
  const tabs = useMemo(() => {
    const names = new Set<string>();
    for (const l of listings) if (l.category_name) names.add(l.category_name);
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [listings]);
  const brands = useMemo(() => {
    const names = new Map<string, string>();
    for (const l of listings) {
      const b = l.item_brand?.trim();
      if (b && !names.has(b.toLowerCase())) names.set(b.toLowerCase(), b);
    }
    return Array.from(names.values());
  }, [listings]);
  const shown = tab ? listings.filter((l) => l.category_name === tab) : listings;

  if (authStatus === 'denied') return <AccessDenied />;
  if (authStatus === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-100px)]">
        <Loader2 className="w-8 h-8 animate-spin text-[#032B23]" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <Link
          href="/suppliers/hub/find"
          className="inline-flex min-h-8 items-center gap-1.5 text-sm text-text-secondary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Find suppliers
        </Link>
        <div className={`${cardClass} p-6 text-text-primary`}>Listing not found or not visible.</div>
      </div>
    );
  }

  const { viewer, business: biz, discovery } = data;
  const isSelf = business?.id === businessId;
  const trust = data.trust;
  const place = formatPlace(trust?.district || biz.city, biz.state);
  const reply = replyLabel(trust?.reply_hours);
  const since = monthYear(biz.created_at);
  const wa = biz.phone ? whatsappHref(biz.phone) : null;
  const tint = supplierTint(biz.id);
  const facts = [
    listings.length > 0 && {
      label: 'Products listed',
      value: String(listings.length),
      note: viewer.is_linked ? 'Including items for connected shops' : 'Open to every shop',
    },
    data.buyers_count > 0 && { label: 'Shops supplied', value: String(data.buyers_count), note: 'On Khatario' },
    trust?.fill_rate != null && {
      label: 'Orders filled',
      value: `${Math.round(trust.fill_rate * 100)}%`,
      note: `Of quantity asked, last 90 days`,
    },
    reply && { label: 'Replies', value: reply.replace('Usually replies within ', 'Within '), note: 'Typical, last 90 days' },
    { label: 'Bills', value: 'Auto', note: 'Straight into purchases' },
    since && { label: 'On Khatario since', value: since, note: '' },
  ].filter(Boolean) as Array<{ label: string; value: string; note: string }>;

  return (
    <div className="mx-auto max-w-6xl pb-12">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-text-secondary">
        <Link
          href="/suppliers/hub/find"
          className="inline-flex min-h-8 items-center gap-1.5 text-text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Find suppliers
        </Link>
        <span aria-hidden="true">/</span>
        <span className="truncate" aria-current="page">
          {biz.name}
        </span>
      </nav>

      {discovery.cover_image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={discovery.cover_image_url}
          alt={`${biz.name} shop front`}
          className="mt-4 h-28 w-full rounded-3xl object-cover sm:h-44 lg:h-56"
        />
      ) : (
        <div
          aria-hidden="true"
          className={`mt-4 h-28 rounded-3xl sm:h-44 lg:h-56 ${tint.cover} bg-[repeating-linear-gradient(135deg,transparent_0_18px,rgba(255,255,255,0.35)_18px_36px)]`}
        />
      )}

      <div className="[container-type:inline-size]">
        <div className="grid grid-cols-1 gap-8 [@container(min-width:52rem)]:grid-cols-[minmax(0,1fr)_320px] [@container(min-width:52rem)]:grid-rows-[auto_1fr]">
          <header className="-mt-12 flex min-w-0 flex-col gap-3.5 px-2 sm:px-7 [@container(min-width:52rem)]:col-start-1 [@container(min-width:52rem)]:row-start-1">
            <SupplierAvatar
              id={biz.id}
              name={biz.name}
              logoUrl={biz.logo_url}
              className="h-24 w-24 rounded-[26px] !border-[5px] !border-background text-[34px] sm:h-[104px] sm:w-[104px] sm:text-[38px]"
            />
            <div className="flex flex-col gap-2">
              <h1
                className={`${headingFont} flex flex-wrap items-center gap-3 text-3xl font-bold leading-tight tracking-tight text-text-primary sm:text-[40px]`}
              >
                {biz.name}
                <GstinBadge gstin={biz.gstin} verified={!!trust?.gst_verified} />
              </h1>
              {discovery.profile_summary && (
                <p className="max-w-2xl whitespace-pre-wrap text-base leading-relaxed text-text-secondary sm:text-lg">
                  {discovery.profile_summary}
                </p>
              )}
              {(place || biz.gstin) && (
                <p className="flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-text-secondary">
                  {place && <span>{place}</span>}
                  {biz.gstin && <span>GSTIN {biz.gstin}</span>}
                  {trust?.gst_legal_name && <span>Registered as {trust.gst_legal_name}</span>}
                </p>
              )}
              {discovery.featured_categories.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-2">
                  {discovery.featured_categories.map((c) => (
                    <CategoryChip key={c}>{c}</CategoryChip>
                  ))}
                </div>
              )}
            </div>
          </header>

          <aside
            aria-label={`Connect with ${biz.name}`}
            className="flex min-w-0 flex-col gap-4 self-start [@container(min-width:52rem)]:col-start-2 [@container(min-width:52rem)]:row-span-2 [@container(min-width:52rem)]:row-start-1 [@container(min-width:52rem)]:mt-7"
          >
            <div
              className={`${cardClass} flex flex-col gap-4 rounded-[20px] p-6 shadow-[0_10px_30px_rgba(3,43,35,0.08)]`}
            >
              {isSelf ? (
                <>
                  <h2 className={`${headingFont} text-xl font-bold text-text-primary`}>This is your profile</h2>
                  <p className="text-sm leading-relaxed text-text-secondary">
                    Buyers see this page when your business is listed. Change your summary, categories and visibility in
                    Settings → Suppliers directory.
                  </p>
                  <Link href="/settings/suppliers-directory" className={outlineLink}>
                    Edit directory profile
                  </Link>
                </>
              ) : viewer.is_linked ? (
                <>
                  <h2 className={`${headingFont} flex items-center gap-2 text-xl font-bold text-text-primary`}>
                    <Check className="h-5 w-5 text-[#0F7A5A]" aria-hidden="true" />
                    You buy from {biz.name}
                  </h2>
                  <p className="text-sm leading-relaxed text-text-secondary">
                    Their bills come straight into your purchases, and you see the items they keep for connected shops.
                  </p>
                  {viewer.supplier_record_id && (
                    <Link
                      href={`/suppliers/${viewer.supplier_record_id}`}
                      className="inline-flex min-h-[50px] items-center justify-center gap-2 rounded-xl bg-[#032B23] text-base font-semibold text-white hover:bg-[#021f19]"
                    >
                      <Link2 className="h-[18px] w-[18px]" aria-hidden="true" />
                      Open supplier
                    </Link>
                  )}
                  <Link href="/supply-orders" className={outlineLink}>
                    Supplier orders
                  </Link>
                </>
              ) : viewer.pending_request_id ? (
                <>
                  <h2 className={`${headingFont} flex items-center gap-2 text-xl font-bold text-text-primary`}>
                    <Clock className="h-5 w-5 text-[#8e4b13]" aria-hidden="true" />
                    Request sent
                  </h2>
                  <p className="text-sm leading-relaxed text-text-secondary">
                    {monthYear(viewer.pending_request_at) ? (
                      <>
                        You asked on{' '}
                        {new Date(viewer.pending_request_at as string).toLocaleDateString('en-IN', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}
                        .{' '}
                      </>
                    ) : null}
                    {biz.name} sees it in their notifications. Once they accept, their bills come straight into your
                    purchases.
                  </p>
                  {viewer.pending_request_message && (
                    <blockquote className="rounded-xl bg-background px-3.5 py-2.5 text-sm text-text-primary">
                      “{viewer.pending_request_message}”
                    </blockquote>
                  )}
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <h2 className={`${headingFont} text-xl font-bold text-text-primary`}>Buy from {biz.name}</h2>
                    <p className="text-sm leading-relaxed text-text-secondary">
                      Once they accept, their bills come straight into your purchases and you see the items they keep
                      for connected shops.
                    </p>
                  </div>
                  <label className="flex flex-col gap-1.5 text-[13px] font-medium text-text-primary">
                    Message (optional)
                    <textarea
                      rows={3}
                      value={msg}
                      onChange={(e) => setMsg(e.target.value)}
                      placeholder="Hi, I run a shop nearby and would like your price list."
                      className="resize-y rounded-xl border border-[#D8D3C8] px-3 py-2.5 text-sm font-normal text-text-primary placeholder:text-[#6B7A75]"
                    />
                  </label>
                  <label className="flex cursor-pointer items-start gap-3 rounded-xl bg-background p-3">
                    <input
                      type="checkbox"
                      checked={shareLowStock}
                      onChange={(e) => setShareLowStock(e.target.checked)}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-text-primary">Share stock and sales with {biz.name}</span>
                      <span className="mt-0.5 block text-[13px] leading-relaxed text-text-secondary">
                        They are told when their items reach your reorder level and can propose an order for you to
                        confirm. Your sales of their items count in their area totals, never shown as your shop alone.
                        You can switch this off later on the supplier page.
                      </span>
                    </span>
                  </label>
                  {Object.values(firstOrder).some((q) => Number(q) > 0) && (
                    <p className="rounded-xl bg-[#fef6ef] px-3 py-2 text-[13px] text-[#6e3b0e]">
                      Your first order of {Object.values(firstOrder).filter((q) => Number(q) > 0).length} item(s) goes
                      with the request. {biz.name} gets it as an order once they accept.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={requestConnection}
                    disabled={submitting}
                    className="inline-flex min-h-[50px] items-center justify-center gap-2 rounded-xl bg-[#032B23] text-base font-semibold text-white hover:bg-[#021f19] disabled:opacity-60"
                  >
                    {submitting ? (
                      <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
                    ) : (
                      <Send className="h-[18px] w-[18px]" aria-hidden="true" />
                    )}
                    Ask to connect
                  </button>
                </>
              )}
              {!isSelf && biz.phone && (
                <div className="flex gap-2.5">
                  <a href={`tel:${biz.phone.replace(/[^\d+]/g, '')}`} className={outlineLink}>
                    <Phone className="h-4 w-4" aria-hidden="true" />
                    Call
                  </a>
                  {wa && (
                    <a href={wa} target="_blank" rel="noopener noreferrer" className={outlineLink}>
                      <MessageCircle className="h-4 w-4" aria-hidden="true" />
                      WhatsApp
                    </a>
                  )}
                </div>
              )}
            </div>

            {!isSelf && !viewer.is_linked && <HowItWorks className={`hidden [@container(min-width:52rem)]:flex`} />}
          </aside>

          <div className="flex min-w-0 flex-col gap-9 [@container(min-width:52rem)]:col-start-1 [@container(min-width:52rem)]:row-start-2">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
              {facts.map((f) => (
                <div key={f.label} className={`${cardClass} flex flex-col gap-1.5 p-4`}>
                  <dt className="text-xs font-medium text-text-secondary">{f.label}</dt>
                  <dd className={`${headingFont} text-xl font-bold text-text-primary`}>{f.value}</dd>
                  {f.note && <dd className="text-xs text-text-secondary">{f.note}</dd>}
                </div>
              ))}
            </dl>

            <section aria-labelledby="catalogue" className="flex flex-col gap-4">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 id="catalogue" className={`${headingFont} text-[26px] font-bold text-text-primary`}>
                  Catalogue
                </h2>
                {listings.length > 0 && (
                  <span className="text-sm text-text-secondary">
                    {listings.length === 1 ? '1 product' : `${listings.length} products`}
                  </span>
                )}
              </div>
              {tabs.length > 1 && (
                <div role="group" aria-label="Catalogue categories" className="flex flex-wrap gap-2">
                  {['', ...tabs].map((t) => (
                    <button
                      key={t || 'all'}
                      type="button"
                      aria-pressed={tab === t}
                      onClick={() => setTab(t)}
                      className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium ${
                        tab === t
                          ? 'border-[#032B23] bg-[#032B23] text-white'
                          : 'border-[#DCD6CA] bg-white text-text-primary hover:border-[#7c918d]'
                      }`}
                    >
                      {t || 'All'}
                    </button>
                  ))}
                </div>
              )}
              {listings.length === 0 ? (
                <div className={`${cardClass} p-5 text-sm text-text-secondary`}>
                  {biz.name} has not listed any products yet.
                </div>
              ) : (
                <ul className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] sm:gap-4">
                  {shown.map((l) => (
                    <li key={l.id}>
                      <ProductCard
                        listing={l}
                        seed={biz.id}
                        linked={viewer.is_linked}
                        orderQty={
                          !isSelf && !viewer.is_linked && !viewer.pending_request_id && l.audience === 'public_preview'
                            ? firstOrder[l.item_id] ?? ''
                            : undefined
                        }
                        onOrderQty={(q) => setFirstOrder((prev) => ({ ...prev, [l.item_id]: q }))}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {brands.length > 0 && (
              <section aria-labelledby="brands" className={`${cardClass} flex flex-col gap-3 p-6`}>
                <h2 id="brands" className={`${headingFont} text-[22px] font-bold text-text-primary`}>
                  Brands carried
                </h2>
                <div className="flex flex-wrap gap-2">
                  {brands.map((b) => (
                    <span
                      key={b}
                      className="rounded-lg border border-[#DCD6CA] px-2.5 py-1.5 text-[13px] text-text-primary"
                    >
                      {b}
                    </span>
                  ))}
                </div>
              </section>
            )}

            {!isSelf && !viewer.is_linked && <HowItWorks className="[@container(min-width:52rem)]:hidden" />}
          </div>
        </div>
      </div>
    </div>
  );
}

/** With `orderQty` set, the card takes a quantity for a first order sent with the connection request. */
function ProductCard({
  listing: l,
  seed,
  linked,
  orderQty,
  onOrderQty,
}: {
  listing: Listing;
  seed: string;
  linked: boolean;
  orderQty?: string;
  onOrderQty?: (qty: string) => void;
}) {
  const name = l.display_name || l.item_name;
  const pack = [l.item_brand, l.item_unit && `Sold per ${l.item_unit}`].filter(Boolean).join(' · ');
  const terms = [l.moq && Number(l.moq) > 0 && `Min ${Number(l.moq).toLocaleString('en-IN')}`, l.lead_time_text]
    .filter(Boolean)
    .join(' · ');

  let price: ReactNode = null;
  if (l.price_display === 'from_amount' && l.from_amount) {
    price = <span className="text-[13px] font-semibold text-text-primary">From {rupees(l.from_amount)}</span>;
  } else if (!linked && l.price_display !== 'hidden') {
    price = (
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#8e4b13]">
        <Lock className="h-3 w-3" aria-hidden="true" />
        Rate after connecting
      </span>
    );
  } else if (l.price_display === 'on_request') {
    price = <span className="text-xs text-text-secondary">Price on request</span>;
  }

  return (
    <article className={`${cardClass} flex h-full flex-col overflow-hidden`}>
      <ProductTile seed={seed} imageUrl={l.item_image_url} className="aspect-[4/3]" />
      <div className="flex flex-1 flex-col gap-1.5 p-3.5">
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug text-text-primary">{name}</h3>
        {pack && <span className="text-[13px] text-text-secondary">{pack}</span>}
        {terms && <span className="text-xs text-text-secondary">{terms}</span>}
        {l.audience === 'linked_only' && (
          <span className="w-fit rounded-full bg-[#edf0f0] px-2 py-0.5 text-[11px] font-medium text-text-primary">
            For connected shops
          </span>
        )}
        {(l.item_mrp || price) && (
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-2">
            {l.item_mrp && Number(l.item_mrp) > 0 ? (
              <span className="text-[13px] text-text-secondary">MRP {rupees(l.item_mrp)}</span>
            ) : (
              <span />
            )}
            {price}
          </div>
        )}
        {orderQty !== undefined && onOrderQty && (
          <label className="mt-2 flex items-center justify-between gap-2 text-xs text-text-secondary">
            Add to first order
            <input
              id={`first-order-${l.item_id}`}
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={orderQty}
              onChange={(e) => onOrderQty(e.target.value)}
              placeholder={l.moq && Number(l.moq) > 0 ? `Min ${Number(l.moq)}` : 'Qty'}
              className="w-20 rounded-lg border border-[#D8D3C8] px-2 py-1 text-sm text-text-primary"
            />
          </label>
        )}
      </div>
    </article>
  );
}

function HowItWorks({ className }: { className?: string }) {
  return (
    <div className={`flex flex-col gap-4 rounded-[20px] bg-[#032B23] p-6 text-white ${className ?? ''}`}>
      <h2 className={`${headingFont} text-lg font-bold`}>How it works</h2>
      <ol className="flex flex-col gap-3.5">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex items-start gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#F58220] text-[13px] font-bold text-[#011310]">
              {i + 1}
            </span>
            <span className="flex flex-col gap-0.5">
              <span className="text-[15px] font-semibold">{s.title}</span>
              <span className="text-[13px] leading-snug text-[#CFDDD8]">{s.body}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
