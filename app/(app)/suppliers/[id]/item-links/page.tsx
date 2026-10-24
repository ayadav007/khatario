'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';
import { ItemMatchRow, type ItemMatchSuggestion, type ItemMatchValue } from '@/components/suppliers/ItemMatchRow';

type SavedLink = {
  id: string;
  vendor_item_id: string;
  vendor_item_name: string;
  vendor_unit: string | null;
  buyer_item_id: string;
  buyer_item_name: string;
  buyer_unit: string | null;
  factor: string | number;
  source: 'manual' | 'request' | 'conversion';
  last_rate: string | null;
};

type Unmatched = {
  vendor_item_id: string;
  vendor_item_name: string;
  vendor_unit: string | null;
  last_rate: string | null;
  suggestions: ItemMatchSuggestion[];
};

const SOURCE_LABEL: Record<SavedLink['source'], string> = {
  manual: 'Set by you',
  request: 'From a request',
  conversion: 'From a bill',
};

/**
 * The buyer's item map for one connected supplier: which of the supplier's items is which of
 * their own, and how many of their units are in one of the supplier's units.
 */
export default function SupplierItemLinksPage({ params }: { params: { id: string } }) {
  const toast = useToastContext();
  const [supplierName, setSupplierName] = useState('');
  const [links, setLinks] = useState<SavedLink[]>([]);
  const [unmatched, setUnmatched] = useState<Unmatched[]>([]);
  const [choices, setChoices] = useState<Record<string, ItemMatchValue | null>>({});
  const [factors, setFactors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/suppliers/${params.id}/item-links`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load the item map');
      setSupplierName(data.supplier?.name || '');
      setLinks(data.links || []);
      setUnmatched(data.unmatched || []);
      setChoices({});
      setFactors({});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load the item map');
    } finally {
      setLoading(false);
    }
  }, [params.id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (vendorItemId: string, buyerItemId: string, factor: string, key: string) => {
    setBusy(key);
    try {
      const res = await fetch(`/api/suppliers/${params.id}/item-links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendor_item_id: vendorItemId, buyer_item_id: buyerItemId, factor: Number(factor) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      toast.success('Saved');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (link: SavedLink) => {
    if (!confirm(`Forget that "${link.vendor_item_name}" is your "${link.buyer_item_name}"?`)) return;
    setBusy(link.id);
    try {
      const res = await fetch(`/api/suppliers/${params.id}/item-links?link_id=${link.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to remove');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to remove');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={supplierName ? `Item matches with ${supplierName}` : 'Item matches'}
        subtitle="Which of the supplier's items is which of yours, and how many of yours come in one of theirs. Their bills use these to add the right stock."
        actions={
          <Link href={`/suppliers/${params.id}`}>
            <Button variant="secondary">Back to supplier</Button>
          </Link>
        }
      />

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-primary-500" />
        </div>
      ) : (
        <>
          <Card padding="md">
            <h2 className="font-semibold text-text-primary">Needs a match ({unmatched.length})</h2>
            <p className="text-sm text-text-secondary">Items you have seen from this supplier on bills, requests or their catalog.</p>
            {unmatched.length === 0 ? (
              <p className="py-6 text-center text-sm text-text-secondary">Nothing waiting.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {unmatched.map((u) => {
                  const choice = choices[u.vendor_item_id] ?? null;
                  return (
                    <li key={u.vendor_item_id}>
                      <ItemMatchRow
                        vendorName={u.vendor_item_name}
                        vendorUnit={u.vendor_unit}
                        detail={u.last_rate ? `last rate ₹${Number(u.last_rate).toLocaleString('en-IN')}` : undefined}
                        suggestions={u.suggestions}
                        value={choice}
                        onChange={(v) => setChoices((prev) => ({ ...prev, [u.vendor_item_id]: v }))}
                      />
                      {choice && (
                        <div className="pb-3">
                          <Button
                            size="sm"
                            disabled={busy === u.vendor_item_id || !(Number(choice.factor) > 0)}
                            onClick={() => save(u.vendor_item_id, choice.itemId, choice.factor, u.vendor_item_id)}
                          >
                            Save match
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <Card padding="md">
            <h2 className="font-semibold text-text-primary">Matched ({links.length})</h2>
            {links.length === 0 ? (
              <p className="py-6 text-center text-sm text-text-secondary">No matches yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {links.map((l) => {
                  const f = factors[l.id] ?? String(Number(l.factor));
                  const changed = Number(f) !== Number(l.factor);
                  return (
                    <li key={l.id} className="flex flex-col gap-2 py-3 md:flex-row md:items-center">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-text-primary">
                          <span className="font-medium">{l.vendor_item_name}</span>
                          <span className="text-text-secondary"> is your </span>
                          <span className="font-medium">{l.buyer_item_name}</span>
                        </p>
                        <p className="text-xs text-text-secondary">{SOURCE_LABEL[l.source]}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="text-text-secondary">1 {l.vendor_unit || 'supplier unit'} =</span>
                        <input
                          type="number"
                          min={0}
                          step="any"
                          inputMode="decimal"
                          className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm"
                          value={f}
                          onChange={(e) => setFactors((prev) => ({ ...prev, [l.id]: e.target.value }))}
                        />
                        <span className="text-text-secondary">{l.buyer_unit || 'units'}</span>
                        {changed && (
                          <Button
                            size="sm"
                            disabled={busy === l.id || !(Number(f) > 0)}
                            onClick={() => save(l.vendor_item_id, l.buyer_item_id, f, l.id)}
                          >
                            Save
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" disabled={busy === l.id} onClick={() => remove(l)}>
                          Remove
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
