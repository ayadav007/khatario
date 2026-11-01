'use client';

import { useEffect, useState } from 'react';
import { countdownParts } from './countdown-logic';
import { useFollowLink } from '../EngineViews';

/** Ticks every second. Renders nothing on the server (the clock belongs to the visitor), then the boxes after mount. */
export function EngineCountdown({
  heading,
  endsAt,
  link,
  buttonLabel,
  hideWhenOver,
}: {
  heading: string;
  endsAt: string;
  link: string;
  buttonLabel: string;
  hideWhenOver: boolean;
}) {
  const follow = useFollowLink();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return null;
  const parts = countdownParts(endsAt, now);
  if (!parts && hideWhenOver) return null;
  const p = parts ?? { days: 0, hours: 0, minutes: 0, seconds: 0 };
  const units: [string, number][] = [['Days', p.days], ['Hours', p.hours], ['Min', p.minutes], ['Sec', p.seconds]];
  return (
    <div className="eng-countdown">
      {heading ? <h2>{heading}</h2> : null}
      <div className="eng-countdown-boxes" role="timer" aria-label={heading || 'Countdown'}>
        {units.map(([label, n]) => (
          <div key={label}>
            <b>{String(n).padStart(2, '0')}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>
      {link && buttonLabel ? (
        <button type="button" className="st-btn" onClick={() => follow(link)}>
          {buttonLabel} →
        </button>
      ) : null}
    </div>
  );
}
