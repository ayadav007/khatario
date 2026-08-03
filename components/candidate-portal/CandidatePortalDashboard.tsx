'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, LogOut } from 'lucide-react';
import { useCandidatePortal } from './CandidatePortalContext';
import { CandidateTasksTable } from './CandidateTasksTable';
import { HiringJourneyTimeline } from './HiringJourneyTimeline';
import type { JourneyStep } from '@/lib/hr/recruitment/onboarding/journey';
import { CandidatePortalOfferCard } from './CandidatePortalOfferCard';

export function CandidatePortalDashboard() {
  const { session, logout, slug } = useCandidatePortal();
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Record<string, unknown>[]>([]);
  const [journey, setJourney] = useState<JourneyStep[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/public/candidate/session/tasks', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks ?? []);
        setJourney(data.journey ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!session) return null;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-white px-4 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div>
            <p className="text-sm text-text-secondary">{session.business.name}</p>
            <h1 className="text-lg font-semibold text-text-primary">{session.candidate.name}</h1>
            <p className="text-sm text-text-muted">{session.candidate.job_title}</p>
          </div>
          <button type="button" onClick={logout} className="flex items-center gap-1 text-sm text-text-secondary">
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 p-4">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
          </div>
        ) : (
          <>
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2">
                <CandidateTasksTable
                  slug={slug ?? ''}
                  tasks={tasks.map((t) => ({
                    id: String(t.id),
                    name: String(t.name),
                    status: String(t.status),
                    due_at: t.due_at ? String(t.due_at) : null,
                    is_required: Boolean(t.is_required),
                  }))}
                />
              </div>
              <div>
                <HiringJourneyTimeline steps={journey} />
              </div>
            </div>

            <CandidatePortalOfferCard onAccepted={load} />

            {slug ? (
              <p className="text-xs text-text-muted text-center">
                Need help? Contact {session.business.name} HR.
              </p>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
