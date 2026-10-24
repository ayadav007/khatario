'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, MapPin, Wifi } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';

type Review = {
  id: string;
  action: 'check_in' | 'check_out';
  risk_score: number;
  reasons: { code: string; message: string }[];
  distance_m: number | null;
  lat: string | null;
  lng: string | null;
  accuracy_m: string | null;
  wifi_matched: boolean;
  face_similarity: number | null;
  liveness_passed: boolean | null;
  photos: { id: string; label: string; data_url: string }[];
  created_at: string;
  site_name: string | null;
  employee_name: string;
  employee_code: string | null;
};

/** Khatario Staff check-ins that looked doubtful. Shows nothing when the queue is empty. */
export function StaffPunchReviewQueue({ onResolved }: { onResolved?: () => void }) {
  const toast = useToastContext();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/employees/attendance/reviews');
    if (!res.ok) return;
    const data = await res.json();
    setReviews(data.reviews ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function resolve(id: string, decision: 'approved' | 'rejected') {
    setBusy(id);
    try {
      const res = await fetch('/api/employees/attendance/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ punch_id: id, decision }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast.error(data.error || 'Could not save');
      else {
        toast.success(decision === 'approved' ? 'Approved' : 'Rejected and removed from attendance');
        setReviews((r) => r.filter((x) => x.id !== id));
        onResolved?.();
      }
    } finally {
      setBusy(null);
    }
  }

  if (reviews.length === 0) return null;

  return (
    <Card padding="md" className="space-y-3">
      <h2 className="flex items-center gap-2 font-semibold text-text-primary">
        <AlertTriangle className="h-4 w-4 text-amber-600" /> Check-ins to review ({reviews.length})
      </h2>
      <p className="text-xs text-text-secondary">
        These came from the Khatario Staff app and looked unusual. They count as attendance until you reject them.
      </p>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {reviews.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-sm">
              <p className="font-medium text-text-primary">
                {r.employee_name}
                {r.employee_code ? ` (${r.employee_code})` : ''} · {r.action === 'check_in' ? 'Check-in' : 'Check-out'}{' '}
                {new Date(r.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
              <p className="flex flex-wrap items-center gap-x-3 text-xs text-text-secondary">
                {r.lat && r.lng ? (
                  <a
                    className="inline-flex items-center gap-1 text-primary-700 hover:underline"
                    href={`https://www.google.com/maps?q=${r.lat},${r.lng}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <MapPin className="h-3 w-3" />
                    {r.distance_m != null ? `${r.distance_m} m from ${r.site_name ?? 'the office'}` : 'Map'}
                  </a>
                ) : null}
                <span className="inline-flex items-center gap-1">
                  <Wifi className="h-3 w-3" /> {r.wifi_matched ? 'Office Wi-Fi seen' : 'No office Wi-Fi'}
                </span>
                {r.face_similarity != null && <span>Face match {Math.round(r.face_similarity * 100)}%</span>}
                <span>Risk {r.risk_score}/100</span>
              </p>
              {r.photos.length > 0 && (
                <div className="mt-2 flex gap-2">
                  {r.photos.map((p) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={p.id} src={p.data_url} alt={`Check-in photo (${p.label})`} className="h-16 w-16 rounded object-cover" />
                  ))}
                </div>
              )}
              <ul className="mt-1 list-disc pl-4 text-xs text-text-secondary">
                {r.reasons.map((x) => (
                  <li key={x.code}>{x.message}</li>
                ))}
              </ul>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="secondary" disabled={busy === r.id} onClick={() => void resolve(r.id, 'approved')}>
                Approve
              </Button>
              <Button size="sm" variant="destructive" disabled={busy === r.id} onClick={() => void resolve(r.id, 'rejected')}>
                Reject
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
