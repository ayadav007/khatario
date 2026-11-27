'use client';

import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { useToastContext } from '@/contexts/ToastContext';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';
import { PlanChangeScopeChoice, type PlanChangeScope } from '@/components/admin/PlanChangeScopeChoice';

type PriceKey = 'price_monthly' | 'price_yearly' | 'price_3year';

const FIELDS: Array<{ key: PriceKey; label: string; hint?: string }> = [
  { key: 'price_monthly', label: 'Monthly price' },
  { key: 'price_yearly', label: 'Yearly price', hint: '0 = not offered' },
  { key: 'price_3year', label: '3-year price', hint: '0 = not offered' },
];

/** Rupees as typed (e.g. "299.50") to whole paise, or null when it is not a valid amount. */
function rupeesToPaise(text: string): number | null {
  const t = text.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}

const paiseToRupeesText = (paise: number) => (paise / 100).toFixed(2);

/**
 * Change a plan's prices. Amounts are typed in rupees (₹1 is the lowest price; 0 means "not offered", and a plan with
 * no price at all is free). The save asks who gets the new price, like the feature and limit screens.
 */
export function PlanPriceEditor({
  planId,
  planName,
  onClose,
}: {
  planId: string;
  planName: string;
  onClose: () => void;
}) {
  const toast = useToastContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [affected, setAffected] = useState<number | null>(null);
  const [onOlder, setOnOlder] = useState(0);
  const [current, setCurrent] = useState<Record<PriceKey, number> | null>(null);
  const [text, setText] = useState<Record<PriceKey, string>>({ price_monthly: '', price_yearly: '', price_3year: '' });
  const [confirming, setConfirming] = useState(false);
  const [scope, setScope] = useState<PlanChangeScope | null>(null);

  async function load() {
    try {
      setLoading(true);
      const res = await fetch(`/api/admin/plans/${planId}/prices`, { ...platformAdminFetchInit });
      if (!res.ok) throw new Error('Failed to load prices');
      const data = await res.json();
      setAffected(typeof data.affected_businesses === 'number' ? data.affected_businesses : null);
      setOnOlder(typeof data.on_older_terms === 'number' ? data.on_older_terms : 0);
      setCurrent(data.prices);
      setText({
        price_monthly: paiseToRupeesText(data.prices.price_monthly),
        price_yearly: paiseToRupeesText(data.prices.price_yearly),
        price_3year: paiseToRupeesText(data.prices.price_3year),
      });
    } catch (e) {
      console.error(e);
      toast.error('Failed to load plan prices');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  const parsed = FIELDS.map((f) => ({ ...f, paise: rupeesToPaise(text[f.key]) }));
  const problem = (() => {
    for (const f of parsed) {
      if (f.paise === null) return `${f.label}: enter an amount in rupees, such as 299 or 299.50.`;
      if (f.paise !== 0 && f.paise < 100) return `${f.label}: the lowest price is ₹1. Use 0 for "not offered".`;
    }
    const [m, y, t] = parsed.map((f) => f.paise as number);
    if (m === 0 && (y > 0 || t > 0)) return 'The monthly price cannot be 0 while a yearly or 3-year price is set.';
    return null;
  })();
  const changedPrices = (): Partial<Record<PriceKey, number>> => {
    const out: Partial<Record<PriceKey, number>> = {};
    if (!current) return out;
    for (const f of parsed) if (f.paise !== null && f.paise !== current[f.key]) out[f.key] = f.paise;
    return out;
  };
  const modified = Object.keys(changedPrices()).length > 0;

  async function save() {
    try {
      setSaving(true);
      const res = await fetch(`/api/admin/plans/${planId}/prices`, {
        ...platformAdminFetchInit,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prices: changedPrices(),
          confirm_affected_count: affected,
          scope: affected === 0 ? undefined : scope,
        }),
      });
      if (!res.ok) {
        const error = await res.json();
        if (res.status === 409 && typeof error.affected_businesses === 'number') {
          setAffected(error.affected_businesses);
          setConfirming(false);
          setScope(null);
          throw new Error('The number of businesses on this plan changed. Check the new number and save again.');
        }
        throw new Error(error.error || 'Failed to save prices');
      }
      toast.success('Plan prices updated successfully!');
      setConfirming(false);
      setScope(null);
      await load();
    } catch (e: any) {
      toast.error(`Failed to save: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Prices: {planName}</h2>
            <p className="text-gray-600 mt-1">
              {affected === null
                ? 'Loading…'
                : `${affected} ${affected === 1 ? 'business is' : 'businesses are'} on this plan${onOlder > 0 ? `, ${onOlder} on older terms` : ''}.`}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-2xl" disabled={saving}>
            ×
          </button>
        </div>

        {loading ? (
          <Loader2 className="w-8 h-8 animate-spin text-primary-600 mx-auto my-8" />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-4">
              {FIELDS.map((f) => (
                <label key={f.key} className="block text-sm font-medium text-gray-700">
                  {f.label} (₹)
                  <input
                    type="text"
                    inputMode="decimal"
                    value={text[f.key]}
                    onChange={(e) => {
                      setText((prev) => ({ ...prev, [f.key]: e.target.value }));
                      setConfirming(false);
                    }}
                    disabled={saving}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                  {f.hint ? <span className="block text-xs font-normal text-gray-500">{f.hint}</span> : null}
                </label>
              ))}
            </div>
            {problem ? <p className="mb-4 text-sm text-red-700" role="alert">{problem}</p> : null}

            {confirming && affected !== null ? (
              <PlanChangeScopeChoice affected={affected} scope={scope} onChange={setScope} disabled={saving} />
            ) : null}

            <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
              <button
                onClick={onClose}
                disabled={saving}
                className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => (confirming ? void save() : setConfirming(true))}
                disabled={
                  saving || !modified || !!problem || affected === null || (confirming && affected > 0 && scope === null)
                }
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition disabled:opacity-50 flex items-center space-x-2"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>{saving ? 'Saving...' : confirming ? 'Confirm and save' : 'Save Changes'}</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
