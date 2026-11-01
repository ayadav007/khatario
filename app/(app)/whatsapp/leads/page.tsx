'use client';

export const dynamic = 'force-dynamic';

import { Suspense, useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { WhatsAppAddonModal } from '@/components/subscription/WhatsAppAddonModal';
import { LeadsPage } from '@/components/whatsapp/leads/LeadsPage';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscriptionCheck } from '@/hooks/useSubscriptionCheck';

const loadingView = <div className="flex min-h-[240px] items-center justify-center text-sm text-text-muted">Loading…</div>;

export default function WhatsAppLeadsPage() {
  const { business } = useAuth();
  const { hasFeature, loading, refreshAddons } = useSubscriptionCheck(business?.id);
  const hasAccess = hasFeature('whatsapp_bot');
  const [showUpgrade, setShowUpgrade] = useState(false);

  useEffect(() => {
    if (!loading && !hasAccess) setShowUpgrade(true);
  }, [loading, hasAccess]);

  if (loading) return loadingView;

  if (!hasAccess) {
    return (
      <div className="mx-auto max-w-lg p-6 text-center">
        <Lock className="mx-auto h-12 w-12 text-text-muted" />
        <h1 className="mt-3 text-xl font-semibold">Leads need Connect</h1>
        <p className="mt-2 text-sm text-text-secondary">See every enquiry in one list, from WhatsApp, ads, IndiaMART, calls and walk-ins.</p>
        <Button className="mt-4" onClick={() => setShowUpgrade(true)}>Unlock Connect</Button>
        {showUpgrade && (
          <WhatsAppAddonModal
            addonType="whatsapp_bot"
            onClose={() => setShowUpgrade(false)}
            onPurchaseSuccess={async () => {
              await refreshAddons?.();
              window.location.reload();
            }}
          />
        )}
      </div>
    );
  }

  // The page keeps its filters in the URL (useSearchParams needs a Suspense boundary).
  return (
    <Suspense fallback={loadingView}>
      <LeadsPage />
    </Suspense>
  );
}
