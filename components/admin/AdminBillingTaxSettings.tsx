'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';
import {
  GST_CONFIRM_PHRASE,
  GST_MODE_OPTIONS,
  gstErrorField,
  needsTypedConfirm,
  type GstField,
  type GstMode,
} from '@/lib/subscription/refund-view';

type Settings = {
  mode: GstMode;
  rate_percent: number;
  seller_gstin: string | null;
  seller_legal_name: string | null;
  seller_address: string | null;
  seller_state_code: string | null;
  sac_code: string;
  invoice_prefix: string;
  updated_at?: string | null;
};

const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 disabled:bg-gray-50 disabled:text-gray-600';

/** GST on what customers pay Khatario for plans. Anyone with admin access can read it; only a super admin can change it. */
export function AdminBillingTaxSettings({ canEdit }: { canEdit: boolean }) {
  const [saved, setSaved] = useState<Settings | null>(null);
  const [form, setForm] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [typed, setTyped] = useState('');

  const apply = useCallback((s: Settings) => {
    setSaved(s);
    setForm({ ...s });
    setTyped('');
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/settings/billing-tax', platformAdminFetchInit);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not load the GST settings');
        apply(data.settings);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : 'Could not load the GST settings');
      } finally {
        setLoading(false);
      }
    })();
  }, [apply]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-600">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading GST settings…
      </div>
    );
  }
  if (!saved || !form) return <p className="text-sm text-red-700">{loadError}</p>;

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setForm({ ...form, [key]: value });
  const typedNeeded = needsTypedConfirm(saved.mode, form.mode, String(form.rate_percent).trim() !== String(saved.rate_percent).trim());
  const canSave = canEdit && !saving && (!typedNeeded || typed.trim() === GST_CONFIRM_PHRASE);
  const errField: GstField | null = error ? gstErrorField(error) : null;
  const fieldError = (f: GstField) => (errField === f ? <p role="alert" className="mt-1 text-xs text-red-600">{error}</p> : null);
  const ring = (f: GstField) => (errField === f ? ' border-red-400' : '');

  async function save() {
    if (!form) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/admin/settings/billing-tax', {
        ...platformAdminFetchInit,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: form.mode,
          rate_percent: String(form.rate_percent).trim(),
          seller_gstin: form.seller_gstin ?? '',
          seller_legal_name: form.seller_legal_name ?? '',
          seller_address: form.seller_address ?? '',
          seller_state_code: form.seller_state_code ?? '',
          sac_code: form.sac_code,
          invoice_prefix: form.invoice_prefix,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save the GST settings');
      apply(data.settings);
      setNotice('Saved. Payment links already sent keep the amounts they were created with. New payments use these settings.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the GST settings');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">GST on plan payments</h2>
        <p className="text-sm text-gray-600 mt-1">
          What customers pay Khatario for plans. Check the mode, rate and seller details with your accountant before switching GST on.
        </p>
        {!canEdit ? (
          <p className="mt-2 rounded-lg bg-gray-100 p-3 text-sm text-gray-700">You can view these settings. Only a super admin can change them.</p>
        ) : null}
      </div>

      <fieldset className="space-y-2" disabled={!canEdit}>
        <legend className="font-medium text-gray-900 mb-1">Mode</legend>
        {GST_MODE_OPTIONS.map((o) => (
          <label key={o.value} className={`flex items-start gap-3 rounded-lg border p-3 ${form.mode === o.value ? 'border-primary-600 ring-1 ring-primary-600' : 'border-gray-200'} ${canEdit ? 'cursor-pointer' : ''}`}>
            <input type="radio" name="gst-mode" className="mt-1" checked={form.mode === o.value} onChange={() => set('mode', o.value)} />
            <span>
              <span className="block text-sm font-medium text-gray-900">{o.label}</span>
              <span className="block text-xs text-gray-600">{o.explain}</span>
            </span>
          </label>
        ))}
        {fieldError('mode')}
      </fieldset>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="gst-rate">GST rate (%)</label>
          <input id="gst-rate" inputMode="decimal" className={inputClass + ring('rate_percent')} disabled={!canEdit} value={String(form.rate_percent)} onChange={(e) => set('rate_percent', e.target.value as unknown as number)} />
          {fieldError('rate_percent')}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="gst-sac">SAC code</label>
          <input id="gst-sac" className={inputClass + ring('sac_code')} disabled={!canEdit} value={form.sac_code} onChange={(e) => set('sac_code', e.target.value)} />
          {fieldError('sac_code')}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="gst-gstin">Seller GSTIN</label>
          <input id="gst-gstin" className={inputClass + ring('seller_gstin') + ' uppercase'} disabled={!canEdit} value={form.seller_gstin ?? ''} onChange={(e) => set('seller_gstin', e.target.value.toUpperCase())} />
          {fieldError('seller_gstin')}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="gst-state">Seller state code</label>
          <input id="gst-state" className={inputClass + ring('seller_state_code')} disabled={!canEdit} value={form.seller_state_code ?? ''} onChange={(e) => set('seller_state_code', e.target.value)} />
          <p className="mt-1 text-xs text-gray-500">Two digits. Leave empty to take it from the GSTIN.</p>
          {fieldError('seller_state_code')}
        </div>
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="gst-name">Seller legal name</label>
          <input id="gst-name" className={inputClass + ring('seller_legal_name')} disabled={!canEdit} value={form.seller_legal_name ?? ''} onChange={(e) => set('seller_legal_name', e.target.value)} />
          {fieldError('seller_legal_name')}
        </div>
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="gst-address">Seller address</label>
          <textarea id="gst-address" rows={2} className={inputClass + ring('seller_address')} disabled={!canEdit} value={form.seller_address ?? ''} onChange={(e) => set('seller_address', e.target.value)} />
          {fieldError('seller_address')}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="gst-prefix">Invoice number prefix</label>
          <input id="gst-prefix" className={inputClass + ring('invoice_prefix') + ' uppercase'} disabled={!canEdit} value={form.invoice_prefix} onChange={(e) => set('invoice_prefix', e.target.value.toUpperCase())} />
          <p className="mt-1 text-xs text-gray-500">Numbers run per financial year, for example {form.invoice_prefix || 'KH'}/2026-27/000001.</p>
          {fieldError('invoice_prefix')}
        </div>
      </div>

      {canEdit && typedNeeded ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">This changes what customers are charged or shown.</p>
          <p className="mt-1">
            From the next payment, customers will {form.mode === 'exclusive' ? 'pay GST on top of the listed price' : 'see the GST part of the listed price and get a tax invoice'}. Type{' '}
            <span className="font-mono font-semibold">{GST_CONFIRM_PHRASE}</span> to confirm.
          </p>
          <input aria-label="Type the confirmation words" className="mt-2 w-full rounded-lg border border-amber-300 px-3 py-2 font-mono" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </div>
      ) : null}

      {error && !errField ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
      {notice ? <p role="status" className="text-sm text-green-700">{notice}</p> : null}

      {canEdit ? (
        <button type="button" onClick={save} disabled={!canSave} className="flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save GST settings
        </button>
      ) : null}
    </div>
  );
}
