'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { BotRulesTab } from '@/components/whatsapp/BotRulesTab';
import { WhatsAppAddonModal } from '@/components/subscription/WhatsAppAddonModal';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscriptionCheck } from '@/hooks/useSubscriptionCheck';
import { Card } from '@/components/ui/Card';
import { Lock, Bot } from 'lucide-react';

export default function BotRulesPage() {
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
              Bot Rules is Locked
            </h2>
            <p className="text-gray-600 mb-6">
              Upgrade to unlock WhatsApp Bot Rules and automation features.
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
    <>
    <div className="p-6">
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <Bot className="w-6 h-6 text-primary-600" />
            <h1 className="text-2xl font-bold text-gray-900">WhatsApp Bot Rules</h1>
          </div>
          <p className="text-gray-600">
            Create and manage automated bot rules for your WhatsApp conversations.
          </p>
        </div>
        <BotRulesTab />
      </div>
    </>
  );
}

