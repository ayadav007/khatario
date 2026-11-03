'use client';

import { useEffect, useState } from 'react';
import { closedNotice, openStatusLabel, storeOpenState, type StoreHours, type StoreOpenState } from '@/lib/store/store-hours';

/** The visitor's clock decides "now"; it is read in India time by `storeOpenState`. Null until mounted (never on the server). */
function useOpenState(hours: StoreHours | null | undefined): StoreOpenState | null {
  const [state, setState] = useState<StoreOpenState | null>(null);
  useEffect(() => {
    if (!hours) {
      setState(null);
      return;
    }
    const tick = () => setState(storeOpenState(hours, new Date()));
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, [hours]);
  return state;
}

/** "Open · till 10 PM" / "Closed · opens 7 AM" pill for the header; nothing without hours, before mount, or when unknown. */
export function OpenStatusBadge({ hours }: { hours: StoreHours | null }) {
  const state = useOpenState(hours);
  const label = state ? openStatusLabel(state) : null;
  if (!state || !label) return null;
  const open = state.state === 'open';
  return (
    <div className="flex justify-center px-4 py-1.5">
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
        style={{ border: '1px solid color-mix(in srgb, currentColor 18%, transparent)' }}
        role="status"
      >
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: open ? '#16a34a' : '#9ca3af' }}
        />
        {label}
      </span>
    </div>
  );
}

/** A dark banner while the store is closed (cart and checkout); orders still go through. Nothing when open or unknown. */
export function ClosedNotice({ hours, className }: { hours: StoreHours | null | undefined; className?: string }) {
  const state = useOpenState(hours);
  const text = state ? closedNotice(state) : null;
  if (!text) return null;
  return (
    <p className={className} role="status" style={{ backgroundColor: '#1f2937', color: '#fff', borderRadius: 12, padding: '10px 12px', fontSize: 12, lineHeight: 1.4 }}>
      {text}
    </p>
  );
}
