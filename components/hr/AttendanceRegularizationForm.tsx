'use client';

import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  REGULARIZATION_REQUEST_TYPE_LABELS,
  type RegularizationRequestType,
  type RegularizationSettings,
} from '@/lib/hr/attendance-regularization-shared';

type AttendanceDay = {
  date: string;
  check_in_time?: string | null;
  check_out_time?: string | null;
};

type Props = {
  dateYmd: string;
  record: AttendanceDay | null;
  settings: RegularizationSettings;
  onSubmit: (payload: {
    request_type: RegularizationRequestType;
    requested_check_in?: string;
    requested_check_out?: string;
    reason: string;
  }) => Promise<void>;
  onCancel: () => void;
};

function needsCheckIn(type: RegularizationRequestType): boolean {
  return [
    'missing_check_in',
    'missing_both',
    'override_check_in',
    'partial_late_in',
  ].includes(type);
}

function needsCheckOut(type: RegularizationRequestType): boolean {
  return [
    'missing_check_out',
    'missing_both',
    'override_check_out',
    'partial_early_out',
  ].includes(type);
}

function defaultTime(dateYmd: string, hhmm: string): string {
  return `${dateYmd}T${hhmm}`;
}

function isoToLocalInput(iso: string | null | undefined, dateYmd: string, fallback: string): string {
  if (!iso) return defaultTime(dateYmd, fallback);
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AttendanceRegularizationForm({
  dateYmd,
  record,
  settings,
  onSubmit,
  onCancel,
}: Props) {
  const [requestType, setRequestType] = useState<RegularizationRequestType>('missing_check_in');
  const [checkIn, setCheckIn] = useState(() => isoToLocalInput(record?.check_in_time, dateYmd, '09:00'));
  const [checkOut, setCheckOut] = useState(() => isoToLocalInput(record?.check_out_time, dateYmd, '18:00'));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const availableTypes = useMemo(() => {
    const types: RegularizationRequestType[] = [];
    const hasIn = !!record?.check_in_time;
    const hasOut = !!record?.check_out_time;

    if (settings.allow_missing_punch) {
      if (!hasIn) types.push('missing_check_in');
      if (hasIn && !hasOut) types.push('missing_check_out');
      if (!hasIn && !hasOut) types.push('missing_both');
    }
    if (settings.allow_override_existing) {
      if (hasIn) types.push('override_check_in');
      if (hasOut) types.push('override_check_out');
    }
    if (settings.allow_delete_logs) {
      if (hasIn) types.push('delete_check_in');
      if (hasOut) types.push('delete_check_out');
    }
    if (hasIn) types.push('partial_late_in');
    if (hasOut) types.push('partial_early_out');

    return types;
  }, [record, settings]);

  const effectiveType = availableTypes.includes(requestType)
    ? requestType
    : availableTypes[0] ?? 'missing_check_in';

  const showIn = needsCheckIn(effectiveType);
  const showOut = needsCheckOut(effectiveType);
  const isDelete = effectiveType.startsWith('delete_');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await onSubmit({
        request_type: effectiveType,
        requested_check_in: showIn ? new Date(checkIn).toISOString() : undefined,
        requested_check_out: showOut ? new Date(checkOut).toISOString() : undefined,
        reason,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit');
    } finally {
      setSaving(false);
    }
  };

  if (!settings.enabled) {
    return (
      <p className="text-sm text-text-secondary">Attendance regularization is not enabled.</p>
    );
  }

  if (availableTypes.length === 0) {
    return (
      <p className="text-sm text-text-secondary">No regularization options available for this day.</p>
    );
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3 rounded-lg border border-border bg-gray-50 p-3">
      <p className="text-sm font-medium text-text-primary">Request regularization</p>
      <div>
        <label className="mb-1 block text-xs font-medium text-text-secondary">Type</label>
        <select
          className="input w-full text-sm"
          value={effectiveType}
          onChange={(e) => setRequestType(e.target.value as RegularizationRequestType)}
        >
          {availableTypes.map((t) => (
            <option key={t} value={t}>
              {REGULARIZATION_REQUEST_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      {isDelete ? (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
          This will request deletion of the existing log after manager approval.
        </p>
      ) : null}

      {showIn ? (
        <Input
          label="Check-in time"
          type="datetime-local"
          value={checkIn}
          onChange={(e) => setCheckIn(e.target.value)}
          required
        />
      ) : null}

      {showOut ? (
        <Input
          label="Check-out time"
          type="datetime-local"
          value={checkOut}
          onChange={(e) => setCheckOut(e.target.value)}
          required
        />
      ) : null}

      <div>
        <label className="mb-1 block text-xs font-medium text-text-secondary">Reason *</label>
        <textarea
          className="input min-h-[72px] w-full text-sm"
          value={reason}
          required={settings.require_reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why does this need to be corrected?"
        />
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Submit for approval'}
        </Button>
      </div>
    </form>
  );
}
