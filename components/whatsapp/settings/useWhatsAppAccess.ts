'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useSubscriptionCheck } from '@/hooks/useSubscriptionCheck';

/**
 * Plan-level WhatsApp access. Use this rather than hasCapability(), which always
 * allows the primary admin.
 * - hasConnect: Connect add-on (WABA, AI, templates, inbox, automation).
 * - hasAutoReminders: scheduled payment reminders from the billing plan (Growth and above).
 */
export function useWhatsAppAccess() {
  const { business } = useAuth();
  const { hasFeature, loading } = useSubscriptionCheck(business?.id);
  const ready = !!business && !loading;
  return {
    hasConnect: ready && hasFeature('integration_whatsapp_bot'),
    hasAutoReminders: ready && hasFeature('whatsapp_auto_reminders'),
    loading: !ready,
  };
}
