'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { ItemAutocomplete } from '@/components/ui/ItemAutocomplete';
import { useToastContext } from '@/contexts/ToastContext';

type Collection = {
  id: string;
  name: string;
  season: string | null;
  status: 'draft' | 'published' | 'archived';
  audience: 'linked_only' | 'public_preview';
  published_at: string | null;
  item_count: number;
  buyers_ordered: number | null;
  units_ordered: number | null;
};

type Listing = {
  id: string;
  item_id: string;
  item_name: string;
  item_unit: string;
  display_name: string | null;
  audience: 'linked_only' | 'public_preview';
  is_active: boolean;
  price: string | null;
  moq: string | null;
  order_multiple: string | null;
  pack_label: string | null;
  lead_time_text: string | null;
  image_url: string | null;
  collection_id: string | null;
  options?: Array<{ id: string; label: string; price: string | number | null }>;
};

type Draft = Partial<
  Record<'display_name' | 'price' | 'moq' | 'order_multiple' | 'pack_label' | 'lead_time_text' | 'image_url' | 'collection_id' | 'options', string>
> & {
  is_active?: boolean;
};

const FIELDS: Array<{ key: keyof Draft; label: string; type?: string; width: string }> = [
  { key: 'display_name', label: 'Name shown', width: 'w-48' },
  { key: 'price', label: 'Price (₹)', type: 'number', width: 'w-24' },
  { key: 'moq', label: 'Min order', type: 'number', width: 'w-20' },
  { key: 'order_multiple', label: 'In multiples of', type: 'number', width: 'w-20' },
  { key: 'pack_label', label: 'Pack', width: 'w-44' },
  { key: 'lead_time_text', label: 'Lead time', width: 'w-28' },
  { key: 'options', label: 'Sizes / colours with price (S:450, M:450, L:480)', width: 'w-72' },
];

/** Options as typed on this screen: "S:450, M:450, Red". */
const optionsText = (options: Listing['options']) =>
  (options || []).map((o) => (o.price == null ? o.label : `${o.label}:${Number(o.price)}`)).join(', ');

/** Scale a photo to at most 1200 px and JPEG, so it stays under the 600 KB limit. */
async function photoDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.82, 0.7, 0.55]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length < 780_000) return url;
  }
  throw new Error('This photo is too large even after scaling. Try a smaller one.');
}

/**
 * The supplier's catalog for connected buyers: collections of new designs (publishing one
 * notifies every connected buyer once) and each listed item's price, MOQ, pack and photo.
 */
export default function SupplierCatalogPage() {
  const toast = useToastContext();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [newName, setNewName] = useState('');
  const [newSeason, setNewSeason] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cRes, lRes] = await Promise.all([
        fetch('/api/suppliers/hub/collections'),
        fetch('/api/suppliers/hub/published-listings'),
      ]);
      const [c, l] = await Promise.all([cRes.json(), lRes.json()]);
      if (!cRes.ok) throw new Error(c.error || 'Failed to load collections');
      if (!lRes.ok) throw new Error(l.error || 'Failed to load listings');
      setCollections(c.collections || []);
      setListings(l.listings || []);
      setDrafts({});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load the catalog');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<Response>, ok: (data: any) => string) => {
    setBusy(true);
    try {
      const res = await fn();
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed');
      toast.success(ok(data));
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  const json = (method: string, body: object) => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const createCollection = () =>
    run(
      () => fetch('/api/suppliers/hub/collections', json('POST', { name: newName, season: newSeason })),
      () => {
        setNewName('');
        setNewSeason('');
        return 'Collection created';
      }
    );

  const collectionAction = (c: Collection, action: 'publish' | 'archive') =>
    run(
      () => fetch(`/api/suppliers/hub/collections/${c.id}`, json('PATCH', { action })),
      (d) => (action === 'publish' ? `Published. ${d.notified ?? 0} connected buyer(s) notified.` : 'Archived')
    );

  const deleteCollection = (c: Collection) => {
    if (!confirm(`Delete ${c.name}? Its items stay in your catalog.`)) return;
    run(() => fetch(`/api/suppliers/hub/collections/${c.id}`, { method: 'DELETE' }), () => 'Deleted');
  };

  const addItem = (itemId: string) =>
    run(
      () =>
        fetch(
          '/api/suppliers/hub/published-listings',
          json('POST', { item_id: itemId, audience: 'linked_only', collection_id: filter || null })
        ),
      () => 'Added to catalog'
    );

  const saveListing = (l: Listing) => {
    const d: Record<string, unknown> = { ...(drafts[l.id] || {}) };
    for (const k of ['price', 'moq', 'order_multiple'] as const) {
      if (d[k] === '') d[k] = null;
    }
    run(() => fetch(`/api/suppliers/hub/published-listings/${l.id}`, json('PATCH', d)), () => 'Saved');
  };

  const removeListing = (l: Listing) => {
    if (!confirm(`Remove ${l.display_name || l.item_name} from your catalog?`)) return;
    run(() => fetch(`/api/suppliers/hub/published-listings/${l.id}`, { method: 'DELETE' }), () => 'Removed');
  };

  const shown = listings.filter((l) => (filter ? l.collection_id === filter : true));
  const val = (l: Listing, k: keyof Draft) => {
    const d = drafts[l.id]?.[k];
    if (d !== undefined) return String(d);
    if (k === 'options') return optionsText(l.options);
    const v = (l as any)[k];
    return v == null ? '' : String(k === 'price' || k === 'moq' || k === 'order_multiple' ? Number(v) : v);
  };
  const setVal = (id: string, k: keyof Draft, v: string | boolean) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [k]: v } }));

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="My catalog"
        subtitle="What connected buyers can order from you. Group new designs into a collection and publish it to tell every connected buyer at once."
        actions={
          <Link href="/settings/suppliers-directory">
            <Button variant="secondary">Directory settings</Button>
          </Link>
        }
      />

      <Card padding="md" className="space-y-3">
        <h2 className="font-semibold text-text-primary">Collections</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-text-secondary">
            Name
            <input
              className="mt-1 block w-56 rounded-md border border-gray-300 px-2 py-1 text-sm"
              placeholder="Summer 2027 kurtis"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </label>
          <label className="text-xs text-text-secondary">
            Season (optional)
            <input
              className="mt-1 block w-36 rounded-md border border-gray-300 px-2 py-1 text-sm"
              value={newSeason}
              onChange={(e) => setNewSeason(e.target.value)}
            />
          </label>
          <Button size="sm" onClick={createCollection} disabled={busy || !newName.trim()}>
            New collection
          </Button>
        </div>
        {collections.length === 0 ? (
          <p className="text-sm text-text-secondary">No collections yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {collections.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setFilter(filter === c.id ? '' : c.id)}>
                  <p className={`truncate font-medium ${filter === c.id ? 'text-primary-700' : 'text-text-primary'}`}>
                    {c.name}
                    {c.season ? ` · ${c.season}` : ''}
                  </p>
                  <p className="text-xs text-text-secondary">
                    {c.item_count} item{c.item_count === 1 ? '' : 's'}
                    {c.published_at
                      ? ` · ordered by ${c.buyers_ordered ?? 0} buyer(s), ${Number(c.units_ordered ?? 0).toLocaleString('en-IN')} units`
                      : ''}
                    {filter === c.id ? ' · showing its items below' : ' · tap to see its items'}
                  </p>
                </button>
                <div className="flex items-center gap-2">
                  <Chip variant={c.status === 'published' ? 'success' : c.status === 'draft' ? 'warning' : 'secondary'}>
                    {c.status === 'published' ? 'Published' : c.status === 'draft' ? 'Draft' : 'Archived'}
                  </Chip>
                  {c.status !== 'published' && (
                    <Button size="sm" onClick={() => collectionAction(c, 'publish')} disabled={busy || c.item_count === 0}>
                      {c.published_at ? 'Republish' : 'Publish and notify buyers'}
                    </Button>
                  )}
                  {c.status === 'published' && (
                    <Button size="sm" variant="ghost" onClick={() => collectionAction(c, 'archive')} disabled={busy}>
                      Archive
                    </Button>
                  )}
                  {c.status === 'draft' && !c.published_at && (
                    <Button size="sm" variant="ghost" onClick={() => deleteCollection(c)} disabled={busy}>
                      Delete
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card padding="md" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-text-primary">
            {filter ? `Items in ${collections.find((c) => c.id === filter)?.name || 'collection'}` : 'All catalog items'}
          </h2>
          {filter && (
            <Button size="sm" variant="ghost" onClick={() => setFilter('')}>
              Show all
            </Button>
          )}
        </div>
        <ItemAutocomplete
          value={query}
          onChange={setQuery}
          placeholder={filter ? 'Add one of your items to this collection' : 'Add one of your items to the catalog'}
          onSelect={(item) => {
            setQuery('');
            addItem(item.id);
          }}
        />
        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-secondary">No items here yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {shown.map((l) => (
              <li key={l.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-text-primary">
                    {l.item_name} <span className="text-xs text-text-secondary">({l.item_unit})</span>
                  </p>
                  <div className="flex items-center gap-2 text-xs">
                    <select
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs"
                      value={val(l, 'collection_id')}
                      onChange={(e) => setVal(l.id, 'collection_id', e.target.value)}
                    >
                      <option value="">No collection</option>
                      {collections
                        .filter((c) => c.status !== 'archived')
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={drafts[l.id]?.is_active ?? l.is_active}
                        onChange={(e) => setVal(l.id, 'is_active', e.target.checked)}
                      />
                      Listed
                    </label>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {FIELDS.map((f) => (
                    <label key={f.key} className="text-xs text-text-secondary">
                      {f.label}
                      <input
                        type={f.type || 'text'}
                        min={f.type === 'number' ? 0 : undefined}
                        step={f.type === 'number' ? 'any' : undefined}
                        className={`mt-1 block ${f.width} rounded-md border border-gray-300 px-2 py-1 text-sm`}
                        value={val(l, f.key)}
                        onChange={(e) => setVal(l.id, f.key, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {(drafts[l.id]?.image_url ?? l.image_url) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={(drafts[l.id]?.image_url ?? l.image_url) || ''}
                      alt=""
                      className="h-14 w-14 rounded-md border border-gray-200 object-cover"
                    />
                  )}
                  <label className="cursor-pointer text-sm font-medium text-primary-600 hover:underline">
                    {(drafts[l.id]?.image_url ?? l.image_url) ? 'Change photo' : 'Add photo'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        try {
                          setVal(l.id, 'image_url', await photoDataUrl(file));
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : 'Could not use this photo');
                        }
                      }}
                    />
                  </label>
                  {(drafts[l.id]?.image_url ?? l.image_url) && (
                    <button type="button" className="text-sm text-text-secondary hover:underline" onClick={() => setVal(l.id, 'image_url', '')}>
                      Remove photo
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => saveListing(l)} disabled={busy || !drafts[l.id]}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => removeListing(l)} disabled={busy}>
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
