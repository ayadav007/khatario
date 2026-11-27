'use client';

import { useCallback, useEffect, useState } from 'react';
import { useToastContext } from '@/contexts/ToastContext';
import { platformAdminFetchInit } from '@/lib/admin-client-headers';

/**
 * On a plan card: "M businesses are on older terms" (they kept what they had when an "only new customers" change was
 * saved) and a button to move them all to the plan's current terms. Renders nothing when nobody is on older terms.
 */
export function PlanOlderTermsNotice({ planId, refreshKey = 0 }: { planId: string; refreshKey?: number }) {
  const toast = useToastContext();
  const [onOlder, setOnOlder] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/plans/${planId}/terms`, { ...platformAdminFetchInit });
      if (!res.ok) return;
      const data = await res.json();
      setOnOlder(typeof data.on_older_terms === 'number' ? data.on_older_terms : 0);
    } catch {
      /* the notice is optional */
    }
  }, [planId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function move() {
    try {
      setBusy(true);
      const res = await fetch(`/api/admin/plans/${planId}/terms`, {
        ...platformAdminFetchInit,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'move_to_current', confirm_older_terms_count: onOlder }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409 && typeof data.on_older_terms === 'number') {
          setOnOlder(data.on_older_terms);
          setConfirming(false);
          throw new Error('The number changed. Check it and try again.');
        }
        throw new Error(data.error || 'Failed to move businesses');
      }
      toast.success(`${data.moved} ${data.moved === 1 ? 'business' : 'businesses'} moved to the current terms.`);
      setConfirming(false);
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (onOlder <= 0) return null;
  const noun = onOlder === 1 ? 'business is' : 'businesses are';
  return (
    <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-semibold">
        {onOlder} {noun} on older terms
      </p>
      <p className="mt-1 text-xs">They keep the features, limits and renewal price they had before a change you saved for new customers only.</p>
      {confirming ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs">
            Move {onOlder} {onOlder === 1 ? 'business' : 'businesses'} to this plan&apos;s current features, limits and price? Their access and next renewal price change. This is recorded with your name.
          </span>
          <button
            onClick={() => void move()}
            disabled={busy}
            className="px-3 py-1 rounded bg-amber-600 text-white text-xs font-medium hover:bg-amber-700 disabled:opacity-50"
          >
            {busy ? 'Moving…' : 'Confirm move'}
          </button>
          <button onClick={() => setConfirming(false)} disabled={busy} className="px-3 py-1 rounded bg-white border border-amber-300 text-xs">
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirming(true)}
          className="mt-2 px-3 py-1 rounded bg-white border border-amber-400 text-xs font-medium text-amber-900 hover:bg-amber-100"
        >
          Move them to the current terms
        </button>
      )}
    </div>
  );
}
