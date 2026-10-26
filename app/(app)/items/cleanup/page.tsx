'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToastContext } from '@/contexts/ToastContext';
import { useStockLookups } from '@/components/stock/useStockLookups';

type UnitRow = { unit: string; factor_to_base: string; barcode: string };

/**
 * Two clean-ups that stop the register drifting from the shelf: alternate units (count in boxes,
 * stock in pieces) and merging an item entered twice under different names.
 */
export default function ItemCleanupPage() {
  const toast = useToastContext();
  const { items } = useStockLookups();
  const [unitItem, setUnitItem] = useState('');
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const base = items.find((i) => i.id === unitItem)?.unit || '';

  useEffect(() => {
    if (!unitItem) return setUnits([]);
    fetch(`/api/items/${unitItem}/units`)
      .then((r) => r.json())
      .then((d) => setUnits((d.units || []).map((u: any) => ({ unit: u.unit, factor_to_base: String(u.factor_to_base), barcode: u.barcode || '' }))))
      .catch(() => setUnits([]));
  }, [unitItem]);

  useEffect(() => {
    setPreview(null);
    if (!source || !target) return;
    fetch(`/api/items/merge?source_item_id=${source}&target_item_id=${target}`)
      .then((r) => r.json())
      .then(setPreview)
      .catch(() => setPreview(null));
  }, [source, target]);

  async function saveUnits() {
    setBusy(true);
    try {
      const res = await fetch(`/api/items/${unitItem}/units`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ units: units.filter((u) => u.unit.trim()).map((u) => ({ ...u, factor_to_base: Number(u.factor_to_base) })) }),
      });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error || 'Could not save the units');
      toast.success('Units saved');
    } finally {
      setBusy(false);
    }
  }

  async function merge() {
    const s = items.find((i) => i.id === source)?.name;
    const t = items.find((i) => i.id === target)?.name;
    if (!window.confirm(`Merge "${s}" into "${t}"? Every bill, invoice and stock entry of "${s}" moves to "${t}", and "${s}" is removed. This cannot be undone.`)) return;
    setBusy(true);
    try {
      const res = await fetch('/api/items/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source_item_id: source, target_item_id: target }),
      });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error || 'Could not merge');
      toast.success(`Merged into ${data.target.name}`);
      setSource('');
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  const select = (value: string, onChange: (v: string) => void, exclude?: string) => (
    <select className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select item</option>
      {items
        .filter((i) => i.id !== exclude)
        .map((i) => (
          <option key={i.id} value={i.id}>
            {i.name}
            {i.code ? ` · ${i.code}` : ''}
            {i.unit ? ` (${i.unit})` : ''}
          </option>
        ))}
    </select>
  );

  return (
    <div className="space-y-6">
      <PageHeader title="Item units and duplicates" subtitle="Count in boxes or bags, and fold an item entered twice into one" />

      <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <h2 className="font-semibold text-gray-900">Alternate units</h2>
        <p className="text-sm text-gray-600">
          Stock stays in the item&apos;s own unit. A stock count can be entered in any of these, and a box barcode scanned during a count adds the
          whole box.
        </p>
        <label className="block text-sm text-gray-700 max-w-md">
          Item
          {select(unitItem, setUnitItem)}
        </label>
        {unitItem && (
          <>
            {units.map((u, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-3">
                  <Input placeholder="Unit, e.g. BOX" value={u.unit} onChange={(e) => setUnits((p) => p.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} />
                </div>
                <span className="col-span-1 text-center text-sm text-gray-500">=</span>
                <div className="col-span-2">
                  <Input type="number" min={0} value={u.factor_to_base} onChange={(e) => setUnits((p) => p.map((x, j) => (j === i ? { ...x, factor_to_base: e.target.value } : x)))} />
                </div>
                <span className="col-span-1 text-sm text-gray-700">{base}</span>
                <div className="col-span-4">
                  <Input placeholder="Barcode on the box (optional)" value={u.barcode} onChange={(e) => setUnits((p) => p.map((x, j) => (j === i ? { ...x, barcode: e.target.value } : x)))} />
                </div>
                <button className="col-span-1 text-gray-400 hover:text-red-600" aria-label="Remove unit" onClick={() => setUnits((p) => p.filter((_, j) => j !== i))}>
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <div className="flex justify-between">
              <Button size="sm" variant="secondary" onClick={() => setUnits((p) => [...p, { unit: '', factor_to_base: '', barcode: '' }])}>
                <Plus className="w-4 h-4 mr-1" />
                Add unit
              </Button>
              <Button onClick={saveUnits} isLoading={busy} disabled={busy}>
                Save units
              </Button>
            </div>
          </>
        )}
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <h2 className="font-semibold text-gray-900">Merge a duplicate</h2>
        <p className="text-sm text-gray-600">
          The same goods under two names show a shortage on one and an excess on the other. Merging moves every document and stock entry of
          the duplicate to the item that stays.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-sm text-gray-700">
            Duplicate (removed)
            {select(source, setSource, target)}
          </label>
          <label className="text-sm text-gray-700">
            Item that stays
            {select(target, setTarget, source)}
          </label>
        </div>
        {preview && (
          <div className="rounded-lg border border-gray-200 p-3 text-sm">
            {preview.problems?.length ? (
              <ul className="list-disc pl-5 text-red-700">
                {preview.problems.map((p: string) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            ) : (
              <>
                <div className="text-gray-700">Moves:</div>
                <ul className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-x-4 text-gray-600">
                  {Object.entries(preview.references || {}).map(([k, n]) => (
                    <li key={k}>
                      {k.split('.')[0].replace(/_/g, ' ')}: {String(n)}
                    </li>
                  ))}
                  {Object.keys(preview.references || {}).length === 0 && <li>Nothing references the duplicate.</li>}
                </ul>
              </>
            )}
          </div>
        )}
        <div className="flex justify-end">
          <Button onClick={merge} isLoading={busy} disabled={busy || !preview || preview.problems?.length > 0}>
            Merge
          </Button>
        </div>
      </section>
    </div>
  );
}
