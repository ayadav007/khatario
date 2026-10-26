'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { WhatsAppAddonModal } from '@/components/subscription/WhatsAppAddonModal';
import { LeadSourcesPage } from '@/components/whatsapp/lead-sources/LeadSourcesPage';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscriptionCheck } from '@/hooks/useSubscriptionCheck';

export default function WhatsAppLeadSourcesPage() {
  const { business } = useAuth();
  const { hasFeature, loading, refreshAddons } = useSubscriptionCheck(business?.id);
  const hasAccess = hasFeature('whatsapp_bot');
  const [showUpgrade, setShowUpgrade] = useState(false);

  useEffect(() => {
    if (!loading && !hasAccess) setShowUpgrade(true);
  }, [loading, hasAccess]);

  if (loading) {
    return <div className="flex min-h-[240px] items-center justify-center text-sm text-text-muted">Loading…</div>;
  }

  if (!hasAccess) {
    return (
      <div className="mx-auto max-w-lg p-6 text-center">
        <Lock className="mx-auto h-12 w-12 text-text-muted" />
        <h1 className="mt-3 text-xl font-semibold">Lead sources need Connect</h1>
        <p className="mt-2 text-sm text-text-secondary">Track leads from ads, links, QR codes, IndiaMART and your website.</p>
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

  return <LeadSourcesPage />;
}
