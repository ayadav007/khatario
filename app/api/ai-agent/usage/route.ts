import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { loadUsage } from '@/lib/ai-agent/billing';

export const dynamic = 'force-dynamic';

/** GET /api/ai-agent/usage — AI replies today and this month, limits and Khatario AI trial. */
export const GET = withWhatsAppPremiumApi({ module: 'whatsapp', action: 'read' }, async ({ businessId }) => {
  try {
    return NextResponse.json(await loadUsage(businessId));
  } catch (error) {
    console.error('[ai-agent] usage failed:', error);
    return NextResponse.json({ error: 'Failed to load usage' }, { status: 500 });
  }
});
