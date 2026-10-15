'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { useToastContext } from '@/contexts/ToastContext';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';

type FeatureRow = {
  id: string;
  category: string;
  label: string;
  show_on_pricing: boolean;
  pricing_label: string | null;
  pricing_rank: number;
};
type LimitRow = {
  limit_key: string;
  category: string;
  label: string;
  show_on_pricing: boolean;
  pricing_label_one: string | null;
  pricing_label_many: string | null;
  pricing_rank: number;
};
type PlanRow = { id: string; display_name: string; product_line: string | null; pricing_badge: string | null };

const CATEGORY_LABELS: Record<string, string> = {
  sales: 'Billing & GST',
  reports: 'Reports',
  integrations: 'WhatsApp & payments',
  inventory: 'Stock & barcodes',
  purchase: 'Purchases & expenses',
  accounting: 'Accounting',
  advanced: 'Growth tools',
  settings: 'Business & team',
  tools: 'Tools',
  hr: 'HR & attendance',
};

const INPUT = 'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500';

/**
 * Admin › Plans › Pricing page: wording, order and visibility of rows on the public pricing section.
 * Which plan includes a feature is still set in each plan's feature matrix.
 */
export function PricingDisplaySettings({ onClose }: { onClose: () => void }) {
  const toast = useToastContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [features, setFeatures] = useState<FeatureRow[]>([]);
  const [limits, setLimits] = useState<LimitRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [modified, setModified] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/pricing-display', { ...platformAdminFetchInit });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load');
        if (cancelled) return;
        setFeatures(data.features ?? []);
        setLimits(data.limits ?? []);
        setPlans(data.plans ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const byCategory = useMemo(() => {
    const map = new Map<string, FeatureRow[]>();
    for (const f of features) map.set(f.category, [...(map.get(f.category) ?? []), f]);
    const order = Object.keys(CATEGORY_LABELS);
    const position = (c: string) => (order.includes(c) ? order.indexOf(c) : order.length);
    return Array.from(map.entries()).sort(([a], [b]) => position(a) - position(b));
  }, [features]);

  const patchFeature = (id: string, patch: Partial<FeatureRow>) => {
    setFeatures((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setModified(true);
  };
  const patchLimit = (key: string, patch: Partial<LimitRow>) => {
    setLimits((rows) => rows.map((r) => (r.limit_key === key ? { ...r, ...patch } : r)));
    setModified(true);
  };
  const patchPlan = (id: string, badge: string) => {
    setPlans((rows) => rows.map((r) => (r.id === id ? { ...r, pricing_badge: badge } : r)));
    setModified(true);
  };

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/pricing-display', {
        ...platformAdminFetchInit,
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features, limits, plans }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      toast.success('Pricing page updated');
      setModified(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-white p-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Pricing page</h2>
            <p className="mt-1 max-w-3xl text-sm text-gray-600">
              How plans read on the home page. A feature appears under a plan only when it is switched on in that
              plan&apos;s feature matrix. Here you choose its wording, its order (lower number shows first on a plan
              card) and whether it is listed at all.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-2xl text-gray-500 hover:text-gray-700" disabled={saving}>
            ×
          </button>
        </div>

        {loading ? (
          <div className="py-16 text-center">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary-600" aria-label="Loading" />
          </div>
        ) : error ? (
          <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>
        ) : (
          <div className="space-y-8">
            <section>
              <h3 className="mb-2 text-lg font-semibold text-gray-900">Plan badges</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {plans.map((p) => (
                  <label key={p.id} className="block rounded-lg border border-gray-200 p-3 text-sm">
                    <span className="font-medium text-gray-900">{p.display_name}</span>
                    <input
                      id={`badge-${p.id}`}
                      className={`${INPUT} mt-1`}
                      placeholder="No badge"
                      value={p.pricing_badge ?? ''}
                      onChange={(e) => patchPlan(p.id, e.target.value)}
                    />
                  </label>
                ))}
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-lg font-semibold text-gray-900">Limits</h3>
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                    <tr>
                      <th className="px-3 py-2">Show</th>
                      <th className="px-3 py-2">Limit</th>
                      <th className="px-3 py-2">Wording for 1</th>
                      <th className="px-3 py-2">Wording for many</th>
                      <th className="px-3 py-2">Order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {limits.map((l) => (
                      <tr key={l.limit_key} className="border-t border-gray-100">
                        <td className="px-3 py-2">
                          <input
                            id={`limit-show-${l.limit_key}`}
                            type="checkbox"
                            className="h-4 w-4"
                            checked={l.show_on_pricing}
                            onChange={(e) => patchLimit(l.limit_key, { show_on_pricing: e.target.checked })}
                          />
                        </td>
                        <td className="px-3 py-2 text-gray-700">{l.label}</td>
                        <td className="px-3 py-2">
                          <input id={`limit-one-${l.limit_key}`} className={INPUT} placeholder="user" value={l.pricing_label_one ?? ''} onChange={(e) => patchLimit(l.limit_key, { pricing_label_one: e.target.value })} />
                        </td>
                        <td className="px-3 py-2">
                          <input id={`limit-many-${l.limit_key}`} className={INPUT} placeholder="users" value={l.pricing_label_many ?? ''} onChange={(e) => patchLimit(l.limit_key, { pricing_label_many: e.target.value })} />
                        </td>
                        <td className="w-24 px-3 py-2">
                          <input id={`limit-rank-${l.limit_key}`} type="number" className={INPUT} value={l.pricing_rank} onChange={(e) => patchLimit(l.limit_key, { pricing_rank: Number(e.target.value) })} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-lg font-semibold text-gray-900">Features</h3>
              <div className="space-y-4">
                {byCategory.map(([category, rows]) => (
                  <div key={category} className="overflow-x-auto rounded-lg border border-gray-200">
                    <div className="bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700">{CATEGORY_LABELS[category] ?? category}</div>
                    <table className="w-full min-w-[640px] text-sm">
                      <tbody>
                        {rows.map((f) => (
                          <tr key={f.id} className={`border-t border-gray-100 ${f.show_on_pricing ? '' : 'bg-gray-50 text-gray-400'}`}>
                            <td className="w-12 px-3 py-2">
                              <input
                                id={`feature-show-${f.id}`}
                                type="checkbox"
                                className="h-4 w-4"
                                aria-label={`Show ${f.label} on pricing`}
                                checked={f.show_on_pricing}
                                onChange={(e) => patchFeature(f.id, { show_on_pricing: e.target.checked })}
                              />
                            </td>
                            <td className="w-64 px-3 py-2">
                              <div className="text-gray-800">{f.label}</div>
                              <div className="font-mono text-xs text-gray-400">{f.id}</div>
                            </td>
                            <td className="px-3 py-2">
                              <input
                                id={`feature-label-${f.id}`}
                                className={INPUT}
                                placeholder={f.label}
                                aria-label={`Pricing wording for ${f.label}`}
                                value={f.pricing_label ?? ''}
                                onChange={(e) => patchFeature(f.id, { pricing_label: e.target.value })}
                              />
                            </td>
                            <td className="w-24 px-3 py-2">
                              <input
                                id={`feature-rank-${f.id}`}
                                type="number"
                                className={INPUT}
                                aria-label={`Order for ${f.label}`}
                                value={f.pricing_rank}
                                onChange={(e) => patchFeature(f.id, { pricing_rank: Number(e.target.value) })}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3 border-t border-gray-200 pt-4">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg bg-gray-100 px-4 py-2 text-gray-700 hover:bg-gray-200 disabled:opacity-50">
            Close
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !modified || !!error}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
