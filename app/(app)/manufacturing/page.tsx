'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useBranch } from '@/contexts/BranchContext';
import { useToastContext } from '@/contexts/ToastContext';
import { useStockLookups } from '@/components/stock/useStockLookups';

type Line = { item_id: string; role: 'input' | 'byproduct' | 'scrap'; qty: string; recovery_rate: string };
const inr = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);
const emptyLine = (): Line => ({ item_id: '', role: 'input', qty: '', recovery_rate: '' });

/**
 * Bills of materials and production entries. Producing issues the inputs at cost into work in
 * progress and receives the output at that cost, less what by-products and scrap will fetch.
 */
export default function ManufacturingPage() {
  const toast = useToastContext();
  const { currentBranchId } = useBranch();
  const { items, warehouses } = useStockLookups();
  const branchId = currentBranchId && currentBranchId !== 'ALL' ? currentBranchId : null;
  const [boms, setBoms] = useState<any[]>([]);
  const [entries, setEntries] = useState<any[]>([]);
  const [bom, setBom] = useState({ name: '', output_item_id: '', output_qty: '1', lines: [emptyLine()] });
  const [run, setRun] = useState({ bom_id: '', batches: '1', date: today(), warehouse_id: '' });
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const [b, p] = await Promise.all([fetch('/api/manufacturing/boms').then((r) => r.json()), fetch('/api/manufacturing/production').then((r) => r.json())]);
    setBoms(b.boms || []);
    setEntries(p.entries || []);
  }
  useEffect(() => {
    load();
  }, []);

  const patchLine = (i: number, p: Partial<Line>) => setBom((b) => ({ ...b, lines: b.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) }));

  async function saveBom() {
    setBusy('bom');
    try {
      const res = await fetch('/api/manufacturing/boms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: bom.name,
          output_item_id: bom.output_item_id,
          output_qty: Number(bom.output_qty),
          lines: bom.lines.filter((l) => l.item_id).map((l) => ({ item_id: l.item_id, role: l.role, qty: Number(l.qty), recovery_rate: Number(l.recovery_rate) || 0 })),
        }),
      });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error || 'Could not save');
      toast.success('Bill of materials saved');
      setBom({ name: '', output_item_id: '', output_qty: '1', lines: [emptyLine()] });
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function produce() {
    if (!run.bom_id) return toast.error('Choose a bill of materials');
    if (warehouses.length && !run.warehouse_id) return toast.error('Choose the godown');
    setBusy('run');
    try {
      const res = await fetch('/api/manufacturing/production', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bom_id: run.bom_id, batches: Number(run.batches), date: run.date, warehouse_id: run.warehouse_id || null, branch_id: warehouses.length ? null : branchId }),
      });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error || 'Could not post production');
      toast.success(`${data.number} posted: output at ${inr(data.output_unit_cost)} each`);
      await load();
    } finally {
      setBusy(null);
    }
  }

  const itemSelect = (value: string, onChange: (v: string) => void) => (
    <select className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select item</option>
      {items.map((i) => (
        <option key={i.id} value={i.id}>
          {i.name}
          {i.unit ? ` (${i.unit})` : ''}
        </option>
      ))}
    </select>
  );

  const chosen = boms.find((b) => b.id === run.bom_id);

  return (
    <div className="space-y-6">
      <PageHeader title="Manufacturing" subtitle="Bills of materials and production entries, costed through work in progress" />

      <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <h2 className="font-semibold text-gray-900">Produce</h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
          <label className="text-sm text-gray-700 md:col-span-2">
            Bill of materials
            <select className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm" value={run.bom_id} onChange={(e) => setRun({ ...run, bom_id: e.target.value })}>
              <option value="">Select</option>
              {boms.filter((b) => b.is_active).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} → {Number(b.output_qty)} {b.output_item_name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-700">
            Batches
            <Input type="number" min={0} value={run.batches} onChange={(e) => setRun({ ...run, batches: e.target.value })} />
          </label>
          <label className="text-sm text-gray-700">
            Date
            <Input type="date" value={run.date} onChange={(e) => setRun({ ...run, date: e.target.value })} />
          </label>
          {warehouses.length > 0 ? (
            <label className="text-sm text-gray-700">
              Godown
              <select className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm" value={run.warehouse_id} onChange={(e) => setRun({ ...run, warehouse_id: e.target.value })}>
                <option value="">Select godown</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div />
          )}
        </div>
        {chosen && (
          <p className="text-sm text-gray-600">
            Makes {Number(chosen.output_qty) * (Number(run.batches) || 0)} {chosen.output_item_name} from{' '}
            {chosen.lines
              .filter((l: any) => l.role === 'input')
              .map((l: any) => `${Number(l.qty) * (Number(run.batches) || 0)} ${l.item_name}`)
              .join(', ')}
            .
          </p>
        )}
        <div className="flex justify-end">
          <Button onClick={produce} isLoading={busy === 'run'} disabled={!!busy}>
            Post production
          </Button>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <h2 className="font-semibold text-gray-900">New bill of materials</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-sm text-gray-700">
            Name
            <Input value={bom.name} onChange={(e) => setBom({ ...bom, name: e.target.value })} />
          </label>
          <label className="text-sm text-gray-700">
            Makes
            {itemSelect(bom.output_item_id, (v) => setBom({ ...bom, output_item_id: v }))}
          </label>
          <label className="text-sm text-gray-700">
            Quantity per batch
            <Input type="number" min={0} value={bom.output_qty} onChange={(e) => setBom({ ...bom, output_qty: e.target.value })} />
          </label>
        </div>
        {bom.lines.map((l, i) => (
          <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
            <div className="md:col-span-5">{itemSelect(l.item_id, (v) => patchLine(i, { item_id: v }))}</div>
            <select className="md:col-span-2 border border-gray-300 rounded-md px-3 py-2 text-sm" value={l.role} onChange={(e) => patchLine(i, { role: e.target.value as Line['role'] })}>
              <option value="input">Input</option>
              <option value="byproduct">By-product</option>
              <option value="scrap">Scrap</option>
            </select>
            <div className="md:col-span-2">
              <Input type="number" min={0} placeholder="Qty per batch" value={l.qty} onChange={(e) => patchLine(i, { qty: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              {l.role !== 'input' && <Input type="number" min={0} placeholder="Fetches ₹ each" value={l.recovery_rate} onChange={(e) => patchLine(i, { recovery_rate: e.target.value })} />}
            </div>
            <button
              className="md:col-span-1 text-gray-400 hover:text-red-600"
              aria-label="Remove line"
              onClick={() => setBom((b) => ({ ...b, lines: b.lines.length > 1 ? b.lines.filter((_, j) => j !== i) : b.lines }))}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        <div className="flex justify-between">
          <Button variant="secondary" size="sm" onClick={() => setBom((b) => ({ ...b, lines: [...b.lines, emptyLine()] }))}>
            <Plus className="w-4 h-4 mr-1" />
            Add line
          </Button>
          <Button onClick={saveBom} isLoading={busy === 'bom'} disabled={!!busy}>
            Save
          </Button>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <h2 className="font-semibold text-gray-900 p-4">Production entries</h2>
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-3 py-2">Entry</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Output</th>
              <th className="px-3 py-2">Used</th>
              <th className="px-3 py-2 text-right">Input cost</th>
              <th className="px-3 py-2 text-right">Scrap value</th>
              <th className="px-3 py-2 text-right">Output cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {entries.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-gray-500">
                  Nothing produced yet.
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="px-3 py-2">{e.entry_number}</td>
                <td className="px-3 py-2">{e.entry_date}</td>
                <td className="px-3 py-2">
                  {Number(e.output_qty)} {e.output_item_name}
                </td>
                <td className="px-3 py-2 text-xs text-gray-600">
                  {e.lines
                    .filter((l: any) => l.role === 'input')
                    .map((l: any) => `${Number(l.qty)} ${l.item_name}`)
                    .join(', ')}
                </td>
                <td className="px-3 py-2 text-right">{inr(e.input_cost)}</td>
                <td className="px-3 py-2 text-right">{inr(e.recovery_value)}</td>
                <td className="px-3 py-2 text-right font-medium">{inr(e.output_cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
