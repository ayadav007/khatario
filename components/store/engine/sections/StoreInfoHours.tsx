'use client';

import { useEffect, useState } from 'react';
import { todayHoursLabel } from '@/lib/store/engine/store-info-map';
import type { StoreHours } from '@/lib/store/store-hours';
import { OpenStatusBadge } from '../OpenStatusBadge';

/**
 * Today's hours and the live Open/Closed badge. Both depend on the visitor's moment, so they appear after mount
 * (never on the server); the weekday is read in India time and re-read each minute so the line rolls over at midnight.
 */
export function StoreInfoHours({ hours }: { hours: StoreHours }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);
  if (!now) return null;
  return (
    <div className="eng-info-hours">
      <p className="eng-info-today">{todayHoursLabel(hours, now)}</p>
      <div className="eng-info-live">
        <OpenStatusBadge hours={hours} />
      </div>
    </div>
  );
}
