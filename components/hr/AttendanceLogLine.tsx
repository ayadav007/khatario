'use client';

import { MapPin } from 'lucide-react';
import {
  attendanceMapsUrl,
  formatAttendanceCoordinates,
  formatAttendanceTime,
  hasAttendanceCoordinates,
} from '@/lib/hr/attendance-location';

type Props = {
  kind: 'check_in' | 'check_out';
  time?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  compact?: boolean;
  /** When false, only coordinates / "not recorded" are shown (time shown elsewhere). */
  showTime?: boolean;
};

export function AttendanceLogLine({
  kind,
  time,
  lat,
  lng,
  compact = false,
  showTime = true,
}: Props) {
  const label = kind === 'check_in' ? 'Check-in' : 'Check-out';
  const timeLabel = formatAttendanceTime(time);

  if (!timeLabel && !hasAttendanceCoordinates(lat, lng)) return null;

  const latN = Number(lat);
  const lngN = Number(lng);
  const hasCoords = hasAttendanceCoordinates(lat, lng);

  if (!showTime && !hasCoords && !timeLabel) return null;

  return (
    <div className={compact ? 'text-xs text-text-secondary' : 'text-sm text-text-secondary'}>
      {showTime ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-medium text-text-primary">{label}</span>
          {timeLabel ? <span>{timeLabel}</span> : null}
        </div>
      ) : null}
      {hasCoords ? (
        <p className={`flex flex-wrap items-center gap-1 text-xs text-text-secondary ${showTime ? 'mt-0.5' : ''}`}>
          <MapPin className="h-3 w-3 shrink-0" aria-hidden />
          <span>{formatAttendanceCoordinates(latN, lngN)}</span>
          <a
            href={attendanceMapsUrl(latN, lngN)}
            target="_blank"
            rel="noopener noreferrer"
            className="link-primary"
          >
            View on map
          </a>
        </p>
      ) : showTime && timeLabel ? (
        <p className="mt-0.5 text-xs text-text-muted">Location not recorded</p>
      ) : !showTime && timeLabel ? (
        <p className="text-xs text-text-muted">Location not recorded</p>
      ) : null}
    </div>
  );
}
