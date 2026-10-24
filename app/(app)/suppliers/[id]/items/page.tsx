'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToastContext } from '@/contexts/ToastContext';

type Row = {
  id: string;
  name: string;
  code: string | null;
  unit: string | null;
  current_stock: string | number;
  min_stock: string | number;
  has_variants: boolean;
  default_supplier_id: string | null;
  default_supplier_name: string | null;
  last_purchased: string | null;
};

type Filter = 'all' | 'purchased' | 'assigned' | 'unassigned';

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'purchased', label: 'Bought from this supplier' },
  { key: 'assigned', label: 'Already assigned' },
  { key: 'unassigned', label: 'No default supplier' },
  { key: 'all', label: 'All items' },
];

/**
 * Choose which items this supplier supplies by default, and set each item's reorder level.
 * Low-stock alerts reach a connected supplier only for items assigned here with a reorder level.
 */
export default function SupplierItemsPage({ params }: { params: { id: string } }) {
  const toast = useToastContext();
  const [supplierName, setSupplierName] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [limit, setLimit] = useState(0);
  const [filter, setFilter] = useState<Filter>('purchased');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Pending edits, keyed by item id
  const [assigned, setAssigned] = useState<Record<string, boolean>>({});
  const [levels, setLevels] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ filter });
      if (q.trim()) qs.set('q', q.trim());
      const res = await fetch(`/api/suppliers/${params.id}/items?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load items');
      setSupplierName(data.supplier?.name || '');
      setRows(data.items || []);
      setLimit(data.limit || 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load items');
    } finally {
      setLoading(false);
    }
  }, [params.id, filter, q, toast]);

  useEffect(() => {
    const t = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const isAssigned = (r: Row) => assigned[r.id] ?? r.default_supplier_id === params.id;
  const levelOf = (r: Row) => levels[r.id] ?? String(Number(r.min_stock) || '');

  const changes = useMemo(() => {
    const assign: string[] = [];
    const unassign: string[] = [];
    const min_stock: Record<string, number> = {};
    for (const r of rows) {
      const was = r.default_supplier_id === params.id;
      if (assigned[r.id] !== undefined && assigned[r.id] !== was) {
        (assigned[r.id] ? assign : unassign).push(r.id);
      }
      if (levels[r.id] !== undefined && !r.has_variants) {
        const next = Number(levels[r.id] || 0);
        if (Number.isFinite(next) && next >= 0 && next !== Number(r.min_stock)) min_stock[r.id] = next;
      }
    }
    return { assign, unassign, min_stock };
  }, [rows, assigned, levels, params.id]);

  const changeCount = changes.assign.length + changes.unassign.length + Object.keys(changes.min_stock).length;

  const setAllVisible = (value: boolean) => {
    setAssigned((prev) => {
      const next = { ...prev };
      for (const r of rows) next[r.id] = value;
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/suppliers/${params.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      toast.success('Saved');
      setAssigned({});
      setLevels({});
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={supplierName ? `Items from ${supplierName}` : 'Items from this supplier'}
        subtitle="Tick the items this supplier supplies and set a reorder level. When stock falls to that level, a connected supplier is alerted."
        actions={
          <>
            <Link href={`/suppliers/${params.id}`}>
              <Button variant="secondary">Back to supplier</Button>
            </Link>
            <Button onClick={save} disabled={saving || changeCount === 0}>
              {saving ? 'Saving…' : changeCount ? `Save ${changeCount} change${changeCount === 1 ? '' : 's'}` : 'Save'}
            </Button>
          </>
        }
      />

      <Card padding="md">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <Button
                key={f.key}
                size="sm"
                variant={filter === f.key ? 'primary' : 'ghost'}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </Button>
            ))}
          </div>
          <div className="w-full md:w-72">
            <Input placeholder="Search name or code" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <Button size="sm" variant="ghost" onClick={() => setAllVisible(true)} disabled={!rows.length}>
            Tick all shown
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAllVisible(false)} disabled={!rows.length}>
            Untick all shown
          </Button>
          {limit > 0 && rows.length >= limit && (
            <span className="text-xs text-text-secondary">Showing the first {limit}. Search to narrow down.</span>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-text-secondary">
            {filter === 'purchased' ? 'No purchases from this supplier yet. Try "All items".' : 'No items found.'}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-gray-100">
            {rows.map((r) => {
              const otherSupplier =
                r.default_supplier_id && r.default_supplier_id !== params.id ? r.default_supplier_name : null;
              const stock = Number(r.current_stock);
              const level = Number(levelOf(r) || 0);
              const low = isAssigned(r) && level > 0 && stock <= level;
              return (
                <li key={r.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-primary-600"
                      checked={isAssigned(r)}
                      onChange={(e) => setAssigned((prev) => ({ ...prev, [r.id]: e.target.checked }))}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-text-primary">{r.name}</span>
                      <span className="block text-xs text-text-secondary">
                        {[r.code, `In stock ${stock}${r.unit ? ` ${r.unit}` : ''}`].filter(Boolean).join(' · ')}
                        {r.last_purchased ? ` · Last bought ${new Date(r.last_purchased).toLocaleDateString('en-IN')}` : ''}
                      </span>
                      {otherSupplier && (
                        <span className="block text-xs text-amber-700">
                          Now from {otherSupplier}. Ticking moves it to this supplier.
                        </span>
                      )}
                      {low && <span className="block text-xs font-medium text-red-600">At or below reorder level</span>}
                    </span>
                  </label>
                  <div className="flex items-center gap-2 pl-7 sm:pl-0">
                    {r.has_variants ? (
                      <span className="text-xs text-text-secondary">Reorder levels per size/colour come later</span>
                    ) : (
                      <>
                        <span className="text-xs text-text-secondary">Reorder at</span>
                        <input
                          type="number"
                          min={0}
                          inputMode="decimal"
                          className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm"
                          value={levelOf(r)}
                          placeholder="0"
                          onChange={(e) => setLevels((prev) => ({ ...prev, [r.id]: e.target.value }))}
                        />
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
