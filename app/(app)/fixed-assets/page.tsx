'use client';

export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Building2, Loader2, Plus, TrendingDown, X } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import {
  IT_BLOCKS,
  SCHEDULE_II,
  fyLabel,
  fyStartYear,
  scheduleIIByKey,
  type ItBlockRow,
} from '@/lib/accounting/it-depreciation';

interface Account {
  id: string;
  account_code: string;
  account_name: string;
}

interface Asset {
  id: string;
  asset_code: string;
  asset_name: string;
  asset_category: string | null;
  purchase_date: string;
  put_to_use_on: string;
  purchase_cost: string | number;
  depreciation_method: 'SLM' | 'WDV';
  useful_life_years: number;
  depreciation_rate: string | number | null;
  current_book_value: string | number;
  accumulated_depreciation: string | number;
  it_block: string | null;
  is_disposed: boolean;
  disposal_date: string | null;
  disposal_amount: string | number | null;
  last_depreciated_to: string | null;
}

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(n);
const today = () => format(new Date(), 'yyyy-MM-dd');
const selectClass = 'w-full rounded-md border border-border px-3 py-2 text-sm';

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const { label, children, ...rest } = props;
  return (
    <div>
      <label className="block text-sm font-medium text-text-primary mb-1">{label}</label>
      <select className={selectClass} {...rest}>
        {children}
      </select>
    </div>
  );
}

const emptyForm = () => ({
  asset_code: '',
  asset_name: '',
  schedule_ii_category: '',
  it_block: '',
  purchase_date: today(),
  put_to_use_date: today(),
  purchase_cost: '',
  residual_value: '',
  depreciation_method: 'SLM' as 'SLM' | 'WDV',
  useful_life_years: '',
  depreciation_rate: '',
  account_id: '',
  depreciation_account_id: '',
  funding: 'bank',
  vendor_name: '',
  invoice_number: '',
});

export default function FixedAssetsPage() {
  const { business } = useAuth();
  const toast = useToastContext();
  const [tab, setTab] = useState<'register' | 'it'>('register');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [assetAccounts, setAssetAccounts] = useState<Account[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [action, setAction] = useState<{ kind: 'depreciate' | 'dispose'; asset: Asset } | null>(null);
  const [actionForm, setActionForm] = useState({
    period_end_date: today(),
    disposal_date: today(),
    disposal_amount: '',
    proceeds_account_id: '',
    buyer_name: '',
    reason: '',
    charge_depreciation: true,
  });
  const [fy, setFy] = useState(fyLabel(fyStartYear(today())));
  const [itRows, setItRows] = useState<ItBlockRow[]>([]);
  const [unclassified, setUnclassified] = useState(0);
  const [itLoading, setItLoading] = useState(false);

  const load = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const [aRes, assetAccRes, expRes] = await Promise.all([
        fetch(`/api/fixed-assets?business_id=${business.id}`),
        fetch(`/api/accounts?account_type=asset&is_active=true&limit=500`),
        fetch(`/api/accounts?account_type=expense&is_active=true&limit=500`),
      ]);
      const aData = await aRes.json();
      if (!aRes.ok) throw new Error(aData.error || 'Failed to load assets');
      setAssets(aData.assets || []);
      if (assetAccRes.ok) setAssetAccounts((await assetAccRes.json()).accounts || []);
      if (expRes.ok) setExpenseAccounts((await expRes.json()).accounts || []);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load fixed assets');
    } finally {
      setLoading(false);
    }
  }, [business?.id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const loadIt = useCallback(async () => {
    if (!business?.id) return;
    setItLoading(true);
    try {
      const res = await fetch(`/api/fixed-assets/it-depreciation?business_id=${business.id}&fy=${fy}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to compute');
      setItRows(data.rows || []);
      setUnclassified(data.unclassified || 0);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setItLoading(false);
    }
  }, [business?.id, fy, toast]);

  useEffect(() => {
    if (tab === 'it') loadIt();
  }, [tab, loadIt]);

  const fixedAssetAccounts = useMemo(
    () => assetAccounts.filter((a) => a.account_code.startsWith('12') && a.account_code !== '1202'),
    [assetAccounts]
  );
  const proceedsAccounts = useMemo(
    () => assetAccounts.filter((a) => a.account_code.startsWith('11')),
    [assetAccounts]
  );

  useEffect(() => {
    setForm((f) => ({
      ...f,
      account_id: f.account_id || fixedAssetAccounts.find((a) => a.account_code === '1201')?.id || '',
      depreciation_account_id:
        f.depreciation_account_id || expenseAccounts.find((a) => a.account_code === '5204')?.id || '',
    }));
  }, [fixedAssetAccounts, expenseAccounts]);

  const onCategory = (key: string) => {
    const cat = scheduleIIByKey(key);
    setForm((f) => ({ ...f, schedule_ii_category: key, useful_life_years: cat ? String(cat.usefulLifeYears) : f.useful_life_years }));
  };

  const submitAsset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id) return;
    setSaving(true);
    try {
      const res = await fetch('/api/fixed-assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          business_id: business.id,
          purchase_cost: Number(form.purchase_cost),
          residual_value: Number(form.residual_value || 0),
          useful_life_years: Number(form.useful_life_years) || undefined,
          depreciation_rate: form.depreciation_rate ? Number(form.depreciation_rate) : undefined,
          schedule_ii_category: form.schedule_ii_category || undefined,
          it_block: form.it_block || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add asset');
      toast.success(`Asset ${data.asset.asset_code} capitalised`);
      setForm(emptyForm());
      setShowForm(false);
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const submitAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id || !action) return;
    setSaving(true);
    try {
      const isDep = action.kind === 'depreciate';
      const res = await fetch(`/api/fixed-assets/${action.asset.id}/${action.kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isDep
            ? { business_id: business.id, period_end_date: actionForm.period_end_date }
            : {
                business_id: business.id,
                disposal_date: actionForm.disposal_date,
                disposal_amount: Number(actionForm.disposal_amount || 0),
                proceeds_account_id: actionForm.proceeds_account_id || undefined,
                buyer_name: actionForm.buyer_name,
                reason: actionForm.reason,
                charge_depreciation: actionForm.charge_depreciation,
              }
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      if (isDep) {
        toast.success(`Depreciation of ${inr(data.depreciation.amount)} posted`);
      } else {
        const gl = Number(data.disposal.gainLoss);
        toast.success(`Asset disposed; ${gl >= 0 ? 'profit' : 'loss'} of ${inr(Math.abs(gl))}`);
      }
      setAction(null);
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const fyOptions = useMemo(() => {
    const cur = fyStartYear(today());
    return Array.from({ length: 6 }, (_, i) => fyLabel(cur - i));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Fixed Assets</h1>
          <p className="text-sm text-text-secondary mt-1">
            Asset register, Schedule II book depreciation, disposals and Income-tax block depreciation
          </p>
        </div>
        {tab === 'register' && (
          <Button onClick={() => setShowForm((s) => !s)}>
            {showForm ? <X className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
            {showForm ? 'Close' : 'Add asset'}
          </Button>
        )}
      </div>

      <div className="flex gap-2 border-b border-border">
        {(['register', 'it'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t ? 'border-primary-600 text-primary-600' : 'border-transparent text-text-secondary'
            }`}
          >
            {t === 'register' ? 'Asset register' : 'Income-tax depreciation'}
          </button>
        ))}
      </div>

      {tab === 'register' && showForm && (
        <Card>
          <form onSubmit={submitAsset} className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input label="Asset code" value={form.asset_code} onChange={(e) => setForm({ ...form, asset_code: e.target.value })} required />
            <Input label="Asset name" value={form.asset_name} onChange={(e) => setForm({ ...form, asset_name: e.target.value })} required />
            <Select label="Schedule II category" value={form.schedule_ii_category} onChange={(e) => onCategory(e.target.value)}>
              <option value="">Select category</option>
              {SCHEDULE_II.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label} ({c.usefulLifeYears} yrs)
                </option>
              ))}
            </Select>
            <Input type="date" label="Purchase date" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value, put_to_use_date: form.put_to_use_date < e.target.value ? e.target.value : form.put_to_use_date })} required />
            <Input type="date" label="Put to use on" value={form.put_to_use_date} min={form.purchase_date} onChange={(e) => setForm({ ...form, put_to_use_date: e.target.value })} required />
            <Input type="number" label="Cost (excl. GST where ITC is claimed)" min="0.01" step="0.01" value={form.purchase_cost} onChange={(e) => setForm({ ...form, purchase_cost: e.target.value })} required />
            <Select label="Book method" value={form.depreciation_method} onChange={(e) => setForm({ ...form, depreciation_method: e.target.value as 'SLM' | 'WDV' })}>
              <option value="SLM">Straight line (SLM)</option>
              <option value="WDV">Written down value (WDV)</option>
            </Select>
            <Input type="number" label="Useful life (years)" min="1" step="1" value={form.useful_life_years} onChange={(e) => setForm({ ...form, useful_life_years: e.target.value })} required />
            <Input type="number" label="Residual value (default 0)" min="0" step="0.01" value={form.residual_value} onChange={(e) => setForm({ ...form, residual_value: e.target.value })} />
            {form.depreciation_method === 'WDV' && (
              <Input type="number" label="WDV rate % (blank = derived from life)" min="0" step="0.01" value={form.depreciation_rate} onChange={(e) => setForm({ ...form, depreciation_rate: e.target.value })} />
            )}
            <Select label="Income-tax block" value={form.it_block} onChange={(e) => setForm({ ...form, it_block: e.target.value })}>
              <option value="">Not classified</option>
              {IT_BLOCKS.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.label} ({b.rate}%)
                </option>
              ))}
            </Select>
            <Select label="Asset account" value={form.account_id} onChange={(e) => setForm({ ...form, account_id: e.target.value })} required>
              <option value="">Select account</option>
              {fixedAssetAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.account_code} · {a.account_name}
                </option>
              ))}
            </Select>
            <Select label="Depreciation expense account" value={form.depreciation_account_id} onChange={(e) => setForm({ ...form, depreciation_account_id: e.target.value })} required>
              <option value="">Select account</option>
              {expenseAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.account_code} · {a.account_name}
                </option>
              ))}
            </Select>
            <Select label="Paid from" value={form.funding} onChange={(e) => setForm({ ...form, funding: e.target.value })}>
              <option value="bank">Bank</option>
              <option value="cash">Cash</option>
              <option value="credit">On credit (Sundry creditors)</option>
              <option value="opening">Opening balance (asset held before books start)</option>
              <option value="purchase_bill">Already booked on a purchase bill (capital goods line)</option>
            </Select>
            <Input label="Vendor" value={form.vendor_name} onChange={(e) => setForm({ ...form, vendor_name: e.target.value })} />
            <Input label="Invoice number" value={form.invoice_number} onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} />
            <div className="md:col-span-3 flex justify-end">
              <Button type="submit" disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Building2 className="w-4 h-4 mr-2" />}
                Capitalise asset
              </Button>
            </div>
          </form>
        </Card>
      )}

      {tab === 'register' && (
        <Card>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
            </div>
          ) : assets.length === 0 ? (
            <p className="text-center py-12 text-text-secondary">No fixed assets yet</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-3 px-4">Asset</th>
                    <th className="py-3 px-4">Put to use</th>
                    <th className="py-3 px-4">Method</th>
                    <th className="py-3 px-4 text-right">Cost</th>
                    <th className="py-3 px-4 text-right">Accumulated dep.</th>
                    <th className="py-3 px-4 text-right">Book value</th>
                    <th className="py-3 px-4">Depreciated to</th>
                    <th className="py-3 px-4" />
                  </tr>
                </thead>
                <tbody>
                  {assets.map((a) => (
                    <tr key={a.id} className="border-b border-border">
                      <td className="py-3 px-4">
                        <div className="font-medium">{a.asset_name}</div>
                        <div className="text-xs text-text-secondary font-mono">{a.asset_code}</div>
                      </td>
                      <td className="py-3 px-4">{format(new Date(a.put_to_use_on), 'dd MMM yyyy')}</td>
                      <td className="py-3 px-4">
                        {a.depreciation_method}
                        {a.depreciation_method === 'WDV' && a.depreciation_rate ? ` ${Number(a.depreciation_rate)}%` : ` ${a.useful_life_years}y`}
                      </td>
                      <td className="py-3 px-4 text-right">{inr(Number(a.purchase_cost))}</td>
                      <td className="py-3 px-4 text-right">{inr(Number(a.accumulated_depreciation || 0))}</td>
                      <td className="py-3 px-4 text-right">{inr(Number(a.current_book_value))}</td>
                      <td className="py-3 px-4 text-text-secondary">
                        {a.is_disposed
                          ? `Disposed ${a.disposal_date ? format(new Date(a.disposal_date), 'dd MMM yyyy') : ''}`
                          : a.last_depreciated_to
                            ? format(new Date(a.last_depreciated_to), 'dd MMM yyyy')
                            : 'Not yet'}
                      </td>
                      <td className="py-3 px-4">
                        {!a.is_disposed && (
                          <div className="flex gap-2 justify-end">
                            <Button size="sm" variant="outline" onClick={() => setAction({ kind: 'depreciate', asset: a })}>
                              Depreciate
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setAction({ kind: 'dispose', asset: a })}>
                              Dispose
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'it' && (
        <Card>
          <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
            <div className="w-48">
              <Select label="Financial year" value={fy} onChange={(e) => setFy(e.target.value)}>
                {fyOptions.map((f) => (
                  <option key={f} value={f}>
                    FY {f}
                  </option>
                ))}
              </Select>
            </div>
            <p className="text-xs text-text-secondary max-w-xl">
              Section 32 block WDV. Assets put to use for fewer than 180 days in their first year get half the rate.
              Sale proceeds reduce the block; an excess over the block is a short-term capital gain under section 50.
              Additional depreciation under section 32(1)(iia) is not included.
            </p>
          </div>
          {unclassified > 0 && (
            <p className="text-sm text-amber-700 bg-amber-50 rounded-md px-3 py-2 mb-4">
              {unclassified} asset(s) have no Income-tax block and are excluded.
            </p>
          )}
          {itLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
            </div>
          ) : itRows.length === 0 ? (
            <p className="text-center py-12 text-text-secondary">No classified assets for this year</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-3 px-4">Block</th>
                    <th className="py-3 px-4 text-right">Rate</th>
                    <th className="py-3 px-4 text-right">Opening WDV</th>
                    <th className="py-3 px-4 text-right">Additions (180+ days)</th>
                    <th className="py-3 px-4 text-right">Additions (&lt;180 days)</th>
                    <th className="py-3 px-4 text-right">Sales</th>
                    <th className="py-3 px-4 text-right">Depreciation</th>
                    <th className="py-3 px-4 text-right">Closing WDV</th>
                    <th className="py-3 px-4 text-right">STCG / (STCL)</th>
                  </tr>
                </thead>
                <tbody>
                  {itRows.map((r) => (
                    <tr key={r.block} className="border-b border-border">
                      <td className="py-3 px-4">{r.label}</td>
                      <td className="py-3 px-4 text-right">{r.rate}%</td>
                      <td className="py-3 px-4 text-right">{inr(r.openingWdv)}</td>
                      <td className="py-3 px-4 text-right">{inr(r.additionsFullRate)}</td>
                      <td className="py-3 px-4 text-right">{inr(r.additionsHalfRate)}</td>
                      <td className="py-3 px-4 text-right">{inr(r.sales)}</td>
                      <td className="py-3 px-4 text-right font-medium">{inr(r.depreciation)}</td>
                      <td className="py-3 px-4 text-right">{inr(r.closingWdv)}</td>
                      <td className="py-3 px-4 text-right">
                        {r.shortTermCapitalGain === 0
                          ? '-'
                          : r.shortTermCapitalGain > 0
                            ? inr(r.shortTermCapitalGain)
                            : `(${inr(-r.shortTermCapitalGain)})`}
                      </td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="py-3 px-4" colSpan={6}>
                      Total depreciation allowable
                    </td>
                    <td className="py-3 px-4 text-right">{inr(itRows.reduce((s, r) => s + r.depreciation, 0))}</td>
                    <td className="py-3 px-4 text-right">{inr(itRows.reduce((s, r) => s + r.closingWdv, 0))}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {action && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-lg">
            <form onSubmit={submitAction} className="space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-lg font-semibold">
                    {action.kind === 'depreciate' ? 'Post depreciation' : 'Dispose of asset'}
                  </h2>
                  <p className="text-sm text-text-secondary">
                    {action.asset.asset_name} · book value {inr(Number(action.asset.current_book_value))}
                  </p>
                </div>
                <button type="button" onClick={() => setAction(null)} aria-label="Close">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {action.kind === 'depreciate' ? (
                <>
                  <p className="text-sm text-text-secondary">
                    Depreciation runs from{' '}
                    {action.asset.last_depreciated_to
                      ? `the day after ${format(new Date(action.asset.last_depreciated_to), 'dd MMM yyyy')}`
                      : `the put-to-use date (${format(new Date(action.asset.put_to_use_on), 'dd MMM yyyy')})`}{' '}
                    to the date below, pro rata by days. One run cannot cross 31 March.
                  </p>
                  <Input
                    type="date"
                    label="Depreciate up to"
                    value={actionForm.period_end_date}
                    onChange={(e) => setActionForm({ ...actionForm, period_end_date: e.target.value })}
                    required
                  />
                </>
              ) : (
                <>
                  <Input
                    type="date"
                    label="Disposal date"
                    value={actionForm.disposal_date}
                    onChange={(e) => setActionForm({ ...actionForm, disposal_date: e.target.value })}
                    required
                  />
                  <Input
                    type="number"
                    label="Sale proceeds excluding GST (0 if scrapped)"
                    min="0"
                    step="0.01"
                    value={actionForm.disposal_amount}
                    onChange={(e) => setActionForm({ ...actionForm, disposal_amount: e.target.value })}
                  />
                  {Number(actionForm.disposal_amount) > 0 && (
                    <Select
                      label="Proceeds received in"
                      value={actionForm.proceeds_account_id}
                      onChange={(e) => setActionForm({ ...actionForm, proceeds_account_id: e.target.value })}
                    >
                      <option value="">Bank (1102)</option>
                      {proceedsAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.account_code} · {a.account_name}
                        </option>
                      ))}
                    </Select>
                  )}
                  <Input
                    label="Buyer"
                    value={actionForm.buyer_name}
                    onChange={(e) => setActionForm({ ...actionForm, buyer_name: e.target.value })}
                  />
                  <Input
                    label="Reason"
                    value={actionForm.reason}
                    onChange={(e) => setActionForm({ ...actionForm, reason: e.target.value })}
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={actionForm.charge_depreciation}
                      onChange={(e) => setActionForm({ ...actionForm, charge_depreciation: e.target.checked })}
                    />
                    Charge depreciation up to the disposal date first
                  </label>
                  <p className="text-xs text-text-secondary">
                    If GST applies to the sale, raise a tax invoice for the output tax (section 18(6) where ITC was claimed).
                  </p>
                </>
              )}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setAction(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <TrendingDown className="w-4 h-4 mr-2" />}
                  {action.kind === 'depreciate' ? 'Post depreciation' : 'Dispose'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
