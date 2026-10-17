'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Loader2, Search } from 'lucide-react';
import { HubSheet } from './HubSheet';

type Partner = { supplierId: string; name: string; city: string | null };

/** Pick one of the connected suppliers to order from. Search shows once the list is long. */
export function NewOrderSheet({
  open,
  onClose,
  partners,
  loading = false,
}: {
  open: boolean;
  onClose: () => void;
  partners: Partner[];
  loading?: boolean;
}) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? partners.filter((p) => `${p.name} ${p.city || ''}`.toLowerCase().includes(t)) : partners;
  }, [partners, q]);

  return (
    <HubSheet open={open} onClose={onClose} title="New order" subtitle="Who are you ordering from?">
      {loading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
        </div>
      ) : partners.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-sm text-text-secondary">You have no connected suppliers yet.</p>
          <Link href="/suppliers/hub/find" className="mt-3 inline-block text-sm font-medium text-primary-600 hover:underline" onClick={onClose}>
            Find your supplier
          </Link>
        </div>
      ) : (
        <>
          {partners.length > 6 && (
            <label className="relative mb-3 block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search suppliers"
                className="w-full rounded-lg border border-gray-300 py-2.5 pl-9 pr-3 text-sm"
              />
            </label>
          )}
          <ul className="divide-y divide-gray-100">
            {shown.map((p) => (
              <li key={p.supplierId}>
                <Link
                  href={`/supply-orders/new?supplier_id=${p.supplierId}`}
                  onClick={onClose}
                  className="flex items-center gap-3 py-3 hover:bg-gray-50"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-50 text-sm font-semibold text-primary-700">
                    {p.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-text-primary">{p.name}</span>
                    {p.city && <span className="block text-xs text-text-secondary">{p.city}</span>}
                  </span>
                  <ChevronRight className="h-4 w-4 text-text-muted" />
                </Link>
              </li>
            ))}
            {shown.length === 0 && <li className="py-4 text-center text-sm text-text-secondary">No match.</li>}
          </ul>
        </>
      )}
    </HubSheet>
  );
}
