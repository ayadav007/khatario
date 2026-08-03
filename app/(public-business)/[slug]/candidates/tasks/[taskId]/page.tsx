'use client';

import { useParams } from 'next/navigation';
import { CandidatePortalProvider } from '@/components/candidate-portal/CandidatePortalContext';
import { CandidatePortalLoginForm } from '@/components/candidate-portal/CandidatePortalLoginForm';
import { CandidateTaskPage } from '@/components/candidate-portal/CandidateTaskPage';
import { Loader2 } from 'lucide-react';
import { useCandidatePortal } from '@/components/candidate-portal/CandidatePortalContext';

function TaskRouteInner() {
  const params = useParams();
  const taskId = String(params?.taskId ?? '');
  const { loading, session } = useCandidatePortal();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (!session) return <CandidatePortalLoginForm />;
  return <CandidateTaskPage taskId={taskId} />;
}

export default function CandidateTaskRoutePage() {
  return (
    <CandidatePortalProvider>
      <TaskRouteInner />
    </CandidatePortalProvider>
  );
}
