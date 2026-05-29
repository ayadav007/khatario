'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Calendar, Clock, History, Loader2 } from 'lucide-react';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';
import type { SubscriptionEventRow, TrialAdminSummary } from '@/lib/subscription/trial-admin-summary';

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value.includes('T') ? value : `${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function eventLabel(type: string): string {
  const labels: Record<string, string> = {
    trial_extension_granted: 'Trial extension accepted',
    trial_extension_declined: 'Chose Free plan (declined extension)',
    trial_expired: 'Trial expired → Free',
    trial_expired_sync: 'Trial expired (sync)',
    admin_updated: 'Admin updated subscription',
    downgraded: 'Downgraded',
    upgraded: 'Upgraded',
    payment_succeeded: 'Payment succeeded',
    payment_failed: 'Payment failed',
    cancelled: 'Cancelled',
    created: 'Subscription created',
  };
  return labels[type] ?? type.replace(/_/g, ' ');
}

function SummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-1 py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500 shrink-0">{label}</span>
      <span className="text-sm font-medium text-gray-900 sm:text-right">{value}</span>
    </div>
  );
}

export interface SubscriptionTrialHistoryProps {
  businessId: string;
}

export function SubscriptionTrialHistory({ businessId }: SubscriptionTrialHistoryProps) {
  const [trial, setTrial] = useState<TrialAdminSummary | null>(null);
  const [events, setEvents] = useState<SubscriptionEventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/businesses/${businessId}/subscription-history`,
        platformAdminFetchInit,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load history');
      setTrial(data.trial ?? null);
      setEvents(data.events ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-border p-6 flex items-center gap-2 text-gray-500">
        <Loader2 className="w-5 h-5 animate-spin" />
        Loading trial & subscription history…
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-sm text-red-800">
        {error}
      </div>
    );
  }

  const onTrialPlan = trial?.plan_id === 'trial';

  return (
    <div className="bg-white rounded-xl border border-border p-6 space-y-6">
      <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
        <History className="w-5 h-5 text-gray-500" />
        Trial & subscription history
      </h2>

      {!trial ? (
        <p className="text-sm text-gray-600">No subscription record for this business.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-lg border border-border p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-gray-400" />
                Trial timeline
              </h3>
              <SummaryRow label="Plan / status" value={`${trial.plan_id ?? '—'} / ${trial.status ?? '—'}`} />
              <SummaryRow label="Trial started" value={formatDate(trial.start_date)} />
              <SummaryRow
                label="Estimated original trial end"
                value={
                  <>
                    {formatDate(trial.estimated_original_trial_end_date)}
                    <span className="block text-xs font-normal text-gray-500 mt-0.5">
                      {trial.start_date ? `${trial.start_date} + 30 days` : 'Based on signup date'}
                    </span>
                  </>
                }
              />
              <SummaryRow label="Current trial end" value={formatDate(trial.current_trial_end_date)} />
              <SummaryRow
                label="Trial expired (calendar)"
                value={
                  onTrialPlan ? (
                    trial.is_trial_calendar_expired ? (
                      <span className="text-amber-700">Yes</span>
                    ) : (
                      <span className="text-green-700">No — still active</span>
                    )
                  ) : (
                    'N/A (not on trial plan)'
                  )
                }
              />
            </div>

            <div className="rounded-lg border border-border p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4 text-gray-400" />
                One-time extension
              </h3>
              <SummaryRow
                label="Extension used"
                value={
                  trial.trial_extension_granted ? (
                    <span className="text-green-700">Yes</span>
                  ) : trial.trial_extension_declined_at ? (
                    <span className="text-gray-700">No — chose Free</span>
                  ) : (
                    <span className="text-gray-700">No</span>
                  )
                }
              />
              <SummaryRow label="Extension length" value={`${trial.extension_days} days`} />
              <SummaryRow label="Accepted at" value={formatDateTime(trial.extension_granted_at)} />
              <SummaryRow label="Extended until" value={formatDate(trial.extension_new_end_date)} />
              <SummaryRow label="Declined Free at" value={formatDateTime(trial.trial_extension_declined_at)} />
              <SummaryRow
                label="Extend popup eligible now"
                value={
                  trial.extension_offer_active ? (
                    <span className="text-amber-700">Yes — waiting on tenant</span>
                  ) : (
                    <span className="text-gray-600">No</span>
                  )
                }
              />
            </div>
          </div>

          <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            {trial.extension_offer_note}
          </p>
        </>
      )}

      <div>
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Subscription events</h3>
        {events.length === 0 ? (
          <p className="text-sm text-gray-600">No subscription events logged yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-gray-500 border-b border-border">
                <tr>
                  <th className="py-2 pr-4">When</th>
                  <th className="py-2 pr-4">Event</th>
                  <th className="py-2 pr-4">From → To</th>
                  <th className="py-2">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {events.map((ev) => (
                  <tr key={ev.id}>
                    <td className="py-2 pr-4 whitespace-nowrap text-gray-700">
                      {formatDateTime(ev.created_at)}
                    </td>
                    <td className="py-2 pr-4 font-medium text-gray-900">{eventLabel(ev.event_type)}</td>
                    <td className="py-2 pr-4 text-gray-600">
                      {[ev.from_plan_id, ev.to_plan_id].filter(Boolean).join(' → ') || '—'}
                    </td>
                    <td className="py-2 text-gray-600 max-w-xs truncate" title={JSON.stringify(ev.details)}>
                      {Object.keys(ev.details).length > 0
                        ? JSON.stringify(ev.details)
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
