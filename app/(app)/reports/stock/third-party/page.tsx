'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/PageHeader';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';

const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PURPOSE: Record<string, string> = {
  repair: 'Repair', job_work: 'Job work', approval: 'Approval', consignment: 'Consignment',
  exhibition: 'Exhibition', demo: 'Demo', other: 'Other',
};

/** Stock that is ours but not in a godown: with parties on returnable challans, or in transit. */
export default function StockWithThirdPartiesPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    if (!business?.id) return;
    fetch(`/api/warehouses?business_id=${business.id}&user_id=${user?.id}`)
      .then((r) => (r.ok ? r.json() : { warehouses: [] }))
      .then((d) => setWarehouses(d.warehouses || []))
      .catch(() => setWarehouses([]));
  }, [business?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!business?.id) return;
    setData(null);
    fetch(`/api/reports/stock/third-party${warehouseId ? `?warehouse_id=${warehouseId}` : ''}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error || 'Could not load the report');
        setData(json);
      })
      .catch((e) => toast.error(e.message));
  }, [business?.id, warehouseId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-6">
      <PageHeader title="Stock with third parties" subtitle="Goods that are ours but not in the godown, with the document behind each" />

      {warehouses.length > 0 && (
        <select
          className="border border-gray-300 rounded-md px-3 py-2 text-sm"
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
        >
          <option value="">All godowns</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      )}

      {!data && <div className="text-gray-500">Loading...</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="text-xs text-gray-600">With third parties</div>
              <div className="text-lg font-semibold">{qty(data.totals.with_third_party.qty)}</div>
              <div className="text-xs text-gray-500">{inr(data.totals.with_third_party.value)}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="text-xs text-gray-600">In transit</div>
              <div className="text-lg font-semibold">{qty(data.totals.in_transit.qty + (data.totals.inward_transit?.qty || 0))}</div>
              <div className="text-xs text-gray-500">{inr(data.totals.in_transit.value + (data.totals.inward_transit?.value || 0))}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="text-xs text-gray-600">Past return date</div>
              <div className="text-lg font-semibold">{data.totals.overdue_returns}</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="text-xs text-gray-600">On an expired e-way bill</div>
              <div className={`text-lg font-semibold ${data.totals.unproven ? 'text-red-700' : ''}`}>{data.totals.unproven}</div>
            </div>
          </div>

          <section className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <h2 className="font-semibold text-gray-900 p-4">Held by others</h2>
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-4 py-2">Held by</th>
                  <th className="px-4 py-2">Why</th>
                  <th className="px-4 py-2">Item</th>
                  <th className="px-4 py-2">Challan</th>
                  <th className="px-4 py-2">E-way bill</th>
                  <th className="px-4 py-2 text-right">Qty</th>
                  <th className="px-4 py-2 text-right">Value</th>
                  <th className="px-4 py-2">Days out</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.with_third_party.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-gray-500">
                      Nothing is out with a third party.
                    </td>
                  </tr>
                )}
                {data.with_third_party.map((r: any) => (
                  <tr key={`${r.challan_id}-${r.item_id}`}>
                    <td className="px-4 py-2">{r.party_name || '-'}</td>
                    <td className="px-4 py-2">{PURPOSE[r.purpose] || r.purpose}</td>
                    <td className="px-4 py-2">{r.item_name}</td>
                    <td className="px-4 py-2">
                      <Link className="text-primary-700" href={`/delivery-challans/${r.challan_id}`}>
                        {r.challan_number}
                      </Link>
                      <div className="text-xs text-gray-500">
                        {r.challan_date}
                        {r.expected_return_date ? `, due ${r.expected_return_date}` : ''}
                      </div>
                    </td>
                    <td className={`px-4 py-2 ${r.eway_bill_status === 'expired' ? 'text-red-700' : ''}`}>
                      {r.eway_bill_number ? `${r.eway_bill_number} (${r.eway_bill_status})` : '-'}
                    </td>
                    <td className="px-4 py-2 text-right">{qty(r.qty)}</td>
                    <td className="px-4 py-2 text-right">{inr(r.value)}</td>
                    <td className={`px-4 py-2 ${r.overdue ? 'text-red-700' : ''}`}>
                      {r.days_out}
                      {r.overdue ? ' (overdue)' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <h2 className="font-semibold text-gray-900 p-4">In transit between godowns</h2>
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-4 py-2">Transfer</th>
                  <th className="px-4 py-2">From</th>
                  <th className="px-4 py-2">To</th>
                  <th className="px-4 py-2">Item</th>
                  <th className="px-4 py-2">E-way bill</th>
                  <th className="px-4 py-2 text-right">Qty</th>
                  <th className="px-4 py-2 text-right">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.in_transit.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-gray-500">
                      Nothing is in transit.
                    </td>
                  </tr>
                )}
                {data.in_transit.map((r: any) => (
                  <tr key={`${r.transfer_id}-${r.item_id}`}>
                    <td className="px-4 py-2">
                      <Link className="text-primary-700" href={`/stock-transfers/${r.transfer_id}`}>
                        {r.transfer_number}
                      </Link>
                      <div className="text-xs text-gray-500">{r.transfer_date}</div>
                    </td>
                    <td className="px-4 py-2">{r.from_warehouse_name}</td>
                    <td className="px-4 py-2">{r.to_warehouse_name}</td>
                    <td className="px-4 py-2">{r.item_name}</td>
                    <td className={`px-4 py-2 ${r.eway_bill_status === 'expired' ? 'text-red-700' : ''}`}>
                      {r.eway_bill_number ? `${r.eway_bill_number} (${r.eway_bill_status})` : '-'}
                    </td>
                    <td className="px-4 py-2 text-right">{qty(r.qty)}</td>
                    <td className="px-4 py-2 text-right">{inr(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
            <h2 className="font-semibold text-gray-900 p-4">Billed, on the way from suppliers</h2>
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-4 py-2">Supplier</th>
                  <th className="px-4 py-2">Bill</th>
                  <th className="px-4 py-2">Item</th>
                  <th className="px-4 py-2">E-way bill</th>
                  <th className="px-4 py-2 text-right">Qty</th>
                  <th className="px-4 py-2">Days</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(data.inward_transit || []).length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                      Nothing is on the way from a supplier.
                    </td>
                  </tr>
                )}
                {(data.inward_transit || []).map((r: any) => (
                  <tr key={`${r.purchase_id}-${r.item_id}`}>
                    <td className="px-4 py-2">{r.supplier_name || '-'}</td>
                    <td className="px-4 py-2">
                      <Link className="text-primary-700" href={`/purchases/${r.purchase_id}`}>
                        {r.bill_number || 'Bill'}
                      </Link>
                      <div className="text-xs text-gray-500">{r.bill_date}</div>
                    </td>
                    <td className="px-4 py-2">{r.item_name}</td>
                    <td className={`px-4 py-2 ${r.eway_bill_status === 'expired' ? 'text-red-700' : ''}`}>
                      {r.eway_bill_number ? `${r.eway_bill_number} (${r.eway_bill_status})` : '-'}
                    </td>
                    <td className="px-4 py-2 text-right">{qty(r.qty)}</td>
                    <td className="px-4 py-2">{r.days_in_transit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
