// Pure: no React, no DOM.

export interface CountdownParts {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
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
