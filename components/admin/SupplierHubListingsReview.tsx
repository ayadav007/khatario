'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAdmin } from '@/context/AdminContext';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';
import { useToastContext } from '@/contexts/ToastContext';

type Listing = {
  business_id: string;
  name: string;
  city: string | null;
  state: string | null;
  gstin: string | null;
  phone: string | null;
  profile_summary: string | null;
  featured_categories: string[] | null;
  gst_status: string | null;
  gst_legal_name: string | null;
  gst_checked: boolean;
  updated_at: string;
};

const TABS = [
  { key: 'waiting', label: 'Waiting' },
  { key: 'listed', label: 'Listed' },
  { key: 'hidden', label: 'Hidden' },
] as const;

/** Platform review of Supplier Hub directory listings: approve, hide, and hold new ones. */
export function SupplierHubListingsReview() {
  const { admin } = useAdmin();
  const toast = useToastContext();
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('waiting');
  const [review, setReview] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Listing[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!admin?.id) return;
    const res = await fetch(`/api/admin/supplier-hub-listings?status=${tab}`, { ...platformAdminFetchInit });
    if (!res.ok) return setRows([]);
    const data = await res.json();
    setReview(data.review_listings);
    setRows(data.listings || []);
  }, [admin?.id, tab]);

  useEffect(() => {
    load();
  }, [load]);

  const patch = async (body: object, key: string, done: string) => {
    setBusy(key);
    try {
      const res = await fetch('/api/admin/supplier-hub-listings', {
        ...platformAdminFetchInit,
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save');
      toast.success(done);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Supplier Hub directory listings</h2>
          <p className="text-sm text-gray-600">Approve or hide businesses listed in Find suppliers.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            id="hub-review-listings"
            type="checkbox"
            checked={review === true}
            disabled={review === null || busy === 'review'}
            onChange={(e) =>
              patch(
                { review_listings: e.target.checked },
                'review',
                e.target.checked ? 'New listings now wait for review' : 'New listings show straight away'
              )
            }
          />
          Review new listings before they show
        </label>
      </div>
      <div className="flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-3 py-1 text-sm ${tab === t.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {rows === null ? (
        <Loader2 className="h-5 w-5 animate-spin text-gray-500" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">Nothing here.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((l) => (
            <li key={l.business_id} className="flex flex-wrap items-start justify-between gap-3 py-3">
              <div className="min-w-0 max-w-2xl text-sm">
                <p className="font-medium text-gray-900">{l.name}</p>
                <p className="text-gray-600">
                  {[l.city, l.state, l.phone].filter(Boolean).join(' · ')}
                  {l.gstin ? ` · GSTIN ${l.gstin}` : ' · No GSTIN'}
                </p>
                <p className="text-gray-600">
                  {l.gst_checked
                    ? `GST registry: ${l.gst_status || 'unknown'}${l.gst_legal_name ? `, registered as ${l.gst_legal_name}` : ''}`
                    : 'GST registry: not checked yet'}
                </p>
                {l.profile_summary && <p className="mt-1 text-gray-800">{l.profile_summary}</p>}
                {l.featured_categories?.length ? <p className="text-xs text-gray-500">{l.featured_categories.join(', ')}</p> : null}
              </div>
              <div className="flex gap-2">
                {tab !== 'listed' && (
                  <button
                    type="button"
                    disabled={busy === l.business_id}
                    onClick={() => patch({ business_id: l.business_id, approved: true }, l.business_id, `${l.name} is listed`)}
                    className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Approve
                  </button>
                )}
                {tab !== 'hidden' && (
                  <button
                    type="button"
                    disabled={busy === l.business_id}
                    onClick={() => patch({ business_id: l.business_id, approved: false }, l.business_id, `${l.name} is hidden`)}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 disabled:opacity-50"
                  >
                    Hide
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
