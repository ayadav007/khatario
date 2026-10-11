'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Briefcase, ChevronDown, Loader2, Check, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';

export type MyBusinessOption = {
  id: string;
  name: string;
  role: string;
};

function formatRoleLabel(role: string): string {
  if (!role) return '';
  return role
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

async function fetchMyBusinesses(): Promise<MyBusinessOption[]> {
  const res = await fetch('/api/businesses/my', { credentials: 'same-origin' });
  if (!res.ok) return [];
  const data = (await res.json()) as { businesses?: unknown };
  const list = data.businesses;
  if (!Array.isArray(list)) return [];
  return list
    .filter(
      (b): b is MyBusinessOption =>
        b !== null &&
        typeof b === 'object' &&
        typeof (b as MyBusinessOption).id === 'string' &&
        typeof (b as MyBusinessOption).name === 'string'
    )
    .map((b) => ({
      id: (b as MyBusinessOption).id,
      name: (b as MyBusinessOption).name,
      role: typeof (b as MyBusinessOption).role === 'string' ? (b as MyBusinessOption).role : '',
    }));
}

export interface BusinessSwitcherProps {
  /** Wider touch row on small screens (matches branch strip). */
  mobile?: boolean;
}

/**
 * Lists businesses from GET /api/businesses/my and switches tenant via POST /api/businesses/switch.
 * Hidden when the user has at most one membership.
 */
export function BusinessSwitcher({ mobile }: BusinessSwitcherProps) {
  const { business, isPrimaryAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [items, setItems] = useState<MyBusinessOption[]>([]);
  const [adding, setAdding] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addError, setAddError] = useState('');
  const [draft, setDraft] = useState({ businessName: '', businessType: 'retail', industry: 'other' });
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const businesses = await fetchMyBusinesses();
        if (!cancelled) setItems(businesses);
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current && !rootRef.current.contains(t)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const activeId = business?.id ?? null;

  const onSelect = useCallback(
    async (selectedId: string) => {
      if (switching || selectedId === activeId) {
        setOpen(false);
        return;
      }
      setSwitching(true);
      setOpen(false);
      try {
        const res = await fetch('/api/businesses/switch', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ business_id: selectedId }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg =
            typeof body?.error === 'string' ? body.error : 'Could not switch business';
          toast.error(msg);
          return;
        }
        window.location.reload();
      } catch {
        toast.error('Network error while switching business');
      } finally {
        setSwitching(false);
      }
    },
    [activeId, switching]
  );

  const onAdd = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (adding) return;
      setAdding(true);
      setAddError('');
      try {
        const res = await fetch('/api/businesses', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            businessName: draft.businessName,
            businessType: draft.businessType,
            industry: draft.industry,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setAddError(typeof body?.error === 'string' ? body.error : 'Could not add the business');
          return;
        }
        window.location.assign('/dashboard');
      } catch {
        setAddError('Network error while adding the business');
      } finally {
        setAdding(false);
      }
    },
    [adding, draft.businessName, draft.businessType, draft.industry],
  );

  if (listLoading || (items.length <= 1 && !isPrimaryAdmin)) {
    return null;
  }

  const current = activeId ? items.find((b) => b.id === activeId) : undefined;
  const label = current?.name ?? business?.name ?? 'Business';

  const inner = (
    <div className="relative w-full" ref={rootRef}>
      <button
        type="button"
        disabled={switching}
        onClick={() => !switching && setOpen((v) => !v)}
        className={
          mobile
            ? 'flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left text-sm font-medium text-text-primary hover:bg-slate-100/50 dark:hover:bg-slate-800/80 disabled:cursor-not-allowed disabled:opacity-60'
            : 'flex max-w-[14rem] items-center gap-2 rounded-lg border border-border px-3 py-1.5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/80 disabled:cursor-not-allowed disabled:opacity-60'
        }
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Switch company"
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {switching ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary-600" aria-hidden />
          ) : (
            <Briefcase className="h-4 w-4 shrink-0 text-text-secondary" aria-hidden />
          )}
          <span className="min-w-0 flex-1">
            <span
              className={
                mobile
                  ? 'block truncate font-medium text-text-primary'
                  : 'block truncate text-sm font-medium text-text-primary'
              }
            >
              {label}
            </span>
            {current?.role ? (
              <span className="block truncate text-xs text-text-muted">{formatRoleLabel(current.role)}</span>
            ) : null}
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-text-secondary transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {open && !switching && (
        <div
          className={
            mobile
              ? 'absolute left-0 right-0 top-full z-[60] mt-2 max-h-96 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg'
              : 'absolute left-0 top-full z-[60] mt-2 w-72 max-h-96 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg lg:left-auto lg:right-0'
          }
          role="listbox"
          aria-label="Companies"
        >
          <div className="p-2">
            {items.map((b) => {
              const isActive = b.id === activeId;
              return (
                <button
                  key={b.id}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => onSelect(b.id)}
                  className={`flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    isActive
                      ? 'bg-slate-50 font-medium text-primary-700 dark:bg-slate-800/40 dark:text-primary-200'
                      : 'text-text-primary hover:bg-slate-100/80 dark:hover:bg-slate-800'
                  }`}
                >
                  <span className="mt-0.5 shrink-0">
                    {isActive ? (
                      <Check className="h-4 w-4 text-primary-600" aria-hidden />
                    ) : (
                      <Briefcase className="h-4 w-4 text-text-muted" aria-hidden />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{b.name}</span>
                    {b.role ? (
                      <span className="block truncate text-xs text-text-muted">{formatRoleLabel(b.role)}</span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
          {isPrimaryAdmin && (
            <div className="border-t border-border p-2">
              {showAdd ? (
                <form onSubmit={onAdd} className="space-y-2 px-1 py-1">
                  <p className="px-2 text-xs font-semibold uppercase tracking-wide text-text-muted">New business</p>
                  <input
                    required
                    value={draft.businessName}
                    onChange={(e) => setDraft((d) => ({ ...d, businessName: e.target.value }))}
                    placeholder="Business name"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-base"
                  />
                  <select
                    value={draft.businessType}
                    onChange={(e) => setDraft((d) => ({ ...d, businessType: e.target.value }))}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-base"
                  >
                    <option value="retail">Retail</option>
                    <option value="wholesaler">Wholesaler</option>
                    <option value="distributor">Distributor</option>
                    <option value="manufacturer">Manufacturer</option>
                    <option value="service">Service</option>
                    <option value="other">Other</option>
                  </select>
                  <select
                    value={draft.industry}
                    onChange={(e) => setDraft((d) => ({ ...d, industry: e.target.value }))}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-base"
                  >
                    <option value="pharmaceuticals">Pharmaceuticals</option>
                    <option value="textiles">Textiles</option>
                    <option value="garments">Garments</option>
                    <option value="electronics">Electronics</option>
                    <option value="food_beverages">Food & beverages</option>
                    <option value="automotive">Automotive</option>
                    <option value="construction">Construction</option>
                    <option value="services">Services</option>
                    <option value="other">Other</option>
                  </select>
                  {addError ? <p className="px-1 text-xs text-red-600">{addError}</p> : null}
                  <button
                    type="submit"
                    disabled={adding}
                    className="w-full rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                  >
                    {adding ? 'Creating…' : 'Create business'}
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowAdd(true)}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm font-medium text-primary-700 hover:bg-slate-100/80 dark:text-primary-200 dark:hover:bg-slate-800"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Add business
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (mobile) {
    return (
      <div className="border-b border-border bg-background/95 px-4 py-2 dark:bg-slate-900/40">
        {inner}
      </div>
    );
  }

  return inner;
}
