'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  AlertCircle,
  BadgeCheck,
  Check,
  Clock,
  Globe,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Truck,
  UserRound,
} from 'lucide-react';
import { Kbd, SectionLabel } from './Kbd';
import { inr, initials, type Address, type Customer } from '../_lib/mock-data';

type BillToProps = {
  customers: Customer[];
  customer: Customer | null;
  searching: boolean;
  setSearching: (v: boolean) => void;
  onSelect: (c: Customer) => void;
  inputRef: React.RefObject<HTMLInputElement>;
  onNewCustomer: () => void;
};

export function BillToPanel({
  customers,
  customer,
  searching,
  setSearching,
  onSelect,
  inputRef,
  onNewCustomer,
}: BillToProps) {
  const showSearch = searching || !customer;

  return (
    <div className="flex min-w-0 flex-col p-4">
      <div className="mb-3 flex h-7 items-center justify-between gap-2">
        <SectionLabel>Bill to</SectionLabel>
        {customer && !searching && (
          <div className="flex items-center gap-1.5">
            <HeaderButton icon={Pencil} label="Edit" />
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
          onNewCustomer={onNewCustomer}
        />
      ) : (
        <CustomerCard customer={customer!} />
      )}
    </div>
  );
}

function CustomerCard({ customer }: { customer: Customer }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-sm font-bold text-white shadow-sm shadow-primary-600/30">
          {initials(customer.name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-bold leading-tight text-slate-900">{customer.name}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {customer.contact ? `${customer.contact} · ` : ''}
            <Phone className="mb-0.5 inline h-3 w-3" /> {customer.phone}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {customer.country ? (
          <>
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
              <Globe className="h-3 w-3" /> Overseas · {customer.country}
            </span>
            {customer.taxId && (
              <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
                {customer.taxId}
              </span>
            )}
          </>
        ) : customer.gstin ? (
          <>
            <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700">
              {customer.gstin}
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-700">
              <BadgeCheck className="h-3 w-3" /> Verified
            </span>
          </>
        ) : (
          <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
            Unregistered · B2C
          </span>
        )}
      </div>

      <AddressBlock address={customer.billing} className="mt-2.5" />
      {customer.email && (
        <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-slate-500">
          <Mail className="h-3 w-3 shrink-0" /> {customer.email}
        </p>
      )}

      <div className="mt-auto pt-3">
        <div className="flex items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs">
          {customer.outstanding > 0 ? (
            <span className="flex items-center gap-1.5 font-semibold text-rose-600">
              <AlertCircle className="h-3.5 w-3.5" />
              {inr(customer.outstanding, 0)} due
              {customer.overdueCount > 0 && (
                <span className="rounded bg-rose-100 px-1.5 py-px text-[10px] font-bold text-rose-700">
                  {customer.overdueCount} overdue
                </span>
              )}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 font-semibold text-emerald-600">
              <Check className="h-3.5 w-3.5" /> No dues
            </span>
          )}
          {customer.lastInvoice && (
            <span className="ml-auto flex items-center gap-1 truncate text-slate-500">
              <Clock className="h-3 w-3 shrink-0" />
              Last {inr(customer.lastInvoice.amount, 0)} · {customer.lastInvoice.date}
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
  onNewCustomer,
}: {
  customers: Customer[];
  inputRef: React.RefObject<HTMLInputElement>;
  onSelect: (c: Customer) => void;
  onCancel?: () => void;
  onNewCustomer: () => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone.replace(/\s/g, '').includes(q.replace(/\s/g, '')) ||
        (c.gstin ?? '').toLowerCase().includes(q)
    );
  }, [customers, query]);

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
      if (active === results.length) onNewCustomer();
      else if (results[active]) onSelect(results[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (query) setQuery('');
      else if (onCancel) onCancel();
      else setOpen(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <div className="relative">
        <div className="flex h-11 items-center gap-2 rounded-xl border-2 border-primary-200 bg-white px-3 transition focus-within:border-primary-500 focus-within:ring-4 focus-within:ring-primary-100">
          <Search className="h-4 w-4 shrink-0 text-primary-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={onKeyDown}
            placeholder="Search customer by name, phone or GSTIN"
            className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-900 outline-none placeholder:font-normal placeholder:text-slate-400"
            role="combobox"
            aria-expanded={open}
            aria-controls="customer-results"
          />
          <Kbd>F2</Kbd>
        </div>

        {open && (
          <div
            ref={listRef}
            id="customer-results"
            role="listbox"
            className="absolute inset-x-0 top-full z-30 mt-1.5 max-h-80 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-2xl shadow-slate-900/10"
          >
            <p className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {query ? `${results.length} matches` : 'Recent customers'}
            </p>
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
                  idx === active ? 'bg-primary-50' : 'hover:bg-slate-50'
                )}
              >
                <span
                  className={clsx(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold',
                    idx === active ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600'
                  )}
                >
                  {initials(c.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-900">{c.name}</span>
                  <span className="block truncate text-xs text-slate-500">
                    {c.phone} · {c.country ? `Overseas · ${c.country}` : c.gstin ?? 'Unregistered'} ·{' '}
                    {c.billing.city}
                  </span>
                </span>
                {c.outstanding > 0 && (
                  <span className="shrink-0 text-xs font-semibold text-rose-600">{inr(c.outstanding, 0)}</span>
                )}
              </button>
            ))}
            <button
              type="button"
              data-idx={results.length}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(results.length)}
              onClick={onNewCustomer}
              className={clsx(
                'mt-1 flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2.5 text-sm font-semibold text-primary-700',
                active === results.length ? 'bg-primary-50' : 'hover:bg-slate-50'
              )}
            >
              <Plus className="h-4 w-4" />
              {query ? `Create “${query}” as new customer` : 'Add new customer'}
            </button>
          </div>
        )}
      </div>

      {!open && (
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] text-slate-400">Recent</p>
          <div className="flex flex-wrap gap-1.5">
            {customers.slice(0, 3).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelect(c)}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white py-1 pl-1 pr-2.5 text-xs font-medium text-slate-700 transition hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[9px] font-bold text-slate-600">
                  {initials(c.name)}
                </span>
                {c.name}
              </button>
            ))}
          </div>
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
            <UserRound className="h-3 w-3" /> Leave empty for a walk-in cash sale
          </p>
        </div>
      )}
    </div>
  );
}

export function ShipToPanel({
  customer,
  shipAddressId,
  onChange,
}: {
  customer: Customer | null;
  shipAddressId: string | null;
  onChange: (id: string) => void;
}) {
  const [picking, setPicking] = useState(false);

  if (!customer) {
    return (
      <div className="flex min-w-0 flex-col p-4">
        <div className="mb-3 flex h-7 items-center">
          <SectionLabel>Ship to</SectionLabel>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-xl bg-slate-50 px-4 py-6 text-center">
          <Truck className="h-5 w-5 text-slate-300" />
          <p className="text-xs text-slate-400">Shipping address fills in after you pick a customer</p>
        </div>
      </div>
    );
  }

  const address = customer.shipping.find((a) => a.id === shipAddressId) ?? customer.billing;
  const sameAsBilling = address.id === customer.billing.id;

  return (
    <div className="relative flex min-w-0 flex-col p-4">
      <div className="mb-3 flex h-7 items-center justify-between gap-2">
        <SectionLabel>Ship to</SectionLabel>
        <HeaderButton icon={RefreshCw} label="Change address" onClick={() => setPicking((p) => !p)} />
      </div>

      <p className="truncate text-[17px] font-bold leading-tight text-slate-900">{customer.name}</p>
      <p className="mt-0.5 text-xs text-slate-500">
        <Phone className="mb-0.5 inline h-3 w-3" /> {customer.phone}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="rounded-md bg-primary-50 px-2 py-0.5 text-[11px] font-semibold text-primary-700">
          {address.label}
        </span>
        {sameAsBilling && (
          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
            Same as billing
          </span>
        )}
      </div>
      <AddressBlock address={address} className="mt-2.5" />

      {picking && (
        <div className="absolute inset-x-3 top-12 z-30 rounded-xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-900/10">
          {customer.shipping.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                onChange(a.id);
                setPicking(false);
              }}
              className={clsx(
                'flex w-full items-start gap-3 rounded-lg p-2.5 text-left transition',
                a.id === address.id ? 'bg-primary-50 ring-1 ring-primary-200' : 'hover:bg-slate-50'
              )}
            >
              <span
                className={clsx(
                  'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2',
                  a.id === address.id ? 'border-primary-600 bg-primary-600' : 'border-slate-300'
                )}
              >
                {a.id === address.id && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-900">{a.label}</span>
                <span className="block text-xs text-slate-500">
                  {a.line1}, {a.city} {a.pincode}
                </span>
              </span>
            </button>
          ))}
          <button
            type="button"
            className="mt-1 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold text-primary-700 hover:bg-primary-50"
          >
            <Plus className="h-4 w-4" /> Add new address
          </button>
        </div>
      )}
    </div>
  );
}

function AddressBlock({ address, className }: { address: Address; className?: string }) {
  return (
    <div className={clsx('flex gap-1.5 text-xs leading-relaxed text-slate-600', className)}>
      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
      <p className="min-w-0">
        {address.line1}
        <br />
        {address.city} – {address.pincode} ·{' '}
        <span className="font-medium text-slate-700">
          {address.state}
          {address.stateCode !== '96' && ` (${address.stateCode})`}
        </span>
      </p>
    </div>
  );
}

function HeaderButton({
  icon: Icon,
  label,
  kbd,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  kbd?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600 transition hover:border-primary-300 hover:text-primary-700"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      {kbd && <Kbd className="h-4 min-w-[16px] text-[9px]">{kbd}</Kbd>}
    </button>
  );
}
