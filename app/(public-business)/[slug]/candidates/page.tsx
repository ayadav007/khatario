'use client';

import { CandidatePortalProvider } from '@/components/candidate-portal/CandidatePortalContext';
import { CandidatePortalLoginForm } from '@/components/candidate-portal/CandidatePortalLoginForm';
import { CandidatePortalDashboard } from '@/components/candidate-portal/CandidatePortalDashboard';
import { Loader2 } from 'lucide-react';
import { useCandidatePortal } from '@/components/candidate-portal/CandidatePortalContext';

function CandidatePortalPageInner() {
  const { loading, session } = useCandidatePortal();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (!session) return <CandidatePortalLoginForm />;
  return <CandidatePortalDashboard />;
}

export default function CandidatePortalPage() {
  return (
    <CandidatePortalProvider>
      <CandidatePortalPageInner />
    </CandidatePortalProvider>
  );
}
