'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, Suspense } from 'react';
import { ConversationsTab } from '@/components/whatsapp/ConversationsTab';
import { WhatsAppAddonModal } from '@/components/subscription/WhatsAppAddonModal';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscriptionCheck } from '@/hooks/useSubscriptionCheck';
import { Card } from '@/components/ui/Card';
import { Lock, MessageSquare } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

function ConversationsContent() {
  const searchParams = useSearchParams();
  const { business } = useAuth();
  const { hasFeature, loading, refreshAddons } = useSubscriptionCheck(business?.id);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  // Check access - this will update when addons change
  const hasAccess = hasFeature('whatsapp_bot');

  useEffect(() => {
    if (!loading && !hasAccess) {
      setShowUpgradeModal(true);
    } else if (!loading && hasAccess) {
      setShowUpgradeModal(false);
    }
  }, [loading, hasAccess]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <>
        <div className="max-w-2xl mx-auto py-8">
          <Card className="p-8 text-center">
            <Lock className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              WhatsApp Conversations is Locked
            </h2>
            <p className="text-gray-600 mb-6">
              Upgrade to unlock WhatsApp Conversations, Bot Rules, and advanced automation features.
            </p>
            <button
              onClick={() => setShowUpgradeModal(true)}
              className="bg-primary-600 text-white px-6 py-3 rounded-lg hover:bg-primary-700 transition-colors font-medium"
            >
              Unlock WhatsApp Bot Features
            </button>
          </Card>
        </div>

        {showUpgradeModal && (
          <WhatsAppAddonModal
            addonType="whatsapp_bot"
            onClose={() => setShowUpgradeModal(false)}
            onPurchaseSuccess={async () => {
              // Refresh addons to update the feature check
              await refreshAddons?.();
              // Small delay to ensure state updates
              setTimeout(() => {
                window.location.reload();
              }, 500);
            }}
          />
        )}
      </>
    );
  }

  return (
    <div className="h-full w-full">
      <ConversationsTab initialPhoneNumber={searchParams.get('phone') || undefined} />
    </div>
  );
}

export default function ConversationsPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <ConversationsContent />
    </Suspense>
  );
}
