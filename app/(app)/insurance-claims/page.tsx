'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';

const inr = (n: number | null) => (n == null ? '-' : `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const STATUS: Record<string, string> = {
  lodged: 'bg-amber-100 text-amber-800',
  admitted: 'bg-slate-100 text-primary-800',
  settled: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
};
const today = () => new Date().toISOString().slice(0, 10);

/** Insurance claims for stock lost or damaged, from lodging to settlement. */
export default function InsuranceClaimsPage() {
  const toast = useToastContext();
  const { business } = useAuth();
  const [claims, setClaims] = useState<any[]>([]);
  const [writeOffs, setWriteOffs] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<Array<{ id: string; name: string }>>([]);
  const [form, setForm] = useState({
    loss_date: today(), cause: 'theft', insurer: '', policy_number: '', fir_number: '', fir_date: '', surveyor: '', claimed_amount: '', adjustment_ids: [] as string[],
  });
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch('/api/insurance-claims');
    const data = await res.json();
    setClaims(data.claims || []);
  }

  useEffect(() => {
    if (!business?.id) return;
    load();
    fetch(`/api/inventory-adjustments?business_id=${business.id}&limit=100`)
      .then((r) => (r.ok ? r.json() : { adjustments: [] }))
      .then((d) =>
        setWriteOffs(
          (d.adjustments || []).filter(
            (a: any) => a.direction === 'DECREASE' && ['DAMAGE', 'THEFT', 'TRANSIT_LOSS', 'CUSTODY_LOSS', 'EXPIRED'].includes(a.reason_code)
          )
        )
      )
      .catch(() => setWriteOffs([]));
    fetch(`/api/accounts?business_id=${business.id}&account_type=asset&limit=500`)
      .then((r) => (r.ok ? r.json() : { accounts: [] }))
      .then((d) =>
        setAccounts(
          (d.accounts || [])
            .filter((a: any) => ['1101', '1102'].includes(a.account_code) || /bank|cash/i.test(a.account_name || ''))
            .map((a: any) => ({ id: a.id, name: `${a.account_code} ${a.account_name}` }))
        )
      )
      .catch(() => setAccounts([]));
  }, [business?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send(url: string, method: string, body: unknown, ok: string) {
    setBusy(true);
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
      setBusy(false);
    }
  }

  async function lodge() {
    const done = await send('/api/insurance-claims', 'POST', { ...form, claimed_amount: Number(form.claimed_amount), fir_date: form.fir_date || null }, 'Claim lodged');
    if (done) setForm({ ...form, insurer: '', policy_number: '', fir_number: '', fir_date: '', surveyor: '', claimed_amount: '', adjustment_ids: [] });
  }

  async function admit(c: any) {
    const amt = window.prompt(`Amount the insurer admitted (claimed ${c.claimed_amount})`, String(c.claimed_amount));
    if (amt) await send(`/api/insurance-claims/${c.id}`, 'PATCH', { action: 'admit', amount: Number(amt), date: today() }, 'Claim admitted');
  }

  async function settle(c: any) {
    if (!accounts.length) return toast.error('No bank or cash account found');
    const amt = window.prompt(`Amount received (admitted ${c.admitted_amount})`, String(c.admitted_amount));
    if (!amt) return;
    const pick = accounts.length === 1 ? accounts[0] : accounts.find((a) => a.name.startsWith('1102')) || accounts[0];
    if (!window.confirm(`Record ${amt} received into ${pick.name}?`)) return;
    await send(`/api/insurance-claims/${c.id}`, 'PATCH', { action: 'settle', amount: Number(amt), date: today(), account_id: pick.id }, 'Settlement recorded');
  }

  async function reject(c: any) {
    if (window.confirm('Mark this claim as rejected? Any admitted amount goes back to the loss.')) {
      await send(`/api/insurance-claims/${c.id}`, 'PATCH', { action: 'reject', date: today() }, 'Claim rejected');
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Insurance claims" subtitle="Stock lost to theft, fire, flood or in transit, claimed from the insurer" />

      <section className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
        <h2 className="font-semibold text-gray-900">Lodge a claim</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label className="text-sm text-gray-700">
            Date of loss
            <Input type="date" value={form.loss_date} onChange={(e) => setForm({ ...form, loss_date: e.target.value })} />
          </label>
          <label className="text-sm text-gray-700">
            Cause
            <select className="mt-1 w-full border border-gray-300 rounded-md px-3 py-2 text-sm" value={form.cause} onChange={(e) => setForm({ ...form, cause: e.target.value })}>
              {['theft', 'fire', 'flood', 'transit', 'damage', 'other'].map((c) => (
                <option key={c} value={c}>
                  {c[0].toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-700">
            Insurer
            <Input value={form.insurer} onChange={(e) => setForm({ ...form, insurer: e.target.value })} />
          </label>
          <label className="text-sm text-gray-700">
            Policy number
            <Input value={form.policy_number} onChange={(e) => setForm({ ...form, policy_number: e.target.value })} />
          </label>
          <label className="text-sm text-gray-700">
            FIR number{form.cause === 'theft' ? ' *' : ''}
            <Input value={form.fir_number} onChange={(e) => setForm({ ...form, fir_number: e.target.value })} />
          </label>
          <label className="text-sm text-gray-700">
            FIR date
            <Input type="date" value={form.fir_date} onChange={(e) => setForm({ ...form, fir_date: e.target.value })} />
          </label>
          <label className="text-sm text-gray-700">
            Surveyor
            <Input value={form.surveyor} onChange={(e) => setForm({ ...form, surveyor: e.target.value })} />
          </label>
          <label className="text-sm text-gray-700">
            Amount claimed (₹)
            <Input type="number" min={0} value={form.claimed_amount} onChange={(e) => setForm({ ...form, claimed_amount: e.target.value })} />
          </label>
        </div>
        {writeOffs.length > 0 && (
          <div className="text-sm text-gray-700">
            Write-offs this claim covers
            <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-1">
              {writeOffs.slice(0, 20).map((a) => (
                <label key={a.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.adjustment_ids.includes(a.id)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        adjustment_ids: e.target.checked ? [...form.adjustment_ids, a.id] : form.adjustment_ids.filter((x) => x !== a.id),
                      })
                    }
                  />
                  {a.adjustment_number} · {a.item_name} · {Math.abs(Number(a.quantity_change))} · {inr(Math.abs(Number(a.value_change)))}
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="flex justify-end">
          <Button onClick={lodge} isLoading={busy} disabled={busy}>
            Lodge claim
          </Button>
        </div>
      </section>

      <section className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-3 py-2">Claim</th>
              <th className="px-3 py-2">Loss</th>
              <th className="px-3 py-2">Insurer</th>
              <th className="px-3 py-2 text-right">Written off</th>
              <th className="px-3 py-2 text-right">Claimed</th>
              <th className="px-3 py-2 text-right">Admitted</th>
              <th className="px-3 py-2 text-right">Received</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {claims.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-gray-500">
                  No claims yet.
                </td>
              </tr>
            )}
            {claims.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2">{c.claim_number}</td>
                <td className="px-3 py-2">
                  {c.loss_date} · {c.cause}
                  {c.fir_number && <div className="text-xs text-gray-500">FIR {c.fir_number}</div>}
                </td>
                <td className="px-3 py-2">{c.insurer}</td>
                <td className="px-3 py-2 text-right">{inr(c.loss_value)}</td>
                <td className="px-3 py-2 text-right">{inr(c.claimed_amount)}</td>
                <td className="px-3 py-2 text-right">{inr(c.admitted_amount)}</td>
                <td className="px-3 py-2 text-right">{inr(c.settled_amount)}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS[c.status]}`}>{c.status}</span>
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap space-x-2">
                  {c.status === 'lodged' && (
                    <Button size="sm" variant="secondary" onClick={() => admit(c)} disabled={busy}>
                      Admitted
                    </Button>
                  )}
                  {c.status === 'admitted' && (
                    <Button size="sm" variant="secondary" onClick={() => settle(c)} disabled={busy}>
                      Received
                    </Button>
                  )}
                  {(c.status === 'lodged' || c.status === 'admitted') && (
                    <Button size="sm" variant="secondary" onClick={() => reject(c)} disabled={busy}>
                      Rejected
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="text-sm text-gray-600">
        Admitting moves the admitted amount from Stock Loss to Insurance Claims Receivable. Receiving puts it in the bank; any shortfall goes
        back to the loss.
      </p>
    </div>
  );
}
