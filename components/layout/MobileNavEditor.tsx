'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useCapabilityCheck } from '@/hooks/useCapability';
import {
  MIDDLE_NAV_LABELS,
  allowedMiddleIds,
  displayedMiddle,
  parseMobileNavPrefs,
  pinnedFirstId,
  validateMobileNavPrefs,
  type MiddleNavId,
  type MobileNavContext,
  type MobileNavSlotCount,
} from '@/lib/mobile-bottom-nav';
import { isConnectAgentSeat } from '@/lib/users/connect-seats';

type Props = {
  open: boolean;
  onClose: () => void;
};

export function MobileNavEditor({ open, onClose }: Props) {
  const { user, platformSession, refresh } = useAuth();
  const { hasCapability } = useCapabilityCheck();
  const ctx: MobileNavContext = useMemo(
    () => ({
      modules: platformSession?.enabledModules ?? [],
      isConnectAgent: isConnectAgentSeat(user),
      canViewInvoices: hasCapability('invoices', 'view'),
    }),
    [platformSession?.enabledModules, user, hasCapability],
  );
  const allowed = useMemo(() => allowedMiddleIds(ctx), [ctx]);
  const canUseFive = allowed.length >= 3;
  const firstLabel = pinnedFirstId(ctx) === 'chats' ? 'Chats' : 'Home';

  const [slotCount, setSlotCount] = useState<MobileNavSlotCount>(5);
  const [middle, setMiddle] = useState<MiddleNavId[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const parsed = parseMobileNavPrefs(user?.mobile_nav);
    const shown = displayedMiddle(ctx, user?.mobile_nav);
    const count: MobileNavSlotCount = parsed?.slotCount === 4 || shown.length <= 2 ? 4 : 5;
    const nextCount: MobileNavSlotCount = count === 5 && !canUseFive ? 4 : count;
    setSlotCount(nextCount);
    setMiddle(shown.slice(0, nextCount - 2));
    // Seed only when the sheet opens, so a session refresh does not wipe an in-progress edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const remaining = allowed.filter((id) => !middle.includes(id));

  const setCount = (next: MobileNavSlotCount) => {
    if (next === 5 && !canUseFive) return;
    setSlotCount(next);
    setMiddle((current) => {
      if (next === 4) return current.slice(0, 2);
      if (current.length >= 3) return current.slice(0, 3);
      const extra = allowed.find((id) => !current.includes(id));
      return extra ? [...current, extra] : current;
    });
  };

  const move = (index: number, dir: -1 | 1) => {
    setMiddle((current) => {
      const target = index + dir;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [row] = next.splice(index, 1);
      next.splice(target, 0, row);
      return next;
    });
  };

  const remove = (id: MiddleNavId) => {
    if (middle.length <= 2) return;
    const next = middle.filter((item) => item !== id);
    setMiddle(next);
    setSlotCount(next.length >= 3 ? 5 : 4);
  };

  const add = (id: MiddleNavId) => {
    if (middle.length >= 3 || middle.includes(id)) return;
    const next = [...middle, id];
    setMiddle(next);
    setSlotCount(next.length >= 3 ? 5 : 4);
  };

  const save = async (reset: boolean) => {
    if (!reset) {
      const checked = validateMobileNavPrefs(ctx, { slotCount, middle });
      if (!checked.ok) {
        toast.error(checked.error);
        return;
      }
    }
    setSaving(true);
    try {
      const res = await fetch('/api/user/mobile-nav', {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reset ? { reset: true } : { slotCount, middle }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(typeof data.error === 'string' ? data.error : 'Could not save the navigation bar.');
        return;
      }
      await refresh();
      toast.success(reset ? 'Navigation bar reset' : 'Navigation bar saved');
      onClose();
    } catch {
      toast.error('Could not save the navigation bar.');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[10080] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Navigation bar">
      <button type="button" className="absolute inset-0 bg-black/40" aria-label="Close" onClick={onClose} />
      <div className="relative flex max-h-[85vh] w-full max-w-md flex-col rounded-t-2xl border border-border bg-background shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <div>
            <h2 className="text-base font-semibold text-text-primary">Navigation bar</h2>
            <p className="mt-0.5 text-xs text-text-muted">
              {firstLabel} stays first. More stays last.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-text-muted" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <div className="grid grid-cols-2 gap-2">
            {([4, 5] as const).map((count) => {
              const disabled = count === 5 && !canUseFive;
              const selected = slotCount === count;
              return (
                <button
                  key={count}
                  type="button"
                  disabled={disabled}
                  onClick={() => setCount(count)}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-semibold ${
                    selected
                      ? 'border-primary-600 bg-primary-50 text-primary-700'
                      : 'border-border bg-surface text-text-primary'
                  } disabled:opacity-40`}
                >
                  {count} tabs
                </button>
              );
            })}
          </div>
          {!canUseFive ? (
            <p className="mt-2 text-xs text-text-muted">Only two shortcuts are available, so the bar stays at 4 tabs.</p>
          ) : null}

          <p className="mb-1 mt-4 text-xs font-medium text-text-secondary">On the bar</p>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
            {middle.map((id, index) => (
              <li key={id} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 text-sm font-medium text-text-primary">{MIDDLE_NAV_LABELS[id]}</span>
                <button type="button" className="rounded-lg p-1.5 text-text-muted" aria-label={`Move ${MIDDLE_NAV_LABELS[id]} up`} onClick={() => move(index, -1)}>
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button type="button" className="rounded-lg p-1.5 text-text-muted" aria-label={`Move ${MIDDLE_NAV_LABELS[id]} down`} onClick={() => move(index, 1)}>
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="rounded-lg px-2 py-1 text-xs font-medium text-text-muted disabled:opacity-30"
                  disabled={middle.length <= 2}
                  onClick={() => remove(id)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>

          {remaining.length > 0 && middle.length < 3 ? (
            <>
              <p className="mb-1 mt-4 text-xs font-medium text-text-secondary">Add</p>
              <div className="flex flex-wrap gap-2">
                {remaining.map((id) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => add(id)}
                    className="rounded-full border border-border bg-surface px-3 py-1.5 text-sm font-medium text-text-primary"
                  >
                    {MIDDLE_NAV_LABELS[id]}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <div className="flex gap-2 border-t border-border px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            disabled={saving}
            onClick={() => save(true)}
            className="rounded-xl border border-border px-3 py-2.5 text-sm font-semibold text-text-secondary"
          >
            Reset
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => save(false)}
            className="flex-1 rounded-xl bg-primary-600 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
