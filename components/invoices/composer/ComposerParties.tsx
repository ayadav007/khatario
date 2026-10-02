'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  AlertCircle,
  BadgeCheck,
  Check,
  Globe,
  Loader2,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Truck,
  UserRound,
  X,
} from 'lucide-react';
import type { Customer } from '@/types/database';
import { useAuth } from '@/contexts/AuthContext';
import {
  listCatalogCustomersLocal,
  OFFLINE_CATALOG_EMPTY_HINT,
  searchCustomersForBilling,
} from '@/lib/offline/catalog/client-search';
import { isAppOffline } from '@/lib/network/offline-state';
import { HeaderButton, inr, initials, Kbd, SectionLabel } from './ui';

export const isOverseasCustomer = (c: Customer | null | undefined) =>
  !!c?.country && !/^\s*(india|in|bharat)\s*$/i.test(c.country);

type BillToProps = {
  customers: Customer[];
  customer: Customer | null;
  searching: boolean;
  setSearching: (v: boolean) => void;
  onSelect: (c: Customer) => void;
  onClear: () => void;
  onCreateCustomer: (query?: string) => void;
  inputRef: React.RefObject<HTMLInputElement>;
  billingAddress: string;
  setBillingAddress: (v: string) => void;
  readOnly: boolean;
  credit: { available: number | null; limit: number } | null;
};

export function BillToPanel({
  customers,
  customer,
  searching,
  setSearching,
  onSelect,
  onClear,
  onCreateCustomer,
  inputRef,
  billingAddress,
  setBillingAddress,
  readOnly,
  credit,
}: BillToProps) {
  const showSearch = !readOnly && (searching || !customer);
  const [editingAddress, setEditingAddress] = useState(false);

  useEffect(() => setEditingAddress(false), [customer?.id]);

  return (
    <div className="flex min-w-0 flex-col p-4">
      <div className="mb-3 flex h-7 items-center justify-between gap-2">
        <SectionLabel>Bill to</SectionLabel>
        {customer && !showSearch && !readOnly && (
          <div className="flex items-center gap-1.5">
            <HeaderButton icon={Pencil} label="Address" onClick={() => setEditingAddress((v) => !v)} />
            <HeaderButton
              icon={RefreshCw}
              label="Change"
              kbd="F2"
              onClick={() => {
                setSearching(true);
                requestAnimationFrame(() => inputRef.current?.focus());
              }}
            />
          </div>
        )}
      </div>

      {showSearch ? (
        <CustomerSearch
          customers={customers}
          inputRef={inputRef}
          onSelect={(c) => {
            onSelect(c);
            setSearching(false);
          }}
          onCancel={customer ? () => setSearching(false) : undefined}
          onClear={customer ? onClear : undefined}
          onCreateCustomer={onCreateCustomer}
        />
      ) : customer ? (
        <CustomerCard
          customer={customer}
          address={billingAddress}
          editingAddress={editingAddress}
          onAddressChange={setBillingAddress}
          onDoneEditing={() => setEditingAddress(false)}
          credit={credit}
        />
      ) : (
        <div className="flex flex-1 items-center gap-2 rounded-xl bg-slate-50 px-3 py-4 text-sm text-text-muted dark:bg-slate-800/50">
          <UserRound className="h-4 w-4" /> Walk-in / cash sale
        </div>
      )}
    </div>
  );
}

function CustomerCard({
  customer,
  address,
  editingAddress,
  onAddressChange,
  onDoneEditing,
  credit,
}: {
  customer: Customer;
  address: string;
  editingAddress: boolean;
  onAddressChange: (v: string) => void;
  onDoneEditing: () => void;
  credit: { available: number | null; limit: number } | null;
}) {
  const overseas = isOverseasCustomer(customer);
  const outstanding = Number(customer.current_balance ?? 0);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-sm font-bold text-white shadow-sm shadow-primary-600/30">
          {initials(customer.name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-bold leading-tight text-text-primary" title={customer.name}>
            {customer.name}
          </p>
          <p className="mt-0.5 truncate text-xs text-text-secondary">
            {customer.company_name && customer.company_name !== customer.name ? `${customer.company_name} · ` : ''}
            {customer.phone ? (
              <>
                <Phone className="mb-0.5 inline h-3 w-3" /> {customer.phone}
              </>
            ) : (
              'No phone'
            )}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {overseas ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            <Globe className="h-3 w-3" /> Overseas · {customer.country}
          </span>
        ) : customer.gstin ? (
          <>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {customer.gstin}
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              <BadgeCheck className="h-3 w-3" /> GST registered
            </span>
          </>
        ) : (
          <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            Unregistered · B2C
          </span>
        )}
      </div>

      {editingAddress ? (
        <div className="mt-2.5">
          <textarea
            autoFocus
            value={address}
            onChange={(e) => onAddressChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
                e.preventDefault();
                onDoneEditing();
              }
            }}
            rows={3}
            placeholder="Billing address for this invoice"
            className="w-full resize-none rounded-lg border border-primary-300 bg-surface px-2.5 py-2 text-xs leading-relaxed text-text-primary outline-none focus:ring-4 focus:ring-primary-100"
          />
          <p className="mt-1 text-[11px] text-text-muted">Changes apply to this invoice only. Ctrl+Enter to finish.</p>
        </div>
      ) : (
        <AddressBlock address={address} fallback="No billing address on file" className="mt-2.5" />
      )}
      {customer.email && (
        <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-text-secondary">
          <Mail className="h-3 w-3 shrink-0" /> {customer.email}
        </p>
      )}

      <div className="mt-auto pt-3">
        <div className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/50">
          {outstanding > 0.004 ? (
            <span className="flex items-center gap-1.5 font-semibold text-rose-600">
              <AlertCircle className="h-3.5 w-3.5" />
              {inr(outstanding, 0)} due
            </span>
          ) : outstanding < -0.004 ? (
            <span className="flex items-center gap-1.5 font-semibold text-sky-600">
              {inr(-outstanding, 0)} advance
            </span>
          ) : (
            <span className="flex items-center gap-1.5 font-semibold text-emerald-600">
              <Check className="h-3.5 w-3.5" /> No dues
            </span>
          )}
          {credit && credit.limit > 0 && credit.available !== null && (
            <span className="ml-auto truncate text-text-secondary">
              Credit left{' '}
              <span className={clsx('font-semibold', credit.available <= 0 ? 'text-rose-600' : 'text-text-primary')}>
                {inr(Math.max(0, credit.available), 0)}
              </span>{' '}
              of {inr(credit.limit, 0)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function CustomerSearch({
  customers,
  inputRef,
  onSelect,
  onCancel,
  onClear,
  onCreateCustomer,
}: {
  customers: Customer[];
  inputRef: React.RefObject<HTMLInputElement>;
  onSelect: (c: Customer) => void;
  onCancel?: () => void;
  onClear?: () => void;
  onCreateCustomer: (query?: string) => void;
}) {
  const { business, user } = useAuth();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState<Customer[]>([]);
  const [searching, setSearching] = useState(false);
  const [recent, setRecent] = useState<Customer[]>([]);
  const cacheRef = useRef(new Map<string, Customer[]>());
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!business?.id || !user?.id) return;
    void listCatalogCustomersLocal({ businessId: business.id, userId: user.id }, 50).then((rows) => {
      if (rows?.length) setRecent(rows as Customer[]);
    });
  }, [business?.id, user?.id]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2 || !business?.id || !user?.id) {
      setRemote([]);
      setSearching(false);
      return;
    }
    const key = `${business.id}:${q.toLowerCase()}`;
    const cached = cacheRef.current.get(key);
    if (cached) {
      setRemote(cached);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const scope = { businessId: business.id, userId: user.id };
        const fromCatalog = await searchCustomersForBilling(scope, q);
        if (cancelled) return;
        if (fromCatalog != null) {
          cacheRef.current.set(key, fromCatalog as Customer[]);
          setRemote(fromCatalog as Customer[]);
          return;
        }
        if (isAppOffline()) {
          setRemote([]);
          return;
        }
        const res = await fetch(
          `/api/customers?business_id=${business.id}&search=${encodeURIComponent(q)}&limit=20&user_id=${user.id}`
        );
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          const list = (data.customers || []) as Customer[];
          cacheRef.current.set(key, list);
          setRemote(list);
        }
      } catch {
        if (!cancelled) setRemote([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, business?.id, user?.id]);

  const browse = recent.length > 0 ? recent : customers;
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return browse.slice(0, 20);
    if (q.length >= 2) return remote;
    return browse
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.company_name?.toLowerCase().includes(q) ||
          (c.phone ?? '').includes(q)
      )
      .slice(0, 20);
  }, [browse, query, remote]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(results.length, a + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active === results.length) onCreateCustomer(query);
      else if (results[active]) onSelect(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (query) setQuery('');
      else if (onCancel) onCancel();
      else setOpen(false);
    }
  };

  const offlineEmpty = isAppOffline() && query.trim().length >= 2 && !searching && results.length === 0;

  return (
    <div className="flex flex-1 flex-col">
      <div className="relative">
        <div className="flex h-11 items-center gap-2 rounded-xl border-2 border-primary-200 bg-surface px-3 transition focus-within:border-primary-500 focus-within:ring-4 focus-within:ring-primary-100 dark:border-primary-800 dark:focus-within:ring-primary-900/40">
          <Search className="h-4 w-4 shrink-0 text-primary-500" />
          <input
            ref={inputRef}
            id="composer-customer-search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={onKeyDown}
            placeholder="Search customer by name or phone"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-sm font-medium text-text-primary outline-none placeholder:font-normal placeholder:text-text-muted"
            role="combobox"
            aria-expanded={open}
            aria-controls="composer-customer-results"
          />
          {searching ? <Loader2 className="h-4 w-4 animate-spin text-text-muted" /> : <Kbd>F2</Kbd>}
        </div>

        {open && (
          <div
            ref={listRef}
            id="composer-customer-results"
            role="listbox"
            className="absolute inset-x-0 top-full z-30 mt-1.5 max-h-80 overflow-auto rounded-xl border border-border bg-surface py-1 shadow-2xl shadow-slate-900/10"
          >
            <p className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              {query.trim() ? (searching ? 'Searching…' : `${results.length} matches`) : 'Customers'}
            </p>
            {offlineEmpty && <p className="px-3 py-2 text-xs text-amber-700">{OFFLINE_CATALOG_EMPTY_HINT}</p>}
            {results.map((c, idx) => (
              <button
                key={c.id}
                type="button"
                data-idx={idx}
                role="option"
                aria-selected={idx === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(idx)}
                onClick={() => onSelect(c)}
                className={clsx(
                  'flex w-full items-center gap-3 px-3 py-2 text-left',
                  idx === active ? 'bg-primary-50 dark:bg-primary-900/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
                )}
              >
                <span
                  className={clsx(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold',
                    idx === active ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  )}
                >
                  {initials(c.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-text-primary">{c.name}</span>
                  <span className="block truncate text-xs text-text-secondary">
                    {[c.phone, isOverseasCustomer(c) ? `Overseas · ${c.country}` : c.gstin || 'Unregistered', c.city]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {Number(c.current_balance ?? 0) > 0.004 && (
                  <span className="shrink-0 text-xs font-semibold text-rose-600">{inr(Number(c.current_balance), 0)}</span>
                )}
              </button>
            ))}
            <button
              type="button"
              data-idx={results.length}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(results.length)}
              onClick={() => onCreateCustomer(query)}
              className={clsx(
                'mt-1 flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-sm font-semibold text-primary-700 dark:text-primary-300',
                active === results.length ? 'bg-primary-50 dark:bg-primary-900/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'
              )}
            >
              <Plus className="h-4 w-4" />
              {query.trim() ? `Create “${query.trim()}” as new customer` : 'Add new customer'}
            </button>
          </div>
        )}
      </div>

      {!open && (
        <div className="mt-3">
          {browse.length > 0 && (
            <>
              <p className="mb-1.5 text-[11px] text-text-muted">Quick pick</p>
              <div className="flex flex-wrap gap-1.5">
                {browse.slice(0, 3).map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onSelect(c)}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface py-1 pl-1 pr-2.5 text-xs font-medium text-text-secondary transition hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700"
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {initials(c.name)}
                    </span>
                    <span className="truncate">{c.name}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[11px] text-text-muted">
              <UserRound className="h-3 w-3" /> Leave empty for a walk-in cash sale
            </p>
            {onClear && (
              <button
                type="button"
                onClick={onClear}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-text-secondary hover:text-rose-600"
              >
                <X className="h-3 w-3" /> Remove customer
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ShipToPanel({
  customer,
  billingAddress,
  shippingAddress,
  setShippingAddress,
  readOnly,
}: {
  customer: Customer | null;
  billingAddress: string;
  shippingAddress: string;
  setShippingAddress: (v: string) => void;
  readOnly: boolean;
}) {
  const [editing, setEditing] = useState(false);

  useEffect(() => setEditing(false), [customer?.id]);

  if (!customer) {
    return (
      <div className="flex min-w-0 flex-col p-4">
        <div className="mb-3 flex h-7 items-center">
          <SectionLabel>Ship to</SectionLabel>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-xl bg-slate-50 px-4 py-6 text-center dark:bg-slate-800/50">
          <Truck className="h-5 w-5 text-slate-300" />
          <p className="text-xs text-text-muted">Shipping address fills in after you pick a customer</p>
        </div>
      </div>
    );
  }

  const same = shippingAddress.trim() === billingAddress.trim();
  const hasSeparate =
    !!customer.shipping_address && customer.shipping_address.trim() !== (customer.billing_address || customer.address || '').trim();

  return (
    <div className="relative flex min-w-0 flex-col p-4">
      <div className="mb-3 flex h-7 items-center justify-between gap-2">
        <SectionLabel>Ship to</SectionLabel>
        {!readOnly && (
          <HeaderButton icon={Pencil} label={editing ? 'Done' : 'Change address'} onClick={() => setEditing((v) => !v)} />
        )}
      </div>

      <p className="truncate text-[17px] font-bold leading-tight text-text-primary">{customer.name}</p>
      {customer.phone && (
        <p className="mt-0.5 text-xs text-text-secondary">
          <Phone className="mb-0.5 inline h-3 w-3" /> {customer.phone}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {same ? (
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-text-secondary dark:bg-slate-800">
            Same as billing
          </span>
        ) : (
          <span className="rounded-md bg-primary-50 px-2 py-0.5 text-[11px] font-semibold text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
            Different delivery address
          </span>
        )}
      </div>

      {editing ? (
        <div className="mt-2.5">
          <textarea
            autoFocus
            value={shippingAddress}
            onChange={(e) => setShippingAddress(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
                e.preventDefault();
                setEditing(false);
              }
            }}
            rows={3}
            placeholder="Delivery address"
            className="w-full resize-none rounded-lg border border-primary-300 bg-surface px-2.5 py-2 text-xs leading-relaxed text-text-primary outline-none focus:ring-4 focus:ring-primary-100"
          />
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setShippingAddress(billingAddress)}
              className="rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-text-secondary hover:border-primary-300 hover:text-primary-700"
            >
              Use billing address
            </button>
            {hasSeparate && (
              <button
                type="button"
                onClick={() => setShippingAddress(customer.shipping_address || '')}
                className="rounded-md border border-border px-2 py-1 text-[11px] font-semibold text-text-secondary hover:border-primary-300 hover:text-primary-700"
              >
                Use saved shipping address
              </button>
            )}
          </div>
        </div>
      ) : (
        <AddressBlock address={shippingAddress} fallback="No delivery address" className="mt-2.5" />
      )}
    </div>
  );
}

function AddressBlock({ address, fallback, className }: { address: string; fallback: string; className?: string }) {
  return (
    <div className={clsx('flex gap-1.5 text-xs leading-relaxed text-text-secondary', className)}>
      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted" />
      <p className="min-w-0 whitespace-pre-line">{address.trim() || <span className="italic text-text-muted">{fallback}</span>}</p>
    </div>
  );
}
