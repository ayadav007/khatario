'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Loader2, Search, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export type InvoiceOption = {
  id: string;
  invoice_number: string;
  customer_id?: string | null;
  customer_name?: string | null;
  invoice_date?: string | null;
  grand_total?: number | string | null;
};

interface InvoiceSearchSelectProps {
  /** Invoices the page already loaded. Typing also searches the server, so older invoices are found too. */
  invoices: InvoiceOption[];
  value: string;
  onChange: (invoiceId: string) => void;
  /** When set, only this customer's invoices are listed and searched. */
  customerId?: string | null;
  /** Invoice status sent to the server search (the pickers link final invoices). */
  status?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  buttonClassName?: string;
  ariaLabel?: string;
}

const MENU_MAX_HEIGHT = 320;

function formatAmount(total: InvoiceOption['grand_total']) {
  if (total === null || total === undefined || total === '') return '';
  const n = Number(total);
  return Number.isFinite(n) ? `₹${n.toLocaleString('en-IN')}` : '';
}

function formatDate(date: InvoiceOption['invoice_date']) {
  if (!date) return '';
  const d = new Date(String(date).slice(0, 10));
  return Number.isNaN(d.getTime())
    ? String(date).slice(0, 10)
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** A searchable invoice picker: type an invoice number, customer name or amount to narrow the list. */
export function InvoiceSearchSelect({
  invoices,
  value,
  onChange,
  customerId,
  status = 'final',
  placeholder = 'Select Invoice',
  disabled = false,
  required = false,
  buttonClassName,
  ariaLabel,
}: InvoiceSearchSelectProps) {
  const { business, user } = useAuth();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState<InvoiceOption[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [fallback, setFallback] = useState<InvoiceOption | null>(null);
  const [box, setBox] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const scoped = useMemo(
    () => (customerId ? invoices.filter((inv) => !inv.customer_id || inv.customer_id === customerId) : invoices),
    [invoices, customerId]
  );

  const selected =
    scoped.find((inv) => inv.id === value) ||
    remote?.find((inv) => inv.id === value) ||
    (fallback?.id === value ? fallback : undefined);

  // A linked invoice that is not in the preloaded list (an older one, or one picked from a search).
  useEffect(() => {
    if (!value || selected || !business?.id) return;
    let cancelled = false;
    fetch(`/api/documents/invoices/${encodeURIComponent(value)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const doc = data?.document;
        if (cancelled || !doc) return;
        setFallback({
          id: doc.id,
          invoice_number: doc.invoice_number,
          customer_id: doc.customer_id,
          customer_name: doc.party_name,
          invoice_date: doc.invoice_date,
          grand_total: doc.grand_total,
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [value, selected, business?.id]);

  const needle = query.trim().toLowerCase();

  // Server search, so invoices beyond the preloaded page are reachable.
  useEffect(() => {
    if (!open || !needle || !business?.id) {
      setRemote(null);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const qs = new URLSearchParams({ business_id: business.id, limit: '50', search: query.trim() });
        if (user?.id) qs.set('user_id', user.id);
        if (status) qs.set('status', status);
        if (customerId) qs.set('customer_id', customerId);
        const res = await fetch(`/api/invoices?${qs}`, { signal: controller.signal });
        if (res.ok) {
          const data = await res.json();
          setRemote(data.invoices || []);
        }
      } catch {
        // aborted or offline: local matches still show
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, needle, query, business?.id, user?.id, status, customerId]);

  const matches = useMemo(() => {
    const local = needle
      ? scoped.filter((inv) => {
          const amount = inv.grand_total === null || inv.grand_total === undefined ? '' : String(Number(inv.grand_total));
          return (
            inv.invoice_number?.toLowerCase().includes(needle) ||
            inv.customer_name?.toLowerCase().includes(needle) ||
            (amount !== '' && amount.includes(needle))
          );
        })
      : scoped;
    if (!remote) return local;
    const scopedRemote = customerId ? remote.filter((inv) => !inv.customer_id || inv.customer_id === customerId) : remote;
    return [...local, ...scopedRemote.filter((r) => !local.some((l) => l.id === r.id))];
  }, [scoped, remote, needle, customerId]);

  useEffect(() => {
    setActive(0);
  }, [needle, open]);

  useEffect(() => {
    if (!open) return;
    function place() {
      const el = buttonRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const width = Math.max(rect.width, 280);
      const left = Math.min(rect.left, Math.max(8, window.innerWidth - width - 8));
      const below = window.innerHeight - rect.bottom;
      if (below < MENU_MAX_HEIGHT && rect.top > below) {
        setBox({ bottom: window.innerHeight - rect.top + 4, left, width });
      } else {
        setBox({ top: rect.bottom + 4, left, width });
      }
    }
    place();
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function choose(id: string) {
    onChange(id);
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(matches.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const pick = matches[active];
      if (pick) choose(pick.id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    }
  }

  const showCustomer = !customerId;
  const selectedLabel = selected
    ? [selected.invoice_number, showCustomer ? selected.customer_name : formatAmount(selected.grand_total)]
        .filter(Boolean)
        .join(' · ')
    : '';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        ref={buttonRef}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => {
          setQuery('');
          setOpen((current) => !current);
        }}
        className={
          buttonClassName ||
          'flex w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-400 dark:border-gray-600 dark:bg-gray-900'
        }
      >
        <span className={selected ? 'truncate text-gray-900 dark:text-gray-100' : 'truncate text-gray-500'}>
          {selectedLabel || (value ? 'Loading…' : placeholder)}
        </span>
        <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-gray-400" />
      </button>
      {required && (
        <input
          tabIndex={-1}
          aria-hidden="true"
          required
          value={value}
          onChange={() => undefined}
          onFocus={() => buttonRef.current?.focus()}
          className="pointer-events-none absolute bottom-0 left-1/2 h-px w-px opacity-0"
        />
      )}
      {open &&
        box &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: 'fixed', top: box.top, bottom: box.bottom, left: box.left, width: box.width, zIndex: 80 }}
            className="flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900"
          >
            <div className="relative border-b border-gray-100 p-2 dark:border-gray-800">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                autoFocus
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder={showCustomer ? 'Search invoice number or customer' : 'Search invoice number or amount'}
                aria-label="Search invoices"
                className="w-full rounded-md border border-gray-300 py-2 pl-8 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-950"
              />
              {searching && (
                <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" />
              )}
            </div>
            <div ref={listRef} role="listbox" className="overflow-y-auto" style={{ maxHeight: MENU_MAX_HEIGHT - 60 }}>
              {value && !needle && (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 border-b border-gray-100 px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-800"
                  onClick={() => choose('')}
                >
                  <X className="h-3.5 w-3.5" />
                  Clear selection
                </button>
              )}
              {matches.map((inv, index) => {
                const meta = [showCustomer ? inv.customer_name : null, formatDate(inv.invoice_date)]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <button
                    key={inv.id}
                    type="button"
                    role="option"
                    data-index={index}
                    aria-selected={inv.id === value}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => choose(inv.id)}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${
                      index === active ? 'bg-primary-50 dark:bg-gray-800' : ''
                    } ${inv.id === value ? 'font-semibold' : ''}`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-gray-900 dark:text-gray-100">{inv.invoice_number}</span>
                      {meta && <span className="block truncate text-xs text-gray-500">{meta}</span>}
                    </span>
                    <span className="shrink-0 text-xs text-gray-600 dark:text-gray-400">{formatAmount(inv.grand_total)}</span>
                  </button>
                );
              })}
              {matches.length === 0 && (
                <p className="px-3 py-3 text-sm text-gray-500">
                  {searching
                    ? 'Searching…'
                    : needle
                      ? `No invoices match "${query.trim()}"`
                      : customerId
                        ? 'No invoices for this customer'
                        : 'No invoices yet'}
                </p>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
