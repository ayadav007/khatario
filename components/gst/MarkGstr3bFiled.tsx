'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';

function todayIst(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function dateLabel(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface DialogProps {
  businessId: string;
  /** YYYY-MM; the quarter's last month for QRMP filers. */
  period: string;
  label: string;
  onClose: () => void;
  onSaved: () => void;
}

export function MarkGstr3bFiledDialog({ businessId, period, label, onClose, onSaved }: DialogProps) {
  const toast = useToastContext();
  const titleId = useId();
  const dateId = useId();
  const arnId = useId();
  const [filedOn, setFiledOn] = useState(todayIst());
  const [arn, setArn] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/gst/return-marks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId, period, filed_on: filedOn, arn: arn.trim() || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || 'Could not save');
        return;
      }
      toast.success(`GSTR-3B for ${label} marked as filed`);
      onSaved();
    } catch {
      setError('Could not save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="bg-white rounded-2xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-3">
          <h2 id={titleId} className="text-lg font-bold text-gray-900">
            Mark GSTR-3B as filed
          </h2>
          <button type="button" onClick={onClose} disabled={saving} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          For <span className="font-medium text-gray-900">{label}</span>. This only records that you or your CA filed the return on
          the GST portal, so Khatario stops reminding you. It does not lock your books or file anything.
        </p>
        {error && (
          <p role="alert" className="mb-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
            {error}
          </p>
        )}
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor={dateId} className="block text-sm font-medium text-gray-700 mb-1">
              Filed on
            </label>
            <input
              id={dateId}
              type="date"
              required
              value={filedOn}
              max={todayIst()}
              onChange={(e) => setFiledOn(e.target.value)}
              className="input w-full"
              disabled={saving}
            />
          </div>
          <div>
            <label htmlFor={arnId} className="block text-sm font-medium text-gray-700 mb-1">
              ARN <span className="font-normal text-gray-500">(optional)</span>
            </label>
            <input
              id={arnId}
              value={arn}
              onChange={(e) => setArn(e.target.value.toUpperCase())}
              placeholder="Acknowledgement number from the portal"
              maxLength={20}
              className="input w-full"
              disabled={saving}
            />
          </div>
          <div className="flex gap-3 pt-1">
            <Button type="button" variant="secondary" onClick={onClose} className="flex-1" disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" isLoading={saving}>
              Mark as filed
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface StatusInfo {
  period: string;
  label: string;
  due_date: string;
  can_file_from: string;
  mark: { filed_on: string; arn: string | null } | null;
}

/** Filing status strip for the GSTR-3B report: shows the mark, or offers to add one once the period has ended. */
export function Gstr3bFilingStatusBar({ businessId, month }: { businessId: string; month: string }) {
  const toast = useToastContext();
  const [info, setInfo] = useState<StatusInfo | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ business_id: businessId, for_month: month });
      const res = await fetch(`/api/gst/return-marks?${q}`);
      setInfo(res.ok ? await res.json() : null);
    } catch {
      setInfo(null);
    }
  }, [businessId, month]);

  useEffect(() => {
    load();
  }, [load]);

  async function undo() {
    if (!info || !window.confirm(`Remove the "filed" mark for ${info.label}?`)) return;
    setBusy(true);
    try {
      const q = new URLSearchParams({ business_id: businessId, period: info.period });
      const res = await fetch(`/api/gst/return-marks?${q}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        toast.error(json.error || 'Could not remove the mark');
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!info) return null;
  const today = todayIst();
  if (!info.mark && today < info.can_file_from) return null;

  return (
    <>
      {info.mark ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm">
          <CheckCircle2 className="w-4 h-4 text-green-600" />
          <span className="text-green-900">
            GSTR-3B for {info.label} marked as filed on {dateLabel(info.mark.filed_on)}
            {info.mark.arn ? ` (ARN ${info.mark.arn})` : ''}.
          </span>
          <button type="button" onClick={undo} disabled={busy} className="ml-auto text-green-800 hover:underline disabled:opacity-60">
            Undo
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm">
          <span className="text-gray-700">
            GSTR-3B for {info.label} {today > info.due_date ? 'was' : 'is'} due on {dateLabel(info.due_date)}. Filed it on the GST
            portal?
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="ml-auto px-3 py-1.5 text-sm font-medium rounded-lg border border-primary-600 text-primary-700 hover:bg-primary-50"
          >
            Mark as filed
          </button>
        </div>
      )}
      {open && (
        <MarkGstr3bFiledDialog
          businessId={businessId}
          period={info.period}
          label={info.label}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            load();
          }}
        />
      )}
    </>
  );
}
