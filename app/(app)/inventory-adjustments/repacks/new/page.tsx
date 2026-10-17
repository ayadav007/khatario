'use client';

export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { format } from 'date-fns';
import { Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ItemAutocomplete } from '@/components/ui/ItemAutocomplete';
import { MobileDuplicatePageChrome } from '@/components/layout/MobileDuplicatePageChrome';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { useToastContext } from '@/contexts/ToastContext';
import { getApiErrorMessage, safeJsonParse } from '@/lib/api-utils';

type Side = {
  id: string;
  name: string;
  unit: string | null;
  stock: number;
  unit_cost?: number;
  pack_source_item_id: string | null;
  pack_source_qty: number | null;
};

type Prefill = {
  source: Side | null;
  packed: Side | null;
  content_per_unit: number | null;
  last: { source_qty: number; packed_qty: number; wastage_reason: string | null } | null;
  vendor_units: { unit: string; per: number }[];
};

type Location = { id: string; name: string };

const REASONS: { value: string; label: string }[] = [
  { value: 'SPILLAGE', label: 'Spillage' },
  { value: 'MOISTURE', label: 'Drying / moisture' },
  { value: 'PACKAGING', label: 'Packet weight' },
  { value: 'OTHER', label: 'Other' },
];

const num = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
const rupees = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function NewRepackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { business } = useAuth();
  const { currentBranchId } = useBranch();
  const toast = useToastContext();

  const [warehousesEnabled, setWarehousesEnabled] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState('');

  const [source, setSource] = useState<Side | null>(null);
  const [packed, setPacked] = useState<Side | null>(null);
  const [sourceSearch, setSourceSearch] = useState('');
  const [packedSearch, setPackedSearch] = useState('');
  const [savedContent, setSavedContent] = useState<number | null>(null);
  const [vendorUnits, setVendorUnits] = useState<Prefill['vendor_units']>([]);

  const [sourceQty, setSourceQty] = useState('');
  const [packedQty, setPackedQty] = useState('');
  const [content, setContent] = useState('');
  const [editContent, setEditContent] = useState(false);
  const [reason, setReason] = useState('SPILLAGE');
  const [wastageNotes, setWastageNotes] = useState('');
  const [date, setDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [notes, setNotes] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const branchId = !warehousesEnabled && currentBranchId && currentBranchId !== 'ALL' ? currentBranchId : '';

  useEffect(() => {
    if (!business?.id) return;
    (async () => {
      try {
        const [whRes, locRes] = await Promise.all([
          fetch(`/api/settings/warehouses?business_id=${business.id}`, { credentials: 'include' }),
          fetch(`/api/locations?business_id=${business.id}`, { credentials: 'include' }),
        ]);
        if (whRes.ok) setWarehousesEnabled(!!(await whRes.json()).warehouses_enabled);
        if (locRes.ok) {
          const list: Location[] = (await locRes.json()).locations || [];
          setLocations(list);
          if (list.length === 1) setLocationId(list[0].id);
        }
      } catch {
        /* optional */
      }
    })();
  }, [business?.id]);

  const loadPrefill = useCallback(
    async (itemId: string, otherItemId?: string, fillQuantities = true) => {
      setLoading(true);
      try {
        const q = new URLSearchParams({ item_id: itemId });
        if (otherItemId) q.set('other_item_id', otherItemId);
        if (warehousesEnabled && locationId) q.set('location_id', locationId);
        if (branchId) q.set('branch_id', branchId);
        const res = await fetch(`/api/inventory-adjustments/repacks/prefill?${q}`, { credentials: 'include' });
        const data = await safeJsonParse<Prefill & { error?: string }>(res);
        if (!res.ok || !data) {
          toast.error(getApiErrorMessage(data, 'Could not load the items'));
          return;
        }
        setSource(data.source);
        setPacked(data.packed);
        setSourceSearch(data.source?.name || '');
        setPackedSearch(data.packed?.name || '');
        setSavedContent(data.content_per_unit);
        setContent(data.content_per_unit ? fmt(data.content_per_unit) : '');
        setEditContent(!data.content_per_unit && !!data.packed);
        setVendorUnits(data.vendor_units || []);
        if (fillQuantities && data.last) {
          setSourceQty(fmt(data.last.source_qty));
          setPackedQty(fmt(data.last.packed_qty));
          if (data.last.wastage_reason) setReason(data.last.wastage_reason);
        }
      } finally {
        setLoading(false);
      }
    },
    [branchId, locationId, warehousesEnabled, toast]
  );

  const initialItem = searchParams.get('item_id');
  useEffect(() => {
    if (initialItem && business?.id) loadPrefill(initialItem);
    // Only on first load and when the place changes; item picks call loadPrefill themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialItem, business?.id, locationId, branchId]);

  const contentNum = num(content);
  const outQty = num(sourceQty);
  const madeQty = num(packedQty);
  const wastage = useMemo(() => Math.round((outQty - madeQty * contentNum) * 1000) / 1000, [outQty, madeQty, contentNum]);
  const wastagePct = outQty > 0 ? Math.round((wastage / outQty) * 1000) / 10 : 0;
  const costOut = outQty * (source?.unit_cost || 0);
  const perPack = madeQty > 0 ? costOut / madeQty : 0;
  const unit = source?.unit || '';
  const short = source ? outQty > source.stock + 1e-9 : false;

  const ready =
    !!source && !!packed && outQty > 0 && madeQty > 0 && contentNum > 0 && wastage >= 0 && !short &&
    (!warehousesEnabled || !!locationId);

  const pickSource = (item: { id: string }) => {
    if (packed && item.id !== packed.id) loadPrefill(item.id, packed.id);
    else loadPrefill(item.id);
  };
  const pickPacked = (item: { id: string }) => {
    if (!source) {
      loadPrefill(item.id);
      return;
    }
    if (item.id === source.id) {
      toast.error('Pick a different item to pack into');
      return;
    }
    loadPrefill(source.id, item.id);
  };

  const addVendorUnit = (per: number) => {
    const next = Math.round((outQty + per) * 1000) / 1000;
    setSourceQty(fmt(next));
    if (contentNum > 0 && !packedQty) setPackedQty(fmt(Math.floor(next / contentNum)));
  };

  const submit = async () => {
    if (!ready || !source || !packed) return;
    setSaving(true);
    try {
      const res = await fetch('/api/inventory-adjustments/repacks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          source_item_id: source.id,
          packed_item_id: packed.id,
          source_qty: outQty,
          packed_qty: madeQty,
          content_per_unit: contentNum,
          wastage_reason: wastage > 0 ? reason : null,
          wastage_notes: wastage > 0 && reason === 'OTHER' ? wastageNotes.trim() || null : null,
          notes: notes.trim() || null,
          repack_date: date,
          ...(warehousesEnabled ? { location_id: locationId } : branchId ? { branch_id: branchId } : {}),
        }),
      });
      const data = await safeJsonParse<{ repack?: { id: string; repackNumber: string }; error?: string }>(res);
      if (!res.ok || !data?.repack) {
        toast.error(getApiErrorMessage(data, 'Could not save the repack'));
        return;
      }
      toast.success(`${data.repack.repackNumber} saved: ${fmt(madeQty)} ${packed.name}`);
      router.push(`/inventory-adjustments/repacks/${data.repack.id}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <MobileDuplicatePageChrome
        title="Repack"
        description="Take stock out of a bulk item and put it into your own packs"
      />

      <Card>
        <div className="p-4 sm:p-6 space-y-5">
          {warehousesEnabled && (
            <div>
              <label className="type-label block mb-1.5">Warehouse</label>
              <select
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                <option value="">Select warehouse</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="type-label block mb-1.5">From</label>
            <ItemAutocomplete
              value={sourceSearch}
              onChange={setSourceSearch}
              onSelect={pickSource}
              placeholder="Bulk item, e.g. Rice"
              warehouseId={warehousesEnabled ? locationId || undefined : undefined}
            />
            {source && (
              <p className={`mt-1 text-xs ${short ? 'text-red-600' : 'text-gray-500'}`}>
                In stock {fmt(source.stock)} {unit}
              </p>
            )}
          </div>

          <div>
            <Input
              label={`Take out${unit ? ` (${unit})` : ''}`}
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={sourceQty}
              onChange={(e) => setSourceQty(e.target.value)}
              error={short ? `Only ${fmt(source?.stock || 0)} ${unit} in stock here` : undefined}
            />
            {vendorUnits.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {vendorUnits.map((v) => (
                  <button
                    key={`${v.unit}-${v.per}`}
                    type="button"
                    onClick={() => addVendorUnit(v.per)}
                    className="px-2.5 py-1 rounded-full border border-gray-300 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    + 1 {v.unit.toLowerCase()} ({fmt(v.per)} {unit.toLowerCase()})
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="type-label block mb-1.5">Into</label>
            <ItemAutocomplete
              value={packedSearch}
              onChange={setPackedSearch}
              onSelect={pickPacked}
              placeholder="Packed item, e.g. Rice 1 kg pack"
              warehouseId={warehousesEnabled ? locationId || undefined : undefined}
            />
            {packed && source && (
              <div className="mt-1 text-xs text-gray-500">
                {editContent ? null : (
                  <>
                    {fmt(contentNum)} {unit.toLowerCase()} each · in stock {fmt(packed.stock)}{' '}
                    <button type="button" className="text-primary-600 underline" onClick={() => setEditContent(true)}>
                      change
                    </button>
                  </>
                )}
              </div>
            )}
            {packed && source && editContent && (
              <div className="mt-2">
                <Input
                  label={`Each ${packed.name} holds (${unit || 'units'} of ${source.name})`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                />
                {!savedContent && (
                  <p className="mt-1 text-xs text-gray-500">Saved on the item, so you only enter this once.</p>
                )}
              </div>
            )}
          </div>

          <Input
            label="Made"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={packedQty}
            onChange={(e) => setPackedQty(e.target.value)}
          />

          {source && packed && outQty > 0 && madeQty > 0 && contentNum > 0 && (
            <div className="rounded-lg bg-gray-50 p-3 space-y-3 text-sm">
              {wastage < 0 ? (
                <p className="text-red-600">Packed more than you took out; check the numbers.</p>
              ) : wastage > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span>
                    Wastage <strong>{fmt(wastage)} {unit}</strong> ({wastagePct}%)
                  </span>
                  <select
                    aria-label="Wastage reason"
                    className="border border-gray-300 rounded-md px-2 py-1 text-sm bg-white"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  >
                    {REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  {reason === 'OTHER' && (
                    <input
                      className="flex-1 min-w-[10rem] border border-gray-300 rounded-md px-2 py-1 text-sm"
                      placeholder="What happened?"
                      value={wastageNotes}
                      onChange={(e) => setWastageNotes(e.target.value)}
                    />
                  )}
                </div>
              ) : (
                <p>No wastage.</p>
              )}
              {(source.unit_cost || 0) > 0 && wastage >= 0 && (
                <p className="text-gray-700">
                  Cost about {rupees(costOut)} → <strong>{rupees(perPack)}</strong> per pack
                  <span className="text-gray-500"> (was {rupees(source.unit_cost || 0)} per {unit.toLowerCase() || 'unit'})</span>
                </p>
              )}
            </div>
          )}

          <div>
            {showMore ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                <Input label="Note" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
              </div>
            ) : (
              <button type="button" className="text-sm text-primary-600" onClick={() => setShowMore(true)}>
                Change date or add a note
              </button>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 pt-2">
            <Link href="/inventory-adjustments/new" className="text-xs text-gray-500 underline">
              Spoiled stock? Record a damage adjustment
            </Link>
            <Button onClick={submit} disabled={!ready || saving || loading}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Repack
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
