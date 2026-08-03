'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Toast, ToastType } from '@/components/ui/Toast';
import {
  OnboardingTaskDetailView,
  type OnboardingTaskDetailData,
} from '@/components/onboarding/OnboardingTaskDetailView';

export default function HrOnboardingTaskReviewPage() {
  const params = useParams();
  const router = useRouter();
  const candidateId = String(params?.id ?? '');
  const taskId = String(params?.taskId ?? '');
  const { business, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<(OnboardingTaskDetailData & { candidate?: Record<string, unknown> }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  const { status: authStatus } = useAuthorizationGuard({
    resource: 'recruitment',
    action: 'read',
    skipCheck: !user?.id || !business?.id,
  });

  const qs = () =>
    new URLSearchParams({
      business_id: business!.id,
      user_id: user!.id,
    }).toString();

  const load = useCallback(async () => {
    if (!business?.id || !user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/hr/recruitment/candidates/${candidateId}/tasks/${taskId}?${qs()}`,
      );
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to load task');
        return;
      }
      setData({
        task: json.task,
        identityDocs: json.identityDocs ?? [],
        entries: json.entries ?? [],
        files: json.files ?? [],
        progress: json.progress,
        candidate: json.candidate,
      });
      setNotes(String(json.task?.reviewer_notes ?? ''));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, user?.id, candidateId, taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  const review = async (action: 'approve' | 'request_changes') => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/hr/recruitment/candidates/${candidateId}/tasks/${taskId}/review?${qs()}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            business_id: business!.id,
            user_id: user!.id,
            action,
            notes: notes.trim() || undefined,
          }),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        setToast({ message: json.error || 'Review failed', type: 'error' });
        return;
      }
      setToast({
        message: action === 'approve' ? 'Task approved' : 'Changes requested — candidate notified',
        type: 'success',
      });
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (authStatus === 'loading' || loading) {
    return (
      <div className="flex h-[calc(100vh-100px)] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }
  if (authStatus === 'denied') return <AccessDenied module="recruitment" action="read" />;
  if (error || !data) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-red-600">{error ?? 'Task not found'}</p>
        <Link href={`/employees/recruitment/candidates/${candidateId}`} className="link-primary mt-4 inline-block text-sm">
          Back to candidate
        </Link>
      </div>
    );
  }

  const taskStatus = String(data.task.status ?? '');
  const canReview = taskStatus === 'submitted';

  return (
    <div className="space-y-4 p-4 md:p-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <Link
        href={`/employees/recruitment/candidates/${candidateId}`}
        className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
      >
        <ArrowLeft className="h-4 w-4" /> {String(data.candidate?.full_name ?? 'Candidate')}
      </Link>

      <OnboardingTaskDetailView
        data={data}
        editable={false}
        footer={
          <div className="space-y-4 border-t border-border pt-4">
            {canReview ? (
              <>
                <div>
                  <label className="text-sm text-text-secondary">Notes for candidate (optional)</label>
                  <Input
                    className="mt-1"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Explain what needs to be updated…"
                  />
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="secondary" onClick={() => router.push(`/employees/recruitment/candidates/${candidateId}`)}>
                    Back
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={() => void review('request_changes')}>
                    Request changes
                  </Button>
                  <Button disabled={busy} onClick={() => void review('approve')}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Approve task'}
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex justify-end">
                <Button variant="secondary" onClick={() => router.push(`/employees/recruitment/candidates/${candidateId}`)}>
                  Back to candidate
                </Button>
              </div>
            )}
          </div>
        }
      />
    </div>
  );
}
