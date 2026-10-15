'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, ScanFace } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';

type Photo = { id: string; label: string; data_url: string };
type FaceStatus = {
  enrolled: { since: string; angles: number } | null;
  pending: {
    id: string;
    status: 'open' | 'captured';
    expires_at: string;
    consent_at: string | null;
    quality: { min_similarity?: number } | null;
    photos: Photo[];
  } | null;
};

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Face check for one employee, supervised by the manager: start setup, watch the employee take
 * the photos on their linked phone, then approve or reject. Also deletes the face data.
 */
export function StaffFaceEnrollment({ employeeId }: { employeeId: string }) {
  const toast = useToastContext();
  const [status, setStatus] = useState<FaceStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const url = `/api/employees/${employeeId}/staff-app/face`;

  const load = useCallback(async () => {
    const res = await fetch(url);
    if (res.ok) setStatus(await res.json());
  }, [url]);

  useEffect(() => {
    void load();
  }, [load]);

  // While the phone is taking photos, check for them.
  useEffect(() => {
    if (status?.pending?.status !== 'open') return;
    const poll = setInterval(() => void load(), 4000);
    return () => clearInterval(poll);
  }, [status?.pending?.status, load]);

  async function act(action: 'open' | 'cancel' | 'approve' | 'reject') {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, enrollment_id: status?.pending?.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(data.error || 'Could not save');
      else {
        setStatus(data);
        if (action === 'approve') toast.success('Face check is on for this employee');
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm('Delete this employee’s face data? Check-ins will work without the face check until you set it up again.')) {
      return;
    }
    const res = await fetch(url, { method: 'DELETE' });
    if (res.ok) {
      toast.success('Face data deleted');
      void load();
    } else toast.error('Could not delete');
  }

  if (!status) return null;
  const pending = status.pending;

  return (
    <div className="space-y-3 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="flex items-center gap-2 font-medium text-text-primary">
            <ScanFace className="h-4 w-4" /> Face check
          </p>
          <p className="text-xs text-text-secondary">
            {status.enrolled
              ? `On since ${when(status.enrolled.since)} · ${status.enrolled.angles} angles. Every check-in asks for a quick blink / turn / smile and is matched on Khatario's own server.`
              : 'Off. Set it up with the employee in front of you: they agree to the terms and take a few photos on their phone, then you approve.'}
          </p>
        </div>
        {!pending && (
          <div className="flex gap-2">
            <Button size="sm" variant={status.enrolled ? 'secondary' : 'primary'} disabled={busy} onClick={() => void act('open')}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              {status.enrolled ? 'Set up again' : 'Set up face check'}
            </Button>
            {status.enrolled && (
              <Button size="sm" variant="ghost" onClick={() => void remove()}>
                Delete face data
              </Button>
            )}
          </div>
        )}
      </div>

      {pending?.status === 'open' && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted p-3">
          <p className="text-xs text-text-secondary">
            <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
            Ask the employee to open Khatario Staff and tap <strong>Set up face check</strong>. Open until{' '}
            {when(pending.expires_at)}.
          </p>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act('cancel')}>
            Cancel
          </Button>
        </div>
      )}

      {pending?.status === 'captured' && (
        <div className="space-y-2">
          <p className="text-xs text-text-secondary">
            Check these are the employee&apos;s own face{pending.consent_at ? `; they agreed to the terms on ${when(pending.consent_at)}` : ''}.
            The photos are deleted once you decide.
          </p>
          <div className="flex flex-wrap gap-2">
            {pending.photos.map((p) => (
              <figure key={p.id} className="text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.data_url} alt={`${p.label} angle`} className="h-24 w-24 rounded-md object-cover" />
                <figcaption className="text-xs text-text-secondary">{p.label}</figcaption>
              </figure>
            ))}
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => void act('approve')}>
              Approve
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act('reject')}>
              Reject
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
