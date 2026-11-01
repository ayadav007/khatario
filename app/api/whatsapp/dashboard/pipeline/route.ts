export const dynamic = 'force-dynamic';

/**
 * GET /api/whatsapp/dashboard/pipeline?days=30
 * Open deals by stage, what was won or lost in the last `days`, win rate, per-agent totals
 * and the most common lost reasons. Business-wide, so it needs the WhatsApp setup permission.
 */

import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { loadPipelineSummary } from '@/lib/whatsapp/pipeline';

export const GET = withWhatsAppPremiumApi({ managePermission: true }, async ({ request, businessId }) => {
  try {
    const days = Number(new URL(request.url).searchParams.get('days')) || 30;
    return NextResponse.json({ pipeline: await loadPipelineSummary(businessId, days) });
  } catch (error: any) {
    console.error('[dashboard pipeline] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});
