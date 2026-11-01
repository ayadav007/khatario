'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { KHATA_RULE_LABEL, type KhataRule } from '@/lib/khata/rules';

type Settings = {
  overLimitRule: KhataRule;
  overdueRule: KhataRule;
  graceDays: number;
  reminderIntervalDays: number;
  allowPartPayment: boolean;
  statementsEnabled: boolean;
};

const RULES = Object.keys(KHATA_RULE_LABEL) as KhataRule[];

/**
 * Business rules for store khata (docs/plan/STORE_KHATA.md): what happens when a khata customer
 * is over the limit or has overdue bills, grace days, statements and reminders. Each customer's
 * khata is opened from the customer page.
 */
export function StoreKhataSettings() {
  const [s, setS] = useState<Settings | null>(null);
  const [counts, setCounts] = useState({ open: 0, requests: 0 });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/settings/khata', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      setS(data.settings);
      setCounts({ open: data.open_khatas ?? 0, requests: data.khata_requests ?? 0 });
    })();
  }, []);

  if (!s) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading khata rules
      </div>
    );
  }

  async function save() {
    if (!s) return;
    setSaving(true);
    try {
      const res = await fetch('/api/settings/khata', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Could not save the khata rules');
        return;
      }
      setS(data.settings);
      toast.success('Khata rules saved');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Khata (order now, pay monthly)</h3>
        <p className="mt-1 text-xs text-gray-500">
          Customers you open a khata for can pick &quot;Add to my khata&quot; at checkout and pay on their settlement day.
          Open a khata from the customer&apos;s page.{' '}
          <Link className="text-blue-600 hover:underline" href="/customers?filter=khata">
            {counts.open} open
          </Link>
          {counts.requests > 0 ? (
            <>
              {' · '}
              <Link className="font-medium text-amber-700 hover:underline" href="/customers?filter=khata-requests">
                {counts.requests} waiting for you
              </Link>
            </>
          ) : null}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-gray-500">
          When an order takes the customer over their limit
          <select
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm text-gray-900"
            value={s.overLimitRule}
            onChange={(e) => setS({ ...s, overLimitRule: e.target.value as KhataRule })}
          >
            {RULES.map((r) => (
              <option key={r} value={r}>
                {KHATA_RULE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-gray-500">
          When the customer has overdue bills
          <select
            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm text-gray-900"
            value={s.overdueRule}
            onChange={(e) => setS({ ...s, overdueRule: e.target.value as KhataRule })}
          >
            {RULES.map((r) => (
              <option key={r} value={r}>
                {KHATA_RULE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-gray-500">
          Grace days after the settlement day
          <input
            type="number"
            min="0"
            max="60"
            className="mt-1 w-32 rounded-lg border px-3 py-2 text-sm text-gray-900"
            value={s.graceDays}
            onChange={(e) => setS({ ...s, graceDays: Number(e.target.value) || 0 })}
          />
          <span className="mt-1 block">A bill counts as overdue only after these days.</span>
        </label>
        <label className="block text-xs text-gray-500">
          Overdue reminder every (days)
          <input
            type="number"
            min="1"
            max="30"
            className="mt-1 w-32 rounded-lg border px-3 py-2 text-sm text-gray-900"
            value={s.reminderIntervalDays}
            onChange={(e) => setS({ ...s, reminderIntervalDays: Number(e.target.value) || 1 })}
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={s.statementsEnabled}
          onChange={(e) => setS({ ...s, statementsEnabled: e.target.checked })}
        />
        Send each customer a WhatsApp statement on their settlement day, and overdue reminders
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={s.allowPartPayment}
          onChange={(e) => setS({ ...s, allowPartPayment: e.target.checked })}
        />
        Let customers pay part of their khata online
      </label>
      <Button type="button" onClick={() => void save()} disabled={saving}>
        {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
        Save khata rules
      </Button>
    </div>
  );
}
