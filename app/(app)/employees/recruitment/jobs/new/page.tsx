'use client';

export const dynamic = 'force-dynamic';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Toast, ToastType } from '@/components/ui/Toast';

type StageRow = { stage_name: string; sort_order: number };

export default function NewRecruitmentJobPage() {
  const { business, user } = useAuth();
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [department, setDepartment] = useState('');
  const [description, setDescription] = useState('');
  const [stages, setStages] = useState<StageRow[]>([
    { stage_name: 'HR Round', sort_order: 0 },
    { stage_name: 'Manager Round', sort_order: 1 },
    { stage_name: 'Final Round', sort_order: 2 },
  ]);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  const { status: authStatus } = useAuthorizationGuard({
    resource: 'recruitment',
    action: 'create',
    skipCheck: !user?.id || !business?.id,
  });

  const updateStage = (index: number, name: string) => {
    setStages((prev) => prev.map((s, i) => (i === index ? { ...s, stage_name: name } : s)));
  };

  const addStage = () => {
    setStages((prev) => [...prev, { stage_name: '', sort_order: prev.length }]);
  };

  const removeStage = (index: number) => {
    setStages((prev) => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, sort_order: i })));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!business?.id || !user?.id) return;
    setSaving(true);
    try {
      const res = await fetch('/api/hr/recruitment/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_id: business.id,
          user_id: user.id,
          title,
          department,
          description,
          stages: stages.filter((s) => s.stage_name.trim()),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setToast({ message: data.error || 'Failed to create job', type: 'error' });
        return;
      }
      router.push(`/employees/recruitment/jobs/${data.job.id}`);
    } catch {
      setToast({ message: 'Failed to create job', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (authStatus === 'loading') {
    return (
      <div className="flex h-[calc(100vh-100px)] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }
  if (authStatus === 'denied') return <AccessDenied module="recruitment" action="create" />;

  return (
    <div className="space-y-6 p-4 md:p-6">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <ListPageHeader title="New job" subtitle="Define custom interview rounds for this role" />
      <form onSubmit={submit} className="mx-auto max-w-2xl space-y-4">
        <Card className="space-y-4 p-4">
          <Input label="Job title" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <Input label="Department" value={department} onChange={(e) => setDepartment(e.target.value)} />
          <label className="block text-sm">
            <span className="text-text-secondary">Description</span>
            <textarea
              className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        </Card>

        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-text-primary">Interview rounds</h2>
            <Button type="button" variant="secondary" onClick={addStage}>Add round</Button>
          </div>
          {stages.map((stage, index) => (
            <div key={index} className="flex gap-2">
              <Input
                label={`Round ${index + 1}`}
                value={stage.stage_name}
                onChange={(e) => updateStage(index, e.target.value)}
                required
              />
              {stages.length > 1 && (
                <Button type="button" variant="secondary" className="mt-6" onClick={() => removeStage(index)}>
                  Remove
                </Button>
              )}
            </div>
          ))}
        </Card>

        <div className="flex gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create job'}
          </Button>
          <Link href="/employees/recruitment">
            <Button type="button" variant="secondary">Cancel</Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
