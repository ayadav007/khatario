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

/** Pill height; the margins below cancel it, so the badge never makes its line taller. */
const PILL = 20;

/**
 * "Open · till 10 PM" / "Closed · opens 7 AM" pill, drawn inline beside the store name. Before mount (or when the
 * state is unknown) an empty span of the same height stands in, so the badge appearing shifts nothing vertically.
 * Nothing at all without hours.
 */
export function OpenStatusBadge({ hours }: { hours: StoreHours | null }) {
  const state = useOpenState(hours);
  if (!hours) return null;
  const label = state ? openStatusLabel(state) : null;
  if (!state || !label) {
    return <span aria-hidden="true" style={{ display: 'inline-block', height: PILL, margin: `${-3}px 0` }} />;
  }
  const open = state.state === 'open';
  return (
    <span
      role="status"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        flexShrink: 0,
        height: PILL,
        margin: '-3px 0 -3px 8px',
        padding: '0 8px',
        borderRadius: 999,
        border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
        fontSize: 11,
        fontWeight: 600,
        lineHeight: 1,
        letterSpacing: 'normal',
        textTransform: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        aria-hidden="true"
        style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: open ? '#16a34a' : '#9ca3af' }}
      />
      {label}
    </span>
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
