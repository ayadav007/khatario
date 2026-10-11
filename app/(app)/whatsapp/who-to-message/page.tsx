'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Lock, Users } from 'lucide-react';
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { WhatsAppAddonModal } from '@/components/subscription/WhatsAppAddonModal';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscriptionCheck } from '@/hooks/useSubscriptionCheck';
import { STACK_PAGE_CLASS, WIDE_PAGE_CONTENT_CLASS } from '@/lib/page-layout';
import {
  WHO_CONDITION_LABELS,
  WHO_TO_MESSAGE_DRAFT_KEY,
  type WhoCondition,
  type WhoToMessageDraft,
  type WhoToMessageRow,
} from '@/lib/whatsapp/who-to-message';

const CONDITIONS: { id: WhoCondition; hint: string }[] = [
  { id: 'quiet', hint: 'Bought before, then went quiet' },
  { id: 'top', hint: 'Highest bills in a period' },
  { id: 'once', hint: 'Only one bill so far' },
  { id: 'enquiry', hint: 'Asked on the store, never ordered' },
  { id: 'whatsapp', hint: 'Wrote on WhatsApp, no bill or order after' },
];

type SavedReply = { id: string; title: string; message: string };

export default function WhoToMessagePage() {
  const router = useRouter();
  const { business } = useAuth();
  const { hasFeature, loading: subscriptionLoading } = useSubscriptionCheck(business?.id);
  const hasAccess = hasFeature('whatsapp_bot');

  const [condition, setCondition] = useState<WhoCondition>('quiet');
  const [days, setDays] = useState(30);
  const [periodDays, setPeriodDays] = useState(30);
  const [limit, setLimit] = useState(10);
  const [people, setPeople] = useState<WhoToMessageRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replies, setReplies] = useState<SavedReply[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [showUpgrade, setShowUpgrade] = useState(false);

  useEffect(() => {
    if (!subscriptionLoading && !hasAccess) setShowUpgrade(true);
  }, [subscriptionLoading, hasAccess]);

  useEffect(() => {
    if (!hasAccess) return;
    fetch('/api/whatsapp/saved-replies')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.replies) setReplies(data.replies);
      })
      .catch(() => undefined);
  }, [hasAccess]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ condition });
    if (condition === 'quiet' || condition === 'enquiry' || condition === 'whatsapp') {
      params.set('days', String(days));
    }
    if (condition === 'top') {
      params.set('period_days', String(periodDays));
      params.set('limit', String(limit));
    }
    try {
      const res = await fetch(`/api/whatsapp/who-to-message?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setPeople([]);
        setError(data.error || 'Could not load this list');
        return;
      }
      setPeople(data.people || []);
      setSelected(new Set());
    } catch {
      setPeople([]);
      setError('Could not load this list');
    } finally {
      setLoading(false);
    }
  }, [condition, days, periodDays, limit]);

  useEffect(() => {
    if (hasAccess && business?.id) load();
  }, [hasAccess, business?.id, load]);

  const allSelected = people.length > 0 && people.every((p) => selected.has(p.phone));

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(people.map((p) => p.phone)));
  };

  const toggleOne = (phone: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(phone)) next.delete(phone);
      else next.add(phone);
      return next;
    });
  };

  const chosen = useMemo(() => people.filter((p) => selected.has(p.phone)), [people, selected]);

  const continueToCampaign = () => {
    const template = replies.find((r) => r.id === templateId);
    const draft: WhoToMessageDraft = {
      recipients: chosen.map((p) => ({ phone: p.phone, name: p.name })),
      messageText: template?.message || '',
      campaignName: WHO_CONDITION_LABELS[condition],
    };
    sessionStorage.setItem(WHO_TO_MESSAGE_DRAFT_KEY, JSON.stringify(draft));
    router.push('/whatsapp/send-message?tab=campaign');
  };

  if (subscriptionLoading) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <>
        <div className="mx-auto max-w-2xl py-8">
          <Card className="p-8 text-center">
            <Lock className="mx-auto mb-4 h-16 w-16 text-gray-400" />
            <h2 className="mb-2 text-2xl font-bold text-gray-900">Who to message is locked</h2>
            <p className="mb-6 text-gray-600">
              This list is part of Connect. Unlock WhatsApp campaigns to choose customers and send a message.
            </p>
            <Button onClick={() => setShowUpgrade(true)}>Unlock WhatsApp</Button>
          </Card>
        </div>
        {showUpgrade && (
          <WhatsAppAddonModal
            addonType="whatsapp_bot"
            onClose={() => setShowUpgrade(false)}
            onPurchaseSuccess={() => window.location.reload()}
          />
        )}
      </>
    );
  }

  return (
    <div className={`${WIDE_PAGE_CONTENT_CLASS} ${STACK_PAGE_CLASS}`}>
      <SettingsPageHeader
        title="Who to message"
        description="Pick a list, tick the people, choose a saved reply, then review the campaign before anything is sent."
        icon={Users}
      />

      <div className="flex flex-wrap gap-2">
        {CONDITIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setCondition(item.id)}
            className={`rounded-full border px-3 py-1.5 text-left text-sm ${
              condition === item.id
                ? 'border-primary-600 bg-primary-50 text-primary-800'
                : 'border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <span className="font-medium">{WHO_CONDITION_LABELS[item.id]}</span>
          </button>
        ))}
      </div>

      <Card>
        <p className="mb-3 text-sm text-gray-600">{CONDITIONS.find((c) => c.id === condition)?.hint}</p>
        {condition === 'top' ? (
          <div className="flex flex-wrap items-end gap-4">
            <label className="text-sm text-gray-700">
              Last
              <input
                type="number"
                min={1}
                max={365}
                value={periodDays}
                onChange={(e) => setPeriodDays(Number(e.target.value))}
                className="ml-2 w-20 rounded-md border border-gray-300 px-2 py-1 text-base"
              />
              days
            </label>
            <label className="text-sm text-gray-700">
              Show
              <input
                type="number"
                min={1}
                max={50}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                className="ml-2 w-20 rounded-md border border-gray-300 px-2 py-1 text-base"
              />
            </label>
            <div className="flex gap-2">
              {[30, 90, 365].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPeriodDays(n)}
                  className="rounded-md border border-gray-200 px-2 py-1 text-sm"
                >
                  {n}d
                </button>
              ))}
            </div>
          </div>
        ) : condition === 'once' ? (
          <p className="text-sm text-gray-600">Everyone with exactly one posted bill.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-gray-700">Quiet for</span>
            {[15, 30, 60].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setDays(n)}
                className={`rounded-md border px-2 py-1 text-sm ${
                  days === n ? 'border-primary-600 bg-primary-50' : 'border-gray-200'
                }`}
              >
                {n} days
              </button>
            ))}
            <input
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="w-20 rounded-md border border-gray-300 px-2 py-1 text-base"
              aria-label="Days"
            />
          </div>
        )}
      </Card>

      <Card padding="none" className="overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
          </div>
        ) : error ? (
          <p className="p-6 text-sm text-red-600">{error}</p>
        ) : people.length === 0 ? (
          <p className="p-6 text-sm text-gray-600">
            No one matches. People without a phone, people who opted out, and anyone already in a campaign this week are left off.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-600">
                <tr>
                  <th className="px-4 py-3">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select everyone on this list" />
                  </th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Why they are here</th>
                </tr>
              </thead>
              <tbody>
                {people.map((person) => (
                  <tr key={person.phone} className="border-t border-gray-100">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(person.phone)}
                        onChange={() => toggleOne(person.phone)}
                        aria-label={`Select ${person.name}`}
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{person.name}</td>
                    <td className="px-4 py-3 text-gray-700">{person.phone}</td>
                    <td className="px-4 py-3 text-gray-600">{person.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:flex-row sm:items-end sm:justify-between">
        <label className="block text-sm text-gray-700">
          Saved reply
          <select
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="mt-1 block w-full min-w-[16rem] rounded-md border border-gray-300 px-2 py-2 text-base sm:w-80"
          >
            <option value="">Write the message on the next screen</option>
            {replies.map((reply) => (
              <option key={reply.id} value={reply.id}>
                {reply.title}
              </option>
            ))}
          </select>
        </label>
        <Button onClick={continueToCampaign} disabled={chosen.length === 0}>
          Continue with {chosen.length} {chosen.length === 1 ? 'person' : 'people'}
        </Button>
      </div>
    </div>
  );
}
