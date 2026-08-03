'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';

type Shift = { id: string; shift_name: string; start_time: string; end_time: string };

type Props = {
  businessId: string | null | undefined;
  value: string;
  onChange: (shiftId: string) => void;
  label?: string;
};

export function EmployeeShiftSelect({
  businessId,
  value,
  onChange,
  label = 'Default shift',
}: Props) {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) {
      setShifts([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/shifts?business_id=${businessId}`, { credentials: 'include' });
        if (res.ok && !cancelled) {
          const data = await res.json();
          setShifts((data.shifts ?? []).filter((s: Shift & { is_active?: boolean }) => s.is_active !== false));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-text-secondary">{label}</label>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading shifts…
        </div>
      ) : (
        <select
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">No default shift</option>
          {shifts.map((s) => (
            <option key={s.id} value={s.id}>
              {s.shift_name} ({s.start_time?.slice(0, 5)} – {s.end_time?.slice(0, 5)})
            </option>
          ))}
        </select>
      )}
      <p className="mt-1 text-xs text-text-muted">
        Used for late detection and attendance check-in when no shift is chosen manually.
      </p>
    </div>
  );
}
