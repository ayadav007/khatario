'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useSubscriptionCheck } from '@/hooks/useSubscriptionCheck';

/**
 * Whether the business owns the WhatsApp Bot addon. Use this rather than
 * hasCapability('whatsapp_bot'), which always allows the primary admin.
 */
export function useBotAddon() {
  const { business } = useAuth();
  const { hasFeature, loading } = useSubscriptionCheck(business?.id);
  return { hasBotAddon: !loading && hasFeature('whatsapp_bot'), loading: !business || loading };
}
