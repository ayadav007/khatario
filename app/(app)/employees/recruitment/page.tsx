'use client';

export const dynamic = 'force-dynamic';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Plus, Briefcase, Users } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useAuthorizationGuard } from '@/hooks/useAuthorizationGuard';
import { AccessDenied } from '@/components/common/AccessDenied';
import { ListPageHeader } from '@/components/layout/ListPageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';

type Job = {
  id: string;
  title: string;
  department: string | null;
  status: string;
  candidate_count: number;
};

type Candidate = {
  id: string;
  full_name: string;
  email: string;
  status: string;
  job_title: string;
};

export default function RecruitmentHubPage() {
  const { business, user } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [pendingOffers, setPendingOffers] = useState<
    { offer_id: string; candidate_id: string; candidate_name: string; designation: string; level_label: string | null; approval_level: number }[]
  >([]);
  const [loading, setLoading] = useState(true);

  const { status: authStatus } = useAuthorizationGuard({
    resource: 'recruitment',
    action: 'read',
    skipCheck: !user?.id || !business?.id,
  });

  useEffect(() => {
    if (!business?.id || !user?.id) return;
    (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          business_id: business.id,
          user_id: user.id,
        });
        const [jobsRes, candRes, pendingRes] = await Promise.all([
          fetch(`/api/hr/recruitment/jobs?${params}`),
          fetch(`/api/hr/recruitment/candidates?${params}`),
          fetch(`/api/hr/recruitment/offer-approvals/pending?${params}`),
        ]);
        if (jobsRes.ok) {
          const data = await jobsRes.json();
          setJobs(data.jobs ?? []);
        }
        if (candRes.ok) {
          const data = await candRes.json();
          setCandidates((data.candidates ?? []).slice(0, 20));
        }
        if (pendingRes.ok) {
          const data = await pendingRes.json();
          setPendingOffers(data.pending ?? []);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [business?.id, user?.id]);

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
      <ListPageHeader
        title="Recruitment"
        subtitle="Jobs, interviews, offers, and onboarding"
        actions={
          <Link href="/employees/recruitment/jobs/new">
            <Button><Plus className="mr-2 h-4 w-4" /> New job</Button>
          </Link>
        }
      />

      {pendingOffers.length > 0 && (
        <Card className="border border-amber-200 bg-amber-50 p-4">
          <h2 className="font-semibold text-amber-900">Offer approvals waiting on you</h2>
          <ul className="mt-2 divide-y divide-amber-200">
            {pendingOffers.map((p) => (
              <li key={p.offer_id} className="flex items-center justify-between py-2 text-sm">
                <span className="text-amber-900">
                  {p.candidate_name} — {p.designation}
                  <span className="text-amber-800">
                    {' '}({p.level_label || `Level ${p.approval_level}`})
                  </span>
                </span>
                <Link
                  href={`/employees/recruitment/candidates/${p.candidate_id}`}
                  className="link-primary text-sm"
                >
                  Review
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-text-secondary" />
            <h2 className="font-semibold text-text-primary">Open jobs</h2>
          </div>
          {jobs.length === 0 ? (
            <p className="text-sm text-text-secondary">No jobs yet. Create one with custom interview rounds.</p>
          ) : (
            <ul className="divide-y divide-border">
              {jobs.map((job) => (
                <li key={job.id} className="flex items-center justify-between py-3">
                  <div>
                    <Link href={`/employees/recruitment/jobs/${job.id}`} className="font-medium link-primary">
                      {job.title}
                    </Link>
                    <p className="text-xs text-text-muted">
                      {job.department || 'No department'} · {job.candidate_count} candidates
                    </p>
                  </div>
                  <Chip>{job.status}</Chip>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <div className="mb-3 flex items-center gap-2">
            <Users className="h-5 w-5 text-text-secondary" />
            <h2 className="font-semibold text-text-primary">Recent candidates</h2>
          </div>
          {candidates.length === 0 ? (
            <p className="text-sm text-text-secondary">Add candidates from a job page.</p>
          ) : (
            <ul className="divide-y divide-border">
              {candidates.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-3">
                  <div>
                    <Link href={`/employees/recruitment/candidates/${c.id}`} className="font-medium link-primary">
                      {c.full_name}
                    </Link>
                    <p className="text-xs text-text-muted">{c.job_title} · {c.email}</p>
                  </div>
                  <Chip>{c.status.replace(/_/g, ' ')}</Chip>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
