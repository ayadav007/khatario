'use client';



import { useCallback, useEffect, useState } from 'react';

import Link from 'next/link';

import { useRouter } from 'next/navigation';

import { ArrowLeft, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/Button';

import { useCandidatePortal } from './CandidatePortalContext';

import {

  OnboardingTaskDetailView,

  type OnboardingTaskDetailData,

} from '@/components/onboarding/OnboardingTaskDetailView';



export function CandidateTaskPage({ taskId }: { taskId: string }) {

  const router = useRouter();

  const { slug } = useCandidatePortal();

  const [loading, setLoading] = useState(true);

  const [data, setData] = useState<(OnboardingTaskDetailData & { editable: boolean }) | null>(null);

  const [error, setError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);



  const load = useCallback(async () => {

    setLoading(true);

    setError(null);

    try {

      const res = await fetch(`/api/public/candidate/session/tasks/${taskId}`, { credentials: 'include' });

      const json = await res.json();

      if (!res.ok) {

        setError(json.error || 'Failed to load task');

        return;

      }

      setData(json as OnboardingTaskDetailData & { editable: boolean });

    } finally {

      setLoading(false);

    }

  }, [taskId]);



  useEffect(() => {

    void load();

  }, [load]);



  const updateSelfStatus = async (value: string) => {

    await fetch(`/api/public/candidate/session/tasks/${taskId}`, {

      method: 'PATCH',

      credentials: 'include',

      headers: { 'Content-Type': 'application/json' },

      body: JSON.stringify({ candidate_self_status: value }),

    });

    await load();

  };



  const submitTask = async () => {

    setBusy(true);

    setError(null);

    try {

      const res = await fetch(`/api/public/candidate/session/tasks/${taskId}`, {

        method: 'PATCH',

        credentials: 'include',

        headers: { 'Content-Type': 'application/json' },

        body: JSON.stringify({ action: 'submit' }),

      });

      const json = await res.json();

      if (!res.ok) {

        setError(json.error || 'Submit failed');

        return;

      }

      await load();

    } finally {

      setBusy(false);

    }

  };



  if (loading) {

    return (

      <div className="flex min-h-screen items-center justify-center">

        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />

      </div>

    );

  }



  if (!data?.task) {

    return (

      <div className="mx-auto max-w-3xl p-6">

        <p className="text-red-600">{error ?? 'Task not found'}</p>

        <Link href={`/${slug}/candidates`} className="link-primary text-sm mt-4 inline-block">

          Back to tasks

        </Link>

      </div>

    );

  }



  const editable = Boolean(data.editable);



  return (

    <div className="min-h-screen bg-background">

      <div className="mx-auto max-w-4xl space-y-4 p-4">

        <Link href={`/${slug}/candidates`} className="inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary">

          <ArrowLeft className="h-4 w-4" /> Tasks

        </Link>



        <OnboardingTaskDetailView

          data={data}

          editable={editable}

          taskId={taskId}

          showSelfStatus

          onSelfStatusChange={updateSelfStatus}

          onSaved={load}

          error={error}

          footer={

            editable ? (

              <div className="flex justify-end gap-2 border-t border-border pt-4">

                <Button variant="secondary" onClick={() => router.push(`/${slug}/candidates`)}>

                  Cancel

                </Button>

                <Button onClick={submitTask} disabled={busy || !data.progress.canSubmit}>

                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Submit task'}

                </Button>

              </div>

            ) : null

          }

        />

      </div>

    </div>

  );

}


