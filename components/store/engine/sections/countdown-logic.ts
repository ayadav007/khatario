// Pure: no React, no DOM.

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

/** The boxes to draw: Days only when there are some; zeros once it is over (never a negative number). */
export function countdownUnits(parts: CountdownParts | null): [string, number][] {
  const p = parts ?? { days: 0, hours: 0, minutes: 0, seconds: 0 };
  const units: [string, number][] = [['Hrs', p.hours], ['Min', p.minutes], ['Sec', p.seconds]];
  return p.days > 0 ? [['Days', p.days], ...units] : units;
}

/** Time left until `endsAt` (an ISO date-time) at `now` (epoch ms), or null when it is over or the date is invalid. */
export function countdownParts(endsAt: string, now: number): CountdownParts | null {
  const end = Date.parse(endsAt);
  if (!Number.isFinite(end)) return null;
  const left = Math.floor((end - now) / 1000);
  if (left <= 0) return null;
  return {
    days: Math.floor(left / 86400),
    hours: Math.floor((left % 86400) / 3600),
    minutes: Math.floor((left % 3600) / 60),
    seconds: left % 60,
  };
}
