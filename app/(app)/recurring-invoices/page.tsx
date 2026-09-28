'use client';

export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Loader2, Pause, Play, Zap } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';

interface Recurring {
  id: string;
  customer_name: string | null;
  template_invoice_number: string | null;
  frequency: string;
  interval_value: number;
  start_date: string;
  end_date: string | null;
  next_run_date: string;
  last_run_date: string | null;
  is_active: boolean;
  auto_finalize: boolean;
  last_error: string | null;
  invoices_raised: number;
}

interface InvoiceLite {
  id: string;
  invoice_number: string;
  invoice_date: string;
  customer_id: string | null;
  grand_total: number | string;
}

const FREQ_LABEL: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  half_yearly: 'Half-yearly',
  yearly: 'Yearly',
};

export default function RecurringInvoicesPage() {
  const { business } = useAuth();
  const toast = useToastContext();
  const [rows, setRows] = useState<Recurring[]>([]);
  const [customers, setCustomers] = useState<Array<{ id: string; name: string }>>([]);
  const [invoices, setInvoices] = useState<InvoiceLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [form, setForm] = useState({
    customer_id: '',
    template_invoice_id: '',
    frequency: 'monthly',
    interval_value: '1',
    start_date: format(new Date(), 'yyyy-MM-dd'),
    end_date: '',
    auto_finalize: false,
    notes: '',
  });

  const bizQ = business?.id ? `business_id=${encodeURIComponent(business.id)}` : '';

  const load = useCallback(async () => {
    if (!business?.id) return;
    setLoading(true);
    try {
      const [rRes, cRes, iRes] = await Promise.all([
        fetch(`/api/recurring-invoices?${bizQ}`),
        fetch(`/api/customers?${bizQ}&limit=1000`),
        fetch(`/api/invoices?${bizQ}&status=final&limit=200`),
      ]);
      const r = await rRes.json();
      if (!rRes.ok) throw new Error(r.error || 'Failed to load');
      setRows(r.recurringInvoices || []);
      setCustomers((await cRes.json()).customers || []);
      setInvoices((await iRes.json()).invoices || []);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [business?.id, bizQ, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const customerInvoices = useMemo(
    () => invoices.filter((i) => i.customer_id === form.customer_id),
    [invoices, form.customer_id]
  );

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id) return;
    setSaving(true);
    try {
      const res = await fetch('/api/recurring-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          customer_id: form.customer_id,
          template_invoice_id: form.template_invoice_id,
          frequency: form.frequency,
          interval_value: Number(form.interval_value),
          start_date: form.start_date,
          end_date: form.end_date || null,
          auto_finalize: form.auto_finalize,
          notes: form.notes || null,
          items: [],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create');
      toast.success('Recurring invoice scheduled');
      setForm((f) => ({ ...f, template_invoice_id: '', notes: '' }));
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  const patch = async (id: string, body: Record<string, unknown>) => {
    if (!business?.id) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/recurring-invoices/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id, ...body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const runNow = async (id: string) => {
    if (!business?.id) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/recurring-invoices/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: business.id, action: 'run_now' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Run failed');
      const n = data.created?.length || 0;
      if (n) toast.success(`Raised ${n} invoice${n > 1 ? 's' : ''}: ${data.created.map((c: any) => c.invoice_number).join(', ')}`);
      else toast.info(data.message || 'Nothing due today');
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Recurring invoices</h1>
        <p className="text-sm text-text-secondary mt-1">
          Raise an invoice automatically on a schedule, copied from an existing invoice. Runs daily; each period is
          raised only once.
        </p>
      </div>

      <Card>
        <form onSubmit={create} className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">Customer</label>
            <select
              className="w-full rounded-md border border-border px-3 py-2 text-sm"
              value={form.customer_id}
              onChange={(e) => setForm({ ...form, customer_id: e.target.value, template_invoice_id: '' })}
              required
            >
              <option value="">Select</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">Copy lines from invoice</label>
            <select
              className="w-full rounded-md border border-border px-3 py-2 text-sm"
              value={form.template_invoice_id}
              onChange={(e) => setForm({ ...form, template_invoice_id: e.target.value })}
              required
              disabled={!form.customer_id}
            >
              <option value="">{form.customer_id && !customerInvoices.length ? 'No final invoices' : 'Select'}</option>
              {customerInvoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.invoice_number} · {String(i.invoice_date).slice(0, 10)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">Every</label>
              <input
                type="number"
                min={1}
                max={36}
                className="w-full rounded-md border border-border px-3 py-2 text-sm"
                value={form.interval_value}
                onChange={(e) => setForm({ ...form, interval_value: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">&nbsp;</label>
              <select
                className="w-full rounded-md border border-border px-3 py-2 text-sm"
                value={form.frequency}
                onChange={(e) => setForm({ ...form, frequency: e.target.value })}
              >
                {Object.entries(FREQ_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <Input
            type="date"
            label="First invoice date"
            value={form.start_date}
            onChange={(e) => setForm({ ...form, start_date: e.target.value })}
            required
          />
          <Input
            type="date"
            label="End date (optional)"
            value={form.end_date}
            onChange={(e) => setForm({ ...form, end_date: e.target.value })}
          />
          <Input label="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              checked={form.auto_finalize}
              onChange={(e) => setForm({ ...form, auto_finalize: e.target.checked })}
            />
            Finalise automatically (otherwise each invoice is saved as a draft for review)
          </label>
          <div className="md:col-span-4 flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Schedule
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-center py-12 text-text-secondary">No recurring invoices yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-3 px-3">Customer</th>
                  <th className="py-3 px-3">Template</th>
                  <th className="py-3 px-3">Schedule</th>
                  <th className="py-3 px-3">Next run</th>
                  <th className="py-3 px-3">Raised</th>
                  <th className="py-3 px-3">Mode</th>
                  <th className="py-3 px-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-border align-top">
                    <td className="py-3 px-3">
                      {r.customer_name || '-'}
                      {r.last_error && <p className="mt-1 text-xs text-red-600">{r.last_error}</p>}
                    </td>
                    <td className="py-3 px-3 font-mono">{r.template_invoice_number || 'Custom lines'}</td>
                    <td className="py-3 px-3">
                      {r.interval_value > 1 ? `Every ${r.interval_value} × ` : ''}
                      {FREQ_LABEL[r.frequency] || r.frequency}
                      {r.end_date ? ` until ${r.end_date}` : ''}
                    </td>
                    <td className="py-3 px-3">{r.is_active ? r.next_run_date : 'Paused'}</td>
                    <td className="py-3 px-3">{r.invoices_raised}</td>
                    <td className="py-3 px-3">
                      <button
                        type="button"
                        className="text-primary-600 hover:underline"
                        disabled={busyId === r.id}
                        onClick={() => patch(r.id, { auto_finalize: !r.auto_finalize })}
                      >
                        {r.auto_finalize ? 'Final' : 'Draft'}
                      </button>
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap text-right">
                      <button
                        type="button"
                        title={r.is_active ? 'Pause' : 'Resume'}
                        className="mr-3 text-text-secondary hover:text-text-primary"
                        disabled={busyId === r.id}
                        onClick={() => patch(r.id, { is_active: !r.is_active })}
                      >
                        {r.is_active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      </button>
                      <button
                        type="button"
                        title="Raise anything due today"
                        className="text-primary-600 disabled:opacity-40"
                        disabled={!r.is_active || busyId === r.id}
                        onClick={() => runNow(r.id)}
                      >
                        <Zap className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
