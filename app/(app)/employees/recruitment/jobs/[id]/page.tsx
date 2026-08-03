'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Chip } from '@/components/ui/Chip';
import { Toast, ToastType } from '@/components/ui/Toast';

export default function RecruitmentJobDetailPage() {
  const params = useParams();
  const jobId = String(params?.id ?? '');
  const { business, user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [job, setJob] = useState<Record<string, unknown> | null>(null);
  const [stages, setStages] = useState<{ id: string; stage_name: string; sort_order: number }[]>([]);
  const [candidates, setCandidates] = useState<Record<string, unknown>[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', source: '' });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  const { status: authStatus } = useAuthorizationGuard({
    resource: 'recruitment',
    action: 'read',
    skipCheck: !user?.id || !business?.id,
  });

  const load = async () => {
    if (!business?.id || !user?.id || !jobId) return;
    setLoading(true);
    try {
      const q = new URLSearchParams({ business_id: business.id, user_id: user.id });
      const res = await fetch(`/api/hr/recruitment/jobs/${jobId}?${q}`);
      if (res.ok) {
        const data = await res.json();
        setJob(data.job);
        setStages(data.stages ?? []);
        setCandidates(data.candidates ?? []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [business?.id, user?.id, jobId]);

  const addCandidate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id || !user?.id) return;
    setSaving(true);
    try {
      const res = await fetch('/api/hr/recruitment/candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          user_id: user.id,
          job_id: jobId,
          ...form,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast({ message: data.error || 'Failed to add candidate', type: 'error' });
        return;
      }
      setShowAdd(false);
      setForm({ full_name: '', email: '', phone: '', source: '' });
      await load();
    } finally {
      setSaving(false);
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

  return (
    <div className="space-y-6 p-4 md:p-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <ListPageHeader
        title={String(job?.title ?? 'Job')}
        description={String(job?.department ?? '')}
        actions={
          <Button onClick={() => setShowAdd(true)}>
            <Plus className="mr-2 h-4 w-4" /> Add candidate
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <h2 className="font-semibold text-text-primary">Interview rounds</h2>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-text-secondary">
            {stages.map((s) => (
              <li key={s.id}>{s.stage_name}</li>
            ))}
          </ol>
        </Card>

        <Card className="p-4">
          <h2 className="font-semibold text-text-primary">Candidates</h2>
          {candidates.length === 0 ? (
            <p className="mt-2 text-sm text-text-secondary">No candidates yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {candidates.map((c) => (
                <li key={String(c.id)} className="flex items-center justify-between py-2">
                  <Link href={`/employees/recruitment/candidates/${c.id}`} className="link-primary font-medium">
                    {String(c.full_name)}
                  </Link>
                  <Chip>{String(c.status).replace(/_/g, ' ')}</Chip>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {showAdd && (
        <Card className="mx-auto max-w-lg space-y-3 p-4">
          <h3 className="font-semibold">Add candidate</h3>
          <form onSubmit={addCandidate} className="space-y-3">
            <Input label="Full name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
            <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
            <Input label="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <Input label="Source" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>Save</Button>
              <Button type="button" variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
