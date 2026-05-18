'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';

type WebhookEvent = {
  id: string;
  provider: string;
  event_type: string;
  status: string;
  business_name: string | null;
  processing_notes: string | null;
  created_at: string;
};

type Transaction = {
  id: string;
  business_name?: string;
  plan_display_name?: string;
  type: string;
  status: string;
  amount: string;
  payment_method: string | null;
  payment_reference: string | null;
  created_at: string;
};

export function AdminBillingDashboard() {
  const [tab, setTab] = useState<'events' | 'transactions'>('events');
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const view = tab === 'events' ? 'events' : 'transactions';
      const res = await fetch(`/api/admin/billing/events?view=${view}&limit=40`, platformAdminFetchInit);
      const data = await res.json();
      if (res.ok) {
        setWarning(data.warning || null);
        if (tab === 'events') setEvents(data.events || []);
        else setTransactions(data.transactions || []);
      }
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Billing & webhooks</h1>
        <p className="text-gray-600 mt-2">
          Platform subscription payments and Razorpay webhook audit log.
        </p>
        <p className="text-sm text-gray-500 mt-2">
          Webhook URL:{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">
            /api/webhooks/platform-billing/razorpay
          </code>
          — notes must include <code className="text-xs">business_id</code> and optional{' '}
          <code className="text-xs">plan_id</code>.
        </p>
      </div>

      {warning && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">{warning}</p>
      )}

      <div className="flex gap-2 border-b border-border">
        {(['events', 'transactions'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-600'
            }`}
          >
            {t === 'events' ? 'Webhook events' : 'All transactions'}
          </button>
        ))}
        <button type="button" onClick={() => void load()} className="ml-auto text-sm text-primary-600">
          Refresh
        </button>
      </div>

      {loading ? (
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      ) : tab === 'events' ? (
        <div className="overflow-x-auto border border-border rounded-xl bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-left">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Provider</th>
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2">Business</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {events.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-gray-500 text-center">
                    No webhook events yet.
                  </td>
                </tr>
              ) : (
                events.map((e) => (
                  <tr key={e.id}>
                    <td className="px-3 py-2 whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2">{e.provider}</td>
                    <td className="px-3 py-2">{e.event_type}</td>
                    <td className="px-3 py-2">{e.business_name || '—'}</td>
                    <td className="px-3 py-2">{e.status}</td>
                    <td className="px-3 py-2 text-gray-600 max-w-xs truncate">{e.processing_notes || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto border border-border rounded-xl bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-left">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Business</th>
                <th className="px-3 py-2">Plan</th>
                <th className="px-3 py-2">Amount</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Method</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {transactions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-gray-500 text-center">
                    No billing transactions yet.
                  </td>
                </tr>
              ) : (
                transactions.map((t) => (
                  <tr key={t.id}>
                    <td className="px-3 py-2 whitespace-nowrap">{new Date(t.created_at).toLocaleString()}</td>
                    <td className="px-3 py-2">{t.business_name || '—'}</td>
                    <td className="px-3 py-2">{t.plan_display_name || '—'}</td>
                    <td className="px-3 py-2">₹{t.amount}</td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          t.status === 'completed'
                            ? 'text-green-700'
                            : t.status === 'failed'
                              ? 'text-red-600'
                              : 'text-gray-600'
                        }
                      >
                        {t.status}
                      </span>
                    </td>
                    <td className="px-3 py-2">{t.payment_method || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
