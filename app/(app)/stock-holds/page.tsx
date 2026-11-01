'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useBranch } from '@/contexts/BranchContext';
import { useToastContext } from '@/contexts/ToastContext';
import { useStockLookups } from '@/components/stock/useStockLookups';

const PURPOSE: Record<string, string> = {
  quarantine: 'Quarantine',
  qc_hold: 'QC hold',
  damaged: 'Damaged, awaiting decision',
  return_inspection: 'Return awaiting inspection',
};
const REASON: Record<string, string> = {
  repair: 'In for repair',
  job_work: 'Job work for them',
  storage: 'Kept for them',
  sold_not_collected: 'Sold, not collected',
  other: 'Other',
};
const today = () => new Date().toISOString().slice(0, 10);

/**
 * What sits in the godown but is not saleable stock: our goods on hold, and other people's
 * goods kept here. A count expects the first on the shelf and leaves the second out.
 */
export default function StockHoldsPage() {
  const toast = useToastContext();
  const { currentBranchId } = useBranch();
  const { items, warehouses } = useStockLookups();
  const branchId = currentBranchId && currentBranchId !== 'ALL' ? currentBranchId : null;
  const [holds, setHolds] = useState<any[]>([]);
  const [goods, setGoods] = useState<any[]>([]);
  const [hold, setHold] = useState({ item_id: '', qty: '', purpose: 'qc_hold', date: today(), warehouse_id: '', reference: '' });
  const [other, setOther] = useState({ owner_name: '', description: '', qty: '', unit: 'PCS', reason: 'repair', received_date: today(), warehouse_id: '', reference: '' });
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    const [h, g] = await Promise.all([fetch('/api/stock-holds').then((r) => r.json()), fetch('/api/inward-custody').then((r) => r.json())]);
    setHolds(h.holds || []);
    setGoods(g.goods || []);
  }
  useEffect(() => {
    load();
  }, []);

  async function send(url: string, method: string, body: unknown, ok: string, key: string) {
    setBusy(key);
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || 'Could not save');
        return false;
      }
      toast.success(ok);
      await load();
      return true;
    } finally {
      setBusy(null);
    }
  }

  async function addHold() {
    if (!hold.item_id || !(Number(hold.qty) > 0)) return toast.error('Choose the item and quantity');
    const done = await send(
      '/api/stock-holds',
      'POST',
      { ...hold, qty: Number(hold.qty), warehouse_id: hold.warehouse_id || null, branch_id: warehouses.length ? null : branchId },
      'Stock put on hold',
      'hold'
    );
    if (done) setHold({ ...hold, item_id: '', qty: '', reference: '' });
  }

  async function settle(h: any, kind: 'release' | 'write_off') {
    const answer = window.prompt(`${kind === 'release' ? 'Release' : 'Write off'} how many of ${h.qty}?`, String(h.qty));
    if (!answer) return;
    const n = Number(answer);
    if (!(n > 0)) return;
    await send(`/api/stock-holds/${h.hold_id}`, 'POST', { date: today(), [kind]: n, reason: 'DAMAGE' }, kind === 'release' ? 'Released to saleable stock' : 'Written off', h.hold_id);
  }

  async function addOther() {
    if (!other.owner_name.trim() || !other.description.trim() || !(Number(other.qty) > 0)) return toast.error('Enter the owner, the goods and the quantity');
    const done = await send(
      '/api/inward-custody',
      'POST',
      { ...other, owner_type: 'other', qty: Number(other.qty), warehouse_id: other.warehouse_id || null, branch_id: warehouses.length ? null : branchId },
      "Others' goods recorded",
      'other'
    );
    if (done) setOther({ ...other, owner_name: '', description: '', qty: '', reference: '' });
  }

  async function giveBack(g: any) {
    const answer = window.prompt(`How many of ${g.qty} went back to ${g.owner_name}?`, String(g.qty));
    if (!answer || !(Number(answer) > 0)) return;
    await send(`/api/inward-custody/${g.id}`, 'PATCH', { qty: Number(answer), date: today() }, 'Handed back', g.id);
  }

  const godownSelect = (value: string, onChange: (v: string) => void) =>
    warehouses.length > 0 && (
      <label className="text-sm text-gray-700">
        Godown
        <select className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select godown</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
    );

  return (
    <div className="space-y-6">
      <PageHeader title="Held stock and others' goods" subtitle="In the godown but not for sale: our stock on hold, and goods that belong to someone else" />

      <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
        <h2 className="font-semibold text-gray-900">Our stock on hold</h2>
        <p className="text-sm text-gray-600">
          Held stock cannot be sold until released, but it is still on the shelf, so a stock count expects it.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <label className="text-sm text-gray-700 md:col-span-2">
            Item
            <select className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm" value={hold.item_id} onChange={(e) => setHold({ ...hold, item_id: e.target.value })}>
              <option value="">Select item</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-700">
            Quantity
            <Input type="number" min={0} value={hold.qty} onChange={(e) => setHold({ ...hold, qty: e.target.value })} />
          </label>
          <label className="text-sm text-gray-700">
            Why
            <select className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm" value={hold.purpose} onChange={(e) => setHold({ ...hold, purpose: e.target.value })}>
              {Object.entries(PURPOSE).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          {godownSelect(hold.warehouse_id, (v) => setHold({ ...hold, warehouse_id: v }))}
          <Button onClick={addHold} isLoading={busy === 'hold'} disabled={!!busy}>
            Put on hold
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-3 py-2">Hold</th>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Why</th>
                <th className="px-3 py-2">Since</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {holds.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                    Nothing is on hold.
                  </td>
                </tr>
              )}
              {holds.map((h) => (
                <tr key={h.hold_id}>
                  <td className="px-3 py-2">{h.hold_number}</td>
                  <td className="px-3 py-2">
                    {h.item_name}
                    {h.warehouse_name && <div className="text-xs text-gray-500">{h.warehouse_name}</div>}
                  </td>
                  <td className="px-3 py-2">{PURPOSE[h.purpose] || h.purpose}</td>
                  <td className="px-3 py-2">{h.hold_date}</td>
                  <td className="px-3 py-2 text-right">{h.qty}</td>
                  <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                    <Button size="sm" variant="secondary" onClick={() => settle(h, 'release')} disabled={!!busy}>
                      Release
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => settle(h, 'write_off')} disabled={!!busy}>
                      Write off
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-4">
        <h2 className="font-semibold text-gray-900">Other people&apos;s goods here</h2>
        <p className="text-sm text-gray-600">Never our stock. A stock count compares what it finds with this list and leaves them out.</p>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <label className="text-sm text-gray-700">
            Owner
            <Input value={other.owner_name} onChange={(e) => setOther({ ...other, owner_name: e.target.value })} />
          </label>
          <label className="text-sm text-gray-700 md:col-span-2">
            Goods
            <Input value={other.description} onChange={(e) => setOther({ ...other, description: e.target.value })} placeholder="e.g. Customer's motor for rewinding" />
          </label>
          <label className="text-sm text-gray-700">
            Quantity
            <Input type="number" min={0} value={other.qty} onChange={(e) => setOther({ ...other, qty: e.target.value })} />
          </label>
          <label className="text-sm text-gray-700">
            Why
            <select className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm" value={other.reason} onChange={(e) => setOther({ ...other, reason: e.target.value })}>
              {Object.entries(REASON).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <Button onClick={addOther} isLoading={busy === 'other'} disabled={!!busy}>
            Record
          </Button>
          {godownSelect(other.warehouse_id, (v) => setOther({ ...other, warehouse_id: v }))}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                <th className="px-3 py-2">Owner</th>
                <th className="px-3 py-2">Goods</th>
                <th className="px-3 py-2">Why</th>
                <th className="px-3 py-2">Received</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {goods.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                    No one else&apos;s goods are here.
                  </td>
                </tr>
              )}
              {goods.map((g) => (
                <tr key={g.id}>
                  <td className="px-3 py-2">{g.owner_name}</td>
                  <td className="px-3 py-2">
                    {g.description}
                    {g.warehouse_name && <div className="text-xs text-gray-500">{g.warehouse_name}</div>}
                  </td>
                  <td className="px-3 py-2">{REASON[g.reason] || g.reason}</td>
                  <td className="px-3 py-2">
                    {g.received_date}
                    <div className="text-xs text-gray-500">{g.days_held} days</div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {g.qty} {g.unit}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="secondary" onClick={() => giveBack(g)} disabled={!!busy}>
                      Handed back
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
