'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, X } from 'lucide-react';
import { FULFILMENT_STATUS_LABEL } from '@/lib/fulfilment/rules';
import {
  DEFAULT_ORDER_UPDATE_SETTINGS,
  NOTIFY_STATUS_HELP,
  NOTIFY_STATUSES,
  type OrderUpdateSettings,
} from '@/lib/fulfilment/update-settings';

export function OrderUpdateSettingsDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [settings, setSettings] = useState<OrderUpdateSettings>(DEFAULT_ORDER_UPDATE_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/orders/settings')
      .then((r) => r.json())
      .then((j) => j.settings && setSettings(j.settings))
      .catch(() => setError('Could not load settings'))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/orders/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not save');
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 md:rounded-2xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Buyer WhatsApp updates</h2>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>
        {loading ? (
          <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : (
          <div className="space-y-4 text-sm">
            <p className="text-slate-500">
              The buyer gets one message per step, with a link to follow the order. Messages use your approved templates
              when set in <Link href="/settings/whatsapp" className="text-primary underline">WhatsApp templates</Link>,
              otherwise a plain message from your connected number.
            </p>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
              {NOTIFY_STATUSES.map((s) => (
                <li key={s} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div>
                    <div className="font-medium">{FULFILMENT_STATUS_LABEL[s]}</div>
                    <div className="text-xs text-slate-500">{NOTIFY_STATUS_HELP[s]}</div>
                  </div>
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={settings.notify[s]}
                    onChange={(e) => setSettings({ ...settings, notify: { ...settings.notify, [s]: e.target.checked } })}
                  />
                </li>
              ))}
            </ul>
            <label className="block">
              <span className="font-medium">Dispatch within (hours)</span>
              <span className="block text-xs text-slate-500">Paid orders not sent out in this time show under “Paid, not dispatched”.</span>
              <input
                type="number"
                min={1}
                max={720}
                className="mt-1 w-28 rounded-lg border border-slate-300 px-2 py-1.5 dark:border-slate-600 dark:bg-slate-800"
                value={settings.dispatchSlaHours}
                onChange={(e) => setSettings({ ...settings, dispatchSlaHours: Number(e.target.value) || 24 })}
              />
            </label>
            <label className="flex items-center justify-between gap-3">
              <span>
                <span className="font-medium">Alert me about late orders</span>
                <span className="block text-xs text-slate-500">A WhatsApp to your business number when paid orders are late.</span>
              </span>
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={settings.merchantDispatchAlert}
                onChange={(e) => setSettings({ ...settings, merchantDispatchAlert: e.target.checked })}
              />
            </label>
            <p className="text-xs text-slate-500">
              Online store orders already get their own “order placed” and courier booking messages, so those are not sent twice.
            </p>
            {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{error}</div> : null}
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-lg px-3 py-2 text-slate-600" onClick={onClose}>Cancel</button>
              <button
                type="button"
                disabled={saving}
                className="rounded-lg bg-primary px-4 py-2 font-medium text-white disabled:opacity-60"
                onClick={() => void save()}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
