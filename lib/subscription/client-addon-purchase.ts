/**
 * Client-side helper: WhatsApp add-on → Razorpay checkout redirect.
 */

import type { WhatsAppAddonType } from '@/lib/subscription';

export interface StartAddonPurchaseParams {
  businessId: string;
  addonType: WhatsAppAddonType;
}

export interface StartAddonPurchaseResult {
  mode: 'redirect';
}

export async function startAddonPurchase(
  params: StartAddonPurchaseParams,
): Promise<StartAddonPurchaseResult> {
  const res = await fetch(
    `/api/subscriptions/addons/${params.addonType}/purchase`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ business_id: params.businessId }),
    },
  );
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (data.code === 'PAYMENT_NOT_CONFIGURED') {
      throw new Error(
        data.error ||
          'Online payments are not available. Please contact support.',
      );
    }
    if (data.code === 'ALREADY_ACTIVE') {
      throw new Error(data.error || 'This add-on is already active');
    }
    throw new Error(data.error || 'Failed to start add-on checkout');
  }

  if (data.mode === 'redirect' && data.checkoutUrl) {
    window.location.href = data.checkoutUrl;
    return { mode: 'redirect' };
  }

  throw new Error('No checkout URL returned');
}
