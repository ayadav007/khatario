'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { useToastContext } from '@/contexts/ToastContext';
import { SUPPLY_ORDER_STATUS_LABEL, supplyOrderChipVariant } from '@/components/suppliers/supplyOrderStatus';
import { NewOrderSheet } from '@/components/suppliers/hub/NewOrderSheet';
import { createLatestRequest } from '@/lib/latest-request';

type Row = {
  id: string;
  status: string;
  origin: string;
  need_by: string | null;
  updated_at: string;
  other_business_name: string;
  line_count: number;
  invoice_number: string | null;
};

const GROUPS = [
  { key: 'action', label: 'Needs you' },
  { key: 'open', label: 'Open' },
  { key: 'done', label: 'Done' },
  { key: 'all', label: 'All' },
] as const;

/** Orders with connected suppliers (buying) and connected buyers (selling). */
export default function SupplyOrdersPage() {
  const toast = useToastContext();
  const [role, setRole] = useState<'buyer' | 'vendor'>('buyer');
  const [group, setGroup] = useState<(typeof GROUPS)[number]['key']>('action');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [partners, setPartners] = useState<{ supplierId: string; name: string; city: string | null }[] | null>(null);

  const openNewOrder = async () => {
    setNewOrderOpen(true);
    if (partners) return;
    try {
      const res = await fetch('/api/suppliers/hub/home');
      const data = await res.json();
      setPartners(res.ok ? data.buying?.partners || [] : []);
    } catch {
      setPartners([]);
    }
  };

  useEffect(() => {
    try {
      // A link (e.g. a low-stock notification) can pick the side; otherwise use the last one used.
      const fromUrl = new URLSearchParams(window.location.search).get('role');
      const saved = fromUrl || localStorage.getItem('supply-orders-role');
      if (saved === 'vendor' || saved === 'buyer') setRole(saved);
    } catch {
      /* storage unavailable */
    }
  }, []);

  // The side can switch (URL, saved choice, buttons) while a fetch is in flight; only the latest
  // request may fill the list, or the default side's empty answer overwrites the right one.
  const latest = useRef(createLatestRequest());
  const load = useCallback(async () => {
    const request = latest.current.start();
    setLoading(true);
    try {
      const res = await fetch(`/api/supply-orders?role=${role}&group=${group}`);
      const data = await res.json();
      if (!latest.current.isLatest(request)) return;
      if (!res.ok) throw new Error(data.error || 'Failed to load orders');
      setRows(data.orders || []);
    } catch (e) {
      if (!latest.current.isLatest(request)) return;
      toast.error(e instanceof Error ? e.message : 'Failed to load orders');
    } finally {
      if (latest.current.isLatest(request)) setLoading(false);
    }
  }, [role, group, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const switchRole = (r: 'buyer' | 'vendor') => {
    setRole(r);
    try {
      localStorage.setItem('supply-orders-role', r);
    } catch {
      /* storage unavailable */
    }
  };

  const refreshSuggestions = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/supply-orders/suggest', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed');
      toast.success(data.lines ? `${data.lines} low item${data.lines === 1 ? '' : 's'} added to suggested orders` : 'No new low items');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Supplier orders"
        subtitle={role === 'buyer' ? 'Orders you place with your suppliers.' : 'Orders from the shops you supply.'}
        actions={
          role === 'vendor' ? (
            <Button variant="secondary" onClick={refreshSuggestions} disabled={refreshing}>
              {refreshing ? 'Checking…' : 'Check buyers’ low stock'}
            </Button>
          ) : (
            <Button onClick={openNewOrder}>New order</Button>
          )
        }
      />

      <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
        <div className="inline-flex shrink-0 rounded-lg border border-gray-200 p-0.5">
          <Button size="sm" variant={role === 'buyer' ? 'primary' : 'ghost'} onClick={() => switchRole('buyer')}>
            Buying
          </Button>
          <Button size="sm" variant={role === 'vendor' ? 'primary' : 'ghost'} onClick={() => switchRole('vendor')}>
            Selling
          </Button>
        </div>
        {GROUPS.map((g) => (
          <Button key={g.key} size="sm" className="shrink-0" variant={group === g.key ? 'secondary' : 'ghost'} onClick={() => setGroup(g.key)}>
            {g.label}
          </Button>
        ))}
      </div>

      <Card padding="md">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-text-secondary">
              {group === 'action' ? 'Nothing needs you right now.' : 'No orders here.'}
            </p>
            {group === 'action' && (
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => setGroup('open')}>
                See open orders
              </Button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/supply-orders/${o.id}`}
                  className="flex flex-col gap-1 py-3 hover:bg-gray-50 sm:flex-row sm:items-center sm:gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-text-primary">{o.other_business_name}</p>
                    <p className="text-xs text-text-secondary">
                      {o.line_count} item{o.line_count === 1 ? '' : 's'}
                      {o.origin === 'suggested' ? ' · suggested from low stock' : ''}
                      {o.need_by ? ` · needed by ${new Date(o.need_by).toLocaleDateString('en-IN')}` : ''}
                      {o.invoice_number ? ` · bill ${o.invoice_number}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Chip variant={supplyOrderChipVariant(o.status)}>{SUPPLY_ORDER_STATUS_LABEL[o.status] ?? o.status}</Chip>
                    <span className="text-xs text-text-secondary">{new Date(o.updated_at).toLocaleDateString('en-IN')}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <NewOrderSheet open={newOrderOpen} onClose={() => setNewOrderOpen(false)} partners={partners || []} loading={!partners} />
    </div>
  );
}
