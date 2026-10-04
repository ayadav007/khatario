'use client';

import { UpgradeModal } from '@/components/subscription/UpgradeModal';

interface WhatsAppAddonModalProps {
  /** Kept for existing callers; the WhatsApp Bot and Send Message add-ons are now part of Connect. */
  addonType?: 'whatsapp_bot' | 'whatsapp_send_message' | 'all';
  onClose: () => void;
  onPurchaseSuccess?: () => void;
}

export function WhatsAppAddonModal({ onClose, onPurchaseSuccess }: WhatsAppAddonModalProps) {
  return (
    <UpgradeModal
      limitType="feature"
      featureName="Khatario Connect"
      moduleKey="connect"
      initialPlanId="connect"
      onClose={onClose}
      onUpgradeSuccess={onPurchaseSuccess}
    />
  );
}
