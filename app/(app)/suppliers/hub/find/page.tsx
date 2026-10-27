'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, type FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { ArrowLeft, Check, Clock, Loader2, Search, Send } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
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
} from '@/components/suppliers/hub/DirectoryUi';

interface DirectoryRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  gstin: string | null;
  logo_url: string | null;
  profile_summary: string | null;
  featured_categories: string[] | null;
  connection: 'connected' | 'requested' | null;
  buyers_count: number;
  listing_count: number;
  preview_items: Array<{ name: string; image_url: string | null }>;
}

type Sort = 'name' | 'most_connected' | 'newest';

const TRUST_POINTS = [
  'See each supplier’s GSTIN before you connect',
  'Their bills land in your purchases, no scanning',
  'More of their catalogue opens once they accept',
];

const chipClass = (active: boolean) =>
  `inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-medium transition-colors ${
    active
      ? 'border-[#032B23] bg-[#032B23] text-white'
      : 'border-[#DCD6CA] bg-white text-text-primary hover:border-[#7c918d]'
  }`;

export default function FindSuppliersPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  // The Supplier Hub home search lands here as ?q=.
  const initialQ = (useSearchParams()?.get('q') || '').trim();
  const [draft, setDraft] = useState(initialQ);
  const [q, setQ] = useState(initialQ);
  const [category, setCategory] = useState('');
  const [hasCatalogue, setHasCatalogue] = useState(false);
  const [showsPrices, setShowsPrices] = useState(false);
  const [sort, setSort] = useState<Sort>('name');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<DirectoryRow[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [asking, setAsking] = useState<string | null>(null);

  const { status: authStatus } = useAuthorizationGuard({
    resource: 'purchases',
    action: 'read',
    skipCheck: !user?.id || !business?.id,
  });

  const load = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const url = buildApiUrl('/api/suppliers/hub/directory', {
        q: q || undefined,
        category: category || undefined,
        has_catalogue: hasCatalogue ? 1 : undefined,
        shows_prices: showsPrices ? 1 : undefined,
        sort,
        page,
        limit: 20,
      });
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load directory');
      const data = await res.json();
      setRows(data.businesses || []);
      setCategories(data.categories || []);
      setTotal(data.pagination?.total ?? 0);
      setTotalPages(data.pagination?.totalPages ?? 0);
    } catch {
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [business?.id, q, category, hasCatalogue, showsPrices, sort, page]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [q, category, hasCatalogue, showsPrices, sort]);

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    setQ(draft.trim());
  }

  async function askToConnect(row: DirectoryRow) {
    setAsking(row.id);
    try {
      const res = await fetch('/api/suppliers/hub/connection-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplier_business_id: row.id, message: null }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j.error || 'Request failed');
        return;
      }
      toast.success(j.existing ? 'You already asked to connect.' : `Request sent to ${row.name}.`);
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, connection: 'requested' } : r)));
    } finally {
      setAsking(null);
    }
  }

  if (authStatus === 'loading') {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-100px)]">
        <Loader2 className="w-8 h-8 animate-spin text-[#032B23]" />
      </div>
    );
  }

  if (authStatus === 'denied') {
    return <AccessDenied />;
  }

  const heading = category ? `${category} suppliers` : q ? `Suppliers matching “${q}”` : 'All suppliers';

  return (
    <div className="mx-auto max-w-6xl space-y-8 pb-10">
      <section className="overflow-hidden rounded-3xl bg-[#032B23] text-white">
        <div className="flex flex-col gap-6 px-5 py-6 sm:px-8 sm:py-8 lg:px-10 lg:pb-10">
          <Link
            href="/suppliers/hub"
            className="inline-flex min-h-8 w-fit items-center gap-1.5 text-sm text-[#d9dfde] hover:text-white hover:underline"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Supplier Hub
          </Link>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="flex max-w-xl flex-1 basis-[28rem] flex-col gap-3">
              <h1 className={`${headingFont} text-3xl font-bold leading-tight tracking-tight sm:text-[2.75rem]`}>
                Wholesalers who deliver to your shop
              </h1>
              <p className="text-base leading-relaxed text-[#d9dfde] sm:text-[17px]">
                Connect once. Their bills land straight in your purchases, and you hear about new arrivals first.
              </p>
            </div>
            <ul className="flex flex-col gap-2.5 text-sm text-[#E8EFEC]">
              {TRUST_POINTS.map((t) => (
                <li key={t} className="flex items-center gap-2.5">
                  <Check className="h-[18px] w-[18px] shrink-0 text-[#7FD1B0]" strokeWidth={2.4} aria-hidden="true" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <form
            role="search"
            onSubmit={submitSearch}
            className="flex flex-col gap-1.5 rounded-2xl bg-white p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.18)] sm:flex-row"
          >
            <label className="flex min-h-[52px] flex-1 items-center gap-2.5 px-3.5">
              <Search className="h-5 w-5 shrink-0 text-[#45625c]" aria-hidden="true" />
              <span className="sr-only">Search suppliers</span>
              <input
                type="search"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  if (!e.target.value) setQ('');
                }}
                placeholder="Search by product, brand, supplier or GSTIN"
                className="min-w-0 flex-1 border-0 bg-transparent text-base text-text-primary outline-none placeholder:text-[#6B7A75] focus:ring-0"
              />
            </label>
            <button
              type="submit"
              className="min-h-[52px] rounded-xl bg-[#032B23] px-7 text-[15px] font-semibold text-white hover:bg-[#021f19] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#032B23]"
            >
              Search
            </button>
          </form>
        </div>
      </section>

      {categories.length > 0 && (
        <nav aria-label="Categories" className="flex flex-wrap gap-2.5">
          {['', ...categories].map((c) => (
            <button
              key={c || 'all'}
              type="button"
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
              className={chipClass(category === c)}
            >
              {c || 'All'}
            </button>
          ))}
        </nav>
      )}

      <div className="flex flex-wrap items-start gap-7">
        <aside
          aria-label="Filters"
          className="flex flex-[1_1_15rem] flex-wrap gap-x-10 gap-y-5 rounded-2xl border border-[#E6E1D6] bg-white p-5"
        >
          <h2 className={`${headingFont} basis-full text-lg font-bold text-text-primary`}>Filters</h2>
          <fieldset className="flex flex-[1_1_12rem] flex-col gap-3">
            <legend className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-text-secondary">
              Show only
            </legend>
            <label className="flex min-h-7 items-center gap-2.5 text-sm text-text-primary">
              <input
                type="checkbox"
                checked={hasCatalogue}
                onChange={(e) => setHasCatalogue(e.target.checked)}
                className="h-[18px] w-[18px] accent-[#032B23]"
              />
              Has a catalogue
            </label>
            <label className="flex min-h-7 items-center gap-2.5 text-sm text-text-primary">
              <input
                type="checkbox"
                checked={showsPrices}
                onChange={(e) => setShowsPrices(e.target.checked)}
                className="h-[18px] w-[18px] accent-[#032B23]"
              />
              Prices shown to all
            </label>
          </fieldset>
          <label className="flex flex-[1_1_12rem] flex-col gap-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
            Sort by
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="min-h-11 rounded-xl border border-[#D8D3C8] bg-white px-3 text-sm font-normal normal-case tracking-normal text-text-primary"
            >
              <option value="name">Name, A to Z</option>
              <option value="most_connected">Most shops connected</option>
              <option value="newest">Newest on Khatario</option>
            </select>
          </label>
        </aside>

        <section aria-labelledby="supplier-results" className="flex min-w-0 flex-[999_1_34rem] flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="supplier-results" className={`${headingFont} text-[22px] font-bold text-text-primary`}>
              {heading}
            </h2>
            {!loading && (
              <span className="text-sm text-text-secondary" aria-live="polite">
                {total === 1 ? '1 supplier' : `${total} suppliers`}
              </span>
            )}
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-[#032B23]" />
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-2xl border border-[#E6E1D6] bg-white p-8 text-center">
              <p className="font-medium text-text-primary">
                {q || category || hasCatalogue || showsPrices
                  ? 'No suppliers match these filters'
                  : 'No suppliers listed yet'}
              </p>
              <p className="mt-1 text-sm text-text-secondary">
                Your supplier may not be listed yet. Ask them to list themselves under Settings → Suppliers directory,
                then search again.
              </p>
            </div>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,22rem),1fr))] gap-4">
              {rows.map((b) => (
                <li key={b.id}>
                  <SupplierCard row={b} asking={asking === b.id} onAsk={() => askToConnect(b)} />
                </li>
              ))}
            </ul>
          )}

          {totalPages > 1 && (
            <nav aria-label="Pages" className="flex justify-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="min-h-11 rounded-xl border border-[#C9D3CF] bg-white px-4 text-sm font-semibold text-text-primary disabled:opacity-50"
              >
                Previous
              </button>
              <span className="self-center text-sm text-text-secondary">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="min-h-11 rounded-xl border border-[#C9D3CF] bg-white px-4 text-sm font-semibold text-text-primary disabled:opacity-50"
              >
                Next
              </button>
            </nav>
          )}
        </section>
      </div>

      <section className="flex flex-wrap items-center justify-between gap-6 rounded-3xl border border-[#E6E1D6] bg-white p-6 sm:p-8">
        <div className="flex max-w-xl flex-1 basis-80 flex-col gap-2">
          <h2 className={`${headingFont} text-2xl font-bold text-text-primary`}>
            Are you a wholesaler or distributor?
          </h2>
          <p className="text-[15px] leading-relaxed text-text-secondary">
            List your catalogue on Supplier Hub and get found by shops looking for what you sell.
          </p>
        </div>
        <Link
          href="/settings/suppliers-directory"
          className="inline-flex min-h-12 items-center rounded-xl bg-[#F58220] px-6 text-[15px] font-bold text-[#011310] hover:bg-[#f8a35a]"
        >
          List your business
        </Link>
      </section>
    </div>
  );
}

function SupplierCard({ row, asking, onAsk }: { row: DirectoryRow; asking: boolean; onAsk: () => void }) {
  const place = formatPlace(row.city, row.state);
  const chips = (row.featured_categories || []).slice(0, 3);
  const items = row.preview_items || [];
  const href = `/suppliers/hub/${row.id}`;
  const proof =
    row.buyers_count > 0
      ? `${row.buyers_count} ${row.buyers_count === 1 ? 'shop buys' : 'shops buy'} here on Khatario`
      : row.listing_count > 0
        ? `${row.listing_count} ${row.listing_count === 1 ? 'product' : 'products'} listed`
        : null;

  return (
    <article className="flex h-full flex-col gap-4 rounded-2xl border border-[#E6E1D6] bg-white p-5">
      <header className="flex items-start gap-3.5">
        <SupplierAvatar id={row.id} name={row.name} logoUrl={row.logo_url} className="h-[52px] w-[52px] text-xl" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className={`${headingFont} flex items-center gap-1.5 text-lg font-bold text-text-primary`}>
            <Link href={href} className="truncate hover:underline">
              {row.name}
            </Link>
            <GstinBadge gstin={row.gstin} compact />
          </h3>
          {place && <span className="text-[13px] text-text-secondary">{place}</span>}
          {chips.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <CategoryChip key={c}>{c}</CategoryChip>
              ))}
            </div>
          )}
        </div>
      </header>

      {row.profile_summary && (
        <p className="line-clamp-2 text-sm leading-relaxed text-text-secondary">{row.profile_summary}</p>
      )}

      {items.length > 0 && (
        <ul aria-label={`Products from ${row.name}`} className="grid grid-cols-3 gap-2.5">
          {items.map((p, i) => (
            <li key={`${p.name}-${i}`} className="flex min-w-0 flex-col gap-1.5">
              <ProductTile seed={row.id} imageUrl={p.image_url} className="aspect-square rounded-xl" />
              <span className="line-clamp-2 text-xs font-medium leading-snug text-text-primary">{p.name}</span>
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2.5">
        <span className="text-[13px] text-text-secondary">{proof}</span>
        <div className="flex gap-2">
          <Link
            href={href}
            className="inline-flex min-h-11 items-center rounded-xl border border-[#C9D3CF] px-3.5 text-sm font-semibold text-text-primary hover:border-[#45625c]"
          >
            View
          </Link>
          {row.connection === 'connected' ? (
            <span className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-[#E3F2EB] px-3.5 text-sm font-semibold text-[#0B5E45]">
              <Check className="h-4 w-4" aria-hidden="true" /> Connected
            </span>
          ) : row.connection === 'requested' ? (
            <span className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-[#fef6ef] px-3.5 text-sm font-semibold text-[#6e3b0e]">
              <Clock className="h-4 w-4" aria-hidden="true" /> Request sent
            </span>
          ) : (
            <button
              type="button"
              onClick={onAsk}
              disabled={asking}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-[#032B23] px-4 text-sm font-semibold text-white hover:bg-[#021f19] disabled:opacity-60"
            >
              {asking ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="h-4 w-4" aria-hidden="true" />
              )}
              Ask to connect
            </button>
          )}
        </div>
      </footer>
    </article>
  );
}
