export const dynamic = 'force-dynamic';

/**
 * POST /api/whatsapp/lead-sources/indiamart/sync - pull new IndiaMART leads now
 * (IndiaMART allows one pull every 5 minutes; the cron does this on its own).
 */

import { NextResponse } from 'next/server';
import { withWhatsAppPremiumApi } from '@/lib/security/premium-module-api';
import { LeadSourceError, syncIndiaMart } from '@/lib/whatsapp/lead-sources';

export const POST = withWhatsAppPremiumApi({ managePermission: 'update' }, async ({ businessId }) => {
  try {
    const run = await syncIndiaMart(businessId);
    if (run.error) return NextResponse.json({ error: run.error, run }, { status: 502 });
    return NextResponse.json({ run });
  } catch (error: any) {
    if (error instanceof LeadSourceError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error('[indiamart sync] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
});
